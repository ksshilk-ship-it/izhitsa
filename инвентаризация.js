// ===== Инвентаризация склада =====
// Идея: "ожидаемый" остаток фиксируется снимком в момент старта (чтобы продажи по ходу
// пересчёта не сдвигали цель), пересчёт — слепой (без показа ожидаемого количества, чтобы
// не подгонять цифру под то, что "должно быть"), каждая посчитанная позиция — своя запись в
// облаке (а не один общий документ), поэтому два человека могут считать одновременно, не
// затирая друг друга. Исправления (излишек/недостача) применяются как обычные записи в
// журнал смены — списание/приход — а не прямой правкой остатка, иначе rebuildStock() при
// следующем пересчёте всё равно откатит их к прежним цифрам.
var _invSession = null;       // {id, shopName, goodsType, startedAt, startedBy, status, snapshot:{key:{...}}}
var _invCounts = {};          // itemKey -> {sessionId,itemKey,num,name,price,species,size,goodsType,countedQty,countedBy,countedAt,isNew,applied}
var _invActiveSessions = [];
var _invSearch = '';
var _invNewGoodsType = 'derevo';
var _invReportRows = {};      // itemKey -> row shown in отчёт (используется кнопками "Применить")

function openInventoryModal(){
  if(!session || !session.shopName || session.shopName==='Все магазины'){
    showToast('Откройте смену в конкретном магазине, чтобы провести инвентаризацию');
    return;
  }
  openMo('invMo');
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
  if(!startedTypes.derevo) newBtns += '<button type="button" onclick="invStartSession(\'derevo\')" style="width:100%;padding:11px;margin-bottom:8px;background:#1e2a14;border:2px solid #c8f060;border-radius:10px;color:#c8f060;font-size:13px;font-weight:700;cursor:pointer">🌳 Начать — Дерево</button>';
  if(!startedTypes.dr) newBtns += '<button type="button" onclick="invStartSession(\'dr\')" style="width:100%;padding:11px;margin-bottom:8px;background:#1e1a2e;border:2px solid #a060f0;border-radius:10px;color:#a060f0;font-size:13px;font-weight:700;cursor:pointer">🛍 Начать — ДР Товар</button>';
  c.innerHTML = (resumeHtml ? '<div style="font-size:11px;color:#8888aa;margin-bottom:6px">Незавершённые пересчёты в этом магазине:</div>'+resumeHtml+'<div style="height:8px"></div>' : '') +
    (newBtns ? newBtns : '<div style="font-size:11px;color:#8888aa">Все виды товара уже считаются — продолжите один из пересчётов выше.</div>');
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
  _invSession = {id:id, shopName:session.shopName, goodsType:goodsType, startedAt:new Date().toISOString(), startedBy:(session.sellerName||session.name||'—'), status:'active', snapshot:snapshot};
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
  var se = document.getElementById('invSearch'); if(se) se.value = '';
  var af = document.getElementById('invAddForm'); if(af) af.style.display = 'none';
  _invShowStep('count');
  _invRenderCountHeader();
  renderInvCountList();
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
function _invRenderRow(key, it, isNew){
  var counted = _invCounts[key];
  var borderColor = counted ? '#60f09055' : '#2e2e3e';
  var bg = counted ? '#0f1a12' : '#13131a';
  var safeKey = key.replace(/'/g,"\\'");
  return '<div style="border:1px solid '+borderColor+';background:'+bg+';border-radius:10px;padding:9px 10px;margin-bottom:6px">'+
    '<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px">'+
      '<div style="font-size:12px;font-weight:700">'+(it.num?'№'+it.num+' ':'')+(it.name||'—')+(it.species?' <span style="color:#f0c060;font-weight:400">· '+it.species+'</span>':'')+'</div>'+
      (counted ? '<div style="font-size:14px;flex-shrink:0">✅</div>' : '')+
    '</div>'+
    '<div style="display:flex;gap:6px;align-items:center">'+
      '<input class="fi" type="number" inputmode="decimal" id="invQty_'+safeKey+'" placeholder="Кол-во" value="'+(counted?counted.countedQty:'')+'" style="flex:1;margin:0;padding:8px" min="0">'+
      '<button type="button" onclick="invSaveCount(\''+safeKey+'\','+(isNew?'true':'false')+')" style="padding:8px 14px;background:#c8f060;border:none;border-radius:8px;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0">Сохранить</button>'+
    '</div>'+
    (counted ? '<div style="font-size:10px;color:#8888aa;margin-top:4px">'+(counted.countedBy||'—')+' · '+(counted.countedAt?counted.countedAt.slice(11,16):'')+'</div>' : '')+
  '</div>';
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
  _invApplyRowReal(row);
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
  rows.forEach(function(r){ _invApplyRowReal(r); });
}
function _invApplyRowReal(row){
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
    try{ stockApplyReceive(session.shopName, [{num:item.num, name:item.name, price:item.price, qty:item.qty, species:item.species, goodsType:_invSession.goodsType}], ts.split('T')[0], _invSession.goodsType, false); }catch(e){}
  }
  journal.push(entry);
  try{ _recordJournalEntryIndependently(entry, session.shopName, entry.type); }catch(e){}
  _backupCheckPassed = false;
  saveJ(); renderAll();
  row.applied = true;
  var countKey = row.key;
  if(_invCounts[countKey]){
    _invCounts[countKey].applied = true;
    try{ db.collection('iz_inventory_counts').doc(_invSession.id+'_'+countKey).set(_invCounts[countKey], {merge:true}); }catch(e){}
  }
  _invRenderReport();
  showToast('✅ '+(row.diff<0?'Списание':'Приход')+' добавлен в смену');
}
function invFinalizeSession(){
  if(!_invSession) return;
  if(!confirm('Завершить инвентаризацию? Досчитать позже будет нельзя — можно будет только посмотреть итог в истории.')) return;
  _invSession.status = 'completed';
  _invSession.completedAt = new Date().toISOString();
  _invSession.completedBy = session.sellerName||session.name||'—';
  try{ db.collection('iz_inventory_sessions').doc(_invSession.id).set(_invSession); }catch(e){}
  closeMo('invMo');
  showToast('✅ Инвентаризация завершена');
  _invSession = null; _invCounts = {}; _invReportRows = {};
}
function invCloseModal(){
  if(_invSession && _invSession.status==='active'){
    showToast('Пересчёт сохранён — можно продолжить позже через «Инвентаризация»');
  }
  closeMo('invMo');
}
