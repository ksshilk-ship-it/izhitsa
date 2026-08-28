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
var _invNewGoodsType = 'derevo';
var _invReportRows = {};      // itemKey -> row shown in отчёт (используется кнопками "Применить")
var _invPendingMode = 'checklist'; // 'checklist' | 'freeform' — выбор режима перед стартом нового пересчёта
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
    newBtns += '<div style="font-size:11px;color:#8888aa;margin-bottom:6px">Как считать:</div>'+
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
  _invSession = {id:id, shopName:session.shopName, goodsType:goodsType, startedAt:new Date().toISOString(), startedBy:(session.sellerName||session.name||'—'), status:'active', mode:_invPendingMode, snapshot:snapshot};
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
function _invEnterCount(){
  _invSearch = '';
  var se = document.getElementById('invSearch');
  if(se){
    se.value = '';
    se.placeholder = (_invSession.mode==='freeform') ? '🔍 Артикул или название — найти и занести' : '🔍 Поиск по названию/артикулу/породе';
  }
  var af = document.getElementById('invAddForm'); if(af) af.style.display = 'none';
  var sugg = document.getElementById('invFfSugg'); if(sugg){ sugg.style.display='none'; sugg.innerHTML=''; }
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
  var total = Object.keys(_invSession.snapshot).length;
  var done = Object.keys(_invCounts).filter(function(k){ return _invSession.snapshot[k] && !_invCounts[k].isNew; }).length;
  var newCount = Object.keys(_invCounts).filter(function(k){ return _invCounts[k].isNew; }).length;
  el.innerHTML = '<div style="font-size:13px;font-weight:700">'+(_invSession.goodsType==='dr'?'🛍 ДР Товар':'🌳 Дерево')+' · '+_invSession.shopName+'</div>'+
    '<div style="font-size:11px;color:#8888aa;margin-top:2px">Посчитано '+done+' из '+total+(newCount?' · +'+newCount+' новых (не было в системе)':'')+'</div>';
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
    return '<div style="border:1px solid #60f09055;background:#0f1a12;border-radius:10px;padding:9px 10px;margin-bottom:6px">'+
      '<div style="font-size:12px;font-weight:700;margin-bottom:6px">'+(it.num?'№'+it.num+' ':'')+(it.name||'—')+(it.species?' <span style="color:#f0c060;font-weight:400">· '+it.species+'</span>':'')+(it.isNew?' <span style="color:#f0c060;font-size:10px">(нов.)</span>':'')+'</div>'+
      '<div style="display:flex;gap:6px;align-items:center">'+
        '<button type="button" onclick="invFfAdjustQty(\''+safeKey+'\',-1)" style="width:32px;height:32px;border-radius:8px;border:1px solid #2e2e3e;background:#22222e;color:#f0f0f8;font-size:16px;font-weight:700;cursor:pointer">−</button>'+
        '<div style="flex:1;text-align:center;font-size:14px;font-weight:700">'+it.countedQty+'</div>'+
        '<button type="button" onclick="invFfAdjustQty(\''+safeKey+'\',1)" style="width:32px;height:32px;border-radius:8px;border:1px solid #2e2e3e;background:#22222e;color:#f0f0f8;font-size:16px;font-weight:700;cursor:pointer">+</button>'+
        '<button type="button" onclick="invFfRemoveCount(\''+safeKey+'\')" style="padding:8px 10px;border-radius:8px;border:1px solid #f0606055;background:transparent;color:#f06060;font-size:12px;cursor:pointer;flex-shrink:0">✕</button>'+
      '</div>'+
    '</div>';
  }).join('');
}
function invFfAdjustQty(key, delta){
  var it = _invCounts[key]; if(!it) return;
  it.countedQty = Math.max(0, (it.countedQty||0)+delta);
  it.countedAt = new Date().toISOString();
  it.countedBy = session.sellerName||session.name||'—';
  try{
    db.collection('iz_inventory_counts').doc(_invSession.id+'_'+key).set(it)
      .catch(function(){ showToast('⚠️ Не отправилось в облако'); });
  }catch(e){}
  _invRenderCountHeader();
  _invRenderFreeformTally();
}
function invFfRemoveCount(key){
  if(!confirm('Убрать эту позицию из пересчёта?')) return;
  delete _invCounts[key];
  try{ db.collection('iz_inventory_counts').doc(_invSession.id+'_'+key).delete(); }catch(e){}
  _invRenderCountHeader();
  _invRenderFreeformTally();
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
      '<div class="fg" style="margin-bottom:6px"><label class="fl">Название</label><input class="fi" id="invEcName_'+safeKey+'" value="'+_invEsc(it.name)+'" style="margin:0;padding:7px"></div>'+
      '<div class="fg" style="margin-bottom:6px"><label class="fl">Порода / характеристика</label><input class="fi" id="invEcSpecies_'+safeKey+'" value="'+_invEsc(it.species)+'" style="margin:0;padding:7px"></div>'+
      '<div class="fg" style="margin-bottom:8px"><label class="fl">Цена ₽</label><input class="fi" type="text" inputmode="numeric" id="invEcPrice_'+safeKey+'" value="'+(it.price||0)+'" style="margin:0;padding:7px"></div>'+
      '<button type="button" onclick="invSaveCharacteristics(\''+safeKey+'\','+(isNew?'true':'false')+')" style="width:100%;padding:8px;background:#60c8f0;border:none;border-radius:8px;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer">💾 Сохранить характеристики</button>'+
    '</div>' : '')+
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
  _invCounts[key] = rec;
  try{
    db.collection('iz_inventory_counts').doc(_invSession.id+'_'+key).set(rec)
      .catch(function(){ showToast('⚠️ Сохранено на устройстве, но не отправилось в облако — проверьте связь'); });
  }catch(e){}
  _invRenderCountHeader();
  renderInvCountList();
}
function invToggleAddForm(){
  var f = document.getElementById('invAddForm');
  if(!f) return;
  var show = f.style.display==='none';
  f.style.display = show ? 'block' : 'none';
  if(show){
    ['invNewNum','invNewName','invNewSpecies','invNewPrice','invNewQty'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
    invSetNewGoodsType(_invSession?_invSession.goodsType:'derevo');
  }
}
function invSetNewGoodsType(t){
  _invNewGoodsType = t;
  var bd=document.getElementById('invNewTypeDerevo'), br=document.getElementById('invNewTypeDr');
  if(bd){ bd.style.borderColor=t==='derevo'?'#c8f060':'#2e2e3e'; bd.style.background=t==='derevo'?'#1e2a14':'#22222e'; bd.style.color=t==='derevo'?'#c8f060':'#8888aa'; }
  if(br){ br.style.borderColor=t==='dr'?'#a060f0':'#2e2e3e'; br.style.background=t==='dr'?'#1e1a2e':'#22222e'; br.style.color=t==='dr'?'#a060f0':'#8888aa'; }
}
function invSaveNewItem(){
  var name = (gv('invNewName')||'').trim();
  if(!name){ showToast('Введите название'); return; }
  var num = (gv('invNewNum')||'').trim();
  var price = parseFloat(gv('invNewPrice'))||0;
  var species = (gv('invNewSpecies')||'').trim();
  var qty = parseFloat(gv('invNewQty'));
  if(isNaN(qty) || qty<0){ showToast('Введите найденное количество'); return; }
  if(_invSession.goodsType!==_invNewGoodsType){
    showToast('Этот пересчёт — для '+(_invSession.goodsType==='dr'?'ДР Товара':'Дерева')+'. Товар другого типа добавьте в соответствующей инвентаризации.');
    return;
  }
  var key = num || _noArticleStockKey(name, price, species, _invNewGoodsType) || ('new_'+uid());
  var collidesWithSnapshot = !!_invSession.snapshot[key];
  if(collidesWithSnapshot){
    // Совпало с уже существующей позицией (по артикулу либо по имени+цене+породе) — это не
    // новый товар, а обычный пересчёт существующей строки, иначе в отчёте она задвоится:
    // один раз как расхождение с системой, второй раз как "излишек" на всё найденное количество.
    showToast('Такая позиция уже есть в списке выше — записала количество туда');
  }
  var rec = {
    sessionId:_invSession.id, itemKey:key,
    num:num||'', name:name, price:price, species:species, size:'', goodsType:_invNewGoodsType,
    countedQty:qty, countedBy:(session.sellerName||session.name||'—'), countedAt:new Date().toISOString(),
    isNew: !collidesWithSnapshot
  };
  _invCounts[key] = rec;
  try{
    db.collection('iz_inventory_counts').doc(_invSession.id+'_'+key).set(rec)
      .catch(function(){ showToast('⚠️ Сохранено на устройстве, но не отправилось в облако'); });
  }catch(e){}
  invToggleAddForm();
  _invRenderCountHeader();
  renderInvCountList();
  showToast('✅ Добавлено: '+name);
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
  closeMo('invStockMo');
  showToast('✅ Инвентаризация завершена');
  _invSession = null; _invCounts = {}; _invReportRows = {};
}
function invCloseModal(){
  if(_invSession && _invSession.status==='active'){
    showToast('Пересчёт сохранён — можно продолжить позже через «Инвентаризация»');
  }
  closeMo('invStockMo');
}
