// ===== Инвентаризация склада =====
// Идея: "ожидаемый" остаток фиксируется снимком в момент старта (чтобы продажи по ходу
// пересчёта не сдвигали цель), пересчёт — слепой (без показа ожидаемого количества, чтобы
// не подгонять цифру под то, что "должно быть"), каждая посчитанная позиция — своя запись в
// облаке (а не один общий документ), поэтому два человека могут считать одновременно, не
// затирая друг друга. Исправления (излишек/недостача) применяются как обычные записи в
// журнал смены — списание/приход — а не прямой правкой остатка, иначе rebuildStock() при
// следующем пересчёте всё равно откатит их к прежним цифрам.
var _invSession = null;       // {id, shopName, goodsType, startedAt, startedBy, status, mode, snapshot:{key:{...}}}
var _invCounts = {};          // itemKey -> {sessionId,itemKey,num,name,price,species,size,goodsType,countedQty,countedBy,countedAt,isNew,applied}
var _invActiveSessions = [];
var _invSearch = '';
var _invReportRows = {};      // itemKey -> row shown in отчёт (используется кнопками "Применить")
var _invPendingMode = 'checklist'; // 'checklist' | 'freeform' — выбор режима перед стартом нового пересчёта
var _invPendingDate = (function(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
var _invPendingParallel = false;
var _invFfMatches = [];       // текущие подсказки поиска в свободном режиме

function openInventoryModal(){
  if(!session || !session.shopName || session.shopName==='Все магазины'){
    showToast('Откройте смену в конкретном магазине, чтобы провести инвентаризацию');
    return;
  }
  openMo('invStockMo');
  _invShowStep('loading');
  db.collection('iz_inventory_sessions').where('shopName','==',session.shopName).where('status','==','active').get()
    .then(function(snap){
      _invActiveSessions = snap.docs.map(function(d){ var x=d.data(); if(!x.id) x.id=d.id; return x; });
      _invRenderStart();
    })
    .catch(function(){ _invActiveSessions=[]; _invRenderStart(); });
}
// Список незавершённых пересчётов виден сразу на домашнем экране роли «Инвентаризация» —
// иначе узнать, что кто-то уже начал считать, можно было только открыв модалку.
function loadInvHomeActive(){
  var el = document.getElementById('invHomeActiveList');
  if(!el || !session || !session.shopName) return;
  el.innerHTML = '<div style="font-size:11px;color:#8888aa;padding:4px 0 8px">⏳ Проверяю незавершённые...</div>';
  db.collection('iz_inventory_sessions').where('shopName','==',session.shopName).where('status','==','active').get()
    .then(function(snap){
      _invActiveSessions = snap.docs.map(function(d){ var x=d.data(); if(!x.id) x.id=d.id; return x; });
      _invRenderHomeActiveList();
    })
    .catch(function(){ el.innerHTML = ''; });
}
function _invRenderHomeActiveList(){
  var el = document.getElementById('invHomeActiveList'); if(!el) return;
  if(!_invActiveSessions.length){ el.innerHTML=''; return; }
  el.innerHTML = '<div style="font-size:12px;font-weight:700;color:#8888aa;margin-bottom:8px">Незавершённые пересчёты:</div>'+
    _invActiveSessions.map(function(s){
      return '<div style="background:#1a1f2e;border:1px solid #60c8f055;border-radius:10px;padding:11px;margin-bottom:8px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
          '<div style="font-size:13px;font-weight:700;color:#60c8f0">'+(s.goodsType==='dr'?'🛍 ДР Товар':'🌳 Дерево')+'</div>'+
          '<div style="font-size:10px;color:#8888aa">'+(s.mode==='freeform'?'✍️ своб. ввод':'📋 по списку')+'</div>'+
        '</div>'+
        '<div style="font-size:11px;color:#8888aa;margin-bottom:8px">начато '+(s.startedAt||'').slice(0,10)+' · '+(s.startedBy||'—')+'</div>'+
        '<button type="button" onclick="invHomeResume(\''+s.id+'\')" style="width:100%;padding:9px;background:#60c8f0;border:none;border-radius:8px;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer">▶ Продолжить</button>'+
      '</div>';
    }).join('');
}
function invHomeResume(id){
  openMo('invStockMo');
  _invShowStep('loading');
  if(_invActiveSessions.some(function(s){ return s.id===id; })){
    invResumeSession(id);
    return;
  }
  db.collection('iz_inventory_sessions').doc(id).get().then(function(snap){
    if(!snap.exists){ showToast('Сессия не найдена'); openInventoryModal(); return; }
    var s = snap.data(); if(!s.id) s.id = id;
    _invActiveSessions = [s];
    invResumeSession(id);
  }).catch(function(){ showToast('Не удалось открыть — попробуйте ещё раз'); _invShowStep('start'); });
}
function _invShowStep(step){
  ['loading','start','count','report'].forEach(function(s){
    var el = document.getElementById('invStep_'+s);
    if(el) el.style.display = (s===step) ? 'block' : 'none';
  });
}
function _invRenderStart(){
  _invShowStep('start');
  var c = document.getElementById('invStartBody'); if(!c) return;
  var startedTypes = {}; _invActiveSessions.forEach(function(s){ startedTypes[s.goodsType]=true; });
  var resumeHtml = _invActiveSessions.map(function(s){
    return '<button type="button" onclick="invResumeSession(\''+s.id+'\')" style="width:100%;text-align:left;padding:11px;margin-bottom:8px;background:#1a1f2e;border:1px solid #60c8f055;border-radius:10px;color:#60c8f0;font-size:12px;font-weight:700;cursor:pointer">▶ Продолжить: '+(s.goodsType==='dr'?'🛍 ДР Товар':'🌳 Дерево')+'<div style="font-size:10px;color:#8888aa;font-weight:400;margin-top:2px">начато '+(s.startedAt||'').slice(0,10)+' · '+(s.startedBy||'—')+'</div></button>';
  }).join('');
  var newBtns = '';
  if(!startedTypes.derevo || !startedTypes.dr){
    var _todayInv = new Date(); var _todayInvStr = _todayInv.getFullYear()+'-'+String(_todayInv.getMonth()+1).padStart(2,'0')+'-'+String(_todayInv.getDate()).padStart(2,'0');
    newBtns += '<div style="background:#13131a;border:1px solid #2e2e3e;border-radius:10px;padding:10px;margin-bottom:10px">'+
      '<div style="font-size:11px;color:#8888aa;margin-bottom:4px">📅 Дата инвентаризации</div>'+
      '<input class="fi" type="date" id="invPendDate" value="'+_invPendingDate+'" max="'+_todayInvStr+'" onchange="_invPendingDate=this.value" style="margin:0 0 8px;padding:7px;-webkit-appearance:none;color-scheme:dark">'+
      '<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="invPendParallel"'+(_invPendingParallel?' checked':'')+' onchange="_invPendingParallel=this.checked" style="width:16px;height:16px;flex-shrink:0"><span style="font-size:11.5px;color:#f0c060;font-weight:700">🏪 Магазин не закрывался — продажи шли параллельно пересчёту</span></label>'+
    '</div>'+
    '<div style="font-size:11px;color:#8888aa;margin-bottom:6px">Как считать:</div>'+
      '<div style="display:flex;gap:6px;margin-bottom:10px">'+
        '<button type="button" onclick="invSetPendingMode(\'checklist\')" style="flex:1;padding:9px 6px;border-radius:9px;border:'+(_invPendingMode==='checklist'?'2px solid #60c8f0':'1px solid #2e2e3e')+';background:'+(_invPendingMode==='checklist'?'#0f1a22':'#1a1a22')+';color:'+(_invPendingMode==='checklist'?'#60c8f0':'#8888aa')+';font-size:11px;font-weight:700;cursor:pointer">📋 По списку системы</button>'+
        '<button type="button" onclick="invSetPendingMode(\'freeform\')" style="flex:1;padding:9px 6px;border-radius:9px;border:'+(_invPendingMode==='freeform'?'2px solid #60c8f0':'1px solid #2e2e3e')+';background:'+(_invPendingMode==='freeform'?'#0f1a22':'#1a1a22')+';color:'+(_invPendingMode==='freeform'?'#60c8f0':'#8888aa')+';font-size:11px;font-weight:700;cursor:pointer">✍️ Свободный ввод</button>'+
      '</div>'+
      '<div style="font-size:10px;color:#8888aa;margin:-4px 0 10px">'+(_invPendingMode==='freeform'
        ? 'Заносите то, что физически видите, по одному — без сверки на ходу. Сравнение с системой покажется целиком в отчёте, в конце.'
        : 'Показывает весь текущий остаток списком — отмечаете найденное по каждой позиции.')+'</div>';
  }
  if(!startedTypes.derevo) newBtns += '<button type="button" onclick="invStartSession(\'derevo\')" style="width:100%;padding:11px;margin-bottom:8px;background:#1e2a14;border:2px solid #c8f060;border-radius:10px;color:#c8f060;font-size:13px;font-weight:700;cursor:pointer">🌳 Начать — Дерево</button>';
  if(!startedTypes.dr) newBtns += '<button type="button" onclick="invStartSession(\'dr\')" style="width:100%;padding:11px;margin-bottom:8px;background:#1e1a2e;border:2px solid #a060f0;border-radius:10px;color:#a060f0;font-size:13px;font-weight:700;cursor:pointer">🛍 Начать — ДР Товар</button>';
  c.innerHTML = (resumeHtml ? '<div style="font-size:11px;color:#8888aa;margin-bottom:6px">Незавершённые пересчёты в этом магазине:</div>'+resumeHtml+'<div style="height:8px"></div>' : '') +
    (newBtns ? newBtns : '<div style="font-size:11px;color:#8888aa">Все виды товара уже считаются — продолжите один из пересчётов выше.</div>');
}
function invSetPendingMode(mode){
  _invPendingMode = mode;
  _invRenderStart();
}
function invStartSession(goodsType){
  var stock = getStock()[session.shopName] || {};
  var snapshot = {};
  Object.keys(stock).forEach(function(k){
    var it = stock[k];
    if((it.goodsType||'derevo')===goodsType){
      snapshot[k] = {num:it.num||k, name:it.name||'', price:it.price||0, species:it.species||'', size:it.size||'', goodsType:goodsType, qty:it.qty||0};
    }
  });
  var id = uid();
  var _todayS = new Date(); var _todayStr = _todayS.getFullYear()+'-'+String(_todayS.getMonth()+1).padStart(2,'0')+'-'+String(_todayS.getDate()).padStart(2,'0');
  var invDate = (document.getElementById('invPendDate')||{}).value || _invPendingDate || _todayStr;
  if(invDate>_todayStr) invDate = _todayStr;
  var parallel = !!(document.getElementById('invPendParallel')||{}).checked;
  _invSession = {id:id, shopName:session.shopName, goodsType:goodsType, startedAt:new Date().toISOString(), startedBy:(session.sellerName||session.name||'—'), status:'active', mode:_invPendingMode, snapshot:snapshot,
    inventoryDate:invDate, parallelSales:parallel,
    // Инвентаризация внесена задним числом: снимок — это ТЕКУЩИЙ остаток (нужен как справочник изделий для поиска),
    // а не остаток на дату инвентаризации; сравнение по изделиям для такой сессии не строится, только по суммам.
    backdated: invDate<_todayStr};
  _invCounts = {};
  try{ db.collection('iz_inventory_sessions').doc(id).set(_invSession); }catch(e){}
  _invEnterCount();
}
function invResumeSession(id){
  var s = _invActiveSessions.find(function(x){ return x.id===id; });
  if(!s){ showToast('Сессия не найдена — попробуйте открыть инвентаризацию заново'); return; }
  _invSession = s;
  _invShowStep('loading');
  db.collection('iz_inventory_counts').where('sessionId','==',id).get().then(function(snap){
    _invCounts = {};
    snap.forEach(function(d){ var c=d.data(); _invCounts[c.itemKey]=c; });
    _invEnterCount();
  }).catch(function(){ _invCounts={}; _invEnterCount(); showToast('⚠️ Не удалось загрузить уже посчитанное — начните досчитывать заново'); });
}
// Подсказки из справочников при занесении изделия без артикула: названия товаров (справочник Дерево / ДР Товар + то, что уже
// есть на складе магазина) и породы/материалы. Общая для счёта в приложении (_invNamesArr/_invSpeciesArr), правки уже
// занесённой позиции и разбора списка с фото (_invImpNamesArr/_invImpSpeciesArr — иначе там подсказок не было вовсе).
// Раньше список подсказок отдавался браузеру через нативный <datalist> — но у Safari его фильтрация по вводимому
// тексту чувствительна к регистру (строчными буквами ничего не находится, хотя с заглавной — находит), поэтому
// подсказки теперь рисуются вручную через psjSuggest/psjHideSugg (тот же метод, что и в приходе/продаже/списании) —
// там сравнение всегда идёт по .toLowerCase(), так что регистр ввода никак не влияет на результат.
function _invBuildRefLists(gt, snapshot){
  var names = {}, species = {};
  function addName(n){ n = (typeof n==='string' ? n : (n&&n.name)||'').trim(); if(n) names[n] = true; }
  try{ (getRefBook(gt==='dr' ? 'iz_goods_dr' : 'iz_goods_derevo')||[]).forEach(addName); }catch(e){}
  try{ (getItemsBase()||[]).forEach(addName); }catch(e){}
  try{ Object.keys(snapshot||{}).forEach(function(k){ addName(snapshot[k].name); var sp=(snapshot[k].species||'').trim(); if(sp) species[sp]=true; }); }catch(e){}
  try{ (getSpecies()||[]).forEach(function(sp){ sp = String(sp||'').trim(); if(sp) species[sp]=true; }); }catch(e){}
  try{ if(gt==='dr') (getRefBook('iz_dr_species')||[]).forEach(function(m){ var sp=(typeof m==='string'?m:(m&&m.name)||'').trim(); if(sp) species[sp]=true; }); }catch(e){}
  return {names:names, species:species};
}
function _invSortRu(set){
  return Object.keys(set).sort(function(a,b){ return a.toLowerCase().localeCompare(b.toLowerCase(),'ru'); }).slice(0,600);
}
var _invNamesArr = [], _invSpeciesArr = [];
function _invFillRefLists(){
  var gt = _invSession ? _invSession.goodsType : 'derevo';
  var lists = _invBuildRefLists(gt, _invSession && _invSession.snapshot);
  _invNamesArr = _invSortRu(lists.names); _invSpeciesArr = _invSortRu(lists.species);
  _invBuildManualCatalog();
}
// Подсказки по названию в форме «Вручную» — в отличие от простого списка названий (_invNamesArr),
// тут сразу виден и подставляется артикул, если для этого названия он есть в остатке магазина или в
// общей базе товаров — иначе приходится вспоминать номер наизусть или заносить без него то, что на
// самом деле уже есть под артикулом (и потом задваивается с системной позицией).
var _invManualCatalog = [], _invManualMatches = [];
// У товара без артикула ключ в остатке — синтетический хеш по названию+цене+породе (напр.
// «DR_свеча_вощина_sm_200»), а не настоящий номер; показывать его как «№...» — вводить в заблуждение.
// Настоящий артикул — либо явно в поле .num, либо (для старых записей без .num) сам ключ, если он
// выглядит как артикул, т.е. состоит только из цифр.
function _invLooksLikeRealArt(k){ return /^[0-9]+$/.test(String(k||'').trim()); }
function _invBuildManualCatalog(){
  var gt = _invSession ? _invSession.goodsType : 'derevo';
  var seen = {}, list = [];
  function add(num, name, species, price){
    name = (name||'').trim(); if(!name) return;
    num = (num||'').trim();
    var key = num+'|'+name.toLowerCase()+'|'+(species||'').trim().toLowerCase();
    if(seen[key]) return; seen[key]=true;
    list.push({num:num, name:name, species:(species||'').trim(), price:price||0});
  }
  // 1) Остаток ЭТОГО магазина.
  try{
    var snap = (_invSession&&_invSession.snapshot)||{};
    Object.keys(snap).forEach(function(k){ var it=snap[k]; add(it.num || (_invLooksLikeRealArt(k)?k:''), it.name, it.species, it.price); });
  }catch(e){}
  // 2) Остаток ВСЕХ магазинов того же вида товара — та же позиция может быть заведена под артикулом
  // в другом магазине, даже если тут её ещё не было.
  try{
    var allStock = (typeof getStock==='function') ? getStock() : {};
    Object.keys(allStock).forEach(function(shop){
      var st = allStock[shop]||{};
      Object.keys(st).forEach(function(k){ var it=st[k]; if((it.goodsType||'derevo')===gt) add(it.num || (_invLooksLikeRealArt(k)?k:''), it.name, it.species, it.price); });
    });
  }catch(e){}
  // 3) Общая база названий (каталог + когда-либо занесённые товары) — даже без привязанного
  // артикула: пусть найдётся хотя бы название, артикул при желании впишут вручную.
  try{ (getItemsBase()||[]).forEach(function(it){ if(!it.category || it.category===gt) add(it.num, it.name, '', it.price); }); }catch(e){}
  list.sort(function(a,b){ return a.name.toLowerCase().localeCompare(b.name.toLowerCase(),'ru'); });
  _invManualCatalog = list;
}
function invManualNameInput(v){
  var q = (v||'').trim().toLowerCase();
  var el = document.getElementById('invNewName_sugg'); if(!el) return;
  if(!q){ _invManualMatches=[]; el.style.display='none'; el.innerHTML=''; return; }
  _invManualMatches = _invManualCatalog.filter(function(it){ return it.name.toLowerCase().indexOf(q)>=0; }).slice(0,15);
  if(!_invManualMatches.length){ el.style.display='none'; el.innerHTML=''; return; }
  el.style.display='block';
  el.innerHTML = _invManualMatches.map(function(it,i){
    return '<div onmousedown="event.preventDefault();invManualPick('+i+')" style="padding:8px 10px;font-size:12px;color:#f0f0f8;border-bottom:1px solid #2e2e3e;cursor:pointer;display:flex;justify-content:space-between;gap:8px">'+
      '<span>'+_invEsc(it.name)+(it.species?' <span style="color:#f0c060">· '+_invEsc(it.species)+'</span>':'')+'</span>'+
      '<span style="color:#8888aa;flex-shrink:0;white-space:nowrap">'+(it.num?'№'+_invEsc(it.num):'без арт.')+(it.price?' · '+_iaMoney(it.price):'')+'</span>'+
    '</div>';
  }).join('');
}
function invManualPick(i){
  var it = _invManualMatches[i]; if(!it) return;
  var numEl = document.getElementById('invNewNum'); if(numEl) numEl.value = it.num||'';
  var nameEl = document.getElementById('invNewName'); if(nameEl) nameEl.value = it.name||'';
  var spEl = document.getElementById('invNewSpecies'); if(spEl) spEl.value = it.species||'';
  var prEl = document.getElementById('invNewPrice'); if(prEl && it.price) prEl.value = it.price;
  var el = document.getElementById('invNewName_sugg'); if(el){ el.style.display='none'; el.innerHTML=''; }
  _invManualMatches = [];
}
function invManualNameHide(){ setTimeout(function(){ var el=document.getElementById('invNewName_sugg'); if(el) el.style.display='none'; }, 150); }
// То же для окна «Загрузить список» — по выбранному там магазину и виду товара (Дерево/ДР). В отличие от счёта
// в приложении тут нет своей сессии со снепшотом остатка — поэтому подмешиваем остаток выбранного магазина
// (getStock()[shop]) сами, тем же способом, каким invImpParse() уже сопоставляет вставленный артикул с
// названием/породой/ценой (см. её var stock=... выше) — иначе название вроде «Соусник», которое есть только
// в остатке магазина, а не в общем справочнике/каталоге товаров, не попадёт в список подсказок.
var _invImpNamesArr = [], _invImpSpeciesArr = [];
function invImpFillRefLists(){
  var gt = (document.getElementById('invImpType')||{}).value || 'derevo';
  var shop = (document.getElementById('invImpShop')||{}).value || '';
  var snap = {};
  try{
    var stock = ((typeof getStock==='function' ? getStock() : {})[shop]) || {};
    Object.keys(stock).forEach(function(k){
      var it = stock[k]; if((it.goodsType||'derevo')===gt) snap[k] = {name:it.name||'', species:it.species||''};
    });
  }catch(e){}
  var lists = _invBuildRefLists(gt, snap);
  _invImpNamesArr = _invSortRu(lists.names); _invImpSpeciesArr = _invSortRu(lists.species);
}
// Подсказки-подстановки: oninput/onfocus запоминают id поля, из которого вызваны (через this.id, без
// подстановки ключа в текст обработчика — так безопаснее для ключей с апострофами), клик по варианту
// подставляет значение и рассылает событие change, чтобы сработала обычная привязка поля (onchange=...).
var _invSugLastId = '';
function _invSugPick(val){
  var el = document.getElementById(_invSugLastId);
  if(el){ el.value = val; try{ el.dispatchEvent(new Event('change',{bubbles:true})); }catch(e){} }
  psjHideSugg(_invSugLastId);
}
// HTML для обёртки поля со списком подсказок: id поля должен быть уникален; wrapperStyle — доп. CSS обёртки
// (напр. чтобы сохранить flex/ширину поля в строке таблицы разбора списка).
function _invSugField(inputHtml, inputId, wrapperStyle){
  return '<div style="position:relative;'+(wrapperStyle||'')+'">'+inputHtml+
    '<div id="'+inputId+'_sugg" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:80;background:#22222e;border:1px solid #3e3e4e;border-radius:8px;max-height:160px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:2px"></div></div>';
}
function _invSugAttrs(arrVar){
  return ' oninput="_invSugLastId=this.id;psjSuggest(this.id,'+arrVar+',\'_invSugPick\')" onfocus="_invSugLastId=this.id;psjSuggest(this.id,'+arrVar+',\'_invSugPick\')" onblur="psjHideSugg(this.id)"';
}
function _invEnterCount(){
  try{ _invFillRefLists(); }catch(e){}
  _invSearch = '';
  var se = document.getElementById('invSearch');
  if(se){
    se.value = '';
    se.placeholder = (_invSession.mode==='freeform') ? '🔍 Артикул или название — найти и занести' : '🔍 Поиск по названию/артикулу/породе';
  }
  ['invNewNum','invNewName','invNewSpecies','invNewPrice'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  var qtyEl = document.getElementById('invNewQty'); if(qtyEl) qtyEl.value='1';
  var sugg = document.getElementById('invFfSugg'); if(sugg){ sugg.style.display='none'; sugg.innerHTML=''; }
  var soldSe = document.getElementById('invSoldSearch'); if(soldSe) soldSe.value = '';
  var soldSugg = document.getElementById('invSoldSugg'); if(soldSugg){ soldSugg.style.display='none'; soldSugg.innerHTML=''; }
  _invSoldMatches = [];
  _invShowStep('count');
  _invRenderCountHeader();
  _invRenderCountBody();
}
function _invRenderCountBody(){
  if(_invSession && _invSession.mode==='freeform') _invRenderFreeformTally();
  else renderInvCountList();
}
function invOnSearchInput(v){
  if(_invSession && _invSession.mode==='freeform') _invFfSearchInput(v);
  else invSearchInput(v);
}
function _invRenderCountHeader(){
  var el = document.getElementById('invCountHeader');
  if(!el || !_invSession) return;
  // Пересчёт слепой: продавцу/инвентаризатору НЕ показываем ни сколько позиций «должно быть» по системе, ни итоги в ₽,
  // ни расхождения — только сколько позиций он сам уже занёс. Итоги и расхождения видит администратор (вкладка «Инвентар.»).
  var cnt = Object.keys(_invCounts).length;
  var pcs = Object.keys(_invCounts).reduce(function(a,k){ return a+(_invCounts[k].countedQty||0); },0);
  var dTxt = (_invSession.inventoryDate||'').split('-').reverse().join('.');
  el.innerHTML = '<div style="font-size:13px;font-weight:700">'+(_invSession.goodsType==='dr'?'🛍 ДР Товар':'🌳 Дерево')+' · '+_invSession.shopName+'</div>'+
    '<div style="font-size:11px;color:#8888aa;margin-top:2px">'+(dTxt?'📅 '+dTxt+' · ':'')+'Занесено позиций: '+cnt+' · всего '+pcs+' шт.'+(_invSession.parallelSales?' · 🏪 продажи шли параллельно':'')+'</div>';
  var soldSec = document.getElementById('invSoldSection');
  if(soldSec) soldSec.style.display = _invSession.parallelSales ? 'block' : 'none';
  if(_invSession.parallelSales) _invRenderSoldList();
}
function invSearchInput(v){ _invSearch = (v||'').trim().toLowerCase(); renderInvCountList(); }
// ===== Свободный ввод: сначала заносим всё найденное по одному, без сверки на ходу — сверка
// с системой видна только в отчёте, в конце. =====
function _invFfSearchInput(v){
  var q = (v||'').trim().toLowerCase();
  if(!q){ _invFfMatches=[]; _invRenderFfSuggestions(q); return; }
  var snap = _invSession.snapshot;
  var exact = Object.keys(snap).filter(function(k){ return String(snap[k].num||k).toLowerCase()===q; });
  var partial = Object.keys(snap).filter(function(k){
    if(exact.indexOf(k)>=0) return false;
    var it = snap[k];
    return (it.name||'').toLowerCase().indexOf(q)>=0 || String(it.num||k).toLowerCase().indexOf(q)>=0 || (it.species||'').toLowerCase().indexOf(q)>=0;
  });
  _invFfMatches = exact.concat(partial).slice(0,8);
  _invRenderFfSuggestions(q);
}
function _invRenderFfSuggestions(q){
  var el = document.getElementById('invFfSugg'); if(!el) return;
  if(!_invFfMatches.length){
    el.style.display = q ? 'block' : 'none';
    el.innerHTML = q ? '<div style="padding:9px 10px;font-size:11px;color:#8888aa">Не найдено в системе — можно занести как новое кнопкой ниже ⤵</div>' : '';
    return;
  }
  el.style.display = 'block';
  el.innerHTML = _invFfMatches.map(function(k){
    var it = _invSession.snapshot[k];
    var already = _invCounts[k];
    var safeKey = k.replace(/'/g,"\\'");
    return '<div onclick="invFfPick(\''+safeKey+'\')" style="padding:9px 10px;border-bottom:1px solid #2e2e3e;cursor:pointer;display:flex;justify-content:space-between;gap:8px">'+
      '<div style="font-size:12px">'+(it.num?'№'+it.num+' ':'')+(it.name||'—')+(it.species?' <span style="color:#f0c060">· '+it.species+'</span>':'')+'</div>'+
      (already ? '<div style="font-size:11px;color:#60f090;flex-shrink:0;white-space:nowrap">учтено: '+already.countedQty+'</div>' : '')+
    '</div>';
  }).join('');
}
function invFfKeydown(e){
  if(!e || e.key!=='Enter') return;
  e.preventDefault();
  var input = document.getElementById('invSearch');
  var q = ((input&&input.value)||'').trim().toLowerCase();
  if(!q) return;
  var snap = _invSession.snapshot;
  var exact = Object.keys(snap).find(function(k){ return String(snap[k].num||k).toLowerCase()===q; });
  if(exact){ invFfPick(exact); return; }
  if(_invFfMatches.length===1){ invFfPick(_invFfMatches[0]); return; }
  showToast(_invFfMatches.length ? 'Есть несколько совпадений — выберите из списка' : 'Не найдено — занесите как новое кнопкой ниже');
}
function invFfPick(key){
  var base = _invSession.snapshot[key];
  if(!base){ showToast('Товар не найден'); return; }
  var existing = _invCounts[key];
  var newQty = (existing?existing.countedQty:0) + 1;
  var rec = {
    sessionId:_invSession.id, itemKey:key,
    num:base.num||key, name:base.name, price:base.price||0, species:base.species||'', size:base.size||'', goodsType:_invSession.goodsType,
    countedQty:newQty, countedBy:(session.sellerName||session.name||'—'), countedAt:new Date().toISOString(),
    isNew:false
  };
  _invCounts[key] = rec;
  try{
    db.collection('iz_inventory_counts').doc(_invSession.id+'_'+key).set(rec)
      .catch(function(){ showToast('⚠️ Сохранено на устройстве, но не отправилось в облако'); });
  }catch(e){}
  var input = document.getElementById('invSearch'); if(input){ input.value=''; input.focus(); }
  _invFfMatches=[]; _invRenderFfSuggestions('');
  _invRenderCountHeader();
  _invRenderFreeformTally();
  showToast('✅ '+base.name+' — теперь '+newQty+' шт.');
}
function _invRenderFreeformTally(){
  var c = document.getElementById('invCountList'); if(!c || !_invSession) return;
  var keys = Object.keys(_invCounts).sort(function(a,b){
    return (_invCounts[b].countedAt||'').localeCompare(_invCounts[a].countedAt||''); // последние занесённые — сверху
  });
  if(!keys.length){ c.innerHTML = '<div class="empty"><div class="ei">✍️</div>Пока ничего не занесено — ищите товар в строке выше или добавляйте новый</div>'; return; }
  c.innerHTML = keys.map(function(k){
    var it = _invCounts[k];
    var safeKey = k.replace(/'/g,"\\'");
    // Одна строка на позицию (с переносом при нехватке ширины) — не тянем группы кнопок к разным
    // краям карточки: на широком экране это оставляло огромный пустой промежуток посередине.
    return '<div style="border:1px solid #60f09055;background:#0f1a12;border-radius:9px;padding:6px 9px;margin-bottom:4px">'+
      '<div style="display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center">'+
        '<div style="font-size:12px;font-weight:700;flex:1;min-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(it.num?'№'+it.num+' ':'')+(it.name||'—')+(it.species?' <span style="color:#f0c060;font-weight:400">· '+it.species+'</span>':'')+(it.isNew?' <span style="color:#f0c060;font-size:10px">(нов.)</span>':'')+'</div>'+
        '<div style="font-size:10.5px;color:#8888aa;white-space:nowrap;flex-shrink:0">'+_iaMoney(it.price||0)+'/шт</div>'+
        '<div style="display:flex;gap:4px;align-items:center;flex-shrink:0">'+
          '<button type="button" onclick="invFfAdjustQty(\''+safeKey+'\',-1)" style="width:24px;height:24px;border-radius:6px;border:1px solid #2e2e3e;background:#22222e;color:#f0f0f8;font-size:13px;font-weight:700;cursor:pointer;flex-shrink:0">−</button>'+
          '<div style="min-width:16px;text-align:center;font-size:13px;font-weight:700">'+it.countedQty+'</div>'+
          '<button type="button" onclick="invFfAdjustQty(\''+safeKey+'\',1)" style="width:24px;height:24px;border-radius:6px;border:1px solid #2e2e3e;background:#22222e;color:#f0f0f8;font-size:13px;font-weight:700;cursor:pointer;flex-shrink:0">+</button>'+
        '</div>'+
        '<div style="display:flex;gap:4px;flex-shrink:0">'+
          '<button type="button" onclick="invFfToggleEdit(\''+safeKey+'\')" style="width:24px;height:24px;border-radius:6px;border:1px solid #2e2e3e;background:none;color:#8888aa;font-size:10.5px;cursor:pointer;flex-shrink:0">✏️</button>'+
          '<button type="button" onclick="invFfRemoveCount(\''+safeKey+'\')" style="width:24px;height:24px;border-radius:6px;border:1px solid #f0606055;background:transparent;color:#f06060;font-size:11px;cursor:pointer;flex-shrink:0">✕</button>'+
        '</div>'+
      '</div>'+
      // Правка тут — только для самой записи пересчёта (номер/название/порода/цена, как занесли), без
      // выхода в систему: в отличие от _invRenderRow (обычный, не свободный счёт) это НЕ вызывает
      // переоценку по кассе — тут ловим типичные ошибки расшифровки с фото, а не meняем каталог задним числом.
      '<div id="invFfEdit_'+safeKey+'" style="display:none;background:#0f0f13;border-radius:8px;padding:8px;margin-top:6px">'+
        '<div class="fg" style="margin-bottom:6px"><label class="fl">№ артикула (можно пусто)</label><input class="fi" id="invFfEcNum_'+safeKey+'" value="'+_invEsc(it.num||'')+'" style="margin:0;padding:7px"></div>'+
        '<div class="fg" style="margin-bottom:6px"><label class="fl">Название</label>'+_invSugField('<input class="fi" id="invFfEcName_'+safeKey+'" value="'+_invEsc(it.name)+'" autocomplete="off" style="margin:0;padding:7px"'+_invSugAttrs('_invNamesArr')+'>','invFfEcName_'+safeKey)+'</div>'+
        '<div class="fg" style="margin-bottom:6px"><label class="fl">Порода / характеристика</label>'+_invSugField('<input class="fi" id="invFfEcSpecies_'+safeKey+'" autocomplete="off" value="'+_invEsc(it.species)+'" style="margin:0;padding:7px"'+_invSugAttrs('_invSpeciesArr')+'>','invFfEcSpecies_'+safeKey)+'</div>'+
        '<div class="fg" style="margin-bottom:8px"><label class="fl">Цена ₽</label><input class="fi" type="text" inputmode="numeric" id="invFfEcPrice_'+safeKey+'" value="'+(it.price||0)+'" style="margin:0;padding:7px"></div>'+
        '<button type="button" onclick="invFfSaveEdit(\''+safeKey+'\')" style="width:100%;padding:8px;background:#60c8f0;border:none;border-radius:8px;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer">💾 Сохранить</button>'+
      '</div>'+
      (it.soldQty ? '<div style="font-size:10px;color:#f0c060;margin-top:5px;padding-top:5px;border-top:1px solid #2e2e3e44">🛒 продано во время пересчёта: '+it.soldQty+' шт. — изменить в разделе ниже</div>' : '')+
    '</div>';
  }).join('');
}
function invFfAdjustQty(key, delta){
  var it = _invCounts[key]; if(!it) return;
  it.countedQty = Math.max(0, (it.countedQty||0)+delta);
  if((it.soldQty||0) > it.countedQty) it.soldQty = it.countedQty;
  it.countedAt = new Date().toISOString();
  it.countedBy = session.sellerName||session.name||'—';
  try{
    db.collection('iz_inventory_counts').doc(_invSession.id+'_'+key).set(it)
      .catch(function(){ showToast('⚠️ Не отправилось в облако'); });
  }catch(e){}
  _invRenderCountHeader();
  _invRenderFreeformTally();
}
function invFfToggleEdit(key){
  var el = document.getElementById('invFfEdit_'+key); if(!el) return;
  el.style.display = el.style.display==='none' ? 'block' : 'none';
}
function invFfSaveEdit(key){
  var it = _invCounts[key]; if(!it) return;
  var nameEl = document.getElementById('invFfEcName_'+key);
  var name = (nameEl && nameEl.value||'').trim();
  if(!name){ showToast('Название не может быть пустым'); return; }
  it.num = ((document.getElementById('invFfEcNum_'+key)||{}).value||'').trim();
  it.name = name;
  it.species = ((document.getElementById('invFfEcSpecies_'+key)||{}).value||'').trim();
  it.price = parseFloat((document.getElementById('invFfEcPrice_'+key)||{}).value)||0;
  it.countedAt = new Date().toISOString();
  try{
    db.collection('iz_inventory_counts').doc(_invSession.id+'_'+key).set(it)
      .catch(function(){ showToast('⚠️ Не отправилось в облако'); });
  }catch(e){}
  showToast('✅ Сохранено');
  _invRenderFreeformTally();
}
function invFfRemoveCount(key){
  if(!confirm('Убрать эту позицию из пересчёта?')) return;
  delete _invCounts[key];
  try{ db.collection('iz_inventory_counts').doc(_invSession.id+'_'+key).delete(); }catch(e){}
  _invRenderCountHeader();
  _invRenderFreeformTally();
}
// ── «Продано во время пересчёта» — отдельный раздел, а не поле внутри каждой карточки. Раньше строка
// «продано» показывалась сразу под каждой только что занесённой позицией (даже с нулём) и читалась так,
// будто система сама что-то отмечает как проданное. Теперь это отдельный поиск: находите уже ЗАНЕСЁННУЮ
// (физически найденную) позицию и отдельно отмечаете, что её, пока считали, продали — «найдено» при этом
// не трогается. Отметить проданным можно только то, что уже занесено в счёт.
var _invSoldMatches = [];
function invSoldSearchInput(v){
  var q = (v||'').trim().toLowerCase();
  if(!q){ _invSoldMatches=[]; _invRenderSoldSuggestions(); return; }
  _invSoldMatches = Object.keys(_invCounts).filter(function(k){
    var it = _invCounts[k];
    return (it.name||'').toLowerCase().indexOf(q)>=0 || String(it.num||k).toLowerCase().indexOf(q)>=0 || (it.species||'').toLowerCase().indexOf(q)>=0;
  }).slice(0,8);
  _invRenderSoldSuggestions();
}
function _invRenderSoldSuggestions(){
  var el = document.getElementById('invSoldSugg'); if(!el) return;
  var q = ((document.getElementById('invSoldSearch')||{}).value||'').trim();
  if(!_invSoldMatches.length){
    el.style.display = q ? 'block' : 'none';
    el.innerHTML = q ? '<div style="padding:9px 10px;font-size:11px;color:#8888aa">Не найдено среди уже занесённого — сначала занесите находку выше</div>' : '';
    return;
  }
  el.style.display = 'block';
  el.innerHTML = _invSoldMatches.map(function(k){
    var it = _invCounts[k], safeKey = k.replace(/'/g,"\\'");
    return '<div onclick="invSoldPick(\''+safeKey+'\')" style="padding:9px 10px;border-bottom:1px solid #2e2e3e;cursor:pointer;display:flex;justify-content:space-between;gap:8px">'+
      '<div style="font-size:12px">'+(it.num?'№'+it.num+' ':'')+(it.name||'—')+(it.species?' <span style="color:#f0c060">· '+it.species+'</span>':'')+'</div>'+
      '<div style="font-size:11px;color:#8888aa;flex-shrink:0;white-space:nowrap">найдено '+it.countedQty+(it.soldQty?' · продано '+it.soldQty:'')+'</div>'+
    '</div>';
  }).join('');
}
function invSoldKeydown(e){
  if(!e || e.key!=='Enter') return; e.preventDefault();
  if(_invSoldMatches.length===1){ invSoldPick(_invSoldMatches[0]); return; }
  showToast(_invSoldMatches.length ? 'Есть несколько совпадений — выберите из списка' : 'Не найдено среди уже занесённого');
}
function invSoldPick(key){
  var it = _invCounts[key]; if(!it){ showToast('Сначала занесите позицию в счёт'); return; }
  if((it.soldQty||0) >= (it.countedQty||0)){ showToast('Нельзя отметить проданным больше, чем занесено — сначала увеличьте «найдено»'); return; }
  it.soldQty = (it.soldQty||0)+1;
  it.countedAt = new Date().toISOString();
  try{
    db.collection('iz_inventory_counts').doc(_invSession.id+'_'+key).set(it)
      .catch(function(){ showToast('⚠️ Не отправилось в облако'); });
  }catch(e){}
  var input = document.getElementById('invSoldSearch'); if(input){ input.value=''; input.focus(); }
  _invSoldMatches=[]; _invRenderSoldSuggestions(); _invRenderSoldList();
  _invRenderFreeformTally(); renderInvCountList(); // обновить бейдж «продано» на карточке
  showToast('🛒 '+(it.name||'—')+' — продано во время пересчёта: '+it.soldQty);
}
function invSoldAdjust(key, delta){
  var it = _invCounts[key]; if(!it) return;
  it.soldQty = Math.max(0, Math.min(it.countedQty||0, (it.soldQty||0)+delta));
  it.countedAt = new Date().toISOString();
  try{
    db.collection('iz_inventory_counts').doc(_invSession.id+'_'+key).set(it)
      .catch(function(){ showToast('⚠️ Не отправилось в облако'); });
  }catch(e){}
  _invRenderSoldList(); _invRenderFreeformTally(); renderInvCountList();
}
function _invRenderSoldList(){
  var host = document.getElementById('invSoldList'); if(!host || !_invSession) return;
  var keys = Object.keys(_invCounts).filter(function(k){ return (_invCounts[k].soldQty||0)>0; });
  if(!keys.length){ host.innerHTML = '<div style="font-size:11px;color:#8888aa;padding:4px 0 6px">Пока ничего не отмечено проданным во время пересчёта.</div>'; return; }
  host.innerHTML = keys.map(function(k){
    var it = _invCounts[k], safeKey = k.replace(/'/g,"\\'");
    return '<div style="border:1px solid #f0c06055;background:#1a1710;border-radius:10px;padding:8px 10px;margin-bottom:6px;display:flex;align-items:center;gap:8px">'+
      '<div style="flex:1;min-width:0"><div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(it.num?'№'+it.num+' ':'')+(it.name||'—')+'</div><div style="font-size:10px;color:#8888aa">найдено '+it.countedQty+' шт.</div></div>'+
      '<button type="button" onclick="invSoldAdjust(\''+safeKey+'\',-1)" style="width:28px;height:28px;border-radius:7px;border:1px solid #2e2e3e;background:#22222e;color:#f0f0f8;font-size:14px;cursor:pointer;flex-shrink:0">−</button>'+
      '<div style="min-width:20px;text-align:center;font-size:13px;font-weight:700;color:#f0c060">'+it.soldQty+'</div>'+
      '<button type="button" onclick="invSoldAdjust(\''+safeKey+'\',1)" style="width:28px;height:28px;border-radius:7px;border:1px solid #2e2e3e;background:#22222e;color:#f0f0f8;font-size:14px;cursor:pointer;flex-shrink:0">+</button>'+
    '</div>';
  }).join('');
}
function renderInvCountList(){
  var c = document.getElementById('invCountList'); if(!c || !_invSession) return;
  var snap = _invSession.snapshot;
  var keys = Object.keys(snap).filter(function(k){
    if(!_invSearch) return true;
    var it = snap[k];
    return (it.name||'').toLowerCase().indexOf(_invSearch)>=0 || String(it.num||k).toLowerCase().indexOf(_invSearch)>=0 || (it.species||'').toLowerCase().indexOf(_invSearch)>=0;
  });
  keys.sort(function(a,b){
    var ca = !!_invCounts[a], cb = !!_invCounts[b];
    if(ca!==cb) return ca?1:-1;
    return (snap[a].name||'').localeCompare(snap[b].name||'');
  });
  var newKeys = Object.keys(_invCounts).filter(function(k){ return _invCounts[k].isNew; }).filter(function(k){
    if(!_invSearch) return true;
    var it = _invCounts[k];
    return (it.name||'').toLowerCase().indexOf(_invSearch)>=0 || String(it.num||'').toLowerCase().indexOf(_invSearch)>=0;
  });
  var rowsHtml = keys.map(function(k){ return _invRenderRow(k, snap[k], false); }).join('');
  var newHtml = newKeys.map(function(k){ return _invRenderRow(k, _invCounts[k], true); }).join('');
  c.innerHTML = rowsHtml + (newKeys.length ? '<div style="font-size:11px;color:#f0c060;font-weight:700;margin:12px 0 6px">➕ Добавлено при пересчёте (не было в системе)</div>'+newHtml : '');
  if(!keys.length && !newKeys.length) c.innerHTML = '<div class="empty"><div class="ei">📦</div>Ничего не найдено</div>';
}
function _invEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function _invRenderRow(key, it, isNew){
  var counted = _invCounts[key];
  var borderColor = counted ? '#60f09055' : '#2e2e3e';
  var bg = counted ? '#0f1a12' : '#13131a';
  var safeKey = key.replace(/'/g,"\\'");
  // Правка характеристик безопасна только для артикульных позиций (ключ = артикул, не
  // меняется) и для ещё не применённых новых — у товара без артикула ключ сам складывается из
  // названия+цены+породы, и правка породы задним числом создала бы вторую, отдельную позицию
  // вместо исправления существующей.
  var canEdit = isNew || !!it.num;
  var editBtn = canEdit ? '<button type="button" onclick="invToggleEditChar(\''+safeKey+'\')" style="background:none;border:1px solid #2e2e3e;border-radius:7px;padding:4px 7px;color:#8888aa;font-size:11px;cursor:pointer;flex-shrink:0">✏️</button>' : '';
  return '<div style="border:1px solid '+borderColor+';background:'+bg+';border-radius:10px;padding:9px 10px;margin-bottom:6px">'+
    '<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;align-items:flex-start">'+
      '<div style="font-size:12px;font-weight:700">'+(it.num?'№'+it.num+' ':'')+(it.name||'—')+(it.species?' <span style="color:#f0c060;font-weight:400">· '+it.species+'</span>':'')+'</div>'+
      '<div style="display:flex;gap:6px;align-items:center;flex-shrink:0">'+editBtn+(counted ? '<div style="font-size:14px">✅</div>' : '')+'</div>'+
    '</div>'+
    (canEdit ? '<div id="invEditChar_'+safeKey+'" style="display:none;background:#0f0f13;border-radius:8px;padding:8px;margin-bottom:8px">'+
      '<div class="fg" style="margin-bottom:6px"><label class="fl">Название</label>'+_invSugField('<input class="fi" id="invEcName_'+safeKey+'" value="'+_invEsc(it.name)+'" autocomplete="off" style="margin:0;padding:7px"'+_invSugAttrs('_invNamesArr')+'>','invEcName_'+safeKey)+'</div>'+
      '<div class="fg" style="margin-bottom:6px"><label class="fl">Порода / характеристика</label>'+_invSugField('<input class="fi" id="invEcSpecies_'+safeKey+'" autocomplete="off" value="'+_invEsc(it.species)+'" style="margin:0;padding:7px"'+_invSugAttrs('_invSpeciesArr')+'>','invEcSpecies_'+safeKey)+'</div>'+
      '<div class="fg" style="margin-bottom:8px"><label class="fl">Цена ₽</label><input class="fi" type="text" inputmode="numeric" id="invEcPrice_'+safeKey+'" value="'+(it.price||0)+'" style="margin:0;padding:7px"></div>'+
      '<button type="button" onclick="invSaveCharacteristics(\''+safeKey+'\','+(isNew?'true':'false')+')" style="width:100%;padding:8px;background:#60c8f0;border:none;border-radius:8px;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer">💾 Сохранить характеристики</button>'+
    '</div>' : '')+
    ((counted && counted.soldQty) ? '<div style="font-size:10px;color:#f0c060;margin-bottom:6px">🛒 продано во время пересчёта: '+counted.soldQty+' шт. — изменить в разделе ниже</div>' : '')+
    '<div style="display:flex;gap:6px;align-items:center">'+
      '<input class="fi" type="number" inputmode="decimal" id="invQty_'+safeKey+'" placeholder="Кол-во" value="'+(counted?counted.countedQty:'')+'" style="flex:1;margin:0;padding:8px" min="0">'+
      '<button type="button" onclick="invSaveCount(\''+safeKey+'\','+(isNew?'true':'false')+')" style="padding:8px 14px;background:#c8f060;border:none;border-radius:8px;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0">Сохранить</button>'+
    '</div>'+
    (counted ? '<div style="font-size:10px;color:#8888aa;margin-top:4px">'+(counted.countedBy||'—')+' · '+(counted.countedAt?counted.countedAt.slice(11,16):'')+'</div>' : '')+
  '</div>';
}
function invToggleEditChar(key){
  var el = document.getElementById('invEditChar_'+key); if(!el) return;
  el.style.display = el.style.display==='none' ? 'block' : 'none';
}
function invSaveCharacteristics(key, isNew){
  var nameEl = document.getElementById('invEcName_'+key);
  var speciesEl = document.getElementById('invEcSpecies_'+key);
  var priceEl = document.getElementById('invEcPrice_'+key);
  if(!nameEl) return;
  var name = (nameEl.value||'').trim();
  var species = (speciesEl.value||'').trim();
  var price = parseFloat(priceEl.value)||0;
  if(!name){ showToast('Название не может быть пустым'); return; }
  if(isNew){
    // Ещё не применённая новая позиция — правим то, что занесли, ничего в систему пока не уходит
    if(_invCounts[key]){
      _invCounts[key].name = name; _invCounts[key].species = species; _invCounts[key].price = price;
      try{ db.collection('iz_inventory_counts').doc(_invSession.id+'_'+key).set(_invCounts[key], {merge:true}); }catch(e){}
    }
    var editEl0 = document.getElementById('invEditChar_'+key); if(editEl0) editEl0.style.display='none';
    _invRenderCountBody();
    showToast('✅ Характеристики обновлены');
    return;
  }
  var base = _invSession.snapshot[key];
  if(!base){ showToast('Товар не найден'); return; }
  if(!base.num){ showToast('Для товара без артикула характеристики правьте через Склад'); return; }
  if(_invSession.backdated){ showToast('В инвентаризации задним числом правка характеристик системных товаров отключена — она изменила бы сегодняшнюю смену'); return; }
  _invQueueCharEdit(key, base.num, name, species, price);
}
// Правка характеристик пишется той же очередью, что и применение расхождений — обе операции
// правят один и тот же документ открытой смены, и без общей очереди могли бы затереть друг друга.
function _invQueueCharEdit(key, num, name, species, price){
  _invApplyQueue = _invApplyQueue.then(function(){ return _invApplyCharEditReal(key, num, name, species, price); });
}
function _invApplyCharEditReal(key, num, name, species, price){
  var isDr = _invSession.goodsType==='dr';
  var reasonLabel = 'Исправление характеристик — инвентаризация от '+(_invSession.startedAt||'').slice(0,10);
  var ts = new Date().toISOString();
  var item = {id:uid(), num:num, name:name, species:species, price:price, qty:0, goodsType:_invSession.goodsType, reason:reasonLabel};
  var entry = {id:uid(), type:'receive', ts:ts, icon:'🔄', label:'🔄 ПЕРЕОЦЕНКА · '+reasonLabel,
    sub:'№'+num+' '+name+(species?' · '+species:''),
    goodsType:_invSession.goodsType, items:[item], isRevaluation:true,
    amount:0, amtCls:'neu', cashEffect:0, cardEffect:0, staffEffect:0, goodsEffect:0, goodsDrEffect:0,
    inventorySessionId:_invSession.id};
  return _invFindOpenShift(_invSession.shopName).then(function(shift){
    if(!shift){
      showToast('⚠️ В магазине «'+_invSession.shopName+'» сейчас нет открытой смены — характеристики не применены. Попробуйте, когда смена откроется.');
      return;
    }
    try{ stockApplyReceive(_invSession.shopName, [{num:num, name:name, price:price, qty:0, species:species, goodsType:_invSession.goodsType}], ts.split('T')[0], _invSession.goodsType, true); }catch(e){}
    var mergedJournal = (shift.journal||[]).concat([entry]);
    return db.collection('iz_shifts').doc(shift.id).set({journal:mergedJournal, _pendingSync:false}, {merge:true}).then(function(){
      try{ _recordJournalEntryIndependently(entry, _invSession.shopName, entry.type); }catch(e){}
      if(_invSession.snapshot[key]){
        _invSession.snapshot[key].name = name;
        _invSession.snapshot[key].species = species;
        _invSession.snapshot[key].price = price;
      }
      if(_invCounts[key]){
        _invCounts[key].name = name; _invCounts[key].species = species; _invCounts[key].price = price;
        try{ db.collection('iz_inventory_counts').doc(_invSession.id+'_'+key).set(_invCounts[key], {merge:true}); }catch(e){}
      }
      var editEl = document.getElementById('invEditChar_'+key); if(editEl) editEl.style.display='none';
      _invRenderCountBody();
      showToast('✅ Характеристики исправлены в системе');
    }).catch(function(err){
      showToast('❌ Не удалось применить: '+(err&&err.message||err));
    });
  }).catch(function(err){
    showToast('❌ Не удалось найти открытую смену: '+(err&&err.message||err));
  });
}
function invSaveCount(key, isNew){
  var input = document.getElementById('invQty_'+key);
  var qty = parseFloat(input && input.value);
  if(isNaN(qty) || qty<0){ showToast('Введите количество (0 — если не нашли ни одной штуки)'); return; }
  var base = isNew ? _invCounts[key] : _invSession.snapshot[key];
  if(!base){ showToast('Товар не найден'); return; }
  var rec = {
    sessionId:_invSession.id, itemKey:key,
    num:base.num||key, name:base.name, price:base.price||0, species:base.species||'', size:base.size||'', goodsType:_invSession.goodsType,
    countedQty:qty, countedBy:(session.sellerName||session.name||'—'), countedAt:new Date().toISOString(),
    isNew:!!isNew
  };
  // «Продано во время пересчёта» правится отдельно (раздел ниже), а не тут — просто переносим уже
  // отмеченное значение на пересохранённую запись, ужимая при необходимости под новое «найдено».
  var prevSold = (_invCounts[key]||{}).soldQty;
  if(prevSold) rec.soldQty = Math.min(prevSold, qty);
  _invCounts[key] = rec;
  try{
    db.collection('iz_inventory_counts').doc(_invSession.id+'_'+key).set(rec)
      .catch(function(){ showToast('⚠️ Сохранено на устройстве, но не отправилось в облако — проверьте связь'); });
  }catch(e){}
  _invRenderCountHeader();
  renderInvCountList();
}
// Товар без артикула (частый случай для Дерева — авторские штучные изделия) заносится через
// отдельные поля рядом с поиском по артикулу, а не как запасной вариант "не нашли — добавим" —
// тип товара берётся из самого пересчёта, выбирать его тут не нужно и нечем перепутать.
function invSaveNewItem(){
  var name = (gv('invNewName')||'').trim();
  if(!name){ showToast('Введите название'); return; }
  var price = parseFloat(gv('invNewPrice'))||0;
  var species = (gv('invNewSpecies')||'').trim();
  // Артикул тут необязателен — но если он есть (например, поиск выше не нашёл его в снимке
  // остатка на дату инвентаризации, хотя на изделии он написан), заносим именно под ним, а не
  // через синтетический ключ по названию+цене+породе — иначе для артикульного товара расхождение
  // с системой посчитается неверно (система сверяет по номеру, а не по названию).
  var num = (gv('invNewNum')||'').trim();
  var qtyRaw = gv('invNewQty');
  var qty = qtyRaw==='' ? 1 : parseFloat(qtyRaw);
  if(isNaN(qty) || qty<0){ showToast('Введите найденное количество'); return; }
  var gt = _invSession.goodsType;
  var key = num || _noArticleStockKey(name, price, species, gt) || ('new_'+uid());
  var collidesWithSnapshot = !!_invSession.snapshot[key];
  if(collidesWithSnapshot){
    // Совпало с уже существующей позицией (по артикулу либо по имени+цене+породе) — это не новый
    // товар, а обычный пересчёт существующей строки, иначе в отчёте она задвоится: один раз как
    // расхождение с системой, второй раз как "излишек" на всё найденное количество.
    showToast('Такая позиция уже есть в системе — записала количество туда');
  }
  var existing = _invCounts[key];
  var finalQty = existing ? existing.countedQty + qty : qty; // повтор той же позиции (уже в снимке или уже занесённой ранее) — суммируем, а не перезаписываем
  var rec = {
    sessionId:_invSession.id, itemKey:key,
    num:num, name:name, price:price, species:species, size:'', goodsType:gt,
    countedQty:finalQty, countedBy:(session.sellerName||session.name||'—'), countedAt:new Date().toISOString(),
    isNew: !collidesWithSnapshot
  };
  _invCounts[key] = rec;
  try{
    db.collection('iz_inventory_counts').doc(_invSession.id+'_'+key).set(rec)
      .catch(function(){ showToast('⚠️ Сохранено на устройстве, но не отправилось в облако'); });
  }catch(e){}
  ['invNewNum','invNewName','invNewSpecies','invNewPrice'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  var qtyEl = document.getElementById('invNewQty'); if(qtyEl) qtyEl.value='1';
  _invRenderCountHeader();
  _invRenderCountBody();
  showToast('✅ '+name+' — учтено '+finalQty+' шт.');
}
function invGoToReport(){
  var total = Object.keys(_invSession.snapshot).length;
  var done = Object.keys(_invCounts).filter(function(k){ return _invSession.snapshot[k] && !_invCounts[k].isNew; }).length;
  if(done<total && !confirm('Посчитано '+done+' из '+total+' — остальные позиции останутся непроверенными и не попадут в отчёт. Всё равно перейти к отчёту?')) return;
  _invRenderReport();
}
function invBackToCount(){ _invShowStep('count'); renderInvCountList(); }
function _invRenderReport(){
  _invShowStep('report');
  var snap = _invSession.snapshot;
  var shortages=[], surplus=[], matched=[];
  _invReportRows = {};
  Object.keys(snap).forEach(function(k){
    var counted = _invCounts[k];
    if(!counted || counted.isNew) return;
    var expected = snap[k].qty||0;
    var diff = counted.countedQty - expected;
    var row = {key:k, num:snap[k].num, name:snap[k].name, species:snap[k].species, price:snap[k].price, expected:expected, counted:counted.countedQty, diff:diff, isNew:false, applied:!!counted.applied};
    _invReportRows[k] = row;
    if(diff<0) shortages.push(row); else if(diff>0) surplus.push(row); else matched.push(row);
  });
  Object.keys(_invCounts).forEach(function(k){
    var c = _invCounts[k];
    if(!c.isNew) return;
    var row = {key:k, num:c.num, name:c.name, species:c.species, price:c.price, expected:0, counted:c.countedQty, diff:c.countedQty, isNew:true, applied:!!c.applied};
    _invReportRows[k] = row;
    if(row.diff>0) surplus.push(row); else matched.push(row);
  });
  var notCounted = Object.keys(snap).length - (Object.keys(snap).filter(function(k){ return _invCounts[k] && !_invCounts[k].isNew; }).length);
  var sumAbs = function(arr){ return arr.reduce(function(s,r){ return s+Math.abs(r.diff*(r.price||0)); },0); };
  var c = document.getElementById('invReportBody'); if(!c) return;
  var section = function(title, rows, color, kind){
    if(!rows.length) return '';
    var rowsHtml = rows.map(function(r){
      var appliedTag = r.diff===0 ? '' : (r.applied ? '<span style="font-size:10px;color:#60f090;font-weight:700">✅ применено</span>' :
        '<button type="button" onclick="invApplyRow(\''+r.key.replace(/'/g,"\\'")+'\')" style="padding:6px 12px;background:'+color+';border:none;border-radius:7px;color:#0f0f13;font-size:11px;font-weight:700;cursor:pointer">Применить</button>');
      return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #2e2e3e33">'+
        '<div style="font-size:12px">'+(r.num?'№'+r.num+' ':'')+(r.name||'—')+(r.species?' <span style="color:#f0c060">· '+r.species+'</span>':'')+
          '<div style="font-size:10px;color:#8888aa">'+(r.isNew?'не было в системе':'система: '+r.expected)+' → факт: '+r.counted+' ('+(r.diff>0?'+':'')+r.diff+')</div></div>'+
        appliedTag+
      '</div>';
    }).join('');
    var unapplied = rows.filter(function(r){ return !r.applied; }).length;
    return '<div style="margin-bottom:14px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
        '<div style="font-size:12px;font-weight:700;color:'+color+'">'+title+' ('+rows.length+') — на '+fmt(sumAbs(rows))+'</div>'+
        (unapplied>1 ? '<button type="button" onclick="invApplyAll(\''+kind+'\')" style="font-size:10px;padding:5px 9px;border-radius:7px;border:1px solid '+color+';background:transparent;color:'+color+';cursor:pointer">Применить все ('+unapplied+')</button>' : '')+
      '</div>'+rowsHtml+'</div>';
  };
  c.innerHTML =
    (notCounted>0 ? '<div style="font-size:11px;color:#f0c060;background:#2e2414;border:1px solid #f0c06055;border-radius:8px;padding:8px;margin-bottom:10px">⚠️ Не посчитано ещё '+notCounted+' позиций — они не включены в отчёт</div>' : '')+
    section('🔻 Недостача', shortages, '#f06060', 'shortage')+
    section('🔺 Излишек / не в системе', surplus, '#f0c060', 'surplus')+
    section('✅ Совпало', matched, '#60f090', 'matched')+
    (!shortages.length && !surplus.length && !matched.length ? '<div class="empty"><div class="ei">📋</div>Пока ничего не посчитано</div>' : '');
}
function invApplyRow(key){
  var row = _invReportRows[key];
  if(!row || row.applied) return;
  if(row.diff===0){ showToast('Расхождения нет — применять нечего'); return; }
  var label = row.diff<0 ? 'списание' : 'приход';
  if(!confirm('Создать '+label+' по позиции «'+row.name+'»: '+(row.diff>0?'+':'')+row.diff+' шт. ('+fmt(Math.abs(row.diff*(row.price||0)))+')?')) return;
  _invQueueApplyRow(row);
}
function invApplyAll(kind){
  var rows = Object.keys(_invReportRows).map(function(k){ return _invReportRows[k]; }).filter(function(r){
    if(r.applied || r.diff===0) return false;
    if(kind==='shortage') return r.diff<0;
    if(kind==='surplus') return r.diff>0;
    return false;
  });
  if(!rows.length) return;
  if(!confirm('Применить '+rows.length+' исправлени'+(rows.length===1?'е':(rows.length<5?'я':'й'))+' одним действием?')) return;
  rows.forEach(function(r){ _invQueueApplyRow(r); });
}
// Несколько применений подряд (особенно «Применить все») пишут в ОДНУ И ТУ ЖЕ открытую смену —
// каждое читает её журнал, дописывает свою запись и сохраняет весь массив целиком. Если бы это
// шло параллельно, вторая запись, начавшая читать до того как первая успела сохраниться, не
// увидела бы её и при записи затёрла бы своим (более старым) снимком журнала — первая правка
// потерялась бы молча. Поэтому все применения идут строго по очереди, одно за другим.
var _invApplyQueue = Promise.resolve();
function _invQueueApplyRow(row){
  _invApplyQueue = _invApplyQueue.then(function(){ return _invApplyRowReal(row); });
}
function _invFindOpenShift(shopName){
  return db.collection('iz_shifts').where('shopName','==',shopName).where('status','==','open').get()
    .then(function(snap){
      if(snap.empty) return null;
      var doc = snap.docs[0];
      var d = doc.data(); if(!d.id) d.id = doc.id;
      return d;
    });
}
function _invApplyRowReal(row){
  if(row._applying || row.applied) return Promise.resolve();
  row._applying = true;
  var isDr = _invSession.goodsType==='dr';
  var reasonLabel = 'Инвентаризация от '+(_invSession.startedAt||'').slice(0,10);
  var ts = new Date().toISOString();
  var item = {id:uid(), num:row.num||'', name:row.name, species:row.species||'', price:row.price||0, qty:Math.abs(row.diff), goodsType:_invSession.goodsType, reason:reasonLabel};
  var entry;
  if(row.diff<0){
    entry = {id:uid(), type:'writeoff', ts:ts, icon:'🗑️', label:'Списание — инвентаризация',
      sub:(item.num?'№'+item.num+' ':'')+item.name+(item.species?' · '+item.species:'')+' × '+item.qty+' · '+reasonLabel,
      goodsType:_invSession.goodsType, items:[item],
      amount:item.price*item.qty, amtCls:'exp', amtSign:'−', cashEffect:0, cardEffect:0, staffEffect:0,
      goodsEffect: isDr?0:-(item.price*item.qty), goodsDrEffect: isDr?-(item.price*item.qty):0,
      inventorySessionId:_invSession.id};
  } else {
    entry = {id:uid(), type:'receive', ts:ts, icon:'📥', label:'Приход — инвентаризация',
      sub:(item.num?'№'+item.num+' ':'')+item.name+(item.species?' · '+item.species:'')+' × '+item.qty+' · '+reasonLabel,
      goodsType:_invSession.goodsType, items:[item], isRevaluation:false,
      amount:item.price*item.qty, amtCls:'neu', cashEffect:0, cardEffect:0, staffEffect:0,
      goodsEffect: isDr?0:(item.price*item.qty), goodsDrEffect: isDr?(item.price*item.qty):0,
      inventorySessionId:_invSession.id};
  }
  // Инвентаризация — отдельная роль без своей открытой смены (не продавец), поэтому запись
  // нельзя просто дописать в живой журнал текущей сессии — его тут попросту нет. Вместо этого
  // ищем сейчас открытую смену этого магазина в облаке и дописываем запись прямо в неё.
  return _invFindOpenShift(_invSession.shopName).then(function(shift){
    if(!shift){
      row._applying = false;
      showToast('⚠️ В магазине «'+_invSession.shopName+'» сейчас нет открытой смены — применить некуда. Попробуйте, когда смена откроется.');
      return;
    }
    if(entry.type==='receive'){
      try{ stockApplyReceive(_invSession.shopName, [{num:item.num, name:item.name, price:item.price, qty:item.qty, species:item.species, goodsType:_invSession.goodsType}], ts.split('T')[0], _invSession.goodsType, false); }catch(e){}
    }
    var mergedJournal = (shift.journal||[]).concat([entry]);
    db.collection('iz_shifts').doc(shift.id).set({journal:mergedJournal, _pendingSync:false}, {merge:true}).then(function(){
      try{ _recordJournalEntryIndependently(entry, _invSession.shopName, entry.type); }catch(e){}
      row.applied = true;
      row._applying = false;
      var countKey = row.key;
      if(_invCounts[countKey]){
        _invCounts[countKey].applied = true;
        try{ db.collection('iz_inventory_counts').doc(_invSession.id+'_'+countKey).set(_invCounts[countKey], {merge:true}); }catch(e){}
      }
      _invRenderReport();
      showToast('✅ '+(row.diff<0?'Списание':'Приход')+' добавлен в смену «'+(shift.sellerName||shift.userName||'—')+'»');
    }).catch(function(err){
      row._applying = false;
      showToast('❌ Не удалось применить: '+(err&&err.message||err));
    });
  }).catch(function(err){
    row._applying = false;
    showToast('❌ Не удалось найти открытую смену: '+(err&&err.message||err));
  });
}
function invFinalizeSession(){
  if(!_invSession) return;
  if(!confirm('Завершить инвентаризацию? Досчитать позже будет нельзя — можно будет только посмотреть итог в истории.')) return;
  _invSession.status = 'completed';
  _invSession.completedAt = new Date().toISOString();
  _invSession.completedBy = session.sellerName||session.name||'—';
  try{ db.collection('iz_inventory_sessions').doc(_invSession.id).set(_invSession); }catch(e){}
  if(_invAdminMode){ showToast('✅ Инвентаризация завершена'); _invAdminReturn(); return; }
  closeMo('invStockMo');
  showToast('✅ Инвентаризация завершена');
  _invSession = null; _invCounts = {}; _invReportRows = {};
  loadInvHomeActive();
}
function invCloseModal(){
  if(_invAdminMode){ _invAdminReturn(); return; }
  if(_invSession && _invSession.status==='active'){
    showToast('Пересчёт сохранён — можно продолжить позже через «Инвентаризация»');
  }
  closeMo('invStockMo');
  loadInvHomeActive();
}

// ══════════════ Администратор: инвентаризации — итоги, расхождения, дата, загрузка списка ══════════════
// Инвентаризатор считает «вслепую» (ни итогов, ни расхождений, ни того, сколько «должно быть»). Всё это видит
// только администратор — вкладка «Инвентар.»: внесённый итог по Дереву и ДР, продано во время пересчёта,
// сравнение с остатком товара по сменам на дату инвентаризации.
var _invAdmSessions = [];
var _invAdmGroups = {};
var _invAdmCur = null; // {key, shopName, date, sessions:[], counts:{sessionId:{itemKey:rec}}, shifts:[], atTime:'', filter:''}
function _iaEsc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function _iaMoney(n){ return Math.round(n||0).toLocaleString('ru-RU')+'₽'; }
function _iaDateRu(d){ return String(d||'').split('-').reverse().join('.'); }
function _iaSessDate(s){ return s.inventoryDate || (s.startedAt||'').slice(0,10); }
function renderInvAdmin(){
  var c = document.getElementById('invAdmList'); if(!c) return;
  c.innerHTML = '<div style="font-size:12px;color:#8888aa;padding:8px">⏳ Загружаю инвентаризации...</div>';
  db.collection('iz_inventory_sessions').get({source:'server'}).then(function(snap){
    _invAdmSessions = snap.docs.map(function(d){ var x=d.data(); if(!x.id) x.id=d.id; return x; });
    _invAdmGroups = {};
    _invAdmSessions.forEach(function(x){
      var k = (x.shopName||'')+'|'+_iaSessDate(x);
      if(!_invAdmGroups[k]) _invAdmGroups[k] = {key:k, shopName:x.shopName, date:_iaSessDate(x), sessions:[]};
      _invAdmGroups[k].sessions.push(x);
    });
    var groups = Object.keys(_invAdmGroups).map(function(k){ return _invAdmGroups[k]; })
      .sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
    if(!groups.length){ c.innerHTML = '<div class="empty"><div class="ei">📋</div>Инвентаризаций пока нет</div>'; return; }
    c.innerHTML = groups.map(function(g){
      var types = ['derevo','dr'].map(function(t){
        var ss = g.sessions.filter(function(x){ return (x.goodsType||'derevo')===t; });
        if(!ss.length) return '';
        var done = ss.every(function(x){ return x.status==='completed'; });
        return '<span style="font-size:10px;margin-right:8px;color:'+(done?'#60f090':'#f0c060')+'">'+(t==='dr'?'🛍 ДР':'🌳 Дерево')+' '+(done?'✅':'⏳ идёт')+(ss.length>1?' ×'+ss.length:'')+'</span>';
      }).join('');
      var who = g.sessions.map(function(x){ return x.startedBy||''; }).filter(function(v,i,a){ return v && a.indexOf(v)===i; }).join(', ');
      var par = g.sessions.some(function(x){ return x.parallelSales; });
      return '<div class="card" style="cursor:pointer" onclick="invAdmOpen(\''+_iaEsc(g.key).replace(/'/g,"\\'")+'\')">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start"><div>'+
          '<div style="font-family:Unbounded,sans-serif;font-size:13px;font-weight:700">'+_iaEsc(g.shopName)+'</div>'+
          '<div style="font-size:11px;color:#8888aa;margin-top:2px">📅 '+_iaDateRu(g.date)+(who?' · 👤 '+_iaEsc(who):'')+'</div>'+
          '<div style="margin-top:4px">'+types+'</div>'+
        '</div>'+(par?'<div style="font-size:10px;color:#f0c060;text-align:right">🏪 продажи<br>шли параллельно</div>':'')+'</div></div>';
    }).join('');
  }).catch(function(err){ c.innerHTML = '<div class="empty">❌ Не удалось загрузить: '+_iaEsc(err&&err.message||err)+'</div>'; });
}
function invAdmOpen(key){
  var g = _invAdmGroups[key]; if(!g){ showToast('Инвентаризация не найдена'); return; }
  _invAdmCur = {key:key, shopName:g.shopName, date:g.date, sessions:g.sessions, counts:{}, shifts:[], atTime:'', filter:''};
  var body = document.getElementById('invAdmBody'); if(body) body.innerHTML = '<div style="padding:20px;text-align:center;color:#8888aa;font-size:12px">⏳ Загружаю данные...</div>';
  openMo('invAdmMo');
  Promise.all(g.sessions.map(function(sx){
    return db.collection('iz_inventory_counts').where('sessionId','==',sx.id).get({source:'server'}).then(function(snap){
      var m = {}; snap.forEach(function(d){ var c=d.data(); m[c.itemKey||d.id] = c; }); _invAdmCur.counts[sx.id] = m;
    });
  })).then(function(){ return _invAdmLoadShifts(); }).then(function(){ _invAdmRender(); })
  .catch(function(err){ if(body) body.innerHTML = '<div class="empty">❌ '+_iaEsc(err&&err.message||err)+'</div>'; });
}
function _invAdmLoadShifts(){
  var cur = _invAdmCur;
  return db.collection('iz_shifts').where('date','==',cur.date).get({source:'server'}).then(function(snap){
    cur.shifts = snap.docs.map(function(d){ var x=d.data(); x.id=d.id; return x; })
      .filter(function(x){ return x.shopName===cur.shopName && !x._deleted && !x.isRestoreShift; })
      .sort(function(a,b){ return String(a.openedAt||'').localeCompare(String(b.openedAt||'')); });
  });
}
function _invAdmTotals(gt){
  var cur = _invAdmCur, qty=0, sum=0, sold=0, soldSum=0, pos=0;
  cur.sessions.filter(function(x){ return (x.goodsType||'derevo')===gt; }).forEach(function(x){
    var m = cur.counts[x.id]||{};
    Object.keys(m).forEach(function(k){
      var r = m[k]; var q = r.countedQty||0, sq = Math.min(r.soldQty||0, q), pr = r.price||0;
      pos++; qty += q; sum += q*pr; sold += sq; soldSum += sq*pr;
    });
  });
  return {pos:pos, qty:qty, sum:sum, sold:sold, soldSum:soldSum, net:sum-soldSum};
}
// Остаток по системе на дату инвентаризации: утро первой смены, вечер последней, либо на выбранное время
// (утро + движение по журналам смен этого дня до этого времени).
function _invAdmSystem(gt){
  var cur = _invAdmCur, sh = cur.shifts;
  if(!sh.length) return null;
  var isDr = gt==='dr';
  var first = sh[0], last = sh[sh.length-1];
  var morn = isDr ? (first.goodsDrMorning||0) : (first.goodsMorning||0);
  var eve;
  if(isDr) eve = last.drGoodsEvening!=null ? last.drGoodsEvening : _calcShiftExpectedEvening(last).goodsDr;
  else eve = last.goodsEvening!=null ? last.goodsEvening : _calcShiftExpectedEvening(last).goodsWood;
  var atTime = null;
  if(cur.atTime){
    var limit = new Date(cur.date+'T'+cur.atTime+':00');
    var delta = 0;
    sh.forEach(function(s){ (s.journal||[]).forEach(function(e){
      if(!e.ts || e.type==='open') return;
      if(new Date(e.ts) <= limit) delta += isDr ? (e.goodsDrEffect||0) : (e.goodsEffect||0);
    }); });
    atTime = morn + delta;
  }
  return {morn:morn, eve:eve, atTime:atTime, lastOpen: last.status!=='closed'};
}
function invAdmSetTime(v){ _invAdmCur.atTime = v||''; _invAdmRender(); }
function invAdmSetFilter(v){ _invAdmCur.filter = (v||'').trim().toLowerCase(); _invAdmRenderItems(); }
function _invAdmRender(){
  var cur = _invAdmCur, body = document.getElementById('invAdmBody'); if(!body||!cur) return;
  var ttl = document.getElementById('invAdmTitle'); if(ttl) ttl.textContent = cur.shopName+' · инвентаризация '+_iaDateRu(cur.date);
  var tw = _invAdmTotals('derevo'), td = _invAdmTotals('dr');
  var sw = _invAdmSystem('derevo'), sd = _invAdmSystem('dr');
  var parallel = cur.sessions.some(function(x){ return x.parallelSales; });
  var who = cur.sessions.map(function(x){ return x.startedBy||''; }).filter(function(v,i,a){ return v && a.indexOf(v)===i; }).join(', ');
  function diffCell(net, ref){
    if(ref==null) return '<span style="color:#555568">—</span>';
    var d = net-ref; var ok = Math.abs(d)<1;
    return '<span style="font-weight:700;color:'+(ok?'#60f090':(d>0?'#f0c060':'#f06060'))+'">'+(ok?'сходится':(d>0?'+':'−')+_iaMoney(Math.abs(d)))+'</span>';
  }
  function row(label, a, b, opt){ opt=opt||{}; return '<div style="display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:6px;padding:6px 0;border-bottom:1px solid #22222e;font-size:12px;align-items:center'+(opt.bold?';font-weight:700':'')+'"><div style="color:'+(opt.dim?'#8888aa':'#f0f0f8')+'">'+label+'</div><div>'+a+'</div><div>'+b+'</div></div>'; }
  var noShift = !cur.shifts.length;
  // Для инвентаризации задним числом (расшифровка бумажного листа спустя время) неизвестно, в какой
  // именно момент дня физически нашли каждую позицию — а без этого сравнение с ВЕЧЕРОМ требует по
  // каждой запроданной позиции гадать, успели её занести до продажи или нет. Сравнение с УТРОМ этого
  // не требует: всё, что нашли (внесено, без вычета «продано во время пересчёта») плюс то, что в тот
  // день продали, но так и не нашли (см. «🧾 Продажи за день» ниже) — и есть утренний остаток.
  var allBackdated = cur.sessions.length>0 && cur.sessions.every(function(x){ return x.backdated; });
  var html = '';
  html += '<div style="font-size:11px;color:#8888aa;margin-bottom:10px">'+(who?'👤 '+_iaEsc(who)+' · ':'')+cur.sessions.length+' сесс. · '+(parallel?'🏪 магазин работал во время инвентаризации, продажи шли параллельно':'магазин не работал параллельно')+'</div>';
  // дата
  html += '<div style="background:#13131a;border:1px solid #2e2e3e;border-radius:10px;padding:10px;margin-bottom:12px"><div style="font-size:11px;color:#8888aa;margin-bottom:5px">📅 Дата инвентаризации</div>'+
    '<div style="display:flex;gap:6px"><input class="fi" type="date" id="invAdmDate" value="'+cur.date+'" style="margin:0;padding:7px;flex:1;-webkit-appearance:none;color-scheme:dark">'+
    '<button type="button" onclick="invAdmSaveDate()" style="padding:7px 12px;background:#60c8f0;border:none;border-radius:8px;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer">💾 Сохранить дату</button></div>'+
    '<div style="font-size:10px;color:#555568;margin-top:4px">Если внесли сегодня, а считали раньше — поставьте дату, когда считали: по ней берутся остатки смен для сравнения.</div></div>';
  // управление сессиями: кто считал, параллельные продажи, статус, продолжить/править в окне пересчёта, удалить
  html += '<div style="background:#13131a;border:1px solid #2e2e3e;border-radius:10px;padding:10px;margin-bottom:12px"><div style="font-size:11px;color:#8888aa;margin-bottom:6px">⚙️ Управление инвентаризацией</div>'+
    '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px"><input class="fi" id="invAdmWho" value="'+_iaEsc(who)+'" placeholder="Кто считал" style="margin:0;padding:7px;flex:1"><label style="display:flex;align-items:center;gap:5px;font-size:11px;color:#f0c060;cursor:pointer;flex-shrink:0"><input type="checkbox" id="invAdmParallel"'+(parallel?' checked':'')+' style="width:15px;height:15px">параллельно</label>'+
    '<button type="button" onclick="invAdmSaveMeta()" style="padding:7px 10px;background:#60c8f0;border:none;border-radius:8px;color:#0f0f13;font-size:11px;font-weight:700;cursor:pointer">💾</button></div>'+
    cur.sessions.map(function(x){
      var m = cur.counts[x.id]||{}, keys = Object.keys(m), n = keys.length, done = x.status==='completed';
      var qty=0, sum=0; keys.forEach(function(k){ var r=m[k]; qty += r.countedQty||0; sum += (r.countedQty||0)*(r.price||0); });
      return '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid #22222e"><div style="flex:1;min-width:140px;font-size:11.5px"><b>'+(x.goodsType==='dr'?'🛍 ДР':'🌳 Дерево')+'</b> · '+n+' поз. · '+qty+' шт. · '+_iaMoney(sum)+' · '+(done?'<span style="color:#60f090">✅ завершена</span>':'<span style="color:#f0c060">⏳ в работе</span>')+(x.mode==='import'?' · 📥 загружена списком':'')+'</div>'+
        '<button type="button" onclick="invAdmContinue(\''+x.id+'\')" style="padding:6px 9px;background:#1a1f2e;border:1px solid #60c8f0;border-radius:7px;color:#60c8f0;font-size:10.5px;font-weight:700;cursor:pointer">✍️ Добавлять / править</button>'+
        (done ? '<button type="button" onclick="invAdmSetStatus(\''+x.id+'\',\'active\')" style="padding:6px 9px;background:none;border:1px solid #f0c060;border-radius:7px;color:#f0c060;font-size:10.5px;cursor:pointer">🔓 Вернуть в работу</button>'
              : '<button type="button" onclick="invAdmSetStatus(\''+x.id+'\',\'completed\')" style="padding:6px 9px;background:none;border:1px solid #60f090;border-radius:7px;color:#60f090;font-size:10.5px;cursor:pointer">✅ Завершить</button>')+
        '<button type="button" onclick="invAdmRevertToImport(\''+x.id+'\')" title="Занесли по ошибке или не туда — вернуть в черновик разбора списка, чтобы поправить и сохранить заново" style="padding:6px 9px;background:none;border:1px solid #a06cf055;border-radius:7px;color:#a06cf0;font-size:10.5px;cursor:pointer">↩️ Вернуть в черновик</button>'+
        '<button type="button" onclick="invAdmDeleteSession(\''+x.id+'\')" style="padding:6px 9px;background:none;border:1px solid #f0606055;border-radius:7px;color:#f06060;font-size:10.5px;cursor:pointer">🗑 Удалить</button></div>';
    }).join('')+
    // Итого по всем сессиям сразу под списком — чтобы не искать общую сумму отдельных партий
    // прокруткой вниз до таблицы сравнения с системой (там она тоже есть, но не видна сразу).
    (cur.sessions.length>1 ? '<div style="display:flex;gap:14px;flex-wrap:wrap;padding:8px 0 0;margin-top:4px;border-top:1px solid #2e2e3e;font-size:11.5px;font-weight:700">'+
      (tw.pos ? '<div>Итого 🌳 Дерево: '+tw.pos+' поз. · '+tw.qty+' шт. · '+_iaMoney(tw.sum)+'</div>' : '')+
      (td.pos ? '<div>Итого 🛍 ДР: '+td.pos+' поз. · '+td.qty+' шт. · '+_iaMoney(td.sum)+'</div>' : '')+
    '</div>' : '')+
    '</div>';
  // итоги и сравнение
  html += '<div style="background:#13131a;border:1px solid #2e2e3e;border-radius:12px;padding:8px 10px;margin-bottom:12px">'+
    '<div style="display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:6px;font-size:10px;color:#555568;padding-bottom:4px;border-bottom:1px solid #2e2e3e"><div></div><div style="color:#c8f060;font-weight:700">🌳 ДЕРЕВО</div><div style="color:#a060f0;font-weight:700">🛍 ДР ТОВАР</div></div>'+
    row('Внесено по листам', _iaMoney(tw.sum)+'<div style="font-size:10px;color:#8888aa">'+tw.pos+' поз. · '+tw.qty+' шт.</div>', _iaMoney(td.sum)+'<div style="font-size:10px;color:#8888aa">'+td.pos+' поз. · '+td.qty+' шт.</div>', {bold:true})+
    (!allBackdated && (parallel || tw.soldSum || td.soldSum) ? row('− продано во время пересчёта', _iaMoney(tw.soldSum)+'<div style="font-size:10px;color:#8888aa">'+tw.sold+' шт.</div>', _iaMoney(td.soldSum)+'<div style="font-size:10px;color:#8888aa">'+td.sold+' шт.</div>', {dim:true}) : '')+
    (allBackdated ? '' : row('= К сравнению с системой', _iaMoney(tw.net), _iaMoney(td.net), {bold:true}))+
    (noShift ? '<div style="font-size:12px;color:#f0c060;padding:10px 0">⚠️ У магазина нет смен за '+_iaDateRu(cur.date)+' — сравнивать не с чем. Проверьте дату.</div>' :
      allBackdated ?
        // Задним числом сравниваем ТОЛЬКО с утром — без вычета «продано во время пересчёта» и без
        // вечера/времени: то, что нашли при пересчёте, плюс то, что в тот день продали, но так и не
        // нашли (см. «🧾 Продажи за день»), и есть утренний остаток. Расхождение тут — это то, что
        // либо не нашли и не видно в продажах (реальная недостача), либо нашли лишнее.
        row('Система: утро '+_iaDateRu(cur.date), _iaMoney(sw.morn), _iaMoney(sd.morn), {dim:true})+
        '<div style="font-size:11px;font-weight:700;color:#f0c060;margin:10px 0 2px">РАСХОЖДЕНИЕ (внесено − утро)</div>'+
        row('без учёта продаж за день', diffCell(tw.sum, sw.morn), diffCell(td.sum, sd.morn))+
        '<div style="font-size:10px;color:#555568;margin-top:2px">Сверьте список продаж за день ниже — то, что продано, но не найдено при пересчёте, покроет часть этого расхождения.</div>'
      :
      row('Система: утро '+_iaDateRu(cur.date), _iaMoney(sw.morn), _iaMoney(sd.morn), {dim:true})+
      row('Система: вечер '+_iaDateRu(cur.date)+(sw.lastOpen?' (смена не закрыта — расчёт)':''), _iaMoney(sw.eve), _iaMoney(sd.eve), {dim:true})+
      '<div style="display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:6px;padding:6px 0;border-bottom:1px solid #22222e;font-size:12px;align-items:center"><div style="color:#8888aa">Система на время <input type="time" value="'+(cur.atTime||'')+'" onchange="invAdmSetTime(this.value)" style="background:#0f0f13;border:1px solid #2e2e3e;border-radius:6px;color:#f0f0f8;padding:3px 5px;font-size:11px;color-scheme:dark;width:88px"></div><div>'+(sw.atTime!=null?_iaMoney(sw.atTime):'<span style="color:#555568">задайте время</span>')+'</div><div>'+(sd.atTime!=null?_iaMoney(sd.atTime):'—')+'</div></div>'+
      '<div style="font-size:11px;font-weight:700;color:#f0c060;margin:10px 0 2px">РАСХОЖДЕНИЕ (к сравнению − система)</div>'+
      row('с остатком на вечер', diffCell(tw.net, sw.eve), diffCell(td.net, sd.eve))+
      row('с остатком на утро', diffCell(tw.net, sw.morn), diffCell(td.net, sd.morn))+
      (sw.atTime!=null?row('с остатком на '+cur.atTime, diffCell(tw.net, sw.atTime), diffCell(td.net, sd.atTime)):''))+
    '</div>';
  html += allBackdated ?
    '<div style="font-size:10.5px;color:#8888aa;margin-bottom:12px;line-height:1.45">«+» — изделий на складе фактически больше, чем в системе, «−» — меньше. Инвентаризация задним числом — неизвестно, в какой момент дня физически нашли каждую позицию, поэтому сравниваем только с <b>утром</b> (до любых продаж/приходов дня), без вычета «продано во время пересчёта».</div>' :
    '<div style="font-size:10.5px;color:#8888aa;margin-bottom:12px;line-height:1.45">«+» — изделий на складе фактически больше, чем в системе, «−» — меньше. Магазин работал во время пересчёта, поэтому: изделие, которое занесли, а потом продали, отмечено как «продано во время пересчёта» и вычтено из внесённого итога; сравнивайте с остатком на <b>вечер</b> (продажи и приходы дня уже учтены) либо на выбранное время.</div>';
  // смены дня
  if(cur.shifts.length){
    html += '<div style="font-size:11px;color:#8888aa;margin-bottom:10px">Смены за день: '+cur.shifts.map(function(x){ return _iaEsc(x.sellerName||'—')+' ('+(x.openedAt?new Date(x.openedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'?')+'–'+(x.closedAt?new Date(x.closedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'открыта')+')'; }).join('; ')+'</div>';
    html += '<button type="button" onclick="invAdmShowDaySales()" style="padding:8px 12px;margin-bottom:12px;background:#1a1f2e;border:1px solid #60c8f0;border-radius:8px;color:#60c8f0;font-size:11px;font-weight:700;cursor:pointer">🧾 Продажи за день — занесено / не занесено</button>';
  }
  // отчёт по изделиям — только для инвентаризаций «в тот же день» (у задним числом нет остатка по количеству на дату)
  var live = cur.sessions.filter(function(x){ return !x.backdated && x.snapshot && Object.keys(x.snapshot).length; });
  if(live.length){
    html += '<div style="margin-bottom:12px">'+live.map(function(x){ return '<button type="button" onclick="invAdmItemReport(\''+x.id+'\')" style="padding:8px 12px;margin:0 6px 6px 0;background:#1a1f2e;border:1px solid #60c8f0;border-radius:8px;color:#60c8f0;font-size:11px;font-weight:700;cursor:pointer">📑 Отчёт по изделиям — '+(x.goodsType==='dr'?'ДР':'Дерево')+'</button>'; }).join('')+'</div>';
  } else {
    html += '<div style="font-size:10.5px;color:#555568;margin-bottom:12px">Сравнение по отдельным изделиям для инвентаризации задним числом не строится (остатки по количеству на прошлую дату не хранятся) — только по суммам выше.</div>';
  }
  html += '<div style="display:flex;gap:6px;margin-bottom:8px"><input class="fi" id="invAdmFilter" placeholder="🔍 Поиск по списку внесённого..." oninput="invAdmSetFilter(this.value)" style="margin:0;padding:8px;flex:1" value="'+_iaEsc(cur.filter)+'">'+
    '<button type="button" onclick="invAdmToggleSummary()" title="Сводка по наименованиям — где могут быть задвоения" style="padding:8px 10px;background:'+(_invAdmSummaryMode?'#60c8f0':'none')+';border:1px solid #60c8f0;border-radius:8px;color:'+(_invAdmSummaryMode?'#0f0f13':'#60c8f0')+';font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0">📊 Сводка</button>'+
    '<button type="button" onclick="invAdmAddItem()" style="padding:8px 12px;background:#f0c060;border:none;border-radius:8px;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0">➕ Позиция</button></div>';
  html += '<div id="invAdmItems"></div>';
  body.innerHTML = html;
  _invAdmRenderItems();
}
function _invAdmAllRows(){
  var cur = _invAdmCur, rows = [];
  cur.sessions.forEach(function(x){ var m = cur.counts[x.id]||{}; Object.keys(m).forEach(function(k){ rows.push({sid:x.id, key:k, rec:m[k], gt:x.goodsType||'derevo'}); }); });
  return rows;
}
// «📊 Сводка» — группирует внесённое по названию, а внутри — по породе+цене, чтобы видно было
// не 369 строк подряд, а сколько всего Браслетов и какие у них варианты. Записи с одинаковыми
// названием+породой+ценой, которых больше одной, подсвечены — это не обязательно ошибка (могут
// быть разные реальные артикулы с совпавшей ценой), но чаще всего именно тут прячется задвоение.
var _invAdmSummaryMode = false;
function invAdmToggleSummary(){ _invAdmSummaryMode = !_invAdmSummaryMode; _invAdmRender(); }
function _invAdmRenderSummary(host, rows){
  if(!rows.length){ host.innerHTML = '<div class="empty">Ничего не внесено</div>'; return; }
  var byName = {};
  rows.forEach(function(r){
    var c = r.rec, nm = (c.name||'—').trim() || '—';
    var g = byName[nm] || (byName[nm] = {total:0, rowsCount:0, gt:r.gt, variants:{}});
    g.total += c.countedQty||0; g.rowsCount++;
    var vk = (c.species||'—')+'|'+(c.price||0);
    var v = g.variants[vk] || (g.variants[vk] = {species:c.species||'—', price:c.price||0, qty:0, count:0, nums:[]});
    v.qty += c.countedQty||0; v.count++;
    if(c.num) v.nums.push(c.num);
  });
  var names = Object.keys(byName).sort(function(a,b){
    var da = byName[a].rowsCount>1?1:0, db = byName[b].rowsCount>1?1:0; // подозрительные (несколько записей) — наверх
    if(da!==db) return db-da;
    return byName[b].rowsCount - byName[a].rowsCount;
  });
  host.innerHTML = '<div style="font-size:10.5px;color:#8888aa;margin-bottom:6px">'+names.length+' разных наименований. ⚠️ — есть несколько отдельных записей с одинаковой породой и ценой; может быть и не ошибкой (разные артикулы с совпавшей ценой), но стоит проверить.</div>'+
    names.map(function(nm){
      var g = byName[nm];
      var vks = Object.keys(g.variants).sort(function(a,b){ return g.variants[b].count-g.variants[a].count; });
      var suspicious = vks.some(function(vk){ return g.variants[vk].count>1; });
      var head = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px;padding-bottom:3px;border-bottom:1px solid #2e2e3e"><div style="font-size:12.5px;font-weight:700">'+(g.gt==='dr'?'🛍':'🌳')+' '+_iaEsc(nm)+(suspicious?' <span style="color:#f0c060">⚠️</span>':'')+'</div><div style="font-size:10.5px;color:#8888aa;flex-shrink:0">'+g.rowsCount+' зап. · '+g.total+' шт.</div></div>';
      var body = vks.map(function(vk){
        var v = g.variants[vk], dup = v.count>1;
        var numsTxt = v.nums.length ? ('№'+v.nums.slice(0,5).join(', №')+(v.nums.length>5?'…':'')) : 'без артикула';
        return '<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0 3px 12px;font-size:11px;'+(dup?'background:#2e1a1a44;border-radius:6px':'')+'"><div style="color:'+(dup?'#f0c060':'#c8c8d8')+'">'+_iaEsc(v.species)+' · '+_iaMoney(v.price)+(dup?' · '+v.count+' зап.':'')+'</div><div style="color:#8888aa;text-align:right;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%">'+v.qty+' шт. · '+numsTxt+'</div></div>';
      }).join('');
      return head+body;
    }).join('');
}
function _invAdmRenderItems(){
  var host = document.getElementById('invAdmItems'); if(!host || !_invAdmCur) return;
  var f = _invAdmCur.filter;
  if(_invAdmSummaryMode){
    var allRows = _invAdmAllRows().filter(function(r){
      if(!f) return true; var c=r.rec;
      return String(c.name||'').toLowerCase().indexOf(f)>=0 || String(c.num||'').toLowerCase().indexOf(f)>=0 || String(c.species||'').toLowerCase().indexOf(f)>=0;
    });
    _invAdmRenderSummary(host, allRows);
    return;
  }
  var rows = _invAdmAllRows().filter(function(r){
    if(!f) return true; var c=r.rec;
    return String(c.name||'').toLowerCase().indexOf(f)>=0 || String(c.num||'').toLowerCase().indexOf(f)>=0 || String(c.species||'').toLowerCase().indexOf(f)>=0;
  }).sort(function(a,b){ return (a.gt+String(a.rec.name||'')).localeCompare(b.gt+String(b.rec.name||''),'ru'); });
  var total = rows.length; rows = rows.slice(0,150);
  if(!rows.length){ host.innerHTML = '<div class="empty">Ничего не внесено</div>'; return; }
  host.innerHTML = '<div style="font-size:10.5px;color:#8888aa;margin-bottom:6px">Показано '+rows.length+' из '+total+(total>rows.length?' — уточните поиск':'')+'. Количество, цену и «продано» можно исправить прямо тут.</div>'+
    rows.map(function(r){
      var c=r.rec, id=_iaEsc(r.sid)+'|'+_iaEsc(r.key);
      return '<div style="display:flex;gap:6px;align-items:center;border-bottom:1px solid #22222e;padding:6px 0;font-size:11.5px">'+
        '<div style="flex:1;min-width:0"><div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(r.gt==='dr'?'🛍':'🌳')+' '+(c.num?'№'+_iaEsc(c.num)+' ':'')+_iaEsc(c.name||'—')+'</div><div style="font-size:10px;color:#8888aa">'+_iaEsc(c.species||'')+'</div></div>'+
        '<input type="text" inputmode="numeric" value="'+(c.price||0)+'" title="цена" onchange="invAdmEditRow(\''+id+'\',\'price\',this.value)" style="width:58px;background:#0f0f13;border:1px solid #2e2e3e;border-radius:6px;color:#f0f0f8;padding:4px;font-size:11px;text-align:right">'+
        '<input type="text" inputmode="numeric" value="'+(c.countedQty||0)+'" title="кол-во" onchange="invAdmEditRow(\''+id+'\',\'countedQty\',this.value)" style="width:42px;background:#0f0f13;border:1px solid #60f09055;border-radius:6px;color:#f0f0f8;padding:4px;font-size:11px;text-align:center">'+
        '<input type="text" inputmode="numeric" value="'+(c.soldQty||0)+'" title="продано во время пересчёта" onchange="invAdmEditRow(\''+id+'\',\'soldQty\',this.value)" style="width:38px;background:#0f0f13;border:1px solid #f0c06055;border-radius:6px;color:#f0c060;padding:4px;font-size:11px;text-align:center">'+
        '<button type="button" onclick="invAdmDelRow(\''+id+'\')" style="background:none;border:1px solid #f0606055;border-radius:6px;color:#f06060;padding:3px 7px;cursor:pointer">✕</button></div>';
    }).join('');
}
function invAdmEditRow(id, field, val){
  var parts = id.split('|'), sid = parts[0], key = parts.slice(1).join('|');
  var rec = (_invAdmCur.counts[sid]||{})[key]; if(!rec) return;
  var v = parseFloat(String(val).replace(/\s/g,'').replace(',','.'));
  if(isNaN(v) || v<0){ showToast('Введите число'); _invAdmRenderItems(); return; }
  rec[field] = v;
  if((rec.soldQty||0) > (rec.countedQty||0)) rec.soldQty = rec.countedQty;
  rec.editedByAdmin = (session&&(session.name||session.sellerName))||'admin';
  try{ db.collection('iz_inventory_counts').doc(sid+'_'+key).set(rec).catch(function(){ showToast('⚠️ Не отправилось в облако'); }); }catch(e){}
  _invAdmRender();
}
function invAdmDelRow(id){
  var parts = id.split('|'), sid = parts[0], key = parts.slice(1).join('|');
  var rec = (_invAdmCur.counts[sid]||{})[key]; if(!rec) return;
  if(!confirm('Убрать позицию «'+(rec.name||key)+'» из инвентаризации?')) return;
  delete _invAdmCur.counts[sid][key];
  try{ db.collection('iz_inventory_counts').doc(sid+'_'+key).delete(); }catch(e){}
  _invAdmRender();
}
function invAdmAddItem(){
  var cur = _invAdmCur; if(!cur) return;
  var gt = confirm('Добавить изделие в ДЕРЕВО?\n\nОК — Дерево, Отмена — ДР Товар') ? 'derevo' : 'dr';
  var sess = cur.sessions.filter(function(x){ return (x.goodsType||'derevo')===gt; })[0];
  if(!sess){ showToast('Для этого вида товара в инвентаризации нет сессии — используйте «Загрузить список»'); return; }
  var num = (prompt('Артикул (можно пусто):','')||'').trim();
  var name = (prompt('Название изделия:','')||'').trim(); if(!name) return;
  var species = (prompt('Порода / особенность (можно пусто):','')||'').trim();
  var price = parseFloat(prompt('Цена ₽:','0'))||0;
  var qty = parseFloat(prompt('Количество, шт:','1'))||1;
  var key = num || _noArticleStockKey(name, price, species, gt) || ('new_'+uid());
  var rec = {sessionId:sess.id, itemKey:key, num:num, name:name, price:price, species:species, size:'', goodsType:gt, countedQty:qty, countedBy:sess.startedBy||'—', countedAt:new Date().toISOString(), isNew:false, addedByAdmin:true};
  cur.counts[sess.id] = cur.counts[sess.id]||{};
  var ex = cur.counts[sess.id][key]; if(ex){ rec.countedQty = (ex.countedQty||0)+qty; rec.soldQty = ex.soldQty||0; }
  cur.counts[sess.id][key] = rec;
  try{ db.collection('iz_inventory_counts').doc(sess.id+'_'+key).set(rec); }catch(e){}
  _invAdmRender();
}
function invAdmSaveDate(){
  var cur = _invAdmCur; var el = document.getElementById('invAdmDate'); var nd = el && el.value;
  if(!nd){ showToast('Укажите дату'); return; }
  var today = new Date(); var todayStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
  if(nd>todayStr){ showToast('Дата не может быть в будущем'); return; }
  if(nd===cur.date){ showToast('Дата не изменилась'); return; }
  if(!confirm('Изменить дату инвентаризации '+_iaDateRu(cur.date)+' → '+_iaDateRu(nd)+'?')) return;
  Promise.all(cur.sessions.map(function(x){
    x.inventoryDate = nd; x.backdated = nd<todayStr;
    return db.collection('iz_inventory_sessions').doc(x.id).set({inventoryDate:nd, backdated:x.backdated, dateEditedBy:(session&&(session.name||session.sellerName))||'admin', dateEditedAt:new Date().toISOString()}, {merge:true});
  })).then(function(){
    cur.date = nd; return _invAdmLoadShifts();
  }).then(function(){ showToast('✅ Дата изменена на '+_iaDateRu(nd)); _invAdmRender(); renderInvAdmin(); })
  .catch(function(err){ showToast('❌ Не удалось: '+(err&&err.message||err)); });
}
function invAdmSaveMeta(){
  var cur = _invAdmCur; var who = ((document.getElementById('invAdmWho')||{}).value||'').trim();
  var par = !!(document.getElementById('invAdmParallel')||{}).checked;
  Promise.all(cur.sessions.map(function(x){
    if(who) x.startedBy = who; x.parallelSales = par;
    return db.collection('iz_inventory_sessions').doc(x.id).set({startedBy:x.startedBy||'', parallelSales:par}, {merge:true});
  })).then(function(){ showToast('✅ Сохранено'); _invAdmRender(); }).catch(function(err){ showToast('❌ '+(err&&err.message||err)); });
}
function invAdmSetStatus(sid, status){
  var cur = _invAdmCur; var x = cur.sessions.find(function(v){ return v.id===sid; }); if(!x) return;
  var who = (session&&(session.name||session.sellerName))||'admin';
  var patch = status==='completed' ? {status:'completed', completedAt:new Date().toISOString(), completedBy:who} : {status:'active', reopenedAt:new Date().toISOString(), reopenedBy:who};
  db.collection('iz_inventory_sessions').doc(sid).set(patch, {merge:true}).then(function(){
    Object.assign(x, patch); showToast(status==='completed' ? '✅ Инвентаризация завершена' : '🔓 Возвращена в работу — инвентаризатор может продолжить'); _invAdmRender(); renderInvAdmin();
  }).catch(function(err){ showToast('❌ '+(err&&err.message||err)); });
}
function invAdmDeleteSession(sid){
  var cur = _invAdmCur; var x = cur.sessions.find(function(v){ return v.id===sid; }); if(!x) return;
  var n = Object.keys(cur.counts[sid]||{}).length;
  if(!confirm('Удалить инвентаризацию «'+(x.goodsType==='dr'?'ДР Товар':'Дерево')+'» ('+n+' поз.) за '+_iaDateRu(cur.date)+' совсем? Восстановить будет нельзя.')) return;
  db.collection('iz_inventory_counts').where('sessionId','==',sid).get().then(function(snap){
    var ops = [], docs = snap.docs;
    for(var i=0;i<docs.length;i+=400){ (function(chunk){ var b=db.batch(); chunk.forEach(function(d){ b.delete(d.ref); }); ops.push(b.commit()); })(docs.slice(i,i+400)); }
    return Promise.all(ops);
  }).then(function(){ return db.collection('iz_inventory_sessions').doc(sid).delete(); })
  .then(function(){
    cur.sessions = cur.sessions.filter(function(v){ return v.id!==sid; }); delete cur.counts[sid];
    showToast('🗑 Инвентаризация удалена');
    if(!cur.sessions.length){ closeMo('invAdmMo'); } else { _invAdmRender(); }
    renderInvAdmin();
  }).catch(function(err){ showToast('❌ Не удалось удалить: '+(err&&err.message||err)); });
}
// Откатить уже сохранённую инвентаризацию обратно в черновик разбора списка (окно «Загрузить список») —
// на случай, когда данные сохранили по ошибке (не туда/с ошибками) и нужно вернуться к состоянию
// «занесла и правлю», а не заново перепечатывать всё с листа. Внесённые позиции удаляются из сохранённой
// инвентаризации и открываются как обычный черновик разбора — магазин, дату, вид товара и любые
// значения строк можно поправить перед повторным сохранением.
// sid откаченной сессии, чью запись в iz_inventory_sessions/iz_inventory_counts нужно будет удалить
// ПОСЛЕ того, как черновик успешно пересохранится (см. invImpSave) — не раньше. Раньше эта функция
// удаляла исходную сессию СРАЗУ, а черновик жил только в памяти (_invImpRows) до нажатия «Сохранить»;
// если вкладку закрывали/обновляли/сессия обрывалась до сохранения — данные терялись безвозвратно,
// без какой-либо возможности восстановить (в отличие от смен, у инвентаризации нет tombstone/бэкапа).
// Именно так, по всей видимости, и пропала инвентаризация целиком.
var _invImpRevertSourceSid = null;
function invAdmRevertToImport(sid){
  var cur = _invAdmCur; var x = cur.sessions.find(function(v){ return v.id===sid; }); if(!x) return;
  var counts = cur.counts[sid] || {};
  var n = Object.keys(counts).length;
  if(!confirm('Вернуть «'+(x.goodsType==='dr'?'ДР Товар':'Дерево')+'» ('+n+' поз., '+_iaEsc(cur.shopName)+', '+_iaDateRu(cur.date)+') в черновик разбора списка?\n\nОткроется в «Загрузить список» для правки. Сама сохранённая инвентаризация при этом НЕ удаляется и никуда не денется, пока вы не нажмёте «Сохранить инвентаризацию» в черновике — тогда старая версия заменится новой. Если просто закрыть окно без сохранения — ничего не изменится.')) return;
  // Порядок строк — по seq (позиция в исходном списке при сохранении, см. invImpSave); без него
  // Object.keys() сам переставил бы числовые артикулы по возрастанию впереди строковых ключей —
  // ломая порядок бумажного листа, по которому потом сверяют. У сессий, сохранённых до того, как
  // seq стали писать, откатить исходный порядок уже нечем — используем время внесения, а если и оно
  // общее на весь пакет (обычная ситуация для «Загрузить список» одним махом) — сортируем по артикулу,
  // это хотя бы предсказуемо, в отличие от порядка ключей объекта.
  var orderedKeys = Object.keys(counts).sort(function(a,b){
    var ra = counts[a], rb = counts[b];
    var sa = typeof ra.seq==='number' ? ra.seq : Infinity, sb = typeof rb.seq==='number' ? rb.seq : Infinity;
    if(sa!==sb) return sa-sb;
    var ca = ra.countedAt||'', cb = rb.countedAt||'';
    if(ca!==cb) return ca<cb?-1:1;
    return String(ra.num||'').localeCompare(String(rb.num||''), 'ru', {numeric:true});
  });
  var rows = orderedKeys.map(function(k){
    var r = counts[k];
    var issues = []; if(!r.name) issues.push('нет названия'); if(!r.price) issues.push('нет цены');
    return {num:r.num||'', name:r.name||'', species:r.species||'', price:r.price||0, qty:r.countedQty||0, sold:r.soldQty||0, issues:issues};
  });
  // Исходную сессию НЕ трогаем тут вообще — только запоминаем её sid, чтобы invImpSave() удалил её
  // САМА, но только после того, как новая (исправленная) версия реально успешно сохранится.
  _invImpRevertSourceSid = sid;
  // Открываем «Загрузить список» с уже занесёнными строками и полями, взятыми из откаченной сессии —
  // магазин/дату/тип можно тут же поправить, если раньше назначили неверно.
  var shops = (typeof getShopNames==='function') ? getShopNames() : [];
  var sel = document.getElementById('invImpShop');
  if(sel){ sel.innerHTML = shops.map(function(sn){ return '<option>'+_iaEsc(sn)+'</option>'; }).join(''); sel.value = x.shopName||''; }
  var typeEl = document.getElementById('invImpType'); if(typeEl) typeEl.value = x.goodsType||'derevo';
  var dEl = document.getElementById('invImpDate');
  if(dEl){ var today=new Date(); dEl.max = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0'); dEl.value = x.inventoryDate || cur.date; }
  var whoEl = document.getElementById('invImpWho'); if(whoEl) whoEl.value = x.startedBy||'';
  var parEl = document.getElementById('invImpParallel'); if(parEl) parEl.checked = !!x.parallelSales;
  _invImpRows = rows;
  closeMo('invAdmMo'); openMo('invImportMo');
  _invImpRender(); invImpRefreshTargets(); invImpFillRefLists();
  showToast('↩️ Открыто как черновик — поправьте и нажмите «Сохранить инвентаризацию». Старая версия останется как есть, пока не сохраните.');
}
// Администратор добавляет/правит список в том же окне, где считает инвентаризатор (поиск по артикулу и названию, подсказки, ±, удалить).
var _invAdminMode = false;
function invAdmContinue(sid){
  var cur = _invAdmCur; var x = cur.sessions.find(function(v){ return v.id===sid; }); if(!x) return;
  if(!x.snapshot || !Object.keys(x.snapshot).length){
    var stock = (getStock()[x.shopName]) || {}, snap = {};
    Object.keys(stock).forEach(function(k){ var it=stock[k]; if((it.goodsType||'derevo')===(x.goodsType||'derevo')) snap[k] = {num:it.num||k, name:it.name||'', price:it.price||0, species:it.species||'', size:it.size||'', goodsType:x.goodsType||'derevo', qty:it.qty||0}; });
    x.snapshot = snap; // справочник изделий для поиска (не остаток на дату инвентаризации)
  }
  x.mode = 'freeform';
  _invSession = x; _invCounts = cur.counts[sid] = cur.counts[sid] || {};
  _invAdminMode = true;
  closeMo('invAdmMo'); openMo('invStockMo'); _invEnterCount();
}
function _invAdminReturn(){
  if(!_invAdminMode) return false;
  _invAdminMode = false;
  closeMo('invStockMo');
  if(_invAdmCur) invAdmOpen(_invAdmCur.key);
  return true;
}
function invAdmItemReport(sessionId){
  var cur = _invAdmCur; var sx = cur.sessions.find(function(x){ return x.id===sessionId; }); if(!sx) return;
  _invSession = sx; _invCounts = cur.counts[sx.id] || {};
  openMo('invStockMo'); _invRenderReport();
}
// Список всех продаж за день инвентаризации с пометкой, найдена ли эта же позиция среди занесённого
// при пересчёте — специально для сравнения с УТРОМ (см. allBackdated в _invAdmRender): то, что продано,
// но не занесено — и есть основная часть расхождения (товар успели продать до того, как до него дошли
// при пересчёте).
function invAdmShowDaySales(){
  var cur = _invAdmCur; var body = document.getElementById('invAdmBody'); if(!cur||!body) return;
  var sales = [];
  cur.shifts.forEach(function(sh){
    (sh.journal||[]).forEach(function(e){
      if(e.type!=='sale') return;
      (e.items||[]).forEach(function(it){
        sales.push({art:String(it.article||it.num||'').trim(), name:it.name||'', species:it.species||'', price:it.price||0, qty:it.qty||1, ts:e.ts});
      });
    });
  });
  if(!sales.length){ body.innerHTML = '<button class="btn sec" style="margin-bottom:10px" onclick="_invAdmRender()">← Назад к инвентаризации</button><div class="empty">Продаж за этот день не найдено</div>'; return; }
  var allRows = _invAdmAllRows();
  var byArt = {};
  allRows.forEach(function(r){ if(r.rec.num) (byArt[r.rec.num]=byArt[r.rec.num]||[]).push(r); });
  function noArtKey(name,species,price){ return (name||'').trim().toLowerCase()+'|'+(species||'').trim().toLowerCase()+'|'+(price||0); }
  var byNoArt = {};
  allRows.forEach(function(r){ if(!r.rec.num){ var k=noArtKey(r.rec.name,r.rec.species,r.rec.price); (byNoArt[k]=byNoArt[k]||[]).push(r); } });
  sales.sort(function(a,b){ return String(a.ts||'').localeCompare(String(b.ts||'')); });
  var foundCount=0, notFoundCount=0, notFoundSum=0;
  var rowsHtml = sales.map(function(s){
    var matched = s.art ? (byArt[s.art]||[]) : (byNoArt[noArtKey(s.name,s.species,s.price)]||[]);
    var found = matched.length>0;
    if(found) foundCount++; else { notFoundCount++; notFoundSum += (s.price||0)*(s.qty||0); }
    var timeStr = s.ts ? new Date(s.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) : '?';
    return '<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid #22222e;font-size:11.5px;align-items:center">'+
      '<div style="flex:1;min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(s.art?'№'+_iaEsc(s.art)+' ':'')+_iaEsc(s.name||'—')+(s.species?' <span style="color:#f0c060">· '+_iaEsc(s.species)+'</span>':'')+'</div><div style="font-size:10px;color:#8888aa">'+timeStr+' · '+_iaMoney(s.price)+' × '+s.qty+'</div></div>'+
      (found ? '<span style="color:#60f090;font-size:11px;flex-shrink:0;white-space:nowrap">✅ занесено'+(matched.length>1?' ('+matched.length+')':'')+'</span>' : '<span style="color:#f0c060;font-size:11px;flex-shrink:0;white-space:nowrap">⚠️ не занесено</span>')+
    '</div>';
  }).join('');
  body.innerHTML = '<button class="btn sec" style="margin-bottom:10px" onclick="_invAdmRender()">← Назад к инвентаризации</button>'+
    '<div style="font-size:12.5px;font-weight:700;margin-bottom:4px">🧾 Продажи за '+_iaDateRu(cur.date)+'</div>'+
    '<div style="font-size:11px;color:#8888aa;margin-bottom:10px">Всего продаж: '+sales.length+' · ✅ занесено в пересчёт: '+foundCount+' · ⚠️ не занесено: '+notFoundCount+' на '+_iaMoney(notFoundSum)+'</div>'+
    rowsHtml;
}

// ── Загрузка списка (расшифровка рукописных листов / таблица) ──
// Формат строки (разделитель — табуляция, «;» или «|»): № ; Название ; Порода ; Цена ; Кол-во ; Продано
// «№» и «Порода» можно оставить пустыми, «Цена» — если артикул есть в системе, подставится цена из системы.
var _invImpRows = [];
function invAdmOpenImport(){
  // Обычный вход в «Загрузить список» (не через «Вернуть в черновик») — это не продолжение
  // отката, а новая, независимая загрузка, так что старую сессию из отката (если её не сохранили
  // и просто открыли это окно заново) удалять не нужно и не должны.
  _invImpRevertSourceSid = null;
  var shops = (typeof getShopNames==='function') ? getShopNames() : [];
  var sel = document.getElementById('invImpShop');
  if(sel) sel.innerHTML = shops.map(function(n){ return '<option>'+_iaEsc(n)+'</option>'; }).join('');
  var today = new Date(); var ts = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
  var dEl = document.getElementById('invImpDate'); if(dEl){ dEl.max = ts; if(!dEl.value) dEl.value = ts; }
  var who = document.getElementById('invImpWho');
  if(who && !who.value){
    var staff = (typeof getInventoryStaff==='function') ? getInventoryStaff() : [];
    who.value = (staff[0] && staff[0].name) || '';
  }
  _invImpRows = []; var pv = document.getElementById('invImpPreview'); if(pv) pv.innerHTML = '';
  openMo('invImportMo');
  invImpRefreshTargets();
  invImpFillRefLists();
}
// Куда сохранять: по умолчанию новая инвентаризация, но если для этого же магазина+даты+вида товара уже есть
// начатая (кем угодно — через приложение или предыдущей загрузкой списка), можно дозаписать прямо в неё, а не
// плодить параллельные сессии на одну и ту же инвентаризацию.
var _invImpTargetsReqId = 0;
function invImpRefreshTargets(){
  var shop = (document.getElementById('invImpShop')||{}).value;
  var date = (document.getElementById('invImpDate')||{}).value;
  var gt = (document.getElementById('invImpType')||{}).value || 'derevo';
  var sel = document.getElementById('invImpTarget'), hint = document.getElementById('invImpTargetHint');
  if(!sel) return;
  if(!shop || !date){ sel.innerHTML = '<option value="">➕ Новая инвентаризация</option>'; if(hint) hint.textContent=''; return; }
  var reqId = ++_invImpTargetsReqId;
  if(hint) hint.textContent = '⏳ Проверяю, нет ли уже начатой...';
  db.collection('iz_inventory_sessions').where('shopName','==',shop).get({source:'server'}).then(function(snap){
    if(reqId!==_invImpTargetsReqId) return; // магазин/дата/вид успели поменять — этот ответ устарел
    var matches = snap.docs.map(function(d){ var x=d.data(); if(!x.id) x.id=d.id; return x; })
      .filter(function(x){ return _iaSessDate(x)===date && (x.goodsType||'derevo')===gt; });
    if(!matches.length){
      sel.innerHTML = '<option value="">➕ Новая инвентаризация</option>';
      if(hint) hint.textContent = 'Для этого магазина/даты/вида товара пока ничего нет — создастся новая.';
      return;
    }
    Promise.all(matches.map(function(x){
      return db.collection('iz_inventory_counts').where('sessionId','==',x.id).get({source:'server'}).then(function(cs){ return cs.size; }).catch(function(){ return null; });
    })).then(function(counts){
      if(reqId!==_invImpTargetsReqId) return;
      var opts = '<option value="">➕ Новая инвентаризация</option>';
      matches.forEach(function(x,i){
        var n = counts[i]; var nTxt = n==null ? '' : (' · '+n+' поз.');
        opts += '<option value="'+x.id+'">📥 Добавить в начатую — '+_iaEsc(x.startedBy||'—')+nTxt+' · '+(x.status==='completed'?'завершена':'в работе')+'</option>';
      });
      // Раньше тут по умолчанию сразу выставлялся выбор «дозаписать в найденную», и подсказка
      // советовала именно её для «следующей страницы» — из-за этого отдельные партии, загруженные
      // в разное время, сливались в один нерасчленимый список, где не видно, что нашли в каком
      // заходе (даже после того, как перестали суммировать количество — сама структура «один общий
      // список» осталась). На самом деле для ЕЩЁ ОДНОЙ партии/страницы лучше заводить «➕ Новая» —
      // администратор и так показывает все сессии одного магазина/даты/вида вместе и складывает их
      // итоги при сравнении с системой, а каждая партия при этом остаётся отдельной, видимой и
      // отдельно редактируемой/удаляемой строкой в списке. «Добавить в начатую» — для другого случая:
      // когда это правда ОДНА и та же незавершённая сессия (например, продолжаете за коллегой).
      sel.innerHTML = opts; sel.value = '';
      if(hint) hint.textContent = '📋 Для этого магазина/даты/вида уже есть сохранённая инвентаризация. Для ЕЩЁ ОДНОЙ партии/страницы оставьте «➕ Новая» — она сохранится отдельным списком, а итоги всё равно посчитаются вместе. «📥 Добавить в начатую» выбирайте, только если это правда та же самая незавершённая сессия (например, продолжаете за другим сотрудником).';
    });
  }).catch(function(){ if(reqId===_invImpTargetsReqId){ sel.innerHTML = '<option value="">➕ Новая инвентаризация</option>'; if(hint) hint.textContent=''; } });
}
function _invImpNum(v){
  var t = String(v==null?'':v).replace(/\s/g,'').replace(/₽|руб\.?|р\./gi,'').replace(',','.');
  if(t==='') return null; var n = parseFloat(t); return isNaN(n) ? null : n;
}
function invImpParse(){
  var raw = (document.getElementById('invImpText')||{}).value || '';
  var gt = (document.getElementById('invImpType')||{}).value || 'derevo';
  var shop = (document.getElementById('invImpShop')||{}).value || '';
  var stock = ((typeof getStock==='function' ? getStock() : {})[shop]) || {};
  var rows = [];
  raw.split(/\r?\n/).forEach(function(line){
    line = line.trim(); if(!line) return;
    var delim = line.indexOf('\t')>=0 ? '\t' : (line.indexOf(';')>=0 ? ';' : (line.indexOf('|')>=0 ? '|' : null));
    var cells = delim ? line.split(delim).map(function(c){ return c.trim(); }) : [line];
    if(/^(№|номер|арт)/i.test(cells[0]) && /назв/i.test(cells[1]||'')) return; // строка-заголовок
    var num = cells[0]||'', name = cells[1]!==undefined ? cells[1] : '', species = cells[2]||'';
    if(cells.length===1){ name = cells[0]; num = ''; }
    var price = _invImpNum(cells[3]), qty = _invImpNum(cells[4]), sold = _invImpNum(cells[5]);
    var sys = null;
    if(num && stock[num] && (stock[num].goodsType||'derevo')===gt) sys = stock[num];
    if(sys){ if(!name) name = sys.name||''; if(!species) species = sys.species||''; if(price==null) price = sys.price||0; }
    var issues = [];
    if(!name) issues.push('нет названия');
    if(price==null) issues.push('нет цены');
    if(qty==null){ qty = 1; }
    rows.push({num:num, name:name, species:species, price:price==null?0:price, qty:qty, sold:sold||0, inSystem:!!sys, issues:issues});
  });
  if(!rows.length){ showToast('Строк не найдено во вставленном тексте'); return; }
  // Добавляем к уже накопленному списку (несколько страниц подряд), а не заменяем его —
  // повторный номер/позицию (число совпадает по номеру, а без номера — по названию+цене+породе) суммируем.
  var addedNew = 0, mergedInto = 0;
  rows.forEach(function(r){
    var key = (r.num||'').trim() ? 'n:'+r.num.trim() : 's:'+(r.name||'').trim().toLowerCase()+'|'+(r.price||0)+'|'+(r.species||'').trim().toLowerCase();
    var existing = _invImpRows.find(function(x){
      var xk = (x.num||'').trim() ? 'n:'+x.num.trim() : 's:'+(x.name||'').trim().toLowerCase()+'|'+(x.price||0)+'|'+(x.species||'').trim().toLowerCase();
      return xk===key;
    });
    if(existing){ existing.qty = (existing.qty||0)+(r.qty||0); existing.sold = (existing.sold||0)+(r.sold||0); mergedInto++; }
    else { _invImpRows.push(r); addedNew++; }
  });
  var ta = document.getElementById('invImpText'); if(ta) ta.value = ''; // очищаем поле — готово для вставки следующей страницы
  _invImpRender();
  showToast('✅ Добавлено '+addedNew+(mergedInto?', объединено с уже внесёнными: '+mergedInto:'')+' — вставьте следующую страницу или сохраните');
}
function invImpClearAll(){
  if(!_invImpRows.length) return;
  if(!confirm('Очистить весь накопленный список ('+_invImpRows.length+' позиций)? Вставленные страницы придётся разбирать заново.')) return;
  _invImpRows = []; _invImpRender();
}
function _invImpRender(){
  var pv = document.getElementById('invImpPreview'); if(!pv) return;
  if(!_invImpRows.length){ pv.innerHTML = '<div style="font-size:11px;color:#f0c060;padding:8px 0">Строк не найдено — вставьте список выше и нажмите «Разобрать список». Можно вставлять и разбирать несколько страниц подряд — они добавятся в один общий список.</div>'; return; }
  var sum=0, qty=0, bad=0;
  _invImpRows.forEach(function(r){ sum += (r.price||0)*(r.qty||0); qty += r.qty||0; if(r.issues.length) bad++; });
  var inp = function(i,f,v,w,extra,arrVar){
    var id = 'invImpF_'+f+'_'+i;
    var html = '<input type="text" id="'+id+'" value="'+_iaEsc(v)+'" autocomplete="off" onchange="invImpEdit('+i+',\''+f+'\',this.value)"'+(arrVar?_invSugAttrs(arrVar):'')+
      ' style="width:'+(arrVar?'100%;box-sizing:border-box':w)+';background:#0f0f13;border:1px solid #2e2e3e;border-radius:6px;color:#f0f0f8;padding:4px;font-size:11px;'+(arrVar?'':(extra||''))+'">';
    return arrVar ? _invSugField(html, id, 'width:'+w+';'+(extra||'')) : html;
  };
  pv.innerHTML = '<div style="background:#13131a;border:1px solid #2e2e3e;border-radius:10px;padding:8px 10px;margin:10px 0;font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px"><div><b>'+_invImpRows.length+'</b> позиций · <b>'+qty+'</b> шт. · итого <b style="color:#c8f060">'+_iaMoney(sum)+'</b>'+(bad?' · <span style="color:#f06060">⚠️ строк с вопросами: '+bad+'</span>':'')+'</div><button type="button" onclick="invImpClearAll()" style="font-size:10px;padding:4px 8px;background:none;border:1px solid #f0606055;border-radius:6px;color:#f06060;cursor:pointer;flex-shrink:0">🗑 Очистить всё</button></div>'+
    '<div style="font-size:10px;color:#8888aa;margin-bottom:6px">Проверьте и поправьте прямо в таблице. № · Название · Порода · Цена · Шт. · Продано</div>'+
    _invImpRows.map(function(r,i){
      return '<div style="display:flex;gap:4px;align-items:center;padding:4px 0;border-bottom:1px solid #22222e;'+(r.issues.length?'background:#2e1a1a33':'')+'">'+
        inp(i,'num',r.num,'46px')+inp(i,'name',r.name,'auto','flex:1;min-width:70px','_invImpNamesArr')+inp(i,'species',r.species,'56px','','_invImpSpeciesArr')+inp(i,'price',r.price,'50px','text-align:right')+inp(i,'qty',r.qty,'34px','text-align:center')+inp(i,'sold',r.sold,'30px','text-align:center;color:#f0c060')+
        '<button type="button" onclick="invImpDel('+i+')" style="background:none;border:none;color:#f06060;cursor:pointer;font-size:13px">✕</button></div>'+
        (r.issues.length?'<div style="font-size:10px;color:#f06060;margin:-2px 0 4px">'+r.issues.join(', ')+'</div>':'');
    }).join('');
}
function invImpEdit(i, f, v){
  var r = _invImpRows[i]; if(!r) return;
  if(f==='price'||f==='qty'||f==='sold'){ var n=_invImpNum(v); r[f] = n==null?0:n; } else r[f] = String(v).trim();
  r.issues = []; if(!r.name) r.issues.push('нет названия'); if(!r.price) r.issues.push('нет цены');
  _invImpRender();
}
function invImpDel(i){ _invImpRows.splice(i,1); _invImpRender(); }
function invImpSave(){
  var shop = (document.getElementById('invImpShop')||{}).value;
  var date = (document.getElementById('invImpDate')||{}).value;
  var gt = (document.getElementById('invImpType')||{}).value || 'derevo';
  var who = ((document.getElementById('invImpWho')||{}).value||'').trim() || 'Инвентаризация';
  var parallel = !!(document.getElementById('invImpParallel')||{}).checked;
  if(!shop || !date){ showToast('Укажите магазин и дату'); return; }
  var rows = _invImpRows.filter(function(r){ return r.name; });
  if(!rows.length){ showToast('Нет позиций для сохранения — сначала «Разобрать список»'); return; }
  var noPrice = rows.filter(function(r){ return !r.price; }).length;
  if(noPrice && !confirm('У '+noPrice+' позиций нет цены (они войдут в итог как 0₽). Сохранить всё равно?')) return;
  var today = new Date(); var ts = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
  var now = new Date().toISOString();
  var targetId = (document.getElementById('invImpTarget')||{}).value || '';
  // seq — порядковый номер строки в том виде, как она шла в разобранном списке (порядок бумажного
  // листа): без него при откате «в черновик» (invAdmRevertToImport) порядок восстановить нечем —
  // Object.keys() у обычного объекта сам переставляет числовые артикулы по возрастанию перед
  // строковыми ключами, и список перемешивается. seqOffset — чтобы при дозаписи следующей страницы
  // в уже существующую сессию новые строки шли строго ПОСЛЕ уже сохранённых, а не с нуля.
  function buildMerged(sid, seqOffset){
    var merged = {};
    rows.forEach(function(r, idx){
      var key = r.num || _noArticleStockKey(r.name, r.price, r.species, gt) || ('new_'+uid());
      var ex = merged[key];
      if(ex){ ex.countedQty += r.qty||0; ex.soldQty = Math.min(ex.countedQty, (ex.soldQty||0)+(r.sold||0)); }
      else merged[key] = {sessionId:sid, itemKey:key, num:r.num||'', name:r.name, price:r.price||0, species:r.species||'', size:'', goodsType:gt, countedQty:r.qty||0, soldQty:Math.min(r.qty||0, r.sold||0), countedBy:who, countedAt:now, isNew:false, imported:true, seq:(seqOffset||0)+idx};
    });
    return merged;
  }
  function writeCounts(sid, merged, extraOps){
    var keys = Object.keys(merged);
    var ops = (extraOps||[]).slice();
    for(var i=0;i<keys.length;i+=400){
      (function(chunk){
        var b = db.batch();
        chunk.forEach(function(k){ b.set(db.collection('iz_inventory_counts').doc(sid+'_'+k), merged[k]); });
        ops.push(b.commit());
      })(keys.slice(i,i+400));
    }
    return {ops:ops, count:keys.length};
  }
  function finish(count, dateLabel, savedIntoSid){
    showToast('✅ Загружено '+count+' позиций — инвентаризация '+dateLabel);
    closeMo('invImportMo'); _invImpRows = [];
    var t = document.getElementById('invImpText'); if(t) t.value='';
    // Если это было пересохранение черновика после «Вернуть в черновик» — теперь, когда новая
    // (исправленная) версия УЖЕ надёжно сохранена, можно безопасно убрать старую. Раньше старую
    // удаляли сразу при откате, ДО сохранения черновика — и если черновик почему-то не досохраняли
    // (закрыли окно, обновили страницу), данные терялись без возможности восстановить.
    var toCleanup = _invImpRevertSourceSid;
    _invImpRevertSourceSid = null;
    if(toCleanup && toCleanup!==savedIntoSid){
      db.collection('iz_inventory_counts').where('sessionId','==',toCleanup).get().then(function(snap){
        var ops = [], docs = snap.docs;
        for(var i=0;i<docs.length;i+=400){ (function(chunk){ var b=db.batch(); chunk.forEach(function(d){ b.delete(d.ref); }); ops.push(b.commit()); })(docs.slice(i,i+400)); }
        return Promise.all(ops);
      }).then(function(){ return db.collection('iz_inventory_sessions').doc(toCleanup).delete(); })
      .then(function(){ renderInvAdmin(); })
      .catch(function(err){ showToast('⚠️ Новая версия сохранена, но не удалось убрать старую — уберите вручную кнопкой «Удалить»: '+(err&&err.message||err)); });
    }
    renderInvAdmin();
  }
  if(targetId){
    // Дозаписываем в уже существующую инвентаризацию — но КАЖДАЯ загруженная партия остаётся
    // отдельной строкой, даже если в ней встретился тот же артикул/та же позиция, что уже сохранена
    // раньше (например, нашли ещё один такой же товар в другом месте магазина, отдельным листом) —
    // раньше количество молча суммировалось В ту же строку, и по отчёту было не понять, что нашли
    // в каком заходе. Если внутри ОДНОЙ партии (несколько вставленных подряд, ещё не сохранённых
    // страниц) один и тот же артикул встретился дважды — та сумма по-прежнему считается (см.
    // buildMerged/invImpParse), это внутренняя логика одной загрузки, а не разных заходов.
    showToast('⏳ Добавляю в начатую инвентаризацию...');
    db.collection('iz_inventory_counts').where('sessionId','==',targetId).get({source:'server'}).then(function(snap){
      var existingKeys = {}, maxSeq = -1;
      snap.forEach(function(d){ var data = d.data(); existingKeys[String(d.id).replace(targetId+'_','')] = true; if(typeof data.seq==='number' && data.seq>maxSeq) maxSeq = data.seq; });
      var merged = buildMerged(targetId, maxSeq+1);
      var batchSuffix = '_b'+Date.now();
      var renamed = {};
      Object.keys(merged).forEach(function(k){
        var finalKey = existingKeys[k] ? (k+batchSuffix) : k;
        merged[k].itemKey = finalKey;
        renamed[finalKey] = merged[k];
      });
      merged = renamed;
      var extraOps = [];
      if(parallel) extraOps.push(db.collection('iz_inventory_sessions').doc(targetId).set({parallelSales:true},{merge:true}));
      var w = writeCounts(targetId, merged, extraOps);
      return Promise.all(w.ops).then(function(){ finish(w.count, _iaDateRu(date), targetId); });
    }).catch(function(err){ showToast('❌ Не удалось сохранить: '+(err&&err.message||err)); });
    return;
  }
  var sid = uid();
  var sessionDoc = {id:sid, shopName:shop, goodsType:gt, startedAt:now, startedBy:who, status:'completed', completedAt:now, completedBy:who, mode:'import',
    snapshot:{}, inventoryDate:date, parallelSales:parallel, backdated:date<ts, importedBy:(session&&(session.name||session.sellerName))||'admin'};
  var merged2 = buildMerged(sid);
  var w2 = writeCounts(sid, merged2, [db.collection('iz_inventory_sessions').doc(sid).set(sessionDoc)]);
  showToast('⏳ Сохраняю...');
  Promise.all(w2.ops).then(function(){ finish(w2.count, _iaDateRu(date), sid); })
  .catch(function(err){ showToast('❌ Не удалось сохранить: '+(err&&err.message||err)); });
}
