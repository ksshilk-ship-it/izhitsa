var _editSaleEntryId = null;
var _svArchiveEditId = null;
function deleteJournalEntryShop(id){
  var entry = journal.find(function(e){ return e.id===id; });
  if(!entry){ return; }
  var label = entry.label || entry.type;
  if(!confirm('Удалить запись "'+label+'"'+(entry.amount?' ('+fmt(entry.amount)+')':'')+'? Запись будет перемещена в корзину на 7 дней.')) return;
  logEntryDelete(entry);
  journal = journal.filter(function(e){ return e.id!==id; });
  addToTrash(entry);
  saveJ(); renderAll();
  syncLiveShift();
  showToast('🗑 Перемещено в корзину');
}
function editJournalSale(id){
  var entry = journal.find(function(e){ return e.id===id; });
  if(!entry){ showToast('Запись не найдена'); return; }
  openMo('saleMo');
  resetSaleForm();
  _editSaleEntryId = id;
  var mt = document.querySelector('#saleMo .mt'); if(mt) mt.textContent = '✏️ Редактирование продажи';
  saleItems = (entry.items||[]).map(function(it){ return Object.assign({}, it, {id:uid()}); });
  renderSaleItems(); calcSaleTotal();
  if(entry.discount){
    setDiscType('sum');
    var di=document.getElementById('discInput'); if(di) di.value=entry.discount;
    var sd=document.getElementById('saleDiscount'); if(sd) sd.value=entry.discount;
  }
  setDiscCategory(entry.discCategory||'derevo');
  var pmEl = document.querySelector('#saleMo .pc[onclick*="\''+(entry.payMethod||'cash')+'\'"]');
  setPayM(entry.payMethod||'cash', pmEl||document.querySelector('#saleMo .pc'));
  if(entry.payMethod==='mixed'){
    var mc=document.getElementById('mixCash'); if(mc) mc.value=entry.cashPart||'';
    var mcr=document.getElementById('mixCard'); if(mcr) mcr.value=entry.cardPart||'';
  }
  if(entry.comment){ var ce=document.getElementById('saleComment'); if(ce) ce.value=entry.comment; }
  calcSaleTotal();
  var modal = document.getElementById('saleMo');
  if(modal){
    var existingDel = modal.querySelector('.sale-edit-del-btn');
    if(existingDel) existingDel.remove();
    var delBtn = document.createElement('button');
    delBtn.className = 'btn red sale-edit-del-btn';
    delBtn.style.marginTop = '8px';
    delBtn.textContent = '🗑 Удалить эту продажу';
    delBtn.onclick = function(){ closeMo('saleMo'); resetSaleForm(); _editSaleEntryId=null; deleteJournalEntryShop(id); };
    var md = modal.querySelector('.md');
    if(md) md.appendChild(delBtn);
  }
}
var _svArchiveAddMode = false;
function svAddSaleToArchive(){
  if(!_currentShiftView) return;
  openMo('saleMo');
  resetSaleForm();
  _svArchiveEditId = null;
  _svArchiveAddMode = true;
  var mt = document.querySelector('#saleMo .mt'); if(mt) mt.textContent = '➕ Добавить пропущенную продажу';
}
function svEditSale(idx){
  if(!_currentShiftView) return;
  var sales = (_currentShiftView.journal||[]).filter(function(e){ return e.type==='sale'; });
  var entry = sales[idx]; if(!entry){ showToast('Запись не найдена'); return; }
  openMo('saleMo');
  resetSaleForm();
  _svArchiveEditId = entry.id;
  var mt = document.querySelector('#saleMo .mt'); if(mt) mt.textContent = '✏️ Редактирование продажи (архив)';
  saleItems = (entry.items||[]).map(function(it){ return Object.assign({}, it, {id:uid()}); });
  renderSaleItems(); calcSaleTotal();
  if(entry.discount){
    setDiscType('sum');
    var di=document.getElementById('discInput'); if(di) di.value=entry.discount;
    var sd=document.getElementById('saleDiscount'); if(sd) sd.value=entry.discount;
  }
  setDiscCategory(entry.discCategory||'derevo');
  var pmEl = document.querySelector('#saleMo .pc[onclick*="\''+(entry.payMethod||'cash')+'\'"]');
  setPayM(entry.payMethod||'cash', pmEl||document.querySelector('#saleMo .pc'));
  if(entry.payMethod==='mixed'){
    var mc=document.getElementById('mixCash'); if(mc) mc.value=entry.cashPart||'';
    var mcr=document.getElementById('mixCard'); if(mcr) mcr.value=entry.cardPart||'';
  }
  if(entry.comment){ var ce=document.getElementById('saleComment'); if(ce) ce.value=entry.comment; }
  calcSaleTotal();
  var modal = document.getElementById('saleMo');
  if(modal){
    var existingDel = modal.querySelector('.sale-edit-del-btn');
    if(existingDel) existingDel.remove();
    var delBtn = document.createElement('button');
    delBtn.className = 'btn red sale-edit-del-btn';
    delBtn.style.marginTop = '8px';
    delBtn.textContent = '🗑 Удалить эту продажу';
    delBtn.onclick = function(){ closeMo('saleMo'); resetSaleForm(); _svArchiveEditId=null; svDeleteJEntry('sale', idx); };
    var md = modal.querySelector('.md');
    if(md) md.appendChild(delBtn);
  }
}
let currentInvId = null, invCheckState = [];
let currentLookupItem = null;
let currentEditShiftId = null;
let blockSellerAction = null;
function getShifts(){
  try{ return JSON.parse(localStorage.getItem(KEY.shifts)||'[]'); }catch(e){ return []; }
}
function saveShifts(shifts){
  localStorage.setItem(KEY.shifts, JSON.stringify(shifts));
}
var TRASH_RETENTION_DAYS = 7;
function getShiftTombstones(){
  try{ return JSON.parse(localStorage.getItem(KEY.shiftTombstones)||'[]'); }catch(e){ return []; }
}
function addShiftTombstone(id){
  if(!id) return;
  var t = getShiftTombstones();
  if(t.indexOf(id)===-1){ t.push(id); localStorage.setItem(KEY.shiftTombstones, JSON.stringify(t)); }
  try{ db.collection('iz_shift_tombstones').doc(id).set({deletedAt:new Date().toISOString(), by:(session&&session.name)||'Admin'}); }catch(e){}
}
function pullShiftTombstonesFromCloud(cb){
  try{
    db.collection('iz_shift_tombstones').get({source:'server'}).then(function(snap){
      var remoteIds = []; snap.forEach(function(d){ remoteIds.push(d.id); });
      var local = getShiftTombstones();
      var merged = local.slice();
      remoteIds.forEach(function(id){ if(merged.indexOf(id)===-1) merged.push(id); });
      localStorage.setItem(KEY.shiftTombstones, JSON.stringify(merged));
      if(cb) cb(merged);
    }).catch(function(){ if(cb) cb(getShiftTombstones()); });
  }catch(e){ if(cb) cb(getShiftTombstones()); }
}
function getTrash(){
  try{ return JSON.parse(localStorage.getItem(KEY.trash)||'[]'); }catch(e){ return []; }
}
function saveTrash(items){ localStorage.setItem(KEY.trash, JSON.stringify(items)); }
function purgeExpiredTrash(items){
  var cutoff = Date.now() - TRASH_RETENTION_DAYS*86400000;
  return items.filter(function(t){ return new Date(t.deletedAt).getTime() > cutoff; });
}
function addToTrash(entry, meta){
  var t = purgeExpiredTrash(getTrash());
  if(t.some(function(x){ return x.entry && x.entry.id===entry.id; })) { saveTrash(t); return; }
  var cleanMeta = Object.assign({}, meta); delete cleanMeta.deletedByOverride;
  t.unshift(Object.assign({
    trashId: uid(), entry: entry, deletedAt: new Date().toISOString(),
    deletedBy: (meta&&meta.deletedByOverride) || (session&&session.sellerName)||'—',
    shopName: (session&&session.shopName)||(meta&&meta.shopName)||'—',
    shiftId: (session&&session.shiftId)||(meta&&meta.shiftId)||null
  }, cleanMeta));
  saveTrash(t);
  try{ syncTrashToCloud(t); }catch(e){}
}
function getTombstones(){
  return purgeExpiredTrash(getTrash()).map(function(t){ return t.entry && t.entry.id; }).filter(Boolean);
}
function clearTombstones(){
}
function restoreFromTrash(trashId){
  var t = getTrash();
  var idx = t.findIndex(function(x){ return x.trashId===trashId; });
  if(idx<0){ showToast('Запись не найдена в корзине'); return; }
  var item = t[idx];
  if(!confirm('Восстановить запись "'+(item.entry.label||item.entry.type)+'"?')) return;
  var restored = false;
  if(session && session.shiftId === item.shiftId){
    journal.push(item.entry);
    journal.sort(function(a,b){ return (a.ts||'').localeCompare(b.ts||''); });
    saveJ(); renderAll();
    syncLiveShift();
    restored = true;
  } else if(_currentShiftView && _currentShiftView.id === item.shiftId){
    _currentShiftView.journal = (_currentShiftView.journal||[]).concat([item.entry])
      .sort(function(a,b){ return (a.ts||'').localeCompare(b.ts||''); });
    svPersist();
    _renderShiftView();
    restored = true;
  } else {
    showToast('Смена сейчас не открыта здесь — запись будет восстановлена при следующей синхронизации этой смены');
  }
  t.splice(idx,1);
  saveTrash(t);
  try{ syncTrashToCloud(t); }catch(e){}
  renderTrash();
  if(restored) showToast('♻️ Запись восстановлена');
}
function purgeFromTrashForever(trashId){
  if(!confirm('Удалить запись из корзины навсегда? Восстановить её будет невозможно.')) return;
  var t = getTrash().filter(function(x){ return x.trashId!==trashId; });
  saveTrash(t);
  try{ syncTrashToCloud(t); }catch(e){}
  renderTrash();
  showToast('🗑 Удалено навсегда');
}
function syncTrashToCloud(items){
  try{ db.collection('iz_settings').doc('shop_trash').set({data: items.slice(0,500), updatedAt:new Date().toISOString()}); }catch(e){}
}
function pullTrashFromCloud(cb){
  try{
    db.collection('iz_settings').doc('shop_trash').get().then(function(snap){
      if(snap.exists && Array.isArray(snap.data().data)){
        var remote = snap.data().data;
        var local = getTrash();
        var localIds = {}; local.forEach(function(t){ localIds[t.trashId]=true; });
        var merged = local.slice();
        remote.forEach(function(t){ if(!localIds[t.trashId]) merged.push(t); });
        merged = purgeExpiredTrash(merged);
        saveTrash(merged);
      }
      if(cb) cb();
    }).catch(function(){ if(cb) cb(); });
  }catch(e){ if(cb) cb(); }
}
function renderTrash(){
  var c = document.getElementById('trashList'); if(!c) return;
  pullTrashFromCloud(function(){
    var items = purgeExpiredTrash(getTrash());
    if(getTrash().length !== items.length){ saveTrash(items); try{ syncTrashToCloud(items); }catch(e){} }
    if(!items.length){
      c.innerHTML = '<div class="empty"><div class="ei">🗑</div>Корзина пуста</div>';
      return;
    }
    c.innerHTML = items.map(function(t){
      var e = t.entry||{};
      var daysLeft = Math.max(0, TRASH_RETENTION_DAYS - Math.floor((Date.now()-new Date(t.deletedAt).getTime())/86400000));
      return '<div class="card" style="border-color:#3e2e2e">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
          '<div style="flex:1">'+
            '<div class="u-fs13-bold">'+(e.label||e.type||'Запись')+'</div>'+
            (e.sub?'<div style="font-size:11px;color:#8888aa;margin-top:2px">'+e.sub+'</div>':'')+
            '<div style="font-size:10px;color:#555568;margin-top:4px">🏪 '+t.shopName+' · 🗑 '+t.deletedBy+' · '+new Date(t.deletedAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</div>'+
            '<div style="font-size:10px;color:#f0a060;margin-top:2px">⏳ Осталось '+daysLeft+' дн. до окончательного удаления</div>'+
          '</div>'+
          (e.amount?'<div style="font-size:14px;font-weight:700;color:#8888aa;margin-left:8px">'+fmt(e.amount)+'</div>':'')+
        '</div>'+
        '<div style="display:flex;gap:8px;margin-top:10px">'+
          '<button onclick="restoreFromTrash(\''+t.trashId+'\')" style="flex:1;padding:8px;border-radius:9px;border:1px solid #c8f060;background:#1e2a14;color:#c8f060;font-size:11px;font-weight:700;cursor:pointer">♻️ Восстановить</button>'+
          '<button onclick="purgeFromTrashForever(\''+t.trashId+'\')" style="flex:1;padding:8px;border-radius:9px;border:1px solid #f06060;background:#2e1a1a;color:#f06060;font-size:11px;font-weight:700;cursor:pointer">🗑 Навсегда</button>'+
        '</div>'+
      '</div>';
    }).join('');
  });
}
function _clearShiftPendingFlag(shiftId){
  try{
    var shifts = getShifts();
    var idx = shifts.findIndex(function(s){ return (s.id||s._id)===shiftId; });
    if(idx>=0 && shifts[idx]._pendingSync){
      delete shifts[idx]._pendingSync;
      saveShifts(shifts);
    }
  }catch(e){}
  _checkPendingCloseBanner();
}
function _markPendingCloseWarning(shopName, date){
  try{ localStorage.setItem('iz_pending_close_warning', JSON.stringify({shopName:shopName, date:date, ts:Date.now()})); }catch(e){}
  _checkPendingCloseBanner();
}
function _checkPendingCloseBanner(){
  try{
    var raw = localStorage.getItem('iz_pending_close_warning');
    var el = document.getElementById('connStatusBanner');
    if(!raw){ return; }
    var w = JSON.parse(raw);
    var shifts = getShifts();
    var stillPending = shifts.some(function(s){ return s.shopName===w.shopName && s.date===w.date && s._pendingSync; });
    if(!stillPending){
      localStorage.removeItem('iz_pending_close_warning');
      return;
    }
    if(el && navigator.onLine!==false){
      _retryPendingShiftSyncs();
    }
    if(el){
      el.style.display='flex';
      el.style.background='#2e1a14';
      el.style.borderColor='#f0a060';
      el.innerHTML='<span style="color:#f0a060;font-size:12px">⚠️ Смена «'+w.shopName+' · '+w.date+'» закрыта, но ещё не сохранена в облаке. Не закрывайте это приложение на этом телефоне без интернета.</span>';
    }
  }catch(e){}
}
setInterval(_checkPendingCloseBanner, 30000);
document.addEventListener('visibilitychange', function(){ if(document.visibilityState==='visible'){ _checkPendingCloseBanner(); _retryPendingSales(); _retryPendingJournalEntries(); _retryPendingRefbookSaves(); _retryPendingInvoices(); } });
function _pushShiftWithRetry(shiftId, data){
  if(!shiftId || !data) return;
  try{
    db.collection('iz_shifts').doc(shiftId).get({source:'server'}).then(function(snap){
      if(snap.exists){
        var remote = snap.data();
        var remoteJnl = remote.journal||[];
        var localJnl = data.journal||[];
        var localIds = {}; localJnl.forEach(function(e){ if(e.id) localIds[e.id]=true; });
        var deletedIds = {}; getTombstones().forEach(function(id){ deletedIds[id]=true; });
        var missingFromServer = remoteJnl.filter(function(e){ return e.id && !localIds[e.id] && !deletedIds[e.id]; });
        if(missingFromServer.length){
          var merged = localJnl.concat(missingFromServer);
          merged.sort(function(a,b){ return (a.ts||'').localeCompare(b.ts||''); });
          data = Object.assign({}, data, {journal: merged});
          var shifts2 = getShifts();
          var idx2 = shifts2.findIndex(function(s){ return (s.id||s._id)===shiftId; });
          if(idx2>=0){ shifts2[idx2] = data; saveShifts(shifts2); }
        }
      }
      db.collection('iz_shifts').doc(shiftId).set(data).then(function(){
        _clearShiftPendingFlag(shiftId);
      }).catch(function(err){
        console.log('[_pushShiftWithRetry] не удалось, останется в очереди на повтор:', shiftId, err);
      });
    }).catch(function(err){
      console.log('[_pushShiftWithRetry] не удалось проверить сервер, попробуем позже:', shiftId, err);
    });
  }catch(e){}
}
function _retryPendingShiftSyncs(){
  try{
    if(typeof firebase==='undefined' || !navigator.onLine) return;
    var shifts = getShifts();
    var pending = shifts.filter(function(s){ return s._pendingSync; });
    if(!pending.length) return;
    console.log('[_retryPendingShiftSyncs] повторная отправка смен:', pending.length);
    pending.forEach(function(s){
      var clean = Object.assign({}, s); delete clean._pendingSync;
      _pushShiftWithRetry(s.id||s._id, clean);
    });
  }catch(e){}
}
function _verifyRecentClosedShifts(){
  try{
    if(typeof db==='undefined' || !db || !navigator.onLine) return;
    var shifts = getShifts();
    var cutoff = Date.now() - 3*86400000; // последние 3 дня — не грузим облако проверкой всей истории
    var candidates = shifts.filter(function(s){
      if(!s.id || s.status!=='closed' || s._pendingSync) return false;
      var closedTime = s.closedAt ? new Date(s.closedAt).getTime() : 0;
      return closedTime > cutoff;
    });
    candidates.forEach(function(s){
      db.collection('iz_shifts').doc(s.id).get({source:'server'}).then(function(snap){
        var localLen = (s.journal||[]).length;
        var remoteLen = snap.exists ? ((snap.data().journal||[]).length) : -1;
        if(remoteLen < localLen){
          console.log('[_verifyRecentClosedShifts] досылаю смену, которой не было в облаке:', s.id);
          db.collection('iz_shifts').doc(s.id).set(s).catch(function(){});
        }
      }).catch(function(){});
    });
  }catch(e){}
}
_retryPendingShiftSyncs();
_verifyRecentClosedShifts();
_retryPendingSales();
_retryPendingJournalEntries();
_retryPendingRefbookSaves();
_retryPendingInvoices();
_retryPendingShiftBackups();
_retryPendingInvoiceBackups();
_checkPendingCloseBanner();
setInterval(_retryPendingShiftSyncs, 45000);
setInterval(_retryPendingSales, 45000);
setInterval(_retryPendingJournalEntries, 45000);
setInterval(_retryPendingRefbookSaves, 45000);
setInterval(_retryPendingInvoices, 45000);
setInterval(_retryPendingInvoiceBackups, 45000);
setInterval(_retryPendingShiftBackups, 45000);
window.addEventListener('online', function(){ setTimeout(_retryPendingShiftSyncs, 1500); setTimeout(_retryPendingSales, 1500); setTimeout(_retryPendingJournalEntries, 1500); setTimeout(_retryPendingRefbookSaves, 1500); setTimeout(_retryPendingInvoices, 1500); setTimeout(_retryPendingShiftBackups, 1500); });
var _liveShiftSyncTimer = null;
function buildLiveShiftDoc(){
  var t = calcTotals();
  return {
    id: session.shiftId, status:'open', source:'shop',
    shopName: session.shopName, sellerName: session.sellerName,
    date: new Date().toISOString().split('T')[0],
    openedAt: session.openedAt, updatedAt: new Date().toISOString(),
    cashMorning: session.cashMorning||0, goodsMorning: session.goodsMorning||0,
    cashDrMorning: session.cashDrMorning||0, goodsDrMorning: session.goodsDrMorning||0,
    cashStaffMorning: session.cashStaffMorning||0,
    cashCurrent: t.cash, cardCurrent: t.card, staffCurrent: t.staff,
    goodsCurrent: t.goods, cashDrCurrent: t.cashDr, goodsDrCurrent: t.goodsDr,
    revenue: t.revenue, discount: t.discount,
    hasCashDiff: journal.some(function(e){ return e.hasCashDiff; }),
    journal: journal.slice(),
    tombstones: getTombstones()
  };
}
var _shiftForceClosedRemotely = false;
var _liveSyncFailCount = 0;
var _liveSyncRetryTimer = null;
function _showLiveSyncFailBanner(){
  var el = document.getElementById('connStatusBanner');
  if(!el || !navigator.onLine) return; // офлайн уже показывает свой баннер — не перекрываем его
  el.style.display='flex';
  el.style.background='#2e1a14';
  el.style.borderColor='#f0a060';
  el.innerHTML='<span style="color:#f0a060;font-size:12px">⚠️ Продажи сохраняются только на телефоне — не получается отправить в облако. Держите приложение открытым при хорошем сигнале.</span>';
}
function _hideLiveSyncFailBanner(){
  if(_liveSyncFailCount===0) return;
  _liveSyncFailCount = 0;
  try{ if(typeof _renderConnStatus==='function') _renderConnStatus(); }catch(e){}
}
function _onLiveSyncFailed(){
  _liveSyncFailCount++;
  if(_liveSyncFailCount>=3) _showLiveSyncFailBanner();
  if(_liveSyncRetryTimer) clearTimeout(_liveSyncRetryTimer);
  var delay = Math.min(30000, 4000*_liveSyncFailCount); // нарастающая пауза, максимум 30 сек
  _liveSyncRetryTimer = setTimeout(function(){ syncLiveShift(); }, delay);
}
function syncLiveShift(){
  if(!session || session.isPreview) return;
  if(session.role==='shopadmin') return; // админ-сессия не ведёт свою смену — не должна пытаться её "живо" синхронизировать
  if(_shiftForceClosedRemotely) return;
  if(restoreMode) return;
  if(!journal || journal.length<=1) return; // length 1 = just the "Смена открыта" entry, nothing real yet
  if(!session.shiftId){ session.shiftId = uid(); saveS(); }
  if(getShiftTombstones().indexOf(session.shiftId)!==-1){
    _shiftForceClosedRemotely = true;
    try{ stopLiveShiftListener(); }catch(e){}
    showToast('🗑 Эта смена была удалена администратором. Откройте новую смену через "Выйти".');
    return;
  }
  if(_liveShiftSyncTimer) clearTimeout(_liveShiftSyncTimer);
  _liveShiftSyncTimer = setTimeout(function(){
    if(getShiftTombstones().indexOf(session.shiftId)!==-1) return; // повторная проверка на случай гонки
    var docRef = db.collection('iz_shifts').doc(session.shiftId);
    docRef.get().then(function(snap){
      if(snap.exists && snap.data().status==='closed'){
        _shiftForceClosedRemotely = true;
        try{ stopLiveShiftListener(); }catch(e){}
        return;
      }
      if(snap.exists) mergeRemoteJournal(snap.data());
      docRef.set(buildLiveShiftDoc()).then(function(){
        _hideLiveSyncFailBanner();
      }).catch(function(){ _onLiveSyncFailed(); });
    }).catch(function(){
      _onLiveSyncFailed();
    });
  }, 600);
}
function mergeRemoteJournal(remote){
  if(!remote || !Array.isArray(remote.journal)) return 0;
  var remoteTombstones = Array.isArray(remote.tombstones) ? remote.tombstones : [];
  var tombstoned = {};
  getTombstones().forEach(function(id){ tombstoned[id]=true; });
  remoteTombstones.forEach(function(id){ tombstoned[id]=true; });
  var beforeLen = journal.length;
  journal = journal.filter(function(e){ return !e.id || !tombstoned[e.id]; });
  var purged = beforeLen - journal.length;
  var localIds = {};
  journal.forEach(function(e){ if(e.id) localIds[e.id]=true; });
  var localReceiveInvIds = {};
  journal.forEach(function(e){ if(e.type==='receive' && e.invId) localReceiveInvIds[e.invId]=true; });
  var added = 0;
  var shiftOpenedAt = session && session.openedAt ? session.openedAt : null;
  remote.journal.forEach(function(e){
    if(!e.id || localIds[e.id]) return;
    if(tombstoned[e.id]) return; // was deliberately deleted on this or another device — never resurrect
    if(e.type==='receive' && e.invId && localReceiveInvIds[e.invId]) return; // already have this invoice's entry
    if(e.type==='receive' && shiftOpenedAt){
      var shiftDateStr = shiftOpenedAt.split('T')[0];
      if(e.ts){
        var eDateStr = e.ts.split('T')[0];
        if(eDateStr < shiftDateStr) return;
      }
    }
    journal.push(e); added++;
    if(e.type==='receive' && e.invId) localReceiveInvIds[e.invId]=true;
  });
  if(added>0 || purged>0){
    journal.sort(function(a,b){ return (a.ts||'').localeCompare(b.ts||''); });
    if(session && session.openedAt){
      var shiftDate = session.openedAt.split('T')[0];
      journal = journal.filter(function(e){
        if(e.type==='receive' && e.ts && e.ts.split('T')[0] < shiftDate) return false;
        return true;
      });
    }
    saveJ();
  }
  return added;
}
var _manualSyncing = false;
var _syncPressTimer = null;
var _syncLongPressed = false;
function forceSyncAllShiftsNow(){
  if(typeof db==='undefined' || !db){ showToast('Нет подключения к базе'); return; }
  var shifts = getShifts();
  var mine = shifts.filter(function(s){ return s.shopName===(session&&session.shopName); });
  if(!mine.length){ showToast('Нет сохранённых смен на этом устройстве'); return; }
  showToast('⏳ Отправляю '+mine.length+' смен(ы) в облако...');
  var done=0, total=mine.length, errors=0;
  mine.forEach(function(s){
    db.collection('iz_shifts').doc(String(s.id||s._id)).set(s,{merge:true}).then(function(){
      done++;
      if(done+errors===total) showToast(errors? ('⚠️ Отправлено: '+done+', ошибок: '+errors) : ('✅ Отправлено смен: '+done));
    }).catch(function(e){
      errors++;
      if(done+errors===total) showToast(errors? ('⚠️ Отправлено: '+done+', ошибок: '+errors) : ('✅ Отправлено смен: '+done));
    });
  });
}
function _syncPressStart(){
  _syncLongPressed = false;
  _syncPressTimer = setTimeout(function(){
    _syncLongPressed = true;
    forceSyncAllShiftsNow();
    if(confirm('Также полностью обновить приложение? Это перезагрузит страницу и подгрузит последнюю версию (данные смен не затрагивает).')) hardRefreshApp();
  }, 700);
}
function _syncPressEnd(){
  if(_syncPressTimer){ clearTimeout(_syncPressTimer); _syncPressTimer=null; }
}
function manualSync(){
  if(_syncLongPressed){ _syncLongPressed=false; return; } // long-press already handled separately
  if(!session || !session.shiftId){ showToast('Нет активной смены'); return; }
  if(_manualSyncing) return;
  _manualSyncing = true;
  checkForAppUpdate();
  var btn = document.getElementById('syncBtn');
  if(btn) btn.textContent = '⏳';
  if(_liveShiftSyncTimer){ clearTimeout(_liveShiftSyncTimer); _liveShiftSyncTimer=null; }
  var docRef = db.collection('iz_shifts').doc(session.shiftId);
  docRef.get()
    .then(function(snap){
      var remote = snap.exists ? snap.data() : null;
      var added = remote ? mergeRemoteJournal(remote) : 0;
      return docRef.set(buildLiveShiftDoc()).then(function(){ return added; });
    })
    .then(function(added){
      renderAll();
      if(added>0) showToast('🔄 Обновлено: добавлено '+added+' записей');
      else showToast('🔄 Данные актуальны');
    })
    .catch(function(err){
      showToast('⚠️ Не удалось обновить — проверьте связь');
    })
    .finally(function(){
      _manualSyncing = false;
      if(btn) btn.textContent = '🔄';
      syncLiveShift();
    });
}
var _liveShiftListenUnsub = null;
function startLiveShiftListener(){
  if(!session || session.isPreview) return;
  if(restoreMode) return; // restore shifts are local only
  if(!session.shiftId){ session.shiftId = uid(); saveS(); }
  stopLiveShiftListener();
  try{
    _liveShiftListenUnsub = db.collection('iz_shifts').doc(session.shiftId)
      .onSnapshot(function(snap){
        if(!snap.exists || !session) return;
        var remote = snap.data();
        if(remote.status==='closed' && session.shiftId===remote.id){
          _shiftForceClosedRemotely = true;
          stopLiveShiftListener();
          if(_liveShiftSyncTimer) clearTimeout(_liveShiftSyncTimer);
          showToast('🔐 Эта смена была закрыта администратором. Откройте новую смену через "Выйти".');
          return;
        }
        var added = mergeRemoteJournal(remote);
        if(added>0){
          renderAll();
          showToast('🔄 Новые записи синхронизированы');
        }
      }, function(){ /* offline / permission errors — ignore, manual sync still works */ });
  }catch(e){}
}
function stopLiveShiftListener(){
  if(_liveShiftListenUnsub){ try{ _liveShiftListenUnsub(); }catch(e){} _liveShiftListenUnsub=null; }
}
function refreshRecentClosedShiftsFromCloud(shopName){
  try{
    db.collection('iz_shifts').where('shopName','==',shopName).where('status','==','closed')
      .orderBy('openedAt','desc').limit(5).get({source:'server'}).then(function(snap){
        if(snap.empty) return;
        var local = getShifts();
        var byId = {}; local.forEach(function(s){ byId[String(s.id||s._id)]=s; });
        snap.forEach(function(doc){
          var d = doc.data(); var id = String(d.id||doc.id);
          byId[id] = Object.assign({}, d, {id:id});
        });
        saveShifts(Object.values(byId));
      }).catch(function(){});
  }catch(e){}
}
function exitShift(){
  if(restoreMode){
    if(!confirm('Выйти из режима восстановления? Незакрытая смена восстановления останется сохранённой — вернётесь к ней позже.')) return;
    exitRestoreMode();
    return;
  }
  const msg=(session&&session.role)==='shopadmin'?'Выйти из режима администратора?':'Выйти? Смена останется открытой.';
  if(confirm(msg)){
    stopLiveShiftListener();
    if((session&&session.role)==='shopadmin'){ localStorage.removeItem(KEY.session); session=null; }
    document.getElementById('mainTabs').style.display='none';
    document.getElementById('appScreen').style.display='none';
    document.getElementById('loginScreen').style.display='flex';
    pick('seller');
  }
}
var _goodsMornMode = 'auto';
var _goodsDrMode = 'auto';
function setGoodsMornMode(mode) {
  _goodsMornMode = mode;
  var ab=document.getElementById('goodsAutoBtn'), mb=document.getElementById('goodsManualBtn');
  var abl=document.getElementById('goodsAutoBlock'), mbl=document.getElementById('goodsManualBlock');
  if(mode==='auto') {
    if(ab){ab.style.borderWidth='2px';ab.style.borderColor='#f0c060';ab.style.background='#1a150a';ab.style.color='#f0c060';ab.style.fontWeight='700';}
    if(mb){mb.style.borderWidth='1px';mb.style.borderColor='#2e2e3e';mb.style.background='#22222e';mb.style.color='#8888aa';mb.style.fontWeight='400';}
    if(abl)abl.style.display='block'; if(mbl)mbl.style.display='none';
  } else {
    if(mb){mb.style.borderWidth='2px';mb.style.borderColor='#f0c060';mb.style.background='#1a150a';mb.style.color='#f0c060';mb.style.fontWeight='700';}
    if(ab){ab.style.borderWidth='1px';ab.style.borderColor='#2e2e3e';ab.style.background='#22222e';ab.style.color='#8888aa';ab.style.fontWeight='400';}
    if(mbl)mbl.style.display='block'; if(abl)abl.style.display='none';
  }
  checkMorningValid();
}
function setGoodsDrMode(mode) {
  _goodsDrMode = mode;
  var ab=document.getElementById('goodsDrAutoBtn'), mb=document.getElementById('goodsDrManualBtn');
  var abl=document.getElementById('goodsDrAutoBlock'), mbl=document.getElementById('goodsDrManualBlock');
  if(mode==='auto') {
    if(ab){ab.style.borderWidth='2px';ab.style.borderColor='#f060a0';ab.style.background='#1a0f1a';ab.style.color='#f060a0';ab.style.fontWeight='700';}
    if(mb){mb.style.borderWidth='1px';mb.style.borderColor='#2e2e3e';mb.style.background='#22222e';mb.style.color='#8888aa';mb.style.fontWeight='400';}
    if(abl)abl.style.display='block'; if(mbl)mbl.style.display='none';
  } else {
    if(mb){mb.style.borderWidth='2px';mb.style.borderColor='#f060a0';mb.style.background='#1a0f1a';mb.style.color='#f060a0';mb.style.fontWeight='700';}
    if(ab){ab.style.borderWidth='1px';ab.style.borderColor='#2e2e3e';ab.style.background='#22222e';ab.style.color='#8888aa';ab.style.fontWeight='400';}
    if(mbl)mbl.style.display='block'; if(abl)abl.style.display='none';
  }
  checkMorningValid();
}
function openMorningModal(){
  var shopName=pendingSession.shopName;
  var shopType=getShopType(shopName);
  if(shopType!=='shop'){
    var goodsM=calcGoodsMorning(shopName);
    session={...pendingSession,openedAt:(restoreMode?pendingSession._restoreOpenedAt:new Date().toISOString()),cashMorning:0,goodsMorning:goodsM,shopType:shopType};
    if(restoreMode) session.isRestoreShift = true;
    pendingSession=null;
    journal=[{id:uid(),type:'open',ts:_workingNowISO(),icon:'🔓',
      label:'Смена открыта · '+(shopType==='online'?'📱 Онлайн':'🏭 Офлайн')+(restoreMode?' (восстановление)':''),
      sub:'📦 Товар: '+fmt(goodsM),cashEffect:0,cardEffect:0,staffEffect:0,goodsEffect:0}];
    saveS(); saveJ(); startApp();
    if(restoreMode) syncRestoreUIChrome();
    return;
  }
  document.getElementById('morningShopName').textContent='🏪 '+shopName;
  document.getElementById('morningSellerName').textContent='👤 '+pendingSession.sellerName;
  ['morningCash','morningCashDr','morningCashStaff','morningGoods','morningGoodsDr'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });
  document.getElementById('morningCashHint').style.display='none';
  document.getElementById('morningConfirmBtn').disabled=true;
  document.getElementById('morningConfirmBtn').style.opacity='.4';
  var autoGoods=calcGoodsMorning(shopName), autoDr=calcGoodsDrMorning(shopName);
  var agEl=document.getElementById('goodsAutoVal'); if(agEl) agEl.textContent=fmt(autoGoods);
  var agDrEl=document.getElementById('goodsDrAutoVal'); if(agDrEl) agDrEl.textContent=fmt(autoDr);
  _goodsMornMode='auto'; setGoodsMornMode('auto');
  _goodsDrMode='auto'; setGoodsDrMode('auto');
  var prev=getPrevShift(shopName);
  var mc=document.getElementById('morningCompare');
  mc.innerHTML='';
  openMo('morningMo');
}
function checkMorningValid(){
  const btn=document.getElementById('morningConfirmBtn'), hint=document.getElementById('morningCashHint');
  function filledNonNeg(id){
    var el = document.getElementById(id);
    var v = el ? el.value : '';
    var n = parseFloat(v);
    return v!=='' && !isNaN(n) && n>=0;
  }
  var cashOk = filledNonNeg('morningCash');
  var cashDrOk = filledNonNeg('morningCashDr');
  var cashStaffOk = filledNonNeg('morningCashStaff');
  var goodsOk = _goodsMornMode==='auto' || filledNonNeg('morningGoods');
  var goodsDrOk = _goodsDrMode==='auto' || filledNonNeg('morningGoodsDr');
  var allOk = cashOk && cashDrOk && cashStaffOk && goodsOk && goodsDrOk;
  var prev=getPrevShift((pendingSession&&pendingSession.shopName)||'');
  function checkHint(ok, inputId, hintId, prevVal, color){
    var h=document.getElementById(hintId);
    if(!h) return;
    if(ok){
      var num=parseFloat(document.getElementById(inputId).value);
      h.style.display='block';
      if(prevVal!=null && prevVal>=100 && Math.abs(num-prevVal)<=1){
        h.textContent='✅ Сходится с вечером пред. смены'; h.style.color='#60f090';
      } else if(prevVal!=null && prevVal>=100){
        h.textContent='✅ Принято'; h.style.color='#60f090';
      } else {
        h.textContent='✅ Принято'; h.style.color='#60f090';
      }
    } else { h.style.display='none'; }
  }
  checkHint(cashOk,'morningCash','morningCashHint',prev&&prev.cashEvening,'#c8f060');
  checkHint(cashDrOk,'morningCashDr','morningCashDrHint',prev&&prev.drCashEvening,'#a060f0');
  checkHint(cashStaffOk,'morningCashStaff','morningCashStaffHint',prev&&prev.cashStaffEvening,'#60c8f0');
  if(allOk){ btn.disabled=false; btn.style.opacity='1'; }
  else { btn.disabled=true; btn.style.opacity='.4'; }
}
function confirmMorning(){
  _backupCheckPassed = false;
  function filledNonNeg(id){
    var el = document.getElementById(id);
    var v = el ? el.value : '';
    var n = parseFloat(v);
    return v!=='' && !isNaN(n) && n>=0;
  }
  if(!filledNonNeg('morningCash') || !filledNonNeg('morningCashDr') || !filledNonNeg('morningCashStaff')) return;
  if(_goodsMornMode==='manual' && !filledNonNeg('morningGoods')) return;
  if(_goodsDrMode==='manual' && !filledNonNeg('morningGoodsDr')) return;
  const cashM=parseFloat(document.getElementById('morningCash').value);
  var cashDr=parseFloat(document.getElementById('morningCashDr').value);
  var cashStaff=parseFloat(document.getElementById('morningCashStaff').value);
  var goodsM=_goodsMornMode==='manual'
    ?parseFloat(document.getElementById('morningGoods').value)
    :calcGoodsMorning(pendingSession.shopName);
  var goodsDrM=_goodsDrMode==='manual'
    ?parseFloat(document.getElementById('morningGoodsDr').value)
    :calcGoodsDrMorning(pendingSession.shopName);
  _shiftForceClosedRemotely = false;
  session=Object.assign({},pendingSession,{
    shiftId:uid(),
    openedAt: restoreMode ? pendingSession._restoreOpenedAt : new Date().toISOString(),
    cashMorning:cashM, cashDrMorning:cashDr, cashStaffMorning:cashStaff,
    goodsMorning:goodsM, goodsDrMorning:goodsDrM, shopType:'shop',
    goodsMornSource:_goodsMornMode, goodsDrMornSource:_goodsDrMode
  });
  if(restoreMode) session.isRestoreShift = true;
  var prev=getPrevShiftByOpenOrder(pendingSession.shopName, session.openedAt);
  var hasCashDiff=false;
  var diffParts=[];
  if(prev){
    if(prev.cashEvening!=null && Math.abs(cashM-prev.cashEvening)>1){
      hasCashDiff=true;
      diffParts.push({label:'🌳 Дерево', morning:cashM, prevEvening:prev.cashEvening, diff:cashM-prev.cashEvening});
    }
    if(prev.drCashEvening!=null && Math.abs(cashDr-prev.drCashEvening)>1){
      hasCashDiff=true;
      diffParts.push({label:'🛍 ДР Товар', morning:cashDr, prevEvening:prev.drCashEvening, diff:cashDr-prev.drCashEvening});
    }
    if(prev.cashStaffEvening!=null && Math.abs(cashStaff-prev.cashStaffEvening)>1){
      hasCashDiff=true;
      diffParts.push({label:'🛒 Покупки сотрудников', morning:cashStaff, prevEvening:prev.cashStaffEvening, diff:cashStaff-prev.cashStaffEvening});
    }
  }
  if(hasCashDiff && !restoreMode){
    var detailLines = diffParts.map(function(p){
      return p.label+': ввёл '+fmt(p.morning)+', вечер был '+fmt(p.prevEvening)+' ('+(p.diff>0?'+':'')+fmt(p.diff)+')';
    });
    var mainPart = diffParts[0]||{};
    var todayStr = new Date().toISOString().split('T')[0];
    var existingAlerts = JSON.parse(localStorage.getItem('iz_admin_alerts')||'[]');
    var alreadySent = existingAlerts.some(function(a){
      return a.type==='morning_diff' && a.shopName===session.shopName &&
        a.sellerName===session.sellerName && a.date===todayStr;
    });
    if(!alreadySent){
      saveAdminAlert({
        type:'morning_diff',
        shopName:session.shopName,
        sellerName:session.sellerName,
        date:todayStr,
        diffParts:diffParts,
        cashMorning:mainPart.morning,
        prevCashEve:mainPart.prevEvening,
        morningDiff:mainPart.diff,
        message:'⚠️ Расхождение нала на утро — '+detailLines.join(' · '),
        forRoles:['admin','owner']
      });
    }
  }
  journal=[{id:uid(),type:'open',ts:_workingNowISO(),icon: hasCashDiff?'⚠️':'🔓',
    label:'Смена открыта'+(hasCashDiff?' ⚠️ Расхождение нала':'')+(restoreMode?' (восстановление)':''),
    sub:'🌳 '+fmt(cashM)+(cashDr?' 🛍 '+fmt(cashDr):'')+(cashStaff?' 🛒 '+fmt(cashStaff):'')+
        ' | 📦 '+fmt(goodsM)+' 🛍 '+fmt(goodsDrM),
    cashEffect:0,cardEffect:0,staffEffect:0,goodsEffect:0,hasCashDiff:hasCashDiff,cashDiffParts:diffParts}];
  pendingSession=null; saveS(); saveJ();
  if(!restoreMode){
    logShiftOpen(session.shopName, cashM);
    syncLiveShift();
  }
  closeMo('morningMo'); startApp();
  if(restoreMode) syncRestoreUIChrome();
}
function cancelMorning(){
  closeMo('morningMo'); pendingSession=null;
  if(restoreMode){ restoreMode=false; restoreMeta=null; }
}
function getPrevShift(shopName){
  var all=getShifts();
  return all.filter(function(s){
    if(s.isRestoreShift && s.status==='open') return false; // исключаем только незакрытые «призрачные» сессии восстановления; закрытые архивные/импортированные смены с реальными данными участвуют в сравнении как обычно
    return s.shopName===shopName;
  }).sort(function(a,b){return new Date(b.closedAt||0)-new Date(a.closedAt||0);})[0]||null;
}
function getPrevShiftByOpenOrder(shopName, beforeOpenedAt){
  var all = getShifts();
  var beforeDate = beforeOpenedAt ? beforeOpenedAt.split('T')[0] : '';
  var candidates = all.filter(function(s){
    if(s.isRestoreShift && s.status==='open') return false; // исключаем только незакрытые «призрачные» сессии восстановления; закрытые архивные/импортированные смены с реальными данными участвуют в сравнении как обычно
    if(s.shopName!==shopName) return false;
    var sDate = s.date || (s.openedAt||'').split('T')[0];
    if(!sDate) return false; // дата открытия — обязательное поле, есть даже у старых смен
    return beforeDate ? sDate < beforeDate : true;
  });
  candidates.sort(function(a,b){
    var da = a.date || (a.openedAt||'').split('T')[0];
    var db2 = b.date || (b.openedAt||'').split('T')[0];
    if(da !== db2) return da < db2 ? 1 : -1; // по убыванию даты
    var ao = a.openedAt||'', bo = b.openedAt||'';
    return ao < bo ? 1 : (ao > bo ? -1 : 0); // при совпадении даты — точное время как тай-брейкер
  });
  return candidates[0] || null;
}
function getMorningCashDiff(){
  if(!session) return {hasDiff:false, parts:[]};
  var prev = getPrevShiftByOpenOrder(session.shopName, session.openedAt);
  if(!prev) return {hasDiff:false, parts:[]};
  var parts = [];
  if(prev.cashEvening!=null && Math.abs((session.cashMorning||0)-prev.cashEvening)>=1){
    parts.push({label:'🌳 Дерево', morning:session.cashMorning||0, prevEvening:prev.cashEvening, diff:Math.round((session.cashMorning||0)-prev.cashEvening)});
  }
  if(prev.drCashEvening!=null && Math.abs((session.cashDrMorning||0)-prev.drCashEvening)>=1){
    parts.push({label:'🛍 ДР Товар', morning:session.cashDrMorning||0, prevEvening:prev.drCashEvening, diff:Math.round((session.cashDrMorning||0)-prev.drCashEvening)});
  }
  if(prev.cashStaffEvening!=null && Math.abs((session.cashStaffMorning||0)-prev.cashStaffEvening)>=1){
    parts.push({label:'🛒 Покупки сотрудников', morning:session.cashStaffMorning||0, prevEvening:prev.cashStaffEvening, diff:Math.round((session.cashStaffMorning||0)-prev.cashStaffEvening)});
  }
  return {hasDiff: parts.length>0, parts: parts};
}
function calcGoodsMorning(shopName){
  var prev = restoreMode ? getPrevShiftByDate(shopName) : getPrevShift(shopName);
  if(!prev) return 0;
  if(prev.goodsEvening!=null) return prev.goodsEvening;
  var g=prev.goodsMorning||0; (prev.journal||[]).forEach(function(e){g+=(e.goodsEffect||0);}); return Math.max(0,g);
}
function calcGoodsDrMorning(shopName){
  var prev = restoreMode ? getPrevShiftByDate(shopName) : getPrevShift(shopName);
  if(!prev) return 0;
  if(prev.drGoodsEvening!=null) return prev.drGoodsEvening;
  var g=prev.goodsDrMorning||0; (prev.journal||[]).forEach(function(e){g+=(e.goodsDrEffect||0);}); return Math.max(0,g);
}
function getPrevShiftByDate(shopName){
  var targetDate = pendingSession && pendingSession._restoreOpenedAt
    ? pendingSession._restoreOpenedAt.split('T')[0]
    : new Date().toISOString().split('T')[0];
  var all = getShifts();
  return all.filter(function(s){
    if(!s.shopName || s.shopName!==shopName) return false;
    if(s.isRestoreShift && s.status==='open') return false; // исключаем только незакрытые «призрачные» сессии восстановления; закрытые архивные/импортированные смены с реальными данными участвуют в сравнении как обычно
    var sDate = (s.date||(s.openedAt||'').split('T')[0]);
    return sDate < targetDate;
  }).sort(function(a,b){
    var da=(a.date||(a.openedAt||'').split('T')[0]);
    var db2=(b.date||(b.openedAt||'').split('T')[0]);
    return db2.localeCompare(da);
  })[0]||null;
}
function saveAdminAlert(data){
  var alerts=JSON.parse(localStorage.getItem('iz_admin_alerts')||'[]');
  var alert=Object.assign({id:uid(),read:false,createdAt:new Date().toISOString()},data);
  alerts.unshift(alert);
  localStorage.setItem('iz_admin_alerts',JSON.stringify(alerts.slice(0,100)));
  try{ db.collection('iz_admin_alerts').doc(alert.id).set(alert); }catch(e){}
}
function _archivedReceiveInvIds(shiftsArr){
  var ids = {};
  (shiftsArr||[])
    .filter(function(s){ return s.shopName===session.shopName; })
    .filter(function(s){ return s.status==='closed' && s.id!==session.shiftId; })
    .forEach(function(s){
      (s.journal||[]).forEach(function(e){
        if(e.type==='receive' && e.invId) ids[e.invId]=true;
      });
    });
  return ids;
}
function _stableReceiveId(iid){ return 'receive_'+iid; }
function _reconcileReceiveEntries(archivedInvIds){
  if(!journal.length) return false;
  var manualInvoices = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]')
    .filter(function(inv){ return inv.destName===session.shopName; });
  manualInvoices = manualInvoices.filter(function(inv){
    var iid = String(inv._id!=null?inv._id:inv.id);
    return !archivedInvIds[iid];
  });
  var shiftOpenDate = session.openedAt ? new Date(session.openedAt) : new Date();
  manualInvoices = manualInvoices.filter(function(inv){
    var invDate = new Date(inv.acceptedAt || inv.date || 0);
    var daysDiff = (shiftOpenDate - invDate) / 86400000;
    return daysDiff <= 3;
  });
  var validInvIds = {};
  manualInvoices.forEach(function(inv){
    var iid = String(inv._id!=null?inv._id:inv.id);
    validInvIds[iid] = inv;
  });
  var alreadyCorrect = manualInvoices.every(function(inv){
    var iid = String(inv._id!=null?inv._id:inv.id);
    var total = inv.totalAmt!=null ? inv.totalAmt
      : (inv.items||[]).reduce(function(s,it){ return s+(it.qty||1)*(it.price||0); },0);
    var existing = journal.filter(function(e){ return e.type==='receive' && e.invId===iid; });
    return existing.length===1 && existing[0].id===_stableReceiveId(iid) && Math.round(existing[0].amount||0)===Math.round(total);
  });
  var hasLegacyRows = journal.some(function(e){ return e.type==='receive' && e.label==='Приход товара' && !e.invId; });
  var hasArchivedGhosts = journal.some(function(e){ return e.type==='receive' && e.invId && archivedInvIds[e.invId]; });
  var hasDuplicates = (function(){
    var seen={};
    return journal.some(function(e){
      if(e.type!=='receive' || !e.invId) return false;
      if(seen[e.invId]) return true;
      seen[e.invId]=true; return false;
    });
  })();
  if(alreadyCorrect && !hasLegacyRows && !hasDuplicates && !hasArchivedGhosts) return false;
  journal.forEach(function(e){
    if(e.type!=='receive') return;
    var isLegacyRow = !e.invId && e.label==='Приход товара';
    var isArchivedGhost = e.invId && archivedInvIds[e.invId];
    if(isLegacyRow || isArchivedGhost){
      try{ logEntryDelete(e); }catch(err){}
      addToTrash(e, {reason:'receive_reconcile_cleanup'});
    }
  });
  journal = journal.filter(function(e){
    if(e.type!=='receive') return true;
    if(!e.invId && e.label==='Приход товара') return false; // legacy per-item row
    if(e.invId && archivedInvIds[e.invId]) return false; // ghost from an already-archived invoice
    if(e.invId && validInvIds[e.invId]) return false; // will be recreated
    return true;
  });
  manualInvoices.forEach(function(inv){
    var iid = String(inv._id!=null?inv._id:inv.id);
    var total = inv.totalAmt!=null ? inv.totalAmt
      : (inv.items||[]).reduce(function(s,it){ return s+(it.qty||1)*(it.price||0); },0);
    var count = (inv.items||[]).length;
    var ts = inv.acceptedAt || inv.date || new Date().toISOString();
    var invGt = inv.goodsType || (inv.category==='dr'?'dr':'derevo');
    var isDr = invGt==='dr';
    journal.push({
      id:_stableReceiveId(iid), type:'receive', ts:ts, icon:'📥',
      label:'Приёмка '+(inv.num||''),
      sub:count+' изд.'+(inv.from?' · от '+inv.from:''),
      amount:total, amtCls:'neu', cashEffect:0, cardEffect:0, staffEffect:0,
      goodsType:invGt,
      goodsEffect:isDr?0:total, goodsDrEffect:isDr?total:0, invId:iid
    });
  });
  journal.sort(function(a,b){ return (a.ts||'').localeCompare(b.ts||''); });
  saveJ();
  try{ syncLiveShift(); }catch(e){}
  return true;
}
var _adminActiveShifts=[], _adminShiftUnsub=null, _adminAlertUnsub=null, _adminAlerts=[];
function startAdminShiftListener(){
  if(_adminShiftUnsub){try{_adminShiftUnsub();}catch(e){}}
  var today=new Date().toISOString().split('T')[0];
  _adminShiftUnsub=db.collection('iz_shifts').where('date','==',today)
    .onSnapshot(function(snap){
      _adminActiveShifts=[];
      snap.forEach(function(doc){
        var d=doc.data(); d.id=doc.id;
        _adminActiveShifts.push(d);
      });
      renderTodayShift();
    },function(e){
      console.log('shift listener err:',e&&e.code);
      if(_firebaseReady){
        db.collection('iz_shifts').where('date','==',today).get({source:'server'})
          .then(function(snap){
            _adminActiveShifts=[];
            snap.forEach(function(doc){
              var d=doc.data(); d.id=doc.id;
              _adminActiveShifts.push(d);
            });
            renderTodayShift();
          }).catch(function(){renderTodayShift();});
      } else { renderTodayShift(); }
    });
}
setInterval(function(){
  try{
    if(!session || session.role!=='admin' || !navigator.onLine || typeof db==='undefined' || !db) return;
    var today=new Date().toISOString().split('T')[0];
    db.collection('iz_shifts').where('date','==',today).get({source:'server'}).then(function(snap){
      var fresh=[];
      snap.forEach(function(doc){ var d=doc.data(); d.id=doc.id; fresh.push(d); });
      if(JSON.stringify(fresh)!==JSON.stringify(_adminActiveShifts)){
        _adminActiveShifts = fresh;
        renderTodayShift();
      }
    }).catch(function(){});
  }catch(e){}
}, 30000);
var _adminAuditLog=[], _adminAuditUnsub=null;
function startAdminAuditListener(){
  if(_adminAuditUnsub){try{_adminAuditUnsub();}catch(e){}}
  var since=new Date(); since.setHours(0,0,0,0);
  _adminAuditUnsub=db.collection('iz_audit_log').where('timestamp','>=',since.toISOString())
    .onSnapshot(function(snap){
      _adminAuditLog=[];
      snap.forEach(function(doc){_adminAuditLog.push(doc.data());});
      renderTodayShift();
    },function(e){console.log('audit err',e&&e.code);});
}
function startAdminAlertsListener(){
  if(_adminAlertUnsub){try{_adminAlertUnsub();}catch(e){}}
  _adminAlertUnsub=db.collection('iz_admin_alerts').where('read','==',false)
    .onSnapshot(function(snap){
      _adminAlerts=[];
      snap.forEach(function(doc){_adminAlerts.push(doc.data());});
      var count=_adminAlerts.length;
      var badge=document.getElementById('alertsBadge');
      if(badge) badge.textContent=count>0?count:'';
      renderAlertsPage();
    },function(e){console.log('alerts err',e&&e.code);});
}
function alertCard(a){
  if(a.type==='shift_conflict'){
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #3e2e2e">'+
      '<div><div style="font-size:12px;font-weight:700;color:#f06060">⛔ Попытка открыть занятую смену — '+(a.shopName||'')+'</div>'+
      '<div class="u-fs11-gray">'+(a.blockedSellerName||'—')+' пытался(ась) открыть смену, но она уже была открыта продавцом '+(a.activeSellerName||'—')+'</div>'+
      '<div class="u-fs10-gray">'+(a.date||'')+'</div></div>'+
      '<button onclick="markAlertRead(\''+a.id+'\')" style="background:none;border:1px solid #3e2e2e;border-radius:6px;padding:4px 8px;color:#8888aa;font-size:10px;cursor:pointer;flex-shrink:0;margin-left:8px">✓ Прочитано</button>'+
    '</div>';
  }
  var diff = a.morningDiff!=null ? a.morningDiff : a.cashDiff;
  var title = a.type==='cash_diff' ? '⚠️ Расхождение при закрытии — '+(a.shopName||'') : '⚠️ Расхождение нала — '+(a.shopName||'');
  var detail;
  if(a.type==='cash_diff'){
    detail = (a.sellerName||'')+' · итог не сошёлся на '+(diff>0?'+':'')+fmt(diff);
  } else if(a.diffParts && a.diffParts.length){
    detail = (a.sellerName||'')+' · '+a.diffParts.map(function(p){
      var d = p.diff||0;
      return p.label+': ввёл '+fmt(p.morning)+', вечер был '+fmt(p.prevEvening)+' ('+(d>0?'+':'')+fmt(d)+')';
    }).join(' · ');
  } else {
    detail = (a.sellerName||'')+' · ввёл: '+fmt(a.cashMorning)+' · вечер был: '+fmt(a.prevCashEve||0)+' · разница: '+(diff>0?'+':'')+fmt(diff);
  }
  return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #3e2e2e">'+
    '<div><div style="font-size:12px;font-weight:700;color:#f06060">'+title+'</div>'+
    '<div class="u-fs11-gray">'+detail+'</div>'+
    '<div class="u-fs10-gray">'+(a.date||'')+'</div></div>'+
    '<button onclick="markAlertRead(\''+a.id+'\')" style="background:none;border:1px solid #3e2e2e;border-radius:6px;padding:4px 8px;color:#8888aa;font-size:10px;cursor:pointer;flex-shrink:0;margin-left:8px">✓ Прочитано</button>'+
  '</div>';
}
var _alertsShopFilter = '';
function _setAlertOpen(key,val){if(!window._alertsOpen)window._alertsOpen={};window._alertsOpen[key]=val;}
function renderAlertsPage(){
  var c=document.getElementById('alertsPageContent'); if(!c) return;
  var fc=document.getElementById('alertsShopFilter');
  if(!_adminAlerts.length){
    if(fc) fc.innerHTML='';
    c.innerHTML='<div style="text-align:center;padding:30px;color:#8888aa"><div style="font-size:36px;margin-bottom:8px">✅</div>Нет непрочитанных уведомлений</div>';
    return;
  }
  var shops={};
  _adminAlerts.forEach(function(a){ var s=a.shopName||''; if(s) shops[s]=true; });
  var shopList=Object.keys(shops).sort();
  if(fc && shopList.length>1){
    fc.innerHTML='<div onpointerdown="event.preventDefault();_alertsShopFilter=\'\';renderAlertsPage()" '+
      'style="padding:5px 12px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;'+
      (_alertsShopFilter===''?'border:2px solid #c8f060;background:#1e2a14;color:#c8f060':'border:1px solid #2e2e3e;background:#22222e;color:#8888aa')+'">Все</div>'+
      shopList.map(function(s){
        var active=_alertsShopFilter===s;
        return '<div onpointerdown="event.preventDefault();_alertsShopFilter=\''+s+'\';renderAlertsPage()" '+
          'style="padding:5px 12px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;'+
          (active?'border:2px solid #c8f060;background:#1e2a14;color:#c8f060':'border:1px solid #2e2e3e;background:#22222e;color:#8888aa')+'">'+s+'</div>';
      }).join('');
  } else if(fc){ fc.innerHTML=''; }
  var alerts=_adminAlerts.filter(function(a){
    return !_alertsShopFilter || (a.shopName||'')=== _alertsShopFilter;
  });
  if(!alerts.length){
    c.innerHTML='<div style="text-align:center;padding:20px;color:#8888aa">Нет тревог для выбранного магазина</div>';
    return;
  }
  var grouped={};
  alerts.forEach(function(a){
    var s=a.shopName||'Без магазина';
    if(!grouped[s]) grouped[s]=[];
    grouped[s].push(a);
  });
  var sortedShops=Object.keys(grouped).sort();
  if(!window._alertsOpen) window._alertsOpen={};
  c.innerHTML=sortedShops.map(function(shop){
    var shopAlerts=grouped[shop];
    shopAlerts.sort(function(a,b){return (b.createdAt||b.date||'').localeCompare(a.createdAt||a.date||'');});
    var byDate={};
    shopAlerts.forEach(function(a){var d=a.date||'—';if(!byDate[d])byDate[d]=[];byDate[d].push(a);});
    var sortedDates=Object.keys(byDate).sort(function(a,b){return b.localeCompare(a);});
    var shopKey='shop_'+shop;
    var shopOpen=window._alertsOpen[shopKey]!==false;
    var shopCount=shopAlerts.length;
    var datesHtml=sortedDates.map(function(date){
      var dateAlerts=byDate[date];
      var dateKey='date_'+shop+'_'+date;
      var dateOpen=window._alertsOpen[dateKey]!==false;
      return '<div style="margin-bottom:6px">'+
        '<div onpointerdown="event.preventDefault();_setAlertOpen(\''+dateKey+'\','+(!dateOpen)+');renderAlertsPage()" '+
          'style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#22222e;border-radius:8px;cursor:pointer;margin-bottom:'+(dateOpen?'4px':'0')+'">'+
          '<span style="font-size:11px;color:#8888aa;font-weight:700">'+date+'</span>'+
          '<div style="display:flex;align-items:center;gap:6px">'+
            '<span style="background:#f06060;color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700">'+dateAlerts.length+'</span>'+
            '<span style="color:#8888aa;font-size:11px">'+(dateOpen?'▾':'▸')+'</span>'+
          '</div>'+
        '</div>'+
        (dateOpen?'<div style="background:#1a0f0f;border:1px solid #3e1e1e;border-radius:10px;padding:0 10px">'+dateAlerts.map(alertCard).join('')+'</div>':'')+
      '</div>';
    }).join('');
    return '<div style="margin-bottom:14px">'+
      '<div onpointerdown="event.preventDefault();_setAlertOpen(\''+shopKey+'\','+(!shopOpen)+');renderAlertsPage()" '+
        'style="display:flex;justify-content:space-between;align-items:center;padding:7px 2px;cursor:pointer;margin-bottom:'+(shopOpen?'6px':'0')+'">'+
        '<span style="font-size:12px;font-weight:700;color:#f0f0f8;text-transform:uppercase;letter-spacing:.5px">'+shop+'</span>'+
        '<div style="display:flex;align-items:center;gap:6px">'+
          '<span style="background:#f06060;color:#fff;border-radius:10px;padding:1px 8px;font-size:10px;font-weight:700">'+shopCount+'</span>'+
          '<span style="color:#8888aa;font-size:13px">'+(shopOpen?'▾':'▸')+'</span>'+
        '</div>'+
      '</div>'+
      (shopOpen?datesHtml:'')+
    '</div>';
  }).join('');
}
function markAlertRead(id){
  try{db.collection('iz_admin_alerts').doc(id).update({read:true});}catch(e){}
  var alerts=JSON.parse(localStorage.getItem('iz_admin_alerts')||'[]');
  alerts.forEach(function(a){if(a.id===id)a.read=true;});
  localStorage.setItem('iz_admin_alerts',JSON.stringify(alerts));
  _adminAlerts = _adminAlerts.filter(function(a){ return a.id!==id; });
  var badge=document.getElementById('alertsBadge');
  if(badge) badge.textContent=_adminAlerts.length>0?_adminAlerts.length:'';
  renderAlertsPage();
}
function markAllAlertsRead(){
  if(!_adminAlerts.length) return;
  if(!confirm('Отметить все уведомления как прочитанные?')) return;
  _adminAlerts.forEach(function(a){
    try{db.collection('iz_admin_alerts').doc(a.id).update({read:true});}catch(e){}
  });
  var alerts=JSON.parse(localStorage.getItem('iz_admin_alerts')||'[]');
  alerts.forEach(function(a){a.read=true;});
  localStorage.setItem('iz_admin_alerts',JSON.stringify(alerts));
  _adminAlerts=[];
  var badge=document.getElementById('alertsBadge');
  if(badge) badge.textContent='';
  renderAlertsPage();
}
var _todayActiveShop = null;
function renderTodayShift(){
  var c=document.getElementById('todayShiftContent'); if(!c) return;
  var shopNames = getShopNames();
  if(!_todayActiveShop || shopNames.indexOf(_todayActiveShop)<0){
    var openShop = _adminActiveShifts.find(function(s){ return s.status==='open'; });
    _todayActiveShop = (openShop && openShop.shopName) || shopNames[0] || '';
  }
  var tabsHtml = '<div style="display:flex;gap:6px;margin-bottom:12px;overflow-x:auto;padding-bottom:2px">' +
    shopNames.map(function(name){
      var shift = _adminActiveShifts.find(function(s){ return s.shopName===name && s.status==='open'; });
      var active = name===_todayActiveShop;
      var hasDiff = shift && (shift.hasCashDiff || (shift.journal||[]).some(function(e){return e.hasCashDiff;}));
      var dot = shift ? '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:'+(hasDiff?'#f06060':'#60f090')+';margin-right:5px"></span>' : '';
      var border = active ? '#c8f060' : (shift ? '#60f090' : '#2e2e3e');
      var bg = active ? '#1e2a14' : (shift ? '#142a1e' : '#1a1a22');
      var color = active ? '#c8f060' : (shift ? '#60f090' : '#8888aa');
      return '<button onclick="_todayActiveShop=\''+name.replace(/'/g,"\\'")+'\';renderTodayShift()" style="flex-shrink:0;padding:8px 14px;border-radius:20px;border:'+(active?'2px':'1px')+' solid '+border+';background:'+bg+';color:'+color+';font-size:12px;font-weight:'+(active?'700':'400')+';cursor:pointer;white-space:nowrap">'+dot+name+'</button>';
    }).join('') +
  '</div>';
  var shift = _adminActiveShifts.find(function(s){ return s.shopName===_todayActiveShop && s.status==='open'; });
  c.innerHTML = tabsHtml + (shift ? renderShiftDetail(shift) : renderNoShiftCard(_todayActiveShop));
}
function renderNoShiftCard(shopName){
  return '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:14px;padding:30px;text-align:center;color:#8888aa">'+
    '<div style="font-size:36px;margin-bottom:8px">📋</div>'+
    'Сейчас нет открытой смены в магазине<br><b style="color:#f0f0f8">'+shopName+'</b>'+
  '</div>';
}
function goodsMovementLedger(shift, drMode){
  var morning = drMode ? (shift.goodsDrMorning||0) : (shift.goodsMorning||0);
  var effField = drMode ? 'goodsDrEffect' : 'goodsEffect';
  var jEntries = (shift.journal||[]).filter(function(e){ return (e[effField]||0)!==0; })
    .map(function(e){ return {ts:e.ts||'', eff:e[effField]||0, icon:e.icon, label:e.label||e.sub||e.type, manual:false}; });
  var rcvArr = drMode ? (shift.drGoodsReceives||[]) : (shift.goodsReceives||[]);
  var woArr = drMode ? (shift.drGoodsWriteoffs||[]) : (shift.goodsWriteoffs||[]);
  var arrEntries = rcvArr.map(function(r){
    var amt = r.amt!=null?r.amt:(r.amount||0);
    return {ts:r.ts||'9999-99-99', eff:amt, icon:'📥', label:'(вручную) '+(r.name||'Приход')+(r.from?' · от '+r.from:''), manual:true};
  }).concat(woArr.map(function(w){
    var amt = w.amt!=null?w.amt:(w.amount||0);
    return {ts:w.ts||'9999-99-99', eff:-amt, icon:'🗑', label:'(вручную) '+(w.name||'Списание')+(w.reason?' · '+w.reason:''), manual:true};
  }));
  var entries = jEntries.concat(arrEntries).sort(function(a,b){ return (a.ts||'').localeCompare(b.ts||''); });
  var running = morning;
  var rows = '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #2e2e3e;font-size:12px">'+
    '<span style="color:#8888aa">🌅 Утро (остаток)</span><span style="font-weight:700">'+fmt(running)+'</span></div>';
  if(!entries.length){
    rows += '<div style="font-size:12px;color:#8888aa;padding:8px 0">Движений не было</div>';
  } else {
    entries.forEach(function(e){
      var eff = e.eff||0;
      running += eff;
      var icon = e.icon || '📌';
      var time = (e.ts && e.ts.indexOf('9999')!==0) ? new Date(e.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) : '—';
      var label = (e.label||'').toString().replace(/\s*⚠️\s*$/,'');
      rows += '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:6px 0;border-bottom:1px solid #2e2e3e;font-size:12px">'+
        '<div style="flex:1;padding-right:8px"><span style="color:#8888aa">'+time+'</span> '+icon+' '+label+'</div>'+
        '<div style="text-align:right;white-space:nowrap">'+
          '<div style="color:'+(eff>=0?'#60f090':'#f06060')+';font-weight:700">'+(eff>=0?'+':'−')+fmt(Math.abs(eff))+'</div>'+
          '<div class="u-fs10-gray">→ '+fmt(running)+'</div>'+
        '</div>'+
      '</div>';
    });
  }
  var stored = drMode ? (shift.drGoodsEvening||0) : (shift.goodsEvening||0);
  var diff = Math.round((stored - running)*100)/100;
  if(Math.abs(diff)>=1){
    rows += '<div style="margin-top:10px;padding:8px 10px;border-radius:8px;background:#2e1a1a;border:1px solid #f06060;font-size:11px;color:#f06060">'+
      '⚠️ По истории движения должно быть '+fmt(running)+', а сохранённый «Остаток вечер» — '+fmt(stored)+'. Разница '+(diff>0?'+':'')+fmt(diff)+' не объясняется ни одной из перечисленных выше операций.'+
    '</div>';
  } else {
    rows += '<div style="margin-top:10px;padding:6px 10px;border-radius:8px;background:#1a2e1a;border:1px solid #60f090;font-size:11px;color:#60f090">✅ Сходится с сохранённым «Остаток вечер» ('+fmt(stored)+')</div>';
  }
  return rows;
}
function renderShiftDetail(shift){
  var sidBase=(shift.id||'shift').replace(/[^a-z0-9_]/gi,'_');
  var journal = shift.journal||[];
  var sales = journal.filter(function(e){ return e.type==='sale'; });
  var writeoffs = journal.filter(function(e){ return e.type==='writeoff'; });
  var receives = journal.filter(function(e){ return e.type==='receive'; });
  var cashWood = (shift.cashMorning||0) + journal.reduce(function(s,e){return s+(e.cashEffect||0);},0);
  var cashDr = (shift.cashDrMorning||0) + journal.reduce(function(s,e){return s+(e.cashDrEffect||0);},0);
  var cashStaff = (shift.cashStaffMorning||0) + journal.reduce(function(s,e){
    if(e.staffEffect) return s+e.staffEffect;
    if(e.type==='expense' && e.goodsType==='staff') return s-(e.amount||0);
    return s;
  },0);
  var goodsWood = (shift.goodsMorning||0) + journal.reduce(function(s,e){
    var eff = e.goodsEffect||0;
    if(e.type==='staff' && eff===0 && (e.goodsType||'wood')!=='dr' && (e.retail||e.opt)) eff = -(e.retail||e.opt||0);
    return s+eff;
  },0);
  var goodsDr = (shift.goodsDrMorning||0) + journal.reduce(function(s,e){
    var eff = e.goodsDrEffect||0;
    if(e.type==='staff' && eff===0 && e.goodsType==='dr' && (e.retail||e.opt)) eff = -(e.retail||e.opt||0);
    return s+eff;
  },0);
  function computeSalesTotalsSplit(salesArr, isDr){
    var revenue=0, discount=0;
    var payTotals = {cash:0,terminal:0,sbp:0,transfer:0,qr:0,rs:0,mixed:0};
    salesArr.forEach(function(e){
      var items=e.items||[];
      if(!items.length){
        if(isDr) return;
        revenue += (e.amount||0);
        discount += (e.discount||0);
        if(e.payMethod==='mixed'){
          payTotals.cash += e.cashEffect||0;
          payTotals.terminal += e.cardEffect||0;
        } else {
          var key0 = payTotals.hasOwnProperty(e.payMethod) ? e.payMethod : 'terminal';
          payTotals[key0] += (e.cashEffect||0)+(e.cardEffect||0);
        }
        return;
      }
      var groupItems = items.filter(function(it){ return isDr ? it.goodsType==='dr' : it.goodsType!=='dr'; });
      if(!groupItems.length) return;
      var itemAmt=function(it){ return it.amt!=null?it.amt:(it.price||0)*(it.qty||1); };
      var groupTotal = groupItems.reduce(function(s,it){ return s+itemAmt(it); },0);
      var saleTotal = e.totalPrice || items.reduce(function(s,it){ return s+itemAmt(it); },0) || 1;
      var share = groupTotal/saleTotal;
      revenue += (e.amount||0)*share;
      discount += (e.discount||0)*share;
      var cash = isDr ? (e.cashDrEffect||0) : (e.cashEffect||0);
      var card = isDr ? (e.cardDrEffect||0) : (e.cardEffect||0);
      if(e.payMethod==='mixed'){
        payTotals.cash += cash;
        payTotals.terminal += card;
      } else {
        var key = payTotals.hasOwnProperty(e.payMethod) ? e.payMethod : 'terminal';
        payTotals[key] += cash+card;
      }
    });
    return {revenue:Math.round(revenue), discount:Math.round(discount), goodsValue:Math.round(revenue+discount), payTotals:payTotals};
  }
  var totalsWood = computeSalesTotalsSplit(sales, false);
  var totalsDr = computeSalesTotalsSplit(sales, true);
  var soldWood = {count:0, qty:0}, soldDr = {count:0, qty:0};
  sales.forEach(function(e){
    var items = e.items||[];
    if(items.length){
      var countedWood=false, countedDr=false;
      items.forEach(function(it){
        if(it.goodsType==='dr'){ soldDr.qty += (it.qty||1); countedDr=true; }
        else { soldWood.qty += (it.qty||1); countedWood=true; }
      });
      if(countedWood) soldWood.count++;
      if(countedDr) soldDr.count++;
    } else {
      soldWood.count++; soldWood.qty+=1;
    }
  });
  var soldItemsWood = {}, soldItemsDr = {};
  sales.forEach(function(e){
    var items = e.items||[];
    items.forEach(function(it){
      var target = it.goodsType==='dr' ? soldItemsDr : soldItemsWood;
      var name = (it.name && it.name.trim()) || 'Без названия';
      var qty = it.qty||1;
      var amt = it.amt!=null ? it.amt : (it.price||0)*qty;
      if(!target[name]) target[name]={qty:0, amt:0};
      target[name].qty += qty;
      target[name].amt += amt;
    });
  });
  function soldItemsToList(map){
    return Object.keys(map).map(function(name){ return {name:name, qty:map[name].qty, amt:map[name].amt}; })
      .sort(function(a,b){ return b.qty-a.qty; });
  }
  var soldItemsWoodList = soldItemsToList(soldItemsWood);
  var soldItemsDrList = soldItemsToList(soldItemsDr);
  var woTotal = writeoffs.reduce(function(s,e){return s+(e.amount||0);},0);
  var woQty = writeoffs.length;
  var rcvTotal = receives.reduce(function(s,e){return s+(e.amount||0);},0);
  var rcvQty = receives.length;
  var hasDiff = shift.hasCashDiff || journal.some(function(e){return e.hasCashDiff;});
  var diffEntry = journal.find(function(e){ return e.hasCashDiff && e.cashDiffParts && e.cashDiffParts.length; });
  var diffParts = diffEntry ? diffEntry.cashDiffParts : [];
  var lastUpd = shift.updatedAt?new Date(shift.updatedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'—';
  var _blockIdx = 0;
  function block(title, rows, startOpen){
    _blockIdx++;
    var bid = 'sblk_'+sidBase+'_'+_blockIdx;
    var open = !!startOpen;
    return '<div class="card" style="margin-bottom:10px;padding-bottom:'+(open?'14px':'0')+'" id="'+bid+'_card">'+
      '<div class="ctitle" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;margin-bottom:'+(open?'8px':'0')+'" id="'+bid+'_hdr" onclick="toggleSBlock(\''+bid+'\')">'+
        '<span>'+title+'</span><span id="'+bid+'_arr" style="color:#8888aa;font-size:11px">'+(open?'▾':'▸')+'</span>'+
      '</div>'+
      '<div id="'+bid+'" style="display:'+(open?'block':'none')+'">'+rows+'</div>'+
    '</div>';
  }
  function row(label, value, color){
    return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span style="color:#8888aa">'+label+'</span><span style="font-weight:700;color:'+(color||'#f0f0f8')+'">'+value+'</span></div>';
  }
  function divider(){ return '<div style="border-top:1px solid #2e2e3e;margin:6px 0"></div>'; }
  var html = '';
  html += '<div style="background:#1a1a22;border:2px solid '+(hasDiff?'#f06060':'#c8f060')+';border-radius:14px;padding:14px;margin-bottom:10px">'+
    (hasDiff?(
      '<div style="background:#2a0f0f;border-radius:8px;padding:8px 10px;margin-bottom:8px">'+
        '<div style="font-size:11px;color:#f06060;font-weight:700;margin-bottom:'+(diffParts.length?'6px':'0')+'">⚠️ Расхождение наличных на утро!</div>'+
        diffParts.map(function(p){
          return '<div style="font-size:10.5px;color:#f0a060;margin-top:2px">'+p.label+': ввёл <b>'+fmt(p.morning)+'</b>, вечер был <b>'+fmt(p.prevEvening)+'</b> ('+(p.diff>0?'+':'')+fmt(p.diff)+')</div>';
        }).join('')+
      '</div>'
    ):'')+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
      '<div><div style="font-size:14px;font-weight:700">'+(shift.shopName||'')+'</div>'+
      '<div class="u-fs11-gray">👤 '+(shift.sellerName||'')+'</div></div>'+
      '<div style="text-align:right"><div style="font-size:11px;font-weight:700;color:#60f090">● Открыта</div>'+
      '<div class="u-fs10-gray">обновлено '+lastUpd+'</div></div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:4px">'+
      '<div style="background:#1e2a14;border-radius:10px;padding:8px 10px">'+
        '<div style="font-size:10px;color:#8888aa;margin-bottom:2px">🌳 Дерево</div>'+
        '<div style="font-size:15px;font-weight:700;color:#c8f060;font-family:Unbounded,sans-serif">'+fmt(totalsWood.revenue)+'</div>'+
        '<div class="u-fs10-gray">'+soldWood.count+' прод. · '+soldWood.qty+' шт.</div>'+
      '</div>'+
      '<div style="background:#1e1a2e;border-radius:10px;padding:8px 10px">'+
        '<div style="font-size:10px;color:#8888aa;margin-bottom:2px">🛍 ДР Товар</div>'+
        '<div style="font-size:15px;font-weight:700;color:#a060f0;font-family:Unbounded,sans-serif">'+fmt(totalsDr.revenue)+'</div>'+
        '<div class="u-fs10-gray">'+soldDr.count+' прод. · '+soldDr.qty+' шт.</div>'+
      '</div>'+
    '</div>'+
    '<div style="background:#22222e;border-radius:10px;padding:7px 10px;display:flex;justify-content:space-between;align-items:center">'+
      '<span class="u-fs11-gray">Итого выручка</span>'+
      '<span style="font-size:14px;font-weight:700;color:#c8f060;font-family:Unbounded,sans-serif">'+fmt(totalsWood.revenue+totalsDr.revenue)+'</span>'+
    '</div>'+
  '</div>';
  var cashAllTotal = cashWood + cashDr + cashStaff;
  html += block('💵 Остаток нала', row('🌳 Дерево', fmt(cashWood), '#60f090')+row('🛍 ДР Товар', fmt(cashDr), '#60f090')+row('🛒 Покупки сотрудников', fmt(cashStaff), '#a060f0')+divider()+row('Σ Итого по магазину', fmt(cashAllTotal), '#c8f060'), true);
  html += block('📦 Остаток товара', row('🌳 Дерево', fmt(goodsWood), '#f0c060')+row('🛍 ДР Товар', fmt(goodsDr), '#f0c060'));
  function salesTotalsRows(t){
    return row('Сумма к оплате', fmt(t.revenue), '#c8f060')+divider()+
      row('💵 Нал', fmt(t.payTotals.cash))+
      row('💳 Терминал', fmt(t.payTotals.terminal))+
      row('🏦 Перевод', fmt(t.payTotals.transfer))+
      row('🔲 QR / СБП', fmt(t.payTotals.qr+t.payTotals.sbp))+
      (t.payTotals.rs?row('🏦 РС', fmt(t.payTotals.rs)):'')+
      divider()+
      row('🎁 Скидка', fmt(t.discount), '#8888aa')+
      row('📦 Списано со склада (по полной цене)', fmt(t.goodsValue), '#f0c060');
  }
  html += block('💰 Итого продаж — 🌳 Дерево', salesTotalsRows(totalsWood));
  html += block('💰 Итого продаж — 🛍 ДР Товар', salesTotalsRows(totalsDr));
  html += block('🧾 Итого продаж (шт.)',
    row('Всего операций', sales.length)+divider()+
    row('🌳 Дерево — операций / товаров', soldWood.count+' / '+soldWood.qty)+
    row('🛍 ДР Товар — операций / товаров', soldDr.count+' / '+soldDr.qty)
  );
  function itemRow(it){
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #2e2e3e;font-size:12px">'+
      '<span style="flex:1">'+it.name+'</span>'+
      '<span style="color:#8888aa;margin:0 8px">× '+it.qty+'</span>'+
      '<span style="color:#c8f060;font-weight:700">'+fmt(it.amt)+'</span>'+
    '</div>';
  }
  if(soldItemsWoodList.length || soldItemsDrList.length){
    var soldHtml = '';
    if(soldItemsWoodList.length){
      soldHtml += '<div style="font-size:11px;color:#60f090;font-weight:700;margin:6px 0 4px">🌳 ДЕРЕВО</div>'+
        soldItemsWoodList.map(itemRow).join('');
    }
    if(soldItemsDrList.length){
      soldHtml += '<div style="font-size:11px;color:#a060f0;font-weight:700;margin:'+(soldItemsWoodList.length?'10':'6')+'px 0 4px">🛍 ДР ТОВАР</div>'+
        soldItemsDrList.map(itemRow).join('');
    }
    html += block('📦 Проданные товары', soldHtml);
  }
  html += block('🗑 Списания',
    row('Сумма', fmt(woTotal), '#f06060')+row('Кол-во', woQty)+
    (woQty?'<button onclick="toggleTodayDetail(\'wo\')" style="width:100%;margin-top:8px;padding:7px;border-radius:8px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:11px;cursor:pointer">📋 Показать списания</button>':'')+
    '<div id="todayDetail_wo" style="display:none;margin-top:8px">'+
      writeoffs.slice().reverse().map(function(e){
        return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #2e2e3e;font-size:12px"><span style="flex:1">'+(e.sub||e.label||'')+'</span><span style="color:#f06060;font-weight:700">'+fmt(e.amount)+'</span></div>';
      }).join('')+
    '</div>'
  );
  html += block('📥 Приходы',
    row('Сумма', fmt(rcvTotal), '#60c8f0')+row('Кол-во', rcvQty)+
    (rcvQty?'<button onclick="toggleTodayDetail(\'rcv\')" style="width:100%;margin-top:8px;padding:7px;border-radius:8px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:11px;cursor:pointer">📋 Показать приходы</button>':'')+
    '<div id="todayDetail_rcv" style="display:none;margin-top:8px">'+
      receives.slice().reverse().map(function(e){
        return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #2e2e3e;font-size:12px"><span style="flex:1">'+(e.sub||e.label||'')+'</span><span style="color:#60c8f0;font-weight:700">'+fmt(e.amount)+'</span></div>';
      }).join('')+
    '</div>'
  );
  var sid=sidBase;
  html += '<button onclick="var d=document.getElementById(\'det_'+sid+'\');d.style.display=d.style.display===\'none\'?\'block\':\'none\'" '+
    'style="width:100%;padding:9px;border-radius:10px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;cursor:pointer;margin-bottom:6px">'+
    '📒 Полный журнал смены ('+journal.length+')</button>'+
  '<div id="det_'+sid+'" style="display:none">'+
    (journal.length?journal.slice().reverse().map(function(e){
      var icon = (e.type==='sale') ? '💰' : (e.icon||'📌');
      var label = (e.label||'').replace(/\s*⚠️\s*$/,'');
      var time = e.ts ? new Date(e.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) : '';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #2e2e3e;font-size:12px">'+
        '<span style="font-size:13px">'+icon+'</span>'+
        '<span style="flex:1;margin:0 8px;color:'+(e.hasCashDiff?'#f06060':'#f0f0f8')+'">'+label+(e.sub?'<div class="u-fs10-gray">'+e.sub+'</div>':'')+(time?'<div style="font-size:10px;color:#555568">'+time+'</div>':'')+(e.editedAt?'<div style="font-size:10px;color:#f0c060">✏️ изменено</div>':'')+'</span>'+
        (e.amount?'<span style="color:#c8f060;font-weight:600">'+fmt(e.amount)+'</span>':'')+'</div>';
    }).join(''):'<div style="font-size:12px;color:#8888aa;padding:8px">Нет операций</div>')+
  '</div>';
  var auditEntries = _adminAuditLog.filter(function(a){
    return a.shiftId===shift.id && (a.action==='JOURNAL_ENTRY_EDIT' || a.action==='JOURNAL_ENTRY_DELETE');
  });
  if(auditEntries.length){
    html += '<button onclick="var d=document.getElementById(\'audit_'+sid+'\');d.style.display=d.style.display===\'none\'?\'block\':\'none\'" '+
      'style="width:100%;padding:9px;border-radius:10px;border:1px solid #f0a060;background:#2a1e14;color:#f0a060;font-size:12px;font-weight:700;cursor:pointer;margin-bottom:6px">'+
      '📝 Аудит изменений ('+auditEntries.length+')</button>'+
    '<div id="audit_'+sid+'" style="display:none;margin-bottom:10px">'+
      auditEntries.slice().reverse().map(function(a){
        var time=new Date(a.timestamp).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
        if(a.action==='JOURNAL_ENTRY_DELETE'){
          var s=a.details.snapshot||{};
          return '<div style="background:#2e1a1a;border:1px solid #f06060;border-radius:10px;padding:10px;margin-bottom:6px">'+
            '<div style="font-size:11px;color:#f06060;font-weight:700;margin-bottom:4px">🗑 УДАЛЕНО · '+time+' · '+(a.user||'')+'</div>'+
            '<div style="font-size:12px">'+(s.label||a.details.entryType||'')+(s.sub?'<div class="u-fs11-gray">'+s.sub+'</div>':'')+
            (s.amount?'<div style="font-size:12px;color:#f0f0f8;margin-top:2px">Сумма: '+fmt(s.amount)+(s.discount?' · скидка '+fmt(s.discount):'')+'</div>':'')+'</div>'+
          '</div>';
        }
        var b=a.details.before||{}, af=a.details.after||{};
        var changes=[];
        if((b.amount||0)!==(af.amount||0)) changes.push('Сумма: '+fmt(b.amount)+' → '+fmt(af.amount));
        if((b.discount||0)!==(af.discount||0)) changes.push('<span style="color:'+((af.discount||0)>(b.discount||0)?'#f06060':'#60f090')+'">Скидка: '+fmt(b.discount||0)+' → '+fmt(af.discount||0)+'</span>');
        if((b.payMethod||'')!==(af.payMethod||'')) changes.push('Оплата: '+(b.payMethod||'—')+' → '+(af.payMethod||'—'));
        if((b.sub||'')!==(af.sub||'')) changes.push('Состав: «'+(b.sub||'')+'» → «'+(af.sub||'')+'»');
        if(!changes.length) changes.push('Без видимых изменений сумм');
        return '<div style="background:#2a1e14;border:1px solid #f0a060;border-radius:10px;padding:10px;margin-bottom:6px">'+
          '<div style="font-size:11px;color:#f0a060;font-weight:700;margin-bottom:4px">✏️ ИЗМЕНЕНО · '+time+' · '+(a.user||'')+'</div>'+
          '<div style="font-size:12px;color:#f0f0f8">'+changes.join('<br>')+'</div>'+
        '</div>';
      }).join('')+
    '</div>';
  }
  html += '<button onclick="openLiveShiftView(\''+(shift.id||shift._id||'')+'\')" style="width:100%;padding:12px;margin-top:12px;background:#1e2a3e;border:2px solid #60c8f0;border-radius:12px;font-weight:700;font-size:13px;color:#60c8f0;cursor:pointer">📖 Открыть полный журнал смены (редактирование)</button>';
  return html;
}
function openLiveShiftView(id){
  if(!id){ showToast('Смена не найдена'); return; }
  showToast('⏳ Загружаю смену...');
  db.collection('iz_shifts').doc(id).get({source:'server'}).then(function(doc){
    if(!doc.exists){ showToast('Смена не найдена в облаке'); return; }
    var d = doc.data(); d.id = doc.id;
    var shifts = getShifts();
    var idx = shifts.findIndex(function(s){ return (s.id||s._id)===id; });
    if(idx>=0) shifts[idx]=d; else shifts.push(d);
    saveShifts(shifts);
    openShiftView(id);
  }).catch(function(err){
    showToast('⚠️ Не удалось загрузить смену: '+(err&&err.message||err));
  });
}
function toggleTodayDetail(key){
  var d=document.getElementById('todayDetail_'+key);
  if(d) d.style.display = d.style.display==='none'?'block':'none';
}
function toggleSBlock(bid){
  var b=document.getElementById(bid), a=document.getElementById(bid+'_arr'),
      hdr=document.getElementById(bid+'_hdr'), card=document.getElementById(bid+'_card');
  if(!b) return;
  var open = b.style.display!=='none';
  b.style.display = open?'none':'block';
  if(a) a.textContent = open?'▸':'▾';
  if(hdr) hdr.style.marginBottom = open?'0':'8px';
  if(card) card.style.paddingBottom = open?'0':'14px';
}
function _autoRepairStaffRoles(){
  var staff = getStaff();
  var fixed = 0;
  staff.forEach(function(s){
    if(!s.roles || !s.roles.length){
      s.roles = ['seller'];
      fixed++;
      console.log('[autoRepair] fixed:', s.name);
    }
  });
  if(fixed){
    saveStaffShop(staff);
    console.log('[autoRepair] fixed', fixed, 'staff records');
  }
}
var SC_SHOP_COLORS = ['#60f090','#60c8f0','#a060f0','#f0a060','#f06090','#c8f060','#f0c060','#60f0d0'];
function _scShopColor(shopName, shopList){
  var idx = shopList.indexOf(shopName);
  return SC_SHOP_COLORS[idx % SC_SHOP_COLORS.length];
}
function openShiftsCalendar(){
  var now=new Date(), curYear=now.getFullYear(), curMonth=now.getMonth();
  var monthSel=document.getElementById('scMonth');
  if(monthSel) monthSel.innerHTML=RENT_MONTH_NAMES.map(function(n,i){return '<option value="'+i+'"'+(i===curMonth?' selected':'')+'>'+n.charAt(0).toUpperCase()+n.slice(1)+'</option>';}).join('');
  var yearSel=document.getElementById('scYear');
  if(yearSel){
    var years=[]; for(var y=curYear;y>=curYear-3;y--) years.push(y);
    yearSel.innerHTML=years.map(function(y){return '<option value="'+y+'"'+(y===curYear?' selected':'')+'>'+y+'</option>';}).join('');
  }
  var shopSel=document.getElementById('scShopFilter');
  if(shopSel) shopSel.innerHTML='<option value="">Все магазины</option>'+getShopNames().map(function(s){return '<option>'+s+'</option>';}).join('');
  openMo('shiftsCalendarMo');
  renderShiftsCalendar();
}
function renderShiftsCalendar(){
  var body=document.getElementById('scBody'), legend=document.getElementById('scLegend');
  if(!body) return;
  var mIdx=parseInt((document.getElementById('scMonth')||{}).value)||0;
  var year=parseInt((document.getElementById('scYear')||{}).value)||new Date().getFullYear();
  var shopF=(document.getElementById('scShopFilter')||{}).value||'';
  var daysInMonth=new Date(year,mIdx+1,0).getDate();
  var from=year+'-'+String(mIdx+1).padStart(2,'0')+'-01';
  var to=year+'-'+String(mIdx+1).padStart(2,'0')+'-'+String(daysInMonth).padStart(2,'0');
  var shifts=getShifts().filter(function(s){
    return s.date>=from && s.date<=to && (!shopF||s.shopName===shopF) && s.sellerName;
  });
  if(!shifts.length){
    body.innerHTML='<div class="empty"><div class="ei">📅</div>Нет смен за этот месяц'+(shopF?' в «'+shopF+'»':'')+'</div>';
    legend.innerHTML='';
    return;
  }
  var shopList=getShopNames();
  legend.innerHTML=(shopF?[shopF]:shopList).map(function(sh){
    return '<div style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:3px;background:'+_scShopColor(sh,shopList)+';display:inline-block"></span>'+sh+'</div>';
  }).join('');
  var bySeller={};
  shifts.forEach(function(s){
    var nm=(s.sellerName||'').replace(/^Восст\.\s*/,'');
    if(!nm) return;
    if(!bySeller[nm]) bySeller[nm]={};
    if(!bySeller[nm][s.date]) bySeller[nm][s.date]=[];
    bySeller[nm][s.date].push(s.shopName);
  });
  var sellers=Object.keys(bySeller).sort(function(a,b){
    return Object.keys(bySeller[b]).length-Object.keys(bySeller[a]).length;
  });
  var dayNames=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  var html='<div style="display:inline-block;min-width:100%">';
  html+='<div style="display:grid;grid-template-columns:96px repeat('+daysInMonth+',24px);gap:2px;margin-bottom:4px">';
  html+='<div></div>';
  for(var d=1; d<=daysInMonth; d++){
    var dow=new Date(year,mIdx,d).getDay();
    var isWE=dow===0||dow===6;
    html+='<div style="text-align:center;font-size:8px;color:'+(isWE?'#f0a060':'#555568')+'">'+d+'</div>';
  }
  html+='</div>';
  sellers.forEach(function(nm){
    html+='<div style="display:grid;grid-template-columns:96px repeat('+daysInMonth+',24px);gap:2px;margin-bottom:2px;align-items:center">';
    html+='<div style="font-size:10px;color:#f0f0f8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:4px">'+nm+'</div>';
    for(var d2=1; d2<=daysInMonth; d2++){
      var dKey=year+'-'+String(mIdx+1).padStart(2,'0')+'-'+String(d2).padStart(2,'0');
      var worked=bySeller[nm][dKey];
      if(worked && worked.length){
        var multi=worked.length>1;
        var color=multi?'#a060f0':_scShopColor(worked[0],shopList);
        html+='<div title="'+worked.join(', ')+'" style="height:20px;border-radius:4px;background:'+color+';opacity:'+(multi?'1':'0.85')+'"></div>';
      } else {
        html+='<div style="height:20px;border-radius:4px;background:#1a1a22"></div>';
      }
    }
    html+='</div>';
  });
  html+='</div>';
  body.innerHTML=html;
}
function _shiftSetSafe(shiftId, sh, successMsg, errPrefix){
  try{
    db.collection('iz_shifts').doc(shiftId).get({source:'server'}).then(function(snap){
      var dataToSend = sh;
      if(snap.exists){
        var remote = snap.data();
        var remoteJnl = remote.journal||[];
        var localJnl = sh.journal||[];
        var localIds = {}; localJnl.forEach(function(e){ if(e.id) localIds[e.id]=true; });
        var deletedIds = {}; getTombstones().forEach(function(id){ deletedIds[id]=true; });
        var missingFromServer = remoteJnl.filter(function(e){ return e.id && !localIds[e.id] && !deletedIds[e.id]; });
        if(missingFromServer.length){
          var mergedJnl = localJnl.concat(missingFromServer);
          mergedJnl.sort(function(a,b){ return (a.ts||'').localeCompare(b.ts||''); });
          dataToSend = Object.assign({}, sh, {journal: mergedJnl});
          var shifts2 = getShifts();
          var idx2 = shifts2.findIndex(function(s){ return (s.id||s._id)===shiftId; });
          if(idx2>=0){ shifts2[idx2] = dataToSend; saveShifts(shifts2); }
          if(_currentShiftView && (_currentShiftView.id===shiftId||_currentShiftView._id===shiftId)) _currentShiftView = dataToSend;
          showToast('ℹ️ В облаке нашлись записи, которых не было локально — объединила, ничего не потеряно');
        }
      }
      db.collection('iz_shifts').doc(shiftId).set(dataToSend).then(function(){
        if(successMsg) showToast(successMsg);
      }).catch(function(err){
        showToast((errPrefix||'❌ Ошибка: ')+(err&&err.message||err));
      });
    }).catch(function(){
      db.collection('iz_shifts').doc(shiftId).set(sh).then(function(){
        if(successMsg) showToast(successMsg);
      }).catch(function(err2){
        showToast((errPrefix||'❌ Ошибка: ')+(err2&&err2.message||err2));
      });
    });
  }catch(e){
    showToast((errPrefix||'❌ Ошибка: ')+(e&&e.message||e));
  }
}
function svRecoverSalesFromBackup(shiftId){
  var shifts=getShifts();
  var idx=shifts.findIndex(function(s){return (s.id||s._id)===shiftId;});
  if(idx<0){showToast('Смена не найдена');return;}
  var sh=shifts[idx];
  showToast('🔍 Сверяю с подстраховкой...');
  Promise.all([
    db.collection('iz_sales').where('shopName','==',sh.shopName).where('date','==',sh.date).get({source:'server'}),
    db.collection('iz_journal_backup').where('shopName','==',sh.shopName).where('date','==',sh.date).get({source:'server'})
  ]).then(function(results){
      var backupAll = [];
      results[0].forEach(function(doc){ backupAll.push(doc.data()); });
      results[1].forEach(function(doc){ backupAll.push(doc.data()); });
      if(!backupAll.length){ showToast('В подстраховке пока нет записей за этот день'); return; }
      var jnl = sh.journal||[];
      var jnlIds = {}; jnl.forEach(function(e){ if(e.id) jnlIds[e.id]=true; });
      var deletedIds = {}; getTombstones().forEach(function(id){ deletedIds[id]=true; });
      var missing = backupAll.filter(function(s){ return s.id && !jnlIds[s.id] && !deletedIds[s.id]; });
      if(!missing.length){ showToast('✅ Всё сходится — в подстраховке нет ничего лишнего'); return; }
      var total = missing.reduce(function(s,m){ return s+(m.amount||0); },0);
      var kindLabels = {sale:'продаж', expense:'расходов', receive:'приходов', writeoff:'списаний'};
      var byKind = {}; missing.forEach(function(m){ byKind[m.type]=(byKind[m.type]||0)+1; });
      var breakdown = Object.keys(byKind).map(function(k){ return byKind[k]+' '+(kindLabels[k]||k); }).join(', ');
      if(!confirm('Найдено записей: '+breakdown+' (на сумму '+fmt(total)+'), которых нет в этой смене, но они сохранены в подстраховке. Добавить их в смену?')) return;
      var merged = jnl.concat(missing.map(function(m){
        var clean = Object.assign({}, m);
        delete clean.shopName; delete clean.date; delete clean.shiftId; delete clean.recordedAt; delete clean.sellerName; delete clean.kind;
        return clean;
      }));
      merged.sort(function(a,b){ return (a.ts||'').localeCompare(b.ts||''); });
      sh.journal = merged;
      shifts[idx]=sh;
      saveShifts(shifts);
      _shiftSetSafe(shiftId, sh, '✅ Восстановлено записей: '+missing.length+' из подстраховки');
      if(_currentShiftView&&(_currentShiftView.id===shiftId||_currentShiftView._id===shiftId)){
        _currentShiftView=sh;_renderShiftView();
      }
    })
    .catch(function(err){ showToast('❌ Не удалось сверить: '+(err&&err.message||err)); });
}
function svPushToFirestore(shiftId){
  if(!shiftId){showToast('Нет ID смены');return;}
  var shifts=getShifts();
  var sh=shifts.find(function(s){return (s.id||s._id)===shiftId;});
  if(!sh){showToast('Смена не найдена');return;}
  _shiftSetSafe(shiftId, sh, '✅ Смена отправлена в Firestore');
}
function svPromoteToNormal(shiftId){
  if(!confirm('Сделать эту смену обычной? Она начнёт участвовать в сверке кассы и товара с соседними сменами по этому магазину.')) return;
  var shifts=getShifts();
  var idx=shifts.findIndex(function(s){return (s.id||s._id)===shiftId;});
  if(idx<0){showToast('Смена не найдена');return;}
  var sh=shifts[idx];
  delete sh.isRestoreShift;
  delete sh.backfilled;
  if(sh.source==='psj') sh.source='shop';
  if(sh.sellerName){ sh.sellerName = sh.sellerName.replace(/^Восст\.\s*/,''); }
  shifts[idx]=sh;
  saveShifts(shifts);
  _shiftSetSafe(shiftId, sh, '✅ Смена теперь обычная — участвует в сверке');
  if(_currentShiftView&&(_currentShiftView.id===shiftId||_currentShiftView._id===shiftId)){
    _currentShiftView=sh;_renderShiftView();
  }
}
function svBuildExpenseJournalFromLegacy(shiftId){
  var shifts=getShifts();
  var idx=shifts.findIndex(function(s){return (s.id||s._id)===shiftId;});
  if(idx<0){showToast('Смена не найдена');return;}
  var sh=shifts[idx];
  var already = (sh.journal||[]).some(function(e){return e.type==='expense';});
  if(already){ showToast('В журнале уже есть записи расходов — ничего не меняю'); return; }
  if(!confirm('Добавить в журнал этой смены записи расходов на основе сохранённых сумм ЗП/Инкассация/Прочее/ДР? Это исправит расчётный остаток кассы. Действие можно отменить только вручную (удалив добавленные записи).')) return;
  var jnl = sh.journal||[];
  function pushExp(amt, expType, goodsType, cashField){
    if(!amt) return;
    var e = {id:uid(), type:'expense', ts:(sh.date||'')+'T20:00:00.000Z', icon:'💸', expType:expType, goodsType:goodsType, amount:amt,
      cashEffect:0, cashDrEffect:0, cardEffect:0, staffEffect:0, goodsEffect:0, restoredFromLegacy:true};
    e[cashField] = -amt;
    jnl.push(e);
  }
  pushExp(sh.zp, 'zp', 'derevo', 'cashEffect');
  pushExp(sh.inkass, 'inkass', 'derevo', 'cashEffect');
  pushExp(sh.otherExp, 'other', 'derevo', 'cashEffect');
  pushExp(sh.drInkass, 'inkass', 'dr', 'cashDrEffect');
  pushExp(sh.drSupplierAmt, 'supplier', 'dr', 'cashDrEffect');
  sh.journal = jnl;
  shifts[idx]=sh;
  saveShifts(shifts);
  _shiftSetSafe(shiftId, sh, '✅ Записи расходов добавлены в журнал — касса пересчитана');
  if(_currentShiftView&&(_currentShiftView.id===shiftId||_currentShiftView._id===shiftId)){
    _currentShiftView=sh;_renderShiftView();
  }
}
function svRepairExpenses(shiftId){
  var shifts=getShifts();
  var idx=shifts.findIndex(function(s){return (s.id||s._id)===shiftId;});
  if(idx<0){showToast('Смена не найдена');return;}
  var sh=shifts[idx];
  var exps=sh.journal?sh.journal.filter(function(e){return e.type==='expense';}):[];
  if(!exps.length&&!(sh.expenses&&sh.expenses.length)){showToast('Нет расходов для пересчёта');return;}
  var src=sh.expenses&&sh.expenses.length?sh.expenses:exps;
  var zpR=0,travR=0,inkR=0,othR=0;
  src.forEach(function(e){
    var t=e.expType||'other',a=e.amount||0;
    if(t==='zp')zpR+=a;
    else if(t==='travel')travR+=a;
    else if(t==='inkass')inkR+=a;
    else othR+=a;
  });
  sh.zp=zpR;sh.travel=travR;sh.inkass=inkR;sh.otherExp=othR;
  shifts[idx]=sh;
  saveShifts(shifts);
  _shiftSetSafe(shiftId, sh, '✅ Расходы пересчитаны');
  if(_currentShiftView&&(_currentShiftView.id===shiftId||_currentShiftView._id===shiftId)){
    _currentShiftView=sh;_renderShiftView();
  }
}
function renderJournal(){
  const c=document.getElementById('journalList');
  if(!journal.length){ c.innerHTML='<div class="empty"><div class="ei">📋</div>Начните фиксировать операции</div>'; return; }
  c.innerHTML=[...journal].reverse().map(e=>{
    var icon = (e.type==='sale') ? '💰' : (e.icon||'📌');
    var label = (e.label||'').replace(/\s*⚠️\s*$/,'');
    return `
    <div class="ji">
      <div class="ji-ic ${e.type}">${icon}</div>
      <div class="ji-body">
        <div class="ji-title" style="color:${e.hasDiff?'#f06060':'inherit'}">${label}</div>
        ${e.sub?`<div class="ji-sub">${e.sub}</div>`:''}
        <div class="ji-time">${new Date(e.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;margin-left:6px">
        ${e.amount?`<div class="ji-amt ${e.amtCls||'neu'}">${e.amtSign||''}${fmt(e.amount)}</div>`:''}
        ${e.type!=='open'?`<div style="display:flex;gap:4px">
          ${e.type==='sale'?`<button onclick="editJournalSale('${e.id}')" style="background:none;border:1px solid #3e3e4e;border-radius:6px;padding:3px 6px;color:#c8f060;font-size:11px;cursor:pointer">✏️</button>`:''}
          <button onclick="deleteJournalEntryShop('${e.id}')" style="background:none;border:1px solid #3e2e2e;border-radius:6px;padding:3px 6px;color:#f06060;font-size:11px;cursor:pointer">✕</button>
        </div>`:''}
      </div>
    </div>`;}).join('');
}
function renderMorningCashDiffBanner(){
  var c = document.getElementById('morningCashDiffBanner'); if(!c) return;
  if(!session || session.isPreview){ c.innerHTML=''; return; }
  var chk = getMorningCashDiff();
  if(!chk.hasDiff){ c.innerHTML=''; return; }
  c.innerHTML = '<div style="background:#2e1a1a;border:2px solid #f06060;border-radius:14px;padding:14px;margin-bottom:12px">'+
    '<div style="font-size:12px;font-weight:700;color:#f06060;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">⚠️ Расхождение нала на утро</div>'+
    chk.parts.map(function(p){
      return '<div style="font-size:12.5px;color:#f0f0f8;padding:4px 0;border-bottom:1px solid #3e2e2e">'+
        p.label+': введено <b>'+fmt(p.morning)+'</b>, было на вечер вчера <b>'+fmt(p.prevEvening)+'</b> ('+(p.diff>0?'+':'')+fmt(p.diff)+')'+
      '</div>';
    }).join('')+
    '<div style="font-size:11.5px;color:#f0a0a0;margin:8px 0">Если это опечатка — исправьте сумму ниже. Если расхождение реальное (недостача/излишек) — сообщите управляющему, причина будет видна в отчёте.</div>'+
    '<button class="btn" style="margin:0;background:#f06060;color:#1a0808" onclick="openMo(\'fixMorningCashMo\');renderFixMorningCashForm()">✏️ Исправить нал утро</button>'+
  '</div>';
}
function renderFixMorningCashForm(){
  var chk = getMorningCashDiff();
  var c = document.getElementById('fixMorningCashFields'); if(!c) return;
  c.innerHTML = chk.parts.map(function(p){
    var fieldId = p.label.indexOf('Дерево')>=0 ? 'fixCashMorningWood' : p.label.indexOf('ДР')>=0 ? 'fixCashMorningDr' : 'fixCashMorningStaff';
    return '<div style="margin-bottom:10px">'+
      '<div style="font-size:11px;color:#8888aa;margin-bottom:4px">'+p.label+' — было на вечер вчера: '+fmt(p.prevEvening)+'</div>'+
      '<input class="fi" type="text" id="'+fieldId+'" value="'+p.morning+'" inputmode="numeric" style="margin:0">'+
    '</div>';
  }).join('');
}
function saveFixMorningCash(){
  var w = document.getElementById('fixCashMorningWood');
  var d = document.getElementById('fixCashMorningDr');
  var s = document.getElementById('fixCashMorningStaff');
  if(w) session.cashMorning = parseFloat(w.value)||0;
  if(d) session.cashDrMorning = parseFloat(d.value)||0;
  if(s) session.cashStaffMorning = parseFloat(s.value)||0;
  saveS(); syncLiveShift();
  closeMo('fixMorningCashMo');
  renderMorningCashDiffBanner();
  renderClose();
  showToast('✅ Нал утро обновлён');
}
function renderPendingAlert(){
  const c=document.getElementById('pendingAlert'); if(!c)return;
  let html = '';
  const p=getInvoices().filter(i=>i.destName===(session&&session.shopName)&&i.status==='pending');
  if(p.length) html+=`<div class="al-warn" style="cursor:pointer" onclick="showPg('invoices',document.querySelectorAll('#mainTabs .tab')[2]);switchRcvMainTab('intake');renderInvoices()">🔔 ${p.length} накладная ожидает приёмки</div>`;
  if(getShopType((session&&session.shopName))==='shop'){
    var notifs=JSON.parse(localStorage.getItem('iz_shop_notifications')||'[]')
      .filter(function(n){ return n.sourceShop===(session&&session.shopName) && !n.shopAcked; });
    if(notifs.length) html+=`<div class="al-warn" style="cursor:pointer" onclick="showOnlineSaleNotifs()">
      📦 ${notifs.length} онлайн-продажа — упакуйте отправку
    </div>`;
  }
  c.innerHTML = html;
}
function showOnlineSaleNotifs(){
  var notifs=JSON.parse(localStorage.getItem('iz_shop_notifications')||'[]')
    .filter(function(n){ return n.sourceShop===(session&&session.shopName) && !n.shopAcked; });
  if(!notifs.length) return;
  var lines = notifs.map(function(n,i){
    var itemLines = n.items.map(function(it){ return it.name; }).join(', ');
    var chan = n.orderChannel ? ' ['+n.orderChannel+']' : '';
    var who = n.customerName ? ' · '+n.customerName : '';
    var phone = n.recipientPhone ? ' · тел. '+n.recipientPhone : '';
    var addr = n.deliveryAddress ? ' · доставка: '+n.deliveryAddress : '';
    var cmt = n.orderComment ? ' · комментарий: '+n.orderComment : '';
    return (i+1)+'.'+chan+' '+n.fromChannel+' ('+n.sellerName+'): '+itemLines+who+phone+addr+cmt;
  });
  var msgText = '📦 Онлайн-продажи — упакуйте отправку:\n\n' + lines.join('\n\n') + '\n\nУбрать товар с прилавка и подтвердить?';
  if(confirm(msgText)){
    var all=JSON.parse(localStorage.getItem('iz_shop_notifications')||'[]');
    notifs.forEach(function(n){
      var idx=all.findIndex(function(a){return a.id===n.id;});
      if(idx>=0) all[idx].shopAcked=true;
    });
    localStorage.setItem('iz_shop_notifications',JSON.stringify(all));
    renderPendingAlert();
    showToast('Подтверждено');
  }
}
function renderClose(){
  if(!session) return;
  var t = calcTotals();
  var sales = journal.filter(function(e){ return e.type==='sale'; });
  var expenses = journal.filter(function(e){ return e.type==='expense'; });
  var writeoffs = journal.filter(function(e){ return e.type==='writeoff'; });
  var receives = journal.filter(function(e){ return e.type==='receive'; });
  var staffP = journal.filter(function(e){ return e.type==='staff'; });
  var _sellerSummary = calcSellerSummary();
  var discWoodTotal = _sellerSummary.wood.discount;
  var discDrTotal = _sellerSummary.dr.discount;
  var totalRev = _sellerSummary.wood.listPrice + _sellerSummary.dr.listPrice;
  var staffTotal = staffP.reduce(function(s,e){ return s+e.amount; },0);
  var zp = expenses.filter(function(e){return e.expType==='zp';}).reduce(function(s,e){return s+e.amount;},0);
  var travel = expenses.filter(function(e){return e.expType==='travel';}).reduce(function(s,e){return s+e.amount;},0);
  var inkass = expenses.filter(function(e){return e.expType==='inkass';}).reduce(function(s,e){return s+e.amount;},0);
  var other = expenses.filter(function(e){return e.expType==='other';}).reduce(function(s,e){return s+e.amount;},0);
  var totalWo = writeoffs.reduce(function(s,e){return s+(e.amount||0);},0);
  var totalRcv = receives.reduce(function(s,e){return s+(e.goodsEffect||0);},0);
  var nm = document.getElementById('closeNalMorn');
  if(nm) nm.textContent = fmt(session.cashMorning||0);
  var drNm = document.getElementById('closeDrNalMorn');
  if(drNm) drNm.textContent = fmt(session.cashDrMorning||0);
  var gm = document.getElementById('closeGoodsMorn');
  if(gm) gm.textContent = fmt(session.goodsMorning||0);
  var ge = document.getElementById('closeGoodsEve');
  if(ge) ge.textContent = fmt(t.goods);
  var tr = document.getElementById('closeTotalRev');
  if(tr) tr.textContent = fmt(totalRev);
  var shopType2 = session.shopType || getShopType(session.shopName||'');
  var isShopType2 = shopType2 === 'shop';
  var woodCassaBlock = document.querySelector('#acc_close_wood > div[style*="background:#1e2a14"]:first-of-type');
  var closeCassaWood = document.getElementById('closeCassaWood');
  if(closeCassaWood) closeCassaWood.style.display = isShopType2 ? 'block' : 'none';
  var drCassaBlock = document.getElementById('closeDrCassaBlock');
  if(drCassaBlock) drCassaBlock.style.display = isShopType2 ? 'block' : 'none';
  var drNalMorn = document.getElementById('closeDrNalMorn');
  if(drNalMorn && isShopType2) drNalMorn.textContent = fmt(session.cashDrMorning||0);
  var drWo = writeoffs.filter(function(e){ return e.goodsType==='dr'; });
  var drRcv = receives.filter(function(e){ return e.goodsType==='dr'; });
  var sd = document.getElementById('closeSalesDetail');
  if(sd){
    var wPay = _sellerSummary.wood.pay;
    var wBeznal = wPay.terminal + wPay.sbp + wPay.qr;
    var wTotalRev = _sellerSummary.wood.listPrice;
    var R = function(label,val,color){ return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #2e2e3e"><span style="color:#8888aa">'+label+'</span><span style="color:'+(color||'#f0f0f8')+'">'+fmt(val)+'</span></div>'; };
    sd.innerHTML =
      R('💵 Нал', wPay.cash, '#60f090') +
      R('🏦 Перевод', wPay.transfer, '#60c8f0') +
      '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #2e2e3e"><span style="color:#8888aa">💳 Безнал</span><span style="color:#60c8f0">'+fmt(wBeznal)+'</span></div>'+
      '<div style="padding:2px 0 4px 12px;border-bottom:1px solid #2e2e3e">'+
        '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:#555568"><span>Терминал</span><span>'+fmt(wPay.terminal)+'</span></div>'+
        '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:#555568"><span>СБП</span><span>'+fmt(wPay.sbp)+'</span></div>'+
        '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:#555568"><span>QR</span><span>'+fmt(wPay.qr)+'</span></div>'+
      '</div>'+
      R('🎁 Скидка', discWoodTotal, '#8888aa') +
      '<div style="display:flex;justify-content:space-between;font-size:14px;padding:7px 0;font-weight:700"><span>Итого выручка</span><span style="color:#60c8f0">'+fmt(wTotalRev)+'</span></div>';
  }
  var ed = document.getElementById('closeExpDetail');
  if(ed) ed.innerHTML =
    '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #2e2e3e"><span style="color:#8888aa">💰 ЗП</span><span style="color:#f0a060;font-weight:700">'+fmt(zp)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #2e2e3e"><span style="color:#8888aa">🚌 Проезд</span><span style="color:#f0a060">'+fmt(travel)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #2e2e3e"><span style="color:#8888aa">🏦 Инкассация</span><span style="color:#f0a060">'+fmt(inkass)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span style="color:#8888aa">📝 Прочее</span><span style="color:#f0a060">'+fmt(other)+'</span></div>'+
    (expenses.filter(function(e){return e.expType==='other'&&e.comment;}).map(function(e){return '<div style="font-size:11px;color:#555568;padding:2px 0">· '+e.comment+'</div>';}).join(''));
  var wd = document.getElementById('closeWoDetail');
  if(wd){
    var woTotal = writeoffs.reduce(function(s,w){return s+(w.amount||0);},0);
    wd.innerHTML = writeoffs.length
      ? writeoffs.map(function(w){ return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #2e2e3e"><span style="color:#8888aa">'+(w.sub||w.label)+'</span><span style="color:#f06060">'+fmt(w.amount)+'</span></div>'; }).join('')
        + '<div style="display:flex;justify-content:space-between;font-size:14px;padding:6px 0;font-weight:700"><span>Итого</span><span style="color:#f06060">'+fmt(woTotal)+'</span></div>'
      : '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span style="color:#8888aa">Списаний за смену</span><span style="color:#f06060">0₽</span></div>';
  }
  var rd = document.getElementById('closeRcvDetail');
  if(rd){
    var rcvTotal = receives.reduce(function(s,r){return s+(r.goodsEffect||0);},0);
    rd.innerHTML = receives.length
      ? receives.map(function(r){ return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #2e2e3e"><span style="color:#8888aa">'+(r.sub||r.label)+'</span><span style="color:#60f090">+'+fmt(r.goodsEffect||0)+'</span></div>'; }).join('')
        + '<div style="display:flex;justify-content:space-between;font-size:14px;padding:6px 0;font-weight:700"><span>Итого</span><span style="color:#60f090">+'+fmt(rcvTotal)+'</span></div>'
      : '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span style="color:#8888aa">Приходов за смену</span><span style="color:#60f090">0₽</span></div>';
  }
  var stD = document.getElementById('closeStaffDetail');
  if(stD) stD.innerHTML = staffP.length
    ? staffP.map(function(s){ return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #2e2e3e"><span style="color:#8888aa">'+s.label+'</span><span style="color:#a060f0">'+fmt(s.amount)+'</span></div>'; }).join('')
      + '<div style="display:flex;justify-content:space-between;font-size:14px;padding:6px 0;font-weight:700"><span>Итого</span><span style="color:#a060f0">'+fmt(staffTotal)+'</span></div>'
    : '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span style="color:#8888aa">Покупок сотрудников</span><span style="color:#a060f0">0₽</span></div>';
  var drSd = document.getElementById('closeDrSalesDetail');
  if(drSd){
    var drPay = _sellerSummary.dr.pay;
    var drBeznal = drPay.terminal + drPay.sbp + drPay.qr;
    var drTotalRev = _sellerSummary.dr.listPrice;
    var Rd = function(label,val,color){ return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #2e2e3e"><span style="color:#8888aa">'+label+'</span><span style="color:'+(color||'#f0f0f8')+'">'+fmt(val)+'</span></div>'; };
    drSd.innerHTML =
      Rd('💵 Нал', drPay.cash, '#60f090') +
      Rd('🏦 Перевод', drPay.transfer, '#60c8f0') +
      '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #2e2e3e"><span style="color:#8888aa">💳 Безнал</span><span style="color:#60c8f0">'+fmt(drBeznal)+'</span></div>'+
      '<div style="padding:2px 0 4px 12px;border-bottom:1px solid #2e2e3e">'+
        '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:#555568"><span>Терминал</span><span>'+fmt(drPay.terminal)+'</span></div>'+
        '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:#555568"><span>СБП</span><span>'+fmt(drPay.sbp)+'</span></div>'+
        '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:#555568"><span>QR</span><span>'+fmt(drPay.qr)+'</span></div>'+
      '</div>'+
      Rd('🎁 Скидка', discDrTotal, '#8888aa') +
      '<div style="display:flex;justify-content:space-between;font-size:14px;padding:7px 0;font-weight:700"><span>Итого выручка</span><span style="color:#60c8f0">'+fmt(drTotalRev)+'</span></div>';
  }
  var drWod = document.getElementById('closeDrWoDetail');
  if(drWod){
    var drWoTotal = drWo.reduce(function(s,w){return s+(w.amount||0);},0);
    drWod.innerHTML = drWo.length
      ? drWo.map(function(w){ return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #2e2e3e"><span style="color:#8888aa">'+(w.sub||w.label||'Списание')+'</span><span style="color:#f06060">'+fmt(w.amount)+'</span></div>'; }).join('')
        + '<div style="display:flex;justify-content:space-between;font-size:14px;padding:6px 0;font-weight:700"><span>Итого</span><span style="color:#f06060">'+fmt(drWoTotal)+'</span></div>'
      : '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span style="color:#8888aa">Списаний за смену</span><span style="color:#f06060">0₽</span></div>';
  }
  var drRd = document.getElementById('closeDrRcvDetail');
  if(drRd){
    var drRcvTotal = drRcv.reduce(function(s,r){return s+(r.goodsEffect||0);},0);
    drRd.innerHTML = drRcv.length
      ? drRcv.map(function(r){ return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #2e2e3e"><span style="color:#8888aa">'+(r.sub||r.label||'Приход')+'</span><span style="color:#60f090">+'+fmt(r.goodsEffect||0)+'</span></div>'; }).join('')
        + '<div style="display:flex;justify-content:space-between;font-size:14px;padding:6px 0;font-weight:700"><span>Итого</span><span style="color:#60f090">+'+fmt(drRcvTotal)+'</span></div>'
      : '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span style="color:#8888aa">Приходов за смену</span><span style="color:#60f090">0₽</span></div>';
  }
  var drInkass = expenses.filter(function(e){return e.expType==='inkass'&&e.goodsType==='dr';}).reduce(function(s,e){return s+e.amount;},0);
  var drSupplierExp = expenses.filter(function(e){return e.expType==='supplier'&&e.goodsType==='dr';}).reduce(function(s,e){return s+e.amount;},0);
  var drExpD = document.getElementById('closeDrExpDetail');
  if(drExpD) drExpD.innerHTML =
    '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #2e2e3e"><span style="color:#8888aa">🏦 Инкассация</span><span style="color:#f0a060;font-weight:700">'+fmt(drInkass)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span style="color:#8888aa">🏭 Оплата поставщику</span><span style="color:#f0a060;font-weight:700">'+fmt(drSupplierExp)+'</span></div>';
  var drStaffP = staffP.filter(function(e){ return e.goodsType==='dr'; });
  var drStaffTotal = drStaffP.reduce(function(s,e){return s+e.amount;},0);
  var drStD = document.getElementById('closeDrStaffDetail');
  if(drStD) drStD.innerHTML = drStaffP.length
    ? drStaffP.map(function(s){ return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #2e2e3e"><span style="color:#8888aa">'+s.label+'</span><span style="color:#a060f0">'+fmt(s.amount)+'</span></div>'; }).join('')
      + '<div style="display:flex;justify-content:space-between;font-size:14px;padding:6px 0;font-weight:700"><span>Итого</span><span style="color:#a060f0">'+fmt(drStaffTotal)+'</span></div>'
    : '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span style="color:#8888aa">Покупок сотрудников</span><span style="color:#a060f0">0₽</span></div>';
  var stfNm = document.getElementById('closeStaffNalMorn');
  if(stfNm) stfNm.textContent = fmt(session.cashStaffMorning||0);
  var allStD = document.getElementById('closeAllStaffDetail');
  if(allStD) allStD.innerHTML = staffP.length
    ? staffP.map(function(s){ return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #2e2e3e"><span style="color:#8888aa">'+s.label+'</span><span style="color:#a060f0">'+fmt(s.amount)+'</span></div>'; }).join('')
      + '<div style="display:flex;justify-content:space-between;font-size:14px;padding:6px 0;font-weight:700"><span>Итого</span><span style="color:#a060f0">'+fmt(staffTotal)+'</span></div>'
    : '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span style="color:#8888aa">Покупок сотрудников</span><span style="color:#a060f0">0₽</span></div>';
  var title = document.getElementById('closeShiftTitle');
  if(title) title.textContent = 'Закрытие смены · ' + (session.shopName||'');
  var sumEl = document.getElementById('closeSummary');
  if(sumEl){
    var woodRev = _sellerSummary.wood.listPrice;
    var drRev = _sellerSummary.dr.listPrice;
    var zpFact = expenses.filter(function(e){return e.expType==='zp';}).reduce(function(a,e){return a+e.amount;},0);
    var totalExpWood = expenses.filter(function(e){return !e.goodsType||e.goodsType==='derevo';}).reduce(function(a,e){return a+e.amount;},0);
    var totalExpDr = expenses.filter(function(e){return e.goodsType==='dr';}).reduce(function(a,e){return a+e.amount;},0);
    var woWood = writeoffs.filter(function(e){return !e.goodsType||e.goodsType==='derevo';}).reduce(function(a,e){return a+(e.amount||0);},0);
    var woDr = writeoffs.filter(function(e){return e.goodsType==='dr';}).reduce(function(a,e){return a+(e.amount||0);},0);
    var rcvWood = receives.filter(function(e){return !e.goodsType||e.goodsType==='derevo';}).reduce(function(a,e){return a+(e.goodsEffect!=null?e.goodsEffect:0);},0);
    var rcvDr = receives.filter(function(e){return e.goodsType==='dr';}).reduce(function(a,e){return a+(e.goodsDrEffect!=null?e.goodsDrEffect:(e.goodsEffect||0));},0);
    var cashEveEntered = parseFloat((document.getElementById('cashEveInput')||{}).value)||0;
    var drGoodsEve = (session.goodsDrMorning||0)+rcvDr-_sellerSummary.dr.listPrice-woDr;
    var drCashMorn = session.cashDrMorning||0;
    var drCashEveEntered = parseFloat((document.getElementById('drCashEveInput')||{}).value)||0;
    var drCassaBlockEl2 = document.getElementById('closeDrCassaBlock');
    var isShopType2DrCassa = drCassaBlockEl2 && drCassaBlockEl2.style.display !== 'none';
    var _bothEveEntered = !!cashEveEntered && (!isShopType2DrCassa || !!drCashEveEntered);
    var _cashDiffNow = _bothEveEntered ? Math.round(cashEveEntered - t.cash) : null;
    var _cashDrDiffNow = (_bothEveEntered && isShopType2DrCassa) ? Math.round(drCashEveEntered - t.cashDr) : null;
    var _morningChk = getMorningCashDiff();
    var _statusDiff = (_cashDiffNow!=null && Math.abs(_cashDiffNow)>=1) || (_cashDrDiffNow!=null && Math.abs(_cashDrDiffNow)>=1) || _morningChk.hasDiff;
    var _statusUnknown = !_bothEveEntered && !_morningChk.hasDiff;
    var _issuesListHtml = _morningChk.hasDiff
      ? '<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #4a2a2a">'+
          _morningChk.parts.map(function(p){ return '<div style="font-size:11px;color:#f0a0a0;padding:3px 0">• '+p.label+': нал утро не сходится с вечером пред. смены</div>'; }).join('')+
        '</div>'
      : '';
    function _tblRow(label, woodVal, drVal, opts){
      opts = opts||{};
      return '<div style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:0 8px;padding:'+(opts.pad||'5px')+' 0;'+(opts.border?'border-top:1px solid #2e2e3e;margin-top:4px;padding-top:8px':'')+'">'+
        '<div style="font-size:'+(opts.bold?'12.5px':'12px')+';color:'+(opts.bold?'#f0f0f8':'#8888aa')+';font-weight:'+(opts.bold?'700':'400')+'">'+label+'</div>'+
        '<div style="font-size:'+(opts.bold?'12.5px':'12px')+';font-weight:'+(opts.bold?'700':'600')+';color:'+(opts.color||'#f0f0f8')+'">'+woodVal+'</div>'+
        '<div style="font-size:'+(opts.bold?'12.5px':'12px')+';font-weight:'+(opts.bold?'700':'600')+';color:'+(opts.color||'#f0f0f8')+'">'+drVal+'</div>'+
      '</div>';
    }
    function _sectHdr(label, color){
      return '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:'+color+';margin:10px 0 4px">'+label+'</div>';
    }
    sumEl.innerHTML =
      '<div style="background:#1e2a14;border:2px solid #c8f060;border-radius:14px;padding:14px;margin-bottom:16px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:'+(_statusUnknown?'#8888aa':(_statusDiff?'#f06060':'#60f090'))+'">'+
          (_statusUnknown?'⏳ ОЖИДАЕТ ВВОДА':(_statusDiff?'⚠️ ЕСТЬ НЕСОВПАДЕНИЯ':'✅ ВСЁ СХОДИТСЯ'))+
        '</div>'+
        '<div style="font-size:10.5px;color:#8888aa">📊 '+session.shopName+'</div>'+
      '</div>'+
      _issuesListHtml +
      '<div style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:0 8px;margin-bottom:4px">'+
        '<div></div><div style="font-size:10px;color:#c8f060;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🌳 Дерево</div><div style="font-size:10px;color:#a060f0;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🛍 ДР Товар</div>'+
      '</div>'+
        _sectHdr('💰 Продажи', '#60c8f0') +
        _tblRow('Выручка', fmt(woodRev), fmt(drRev), {bold:true,color:'#60c8f0'}) +
        _tblRow('Кол-во', _sellerSummary.wood.count+' шт.', _sellerSummary.dr.count+' шт.') +
        _sectHdr('📦 Товар', '#f0a060') +
        _tblRow('Остаток утро', fmt(session.goodsMorning||0), fmt(session.goodsDrMorning||0)) +
        _tblRow('Остаток вечер', fmt(t.goods), fmt(drGoodsEve), {color:'#c8f060'}) +
        _tblRow('Приход', fmt(rcvWood), fmt(rcvDr), {color:'#60f090'}) +
        _tblRow('Списание', fmt(woWood), fmt(woDr), {color:'#f06060'}) +
        _sectHdr('💵 Касса', '#60c8f0') +
        _tblRow('Нал утро', fmt(session.cashMorning||0), fmt(drCashMorn), _morningChk.hasDiff?{color:'#f06060'}:{}) +
        _tblRow('Нал вечер',
          cashEveEntered?fmt(cashEveEntered):'<span style="color:#555568">не введён</span>',
          drCashEveEntered?fmt(drCashEveEntered):'<span style="color:#555568">не введён</span>',
          {color:'#c8f060'}) +
        _sectHdr('💸 Расходы', '#f06060') +
        _tblRow('Итого расходы', fmt(totalExpWood), fmt(totalExpDr), {color:'#f0a060'}) +
        _sectHdr('💰 ЗП', '#f0c060') +
        (function(){
          var discWood = discWoodTotal;
          var discDr   = discDrTotal;
          var netWood = woodRev - discWood;
          var netDr   = drRev - discDr;
          var totalNet = netWood + netDr;
          var totalGross = woodRev + drRev;
          var zpCalcWood = 0, zpCalcDr = 0, zpCalcTotal = 0;
          var zpSettings = JSON.parse(localStorage.getItem('iz_shop_zp_settings')||'{}');
          var s = zpSettings[session.shopName] || null;
          var base = s ? numDef(s.base, 1500) : 1500;
          var thresh = s ? numDef(s.threshold, 5000) : 5000;
          var pctNorm = s ? (numDef(s.pct, 8)/100) : 0.08;
          var highEnabled = s ? ((s.highEnabled !== undefined) ? s.highEnabled : !!s.highThreshold) : false;
          var highThresh = (s && highEnabled) ? numDef(s.highThreshold, 20000) : null;
          var pctHigh = s ? (numDef(s.highPct, 10)/100) : 0.10;
          if(!s){
            var shopN = (session.shopName||'').toLowerCase();
            if(shopN.indexOf('горк') >= 0){
              base=2000; thresh=0; pctNorm=0.08; highThresh=20000; pctHigh=0.10;
            } else { base=1500; thresh=5000; pctNorm=0.08; }
          }
          var highThreshGross = s ? ((s.highThreshGross !== undefined) ? s.highThreshGross : true) : true;
  var highThreshBasis = highThreshGross ? totalGross : totalNet;
  var pct = (highThresh!==null && highThreshBasis >= highThresh) ? pctHigh : pctNorm;
          if(totalNet < thresh){
            zpCalcWood = base; zpCalcDr = 0;
          } else {
            zpCalcWood = base + netWood * pct;
            zpCalcDr   = netDr * pct;
          }
          zpCalcTotal = zpCalcWood + zpCalcDr + travel;
          var fmt2 = function(n){ return Math.round(n).toLocaleString('ru-RU')+'₽'; };
          var zpSet = JSON.parse(localStorage.getItem('iz_shop_zp_settings')||'{}');
          var travelCalc = (zpSet[session.shopName] && zpSet[session.shopName].travel) ? zpSet[session.shopName].travel : 0;
          var travelFact = travel; // проезд факт — реально взято из журнала расходов
          var zpFactTotal = zpFact; // ЗП факт взято
          var zpCalcWithTravel = zpCalcWood + zpCalcDr + travelCalc;
          var diff = zpCalcWithTravel - (zpFactTotal + travelFact);
          var diffColor = diff > 0 ? '#f06060' : diff < 0 ? '#60f090' : '#8888aa';
          var _C2 = function(val, color, bold){
            return '<div style="grid-column:2 / span 2;text-align:center;font-size:'+(bold?'13px':'12px')+';font-weight:'+(bold?'700':'600')+';color:'+(color||'#f0f0f8')+'">'+(typeof val==='string'?val:fmt2(val))+'</div>';
          };
          var _rowC2 = function(label, val, color, bold, opts){
            opts = opts||{};
            return '<div style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:0 8px;padding:'+(opts.pad||'5px')+' 0;'+(opts.border?'border-top:'+(opts.border)+' solid #2e2e3e;margin-top:4px;padding-top:8px':'')+'">'+
              '<div style="font-size:'+(bold?'13px':'12px')+';color:'+(bold?'#f0f0f8':'#8888aa')+';font-weight:'+(bold?'700':'400')+'">'+label+'</div>'+
              _C2(val, color, bold)+
            '</div>';
          };
          return (
            _tblRow('Расчётная', fmt2(zpCalcWood), fmt2(zpCalcDr), {color:'#c8f060'}) +
            _rowC2('Проезд расчётный', fmt2(travelCalc), '#f0a060') +
            _rowC2('Факт (взято)', fmt(zpFactTotal), '#f0a060', false, {border:'1px'}) +
            _rowC2('Проезд факт', fmt(travelFact), '#f0a060') +
            _rowC2('Разница ЗП+проезд', (diff>0?'+':'')+fmt2(diff), diffColor, true, {border:'2px'})
          );
        })() +
      '</div>';
  }
}
function validateClose(){
  const morningChk = getMorningCashDiff();
  const btn0 = document.getElementById('closeShiftBtn');
  const cv0 = document.getElementById('cashValidation');
  if(morningChk.hasDiff){
    if(cv0) cv0.innerHTML = '<div style="background:#2e1a1a;border:2px solid #f06060;border-radius:12px;padding:14px;text-align:center">'+
      '<div style="font-size:15px;font-weight:700;color:#f06060;margin-bottom:8px">⛔ Нал утро не сходится с вечером пред. смены</div>'+
      '<div style="font-size:12.5px;color:#f0f0f8;margin-bottom:10px">'+morningChk.parts.map(function(p){return p.label;}).join(', ')+'</div>'+
      '<button class="btn" style="margin:0;background:#f06060;color:#1a0808" onclick="openMo(\'fixMorningCashMo\');renderFixMorningCashForm()">✏️ Исправить нал утро</button>'+
    '</div>';
    if(btn0){ btn0.disabled=true; btn0.style.opacity='.5'; }
    renderClose();
    return;
  }
  const t = calcTotals();
  const expectedCash = t.cash;
  const expectedCashDr = t.cashDr;
  const expectedCashStaff = (session.cashStaffMorning||0) + t.staff;
  const cashEveVal = (document.getElementById('cashEveInput')||{}).value||'';
  const cashEve = parseFloat(cashEveVal)||0;
  const cv = document.getElementById('cashValidation');
  const crb = document.getElementById('cashDiffReasonBlock');
  const btn = document.getElementById('closeShiftBtn');
  const drBlock = document.getElementById('closeDrCassaBlock');
  const drBlockVisible = drBlock && drBlock.style.display !== 'none';
  const drCashEveVal = (document.getElementById('drCashEveInput')||{}).value||'';
  const drCashEve = parseFloat(drCashEveVal)||0;
  const drCv = document.getElementById('drCashValidation');
  const staffCashEveVal = (document.getElementById('staffCashEveInput')||{}).value||'';
  const staffCashEve = parseFloat(staffCashEveVal)||0;
  const staffCv = document.getElementById('staffCashValidation');
  var hasStaffPurchases = journal.some(function(e){return e.type==='staff';});
  var staffCashEveRequired = hasStaffPurchases || (session.cashStaffMorning||0) > 0;
  if(!cashEveVal || (drBlockVisible && !drCashEveVal) || (staffCashEveRequired && !staffCashEveVal)){
    if(cv) cv.innerHTML = '';
    if(drCv) drCv.innerHTML = '';
    if(staffCv) staffCv.innerHTML = '';
    if(crb) crb.style.display = 'none';
    if(btn){ btn.disabled=true; btn.style.opacity='.5'; }
    return;
  }
  const diff = Math.round(cashEve - expectedCash);
  const hasDiff = Math.abs(diff) >= 1;
  const diffDr = Math.round(drCashEve - expectedCashDr);
  const hasDiffDr = drBlockVisible && Math.abs(diffDr) >= 1;
  const diffStaff = Math.round(staffCashEve - expectedCashStaff);
  const hasDiffStaff = Math.abs(diffStaff) >= 1;
  if(hasDiff){
    if(cv) cv.innerHTML = `<div style="background:#2e1a1a;border:2px solid #f06060;border-radius:12px;padding:14px;text-align:center">
      <div style="font-size:16px;font-weight:700;color:#f06060;margin-bottom:8px">⛔ Неверный остаток наличных</div>
      <div style="font-size:13px;color:#f0f0f8">Пересчитайте кассу и введите верную сумму</div>
    </div>`;
  } else {
    if(cv) cv.innerHTML = '<div class="al-ok">✅ Касса сходится</div>';
  }
  if(drCv){
    if(hasDiffDr){
      drCv.innerHTML = `<div style="background:#2e1a1a;border:2px solid #f06060;border-radius:12px;padding:14px;text-align:center">
        <div style="font-size:16px;font-weight:700;color:#f06060;margin-bottom:8px">⛔ Неверный остаток наличных (ДР)</div>
        <div style="font-size:13px;color:#f0f0f8">Пересчитайте кассу и введите верную сумму</div>
      </div>`;
    } else {
      drCv.innerHTML = '<div class="al-ok">✅ Касса сходится</div>';
    }
  }
  if(staffCv){
    if(hasDiffStaff){
      staffCv.innerHTML = `<div style="background:#2e1a1a;border:2px solid #f06060;border-radius:12px;padding:14px;text-align:center">
        <div style="font-size:16px;font-weight:700;color:#f06060;margin-bottom:8px">⛔ Неверный остаток наличных (Покупки сотрудников)</div>
        <div style="font-size:13px;color:#f0f0f8">Пересчитайте кассу и введите верную сумму</div>
      </div>`;
    } else {
      staffCv.innerHTML = '<div class="al-ok">✅ Касса сходится</div>';
    }
  }
  if(hasDiff || hasDiffDr || hasDiffStaff){
    if(crb) crb.style.display = 'block';
    if(btn){ btn.disabled=true; btn.style.opacity='.5'; }
  } else if(!_backupCheckPassed){
    if(crb) crb.style.display = 'none';
    if(btn){ btn.disabled=true; btn.style.opacity='.5'; }
  } else {
    if(crb) crb.style.display = 'none';
    if(btn){ btn.disabled=false; btn.style.opacity='1'; }
  }
  renderClose();
}
var _backupCheckPassed = false;
function _backupEntryDesc(e){
  var icons = {sale:'💰', expense:'💸', receive:'📥', writeoff:'🗑️'};
  var kindNames = {sale:'Продажа', expense:'Расход', receive:'Приход', writeoff:'Списание'};
  return {
    icon: e.icon || icons[e.type] || '📄',
    title: e.label || kindNames[e.type] || 'Запись',
    sub: e.sub || e.comment || '',
    amount: e.amount!=null ? e.amount : (e.totalPaid!=null ? e.totalPaid : 0)
  };
}
function _renderBackupStatusList(){
  var statusEl = document.getElementById('backupCheckStatus');
  if(!statusEl) return;
  var sales = (journal||[]).filter(function(e){ return e.type==='sale'; });
  var others = (journal||[]).filter(function(e){ return e.type==='expense'||e.type==='receive'||e.type==='writeoff'; });
  var totalCount = sales.length + others.length;
  var unconfirmed = sales.filter(function(e){ return !_isSaleConfirmed(e.id); })
    .concat(others.filter(function(e){ return !_isJournalEntryConfirmed(e.id); }));
  if(!unconfirmed.length){
    _backupCheckPassed = true;
    statusEl.innerHTML = totalCount
      ? '<div style="background:#1a2e1e;border:1px solid #60f090;border-radius:9px;padding:10px;font-size:12px;color:#60f090;text-align:center">✅ Все записи ('+totalCount+') сохранены в подстраховке. Теперь можно закрыть смену.</div>'
      : '<div style="font-size:12px;color:#8888aa;text-align:center;padding:4px">Записей в этой смене не было</div>';
    validateClose();
    return;
  }
  _backupCheckPassed = false;
  var rows = unconfirmed.map(function(e){
    var d = _backupEntryDesc(e);
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid #f06060;border-radius:8px;margin-bottom:6px;background:#2e1a1a">'+
      '<div style="font-size:16px">'+d.icon+'</div>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:12px;font-weight:700;color:#f0f0f8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+d.title+(d.amount?' · '+fmt(d.amount):'')+'</div>'+
        (d.sub?'<div style="font-size:10px;color:#8888aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+d.sub+'</div>':'')+
      '</div>'+
      '<button id="retryBackup_'+e.id+'" onpointerdown="event.preventDefault();retrySingleBackupEntry(\''+e.id+'\')" style="flex-shrink:0;padding:7px 10px;background:#f06060;border:none;border-radius:7px;color:#1a0808;font-size:11px;font-weight:700;cursor:pointer">📤 Отправить</button>'+
    '</div>';
  }).join('');
  statusEl.innerHTML = '<div style="font-size:11px;color:#f06060;text-align:center;margin-bottom:6px">⚠️ '+unconfirmed.length+' из '+totalCount+' записей не сохранились в облаке. Ничего не потеряно — данные есть на телефоне. Отправьте каждую по кнопке ниже:</div>'+rows+
    '<button onpointerdown="event.preventDefault();runBackupCheck()" style="width:100%;padding:8px;background:none;border:1px solid #f0c060;border-radius:8px;color:#f0c060;font-size:11px;font-weight:700;cursor:pointer;margin-top:2px">🔄 Отправить все сразу</button>';
}
function retrySingleBackupEntry(id){
  var btn = document.getElementById('retryBackup_'+id);
  if(btn){ btn.disabled=true; btn.textContent='⏳ ...'; btn.style.opacity='.7'; }
  var e = (journal||[]).find(function(x){ return x.id===id; });
  if(!e){ _renderBackupStatusList(); return; }
  var shopName = (session&&session.shopName)||'';
  var finish = function(){ _renderBackupStatusList(); };
  if(e.type==='sale'){
    var saleDoc = Object.assign({}, e, {
      shopName: shopName, sellerName:(session&&(session.sellerName||session.name))||'',
      shiftId:(session&&session.shiftId)||'', date:(e.ts||'').split('T')[0], recordedAt:new Date().toISOString()
    });
    db.collection('iz_sales').doc(e.id).set(saleDoc).then(function(){
      _clearPendingSale(e.id); _markSaleConfirmed(e.id); finish();
    }).catch(function(err){ _queuePendingSale(saleDoc); showToast('❌ Не отправилось: '+(err&&err.message||err)); finish(); });
  } else {
    var doc = Object.assign({}, e, {
      kind: e.type, shopName: shopName, sellerName:(session&&(session.sellerName||session.name))||'',
      shiftId:(session&&session.shiftId)||'', date:(e.ts||'').split('T')[0], recordedAt:new Date().toISOString()
    });
    db.collection('iz_journal_backup').doc(e.id).set(doc).then(function(){
      _clearPendingJournalEntry(e.id); _markJournalEntryConfirmed(e.id); finish();
    }).catch(function(err){ _queuePendingJournalEntry(doc); showToast('❌ Не отправилось: '+(err&&err.message||err)); finish(); });
  }
}
function runBackupCheck(){
  var statusEl = document.getElementById('backupCheckStatus');
  var closeBtn = document.getElementById('closeShiftBtn');
  var checkBtn = document.getElementById('backupCheckBtn');
  var sales = (journal||[]).filter(function(e){ return e.type==='sale'; });
  var others = (journal||[]).filter(function(e){ return e.type==='expense'||e.type==='receive'||e.type==='writeoff'; });
  var totalCount = sales.length + others.length;
  if(!totalCount){
    _backupCheckPassed = true;
    if(statusEl) statusEl.innerHTML = '<div style="font-size:12px;color:#8888aa;text-align:center;padding:4px">Записей в этой смене не было</div>';
    validateClose();
    return;
  }
  if(checkBtn){ checkBtn.disabled=true; checkBtn.style.opacity='.6'; checkBtn.textContent='🛟 Проверяю...'; }
  if(statusEl) statusEl.innerHTML = '<div style="font-size:12px;color:#f0c060;text-align:center;padding:4px">🛟 Проверяю, что все записи ('+totalCount+') сохранены...</div>';
  var unconfirmedSales = sales.filter(function(e){ return !_isSaleConfirmed(e.id); });
  var unconfirmedOthers = others.filter(function(e){ return !_isJournalEntryConfirmed(e.id); });
  var shopName = (session&&session.shopName)||'';
  var saleAttempts = unconfirmedSales.map(function(e){
    return new Promise(function(resolve){
      if(typeof db==='undefined' || !db){ resolve(); return; }
      var saleDoc = Object.assign({}, e, {
        shopName: shopName, sellerName:(session&&(session.sellerName||session.name))||'',
        shiftId:(session&&session.shiftId)||'', date:(e.ts||'').split('T')[0], recordedAt:new Date().toISOString()
      });
      db.collection('iz_sales').doc(e.id).set(saleDoc).then(function(){
        _clearPendingSale(e.id); _markSaleConfirmed(e.id); resolve();
      }).catch(function(){ _queuePendingSale(saleDoc); resolve(); });
    });
  });
  var otherAttempts = unconfirmedOthers.map(function(e){
    return new Promise(function(resolve){
      if(typeof db==='undefined' || !db){ resolve(); return; }
      var doc = Object.assign({}, e, {
        kind: e.type, shopName: shopName, sellerName:(session&&(session.sellerName||session.name))||'',
        shiftId:(session&&session.shiftId)||'', date:(e.ts||'').split('T')[0], recordedAt:new Date().toISOString()
      });
      db.collection('iz_journal_backup').doc(e.id).set(doc).then(function(){
        _clearPendingJournalEntry(e.id); _markJournalEntryConfirmed(e.id); resolve();
      }).catch(function(){ _queuePendingJournalEntry(doc); resolve(); });
    });
  });
  var _backupCheckTimedOut = false;
  var backupTimeoutTimer = setTimeout(function(){
    _backupCheckTimedOut = true;
    if(checkBtn){ checkBtn.disabled=false; checkBtn.style.opacity='1'; checkBtn.textContent='🛟 Подстраховка'; }
    if(statusEl) statusEl.innerHTML = '<div style="font-size:12px;color:#f06060;text-align:center;padding:4px">⚠️ Проверка не завершилась — похоже, плохая связь. Закрыть смену пока нельзя. Попробуйте нажать «Подстраховка» ещё раз, когда связь появится.</div>';
  }, 15000);
  Promise.all(saleAttempts.concat(otherAttempts)).then(function(){
    clearTimeout(backupTimeoutTimer);
    if(_backupCheckTimedOut) return; // уже показали сообщение о тайм-ауте, не перетираем его
    if(checkBtn){ checkBtn.disabled=false; checkBtn.style.opacity='1'; checkBtn.textContent='🛟 Подстраховка'; }
    _renderBackupStatusList();
  });
}
function closeShift(){
  if(!_backupCheckPassed){
    showToast('🛟 Сначала нажмите «Подстраховка» — нужно убедиться, что все данные сохранены');
    return;
  }
  if(typeof _liveShiftSyncTimer!=='undefined' && _liveShiftSyncTimer){ clearTimeout(_liveShiftSyncTimer); _liveShiftSyncTimer=null; }
  _shiftForceClosedRemotely = true;
  if(session && session.isPreview){
    if(confirm('Режим просмотра — данные не будут сохранены. Выйти?')){
      localStorage.removeItem(KEY.session); localStorage.removeItem(KEY.journal);
      session=null; journal=[];
      document.getElementById('mainTabs').style.display='none';
      document.getElementById('appScreen').style.display='none';
      document.getElementById('loginScreen').style.display='flex';
      pick('shopadmin');
    }
    return;
  }
  showToast('🛟 Финальная проверка перед закрытием...');
  if(typeof db==='undefined' || !db || !session.shiftId){ _closeShiftReal(); return; }
  var _deletedIdsForClose = {}; getTombstones().forEach(function(id){ _deletedIdsForClose[id]=true; });
  Promise.all([
    db.collection('iz_sales').where('shiftId','==',session.shiftId).get().catch(function(){ return null; }),
    db.collection('iz_journal_backup').where('shiftId','==',session.shiftId).get().catch(function(){ return null; })
  ]).then(function(results){
    var localIds = {}; journal.forEach(function(e){ if(e.id) localIds[e.id]=true; });
    var recovered = 0;
    results.forEach(function(snap){
      if(!snap) return;
      snap.forEach(function(doc){
        var d = doc.data();
        if(!d || !d.id || localIds[d.id] || _deletedIdsForClose[d.id]) return;
        journal.push(d); localIds[d.id]=true; recovered++;
      });
    });
    if(recovered>0){
      journal.sort(function(a,b){ return (a.ts||'').localeCompare(b.ts||''); });
      saveJ();
      showToast('🛟 Перед закрытием нашлись и восстановлены пропавшие записи: '+recovered+'. Проверьте смену и нажмите «Закрыть смену» ещё раз.');
      try{ renderAll(); }catch(e){}
      return;
    }
    _closeShiftReal();
  }).catch(function(){ _closeShiftReal(); });
function _closeShiftReal(){
  const morningChkReal = getMorningCashDiff();
  if(morningChkReal.hasDiff){
    showToast('⛔ Нал утро не сходится с вечером пред. смены — исправьте сумму');
    openMo('fixMorningCashMo'); renderFixMorningCashForm();
    return;
  }
  const cashEveVal=(document.getElementById('cashEveInput')||{}).value||'';
  if(!cashEveVal){showToast('Введите остаток наличных вечер');return;}
  const cashEve=parseFloat(cashEveVal)||0;
  const t=calcTotals();
  const expArr=journal.filter(e=>e.type==='expense');
  const inkass=expArr.filter(e=>e.expType==='inkass'&&e.goodsType!=='dr').reduce((s,e)=>s+e.amount,0);
  const drInkassFromExp=expArr.filter(e=>e.expType==='inkass'&&e.goodsType==='dr').reduce((s,e)=>s+e.amount,0);
  const termEve=t.card, staffEve=t.staff;
  const cashSales=journal.filter(e=>e.type==='sale').reduce((s,e)=>s+(e.cashPart||0),0);
  const zpExp=expArr.filter(e=>e.expType==='zp').reduce((s,e)=>s+e.amount,0);
  const travelExp=expArr.filter(e=>e.expType==='travel').reduce((s,e)=>s+e.amount,0);
  const _zpCalcResult = (function(){ try{ return calcZpForCurrentShift(); }catch(e){ return null; } })();
  const otherExpAmt=expArr.filter(e=>e.expType==='other'&&e.goodsType!=='dr').reduce((s,e)=>s+e.amount,0);
  const supplierExpAmt=expArr.filter(e=>e.expType==='supplier'&&e.goodsType!=='dr').reduce((s,e)=>s+e.amount,0);
  const drSupplierExpAmt=expArr.filter(e=>e.expType==='supplier'&&e.goodsType==='dr').reduce((s,e)=>s+e.amount,0);
  const drOtherExpAmt=expArr.filter(e=>e.expType==='other'&&e.goodsType==='dr').reduce((s,e)=>s+e.amount,0);
  const expectedCash=t.cash;
  const cashDiff=Math.round(cashEve-expectedCash);
  if(Math.abs(cashDiff)>=1){showToast('⛔ Неверный остаток наличных — пересчитайте кассу');return;}
  const drBlock=document.getElementById('closeDrCassaBlock');
  const drBlockVisible=drBlock && drBlock.style.display!=='none';
  var drCashEve=null, drCashDiff=0;
  if(drBlockVisible){
    const drCashEveVal=(document.getElementById('drCashEveInput')||{}).value||'';
    if(!drCashEveVal){showToast('Введите остаток наличных ДР вечер');return;}
    drCashEve=parseFloat(drCashEveVal)||0;
    drCashDiff=Math.round(drCashEve-t.cashDr);
    if(Math.abs(drCashDiff)>=1){showToast('⛔ Неверный остаток наличных ДР — пересчитайте кассу');return;}
  }
  const staffCashEveVal=(document.getElementById('staffCashEveInput')||{}).value||'';
  var _hasStaff=journal.some(function(e){return e.type==='staff';});
  var _staffReq=_hasStaff||(session.cashStaffMorning||0)>0;
  if(_staffReq&&!staffCashEveVal){showToast('Введите остаток наличных вечер (Покупки сотрудников)');return;}
  const staffCashEve=parseFloat(staffCashEveVal)||0;
  const expectedCashStaff=(session.cashStaffMorning||0)+t.staff;
  const staffCashDiff=Math.round(staffCashEve-expectedCashStaff);
  if(Math.abs(staffCashDiff)>=1){showToast('⛔ Неверный остаток наличных (Покупки сотрудников) — пересчитайте кассу');return;}
  const reason='';
  const prev=getPrevShiftByOpenOrder(session.shopName, session.openedAt);
  const morningDiff=(prev&&prev.cashEvening)!=null?Math.abs(session.cashMorning-prev.cashEvening):0;
  const sales=journal.filter(e=>e.type==='sale');
  const openedDateStr = (function(){
    if(!session.openedAt) { var n=new Date(); return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0'); }
    var d = new Date(session.openedAt);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  })();
  var finalReportId = session.shiftId || uid();
  if(restoreMode){
    var allExisting = getShifts();
    var origOpen = allExisting.find(function(s){
      return s.shopName===session.shopName && s.sellerName===session.sellerName &&
        s.date===openedDateStr && (s.status==='open'||!s.closedAt) && s.id!==session.shiftId;
    });
    if(origOpen && origOpen.id) finalReportId = origOpen.id;
  }
  const report={id:finalReportId,status:'closed',source:'shop',shopName:session.shopName,sellerName:session.sellerName,
    date:openedDateStr,openedAt:session.openedAt,closedAt:new Date().toISOString(),
    cashMorning:session.cashMorning,goodsMorning:session.goodsMorning,cashEvening:cashEve,goodsEvening:t.goods,
    goodsMornSource:session.goodsMornSource||'auto',goodsDrMornSource:session.goodsDrMornSource||'auto',
    cashDrMorning:(session.cashDrMorning||0),drCashEvening:drCashEve,goodsDrMorning:(session.goodsDrMorning||0),drGoodsEvening:t.goodsDr,drCashDiff:drCashDiff,
    cashStaffMorning:(session.cashStaffMorning||0),cashStaffEvening:staffCashEve,
    inkass,cashDiff,cashDiffReason:reason,hasCashDiff:Math.abs(cashDiff)>=1,
    terminalEvening:termEve,terminalDiff:termEve-t.card,staffEvening:staffEve,staffDiff:staffEve-t.staff,
    morningDiff,prevCashEvening:(prev&&prev.cashEvening)||null,
    salesCount:sales.length,totalRevenue:sales.reduce((s,e)=>s+e.totalPaid,0),
    cashRevenue:cashSales,cardRevenue:termEve,expenses:expArr,
    zp:(_zpCalcResult?_zpCalcResult.zpCalcTotal:zpExp),
    travel:(_zpCalcResult?_zpCalcResult.travelCalc:travelExp),
    inkass:inkass,otherExp:otherExpAmt,
    zpFact:zpExp,travelFact:travelExp,
    supplierExp:supplierExpAmt,drSupplierAmt:drSupplierExpAmt,drOtherExp:drOtherExpAmt,
    drInkass:(session.drInkass||0)+drInkassFromExp,
    totalDiscount:sales.reduce((s,e)=>s+(e.discount||0),0),journal:[...journal]};
  if(Math.abs(cashDiff)>=1||morningDiff>1){
    saveAdminAlert({type:'cash_diff',shopName:session.shopName,sellerName:session.sellerName,
      date:report.date,cashDiff,cashDiffReason:reason,morningDiff,prevCashEve:(prev&&prev.cashEvening),cashMorning:session.cashMorning});
  }
  report._pendingSync = true;
  try{ _backupShiftIndependently(report); }catch(e){}
  const shifts=getShifts();
  var filteredShifts = shifts.filter(function(s){
    if(!restoreMode) return true;
    return !(s.shopName===report.shopName && s.date===report.date &&
      (s.status==='open'||!s.closedAt) && s.id!==report.id);
  });
  filteredShifts.unshift(report);
  saveShifts(filteredShifts);
  if(restoreMode){
    _pushShiftWithRetry(report.id, report);
    try{
      db.collection('iz_shifts')
        .where('shopName','==',report.shopName)
        .where('date','==',report.date)
        .where('status','==','open')
        .get().then(function(snap){
          snap.forEach(function(doc){
            if(doc.id!==report.id){
              doc.ref.set(Object.assign({},doc.data(),{
                status:'closed',
                closedAt:report.closedAt,
                closedByRestore:true,
                restoreShiftId:report.id
              }),{merge:true});
            }
          });
        });
    }catch(e){}
    localStorage.removeItem(KEY.restoreSession); localStorage.removeItem(KEY.restoreJournal);
    session=null; journal=[];
    exitRestoreMode({_closedProperly:true});
    showToast('✅ Восстановленная смена сохранена в архив');
    return;
  }
  showToast('⏳ Сохраняем смену в облако, подождите...');
  var _closeConfirmed = false;
  var _closeSettle = function(ok){
    if(_closeConfirmed) return; _closeConfirmed = true;
    if(ok){
      var cur = getShifts();
      var idx = cur.findIndex(function(s){ return (s.id||s._id)===report.id; });
      if(idx>=0){ delete cur[idx]._pendingSync; saveShifts(cur); }
    }
    stopLiveShiftListener();
    localStorage.removeItem(KEY.session); localStorage.removeItem(KEY.journal); clearTombstones();
    session=null; journal=[];
    document.getElementById('mainTabs').style.display='none';
    document.getElementById('appScreen').style.display='none';
    document.getElementById('loginScreen').style.display='flex';
    pick('seller');
    if(ok){
      showToast('✅ Смена закрыта и сохранена в облако');
    } else {
      _pushShiftWithRetry(report.id, report); // остаётся в очереди на автоповтор
      _markPendingCloseWarning(report.shopName, report.date);
      showToast('⚠️ Смена закрыта, но НЕ сохранилась в облаке — данные остались только на этом телефоне. Откройте приложение здесь ещё раз при хорошем интернете.');
    }
  };
  try{
    db.collection('iz_shifts').doc(report.id).set(report).then(function(){ _closeSettle(true); }).catch(function(){ _closeSettle(false); });
  }catch(e){ _closeSettle(false); }
  setTimeout(function(){ _closeSettle(false); }, 8000);
}
}
var _histPeriod = 'week'; // 'today' | 'week' | 'month' | 'all' | 'custom'
function setHistPeriod(period, el){
  _histPeriod = period;
  ['today','week','month','quarter','all','custom'].forEach(function(p){
    var btn = document.getElementById('histPeriod_'+p);
    if(!btn) return;
    var active = p === period;
    btn.style.borderWidth = active ? '2px' : '1px';
    btn.style.background = active ? '#1e2a14' : '#22222e';
    btn.style.color = active ? '#c8f060' : '#8888aa';
    btn.style.borderColor = active ? '#c8f060' : '#2e2e3e';
    btn.style.fontWeight = active ? '700' : '400';
  });
  var rangeEl = document.getElementById('histCustomRange');
  var qSelEl = document.getElementById('histQuarterSelect');
  if(period === 'custom'){
    if(rangeEl) rangeEl.style.display = 'flex';
    if(qSelEl) qSelEl.style.display = 'none';
    return;
  }
  if(rangeEl) rangeEl.style.display = 'none';
  if(period === 'quarter'){
    if(qSelEl) qSelEl.style.display = 'block';
    _populateHistQuarterPicker();
    var picker = document.getElementById('histQuarterPicker');
    applyHistQuarter(picker ? picker.value : _histQuarterKey(new Date()));
    return;
  }
  if(qSelEl) qSelEl.style.display = 'none';
  var today = new Date();
  var todayStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
  if(period === 'week'){
    var weekAgo = new Date(today.getTime() - 6*86400000);
    _histPeriodFrom = weekAgo.getFullYear()+'-'+String(weekAgo.getMonth()+1).padStart(2,'0')+'-'+String(weekAgo.getDate()).padStart(2,'0');
    _histPeriodTo = todayStr;
  } else if(period === 'month'){
    var monthAgo = new Date(today.getTime() - 29*86400000);
    _histPeriodFrom = monthAgo.getFullYear()+'-'+String(monthAgo.getMonth()+1).padStart(2,'0')+'-'+String(monthAgo.getDate()).padStart(2,'0');
    _histPeriodTo = todayStr;
  } else { // all
    _histPeriodFrom = ''; _histPeriodTo = '';
  }
  renderShiftHistory();
  if(period==='all'){
    try{ _ensureShiftsLoadedForRange(_histPeriodFrom).then(renderShiftHistory); }catch(e){}
  }
}
function _histQuarterKey(d){
  return d.getFullYear()+'-'+(Math.floor(d.getMonth()/3)+1);
}
function _populateHistQuarterPicker(){
  var sel = document.getElementById('histQuarterPicker');
  if(!sel || sel.options.length) return; // already populated
  var today = new Date();
  var curY = today.getFullYear(), curQ = Math.floor(today.getMonth()/3)+1;
  var opts = '';
  for(var i=0;i<8;i++){
    var q = curQ - i, y = curY;
    while(q<1){ q+=4; y--; }
    opts += '<option value="'+y+'-'+q+'">'+q+' кв. '+y+'</option>';
  }
  sel.innerHTML = opts;
}
function applyHistQuarter(value){
  var parts = (value||'').split('-');
  var y = parseInt(parts[0],10), q = parseInt(parts[1],10);
  if(!y || !q) return;
  var startMonth = (q-1)*3;
  var from = new Date(y, startMonth, 1);
  var to = new Date(y, startMonth+3, 0);
  _histPeriodFrom = from.getFullYear()+'-'+String(from.getMonth()+1).padStart(2,'0')+'-'+String(from.getDate()).padStart(2,'0');
  _histPeriodTo = to.getFullYear()+'-'+String(to.getMonth()+1).padStart(2,'0')+'-'+String(to.getDate()).padStart(2,'0');
  renderShiftHistory();
  try{ _ensureShiftsLoadedForRange(_histPeriodFrom).then(renderShiftHistory); }catch(e){}
}
function applyHistCustomRange(){
  var fromEl = document.getElementById('histDateFrom'), toEl = document.getElementById('histDateTo');
  _histPeriodFrom = fromEl ? fromEl.value : '';
  _histPeriodTo = toEl ? toEl.value : '';
  try{ _ensureShiftsLoadedForRange(_histPeriodFrom).then(renderShiftHistory); }catch(e){ renderShiftHistory(); }
}
var _currentShiftView = null;
var _svEditTarget = null;
function svToggleEdit(kind, idx){
  if(_svEditTarget && _svEditTarget.kind===kind && _svEditTarget.idx===idx) _svEditTarget=null;
  else _svEditTarget={kind:kind, idx:idx};
  _renderShiftView();
}
function editItemForm(id, color, opts){
  opts = opts || {};
  var items = getItemsBase();
  var species = getSpecies();
  var p = opts.prefill || {};
  var dlItems = 'dl_eitems_'+id, dlSpecies = 'dl_especies_'+id;
  var html = '<div style="background:#13131a;border:2px solid '+color+';border-radius:10px;padding:10px;margin-top:6px">';
  html += '<div style="font-size:10px;color:'+color+';font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">✏️ Исправление записи</div>';
  html += '<datalist id="'+dlItems+'">'+items.slice(0,80).map(function(it){ return '<option value="'+(it.name||'')+'">'; }).join('')+'</datalist>';
  html += '<datalist id="'+dlSpecies+'">'+species.slice(0,80).map(function(sp){ return '<option value="'+sp+'">'; }).join('')+'</datalist>';
  if(opts.who){
    html += '<div style="margin-bottom:6px"><div class="u-fs10-gray-mb3">Сотрудник</div>'+
      '<input class="fi u-inp-compact" id="svEdit_'+id+'_who" value="'+(p.who||'')+'" placeholder="Имя"></div>';
  }
  html += '<div style="display:flex;gap:5px;margin-bottom:6px">'+
    '<div style="flex:0 0 64px"><div class="u-fs10-gray-mb3">Артикул</div>'+
      '<input class="fi u-inp-compact" id="svEdit_'+id+'_art" value="'+(p.art||'')+'" placeholder="№"></div>'+
    '<div style="flex:1"><div class="u-fs10-gray-mb3">Наименование</div>'+
      '<input class="fi u-inp-compact" id="svEdit_'+id+'_name" value="'+(p.name||'')+'" list="'+dlItems+'" placeholder="Товар"></div>'+
    '<div style="flex:0 0 90px"><div class="u-fs10-gray-mb3">Порода</div>'+
      '<input class="fi u-inp-compact" id="svEdit_'+id+'_species" value="'+(p.species||'')+'" list="'+dlSpecies+'" placeholder="Порода"></div>'+
  '</div>';
  html += '<div style="display:flex;gap:5px;margin-bottom:6px">'+
    '<div style="flex:1"><div class="u-fs10-gray-mb3">Цена за ед.</div>'+
      '<input class="fi u-inp-compact" id="svEdit_'+id+'_price" type="text" inputmode="numeric" value="'+(p.price||0)+'" oninput="svEditItemCalc(\''+id+'\')"></div>'+
    '<div style="flex:1"><div class="u-fs10-gray-mb3">Кол-во</div>'+
      '<input class="fi u-inp-compact" id="svEdit_'+id+'_qty" type="text" inputmode="numeric" value="'+(p.qty||1)+'" oninput="svEditItemCalc(\''+id+'\')"></div>'+
    '<div style="flex:1"><div class="u-fs10-gray-mb3">Сумма, ₽</div>'+
      '<input class="fi u-inp-compact" id="svEdit_'+id+'_amt" type="text" inputmode="numeric" value="'+(p.amt||0)+'"></div>'+
  '</div>';
  if(opts.retail){
    html += '<div style="margin-bottom:6px"><div class="u-fs10-gray-mb3">Цена розница, ₽</div>'+
      '<input class="fi u-inp-compact" id="svEdit_'+id+'_retail" type="text" inputmode="numeric" value="'+(p.retail||0)+'"></div>';
  }
  if(opts.extra){
    html += '<div style="margin-bottom:6px"><div class="u-fs10-gray-mb3">'+opts.extra.label+'</div>'+
      '<input class="fi u-inp-compact" id="svEdit_'+id+'_'+opts.extra.id+'" value="'+(p[opts.extra.valueKey||opts.extra.id]||'')+'" placeholder="'+opts.extra.placeholder+'"></div>';
  }
  html += '<div class="u-fs10-gray-mb3">Причина правки</div>'+
    '<input class="fi" id="svEdit_'+id+'_reason" placeholder="Обязательно укажите причину..." style="margin:0;padding:8px;margin-bottom:8px">';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">'+
    '<button onclick="svToggleEdit(\''+opts.kind+'\','+opts.idx+')" style="padding:8px;background:none;border:1px solid #2e2e3e;border-radius:8px;color:#8888aa;font-size:12px;cursor:pointer">Отмена</button>'+
    '<button onclick="'+opts.saveFn+'" style="padding:8px;background:'+color+';border:none;border-radius:8px;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer">💾 Сохранить</button>'+
  '</div></div>';
  return html;
}
function svEditItemCalc(id){
  var price=_svNum('svEdit_'+id+'_price'), qty=_svNum('svEdit_'+id+'_qty')||1;
  var amtEl=document.getElementById('svEdit_'+id+'_amt'); if(amtEl) amtEl.value = price*qty;
}
function _svEditItemRow(id, extraKey){
  return {
    art: (document.getElementById('svEdit_'+id+'_art')||{}).value || '',
    name: ((document.getElementById('svEdit_'+id+'_name')||{}).value||'').trim(),
    species: ((document.getElementById('svEdit_'+id+'_species')||{}).value||'').trim(),
    price: parseFloat((document.getElementById('svEdit_'+id+'_price')||{}).value)||0,
    qty: parseFloat((document.getElementById('svEdit_'+id+'_qty')||{}).value)||1,
    amt: parseFloat((document.getElementById('svEdit_'+id+'_amt')||{}).value)||0,
    extra: extraKey ? ((document.getElementById('svEdit_'+id+'_'+extraKey)||{}).value||'').trim() : '',
    reason: ((document.getElementById('svEdit_'+id+'_reason')||{}).value||'').trim()
  };
}
function simpleEditForm(id, color, opts){
  opts = opts || {};
  var p = opts.prefill || {};
  var html = '<div style="background:#13131a;border:2px solid '+color+';border-radius:10px;padding:10px;margin-top:6px">';
  html += '<div style="font-size:10px;color:'+color+';font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">✏️ Исправление записи</div>';
  html += '<div style="margin-bottom:6px"><div class="u-fs10-gray-mb3">Описание</div>'+
    '<input class="fi u-inp-compact" id="svEdit_'+id+'_sub" value="'+(p.sub||'')+'"></div>';
  html += '<div style="margin-bottom:6px"><div class="u-fs10-gray-mb3">Сумма, ₽</div>'+
    '<input class="fi u-inp-compact" id="svEdit_'+id+'_amt" type="text" inputmode="numeric" value="'+(p.amt||0)+'"></div>';
  if(opts.kind==='jrcv' || opts.kind==='jwo'){
    var curGt = p.goodsType==='dr' ? 'dr' : 'derevo';
    html += '<div style="margin-bottom:6px"><div class="u-fs10-gray-mb3">Категория товара</div>'+
      '<select class="fi u-inp-compact" id="svEdit_'+id+'_gt">'+
        '<option value="derevo"'+(curGt==='derevo'?' selected':'')+'>🌳 Дерево</option>'+
        '<option value="dr"'+(curGt==='dr'?' selected':'')+'>🛍 ДР Товар</option>'+
      '</select></div>';
  }
  html += '<div class="u-fs10-gray-mb3">Причина правки</div>'+
    '<input class="fi" id="svEdit_'+id+'_reason" placeholder="Обязательно укажите причину..." style="margin:0;padding:8px;margin-bottom:8px">';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">'+
    '<button onclick="svToggleEdit(\''+opts.kind+'\','+opts.idx+')" style="padding:8px;background:none;border:1px solid #2e2e3e;border-radius:8px;color:#8888aa;font-size:12px;cursor:pointer">Отмена</button>'+
    '<button onclick="'+opts.saveFn+'" style="padding:8px;background:'+color+';border:none;border-radius:8px;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer">💾 Сохранить</button>'+
  '</div></div>';
  return html;
}
function migrateLegacyShiftDates(){
  var shifts = getShifts();
  if(!shifts.length) return;
  function localDateStr(iso){
    var d = new Date(iso);
    var y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
    return y+'-'+m+'-'+day;
  }
  var changed = false;
  shifts.forEach(function(sh){
    if(!sh.openedAt || sh.backfilled || sh.isArchive) return; // backfilled/archive shifts set their own date intentionally
    var openedDateStr = localDateStr(sh.openedAt);
    if(sh.date !== openedDateStr){
      sh.date = openedDateStr;
      changed = true;
    }
  });
  if(changed){
    saveShifts(shifts);
    try{
      shifts.forEach(function(sh){
        var id = sh.id||sh._id; if(!id) return;
        db.collection('iz_shifts').doc(id).set(sh, {merge:true}).catch(function(){});
      });
    }catch(e){}
  }
}
function migrateLegacyShiftRevenue(){
  var shifts = getShifts();
  if(!shifts.length) return;
  var changed = false;
  shifts.forEach(function(sh){
    if(!sh.journal || !sh.journal.length) return;
    sh.journal.forEach(function(e){
      if(e.type==='expense' && e.cashEffect===undefined && e.cashDrEffect===undefined){
        var isDr = e.goodsType==='dr';
        e.cashEffect = isDr?0:-(e.amount||0);
        e.cashDrEffect = isDr?-(e.amount||0):0;
        e.cardEffect = e.cardEffect||0; e.staffEffect = e.staffEffect||0; e.goodsEffect = e.goodsEffect||0;
        if(!e.id) e.id = uid();
        changed = true;
      }
      if(e.type==='staff' && e.cashEffect===undefined && e.staffEffect===undefined){
        e.cashEffect = 0; e.cardEffect = e.cardEffect||0;
        e.staffEffect = e.amount||e.opt||0; e.goodsEffect = -(e.retail||0);
        if(!e.id) e.id = uid();
        changed = true;
      }
    });
  });
  if(changed) saveShifts(shifts);
  shifts.forEach(function(sh){
    if(sh.isArchive || sh.status!=='closed' || !sh.journal || !sh.journal.length) return;
    var sales = sh.journal.filter(function(e){ return e.type==='sale'; });
    if(!sales.length) return;
    var cashRev=0, cardRev=0, disc=0, drCashRev=0, drCardRev=0, drDisc=0;
    sales.forEach(function(s){
      cashRev += s.cashEffect||0;
      cardRev += s.cardEffect||0;
      drCashRev += s.cashDrEffect||0;
      drCardRev += s.cardDrEffect||0;
      if(s.goodsType==='dr'){
        drDisc += s.discount||0;
      } else if(s.goodsType==='mixed' && s.items && s.items.length){
        var totalWoodM = s.items.reduce(function(a,it){ var amt=it.amt!=null?it.amt:it.price*(it.qty||1); return it.goodsType==='dr' ? a : a+amt; },0);
        var totalAllM = s.items.reduce(function(a,it){ return a+(it.amt!=null?it.amt:it.price*(it.qty||1)); },0);
        var totalDrM = totalAllM - totalWoodM;
        var dWood;
        if(s.discCategory==='derevo'){
          dWood = Math.min(s.discount||0, totalWoodM);
        } else if(s.discCategory==='dr'){
          dWood = (s.discount||0) - Math.min(s.discount||0, totalDrM);
        } else {
          var shareWood = totalAllM>0 ? totalWoodM/totalAllM : 1;
          dWood = Math.round((s.discount||0)*shareWood);
        }
        disc += dWood;
        drDisc += (s.discount||0)-dWood;
      } else {
        disc += s.discount||0;
      }
    });
    var fields = {cashRevenue:cashRev, cardRevenue:cardRev, totalDiscount:disc, drCashRevenue:drCashRev, drCardRevenue:drCardRev, drDiscount:drDisc};
    Object.keys(fields).forEach(function(k){
      if(Math.round(sh[k]||0) !== Math.round(fields[k])){
        sh[k] = fields[k];
        changed = true;
      }
    });
  });
  if(changed){
    saveShifts(shifts);
    try{
      shifts.forEach(function(sh){
        var id = sh.id||sh._id; if(!id) return;
        db.collection('iz_shifts').doc(id).set(sh, {merge:true}).catch(function(){});
      });
    }catch(e){}
  }
}
var _histShowOpen = false;
function toggleHistShowOpen(){
  _histShowOpen = !_histShowOpen;
  var btn = document.getElementById('histShowOpenBtn');
  if(btn){
    btn.style.background = _histShowOpen ? '#604a14' : '#1a1a22';
    btn.style.borderWidth = _histShowOpen ? '2px' : '1px';
    btn.style.color = _histShowOpen ? '#0f0f13' : '#f0c060';
  }
  var banner = document.getElementById('histShowOpenBanner');
  if(banner) banner.style.display = _histShowOpen ? 'block' : 'none';
  var periodFilter = document.getElementById('histPeriodFilter');
  if(periodFilter) periodFilter.style.opacity = _histShowOpen ? '0.35' : '1';
  var shopFilter = document.getElementById('histShopFilter');
  if(shopFilter) shopFilter.style.opacity = _histShowOpen ? '0.35' : '1';
  renderShiftHistory();
}
var _histInited = false;
function evaluateShiftIssues(sh){
  var issues = [];
  var jnl = sh.journal||[];
  var sales = jnl.filter(function(e){ return e.type==='sale'; });
  (function(){
    var prevChk = getPrevShiftByOpenOrder(sh.shopName, sh.openedAt || (sh.date ? sh.date+'T23:59:59' : ''));
    if(!prevChk) return;
    if(prevChk.cashEvening!=null && prevChk.cashEvening>=100 && Math.abs((sh.cashMorning||0)-prevChk.cashEvening)>=1){
      issues.push({code:'morn_cash_diff_t', label:'💵 Нал утро (Дерево) не сходится с вечером пред. смены ('+fmt(prevChk.cashEvening)+')'});
    }
    if(prevChk.drCashEvening!=null && prevChk.drCashEvening>=100 && Math.abs((sh.cashDrMorning||0)-prevChk.drCashEvening)>=1){
      issues.push({code:'morn_cash_diff_g', label:'💵 Нал утро (ДР Товар) не сходится с вечером пред. смены ('+fmt(prevChk.drCashEvening)+')'});
    }
    if(prevChk.cashStaffEvening!=null && prevChk.cashStaffEvening>=100 && Math.abs((sh.cashStaffMorning||0)-prevChk.cashStaffEvening)>=1){
      issues.push({code:'morn_cash_diff_s', label:'💵 Нал утро (Покупки сотрудников) не сходится с вечером пред. смены ('+fmt(prevChk.cashStaffEvening)+')'});
    }
    if(prevChk.goodsEvening!=null && prevChk.goodsEvening>=100 && sh.goodsMorning!=null && Math.abs((sh.goodsMorning||0)-prevChk.goodsEvening)>=1){
      issues.push({code:'morn_goods_diff_t', label:'🌳 Остаток товара (Дерево) на утро не сходится с вечером пред. смены ('+fmt(prevChk.goodsEvening)+')'});
    }
    if(prevChk.drGoodsEvening!=null && prevChk.drGoodsEvening>=100 && sh.goodsDrMorning!=null && Math.abs((sh.goodsDrMorning||0)-prevChk.drGoodsEvening)>=1){
      issues.push({code:'morn_goods_diff_g', label:'🛍 Остаток товара (ДР Товар) на утро не сходится с вечером пред. смены ('+fmt(prevChk.drGoodsEvening)+')'});
    }
  })();
  if(sh.goodsMorning==null){
    issues.push({code:'morn_wood_zero', label:'🌳 Остаток товара (Дерево) на утро не занесён'});
  }
  if(sh.goodsDrMorning==null){
    issues.push({code:'morn_dr_zero', label:'🛍 Остаток товара (ДР Товар) на утро не занесён'});
  }
  function itemAmt(it){ return it.amt!=null?it.amt:(it.price||0)*(it.qty||1); }
  function grossSold(isDr){
    var total=0;
    sales.forEach(function(e){
      var items=e.items||[];
      if(!items.length){ if(!isDr) total += (e.amount||0)+(e.discount||0); return; }
      items.filter(function(it){ return isDr ? it.goodsType==='dr' : it.goodsType!=='dr'; })
        .forEach(function(it){ total += itemAmt(it); });
    });
    return total;
  }
  var jRcvWood = jnl.filter(function(e){ return e.type==='receive' && e.goodsType!=='dr'; }).reduce(function(s,e){return s+(e.goodsEffect||e.amount||0);},0);
  var jWoWood = jnl.filter(function(e){ return e.type==='writeoff' && e.goodsType!=='dr'; }).reduce(function(s,e){return s+Math.abs(e.amount||0);},0);
  var jRcvDr = jnl.filter(function(e){ return e.type==='receive' && e.goodsType==='dr'; }).reduce(function(s,e){return s+(e.goodsDrEffect!=null?e.goodsDrEffect:(e.goodsEffect||e.amount||0));},0);
  var jWoDr = jnl.filter(function(e){ return e.type==='writeoff' && e.goodsType==='dr'; }).reduce(function(s,e){return s+Math.abs(e.amount||0);},0);
  var manRcvWood = (sh.goodsReceives||[]).reduce(function(s,r){return s+(r.amt!=null?r.amt:(r.amount||0));},0);
  var manWoWood = (sh.goodsWriteoffs||[]).reduce(function(s,w){return s+(w.amt!=null?w.amt:(w.amount||0));},0);
  var manRcvDr = (sh.drGoodsReceives||[]).reduce(function(s,r){return s+(r.amt!=null?r.amt:(r.amount||0));},0);
  var manWoDr = (sh.drGoodsWriteoffs||[]).reduce(function(s,w){return s+(w.amt!=null?w.amt:(w.amount||0));},0);
  var jStaffWood = jnl.filter(function(e){ return e.type==='staff' && (e.goodsType||'wood')!=='dr'; })
    .reduce(function(s,e){ return s + Math.abs(e.goodsEffect || e.retail || e.opt || 0); }, 0);
  var jStaffDr = jnl.filter(function(e){ return e.type==='staff' && e.goodsType==='dr'; })
    .reduce(function(s,e){ return s + Math.abs(e.goodsDrEffect || e.retail || e.opt || 0); }, 0);
  function _resolveGoodsEffect(e, isDr){
    var entryIsDr = e.goodsType==='dr';
    if(isDr){
      if(e.goodsDrEffect!=null) return e.goodsDrEffect;
    } else {
      if(e.goodsEffect!=null) return e.goodsEffect;
    }
    if(entryIsDr !== isDr) return 0; // запись относится к другой категории
    var amt = e.amount||0;
    if(e.type==='sale') return -amt;
    if(e.type==='receive') return amt;
    if(e.type==='writeoff') return -amt;
    return 0;
  }
  var _legacyWoodWo = (sh.goodsWriteoffs||[]).reduce(function(s,w){return s+(w.amount!=null?w.amount:(w.amt||0));},0);
  var _legacyDrWo = (sh.drGoodsWriteoffs||[]).reduce(function(s,w){return s+(w.amount!=null?w.amount:(w.amt||0));},0);
  var _legacyWoodRcv = (sh.goodsReceives||[]).reduce(function(s,w){return s+(w.amount!=null?w.amount:(w.amt||0));},0);
  var _legacyDrRcv = (sh.drGoodsReceives||[]).reduce(function(s,w){return s+(w.amount!=null?w.amount:(w.amt||0));},0);
  var _jnlHasWoodWo = jnl.some(function(e){ return e.type==='writeoff' && e.goodsType!=='dr'; });
  var _jnlHasDrWo = jnl.some(function(e){ return e.type==='writeoff' && e.goodsType==='dr'; });
  var _jnlHasWoodRcv = jnl.some(function(e){ return e.type==='receive' && e.goodsType!=='dr'; });
  var _jnlHasDrRcv = jnl.some(function(e){ return e.type==='receive' && e.goodsType==='dr'; });
  var calcEveWood = (sh.goodsMorning||0) + jnl.reduce(function(s,e){ return s+_resolveGoodsEffect(e,false); },0)
    - (_jnlHasWoodWo?0:_legacyWoodWo) + (_jnlHasWoodRcv?0:_legacyWoodRcv);
  var calcEveDr = (sh.goodsDrMorning||0) + jnl.reduce(function(s,e){ return s+_resolveGoodsEffect(e,true); },0)
    - (_jnlHasDrWo?0:_legacyDrWo) + (_jnlHasDrRcv?0:_legacyDrRcv);
  if(sh.goodsEvening==null){
    issues.push({code:'eve_wood_zero', label:'🌳 Остаток товара (Дерево) на вечер не занесён'});
  } else if(Math.abs((sh.goodsEvening||0) - calcEveWood) >= 1){
    issues.push({code:'eve_wood_mismatch', label:'🌳 Остаток товара (Дерево) на вечер не совпадает с расчётным ('+Math.round(calcEveWood).toLocaleString('ru-RU')+'₽)'});
  }
  if(sh.drGoodsEvening==null){
    issues.push({code:'eve_dr_zero', label:'🛍 Остаток товара (ДР Товар) на вечер не занесён'});
  } else if(Math.abs((sh.drGoodsEvening||0) - calcEveDr) >= 1){
    issues.push({code:'eve_dr_mismatch', label:'🛍 Остаток товара (ДР Товар) на вечер не совпадает с расчётным ('+Math.round(calcEveDr).toLocaleString('ru-RU')+'₽)'});
  }
  var cashRev=0, drCashRev=0;
  sales.forEach(function(s){
    cashRev += (s.cashEffect||0);
    drCashRev += (s.cashDrEffect||0);
  });
  var otherCashEffect = jnl.reduce(function(s,e){ return (e.type!=='sale') ? s+(e.cashEffect||0) : s; }, 0);
  var otherCashDrEffect = jnl.reduce(function(s,e){ return (e.type!=='sale') ? s+(e.cashDrEffect||0) : s; }, 0);
  var expCash = (sh.cashMorning||0) + cashRev + otherCashEffect;
  var expCashDr = (sh.cashDrMorning||0) + drCashRev + otherCashDrEffect;
  if(sh.cashEvening==null){
    issues.push({code:'eve_cash_missing', label:'💵 Нал вечер (Дерево) не введён'});
  } else if(Math.abs((sh.cashEvening||0) - expCash) >= 1){
    issues.push({code:'eve_cash_mismatch', label:'💵 Нал вечер (Дерево) не сходится с расчётным ('+Math.round(expCash).toLocaleString('ru-RU')+'₽)'});
  }
  if(sh.drCashEvening==null){
    if((sh.drGoodsMorning||sh.goodsDrMorning)) issues.push({code:'eve_cash_dr_missing', label:'💵 Нал вечер (ДР Товар) не введён'});
  } else if(Math.abs((sh.drCashEvening||0) - expCashDr) >= 1){
    issues.push({code:'eve_cash_dr_mismatch', label:'💵 Нал вечер (ДР Товар) не сходится с расчётным ('+Math.round(expCashDr).toLocaleString('ru-RU')+'₽)'});
  }
  var staffCashEffectChk = jnl.reduce(function(s,e){
    if(e.type==='sale') return s;
    if(e.staffEffect) return s+e.staffEffect;
    if(e.type==='expense' && e.goodsType==='staff') return s-(e.amount||0);
    return s;
  }, 0);
  if(staffCashEffectChk || sh.cashStaffMorning || sh.cashStaffEvening!=null){
    var expCashStaffChk = (sh.cashStaffMorning||0) + staffCashEffectChk;
    if(sh.cashStaffEvening==null){
      issues.push({code:'eve_cash_staff_missing', label:'🛒 Нал вечер (Покупки сотрудников) не введён'});
    } else if(Math.abs((sh.cashStaffEvening||0) - expCashStaffChk) >= 1){
      issues.push({code:'eve_cash_staff_mismatch', label:'🛒 Нал вечер (Покупки сотрудников) не сходится с расчётным ('+Math.round(expCashStaffChk).toLocaleString('ru-RU')+'₽)'});
    }
  }
  (function(){
    var allShiftsG = getShifts();
    var candidatesG = allShiftsG.filter(function(s){
      return s.shopName===sh.shopName && s.id!==sh.id && s.openedAt && sh.openedAt && s.openedAt < sh.openedAt;
    });
    var prevG = candidatesG.sort(function(a,b){ return new Date(b.openedAt)-new Date(a.openedAt); })[0] || null;
    if(!prevG) return;
    if(prevG.goodsEvening!=null && prevG.goodsEvening>0 && sh.goodsMorning!=null){
      var diffW = Math.round((sh.goodsMorning||0) - prevG.goodsEvening);
      if(Math.abs(diffW)>=1){
        var srcNoteW = sh.goodsMornSource==='manual' ? ' [введено вручную продавцом]' : (sh.goodsMornSource==='auto' ? ' [взято системой автоматически]' : '');
        issues.push({code:'morn_goods_wood_diff', label:'🌳 Остаток товара утро (Дерево) не совпадает с вечером пред. смены: ввели '+Math.round(sh.goodsMorning).toLocaleString('ru-RU')+'₽, было '+Math.round(prevG.goodsEvening).toLocaleString('ru-RU')+'₽ ('+(diffW>0?'+':'')+Math.round(diffW).toLocaleString('ru-RU')+'₽)'+srcNoteW});
      }
    }
    var prevDrEve = prevG.drGoodsEvening!=null ? prevG.drGoodsEvening : prevG.goodsDrEvening;
    var curDrMorn = sh.goodsDrMorning!=null ? sh.goodsDrMorning : sh.drGoodsMorning;
    if(prevDrEve!=null && prevDrEve>0 && curDrMorn!=null){
      var diffDr = Math.round((curDrMorn||0) - prevDrEve);
      if(Math.abs(diffDr)>=1){
        var srcNoteDr = sh.goodsDrMornSource==='manual' ? ' [введено вручную продавцом]' : (sh.goodsDrMornSource==='auto' ? ' [взято системой автоматически]' : '');
        issues.push({code:'morn_goods_dr_diff', label:'🛍 Остаток товара утро (ДР Товар) не совпадает с вечером пред. смены: ввели '+Math.round(curDrMorn).toLocaleString('ru-RU')+'₽, было '+Math.round(prevDrEve).toLocaleString('ru-RU')+'₽ ('+(diffDr>0?'+':'')+Math.round(diffDr).toLocaleString('ru-RU')+'₽)'+srcNoteDr});
      }
    }
  })();
  return {hasIssues: issues.length>0, issues: issues};
}
function syncShiftsFromFirestore(){
  var btn=document.getElementById('histSyncBtn');
  var status=document.getElementById('histSyncStatus');
  if(btn){btn.disabled=true;btn.textContent='⏳...';}
  if(status){status.style.display='block';status.textContent='⏳ Подтягиваю...';}
  pullShiftTombstonesFromCloud(function(tombstoned){
    var tset={}; (tombstoned||[]).forEach(function(id){ tset[id]=true; });
    db.collection('iz_shifts').get({source:'server'}).then(function(snap){
      var local=getShifts();
      local = local.filter(function(s){ return !tset[s.id||s._id]; });
      var lmap={};local.forEach(function(s){lmap[s.id||s._id]=true;});
      var added=0, skipped=0;
      snap.forEach(function(doc){
        if(tset[doc.id]){ skipped++; return; } // смена удалена админом — не воскрешаем
        var data=doc.data();data.id=doc.id;
        if(!lmap[doc.id]){local.push(data);added++;}
        else{var idx=local.findIndex(function(s){return (s.id||s._id)===doc.id;});if(idx>=0)local[idx]=Object.assign(local[idx],data);}
      });
      saveShifts(local);
      if(btn){btn.disabled=false;btn.textContent='☁️ Синх';}
      if(status){status.textContent='✅ Подтянуто '+snap.size+' смен (новых: '+added+(skipped?', пропущено удалённых: '+skipped:'')+')';}
      renderShiftHistory();
    }).catch(function(e){
      if(btn){btn.disabled=false;btn.textContent='☁️ Синх';}
      if(status){status.textContent='❌ '+e.message;}
    });
  });
}
var _dateCheckShown = false;
function toggleDateCheckCalendar(){
  _dateCheckShown = !_dateCheckShown;
  var c = document.getElementById('dateCheckCalendar');
  if(c) c.style.display = _dateCheckShown ? 'block' : 'none';
  if(_dateCheckShown){
    var from = _histPeriodFrom;
    if(!from){
      var now = new Date();
      from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    }
    try{ _ensureShiftsLoadedForRange(from).then(renderDateCheckCalendar); }catch(e){ renderDateCheckCalendar(); }
  }
}
function renderDateCheckCalendar(){
  var c = document.getElementById('dateCheckCalendar'); if(!c || !_dateCheckShown) return;
  var allShifts = getShifts();
  var shopsToCheck = _histShopFilter ? [_histShopFilter] : getShops().map(function(s){ return s.name||s; });
  var from = _histPeriodFrom, to = _histPeriodTo;
  if(!from || !to){
    var now = new Date();
    from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    to = new Date().toISOString().split('T')[0];
  }
  var dates = [];
  var d = new Date(from+'T00:00:00'), end = new Date(to+'T00:00:00');
  while(d <= end){ dates.push(d.toISOString().split('T')[0]); d.setDate(d.getDate()+1); }
  dates.reverse();
  var missingCount = 0;
  var rows = '';
  dates.forEach(function(dt){
    shopsToCheck.forEach(function(shopName){
      var shiftsForDay = allShifts.filter(function(s){ return s.shopName===shopName && s.date===dt; });
      var label, color, icon, clickId=null;
      if(!shiftsForDay.length){
        label='Нет смены'; color='#f06060'; icon='❌'; missingCount++;
      } else {
        var openShift = shiftsForDay.find(function(s){ return s.status==='open'; });
        var issueShift = shiftsForDay.find(function(s){ try{ return evaluateShiftIssues(s).hasIssues; }catch(e){ return false; } });
        if(openShift){ label='Открыта'; color='#f0c060'; icon='🔓'; clickId=openShift.id||openShift._id; }
        else if(issueShift){ label='Есть несовпадения'; color='#f06060'; icon='⚠️'; clickId=issueShift.id||issueShift._id; }
        else { label='Всё в порядке'; color='#60f090'; icon='✅'; clickId=(shiftsForDay[0].id||shiftsForDay[0]._id); }
      }
      rows += '<div onclick="'+(clickId?'openShiftView(\''+clickId+'\')':'')+'" style="display:flex;justify-content:space-between;align-items:center;padding:7px 4px;border-bottom:1px solid #2e2e3e;font-size:12px;'+(clickId?'cursor:pointer':'')+'">'+
        '<div>'+dt+(shopsToCheck.length>1?' · '+shopName:'')+'</div>'+
        '<div style="color:'+color+';font-weight:700">'+icon+' '+label+'</div>'+
      '</div>';
    });
  });
  c.innerHTML = '<div style="background:#1a1a22;border:2px solid #a060f0;border-radius:12px;padding:10px">'+
    '<div style="font-size:12px;font-weight:700;color:#a060f0;margin-bottom:2px">📅 Проверка по датам</div>'+
    '<div style="font-size:10px;color:#8888aa;margin-bottom:8px">'+from+' — '+to+(missingCount?' · <span style="color:#f06060;font-weight:700">пропущено: '+missingCount+'</span>':' · <span style="color:#60f090">пропусков нет</span>')+'</div>'+
    rows+
  '</div>';
}
function renderShiftHistory(){
  try{ renderDateCheckCalendar(); }catch(e){}
  var c=document.getElementById('shiftHistoryList'); if(!c)return;
  migrateLegacyShiftDates();
  migrateLegacyShiftRevenue();
  if(!_histInited){
    _histInited = true;
    setHistPeriod('today', document.getElementById('histPeriod_today'));
    return; // setHistPeriod() calls renderShiftHistory() again with the range applied
  }
  var shops=getShops();
  var sf=document.getElementById('histShopFilter');
  if(sf){
    var allActive = !_histShopFilter;
    sf.innerHTML='<div id="histShop_all" style="padding:5px 12px;border-radius:20px;border:'+(allActive?'2px solid #c8f060':'1px solid #2e2e3e')+';background:'+(allActive?'#c8f060':'#1a1a22')+';color:'+(allActive?'#0f0f13':'#8888aa')+';font-size:11px;cursor:pointer;white-space:nowrap;font-weight:'+(allActive?'700':'400')+'" onclick="filterHistShop(\'\',this)">Все</div>'+shops.map(function(s){
      var name = (s.name||s);
      var active = _histShopFilter === name;
      return '<div style="padding:5px 12px;border-radius:20px;border:'+(active?'2px solid #c8f060':'1px solid #2e2e3e')+';background:'+(active?'#c8f060':'#1a1a22')+';color:'+(active?'#0f0f13':'#8888aa')+';font-size:11px;cursor:pointer;white-space:nowrap;font-weight:'+(active?'700':'400')+'" onclick="filterHistShop(\''+name.replace(/'/g,"\\'")+'\',this)">'+name+'</div>';
    }).join('');
  }
  var allShifts=getShifts();
  allShifts = allShifts.filter(function(s){
    if(_histShowOpen) return s.status==='open'; // diagnostic mode: show ONLY stuck open shifts
    if(s.isArchive) return !!s.activated || s.source==='import';
    return s.status==='closed';
  });
  if(_histShopFilter) allShifts = allShifts.filter(function(s){ return s.shopName === _histShopFilter; });
  var _sellerSearch = ((document.getElementById('histSellerSearch')||{}).value||'').trim().toLowerCase();
  if(_sellerSearch) allShifts = allShifts.filter(function(s){ return (s.sellerName||'').toLowerCase().indexOf(_sellerSearch)>=0; });
  if(_histPeriodFrom && !_histShowOpen) allShifts = allShifts.filter(function(s){ return s.date >= _histPeriodFrom && (!_histPeriodTo||s.date <= _histPeriodTo); });
  allShifts.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
  if(!allShifts.length){
    var periodLabel = {week:'Неделя',month:'Месяц',quarter:'Квартал',all:'Все',custom:(_histPeriodFrom||'…')+' — '+(_histPeriodTo||'…')}[_histPeriod] || 'Неделя';
    var shopLabel = _histShopFilter || 'Все магазины';
    c.innerHTML='<div class="empty"><div class="ei">📋</div>Нет смен за выбранный период<div style="font-size:11px;color:#555568;margin-top:6px">Период: '+periodLabel+' · Магазин: '+shopLabel+'</div></div>';
    return;
  }
  c.innerHTML=allShifts.slice(0,60).map(function(sh){
    var cashRev, cardRev, disc;
    if(sh.journal && sh.journal.length){
      var jSales = sh.journal.filter(function(e){ return e.type==='sale'; });
      cashRev=0; cardRev=0; disc=0;
      jSales.forEach(function(s){
        cashRev += (s.cashEffect||0)+(s.cashDrEffect||0);
        cardRev += (s.cardEffect||0)+(s.cardDrEffect||0);
        disc += s.discount||0;
      });
    } else {
      cashRev=(sh.cashRevenue||0)+(sh.drCashRevenue||0); cardRev=(sh.cardRevenue||0)+(sh.drCardRevenue||0); disc=(sh.totalDiscount||sh.discount||0)+(sh.drDiscount||0);
    }
    var total=cashRev+cardRev+disc;
    var issuesResult = evaluateShiftIssues(sh);
    var hasIssues = issuesResult.hasIssues;
    return '<div class="card" style="cursor:pointer;border-color:'+(sh.status==='open'?'#f0c060':hasIssues?'#f06060':sh.isArchive?'#604020':'#2e2e3e')+'" onclick="openShiftView(\''+(sh.id||sh._id)+'\')">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div>'+
          '<div style="display:flex;align-items:center;gap:6px">'+
            '<div style="font-family:Unbounded,sans-serif;font-size:13px;font-weight:700">'+sh.shopName+'</div>'+
            (sh.status==='open'?'<div style="font-size:9px;background:#604a14;color:#f0c060;border-radius:4px;padding:2px 5px;font-weight:700">ОТКРЫТА</div>':'')+
            (sh.isArchive?'<div style="font-size:9px;background:#604020;color:#f0a060;border-radius:4px;padding:2px 5px;font-weight:700">АРХИВ</div>':'')+
          '</div>'+
          '<div style="font-size:11px;color:#8888aa;margin-top:2px">👤 '+(sh.sellerName||'—')+' · 📅 '+sh.date+'</div>'+
          (hasIssues?'<div style="font-size:10px;color:#f06060;margin-top:3px;font-weight:700">⚠️ Есть несовпадения ('+issuesResult.issues.length+')</div>':'<div style="font-size:10px;color:#60f090;margin-top:3px">✅ Всё сходится</div>')+
        '</div>'+
        '<div style="text-align:right">'+
          '<div style="font-family:Unbounded,sans-serif;font-size:14px;font-weight:700;color:#c8f060">'+fmt(total)+'</div>'+
          '<div style="font-size:11px;color:#8888aa;margin-top:2px">💵 '+fmt(cashRev)+' / 💳 '+fmt(cardRev)+'</div>'+
        '</div>'+
      '</div>'+
    '</div>';
  }).join('');
}
var _histShopFilter = '';
var _histPeriodFrom = '';
var _histPeriodTo = '';
function filterHistShop(shop, el){
  _histShopFilter = shop;
  document.querySelectorAll('#histShopFilter > div').forEach(function(c){ c.style.background='#1a1a22'; c.style.color='#8888aa'; c.style.borderWidth='1px'; c.style.borderColor='#2e2e3e'; });
  el.style.background='#c8f060'; el.style.color='#0f0f13'; el.style.borderWidth='2px'; el.style.borderColor='#c8f060';
  renderShiftHistory();
}
function openShiftView(id){
  currentEditShiftId = id;
  migrateLegacyShiftRevenue();
  var shifts = getShifts();
  var sh = shifts.find(function(s){ return (s.id||s._id)===id; }); if(!sh) return;
  _currentShiftView = JSON.parse(JSON.stringify(sh));
  if(!_currentShiftView.id) _currentShiftView.id = _currentShiftView._id;
  _svOpenAccs = {};
  _renderShiftView();
  openMo('editShiftMo');
  try{
    db.collection('iz_shifts').doc(id).get({source:'server'}).then(function(snap){
      if(!snap.exists) return;
      if(currentEditShiftId !== id) return; // администратор уже открыл другую смену
      var remote = snap.data(); remote.id = id;
      var localJnlLen = (_currentShiftView.journal||[]).length;
      var remoteJnlLen = (remote.journal||[]).length;
      var localUpd = _currentShiftView.updatedAt || _currentShiftView.closedAt || '';
      var remoteUpd = remote.updatedAt || remote.closedAt || '';
      if(remoteJnlLen > localJnlLen || remoteUpd > localUpd){
        _currentShiftView = remote;
        _svOpenAccs = {};
        _renderShiftView();
        var allShifts = getShifts();
        var idx = allShifts.findIndex(function(s){ return (s.id||s._id)===id; });
        if(idx>=0) allShifts[idx] = remote; else allShifts.push(remote);
        saveShifts(allShifts);
        showToast('🔄 Данные смены обновлены из облака');
      }
    }).catch(function(){});
  }catch(e){}
}
var _AUDIT_ACTION_LABELS = {
  SALE:'💰 Продажа', WRITEOFF:'🗑 Списание', RECEIVE:'📥 Приход', EXPENSE:'💸 Расход',
  SHIFT_OPEN:'🔓 Открытие смены', JOURNAL_ENTRY_EDIT:'✏️ Редактирование записи',
  JOURNAL_ENTRY_DELETE:'🗑 Удаление записи', JOURNAL_ENTRY_ADD_MISSED:'➕ Добавлена пропущенная запись',
  RECEIPT_DATE_MOVED:'📅 Перенос даты прихода', STALE_OPEN_SHIFT_AUTOFIXED:'🤖 Автозакрытие зависшей смены (без проверки кассы)'
};
function _auditFmtAmt(n){ return n==null ? '—' : Math.round(n).toLocaleString('ru-RU')+'₽'; }
function _auditFmtTime(iso){
  if(!iso) return '—';
  var d = new Date(iso);
  return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'})+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function _renderAuditEntry(e){
  var label = _AUDIT_ACTION_LABELS[e.action] || ('📄 '+(e.action||'Событие'));
  var details = e.details||{};
  var extra = '';
  if(e.action==='JOURNAL_ENTRY_EDIT'){
    var b=details.before||{}, a=details.after||{};
    var diffs=[];
    if((b.amount||0)!==(a.amount||0)) diffs.push('Сумма: '+_auditFmtAmt(b.amount)+' → '+_auditFmtAmt(a.amount));
    if((b.label||'')!==(a.label||'')) diffs.push('Название: «'+(b.label||'—')+'» → «'+(a.label||'—')+'»');
    if((b.discount||0)!==(a.discount||0)) diffs.push('Скидка: '+_auditFmtAmt(b.discount)+' → '+_auditFmtAmt(a.discount));
    if((b.payMethod||'')!==(a.payMethod||'')) diffs.push('Оплата: '+(b.payMethod||'—')+' → '+(a.payMethod||'—'));
    extra = diffs.length ? diffs.map(function(d){return '<div style="font-size:11px;color:#f0c060">'+d+'</div>';}).join('') : '<div style="font-size:11px;color:#8888aa">Изменение без разницы в сумме/названии</div>';
  } else if(e.action==='JOURNAL_ENTRY_DELETE'){
    var s=details.snapshot||{};
    extra = '<div style="font-size:11px;color:#f06060">Удалено: '+(s.label||details.entryType||'запись')+(s.amount?' · '+_auditFmtAmt(s.amount):'')+'</div>';
  } else if(e.action==='STALE_OPEN_SHIFT_AUTOFIXED'){
    extra = '<div style="font-size:11px;color:#f0c060">Смена была оставлена открытой и автоматически закрыта системой при следующем входе продавца — без проверки совпадения кассы.</div>';
  } else {
    var flat = Object.keys(details).filter(function(k){ return details[k]!=null && typeof details[k]!=='object'; })
      .map(function(k){ return k+': '+details[k]; }).join(' · ');
    if(flat) extra = '<div style="font-size:11px;color:#8888aa">'+flat+'</div>';
  }
  return '<div style="background:#13131a;border:1px solid #2e2e3e;border-radius:9px;padding:9px 10px;margin-bottom:6px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;gap:8px">'+
      '<span style="font-size:12px;font-weight:700;color:#f0f0f8">'+label+'</span>'+
      '<span style="font-size:10px;color:#8888aa;flex-shrink:0">'+_auditFmtTime(e.timestamp)+'</span>'+
    '</div>'+
    '<div style="font-size:11px;color:#60c8f0;margin-bottom:2px">👤 '+(e.user||'—')+'</div>'+
    extra+
  '</div>';
}
function loadShiftAuditLog(shiftId, btnEl){
  var body = document.getElementById('shiftAuditBody');
  if(!body) return;
  if(btnEl){ btnEl.disabled=true; btnEl.textContent='⏳ Загружаю...'; }
  body.innerHTML = '<div style="font-size:12px;color:#8888aa;text-align:center;padding:8px">⏳ Загружаю историю действий...</div>';
  if(typeof db==='undefined' || !db){
    body.innerHTML = '<div style="font-size:12px;color:#f06060;text-align:center;padding:8px">❌ Нет подключения к базе</div>';
    if(btnEl){ btnEl.disabled=false; btnEl.textContent='🔍 Загрузить историю действий'; }
    return;
  }
  db.collection('iz_audit_log').where('shiftId','==',shiftId).get().then(function(snap){
    var entries=[];
    snap.forEach(function(doc){ entries.push(doc.data()); });
    entries.sort(function(a,b){ return (a.timestamp||'').localeCompare(b.timestamp||''); });
    if(btnEl){ btnEl.style.display='none'; }
    if(!entries.length){
      body.innerHTML = '<div style="background:#1a2e1e;border:1px solid #60f090;border-radius:9px;padding:10px;font-size:12px;color:#60f090;text-align:center">✅ Записей аудита для этой смены нет — никто не редактировал и не удалял операции журнала, и системных автозакрытий тоже не было.</div>';
      return;
    }
    body.innerHTML = entries.map(_renderAuditEntry).join('');
  }).catch(function(err){
    body.innerHTML = '<div style="font-size:12px;color:#f06060;text-align:center;padding:8px">❌ Ошибка загрузки: '+(err&&err.message||err)+'</div>';
    if(btnEl){ btnEl.disabled=false; btnEl.textContent='🔍 Загрузить историю действий'; }
  });
}
function scanCrossShiftDuplicateReceives(currentShiftId, shopName, btnEl){
  var body = document.getElementById('crossShiftDupResult');
  if(!body) return;
  if(btnEl){ btnEl.disabled=true; btnEl.textContent='⏳ Проверяю...'; }
  body.innerHTML = '<div style="font-size:12px;color:#8888aa;text-align:center;padding:8px">⏳ Проверяю все закрытые смены '+(shopName||'')+'...</div>';
  if(typeof db==='undefined' || !db){
    body.innerHTML = '<div style="font-size:12px;color:#f06060;text-align:center;padding:8px">❌ Нет подключения к базе</div>';
    if(btnEl){ btnEl.disabled=false; btnEl.textContent='🔍 Проверить задвоения приходов между сменами'; }
    return;
  }
  db.collection('iz_shifts').where('shopName','==',shopName).get().then(function(snap){
    var shifts=[];
    snap.forEach(function(doc){ var d=doc.data(); d.id=d.id||doc.id; shifts.push(d); });
    var byInv = {}; // invId -> [{shiftId, date, amount, label}]
    shifts.forEach(function(s){
      (s.journal||[]).forEach(function(e){
        if(e.type!=='receive' || !e.invId) return;
        if(!byInv[e.invId]) byInv[e.invId]=[];
        byInv[e.invId].push({shiftId:s.id||s._id, date:s.date, amount:e.amount, label:e.label});
      });
    });
    var dupGroups = Object.keys(byInv).map(function(invId){ return {invId:invId, entries:byInv[invId]}; })
      .filter(function(g){ return g.entries.length>1; });
    if(btnEl){ btnEl.disabled=false; btnEl.textContent='🔍 Проверить задвоения приходов между сменами'; }
    if(!dupGroups.length){
      body.innerHTML = '<div style="background:#1a2e1e;border:1px solid #60f090;border-radius:9px;padding:10px;font-size:12px;color:#60f090;text-align:center">✅ Задвоений приходов между сменами не найдено (проверено накладных с ID: '+Object.keys(byInv).length+').</div>'+
        '<div style="font-size:10px;color:#8888aa;margin-top:6px;text-align:center">Учтите: накладные, принятые до обновления приложения, могли быть без ID и не проверяются этим инструментом.</div>';
      return;
    }
    var totalDup = dupGroups.reduce(function(s,g){ return s+(g.entries.length-1)*(g.entries[0].amount||0); },0);
    body.innerHTML = '<div style="background:#2e1a1a;border:1px solid #f06060;border-radius:9px;padding:10px;font-size:12px;color:#f06060;font-weight:700;text-align:center;margin-bottom:8px">⚠️ Найдено '+dupGroups.length+' задвоенных накладных, примерно на '+Math.round(totalDup).toLocaleString('ru-RU')+'₽ лишнего прихода</div>'+
      dupGroups.map(function(g){
        return '<div style="background:#13131a;border:1px solid #2e2e3e;border-radius:9px;padding:9px 10px;margin-bottom:6px">'+
          '<div style="font-size:12px;font-weight:700;color:#f0f0f8;margin-bottom:4px">'+(g.entries[0].label||'Приёмка')+' — встречается в '+g.entries.length+' сменах</div>'+
          g.entries.map(function(e){
            var isCurrent = e.shiftId===currentShiftId;
            return '<div style="font-size:11px;color:'+(isCurrent?'#f0c060':'#8888aa')+';padding:2px 0">'+
              '📅 '+(e.date||'?')+' · '+Math.round(e.amount||0).toLocaleString('ru-RU')+'₽'+(isCurrent?' · эта смена':'')+
            '</div>';
          }).join('')+
        '</div>';
      }).join('')+
      '<div style="font-size:10px;color:#8888aa;margin-top:6px">Оставьте запись в той смене, где накладная реально была принята, а лишние удалите через ❌ у соответствующей записи прихода в разделе «Приходы» этой смены.</div>';
  }).catch(function(err){
    if(btnEl){ btnEl.disabled=false; btnEl.textContent='🔍 Проверить задвоения приходов между сменами'; }
    body.innerHTML = '<div style="font-size:12px;color:#f06060;text-align:center;padding:8px">❌ Ошибка: '+(err&&err.message||err)+'</div>';
  });
}
function _renderShiftView(){
  var sh = _currentShiftView; if(!sh) return;
  document.getElementById('editShiftTitle').textContent = sh.shopName + ' · ' + sh.date;
  var subtitleEl = document.getElementById('editShiftSubtitle');
  if(subtitleEl){
    var fmtDT = function(iso){
      if(!iso) return '—';
      var d = new Date(iso);
      return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'})+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
    };
    subtitleEl.innerHTML = '🕐 Открыта: '+fmtDT(sh.openedAt)+'<br>🔐 Закрыта: '+fmtDT(sh.closedAt);
  }
  var f = function(n){ return Math.round(n||0).toLocaleString('ru-RU')+'₽'; };
  var jnl=sh.journal||[];
  var sales=jnl.filter(function(e){return e.type==='sale';});
  var writeoffs=jnl.filter(function(e){return e.type==='writeoff';});
  var receives=jnl.filter(function(e){return e.type==='receive';});
  var expenses=jnl.filter(function(e){return e.type==='expense';});
  var staffPurch=jnl.filter(function(e){return e.type==='staff';});
  var woodWo=sh.goodsWriteoffs||[];
  var drWo=sh.drGoodsWriteoffs||[];
  var woodRcv=sh.goodsReceives||[];
  var drRcv=sh.drGoodsReceives||[];
  var staffArr=sh.staffPurchases||staffPurch;
  var cashRev=0, cardRev=0, disc=0, drCashRev=0, drCardRev=0, drDisc=0;
  sales.forEach(function(s){
    cashRev += s.cashEffect||0;
    cardRev += s.cardEffect||0;
    drCashRev += s.cashDrEffect||0;
    drCardRev += s.cardDrEffect||0;
    if(s.goodsType==='dr'){
      drDisc += s.discount||0;
    } else if(s.goodsType==='mixed' && s.items && s.items.length){
      var totalWood = s.items.reduce(function(a,it){ var amt=it.amt!=null?it.amt:it.price*(it.qty||1); return it.goodsType==='dr' ? a : a+amt; },0);
      var totalAll = s.items.reduce(function(a,it){ return a+(it.amt!=null?it.amt:it.price*(it.qty||1)); },0);
      var totalDrItm = totalAll - totalWood;
      var dWood;
      if(s.discCategory==='derevo'){
        dWood = Math.min(s.discount||0, totalWood);
      } else if(s.discCategory==='dr'){
        dWood = (s.discount||0) - Math.min(s.discount||0, totalDrItm);
      } else {
        var shareWood = totalAll>0 ? totalWood/totalAll : 1;
        dWood = Math.round((s.discount||0)*shareWood);
      }
      disc += dWood;
      drDisc += (s.discount||0)-dWood;
    } else {
      disc += s.discount||0;
    }
  });
  var totalRev=cashRev+cardRev+disc;
  var drTot=drCashRev+drCardRev+drDisc;
  var zp=sh.zp||0, inkass=sh.inkass||0, otherExp=sh.otherExp||0;
  var drInkass=sh.drInkass||0, drSupplier=sh.drSupplierAmt||0;
  var jRcvWoodTotal = receives.filter(function(r){return r.goodsType!=='dr';}).reduce(function(s,r){return s+(r.goodsEffect!=null?r.goodsEffect:(r.amount||0));},0);
  var jRcvDrTotal = receives.filter(function(r){return r.goodsType==='dr';}).reduce(function(s,r){return s+(r.goodsDrEffect!=null?r.goodsDrEffect:(r.goodsEffect||r.amount||0));},0);
  var jRcvTotal = jRcvWoodTotal + jRcvDrTotal;
  var jWoTotal = writeoffs.reduce(function(s,w){return s+(w.amount||0);},0);
  var woodRcvTotal = woodRcv.reduce(function(s,r){return s+(r.amount||r.amt||0);},0) + jRcvWoodTotal;
  var drRcvTotal = drRcv.reduce(function(s,r){return s+(r.amount||r.amt||0);},0) + jRcvDrTotal;
  var woodWoTotal = woodWo.reduce(function(s,w){return s+(w.amount||0);},0) + jWoTotal;
  var drWoTotal = drWo.reduce(function(s,w){return s+(w.amount||0);},0);
  var woodSaleQty = sales.reduce(function(s,e){ return s+(e.items||[]).filter(function(it){return it.goodsType!=='dr';}).reduce(function(a,it){return a+(it.qty||1);},0); },0);
  var drSaleQty = sales.reduce(function(s,e){ return s+(e.items||[]).filter(function(it){return it.goodsType==='dr';}).reduce(function(a,it){return a+(it.qty||1);},0); },0);
  var expWoodTotal = expenses.filter(function(e){return e.goodsType!=='dr' && e.goodsType!=='staff';}).reduce(function(s,e){return s+(e.amount||0);},0);
  var expDrTotal = expenses.filter(function(e){return e.goodsType==='dr';}).reduce(function(s,e){return s+(e.amount||0);},0);
  var otherCashEffect = jnl.reduce(function(s,e){ return (e.type!=='sale') ? s+(e.cashEffect||0) : s; }, 0);
  var otherCashDrEffect = jnl.reduce(function(s,e){ return (e.type!=='sale') ? s+(e.cashDrEffect||0) : s; }, 0);
  var expCash = (sh.cashMorning||0) + cashRev + otherCashEffect;
  var actCash = sh.cashEvening!=null ? sh.cashEvening : null;
  var cashDiffVal = actCash!=null ? Math.round(actCash-expCash) : null;
  var expCashDr = (sh.cashDrMorning||0) + drCashRev + otherCashDrEffect;
  var actCashDr = sh.drCashEvening!=null ? sh.drCashEvening : null;
  var cashDrDiffVal = actCashDr!=null ? Math.round(actCashDr-expCashDr) : null;
  var staffCashEffect = jnl.reduce(function(s,e){
    if(e.type==='sale') return s;
    if(e.staffEffect) return s+e.staffEffect;
    if(e.type==='expense' && e.goodsType==='staff') return s-(e.amount||0);
    return s;
  }, 0);
  var expCashStaff = (sh.cashStaffMorning||0) + staffCashEffect;
  var actCashStaff = sh.cashStaffEvening!=null ? sh.cashStaffEvening : null;
  var cashStaffDiffVal = actCashStaff!=null ? Math.round(actCashStaff-expCashStaff) : null;
  var zpStandalone = calcShiftZpStandalone(sh.shopName, sh);
  var zpFactTotal = (zpStandalone.zpFact||0)+(zpStandalone.travelFact||0);
  var zpDiff = Math.round(zpStandalone.zpCalcWithTravel - zpFactTotal);
  var prevShiftForThis = getPrevShiftByOpenOrder(sh.shopName, sh.openedAt);
  function enteredMismatch(enteredVal, prevVal){
    return enteredVal!=null && prevVal!=null && Math.abs(enteredVal-prevVal)>=1;
  }
  var morningWoodMismatch = prevShiftForThis ? enteredMismatch(sh.cashMorning, prevShiftForThis.cashEvening) : false;
  var morningDrMismatch = prevShiftForThis ? enteredMismatch(sh.cashDrMorning, prevShiftForThis.drCashEvening) : false;
  var morningGoodsMismatch = prevShiftForThis ? enteredMismatch(sh.goodsMorning, prevShiftForThis.goodsEvening) : false;
  var morningDrGoodsMismatch = prevShiftForThis ? (function(){
    var prevDrE = prevShiftForThis.drGoodsEvening!=null ? prevShiftForThis.drGoodsEvening : prevShiftForThis.goodsDrEvening;
    var curDrM = sh.goodsDrMorning!=null ? sh.goodsDrMorning : sh.drGoodsMorning;
    return enteredMismatch(curDrM, prevDrE);
  })() : false;
  function diffChip(val, okLabel){
    if(val==null) return '<span style="font-size:10px;color:#555568">не введено</span>';
    if(Math.abs(val)<1) return '<span style="font-size:10px;color:#60f090;font-weight:700">✅ '+(okLabel||'сходится')+'</span>';
    return '<span style="font-size:10px;color:#f06060;font-weight:700">⚠️ '+(val>0?'+':'')+f(val)+'</span>';
  }
  var anyDiff = (cashDiffVal!=null && Math.abs(cashDiffVal)>=1) || (cashDrDiffVal!=null && Math.abs(cashDrDiffVal)>=1) || (cashStaffDiffVal!=null && Math.abs(cashStaffDiffVal)>=1) || !!sh.hasCashDiff || actCash==null || (sh.forceClosedBy && actCashDr==null) || morningWoodMismatch || morningDrMismatch;
  var _goodsIssues = evaluateShiftIssues(sh).issues.filter(function(i){ return i.code.indexOf('wood')>=0 || i.code.indexOf('_dr_')>=0; });
  if(_goodsIssues.length) anyDiff = true;
  if(morningGoodsMismatch || morningDrGoodsMismatch) anyDiff = true;
  function enteredVal(val, mismatch){
    var v = val!=null ? f(val) : '—';
    return mismatch ? '<span style="color:#f0a060;text-decoration:underline wavy #f06060">'+v+'</span>' : '<b>'+v+'</b>';
  }
  function _mornSourceLabel(src){
    if(src==='manual') return '✍️ вручную';
    if(src==='auto') return '🤖 авто (расчёт)';
    return '— неизвестно (старая смена)';
  }
  function tblRow(label, woodVal, drVal, opts){
    opts = opts||{};
    return '<div style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:0 8px;padding:'+(opts.pad||'4px')+' 0;'+(opts.border?'border-top:1px solid #2e2e3e;margin-top:4px;padding-top:8px':'')+'">'+
      '<div style="font-size:'+(opts.bold?'12.5px':'11.5px')+';color:'+(opts.bold?'#f0f0f8':'#8888aa')+';font-weight:'+(opts.bold?'700':'400')+'">'+label+'</div>'+
      '<div style="font-size:'+(opts.bold?'12.5px':'11.5px')+';font-weight:'+(opts.bold?'700':'600')+';color:'+(opts.color||'#f0f0f8')+'">'+woodVal+'</div>'+
      '<div style="font-size:'+(opts.bold?'12.5px':'11.5px')+';font-weight:'+(opts.bold?'700':'600')+';color:'+(opts.color||'#f0f0f8')+'">'+drVal+'</div>'+
    '</div>';
  }
  var summaryRows =
    '<div style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:0 8px;margin-bottom:6px">'+
      '<div></div><div style="font-size:10px;color:#c8f060;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🌳 Дерево</div><div style="font-size:10px;color:#a060f0;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🛍 ДР Товар</div>'+
    '</div>'+
    '<div style="font-size:10px;color:#60f090;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">💰 ПРОДАЖИ</div>'+
    tblRow('Выручка', f(totalRev), f(drTot), {bold:true,color:'#c8f060'})+
    tblRow('Кол-во', woodSaleQty+' шт.', drSaleQty+' шт.')+
    '<div style="font-size:10px;color:#f0a060;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin:8px 0 2px">📦 ТОВАР</div>'+
    tblRow('Остаток утро', enteredVal(sh.goodsMorning, morningGoodsMismatch), enteredVal(sh.goodsDrMorning!=null?sh.goodsDrMorning:sh.drGoodsMorning, morningDrGoodsMismatch))+
    tblRow('  · как введено', _mornSourceLabel(sh.goodsMornSource), _mornSourceLabel(sh.goodsDrMornSource), {color:'#8888aa'})+
    tblRow('Остаток вечер', f(sh.goodsEvening||0), f(sh.drGoodsEvening||0))+
    tblRow('Приход', f(woodRcvTotal), f(drRcvTotal))+
    tblRow('Списание', f(woodWoTotal), f(drWoTotal))+
    '<div style="font-size:10px;color:#60c8f0;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin:8px 0 2px">💵 КАССА</div>'+
    tblRow('Нал утро', enteredVal(sh.cashMorning, morningWoodMismatch), enteredVal(sh.cashDrMorning, morningDrMismatch))+
    tblRow('Нал вечер (расч./факт)', f(expCash)+' / '+enteredVal(actCash, cashDiffVal!=null && Math.abs(cashDiffVal)>=1), f(expCashDr)+' / '+enteredVal(actCashDr, cashDrDiffVal!=null && Math.abs(cashDrDiffVal)>=1))+
    tblRow('', diffChip(cashDiffVal), diffChip(cashDrDiffVal))+
    tblRow('Выручка нал', f(cashRev), f(drCashRev))+
    tblRow('Выручка безнал', f(cardRev), f(drCardRev))+
    tblRow('Скидка', f(disc), f(drDisc))+
    '<div style="font-size:10px;color:#a060f0;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin:8px 0 2px">🛒 ПОКУПКИ СОТРУДНИКОВ (нал)</div>'+
    '<div style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:0 8px;padding:4px 0">'+
      '<div style="font-size:11.5px;color:#8888aa">Нал утро / вечер (расч./факт)</div>'+
      '<div style="font-size:11.5px;font-weight:600;grid-column:span 2"><b>'+f(sh.cashStaffMorning||0)+'</b> → '+f(expCashStaff)+' / '+enteredVal(actCashStaff, cashStaffDiffVal!=null && Math.abs(cashStaffDiffVal)>=1)+'</div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:0 8px;padding:0 0 4px">'+
      '<div></div><div style="grid-column:span 2">'+diffChip(cashStaffDiffVal)+'</div>'+
    '</div>'+
    '<div style="font-size:10px;color:#f06060;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin:8px 0 2px">💸 РАСХОДЫ</div>'+
    tblRow('Итого расходы', f(expWoodTotal), f(expDrTotal))+
    '<div style="font-size:10px;color:#f0c060;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin:8px 0 2px">💰 ЗП</div>'+
    tblRow('Расчётная', f(zpStandalone.zpCalcWood), f(zpStandalone.zpCalcDr))+
    tblRow('Проезд расчётный', f(zpStandalone.travelCalc), '—')+
    tblRow('Факт (взято)', enteredVal(zpStandalone.zpFact, false), '—')+
    tblRow('Проезд факт', enteredVal(zpStandalone.travelFact, false), '—')+
    tblRow('Разница ЗП+проезд', diffChip(zpDiff), '', {border:true});
  var _allShiftIssues = evaluateShiftIssues(sh).issues;
  var _shiftStillOpen = sh.status==='open' || !sh.closedAt;
  var _hasRealMismatch = _allShiftIssues.some(function(i){ return !(i.code && i.code.indexOf('_missing')>=0); });
  var _isWaitingOnly = _shiftStillOpen && !_hasRealMismatch;
  if(_isWaitingOnly) anyDiff = false;
  var issuesListHtml = _allShiftIssues.length
    ? '<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid '+(_isWaitingOnly?'#3a3a4a':'#4a2a2a')+'">'+
        _allShiftIssues.map(function(i){ return '<div style="font-size:11px;color:'+(_isWaitingOnly?'#8888aa':'#f0a0a0')+';padding:3px 0">• '+i.label+'</div>'; }).join('')+
      '</div>'
    : '';
  var _bannerColor = _isWaitingOnly ? '#f0c060' : (anyDiff?'#f06060':'#60f090');
  var _bannerBg = _isWaitingOnly ? '#2e2a1a' : (anyDiff?'#2e1a1a':'#1a2e1a');
  var _bannerLabel = _isWaitingOnly ? '⏳ СМЕНА ЕЩЁ ОТКРЫТА' : (anyDiff?'⚠️ ЕСТЬ НЕСОВПАДЕНИЯ':'✅ ВСЁ СХОДИТСЯ');
  var summaryHtml = '<div style="background:'+_bannerBg+';border:2px solid '+_bannerColor+';border-radius:14px;padding:14px;margin-bottom:12px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:'+_bannerColor+'">'+_bannerLabel+'</div>'+
      '<div style="font-size:10.5px;color:#8888aa">👤 '+(sh.sellerName||'—')+'</div>'+
    '</div>'+
    issuesListHtml+
    summaryRows+
    (sh.editedBy?'<div style="font-size:10px;color:#555568;margin-top:10px;padding-top:8px;border-top:1px solid #2e2e3e">✏️ Правки: '+sh.editedBy+(sh.editReason?' · '+sh.editReason:'')+'</div>':'')+
  '</div>';
  function acc(id, icon, title, color, count, body){
    var badge = count ? '<span style="background:'+color+';color:#0f0f13;font-size:10px;font-weight:700;border-radius:8px;padding:1px 6px;margin-left:6px">'+count+'</span>' : '';
    var isOpen = !!_svOpenAccs['acc_'+id];
    return '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:12px;margin-bottom:8px;overflow:hidden">'+
      '<div onclick="toggleShiftAcc(\'acc_'+id+'\')" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;cursor:pointer">'+
        '<div style="display:flex;align-items:center;gap:8px">'+
          '<span style="font-size:16px">'+icon+'</span>'+
          '<span style="font-size:13px;font-weight:700;color:'+color+'">'+title+'</span>'+
          badge+
        '</div>'+
        '<span id="acc_'+id+'_arr" style="color:#8888aa;font-size:14px;transition:transform .2s'+(isOpen?';transform:rotate(180deg)':'')+'">▼</span>'+
      '</div>'+
      '<div id="acc_'+id+'" style="display:'+(isOpen?'block':'none')+';padding:0 14px 12px">'+
        body+
      '</div>'+
    '</div>';
  }
  function row(label, val, color, sub){
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #2e2e3e">'+
      '<div><div style="font-size:12px;color:#8888aa">'+label+'</div>'+(sub?'<div style="font-size:10px;color:#555568">'+sub+'</div>':'')+'</div>'+
      '<span style="font-size:13px;font-weight:700;color:'+(color||'#f0f0f8')+'">'+val+'</span>'+
    '</div>';
  }
  var salesBody = '';
  if(sales.length){
    sales.forEach(function(s, i){
      var payIcon={cash:'💵',terminal:'💳',sbp:'📱',transfer:'🏦',qr:'🔲',mixed:'➗',rs:'🏦'}[s.payMethod]||'💰';
      var time = s.ts ? new Date(s.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) : '';
      var itemsHtml = '';
      if(s.items && s.items.length){
        itemsHtml = '<div style="background:#0f0f13;border-radius:8px;padding:8px;margin:6px 0">';
        s.items.forEach(function(it){
          var lbl = (it.art||it.num?'№'+(it.art||it.num)+' ':'')+it.name+(it.species?' · '+it.species:'')+(it.qty?' × '+it.qty:'')+(it.goodsType==='dr'?' · ДР':'');
          itemsHtml += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#8888aa;padding:2px 0"><span>'+lbl+'</span><span style="color:#f0f0f8;font-weight:700">'+f(it.amt||it.price||0)+'</span></div>';
        });
        itemsHtml += '</div>';
      }
      salesBody +=
        '<div style="border-bottom:1px solid #2e2e3e;padding:8px 0" id="sv_sale_'+i+'">'+
          '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
            '<div style="flex:1;min-width:0">'+
              '<div class="u-fs11-gray">'+time+' '+payIcon+(s.goodsType==='dr'?' · ДР товар':s.goodsType==='mixed'?' · Дерево+ДР':'')+(s.discount?' · 🎁 Скидка '+f(s.discount):'')+'</div>'+
            '</div>'+
            '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:8px">'+
              '<span style="font-size:13px;font-weight:700;color:#60f090">'+f(s.amount||0)+'</span>'+
              '<button onclick="svEditSale('+i+')" style="background:none;border:1px solid #c8f060;border-radius:6px;padding:3px 7px;color:#c8f060;font-size:11px;cursor:pointer">✏️</button>'+
              '<button onclick="svDeleteJEntry(\'sale\','+i+')" style="background:none;border:1px solid #3e2e2e;border-radius:6px;padding:3px 7px;color:#f06060;font-size:11px;cursor:pointer">✕</button>'+
            '</div>'+
          '</div>'+
          itemsHtml+
        '</div>';
    });
    salesBody += '<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;font-weight:700"><span>Итого</span><span style="color:#c8f060">'+f(totalRev)+'</span></div>';
  } else {
    salesBody += '<div style="font-size:10px;color:#c8f060;margin-bottom:5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🌳 ДЕРЕВО</div>';
    salesBody += row('💵 Нал', f(cashRev), '#60f090');
    salesBody += row('💳 Безнал', f(cardRev), '#60c8f0');
    if(disc) salesBody += row('🎁 Скидка', f(disc), '#8888aa');
    salesBody += '<div style="font-size:10px;color:#a060f0;margin:10px 0 5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🛍 ДР ТОВАР</div>';
    salesBody += row('💵 Нал', f(drCashRev), '#60f090');
    salesBody += row('💳 Безнал', f(drCardRev), '#60c8f0');
    if(drDisc) salesBody += row('🎁 Скидка', f(drDisc), '#8888aa');
    salesBody += '<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;font-weight:700;border-top:1px solid #2e2e3e;margin-top:4px"><span>Итого</span><span style="color:#c8f060">'+f(totalRev+drTot)+'</span></div>';
    salesBody += '<div style="font-size:11px;color:#555568;margin-top:4px">Детализация продаж недоступна — смена без журнала</div>';
  }
  salesBody += '<button onclick="svAddSaleToArchive()" style="width:100%;padding:10px;margin-top:10px;background:#1a2a14;border:2px solid #c8f060;border-radius:10px;font-weight:700;font-size:12px;color:#c8f060;cursor:pointer">➕ Добавить пропущенную продажу</button>';
  var soldItemsWood = {}, soldItemsDr = {};
  sales.forEach(function(e){
    (e.items||[]).forEach(function(it){
      var target = it.goodsType==='dr' ? soldItemsDr : soldItemsWood;
      var name = (it.name && it.name.trim()) || 'Без названия';
      var qty = it.qty||1;
      var amt = it.amt!=null ? it.amt : (it.price||0)*qty;
      if(!target[name]) target[name]={qty:0, amt:0};
      target[name].qty += qty;
      target[name].amt += amt;
    });
  });
  function soldItemsToList(map){
    return Object.keys(map).map(function(name){ return {name:name, qty:map[name].qty, amt:map[name].amt}; })
      .sort(function(a,b){ return b.qty-a.qty; });
  }
  var soldItemsWoodList = soldItemsToList(soldItemsWood);
  var soldItemsDrList = soldItemsToList(soldItemsDr);
  function itemRowSv(it){
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #2e2e3e;font-size:12px">'+
      '<span style="flex:1">'+it.name+'</span>'+
      '<span style="color:#8888aa;margin:0 8px">× '+it.qty+'</span>'+
      '<span style="color:#c8f060;font-weight:700">'+f(it.amt)+'</span>'+
    '</div>';
  }
  var soldItemsBody = '';
  if(soldItemsWoodList.length){
    soldItemsBody += '<div style="font-size:10px;color:#c8f060;margin:6px 0 4px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🌳 ДЕРЕВО</div>'+
      soldItemsWoodList.map(itemRowSv).join('');
  }
  if(soldItemsDrList.length){
    soldItemsBody += '<div style="font-size:10px;color:#a060f0;margin:'+(soldItemsWoodList.length?'10':'6')+'px 0 4px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🛍 ДР ТОВАР</div>'+
      soldItemsDrList.map(itemRowSv).join('');
  }
  if(!soldItemsBody) soldItemsBody = '<div style="font-size:11px;color:#555568;padding:8px 0">Нет данных по товарам — смена без журнала</div>';
  function inp(id, val, label){
    return '<div><div class="u-fs10-gray-mb3">'+label+'</div>'+
      '<input class="fi u-inp-compact" type="text" id="'+id+'" value="'+(val||0)+'" inputmode="numeric"></div>';
  }
  var staffCashWood = staffArr.filter(function(s){ return s.goodsType!=='dr'; }).reduce(function(sum,s){ return sum+(s.cashOpt||s.cashAmount||0); }, 0);
  var staffCashDr   = staffArr.filter(function(s){ return s.goodsType==='dr'; }).reduce(function(sum,s){ return sum+(s.cashOpt||s.cashAmount||0); }, 0);
  if(!staffCashWood && !staffCashDr){
    staffCashWood = staffArr.filter(function(s){ return s.goodsType!=='dr'; }).reduce(function(sum,s){ return sum+(s.opt||s.amount||0); }, 0);
    staffCashDr   = staffArr.filter(function(s){ return s.goodsType==='dr'; }).reduce(function(sum,s){ return sum+(s.opt||s.amount||0); }, 0);
  }
  var cassaBody = '<div style="background:#13131a;border:1px solid #2e2e3e;border-radius:10px;padding:10px;margin-bottom:10px">'+
    '<div style="font-size:10px;color:#f0f0f8;margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Σ ОБЩИЕ ИТОГИ СМЕНЫ</div>'+
    row('Продажи всего (Дерево+ДР+скидка)', f(totalRev+drTot), '#c8f060')+
    row('Нал всего (Дерево+ДР)', f(cashRev+drCashRev), '#60f090')+
    row('Безнал всего (Дерево+ДР)', f(cardRev+drCardRev), '#60c8f0')+
  '</div>';
  cassaBody += '<div style="font-size:10px;color:#c8f060;margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🌳 ДЕРЕВО</div>';
  cassaBody += row('Общая сумма за смену', f(totalRev), '#c8f060');
  cassaBody += row('Нал утро', f(sh.cashMorning||0), '#f0f0f8');
  cassaBody += row('Нал вечер', f(sh.cashEvening||0), '#f0f0f8');
  cassaBody += row('Выручка наличные', f(cashRev), '#60f090');
  cassaBody += row('Выручка безнал (терминал+перевод+QR)', f(cardRev), '#60c8f0');
  cassaBody += row('Скидка', f(disc), '#8888aa');
  if(staffCashWood) cassaBody += row('🛒 Покупки сотр. нал', f(staffCashWood), '#a060f0');
  cassaBody += '<div style="font-size:10px;color:#a060f0;margin:10px 0 6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🛍 ДР ТОВАР</div>';
  cassaBody += row('Общая сумма за смену', f(drTot), '#a060f0');
  cassaBody += row('Нал утро', f(sh.cashDrMorning||0), '#f0f0f8');
  cassaBody += row('Нал вечер', f(sh.drCashEvening||0), '#f0f0f8');
  cassaBody += row('Выручка наличные', f(drCashRev), '#60f090');
  cassaBody += row('Выручка безнал (терминал+перевод+QR)', f(drCardRev), '#60c8f0');
  cassaBody += row('Скидка', f(drDisc), '#8888aa');
  if(staffCashDr) cassaBody += row('🛒 Покупки сотр. нал', f(staffCashDr), '#a060f0');
  cassaBody += '<div style="font-size:10px;color:#60c8f0;margin:10px 0 6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🛒 ПОКУПКИ СОТРУДНИКОВ</div>';
  cassaBody += row('Нал утро', f(sh.cashStaffMorning||0), '#f0f0f8');
  cassaBody += row('Нал вечер', f(sh.cashStaffEvening||0), '#f0f0f8');
  if(sh.hasCashDiff) cassaBody += '<div style="background:#2e1a1a;border-radius:8px;padding:8px;margin-top:8px;font-size:11px;color:#f06060;font-weight:700">⚠️ Расхождение: '+f(sh.cashDiff||0)+(sh.cashDiffReason?' · '+sh.cashDiffReason:'')+'</div>';
  cassaBody += '<div style="margin-top:10px;padding-top:10px;border-top:1px solid #2e2e3e">'+
    '<div style="font-size:10px;color:#8888aa;margin-bottom:8px;font-weight:700">ИСПРАВИТЬ ФАКТИЧЕСКИЕ НАЛИЧНЫЕ</div>'+
    '<div style="font-size:10.5px;color:#555568;margin-bottom:8px">Выручка считается из журнала продаж и не редактируется здесь — правьте только если неверно посчитан физический остаток нала.</div>'+
    '<div style="font-size:10px;color:#c8f060;margin-bottom:5px;font-weight:700">🌳 Дерево</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">'+
      inp('sv_cashMorn', sh.cashMorning, 'Нал утро')+
      inp('sv_cashEve', sh.cashEvening, 'Нал вечер')+
    '</div>'+
    '<div style="font-size:10px;color:#a060f0;margin-bottom:5px;font-weight:700">🛍 ДР Товар</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">'+
      inp('sv_drCashMorn', sh.cashDrMorning, 'Нал утро')+
      inp('sv_drCashEve', sh.drCashEvening, 'Нал вечер')+
    '</div>'+
    '<div style="font-size:10px;color:#60c8f0;margin-bottom:5px;font-weight:700">🛒 Покупки сотрудников</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">'+
      inp('sv_staffCashMorn', sh.cashStaffMorning, 'Нал утро')+
      inp('sv_staffCashEve', sh.cashStaffEvening, 'Нал вечер')+
    '</div>'+
    '<div class="u-fs10-gray-mb3">Причина правки</div>'+
    '<input class="fi" id="sv_cashReason" placeholder="Обязательно укажите причину..." style="margin:0;padding:8px;margin-bottom:8px">'+
    '<button onclick="svSaveCassa()" style="width:100%;padding:9px;background:#c8f060;border:none;border-radius:9px;font-weight:700;font-size:12px;color:#0f0f13;cursor:pointer">💾 Сохранить изменения кассы</button>'+
  '</div>';
  var tovarBody = '<div style="font-size:10px;color:#c8f060;margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🌳 ДЕРЕВО</div>';
  tovarBody += row('Товар утро', f(sh.goodsMorning||0), '#f0a060');
  tovarBody += row('Товар вечер', f(sh.goodsEvening||0), '#f0a060');
  tovarBody += '<div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'" style="font-size:11px;color:#60c8f0;cursor:pointer;padding:6px 0;text-decoration:underline">📜 История движения (Дерево)</div>'+
    '<div style="display:none;margin-bottom:8px">'+goodsMovementLedger(sh,false)+'</div>';
  tovarBody += '<div style="font-size:10px;color:#a060f0;margin:10px 0 6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🛍 ДР ТОВАР</div>';
  tovarBody += row('Товар утро', f(sh.goodsDrMorning||0), '#a060f0');
  tovarBody += row('Товар вечер', f(sh.drGoodsEvening||0), '#a060f0');
  tovarBody += '<div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'" style="font-size:11px;color:#60c8f0;cursor:pointer;padding:6px 0;text-decoration:underline">📜 История движения (ДР Товар)</div>'+
    '<div style="display:none;margin-bottom:8px">'+goodsMovementLedger(sh,true)+'</div>';
  tovarBody += '<div style="margin-top:10px;padding-top:10px;border-top:1px solid #2e2e3e">'+
    '<div style="font-size:10px;color:#8888aa;margin-bottom:8px;font-weight:700">ИСПРАВИТЬ</div>'+
    '<div style="font-size:10px;color:#c8f060;margin-bottom:5px;font-weight:700">🌳 Дерево</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">'+
      '<div><div class="u-fs10-gray-mb3">Товар утро</div><input class="fi u-inp-compact" type="text" id="sv_goodsMorn" value="'+(sh.goodsMorning||0)+'" inputmode="numeric"></div>'+
      '<div><div class="u-fs10-gray-mb3">Товар вечер</div><input class="fi u-inp-compact" type="text" id="sv_goodsEve" value="'+(sh.goodsEvening||0)+'" inputmode="numeric"></div>'+
    '</div>'+
    '<div style="font-size:10px;color:#a060f0;margin-bottom:5px;font-weight:700">🛍 ДР Товар</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">'+
      '<div><div class="u-fs10-gray-mb3">Товар утро</div><input class="fi u-inp-compact" type="text" id="sv_drGoodsMorn" value="'+(sh.goodsDrMorning||0)+'" inputmode="numeric"></div>'+
      '<div><div class="u-fs10-gray-mb3">Товар вечер</div><input class="fi u-inp-compact" type="text" id="sv_drGoodsEve" value="'+(sh.drGoodsEvening||0)+'" inputmode="numeric"></div>'+
    '</div>'+
    '<input class="fi" id="sv_tovarReason" placeholder="Причина правки (обязательно)..." style="margin:0;padding:8px;margin-bottom:8px">'+
    '<button onclick="svSaveTovar()" style="width:100%;padding:9px;background:#c8f060;border:none;border-radius:9px;font-weight:700;font-size:12px;color:#0f0f13;cursor:pointer">💾 Сохранить остатки</button>'+
    '<button onclick="svCascadeGoodsOnly()" style="width:100%;margin-top:6px;padding:9px;background:#22222e;border:1px solid #60c8f0;border-radius:9px;font-weight:700;font-size:12px;color:#60c8f0;cursor:pointer">➡️ Пересчитать смены дальше по датам (без изменения этой)</button>'+
  '</div>';
  var rcvAllLen = receives.length + woodRcv.length + drRcv.length;
  var woodRcvItems = receives.concat(woodRcv); // journal receives + manual wood receives
  var rcvBody = '';
  function rcvItem(name, sub, subColor, amt, amtColor, deleteFn, editFn, invFn){
    return '<div style="border-bottom:1px solid #2e2e3e;padding:8px 0">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:12px;font-weight:700">'+name+'</div>'+
          (sub?'<div style="font-size:10px;color:'+(subColor||'#555568')+'">'+sub+'</div>':'')+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:8px">'+
          '<span style="font-size:12px;font-weight:700;color:'+(amtColor||'#60f090')+'">+'+f(amt)+'</span>'+
          (invFn?'<button onclick="'+invFn+'" style="background:none;border:1px solid #60c8f0;border-radius:6px;padding:3px 7px;color:#60c8f0;font-size:11px;cursor:pointer">📋</button>':'')+
          (editFn?'<button onclick="'+editFn+'" style="background:none;border:1px solid #c8f060;border-radius:6px;padding:3px 7px;color:#c8f060;font-size:11px;cursor:pointer">✏️</button>':'')+
          '<button onclick="'+deleteFn+'" style="background:none;border:1px solid #3e2e2e;border-radius:6px;padding:3px 7px;color:#f06060;font-size:11px;cursor:pointer">✕</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }
  rcvBody += '<div style="font-size:10px;color:#c8f060;margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🌳 ДЕРЕВО</div>';
  var woodRcvCount = 0;
  receives.forEach(function(r, i){
    if(r.goodsType === 'dr') return; // will show in ДР section
    var invFn = r.invId ? 'svOpenInvoiceFromReceive(\''+r.invId+'\')' : null;
    var amt = r.goodsEffect!=null ? r.goodsEffect : (r.amount||0);
    rcvBody += rcvItem(r.sub||r.label||'Приход', r.ts?new Date(r.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'', '#555568', amt, '#60f090', 'svDeleteJEntry(\'receive\','+i+')', 'svToggleEdit(\'jrcv\','+i+')', invFn);
    if(_svEditTarget && _svEditTarget.kind==='jrcv' && _svEditTarget.idx===i){
      rcvBody += simpleEditForm('jrcv'+i, '#60f090', {kind:'jrcv', idx:i, saveFn:'svSaveJEntrySimple(\'receive\','+i+')', prefill:{sub:r.sub||r.label||'', amt:amt, goodsType:r.goodsType}});
    }
    woodRcvCount++;
  });
  woodRcv.forEach(function(r, i){
    var lbl = (r.article?'№'+r.article+' ':'')+(r.name||'Приход')+(r.species?' · '+r.species:'')+(r.qty?' × '+r.qty:'')+(r.from?' · от '+r.from:'');
    rcvBody += rcvItem(lbl, '🌳 Дерево'+(r.price?' · '+f(r.price)+'/шт':''), '#555568', r.amt||0, '#60f090', 'svDeleteWoodRcv('+i+')', 'svToggleEdit(\'rcvWoodArr\','+i+')');
    if(_svEditTarget && _svEditTarget.kind==='rcvWoodArr' && _svEditTarget.idx===i){
      rcvBody += editItemForm('eRcvWood'+i, '#60f090', {kind:'rcvWoodArr', idx:i, extra:{id:'from',label:'Откуда / поставщик',placeholder:'необязательно'}, saveFn:'svSaveArrItemEdit(\'goodsReceives\','+i+',\'eRcvWood'+i+'\')', prefill:r});
    }
    woodRcvCount++;
  });
  if(!woodRcvCount) rcvBody += '<div style="font-size:11px;color:#555568;padding:6px 0 10px">Приходов не было</div>';
  rcvBody += '<div style="font-size:10px;color:#a060f0;margin:10px 0 6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🛍 ДР ТОВАР</div>';
  var drRcvCount = 0;
  receives.forEach(function(r, i){
    if(r.goodsType !== 'dr') return;
    var invFn = r.invId ? 'svOpenInvoiceFromReceive(\''+r.invId+'\')' : null;
    var amt = r.goodsDrEffect!=null ? r.goodsDrEffect : (r.goodsEffect||r.amount||0);
    rcvBody += rcvItem(r.sub||r.label||'Приход ДР', r.ts?new Date(r.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'', '#a060f0', amt, '#a060f0', 'svDeleteJEntry(\'receive\','+i+')', 'svToggleEdit(\'jrcv\','+i+')', invFn);
    if(_svEditTarget && _svEditTarget.kind==='jrcv' && _svEditTarget.idx===i){
      rcvBody += simpleEditForm('jrcv'+i, '#a060f0', {kind:'jrcv', idx:i, saveFn:'svSaveJEntrySimple(\'receive\','+i+')', prefill:{sub:r.sub||r.label||'', amt:amt, goodsType:r.goodsType}});
    }
    drRcvCount++;
  });
  drRcv.forEach(function(r, i){
    var lbl = (r.article?'№'+r.article+' ':'')+(r.name||'Приход ДР')+(r.species?' · '+r.species:'')+(r.qty?' × '+r.qty:'');
    rcvBody += rcvItem(lbl, '🛍 ДР Товар'+(r.price?' · '+f(r.price)+'/шт':''), '#a060f0', r.amt||0, '#a060f0', 'svDeleteDrRcv('+i+')', 'svToggleEdit(\'rcvDrArr\','+i+')');
    if(_svEditTarget && _svEditTarget.kind==='rcvDrArr' && _svEditTarget.idx===i){
      rcvBody += editItemForm('eRcvDr'+i, '#a060f0', {kind:'rcvDrArr', idx:i, saveFn:'svSaveArrItemEdit(\'drGoodsReceives\','+i+',\'eRcvDr'+i+'\')', prefill:r});
    }
    drRcvCount++;
  });
  if(!drRcvCount) rcvBody += '<div style="font-size:11px;color:#555568;padding:6px 0">Приходов не было</div>';
  var woAllLen = writeoffs.length + woodWo.length + drWo.length;
  var woBody = '';
  function woItem(name, sub, subColor, amt, deleteFn, editFn){
    return '<div style="border-bottom:1px solid #2e2e3e;padding:8px 0">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:12px;font-weight:700">'+name+'</div>'+
          (sub?'<div style="font-size:10px;color:'+(subColor||'#555568')+'">'+sub+'</div>':'')+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:8px">'+
          '<span style="font-size:12px;font-weight:700;color:#f06060">'+f(amt)+'</span>'+
          (editFn?'<button onclick="'+editFn+'" style="background:none;border:1px solid #c8f060;border-radius:6px;padding:3px 7px;color:#c8f060;font-size:11px;cursor:pointer">✏️</button>':'')+
          '<button onclick="'+deleteFn+'" style="background:none;border:1px solid #3e2e2e;border-radius:6px;padding:3px 7px;color:#f06060;font-size:11px;cursor:pointer">✕</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }
  woBody += '<div style="font-size:10px;color:#c8f060;margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🌳 ДЕРЕВО</div>';
  var woodWoCount = 0;
  writeoffs.forEach(function(w, i){
    var wItems = w.items||[];
    if(wItems.length > 0){
      wItems.forEach(function(it){
        var lbl = (it.article||it.num?'№'+(it.article||it.num)+' ':'')+(it.name||'Списание')+(it.species?' · '+it.species:'')+(it.qty&&it.qty>1?' × '+it.qty:'');
        var sub = '🌳'+(it.price?' · '+f(it.price)+'/шт':'')+(w.reason?' · '+w.reason:'');
        woBody += woItem(lbl, sub, '#555568', (it.price||0)*(it.qty||1), 'svDeleteJEntry(\'writeoff\','+i+')', null);
      });
    } else {
      woBody += woItem(w.sub||w.label||'Списание', w.reason||'', '#555568', w.amount||0, 'svDeleteJEntry(\'writeoff\','+i+')', 'svToggleEdit(\'jwo\','+i+')');
      if(_svEditTarget && _svEditTarget.kind==='jwo' && _svEditTarget.idx===i){
        woBody += simpleEditForm('jwo'+i, '#f06060', {kind:'jwo', idx:i, saveFn:'svSaveJEntrySimple(\'writeoff\','+i+')', prefill:{sub:w.sub||w.label||'', amt:w.amount||0, goodsType:w.goodsType}});
      }
    }
    woodWoCount++;
  });
  woodWo.forEach(function(w, i){
    var lbl = (w.article?'№'+w.article+' ':'')+(w.name||'Списание')+(w.species?' · '+w.species:'')+(w.qty?' × '+w.qty:'');
    var sub = '🌳 Дерево'+(w.price?' · '+f(w.price)+'/шт':'')+(w.reason?' · '+w.reason:'');
    woBody += woItem(lbl, sub, '#555568', w.amt||0, 'svDeleteWoodWo('+i+')', 'svToggleEdit(\'woWoodArr\','+i+')');
    if(_svEditTarget && _svEditTarget.kind==='woWoodArr' && _svEditTarget.idx===i){
      woBody += editItemForm('eWoWood'+i, '#f06060', {kind:'woWoodArr', idx:i, extra:{id:'wreason',valueKey:'reason',label:'Причина списания',placeholder:'необязательно'}, saveFn:'svSaveArrItemEdit(\'goodsWriteoffs\','+i+',\'eWoWood'+i+'\')', prefill:w});
    }
    woodWoCount++;
  });
  if(!woodWoCount) woBody += '<div style="font-size:11px;color:#555568;padding:6px 0 10px">Списаний не было</div>';
  woBody += '<div style="font-size:10px;color:#a060f0;margin:10px 0 6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🛍 ДР ТОВАР</div>';
  var drWoCount = 0;
  drWo.forEach(function(w, i){
    var lbl = (w.article?'№'+w.article+' ':'')+(w.name||'Списание ДР')+(w.species?' · '+w.species:'')+(w.qty?' × '+w.qty:'');
    var sub = '🛍 ДР Товар'+(w.price?' · '+f(w.price)+'/шт':'')+(w.reason?' · '+w.reason:'');
    woBody += woItem(lbl, sub, '#a060f0', w.amt||0, 'svDeleteDrWo('+i+')', 'svToggleEdit(\'woDrArr\','+i+')');
    if(_svEditTarget && _svEditTarget.kind==='woDrArr' && _svEditTarget.idx===i){
      woBody += editItemForm('eWoDr'+i, '#a060f0', {kind:'woDrArr', idx:i, extra:{id:'wreason',valueKey:'reason',label:'Причина списания',placeholder:'необязательно'}, saveFn:'svSaveArrItemEdit(\'drGoodsWriteoffs\','+i+',\'eWoDr'+i+'\')', prefill:w});
    }
    drWoCount++;
  });
  if(!drWoCount) woBody += '<div style="font-size:11px;color:#555568;padding:6px 0">Списаний не было</div>';
  var expHasData = zp||inkass||otherExp||drInkass||drSupplier||expenses.length;
  var expBody = '';
  var woodExp = expenses.filter(function(e){ return e.goodsType !== 'dr' && e.goodsType !== 'staff'; });
  var drExp   = expenses.filter(function(e){ return e.goodsType === 'dr'; });
  var staffExp = expenses.filter(function(e){ return e.goodsType === 'staff'; });
  function expItem(label, amt, color, deleteFn){
    return '<div style="border-bottom:1px solid #2e2e3e;padding:8px 0">'+
      '<div style="display:flex;justify-content:space-between;align-items:center">'+
        '<div style="font-size:12px;font-weight:700">'+label+'</div>'+
        '<div style="display:flex;align-items:center;gap:8px">'+
          '<span style="font-size:12px;font-weight:700;color:'+(color||'#f0a060')+'">'+f(amt)+'</span>'+
          (deleteFn?'<button onclick="'+deleteFn+'" style="background:none;border:1px solid #3e2e2e;border-radius:6px;padding:3px 7px;color:#f06060;font-size:11px;cursor:pointer">✕</button>':'')+
        '</div>'+
      '</div>'+
    '</div>';
  }
  expBody += '<div style="font-size:10px;color:#c8f060;margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🌳 ДЕРЕВО</div>';
  var woodExpCount = 0;
  if(woodExp.length){
    var etypes={zp:'💰 ЗП',travel:'🚌 Проезд',inkass:'🏦 Инкассация',supplier:'🏭 Поставщик',other:'📝 Прочее'};
    woodExp.forEach(function(e, i){
      var label=(etypes[e.expType]||e.expType||'Расход')+(e.forSeller?' → '+e.forSeller:'')+(e.comment?' · '+e.comment:'');
      expBody += expItem(label, e.amount||0, '#f0a060', 'svDeleteJEntry(\'expense\','+i+')');
      woodExpCount++;
    });
  } else {
    if(zp){ expBody += expItem('💰 ЗП (план, не введено как факт)', zp, '#8888aa', null); woodExpCount++; }
    if(inkass){ expBody += expItem('🏦 Инкассация (план, не введено как факт)', inkass, '#8888aa', null); woodExpCount++; }
    if(otherExp){ expBody += expItem('📝 Прочее (план, не введено как факт)', otherExp, '#8888aa', null); woodExpCount++; }
    if(woodExpCount) expBody += '<div style="font-size:10px;color:#f0a060;padding:4px 0 8px">⚠️ Это старая смена без отдельных записей по расходам — показаны только сохранённые плановые суммы. В карточке ЗП выше «Факт (взято)» не учитывает эти цифры, т.к. реальной записи о выдаче нет. Кнопка «Записи ЗП/расходов не попали в журнал» ниже добавит их как реальные записи, если нужно зафиксировать это как факт.</div>';
  }
  if(!woodExpCount) expBody += '<div style="font-size:11px;color:#555568;padding:6px 0 10px">Расходов не было</div>';
  expBody += '<div style="font-size:10px;color:#a060f0;margin:10px 0 6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🛍 ДР ТОВАР</div>';
  var drExpCount = 0;
  if(drExp.length){
    var etypes2={zp:'💰 ЗП',travel:'🚌 Проезд',inkass:'🏦 Инкассация',supplier:'🏭 Поставщик',other:'📝 Прочее'};
    drExp.forEach(function(e, i){
      var label=(etypes2[e.expType]||e.expType||'Расход ДР')+(e.forSeller?' → '+e.forSeller:'')+(e.comment?' · '+e.comment:'');
      var realIdx = expenses.indexOf(e);
      expBody += expItem(label, e.amount||0, '#a060f0', 'svDeleteJEntry(\'expense\','+realIdx+')');
      drExpCount++;
    });
  } else {
    if(drInkass){ expBody += expItem('🏦 Инкассация ДР (план, не введено как факт)', drInkass, '#8888aa', null); drExpCount++; }
    if(drSupplier){ expBody += expItem('🏭 Поставщик ДР (план, не введено как факт)'+(sh.drSupplierName?' ('+sh.drSupplierName+')':''), drSupplier, '#8888aa', null); drExpCount++; }
    if(drExpCount) expBody += '<div style="font-size:10px;color:#f0a060;padding:4px 0 8px">⚠️ Это старая смена без отдельных записей по расходам ДР — показаны только сохранённые плановые суммы, не факт.</div>';
  }
  if(!drExpCount) expBody += '<div style="font-size:11px;color:#555568;padding:6px 0">Расходов не было</div>';
  expBody += '<div style="font-size:10px;color:#60c8f0;margin:10px 0 6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🛒 ПОКУПКИ СОТРУДНИКОВ</div>';
  var staffExpCount = 0;
  if(staffExp.length){
    var etypes3={zp:'💰 ЗП',travel:'🚌 Проезд',inkass:'🏦 Инкассация',other:'📝 Прочее'};
    staffExp.forEach(function(e){
      var label=(etypes3[e.expType]||e.expType||'Расход')+(e.comment?' · '+e.comment:'');
      var realIdx = expenses.indexOf(e);
      expBody += expItem(label, e.amount||0, '#60c8f0', 'svDeleteJEntry(\'expense\','+realIdx+')');
      staffExpCount++;
    });
  }
  if(!staffExpCount) expBody += '<div style="font-size:11px;color:#555568;padding:6px 0">Расходов не было</div>';
  var staffBody = '';
  var woodStaff = staffArr.filter(function(s){ return s.goodsType !== 'dr'; });
  var drStaff   = staffArr.filter(function(s){ return s.goodsType === 'dr'; });
  function staffItem(s, realIdx){
    var who = s.who || (s.label||'').replace('Покупка сотр.: ','');
    var item = (s.article?'№'+s.article+' ':'')+(s.item || s.sub || '')+(s.species?' · '+s.species:'')+(s.qty?' × '+s.qty:'');
    var retail = s.retail || 0;
    var opt = s.opt || s.amount || 0;
    var canDel = staffPurch.length > 0;
    var html = '<div style="border-bottom:1px solid #2e2e3e;padding:8px 0">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:12px;font-weight:700">'+who+'</div>'+
          '<div class="u-fs11-gray">'+(item||'')+(retail?' · розница '+f(retail):'')+'</div>'+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:8px">'+
          '<span style="font-size:12px;font-weight:700;color:#a060f0">'+f(opt)+'</span>'+
          '<button onclick="svToggleEdit(\'staff\','+realIdx+')" style="background:none;border:1px solid #c8f060;border-radius:6px;padding:3px 7px;color:#c8f060;font-size:11px;cursor:pointer">✏️</button>'+
          (canDel?'<button onclick="svDeleteJEntry(\'staff\','+realIdx+')" style="background:none;border:1px solid #3e2e2e;border-radius:6px;padding:3px 7px;color:#f06060;font-size:11px;cursor:pointer">✕</button>':'')+
        '</div>'+
      '</div>'+
    '</div>';
    if(_svEditTarget && _svEditTarget.kind==='staff' && _svEditTarget.idx===realIdx){
      html += editItemForm('eStaff'+realIdx, '#a060f0', {kind:'staff', idx:realIdx, who:true, retail:true,
        saveFn:'svSaveStaffEdit('+realIdx+',\'eStaff'+realIdx+'\')',
        prefill:{who:who, art:s.article||'', name:s.item||s.sub||'', species:s.species||'', price:s.price||s.opt||0, qty:s.qty||1, amt:opt, retail:retail}});
    }
    return html;
  }
  staffBody += '<div style="font-size:10px;color:#c8f060;margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🌳 ДЕРЕВО</div>';
  if(woodStaff.length){ woodStaff.forEach(function(s){ staffBody += staffItem(s, staffArr.indexOf(s)); }); }
  else staffBody += '<div style="font-size:11px;color:#555568;padding:6px 0 10px">Покупок не было</div>';
  staffBody += '<div style="font-size:10px;color:#a060f0;margin:10px 0 6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">🛍 ДР ТОВАР</div>';
  if(drStaff.length){ drStaff.forEach(function(s){ staffBody += staffItem(s, staffArr.indexOf(s)); }); }
  else staffBody += '<div style="font-size:11px;color:#555568;padding:6px 0">Покупок не было</div>';
  function itemForm(id, color, opts){
    opts = opts || {};
    var items = getItemsBase();
    var species = getSpecies();
    var dlItems = 'dl_items_'+id, dlSpecies = 'dl_species_'+id;
    var html = '<div id="svAddForm_'+id+'" style="display:none;background:#13131a;border:1px solid '+color+';border-radius:10px;padding:10px;margin-top:8px">';
    html += '<datalist id="'+dlItems+'">'+items.slice(0,80).map(function(it){ return '<option value="'+(it.name||'')+'">'; }).join('')+'</datalist>';
    html += '<datalist id="'+dlSpecies+'">'+species.slice(0,80).map(function(sp){ return '<option value="'+sp+'">'; }).join('')+'</datalist>';
    if(opts.who){
      html += '<div style="margin-bottom:6px"><div class="u-fs10-gray-mb3">Сотрудник</div>'+
        '<input class="fi u-inp-compact" id="svAdd_'+id+'_who" placeholder="Имя"></div>';
    }
    html += '<div style="display:flex;gap:5px;margin-bottom:6px">'+
      '<div style="flex:0 0 64px"><div class="u-fs10-gray-mb3">Артикул</div>'+
        '<input class="fi u-inp-compact" id="svAdd_'+id+'_art" placeholder="№" oninput="svItemLookup(\''+id+'\')"></div>'+
      '<div style="flex:1"><div class="u-fs10-gray-mb3">Наименование</div>'+
        '<input class="fi u-inp-compact" id="svAdd_'+id+'_name" list="'+dlItems+'" placeholder="Товар"></div>'+
      '<div style="flex:0 0 90px"><div class="u-fs10-gray-mb3">Порода</div>'+
        '<input class="fi u-inp-compact" id="svAdd_'+id+'_species" list="'+dlSpecies+'" placeholder="Порода"></div>'+
    '</div>';
    html += '<div style="display:flex;gap:5px;margin-bottom:6px">'+
      '<div style="flex:1"><div class="u-fs10-gray-mb3">Цена за ед.</div>'+
        '<input class="fi u-inp-compact" id="svAdd_'+id+'_price" type="text" inputmode="numeric" placeholder="0" oninput="svItemCalc(\''+id+'\')"></div>'+
      '<div style="flex:1"><div class="u-fs10-gray-mb3">Кол-во</div>'+
        '<input class="fi u-inp-compact" id="svAdd_'+id+'_qty" type="text" inputmode="numeric" placeholder="1" value="1" oninput="svItemCalc(\''+id+'\')"></div>'+
      '<div style="flex:1"><div class="u-fs10-gray-mb3">Сумма, ₽</div>'+
        '<input class="fi u-inp-compact" id="svAdd_'+id+'_amt" type="text" inputmode="numeric" placeholder="0" oninput="svItemCalcRev(\''+id+'\')"></div>'+
    '</div>';
    if(opts.retail){
      html += '<div style="margin-bottom:6px"><div class="u-fs10-gray-mb3">Цена розница, ₽</div>'+
        '<input class="fi u-inp-compact" id="svAdd_'+id+'_retail" type="text" inputmode="numeric" placeholder="0"></div>';
    }
    if(opts.extra){
      html += '<div style="margin-bottom:6px"><div class="u-fs10-gray-mb3">'+opts.extra.label+'</div>'+
        '<input class="fi u-inp-compact" id="svAdd_'+id+'_'+opts.extra.id+'" placeholder="'+opts.extra.placeholder+'"></div>';
    }
    html += '<div id="svAddHint_'+id+'" style="font-size:10px;color:#8888aa;margin-bottom:6px;display:none"></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px">'+
      '<button onclick="document.getElementById(\'svAddForm_'+id+'\').style.display=\'none\'" style="padding:8px;background:none;border:1px solid #2e2e3e;border-radius:8px;color:#8888aa;font-size:12px;cursor:pointer">Отмена</button>'+
      '<button onclick="'+opts.saveFn+'" style="padding:8px;background:'+color+';border:none;border-radius:8px;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer">💾 Сохранить</button>'+
    '</div></div>';
    return html;
  }
  function addFormBtn(color, onclick, label){
    return '<button onclick="'+onclick+'" style="width:100%;padding:8px;background:none;border:1px dashed '+color+';border-radius:9px;color:'+color+';font-size:12px;font-weight:700;cursor:pointer;margin-top:8px">+ '+label+'</button>';
  }
  function addForm(id, color, fields, saveFn){
    var html = '<div id="svAddForm_'+id+'" style="display:none;background:#13131a;border:1px solid '+color+';border-radius:10px;padding:10px;margin-top:8px">';
    fields.forEach(function(fld){
      if(fld.type === 'select'){
        html += '<div style="margin-bottom:6px"><div class="u-fs10-gray-mb3">'+fld.label+'</div>'+
          '<select id="svAdd_'+fld.id+'" class="fs" style="width:100%;margin:0;padding:8px;border-radius:8px;background:#1a1a22;border:1px solid #2e2e3e;color:#f0f0f8;font-size:12px">'+
          fld.options.map(function(o){ return '<option value="'+o.v+'">'+o.l+'</option>'; }).join('')+
          '</select></div>';
      } else {
        html += '<div style="margin-bottom:6px"><div class="u-fs10-gray-mb3">'+fld.label+'</div>'+
          '<input class="fi u-inp-compact" id="svAdd_'+fld.id+'" type="'+(fld.type||'text')+'" placeholder="'+(fld.placeholder||'')+'" '+(fld.inputmode?'inputmode="'+fld.inputmode+'"':'')+'></div>';
      }
    });
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px">'+
      '<button onclick="document.getElementById(\'svAddForm_'+id+'\').style.display=\'none\'" style="padding:8px;background:none;border:1px solid #2e2e3e;border-radius:8px;color:#8888aa;font-size:12px;cursor:pointer">Отмена</button>'+
      '<button onclick="'+saveFn+'" style="padding:8px;background:'+color+';border:none;border-radius:8px;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer">💾 Сохранить</button>'+
    '</div></div>';
    return html;
  }
  rcvBody += '<div style="border-top:1px solid #2e2e3e;margin-top:8px;padding-top:8px">'+
    addFormBtn('#60f090','showAddForm(\'rcvWood\')','Добавить приход Дерево (1 позиция)')+
    itemForm('rcvWood','#60f090',{extra:{id:'from',label:'Откуда / поставщик',placeholder:'необязательно'},saveFn:'svAddRcv(\'wood\')'})+
    addFormBtn('#a060f0','showAddForm(\'rcvDr\')','Добавить приход ДР (1 позиция)')+
    itemForm('rcvDr','#a060f0',{saveFn:'svAddRcv(\'dr\')'})+
    addFormBtn('#60c8f0','svShowInvoicePicker()','Принять накладную целиком')+
    '<div id="svInvoicePicker" style="display:none;background:#0c1a20;border:1px solid #60c8f0;border-radius:10px;padding:10px;margin-top:8px"></div>'+
    addFormBtn('#f0c060','svOpenManualInvForm()','Внести накладную вручную')+
    '<div id="svManualInvForm" style="display:none;background:#1a1a0c;border:1px solid #f0c060;border-radius:10px;padding:10px;margin-top:8px"></div>'+
    '<div style="border-top:1px solid #2e2e3e;margin-top:10px;padding-top:10px">'+
      '<button onpointerdown="event.preventDefault();scanCrossShiftDuplicateReceives(\''+(sh.id||sh._id||'')+'\',\''+(sh.shopName||'')+'\',this)" style="width:100%;padding:9px;background:none;border:1px solid #f0a060;border-radius:9px;font-weight:700;font-size:12px;color:#f0a060;cursor:pointer">🔍 Проверить задвоения приходов между сменами</button>'+
      '<div id="crossShiftDupResult" style="margin-top:8px"></div>'+
    '</div>'+
  '</div>';
  woBody += '<div style="border-top:1px solid #2e2e3e;margin-top:8px;padding-top:8px">'+
    addFormBtn('#f06060','showAddForm(\'woWood\')','Добавить списание Дерево')+
    itemForm('woWood','#f06060',{extra:{id:'reason',label:'Причина',placeholder:'необязательно'},saveFn:'svAddWo(\'wood\')'})+
    addFormBtn('#c060a0','showAddForm(\'woDr\')','Добавить списание ДР')+
    itemForm('woDr','#c060a0',{extra:{id:'reason',label:'Причина',placeholder:'необязательно'},saveFn:'svAddWo(\'dr\')'})+
  '</div>';
  expBody += '<div style="border-top:1px solid #2e2e3e;margin-top:8px;padding-top:8px">'+
    addFormBtn('#f0a060','showAddForm(\'expWood\')','Добавить расход Дерево')+
    addForm('expWood','#f0a060',[
      {id:'expWoodType',label:'Тип',type:'select',options:[
        {v:'inkass',l:'🏦 Инкассация'},{v:'zp',l:'💰 ЗП'},{v:'travel',l:'🚌 Проезд'},{v:'supplier',l:'🏭 Поставщик'},{v:'other',l:'📝 Прочее'}
      ]},
      {id:'expWoodAmt',label:'Сумма, ₽',type:'number',inputmode:'numeric',placeholder:'0'},
      {id:'expWoodComment',label:'Комментарий',placeholder:'необязательно'}
    ],'svAddExp(\'wood\')')+
    addFormBtn('#a060f0','showAddForm(\'expDr\')','Добавить расход ДР')+
    addForm('expDr','#a060f0',[
      {id:'expDrType',label:'Тип',type:'select',options:[
        {v:'inkass',l:'🏦 Инкассация'},{v:'supplier',l:'🏭 Поставщик'},{v:'other',l:'📝 Прочее'}
      ]},
      {id:'expDrAmt',label:'Сумма, ₽',type:'number',inputmode:'numeric',placeholder:'0'},
      {id:'expDrComment',label:'Комментарий',placeholder:'необязательно'}
    ],'svAddExp(\'dr\')')+
    addFormBtn('#60c8f0','showAddForm(\'expStaff\')','Добавить расход Покупки сотрудников')+
    addForm('expStaff','#60c8f0',[
      {id:'expStaffType',label:'Тип',type:'select',options:[
        {v:'inkass',l:'🏦 Инкассация'},{v:'other',l:'📝 Прочее'}
      ]},
      {id:'expStaffAmt',label:'Сумма, ₽',type:'number',inputmode:'numeric',placeholder:'0'},
      {id:'expStaffComment',label:'Комментарий',placeholder:'необязательно'}
    ],'svAddExp(\'staff\')')+
  '</div>';
  staffBody += '<div style="border-top:1px solid #2e2e3e;margin-top:8px;padding-top:8px">'+
    addFormBtn('#c8f060','showAddForm(\'staffWood\')','Добавить покупку Дерево')+
    itemForm('staffWood','#c8f060',{who:true,retail:true,saveFn:'svAddStaff(\'wood\')'})+
    addFormBtn('#a060f0','showAddForm(\'staffDr\')','Добавить покупку ДР')+
    itemForm('staffDr','#a060f0',{who:true,retail:true,saveFn:'svAddStaff(\'dr\')'})+
  '</div>';
  var headerHtml =
    (sh.isArchive?'<div style="font-size:9px;background:#604020;color:#f0a060;border-radius:4px;padding:2px 5px;font-weight:700;display:inline-block;margin-bottom:8px">АРХИВ'+(sh.backfilled?' · ЗАДНИМ ЧИСЛОМ':'')+'</div>':'')+
    (sh.status==='open'?
      '<div style="background:#2e2a14;border:1px solid #f0c060;border-radius:9px;padding:8px 10px;margin-bottom:8px;font-size:11px;color:#f0c060">⚠️ Эта смена ещё не закрыта продавцом (статус "открыта"). Если просто удалить, она может появиться снова, когда устройство продавца синхронизируется.</div>'+
      '<button onclick="svForceCloseShift()" style="width:100%;padding:9px;background:#2e2a14;border:1px solid #f0c060;border-radius:9px;font-weight:700;font-size:12px;color:#f0c060;cursor:pointer;margin-bottom:10px">🔐 Принудительно закрыть смену</button>'
      :'');
  var sid2=sh.id||sh._id||'';
  var auditBody = '<div style="font-size:11px;color:#8888aa;margin-bottom:8px">Показывает все правки, удаления и системные события по этой смене (кто, что и когда сделал).</div>'+
    '<button id="shiftAuditLoadBtn" onpointerdown="event.preventDefault();loadShiftAuditLog(\''+sid2+'\',this)" style="width:100%;padding:9px;background:none;border:1px solid #60c8f0;border-radius:9px;font-weight:700;font-size:12px;color:#60c8f0;cursor:pointer;margin-bottom:8px">🔍 Загрузить историю действий</button>'+
    '<div id="shiftAuditBody"></div>';
  var repairExpHtml=(sh.backfilled||sh.isArchive||sh.source==='psj')?'<button onpointerdown="event.preventDefault();svRepairExpenses(\''+sid2+'\')" style="width:100%;padding:9px;background:#1a1a2e;border:1px solid #a060f0;border-radius:9px;font-weight:700;font-size:12px;color:#a060f0;cursor:pointer;margin-bottom:8px">🔧 Пересчитать расходы (ЗП/проезд/прочие)</button>':'';
  var _hasLegacyExpNoJournal = (sh.backfilled) && ((sh.zp||sh.inkass||sh.otherExp||sh.drInkass||sh.drSupplierAmt)) && !(sh.journal||[]).some(function(e){return e.type==='expense';});
  var repairLegacyExpHtml = _hasLegacyExpNoJournal ? '<button onpointerdown="event.preventDefault();svBuildExpenseJournalFromLegacy(\''+sid2+'\')" style="width:100%;padding:9px;background:#2e1a1a;border:1px solid #f0a060;border-radius:9px;font-weight:700;font-size:12px;color:#f0a060;cursor:pointer;margin-bottom:8px">⚠️ Записи ЗП/расходов не попали в журнал — исправить кассу</button>' : '';
  var promoteHtml=(sh.isRestoreShift||sh.backfilled||sh.source==='psj')?'<button onpointerdown="event.preventDefault();svPromoteToNormal(\''+sid2+'\')" style="width:100%;padding:9px;background:#1a1a2e;border:1px solid #60c8f0;border-radius:9px;font-weight:700;font-size:12px;color:#60c8f0;cursor:pointer;margin-bottom:8px">🔄 Сделать обычной сменой (включить в сверку)</button>':'';
  var pushFirestoreHtml='<button onpointerdown="event.preventDefault();svPushToFirestore(\''+sid2+'\')" style="width:100%;padding:9px;background:#1a2a1e;border:1px solid #60f090;border-radius:9px;font-weight:700;font-size:12px;color:#60f090;cursor:pointer;margin-bottom:8px">☁️ Синхронизировать смену в Firestore</button>';
  var recoverSalesHtml='<button onpointerdown="event.preventDefault();svRecoverSalesFromBackup(\''+sid2+'\')" style="width:100%;padding:9px;background:#1a1a2e;border:1px solid #f0c060;border-radius:9px;font-weight:700;font-size:12px;color:#f0c060;cursor:pointer;margin-bottom:8px">🛟 Сверить с подстраховкой (продажи/расходы/приходы/списания)</button>';
  var deleteShiftHtml = '<button onclick="svDeleteShift()" style="width:100%;padding:16px;background:#2e1a1a;border:2px solid #f06060;border-radius:12px;font-weight:700;font-size:14px;color:#f06060;cursor:pointer;margin-top:14px">🗑 Удалить смену целиком</button>';
  document.getElementById('editShiftBody').innerHTML =
    summaryHtml +
    headerHtml +
    acc('sales', '💰', 'Продажи', '#c8f060', sales.length||null, salesBody) +
    acc('solditems', '📦', 'Проданные товары', '#f0c060', (soldItemsWoodList.length+soldItemsDrList.length)||null, soldItemsBody) +
    acc('cassa', '🏦', 'Касса', '#f0c060', null, cassaBody) +
    acc('tovar', '📦', 'Товар', '#f0a060', null, tovarBody) +
    acc('rcv', '📥', 'Приходы', '#60f090', rcvAllLen||null, rcvBody) +
    acc('wo', '🗑', 'Списания', '#f06060', woAllLen||null, woBody) +
    acc('exp', '💸', 'Расходы', '#f0a060', (expenses.length||(zp||inkass||otherExp||drInkass||drSupplier?1:0))||null, expBody) +
    acc('staff', '🛒', 'Покупки сотрудников', '#a060f0', staffArr.length||null, staffBody) +
    acc('audit', '🔍', 'Аудит смены', '#60c8f0', null, auditBody) +
    pushFirestoreHtml +
    recoverSalesHtml +
    repairExpHtml +
    repairLegacyExpHtml +
    promoteHtml +
    deleteShiftHtml;
}
var _svOpenAccs = {};
function toggleShiftAcc(id){
  var el=document.getElementById(id);
  var arr=document.getElementById(id+'_arr');
  if(!el) return;
  var open = el.style.display!=='none';
  el.style.display = open?'none':'block';
  if(arr) arr.style.transform = open?'':'rotate(180deg)';
  _svOpenAccs[id] = !open;
}
function showAddForm(id){
  var el=document.getElementById('svAddForm_'+id);
  if(el) el.style.display = (el.style.display==='none'||!el.style.display) ? 'block' : 'none';
}
function svManInvSuggest(kind, idx, val){
  var box = document.getElementById('svManInv_'+kind+'_sugg_'+idx);
  if(!box) return;
  val = (val||'').trim().toLowerCase();
  if(!val){ box.style.display='none'; box.innerHTML=''; return; }
  var list;
  if(kind==='name'){
    list = getItemsBase().map(function(it){ return it.name; }).filter(Boolean);
  } else {
    list = (_svManInv && _svManInv.goodsType==='dr') ? getRefBook('iz_dr_species').map(function(g){return g.name||g;}) : getSpecies();
  }
  var matches = list.filter(function(nm){ return nm && String(nm).toLowerCase().indexOf(val)===0; }).slice(0,8);
  if(!matches.length){ box.style.display='none'; box.innerHTML=''; return; }
  box.innerHTML = matches.map(function(m){
    return '<div onpointerdown="event.preventDefault();svManInvPick(\''+kind+'\','+idx+',\''+String(m).replace(/'/g,"\\'")+'\')" style="padding:8px 10px;font-size:12px;color:#f0f0f8;border-bottom:1px solid #2e2e3e;cursor:pointer">'+m+'</div>';
  }).join('');
  box.style.display='block';
}
function svManInvPick(kind, idx, val){
  svManInvItemField(idx, kind, val);
  var input = document.getElementById('svManInv_'+kind+'_'+idx);
  if(input) input.value = val;
  var box = document.getElementById('svManInv_'+kind+'_sugg_'+idx);
  if(box) box.style.display='none';
}
function svManInvHideSugg(kind, idx){
  setTimeout(function(){ var box=document.getElementById('svManInv_'+kind+'_sugg_'+idx); if(box) box.style.display='none'; }, 150);
}
var _svManInv = null;
function _suggestNextInvoiceNum(shopName, dateStr){
  try{
    var monthKey = (dateStr||new Date().toISOString().split('T')[0]).slice(0,7); // 'YYYY-MM'
    var all = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]').concat(JSON.parse(localStorage.getItem('iz_invoices')||'[]'));
    var maxNum = 0;
    all.forEach(function(iv){
      if((iv.destName||iv.shopName)!==shopName) return;
      if((iv.date||'').slice(0,7)!==monthKey) return;
      var n = parseInt(String(iv.num||'').replace(/\D/g,''),10);
      if(!isNaN(n) && n>maxNum) maxNum = n;
    });
    return String(maxNum+1);
  }catch(e){ return '1'; }
}
function svOpenManualInvForm(){
  var box = document.getElementById('svManualInvForm');
  if(!box) return;
  if(box.style.display==='block'){ box.style.display='none'; return; }
  if(!_svManInv || !_svManInv._open){
    var today = (_currentShiftView && _currentShiftView.date) || new Date().toISOString().split('T')[0];
    var suggestedNum = _suggestNextInvoiceNum(_currentShiftView && _currentShiftView.shopName, today);
    _svManInv = {_open:true, num:suggestedNum, date:today, from:'', goodsType:'derevo', items:[]};
  }
  svRenderManualInvForm();
  box.style.display='block';
  try{
    ['goods_derevo','goods_dr','items'].forEach(function(doc){
      db.collection('iz_settings').doc(doc).get({source:'server'}).then(function(snap){
        if(!snap.exists) return;
        var data = snap.data();
        var field = doc==='items' ? 'items' : 'data';
        if(data[field]!==undefined){
          var lsKey = doc==='items' ? 'iz_items' : (doc==='goods_derevo' ? 'iz_goods_derevo' : 'iz_goods_dr');
          localStorage.setItem(lsKey, JSON.stringify(data[field]));
        }
      }).catch(function(){});
    });
  }catch(e){}
}
function svRenderManualInvForm(){
  var box = document.getElementById('svManualInvForm'); if(!box || !_svManInv) return;
  var s = _svManInv;
  var itemsHtml = s.items.map(function(it,i){
    return '<div style="background:#13131a;border:1px solid #2e2e3e;border-radius:9px;padding:8px;margin-bottom:6px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
        '<div style="font-size:10px;color:#8888aa;font-weight:700">Позиция '+(i+1)+'</div>'+
        '<button onpointerdown="event.preventDefault();svManInvRemoveItem('+i+')" style="padding:4px 8px;background:none;border:1px solid #f06060;border-radius:6px;color:#f06060;font-size:11px;cursor:pointer">✕ Удалить</button>'+
      '</div>'+
      '<div style="display:flex;gap:5px;margin-bottom:5px">'+
        '<div style="flex:0 0 62px"><div style="font-size:9px;color:#8888aa;margin-bottom:2px">№</div>'+
          '<input class="fi" value="'+(it.article||'')+'" oninput="svManInvItemField('+i+',\'article\',this.value)" style="margin:0;padding:7px;font-size:12px;width:100%;box-sizing:border-box"></div>'+
        '<div style="flex:1;min-width:0;position:relative"><div style="font-size:9px;color:#8888aa;margin-bottom:2px">Наименование</div>'+
          '<input class="fi" id="svManInv_name_'+i+'" value="'+(it.name||'')+'" autocomplete="off" '+
            'oninput="svManInvItemField('+i+',\'name\',this.value);svManInvSuggest(\'name\','+i+',this.value)" '+
            'onblur="svManInvHideSugg(\'name\','+i+')" '+
            'style="margin:0;padding:7px;font-size:12px;width:100%;box-sizing:border-box">'+
          '<div id="svManInv_name_sugg_'+i+'" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:30;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;max-height:160px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:2px"></div>'+
        '</div>'+
      '</div>'+
      '<div style="display:flex;gap:5px">'+
        '<div style="flex:1;min-width:0;position:relative"><div style="font-size:9px;color:#8888aa;margin-bottom:2px">Порода</div>'+
          '<input class="fi" id="svManInv_species_'+i+'" value="'+(it.species||'')+'" autocomplete="off" '+
            'oninput="svManInvItemField('+i+',\'species\',this.value);svManInvSuggest(\'species\','+i+',this.value)" '+
            'onblur="svManInvHideSugg(\'species\','+i+')" '+
            'style="margin:0;padding:7px;font-size:12px;width:100%;box-sizing:border-box">'+
          '<div id="svManInv_species_sugg_'+i+'" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:30;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;max-height:160px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:2px"></div>'+
        '</div>'+
        '<div style="flex:0 0 72px"><div style="font-size:9px;color:#8888aa;margin-bottom:2px">Цена</div>'+
          '<input class="fi" type="text" inputmode="numeric" value="'+(it.price||'')+'" oninput="svManInvItemField('+i+',\'price\',this.value);svManInvUpdateTotal()" style="margin:0;padding:7px;font-size:12px;width:100%;box-sizing:border-box"></div>'+
        '<div style="flex:0 0 52px"><div style="font-size:9px;color:#8888aa;margin-bottom:2px">Кол-во</div>'+
          '<input class="fi" type="text" inputmode="numeric" value="'+(it.qty||1)+'" oninput="svManInvItemField('+i+',\'qty\',this.value);svManInvUpdateTotal()" style="margin:0;padding:7px;font-size:12px;width:100%;box-sizing:border-box"></div>'+
      '</div>'+
    '</div>';
  }).join('');
  var total = s.items.reduce(function(sum,it){ return sum+(it.price||0)*(it.qty||1); },0);
  box.innerHTML =
    '<div style="font-size:11px;color:#f0c060;font-weight:700;margin-bottom:8px">📝 Ручной ввод накладной</div>'+
    '<div style="display:flex;gap:5px;margin-bottom:6px">'+
      '<div style="flex:1"><div style="font-size:9px;color:#8888aa;margin-bottom:2px">№ накладной (авто, можно поправить)</div><input class="fi u-inp-compact" id="svManInv_num" value="'+s.num+'" oninput="svManInvField(\'num\',this.value)"></div>'+
      '<div style="flex:1"><div style="font-size:9px;color:#8888aa;margin-bottom:2px">Дата</div><input class="fi u-inp-compact" id="svManInv_date" type="date" value="'+s.date+'" onchange="svManInvDateChanged(this.value)"></div>'+
    '</div>'+
    '<div style="margin-bottom:6px"><div style="font-size:9px;color:#8888aa;margin-bottom:2px">От кого / поставщик</div><input class="fi u-inp-compact" id="svManInv_from" value="'+s.from+'" oninput="svManInvField(\'from\',this.value)"></div>'+
    '<div style="display:flex;gap:6px;margin-bottom:10px">'+
      '<button onpointerdown="event.preventDefault();svManInvSetType(\'derevo\')" style="flex:1;padding:7px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;border:'+(s.goodsType==='derevo'?'2px solid #c8f060':'1px solid #2e2e3e')+';background:'+(s.goodsType==='derevo'?'#1e2a14':'#22222e')+';color:'+(s.goodsType==='derevo'?'#c8f060':'#8888aa')+'">🌳 Дерево</button>'+
      '<button onpointerdown="event.preventDefault();svManInvSetType(\'dr\')" style="flex:1;padding:7px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;border:'+(s.goodsType==='dr'?'2px solid #a060f0':'1px solid #2e2e3e')+';background:'+(s.goodsType==='dr'?'#1e1a2e':'#22222e')+';color:'+(s.goodsType==='dr'?'#a060f0':'#8888aa')+'">🛍 ДР Товар</button>'+
    '</div>'+
    '<div style="font-size:10px;color:#8888aa;margin-bottom:4px">Позиции:</div>'+
    itemsHtml+
    '<button onpointerdown="event.preventDefault();svManInvAddItem()" style="width:100%;padding:7px;background:none;border:1px dashed #f0c060;border-radius:8px;color:#f0c060;font-size:11px;font-weight:700;cursor:pointer;margin-bottom:8px">+ Добавить позицию</button>'+
    '<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding:6px 0;border-top:1px solid #2e2e3e;margin-bottom:8px"><span>Итого</span><span id="svManInvTotal">'+fmt(total)+'</span></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">'+
      '<button onclick="document.getElementById(\'svManualInvForm\').style.display=\'none\'" style="padding:9px;background:none;border:1px solid #2e2e3e;border-radius:8px;color:#8888aa;font-size:12px;cursor:pointer">Отмена</button>'+
      '<button onpointerdown="event.preventDefault();svSaveManualInvIntoShift()" style="padding:9px;background:#f0c060;border:none;border-radius:8px;color:#1a1a0c;font-size:12px;font-weight:700;cursor:pointer">💾 Сохранить накладную</button>'+
    '</div>';
}
function svManInvField(field, val){ if(_svManInv) _svManInv[field]=val; }
function svManInvDateChanged(val){
  if(!_svManInv) return;
  _svManInv.date = val;
  _svManInv.num = _suggestNextInvoiceNum(_currentShiftView && _currentShiftView.shopName, val);
  svRenderManualInvForm();
}
function svManInvSetType(type){ if(_svManInv){ _svManInv.goodsType=type; svRenderManualInvForm(); } }
function svManInvAddItem(){
  if(!_svManInv) return;
  _svManInv.items.push({article:'', name:'', species:'', price:0, qty:1});
  svRenderManualInvForm();
}
function svManInvRemoveItem(idx){
  if(!_svManInv) return;
  _svManInv.items.splice(idx,1);
  svRenderManualInvForm();
}
function svManInvItemField(idx, field, val){
  if(!_svManInv || !_svManInv.items[idx]) return;
  _svManInv.items[idx][field] = (field==='price'||field==='qty') ? (parseFloat(val)||0) : val;
}
function svManInvUpdateTotal(){
  if(!_svManInv) return;
  var totalEl = document.getElementById('svManInvTotal'); if(!totalEl) return;
  var total = _svManInv.items.reduce(function(sum,it){ return sum+(it.price||0)*(it.qty||1); },0);
  totalEl.textContent = fmt(total);
}
function _addReceiveToShift(shift, items, goodsType, opts){
  opts = opts || {};
  var isDr = goodsType==='dr';
  var totalAmt = items.reduce(function(sum,it){ return sum+(it.price||0)*(it.qty||1); },0);
  var rcvEntry = {
    id: uid(), type:'receive', ts: shift.date+'T'+(new Date().toTimeString().slice(0,8)), icon:'📥',
    label: opts.invNum ? ('Приёмка '+opts.invNum+(isDr?' (ДР)':'')) : ('Приход'+(isDr?' (ДР)':'')),
    sub: items.length+' изд.'+(opts.from?' · от '+opts.from:'')+(opts.subSuffix?(' · '+opts.subSuffix):''),
    amount: totalAmt, amtCls:'neu', cashEffect:0, cardEffect:0, staffEffect:0,
    goodsType: goodsType,
    goodsEffect: isDr?0:totalAmt, goodsDrEffect: isDr?totalAmt:0,
    items: items
  };
  if(opts.invId) rcvEntry.invId = opts.invId;
  var jnl = shift.journal||[];
  jnl.push(rcvEntry);
  shift.journal = jnl;
  _recordJournalEntryIndependently(rcvEntry, shift.shopName, 'receive');
  try{ stockApplyReceive(shift.shopName, items.map(function(it){ return {num:it.article,name:it.name,price:it.price,qty:it.qty,species:it.species,goodsType:goodsType}; }), shift.date, goodsType); }catch(e){}
  return rcvEntry;
}
function svSaveManualInvIntoShift(){
  try{ _svSaveManualInvIntoShiftReal(); }
  catch(e){
    console.log('[svSaveManualInvIntoShift] ошибка:', e);
    alert('⛔ Ошибка при сохранении накладной: '+(e&&e.message?e.message:e)+'\n\nВведённые позиции НЕ потеряны на экране — попробуйте нажать «Сохранить накладную» ещё раз, либо сообщите об ошибке.');
  }
}
function _svSaveManualInvIntoShiftReal(){
  if(!_svManInv || !_currentShiftView){ alert('⛔ Форма накладной не найдена — откройте смену заново и внесите позиции ещё раз.'); return; }
  var s = _svManInv;
  var items = s.items.filter(function(it){ return (it.name||'').trim() && (it.price||0)>0; });
  if(!items.length){ alert('⛔ Не сохранено! Добавьте хотя бы одну позицию с названием и ценой.'); return; }
  if(!s.num){ alert('⛔ Не сохранено! Укажите номер накладной — поле выше в этой же форме.'); return; }
  var who = (session&&(session.name||session.sellerName))||'Администратор';
  var totalAmt = items.reduce(function(sum,it){ return sum+(it.price||0)*(it.qty||1); },0);
  var cutoffDate = new Date(Date.now()-5*86400000).toISOString().split('T')[0];
  var allInv = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]').concat(JSON.parse(localStorage.getItem('iz_invoices')||'[]'));
  var possibleDup = allInv.find(function(iv){
    var ivShop = iv.destName||iv.shopName;
    var ivItems = iv.acceptedItems||iv.items||[];
    var ivTotal = ivItems.reduce(function(sum,it){ return sum+(it.factPrice!=null?it.factPrice:(it.price||0))*(it.qty||1); },0);
    return ivShop===_currentShiftView.shopName && (iv.date||'')>=cutoffDate &&
      Math.abs(ivTotal-totalAmt)<1 && ivItems.length===items.length;
  });
  if(possibleDup && !confirm('⚠️ Похоже, в системе уже есть накладная на ту же сумму ('+fmt(totalAmt)+') и то же число позиций ('+items.length+') для этого магазина за последние дни'+(possibleDup.status==='accepted'?' (уже принята)':' (ещё не принята)')+'.\n\nЭто может быть та же самая накладная, внесённая ещё раз — тогда приход задвоится.\n\nВсё равно продолжить?')) return;
  var isDr = s.goodsType==='dr';
  var inv = {
    id: uid(), num: s.num, date: s.date, docDate: s.date, from: s.from,
    destName: _currentShiftView.shopName, shopName: _currentShiftView.shopName,
    goodsType: s.goodsType, items: items, totalAmt: totalAmt,
    status: 'accepted', acceptedAt: new Date().toISOString(), acceptedDate: s.date,
    createdBy: who, manual: true, enteredManuallyByAdmin: true
  };
  var existing = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  existing.unshift(inv);
  localStorage.setItem('iz_manual_invoices', JSON.stringify(existing));
  db.collection('iz_manual_invoices').doc(inv.id).set(inv).catch(function(e){
    console.log('[svSaveManualInvIntoShift] ошибка сохранения:', e);
    _queuePendingInvoice('iz_manual_invoices', inv);
    showToast('⚠️ Накладная сохранена только на телефоне — досошлётся автоматически');
  });
  if(s.from) saveSupplier(s.from);
  items.forEach(function(it){ autoSaveToItemBase(it.name, it.article, it.price, isDr?'dr':'derevo'); });
  _addReceiveToShift(_currentShiftView, items, s.goodsType, {invId: inv.id, invNum: s.num, from: s.from, subSuffix: 'внесено вручную'});
  svPersist();
  _svManInv = null;
  var box = document.getElementById('svManualInvForm'); if(box) box.style.display='none';
  _svOpenAccs['acc_rcv']=true; _renderShiftView();
  showToast('✅ Накладная '+inv.num+' внесена: '+items.length+' изд. на '+fmt(totalAmt));
}
function svShowInvoicePicker(){
  var box = document.getElementById('svInvoicePicker');
  if(!box) return;
  if(box.style.display==='block'){ box.style.display='none'; return; }
  var shopName = _currentShiftView && _currentShiftView.shopName;
  var manual = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var auto = JSON.parse(localStorage.getItem('iz_invoices')||'[]');
  var pending = manual.concat(auto).filter(function(inv){
    return inv.shopName===shopName && inv.status!=='accepted';
  });
  pending.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
  if(!pending.length){
    box.innerHTML = '<div style="font-size:12px;color:#8888aa;text-align:center;padding:6px">Непринятых накладных для этого магазина не найдено</div>';
    box.style.display='block';
    return;
  }
  box.innerHTML = '<div style="font-size:11px;color:#60c8f0;font-weight:700;margin-bottom:8px">Выберите накладную для приёмки целиком:</div>'+
    pending.map(function(inv){
      var id = inv.id||inv._id;
      var itemsCount = (inv.items||[]).length;
      var total = (inv.items||[]).reduce(function(s,it){ return s+(it.price||0)*(it.qty||1); },0);
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #1a2a30">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:12px;font-weight:700">'+(inv.num||'Накладная')+' · '+(inv.date||'')+'</div>'+
          '<div class="u-fs10-gray">'+itemsCount+' изд. · '+fmt(total)+(inv.goodsType==='dr'?' · ДР':' · Дерево')+'</div>'+
        '</div>'+
        '<button onpointerdown="event.preventDefault();svAcceptInvoiceIntoShift(\''+id+'\')" style="flex-shrink:0;padding:7px 12px;background:#60c8f0;border:none;border-radius:7px;color:#0c1a20;font-size:11px;font-weight:700;cursor:pointer">✅ Принять</button>'+
      '</div>';
    }).join('');
  box.style.display='block';
}
function svAcceptInvoiceIntoShift(invId){
  if(!_currentShiftView) return;
  var who = (session&&(session.name||session.sellerName))||'Администратор';
  var manual = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var auto = JSON.parse(localStorage.getItem('iz_invoices')||'[]');
  var manIdx = manual.findIndex(function(i){ return (i.id||i._id)===invId; });
  var isManual = manIdx>=0;
  var invArr = isManual ? manual : auto;
  var idx = isManual ? manIdx : invArr.findIndex(function(i){ return (i.id||i._id)===invId; });
  if(idx<0){ showToast('Накладная не найдена'); return; }
  var inv = invArr[idx];
  var invTotalCheck = (inv.items||[]).reduce(function(s,it){ return s+(it.price||0)*(it.qty||1); },0);
  var cutoffDateChk = new Date(Date.now()-5*86400000).toISOString().split('T')[0];
  var jnlForDup = _currentShiftView.journal||[];
  var dupInShift = jnlForDup.find(function(e){
    return e.type==='receive' && Math.abs((e.amount||0)-invTotalCheck)<1;
  });
  var allShiftsChk = getShifts().filter(function(s){
    return s.shopName===_currentShiftView.shopName && (s.date||'')>=cutoffDateChk;
  });
  var dupInRecentShifts = allShiftsChk.some(function(s){
    return (s.journal||[]).some(function(e){ return e.type==='receive' && Math.abs((e.amount||0)-invTotalCheck)<1; });
  });
  var warnMsg = 'Принять эту накладную целиком в смену «'+_currentShiftView.shopName+' · '+_currentShiftView.date+'»?';
  if(dupInShift || dupInRecentShifts){
    warnMsg = '⚠️ За последние дни в этом магазине уже был приход на такую же сумму ('+fmt(invTotalCheck)+'). Возможно, эта накладная уже принята (например, внесена вручную) — проверьте, прежде чем продолжить.\n\n'+warnMsg;
  }
  if(!confirm(warnMsg)) return;
  var accepted = (inv.items||[]).map(function(it){
    return Object.assign({}, it, {factPrice: it.price, ok:true});
  });
  var goodsTotal = accepted.reduce(function(s,a){ return s+(a.factPrice||a.price||0)*(a.qty||1); },0);
  var isDr = inv.goodsType==='dr';
  var acceptedForStock = accepted.map(function(a){ return {name:a.name, article:a.article, species:a.species, price:a.factPrice||a.price, qty:a.qty}; });
  _addReceiveToShift(_currentShiftView, acceptedForStock, isDr?'dr':'derevo', {invId: invId, invNum: inv.num, subSuffix: 'принял: '+who});
  inv.status='accepted'; inv.acceptedBy=who; inv.acceptedDate=_currentShiftView.date; inv.acceptedItems=accepted;
  invArr[idx]=inv;
  if(isManual){ localStorage.setItem('iz_manual_invoices', JSON.stringify(manual)); try{ db.collection('iz_manual_invoices').doc(invId).set(inv,{merge:true}); }catch(e){} }
  else { localStorage.setItem('iz_invoices', JSON.stringify(auto)); try{ db.collection('iz_invoices').doc(invId).set(inv,{merge:true}); }catch(e){} }
  svPersist();
  var box = document.getElementById('svInvoicePicker'); if(box) box.style.display='none';
  _svOpenAccs['acc_rcv']=true; _renderShiftView();
  showToast('✅ Накладная принята целиком: '+accepted.length+' изд. на '+fmt(goodsTotal));
}
function svItemLookup(id){
  var artEl=document.getElementById('svAdd_'+id+'_art');
  var nameEl=document.getElementById('svAdd_'+id+'_name');
  var priceEl=document.getElementById('svAdd_'+id+'_price');
  var hintEl=document.getElementById('svAddHint_'+id);
  if(!artEl) return;
  var num=artEl.value.trim();
  if(!num){ if(hintEl) hintEl.style.display='none'; return; }
  var items=getItemsBase();
  var found=items.find(function(it){ return String(it.num)===num; });
  if(found){
    if(nameEl) nameEl.value=found.name||'';
    if(priceEl && !priceEl.value) priceEl.value=found.price||'';
    if(hintEl){ hintEl.style.display='block'; hintEl.style.color='#60f090'; hintEl.textContent='✓ '+(found.name||''); }
    svItemCalc(id);
  } else {
    if(hintEl){ hintEl.style.display='block'; hintEl.style.color='#f06060'; hintEl.textContent='⚠ Артикул не найден — заполните вручную'; }
  }
}
function svItemCalc(id){
  var priceEl=document.getElementById('svAdd_'+id+'_price');
  var qtyEl=document.getElementById('svAdd_'+id+'_qty');
  var amtEl=document.getElementById('svAdd_'+id+'_amt');
  if(!priceEl||!qtyEl||!amtEl) return;
  var price=parseFloat(priceEl.value)||0;
  var qty=parseFloat(qtyEl.value)||0;
  if(price && qty) amtEl.value = Math.round(price*qty);
}
function svItemCalcRev(id){
}
function _svItemRow(id){
  return {
    art: _svVal('svAdd_'+id+'_art').trim(),
    name: _svVal('svAdd_'+id+'_name').trim(),
    species: _svVal('svAdd_'+id+'_species').trim(),
    price: _svNum('svAdd_'+id+'_price'),
    qty: _svNum('svAdd_'+id+'_qty') || 1,
    amt: _svNum('svAdd_'+id+'_amt')
  };
}
function svSaveCassa(){
  var reason=((document.getElementById('sv_cashReason')||{}).value||'').trim();
  if(!reason){showToast('Укажите причину правки');return;}
  _currentShiftView.cashMorning=parseFloat((document.getElementById('sv_cashMorn')||{}).value)||0;
  _currentShiftView.cashEvening=parseFloat((document.getElementById('sv_cashEve')||{}).value)||0;
  _currentShiftView.cashDrMorning=parseFloat((document.getElementById('sv_drCashMorn')||{}).value)||0;
  _currentShiftView.drCashEvening=parseFloat((document.getElementById('sv_drCashEve')||{}).value)||0;
  _currentShiftView.cashStaffMorning=parseFloat((document.getElementById('sv_staffCashMorn')||{}).value)||0;
  _currentShiftView.cashStaffEvening=parseFloat((document.getElementById('sv_staffCashEve')||{}).value)||0;
  _currentShiftView.editedBy=(session&&(session.name||session.sellerName))||'admin';
  _currentShiftView.editedAt=new Date().toISOString();
  _currentShiftView.editReason=reason;
  svPersist(); _renderShiftView(); showToast('✅ Касса обновлена');
}
function svSaveTovar(){
  var reason=((document.getElementById('sv_tovarReason')||{}).value||'').trim();
  if(!reason){showToast('Укажите причину правки');return;}
  var oldMorn = _currentShiftView.goodsMorning||0;
  var oldEve = _currentShiftView.goodsEvening||0;
  var oldDrMorn = _currentShiftView.goodsDrMorning||0;
  var oldDrEve = _currentShiftView.drGoodsEvening||0;
  var newMorn = parseFloat((document.getElementById('sv_goodsMorn')||{}).value)||0;
  var newEveInput = parseFloat((document.getElementById('sv_goodsEve')||{}).value)||0;
  var newDrMorn = parseFloat((document.getElementById('sv_drGoodsMorn')||{}).value)||0;
  var newDrEveInput = parseFloat((document.getElementById('sv_drGoodsEve')||{}).value)||0;
  var goodsEve = newEveInput;
  if(newEveInput === oldEve && newMorn !== oldMorn){
    goodsEve = oldEve + (newMorn - oldMorn);
  }
  var goodsDrEve = newDrEveInput;
  if(newDrEveInput === oldDrEve && newDrMorn !== oldDrMorn){
    goodsDrEve = oldDrEve + (newDrMorn - oldDrMorn);
  }
  _currentShiftView.goodsMorning=newMorn;
  _currentShiftView.goodsEvening=goodsEve;
  _currentShiftView.goodsDrMorning=newDrMorn;
  _currentShiftView.drGoodsEvening=goodsDrEve;
  _currentShiftView.editedBy=(session&&(session.name||session.sellerName))||'admin';
  _currentShiftView.editedAt=new Date().toISOString();
  _currentShiftView.editReason=reason;
  svPersist(true);
  var cascadeResult = null;
  try{ cascadeResult = _cascadeGoodsForward(_currentShiftView, getShifts()); }catch(e){ console.log('[svSaveTovar] cascade err', e); }
  _renderShiftView();
  showToast(cascadeResult && cascadeResult.touched ? ('✅ Остатки товара обновлены, пересчитано смен дальше по датам: '+cascadeResult.touched) : '✅ Остатки товара обновлены');
}
function svCascadeGoodsOnly(){
  if(!confirm('Пересчитать все последующие смены этого магазина (по датам вперёд), опираясь на текущие остатки этой смены? Саму эту смену это не изменит.')) return;
  var cascadeResult = null;
  try{ cascadeResult = _cascadeGoodsForward(_currentShiftView, getShifts()); }catch(e){ console.log('[svCascadeGoodsOnly] cascade err', e); }
  _renderShiftView();
  showToast(cascadeResult && cascadeResult.touched ? ('✅ Пересчитано смен дальше по датам: '+cascadeResult.touched) : 'ℹ️ Все последующие смены уже соответствуют — пересчитывать нечего');
}
function svSaveJEntrySimple(type, idx){
  var jnl = _currentShiftView.journal||[];
  var ofType = jnl.filter(function(e){ return e.type===type; });
  var target = ofType[idx]; if(!target){ showToast('Запись не найдена'); return; }
  var elPrefix = 'svEdit_'+(type==='receive'?'jrcv':'jwo')+idx;
  var sub = ((document.getElementById(elPrefix+'_sub')||{}).value||'').trim();
  var amt = parseFloat((document.getElementById(elPrefix+'_amt')||{}).value);
  var reason = ((document.getElementById(elPrefix+'_reason')||{}).value||'').trim();
  var gtEl = document.getElementById(elPrefix+'_gt');
  if(isNaN(amt)){ showToast('Введите сумму'); return; }
  if(!reason){ showToast('Укажите причину правки'); return; }
  var before = Object.assign({}, target);
  if(sub) target.sub = sub;
  target.amount = amt;
  if(type==='receive'){
    var gt = gtEl ? gtEl.value : (target.goodsType||'derevo');
    target.goodsType = gt;
    target.goodsEffect = gt==='dr' ? 0 : amt;
    target.goodsDrEffect = gt==='dr' ? amt : 0;
  } else {
    var gtWo = gtEl ? gtEl.value : (target.goodsType||'derevo');
    target.goodsType = gtWo;
    target.goodsEffect = gtWo==='dr' ? 0 : -Math.abs(amt);
    target.goodsDrEffect = gtWo==='dr' ? -Math.abs(amt) : 0;
  }
  target.editedBy=(session&&(session.name||session.sellerName))||'admin';
  target.editedAt=new Date().toISOString();
  target.editReason=reason;
  try{ logEntryEdit(before, target, (_currentShiftView&&(_currentShiftView.id||_currentShiftView._id))); }catch(e){}
  _svEditTarget = null;
  svPersist(); _renderShiftView();
  showToast('✅ Запись обновлена');
}
function svSaveArrItemEdit(arrKey, idx, formId){
  var extraKey = arrKey==='goodsReceives' ? 'from' : (arrKey==='goodsWriteoffs'||arrKey==='drGoodsWriteoffs') ? 'wreason' : null;
  var d = _svEditItemRow(formId, extraKey);
  if(!d.name){ showToast('Укажите наименование'); return; }
  if(!d.reason){ showToast('Укажите причину правки'); return; }
  var arr = _currentShiftView[arrKey]||[];
  var target = arr[idx]; if(!target){ showToast('Запись не найдена'); return; }
  var before = Object.assign({}, target);
  target.name = d.name; target.article = d.art; target.species = d.species;
  target.price = d.price; target.qty = d.qty; target.amt = d.amt;
  if(arrKey==='goodsReceives') target.from = d.extra;
  if(arrKey==='goodsWriteoffs' || arrKey==='drGoodsWriteoffs') target.reason = d.extra;
  target.editedBy=(session&&(session.name||session.sellerName))||'admin';
  target.editedAt=new Date().toISOString();
  target.editReason=d.reason;
  _currentShiftView[arrKey]=arr;
  try{ logEntryEdit(before, target, (_currentShiftView&&(_currentShiftView.id||_currentShiftView._id))); }catch(e){}
  _svEditTarget = null;
  svPersist(); _renderShiftView();
  showToast('✅ Запись обновлена');
}
function svSaveStaffEdit(idx, formId){
  var d = _svEditItemRow(formId);
  if(!d.reason){ showToast('Укажите причину правки'); return; }
  var who = ((document.getElementById('svEdit_'+formId+'_who')||{}).value||'').trim();
  var retail = parseFloat((document.getElementById('svEdit_'+formId+'_retail')||{}).value)||0;
  var usingArr = !!(_currentShiftView.staffPurchases && _currentShiftView.staffPurchases.length);
  var target;
  if(usingArr){
    target = (_currentShiftView.staffPurchases||[])[idx];
  } else {
    var jnl = _currentShiftView.journal||[];
    var ofType = jnl.filter(function(e){ return e.type==='staff'; });
    target = ofType[idx];
  }
  if(!target){ showToast('Запись не найдена'); return; }
  var before = Object.assign({}, target);
  if(who) target.who = who;
  target.article = d.art; target.item = d.name; target.species = d.species;
  target.qty = d.qty; target.price = d.price; target.opt = d.amt; target.amount = d.amt; target.retail = retail;
  var isWoodStaff = (target.goodsType||'wood') !== 'dr';
  if(retail > 0){
    target.goodsEffect = isWoodStaff ? -retail : 0;
    target.goodsDrEffect = isWoodStaff ? 0 : -retail;
  }
  target.editedBy=(session&&(session.name||session.sellerName))||'admin';
  target.editedAt=new Date().toISOString();
  target.editReason=d.reason;
  try{ logEntryEdit(before, target, (_currentShiftView&&(_currentShiftView.id||_currentShiftView._id))); }catch(e){}
  _svEditTarget = null;
  svPersist(); _renderShiftView();
  showToast('✅ Запись обновлена');
}
function svOpenInvoiceFromReceive(invId){
  if(!invId){ showToast('У этой записи нет привязанной накладной'); return; }
  var manualAll = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var inv = manualAll.find(function(i){ return String(i._id!=null?i._id:i.id)===invId; });
  var isManual = !!inv;
  if(!inv){
    var autoAll = getInvoices();
    inv = autoAll.find(function(i){ return String(i._id!=null?i._id:i.id)===invId; });
  }
  if(!inv){
    showToast('⏳ Загружаю накладную из Firestore...');
    try{
      db.collection('iz_manual_invoices').doc(invId).get({source:'server'}).then(function(snap){
        if(snap.exists){
          var data = snap.data();
          if(data){
            var manArr = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
            var exists = manArr.find(function(i){ return String(i._id||i.id)===invId; });
            if(!exists){ manArr.push(Object.assign({id:invId},data)); localStorage.setItem('iz_manual_invoices',JSON.stringify(manArr)); }
            svOpenInvoiceFromReceive(invId);
          } else { _showFallbackInvoiceView(invId); }
        } else {
          db.collection('iz_invoices').doc(invId).get({source:'server'}).then(function(snap2){
            if(snap2.exists){
              var data2 = snap2.data();
              if(data2){
                var invArr = JSON.parse(localStorage.getItem('iz_invoices')||'[]');
                var ex2 = invArr.find(function(i){ return String(i._id||i.id)===invId; });
                if(!ex2){ invArr.push(Object.assign({id:invId},data2)); localStorage.setItem('iz_invoices',JSON.stringify(invArr)); }
                svOpenInvoiceFromReceive(invId);
              } else { _showFallbackInvoiceView(invId); }
            } else { _showFallbackInvoiceView(invId); }
          }).catch(function(err){ console.log('[svOpenInvoiceFromReceive] iz_invoices get error:', err&&err.code, err); _showFallbackInvoiceView(invId); });
        }
      }).catch(function(err){ console.log('[svOpenInvoiceFromReceive] iz_manual_invoices get error:', err&&err.code, err); _showFallbackInvoiceView(invId); });
    }catch(e){ console.log('[svOpenInvoiceFromReceive] exception:', e); _showFallbackInvoiceView(invId); }
    return;
  }
  document.getElementById('adminInvTitle').textContent = '📋 Накладная '+(inv.num||'');
  var body = document.getElementById('adminInvBody');
  if(isManual){
    window._manInvEdit[invId] = JSON.parse(JSON.stringify(inv));
    window._manInvEditExpanded[invId] = -1; // all collapsed on open
    var curType = inv.goodsType||'derevo';
    var btnDStyle = curType==='derevo'
      ? 'flex:1;padding:9px;border-radius:10px;border:2px solid #c8f060;background:#1e2a14;color:#c8f060;font-size:12px;font-weight:700;cursor:pointer'
      : 'flex:1;padding:9px;border-radius:10px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:700;cursor:pointer';
    var btnDrStyle = curType==='dr'
      ? 'flex:1;padding:9px;border-radius:10px;border:2px solid #a060f0;background:#1e1a2e;color:#a060f0;font-size:12px;font-weight:700;cursor:pointer'
      : 'flex:1;padding:9px;border-radius:10px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:700;cursor:pointer';
    body.innerHTML =
      '<div class="fg" style="margin-bottom:6px"><label class="fl">Номер</label><input class="fi" id="adminInv_num_'+invId+'" value="'+(inv.num||'')+'" style="margin:0;padding:7px"></div>'+
      '<div class="fg" style="margin-bottom:6px"><label class="fl">От кого</label><input class="fi" id="adminInv_from_'+invId+'" value="'+(inv.from||'')+'" style="margin:0;padding:7px"></div>'+
      '<div style="font-size:10px;color:#8888aa;margin-bottom:4px">ТИП ТОВАРА</div>'+
      '<div style="display:flex;gap:8px;margin-bottom:10px">'+
        '<button type="button" id="adminInvTypeDerevo_'+invId+'" onpointerdown="event.preventDefault();setAdminInvType(\''+invId+'\',\'derevo\')" style="'+btnDStyle+'">🌳 Дерево</button>'+
        '<button type="button" id="adminInvTypeDr_'+invId+'" onpointerdown="event.preventDefault();setAdminInvType(\''+invId+'\',\'dr\')" style="'+btnDrStyle+'">🛍 ДР Товар</button>'+
      '</div>'+
      '<div style="font-size:10px;color:#8888aa;margin-bottom:4px">ПОЗИЦИИ (арт. · наим. · порода · кол-во · цена)</div>'+
      '<div id="maninv_items_'+invId+'"></div>'+
      '<button type="button" onclick="addManInvEditItem(\''+invId+'\')" class="btn sec" style="font-size:12px;margin:6px 0 0">＋ Добавить позицию</button>'+
      '<div id="maninv_total_'+invId+'" style="margin-top:8px"></div>'+
      '<div style="font-size:10px;color:#8888aa;margin:8px 0 3px">Причина правки</div>'+
      '<input class="fi" id="adminInv_reason_'+invId+'" placeholder="Обязательно укажите причину..." style="margin:0;padding:7px;margin-bottom:8px">'+
      '<div class="u-flex-g6">'+
        '<button onclick="svSaveInvoiceFromArchive(\''+invId+'\',true)" style="flex:1;padding:9px;border-radius:8px;border:none;background:#c8f060;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer">💾 Сохранить</button>'+
        '<button onclick="closeMo(\'adminInvMo\')" style="padding:9px 14px;border-radius:8px;border:1px solid #2e2e3e;background:none;color:#8888aa;font-size:12px;cursor:pointer">Отмена</button>'+
      '</div>';
    renderManInvEditItems(invId);
  } else {
    window._shInvEdit[invId] = JSON.parse(JSON.stringify(inv));
    var curType2 = inv.goodsType||'derevo';
    var bD2 = curType2==='derevo'
      ? 'flex:1;padding:9px;border-radius:10px;border:2px solid #c8f060;background:#1e2a14;color:#c8f060;font-size:12px;font-weight:700;cursor:pointer'
      : 'flex:1;padding:9px;border-radius:10px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:700;cursor:pointer';
    var bDr2 = curType2==='dr'
      ? 'flex:1;padding:9px;border-radius:10px;border:2px solid #a060f0;background:#1e1a2e;color:#a060f0;font-size:12px;font-weight:700;cursor:pointer'
      : 'flex:1;padding:9px;border-radius:10px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:700;cursor:pointer';
    window._shInvExpandedMap[invId] = -1;
    body.innerHTML =
      '<div class="fg" style="margin-bottom:6px"><label class="fl">Номер</label><input class="fi" id="adminInv_num_'+invId+'" value="'+(inv.num||'')+'" style="margin:0;padding:7px"></div>'+
      '<div style="font-size:10px;color:#8888aa;margin-bottom:4px">ТИП ТОВАРА</div>'+
      '<div style="display:flex;gap:8px;margin-bottom:10px">'+
        '<button type="button" id="adminInvTypeDerevo_'+invId+'" onpointerdown="event.preventDefault();setAdminInvType(\''+invId+'\',\'derevo\')" style="'+bD2+'">🌳 Дерево</button>'+
        '<button type="button" id="adminInvTypeDr_'+invId+'" onpointerdown="event.preventDefault();setAdminInvType(\''+invId+'\',\'dr\')" style="'+bDr2+'">🛍 ДР Товар</button>'+
      '</div>'+
      '<div style="font-size:10px;color:#8888aa;margin-bottom:4px">ПОЗИЦИИ (арт. · наим. · кол-во · цена)</div>'+
      '<div id="shinv_items_'+invId+'"></div>'+
      '<div style="font-size:10px;color:#8888aa;margin:8px 0 3px">Причина правки</div>'+
      '<input class="fi" id="adminInv_reason_'+invId+'" placeholder="Обязательно укажите причину..." style="margin:0;padding:7px;margin-bottom:8px">'+
      '<div class="u-flex-g6">'+
        '<button onclick="svSaveInvoiceFromArchive(\''+invId+'\',false)" style="flex:1;padding:9px;border-radius:8px;border:none;background:#c8f060;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer">💾 Сохранить</button>'+
        '<button onclick="closeMo(\'adminInvMo\')" style="padding:9px 14px;border-radius:8px;border:1px solid #2e2e3e;background:none;color:#8888aa;font-size:12px;cursor:pointer">Отмена</button>'+
      '</div>';
    renderShInvItems(invId);
  }
  openMo('adminInvMo');
}
function svSaveInvoiceFromArchive(id, isManual){
  var reason = ((document.getElementById('adminInv_reason_'+id)||{}).value||'').trim();
  if(!reason){ showToast('Укажите причину правки'); return; }
  var storeKey = isManual ? 'iz_manual_invoices' : 'iz_invoices';
  var all = JSON.parse(localStorage.getItem(storeKey)||'[]');
  var idx = all.findIndex(function(i){ return String(i._id!=null?i._id:i.id)===id; });
  if(idx<0){ showToast('Накладная не найдена'); return; }
  var oldNum = all[idx].num;
  var data = isManual ? window._manInvEdit[id] : window._shInvEdit[id];
  if(!data){ showToast('Данные не загружены'); return; }
  data.num = (document.getElementById('adminInv_num_'+id)||{}).value || data.num;
  if(isManual) data.from = (document.getElementById('adminInv_from_'+id)||{}).value || data.from;
  data.totalAmt = (data.items||[]).reduce(function(s,it){ return s+(it.qty||1)*(it.price||0); },0);
  data.editedAt = new Date().toISOString();
  data.editedBy = (session&&(session.name||session.sellerName))||'admin';
  data.editReason = reason;
  var _savedGt = (window._manInvEdit&&window._manInvEdit[id]&&window._manInvEdit[id].goodsType) || data.goodsType || all[idx].goodsType || 'derevo';
  data.goodsType = _savedGt;
  all[idx] = data;
  localStorage.setItem(storeKey, JSON.stringify(all));
  try{ db.collection(storeKey).doc(id).set(data,{merge:true}); }catch(e){}
  if(!_currentShiftView){
    showToast('✅ Накладная сохранена, но смена для обновления журнала не выбрана — открой накладную через список смены, чтобы обновились остатки');
    if(isManual) delete window._manInvEdit[id]; else delete window._shInvEdit[id];
    closeMo('adminInvMo');
    return;
  }
  var jnl = _currentShiftView.journal||[];
  var jIdx = jnl.findIndex(function(e){
    if(e.type!=='receive') return false;
    if(e.invId) return e.invId===id;
    return e.sub && e.sub.indexOf(oldNum)>=0;
  });
  var newTotal = data.totalAmt!=null ? data.totalAmt : (data.items||[]).reduce(function(s,it){ return s+(it.qty||1)*(it.price||0); },0);
  if(jIdx>=0){
    var before = Object.assign({}, jnl[jIdx]);
    var _isDrSave = _savedGt==='dr';
    jnl[jIdx] = Object.assign({}, jnl[jIdx], {
      label:'Приёмка '+data.num+(_isDrSave?' (ДР)':''),
      sub:(data.items||[]).length+' изд.'+(data.from?' · от '+data.from:''),
      amount:newTotal,
      goodsEffect: _isDrSave?0:newTotal,
      goodsDrEffect: _isDrSave?newTotal:0,
      goodsType: _savedGt,
      invId:id,
      editedAt:new Date().toISOString()
    });
    try{ logEntryEdit(before, jnl[jIdx], (_currentShiftView&&(_currentShiftView.id||_currentShiftView._id))); }catch(e){}
  }
  _currentShiftView.journal = jnl;
  if(isManual) delete window._manInvEdit[id]; else delete window._shInvEdit[id];
  closeMo('adminInvMo');
  svPersist(); _renderShiftView();
  showToast('✅ Накладная исправлена');
}
function svDeleteJEntry(type, idx){
  if(!confirm('Удалить эту запись? Она будет перемещена в корзину на 7 дней.')) return;
  var jnl=_currentShiftView.journal||[];
  var ofType=jnl.filter(function(e){return e.type===type;});
  var target=ofType[idx]; if(!target) return;
  _currentShiftView.journal=jnl.filter(function(e){return e!==target;});
  addToTrash(target, {shopName:_currentShiftView.shopName, shiftId:_currentShiftView.id, deletedByOverride:(session&&session.sellerName)||'Администратор'});
  svPersist(); _renderShiftView(); showToast('🗑 Перемещено в корзину');
}
function svDeleteWoodRcv(idx){
  if(!confirm('Удалить этот приход?')) return;
  var arr=_currentShiftView.goodsReceives||[];
  arr.splice(idx,1);
  _currentShiftView.goodsReceives=arr;
  svPersist(); _renderShiftView(); showToast('🗑 Удалено');
}
function svDeleteDrRcv(idx){
  if(!confirm('Удалить этот приход?')) return;
  var arr=_currentShiftView.drGoodsReceives||[];
  arr.splice(idx,1);
  _currentShiftView.drGoodsReceives=arr;
  svPersist(); _renderShiftView(); showToast('🗑 Удалено');
}
function svDeleteWoodWo(idx){
  if(!confirm('Удалить это списание?')) return;
  var arr=_currentShiftView.goodsWriteoffs||[];
  arr.splice(idx,1);
  _currentShiftView.goodsWriteoffs=arr;
  svPersist(); _renderShiftView(); showToast('🗑 Удалено');
}
function svDeleteDrWo(idx){
  if(!confirm('Удалить это списание?')) return;
  var arr=_currentShiftView.drGoodsWriteoffs||[];
  arr.splice(idx,1);
  _currentShiftView.drGoodsWriteoffs=arr;
  svPersist(); _renderShiftView(); showToast('🗑 Удалено');
}
function svForceCloseShift(){
  if(!confirm('Принудительно закрыть эту смену? Она будет помечена как закрытая с текущими данными.')) return;
  var id=_currentShiftView.id;
  var shifts=getShifts();
  var idx=shifts.findIndex(function(s){return (s.id||s._id)===id;});
  if(idx<0) return;
  shifts[idx].status='closed';
  shifts[idx].closedAt=new Date().toISOString();
  shifts[idx].forceClosedBy=(session&&session.sellerName)||'Администратор';
  saveShifts(shifts);
  _shiftSetSafe(id, shifts[idx]);
  _currentShiftView = shifts[idx];
  _renderShiftView();
  showToast('🔐 Смена принудительно закрыта. Если она снова появится как открытая, найдите устройство продавца и закройте смену там, либо выйдите из её сессии.');
}
function svDeleteShift(){
  if(!confirm('Удалить смену целиком? Это действие нельзя отменить.')) return;
  var sh = _currentShiftView;
  var id = sh.id;
  addShiftTombstone(id);
  var shifts=getShifts();
  shifts=shifts.filter(function(s){return (s.id||s._id)!==id;});
  saveShifts(shifts);
  try{
    db.collection('iz_shifts').doc(id).delete().catch(function(err){
      showToast('⚠️ Удалено локально, но облако не подтвердило удаление: '+(err&&err.message||err));
    });
  }catch(e){
    showToast('⚠️ Удалено локально, но облако не подтвердило удаление');
  }
  if(sh.source==='psj'){
    var shopName = sh.shopName||'';
    var date = sh.date||'';
    var psjEntries = getPsjEntries();
    var toDeletePsj = psjEntries.filter(function(e){ return (shopName?e.shopName===shopName:!e.shopName) && e.date===date; });
    if(toDeletePsj.length){
      var toKeepPsj = psjEntries.filter(function(e){ return !((shopName?e.shopName===shopName:!e.shopName) && e.date===date); });
      savePsjEntries(toKeepPsj);
      toDeletePsj.forEach(function(e){ try{ db.collection('iz_psj').doc(e.id).delete(); }catch(err){} });
    }
  }
  closeMo('editShiftMo'); renderShiftHistory(); showToast('🗑 Смена удалена');
}
function svRecalcGoodsEvening(){
  var sh = _currentShiftView; if(!sh) return;
  var goods = sh.goodsMorning||0, goodsDr = sh.goodsDrMorning||0;
  (sh.journal||[]).forEach(function(e){
    goods += (e.goodsEffect||0);
    goodsDr += (e.goodsDrEffect||0);
  });
  (sh.goodsReceives||[]).forEach(function(r){ goods += (r.amt!=null?r.amt:(r.amount||0)); });
  (sh.drGoodsReceives||[]).forEach(function(r){ goodsDr += (r.amt!=null?r.amt:(r.amount||0)); });
  (sh.goodsWriteoffs||[]).forEach(function(w){ goods -= (w.amt!=null?w.amt:(w.amount||0)); });
  (sh.drGoodsWriteoffs||[]).forEach(function(w){ goodsDr -= (w.amt!=null?w.amt:(w.amount||0)); });
  sh.goodsEvening = goods;
  sh.drGoodsEvening = goodsDr;
}
function svPersist(skipGoodsRecalc){
  if(!skipGoodsRecalc) svRecalcGoodsEvening();
  var shifts=getShifts();
  var idx=shifts.findIndex(function(s){return (s.id||s._id)===_currentShiftView.id;}); if(idx<0) return;
  shifts[idx]=_currentShiftView;
  saveShifts(shifts);
  var shiftId = _currentShiftView.id;
  var toSave = _currentShiftView;
  try{
    db.collection('iz_shifts').doc(shiftId).get({source:'server'}).then(function(snap){
      var dataToSend = toSave;
      if(snap.exists){
        var remote = snap.data();
        var remoteJnl = remote.journal||[];
        var localJnl = toSave.journal||[];
        var localIds = {}; localJnl.forEach(function(e){ if(e.id) localIds[e.id]=true; });
        var deletedIds = {}; getTombstones().forEach(function(id){ deletedIds[id]=true; });
        var missingFromServer = remoteJnl.filter(function(e){ return e.id && !localIds[e.id] && !deletedIds[e.id]; });
        if(missingFromServer.length){
          var mergedJnl = localJnl.concat(missingFromServer);
          mergedJnl.sort(function(a,b){ return (a.ts||'').localeCompare(b.ts||''); });
          dataToSend = Object.assign({}, toSave, {journal: mergedJnl});
          var shifts2 = getShifts();
          var idx2 = shifts2.findIndex(function(s){ return (s.id||s._id)===shiftId; });
          if(idx2>=0){ shifts2[idx2] = dataToSend; saveShifts(shifts2); }
          if(_currentShiftView && _currentShiftView.id===shiftId) _currentShiftView = dataToSend;
          showToast('ℹ️ В облаке нашлись записи, которых не было локально — объединила, ничего не потеряно');
        }
      }
      db.collection('iz_shifts').doc(shiftId).set(dataToSend).catch(function(err){
        showToast('⚠️ Сохранено только локально! Ошибка облака: '+(err&&err.message||err));
        console.log('[svPersist] ошибка сохранения в Firestore:', err);
      });
    }).catch(function(err){
      db.collection('iz_shifts').doc(shiftId).set(toSave).catch(function(err2){
        showToast('⚠️ Сохранено только локально! Ошибка облака: '+(err2&&err2.message||err2));
        console.log('[svPersist] ошибка сохранения в Firestore:', err2);
      });
    });
  }catch(e){
    showToast('⚠️ Сохранено только локально! Ошибка: '+(e&&e.message||e));
  }
  renderShiftHistory();
}
function saveEditShift(){}
function _svVal(id){ var el=document.getElementById(id); return el ? el.value : ''; }
function _svNum(id){ return parseFloat(_svVal(id))||0; }
function svAddRcv(type){
  var isWood = type==='wood';
  var id = isWood?'rcvWood':'rcvDr';
  var row = _svItemRow(id);
  if(!row.name){showToast('Укажите наименование');return;}
  if(row.art) autoSaveToItemBase(row.name, row.art, row.price, isWood?'derevo':'dr');
  if(row.species) saveSpecies(row.species);
  var from = isWood ? _svVal('svAdd_rcvWood_from') : '';
  var item = {name:row.name, article:row.art, species:row.species, price:row.price, qty:row.qty};
  _addReceiveToShift(_currentShiftView, [item], isWood?'derevo':'dr', {from: from});
  svPersist(); _svOpenAccs['acc_rcv']=true; _renderShiftView();
  showToast('✅ Приход добавлен');
}
function svAddWo(type){
  var isWood = type==='wood';
  var id = isWood?'woWood':'woDr';
  var row = _svItemRow(id);
  if(!row.name){showToast('Укажите наименование');return;}
  if(row.species) saveSpecies(row.species);
  var reason = _svVal('svAdd_'+id+'_reason');
  if(isWood){
    var arr = _currentShiftView.goodsWriteoffs||[];
    arr.push({name:row.name, article:row.art, species:row.species, price:row.price, qty:row.qty, amt:row.amt, reason:reason});
    _currentShiftView.goodsWriteoffs = arr;
  } else {
    var arr2 = _currentShiftView.drGoodsWriteoffs||[];
    arr2.push({name:row.name, article:row.art, species:row.species, price:row.price, qty:row.qty, amt:row.amt, reason:reason});
    _currentShiftView.drGoodsWriteoffs = arr2;
  }
  svPersist(); _svOpenAccs['acc_wo']=true; _renderShiftView();
  showToast('✅ Списание добавлено');
}
function svAddExp(type){
  var isWood = type==='wood';
  var isStaff = type==='staff';
  var fieldPrefix = isStaff?'svAdd_expStaff':(isWood?'svAdd_expWood':'svAdd_expDr');
  var expType = _svVal(fieldPrefix+'Type');
  var amt     = _svNum(fieldPrefix+'Amt');
  var comment = _svVal(fieldPrefix+'Comment');
  if(!amt){showToast('Укажите сумму');return;}
  var jnl = _currentShiftView.journal||[];
  var gType = isStaff?'staff':(isWood?'wood':'dr');
  var _expEntryAdm = {id:uid(),type:'expense',expType:expType,amount:amt,comment:comment,goodsType:gType,ts:_workingNowISO(),
    cashEffect: (isWood&&!isStaff)?-amt:0, cashDrEffect: (!isWood&&!isStaff)?-amt:0, cardEffect:0, staffEffect: isStaff?-amt:0, goodsEffect:0};
  jnl.push(_expEntryAdm);
  _recordJournalEntryIndependently(_expEntryAdm, _currentShiftView.shopName, 'expense');
  _currentShiftView.journal = jnl;
  svPersist(); _svOpenAccs['acc_exp']=true; _renderShiftView();
  showToast('✅ Расход добавлен');
}
function svAddStaff(type){
  var isWood = type==='wood';
  var id = isWood?'staffWood':'staffDr';
  var row = _svItemRow(id);
  var who = _svVal('svAdd_'+id+'_who').trim();
  if(!who){showToast('Укажите сотрудника');return;}
  if(!row.name){showToast('Укажите товар');return;}
  if(row.art) autoSaveToItemBase(row.name, row.art, row.price, isWood?'derevo':'dr');
  if(row.species) saveSpecies(row.species);
  var retail = _svNum('svAdd_'+id+'_retail');
  var opt = row.amt || (row.price*row.qty);
  var jnl = _currentShiftView.journal||[];
  jnl.push({id:uid(),type:'staff',who:who,item:row.name,article:row.art,species:row.species,price:row.price,qty:row.qty,opt:opt,retail:retail,amount:opt,goodsType:isWood?'wood':'dr',ts:_workingNowISO(),
    cashEffect:0, cardEffect:0, staffEffect:opt, goodsEffect:isWood?-retail:0, goodsDrEffect:isWood?0:-retail});
  _currentShiftView.journal = jnl;
  svPersist(); _svOpenAccs['acc_staff']=true; _renderShiftView();
  showToast('✅ Покупка добавлена');
}
function savePastShift(){
  var errEl=document.getElementById('psSaveError'); if(errEl)errEl.style.display='none';
  var shop=gv('psShop'),date=gv('psDate');
  if(!shop||!date){showToast('Заполните магазин и дату');return;}
  if(gv('psCashEve')!==''){
    var m=parseFloat(gv('psCashMorn'))||0, sc=parseFloat(gv('psCashRev'))||0;
    var z=parseFloat(gv('psZP'))||0, ink=parseFloat(gv('psInkass'))||0, oth=parseFloat(gv('psOtherExp'))||0;
    var calc=m+sc-z-ink-oth, ent=parseFloat(gv('psCashEve'))||0;
    if(Math.round(Math.abs(ent-calc))>0){
      if(errEl){errEl.style.display='block';errEl.textContent='⛔ Нал вечер Дерево не сходится (расчётный: '+fmt2(calc)+'). Исправьте.';}
      return;
    }
  }
  if(gv('psDrCashEve')!==''){
    var dm=parseFloat(gv('psDrCashMorn'))||0, dsc=parseFloat(gv('psDrCashRev'))||0, dink=parseFloat(gv('psDrInkass'))||0;
    var dcalc=dm+dsc-dink, dent=parseFloat(gv('psDrCashEve'))||0;
    if(Math.round(Math.abs(dent-dcalc))>0){
      if(errEl){errEl.style.display='block';errEl.textContent='⛔ Нал вечер ДР Товар не сходится (расчётный: '+fmt2(dcalc)+'). Исправьте.';}
      return;
    }
  }
  var shop=gv('psShop'),date=gv('psDate');
  if(!shop||!date){showToast('Заполните магазин и дату');return;}
  var errEl=document.getElementById('psSaveError'); if(errEl)errEl.style.display='none';
  var cashMorn=parseFloat(gv('psCashMorn'))||0, salesCash=parseFloat(gv('psCashRev'))||0;
  var zp=parseFloat(gv('psZP'))||0, inkass=parseFloat(gv('psInkass'))||0, other=parseFloat(gv('psOtherExp'))||0;
  var calcEve=cashMorn+salesCash-zp-inkass-other;
  var entEve=parseFloat(gv('psCashEve'))||0;
  if(gv('psCashEve')!==''&&Math.round(Math.abs(entEve-calcEve))>0){
    if(errEl){errEl.style.display='block';errEl.textContent='⛔ Нал вечер (Дерево) не сходится с расчётным ('+Math.round(calcEve).toLocaleString('ru-RU')+'₽). Пересчитайте.';}
    return;
  }
  var drMorn=parseFloat(gv('psDrCashMorn'))||0, drSales=parseFloat(gv('psDrCashRev'))||0, drInkass=parseFloat(gv('psDrInkass'))||0;
  var drCalcEve=drMorn+drSales-drInkass, drEntEve=parseFloat(gv('psDrCashEve'))||0;
  if(gv('psDrCashEve')!==''&&Math.round(Math.abs(drEntEve-drCalcEve))>0){
    if(errEl){errEl.style.display='block';errEl.textContent='⛔ Нал вечер (ДР Товар) не сходится с расчётным ('+Math.round(drCalcEve).toLocaleString('ru-RU')+'₽). Пересчитайте.';}
    return;
  }
  const cashRev=parseFloat(gv('psCashRev'))||0, cardRev=parseFloat(gv('psCardRev'))||0;
  var n=function(id){return parseFloat(gv(id))||0;};
  psSaveSupplier();
  var woodEve=n('psWoodMorn')+psReceives.reduce((s,r)=>s+(r.amt||0),0)-(n('psCashRev')+n('psTerminal')+n('psTransfer')+n('psQR'))-psWriteoffs.reduce((s,w)=>s+(w.amt||0),0);
  var drEve=n('psDrMorn')+psDrReceives.reduce((s,r)=>s+(r.amt||0),0)-(n('psDrCashRev')+n('psDrTerminal')+n('psDrTransfer')+n('psDrQR'))-psDrWriteoffs.reduce((s,w)=>s+(w.amt||0),0);
  var staffTotalOpt=psStaffs.reduce((s,x)=>s+(x.opt||0),0);
  var woodEve=n('psWoodMorn')+n('psWoodIn')-(n('psCashRev')+n('psTerminal')+n('psTransfer')+n('psQR'))-n('psWoodOff');
  var drEve=n('psDrMorn')+n('psDrIn')-(n('psDrCashRev')+n('psDrTerminal')+n('psDrTransfer')+n('psDrQR'))-n('psDrOff');
  var _psExpJournal = [];
  function _psPushExp(amt, expType, goodsType, cashField){
    if(!amt) return;
    var e = {id:uid(), type:'expense', ts:date+'T20:00:00.000Z', icon:'💸', expType:expType, goodsType:goodsType, amount:amt,
      cashEffect:0, cashDrEffect:0, cardEffect:0, staffEffect:0, goodsEffect:0, backfilled:true};
    e[cashField] = -amt;
    _psExpJournal.push(e);
  }
  _psPushExp(n('psZP'), 'zp', 'derevo', 'cashEffect');
  _psPushExp(n('psInkass'), 'inkass', 'derevo', 'cashEffect');
  _psPushExp(n('psOtherExp'), 'other', 'derevo', 'cashEffect');
  _psPushExp(n('psDrInkass'), 'inkass', 'dr', 'cashDrEffect');
  _psPushExp(n('psDrSupplierAmt'), 'supplier', 'dr', 'cashDrEffect');
  const shift={id:uid(),source:'shop',isArchive:true,shopName:shop,sellerName:gv('psSeller')||'—',date,
    openedAt:date+'T09:00:00.000Z',closedAt:date+'T21:00:00.000Z',
    cashMorning:n('psCashMorn'),cashEvening:n('psCashEve'),
    zp:n('psZP'),inkass:n('psInkass'),otherExp:n('psOtherExp'),
    discount:n('psDiscount'),cashRevenue:n('psCashRev'),
    terminal:n('psTerminal'),transfer:n('psTransfer'),qr:n('psQR'),
    cardRevenue:n('psTerminal')+n('psTransfer')+n('psQR'),
    totalRevenue:n('psCashRev')+n('psTerminal')+n('psTransfer')+n('psQR')+n('psDiscount'),
    cashRevenueTotal:n('psCashRev'),
    goodsMorning:n('psWoodMorn'),goodsEvening:woodEve,
    goodsReceives:[...psReceives],goodsWriteoffs:[...psWriteoffs],
    drCashMorning:n('psDrCashMorn'),drCashEvening:n('psDrCashEve'),drInkass:n('psDrInkass'),
    drSupplierAmt:n('psDrSupplierAmt'),drSupplierName:gv('psDrSupplierName'),
    drDiscount:n('psDrDiscount'),drCashRevenue:n('psDrCashRev'),
    drTerminal:n('psDrTerminal'),drTransfer:n('psDrTransfer'),drQR:n('psDrQR'),
    drCardRevenue:n('psDrTerminal')+n('psDrTransfer')+n('psDrQR'),
    drTotalRevenue:n('psDrCashRev')+n('psDrTerminal')+n('psDrTransfer')+n('psDrQR')+n('psDrDiscount'),
    drGoodsMorning:n('psDrMorn'),drGoodsEvening:drEve,
    drGoodsReceives:[...psDrReceives],drGoodsWriteoffs:[...psDrWriteoffs],
    staffPurchases:[...psStaffs],staffCashTotal:staffTotalOpt,
    comment:gv('psComment'),backfilled:true,backfilledBy:session.name,backfilledAt:new Date().toISOString(),journal:_psExpJournal};
  const shifts=getShifts();
  shifts.unshift(shift); saveShifts(shifts);
  try{ db.collection('iz_shifts').add(shift); }catch(e){}
  ['psCashMorn','psCashEve','psZP','psInkass','psOtherExp','psDiscount','psCashRev','psTerminal','psTransfer','psQR','psWoodMorn','psDrCashMorn','psDrCashEve','psDrInkass','psDrDiscount','psDrCashRev','psDrTerminal','psDrTransfer','psDrQR','psDrMorn','psComment'].forEach(id=>{var el=document.getElementById(id);if(el)el.value='';});
  psWriteoffs=[]; psDrWriteoffs=[]; psReceives=[]; psDrReceives=[]; psStaffs=[];
  renderPsLists();
  ['psCashCalc','psWoodEveBlock','psDrCashCalc','psDrEveBlock','psTotalRevBlock','psDrTotalRevBlock','psStaffTotal'].forEach(id=>{var el=document.getElementById(id);if(el)el.style.display='none';});
  ['psCashCheck','psDrCashCheck','psSaveError','psMornCheck','psDrMornCheck','psPrevCashInfo','psPrevGoodsInfo','psWriteoffList','psReceiveList','psDrWriteoffList','psDrReceiveList','psStaffList'].forEach(id=>{var el=document.getElementById(id);if(el)el.innerHTML='';});
  showToast('✅ Смена внесена задним числом');
  _histShowOpen = false;
  showPg('history',document.querySelector('.tab')); renderShiftHistory();
}
var psWriteoffs=[], psDrWriteoffs=[], psReceives=[], psDrReceives=[], psStaffs=[];
function fmt2(n){ return Math.round(n||0).toLocaleString('ru-RU')+'₽'; }
function psSyncFromJournal(){
  var shop=gv('psShop'), date=gv('psDate');
  if(!shop||!date) return;
  var entries=getPsjEntries().filter(function(e){ return e.shopName===shop && e.date===date; });
  psWriteoffs = entries.filter(function(e){ return e.type==='writeoff' && (!e.goodsType||e.goodsType==='derevo'); })
    .map(function(e){ return {name:e.label||'Списание', qty:'', reason:e.sub||'', amt:e.amount||0}; });
  psDrWriteoffs = entries.filter(function(e){ return e.type==='writeoff' && e.goodsType==='dr'; })
    .map(function(e){ return {name:e.label||'Списание', qty:'', reason:e.sub||'', amt:e.amount||0}; });
  psReceives = entries.filter(function(e){ return e.type==='receive' && (!e.goodsType||e.goodsType==='derevo'); })
    .map(function(e){ return {name:e.label||'Приход', num:'', qty:'', price:'', from:e.sub||'', amt:e.amount||0}; });
  psDrReceives = entries.filter(function(e){ return e.type==='receive' && e.goodsType==='dr'; })
    .map(function(e){ return {name:e.label||'Приход', num:'', qty:'', price:'', from:e.sub||'', amt:e.amount||0}; });
  renderPsJournalLists();
  psCalcGoods();
}
function renderPsJournalLists(){
  var woList=document.getElementById('psWriteoffsList');
  var woTotal=document.getElementById('psWriteoffsTotal');
  if(woList){
    if(!psWriteoffs.length){ woList.innerHTML='Нет списаний за эту смену'; }
    else woList.innerHTML=psWriteoffs.map(function(w){
      return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid #3e2e2e"><span>'+(w.reason||w.name)+'</span><span style="color:#f06060;font-weight:700">'+fmt2(w.amt)+'</span></div>';
    }).join('');
  }
  if(woTotal) woTotal.textContent=fmt2(psWriteoffs.reduce(function(s,w){return s+(w.amt||0);},0));
  var rcList=document.getElementById('psReceivesList');
  var rcTotal=document.getElementById('psReceivesTotal');
  if(rcList){
    if(!psReceives.length){ rcList.innerHTML='Нет приходов за эту смену'; }
    else rcList.innerHTML=psReceives.map(function(r){
      return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid #2e3e3e"><span>'+(r.from||r.name)+'</span><span style="color:#60c8f0;font-weight:700">'+fmt2(r.amt)+'</span></div>';
    }).join('');
  }
  if(rcTotal) rcTotal.textContent=fmt2(psReceives.reduce(function(s,r){return s+(r.amt||0);},0));
}
function psLoadPrev(){
  var shop=gv('psShop'), date=gv('psDate');
  if(!shop||!date) return;
  var shifts=JSON.parse(localStorage.getItem('iz_shifts')||'[]');
  var prev=shifts.filter(s=>s.shopName===shop&&s.date<date).sort((a,b)=>b.date.localeCompare(a.date))[0];
  psSyncFromJournal();
  var mornInfo=document.getElementById('psPrevCashInfo');
  if(prev&&prev.cashEvening!=null){
    mornInfo.style.display='block';
    mornInfo.innerHTML='📊 Нал вечер прошлой смены: <strong>'+fmt2(prev.cashEvening)+'</strong> ('+prev.date+' · '+prev.sellerName+')';
  } else mornInfo.style.display='none';
  var woodEl=document.getElementById('psWoodMorn');
  var goodsInfo=document.getElementById('psPrevGoodsInfo');
  if(prev&&prev.goodsEvening!=null&&woodEl&&!woodEl.value){
    woodEl.value=prev.goodsEvening;
    goodsInfo.style.display='block';
    goodsInfo.innerHTML='📦 Подтянуто с прошлой смены: '+fmt2(prev.goodsEvening);
    psCalcGoods();
  } else if(goodsInfo) goodsInfo.style.display='none';
  psPopulateSuppliers();
  var drEl=document.getElementById('psDrMorn');
  if(prev&&prev.drGoodsEvening!=null&&drEl&&!drEl.value){
    drEl.value=prev.drGoodsEvening;
    psCalcDrGoods();
  }
}
function psCheckMorn(){
  var shop=gv('psShop'), date=gv('psDate');
  var shifts=JSON.parse(localStorage.getItem('iz_shifts')||'[]');
  var prev=shifts.filter(s=>s.shopName===shop&&s.date<date).sort((a,b)=>b.date.localeCompare(a.date))[0];
  var morn=parseFloat(gv('psCashMorn'))||0;
  var check=document.getElementById('psMornCheck');
  if(prev&&prev.cashEvening!=null&&gv('psCashMorn')!==''){
    var diff=Math.round(morn-prev.cashEvening);
    if(Math.abs(diff)>0){
      check.innerHTML='<div class="al-err">⚠️ Нал утро отличается от вечера прошлой смены на '+fmt2(diff)+'<br><span style="font-size:10px">Уведомление отправлено администратору</span></div>';
      saveAdminAlert({type:'morning_diff',shopName:shop,sellerName:gv('psSeller'),
        date:date,cashMorning:morn,prevCashEve:prev.cashEvening,morningDiff:diff});
    } else check.innerHTML='<div class="al-ok">✅ Нал утро совпадает с предыдущей сменой</div>';
  } else if(check) check.innerHTML='';
}
function psCalc(){
  psCheckMorn();
  var morn=parseFloat(gv('psCashMorn'))||0;
  var salesCash=parseFloat(gv('psCashRev'))||0;
  var terminal=parseFloat(gv('psTerminal'))||0;
  var transfer=parseFloat(gv('psTransfer'))||0;
  var qr=parseFloat(gv('psQR'))||0;
  var disc=parseFloat(gv('psDiscount'))||0;
  var zp=parseFloat(gv('psZP'))||0;
  var inkass=parseFloat(gv('psInkass'))||0;
  var other=parseFloat(gv('psOtherExp'))||0;
  var totalRev=salesCash+terminal+transfer+qr+disc; // валовая = нал+безнал+скидка
  var trVal=document.getElementById('psTotalRevVal');
  if(trVal) trVal.textContent=fmt2(totalRev);
  var travel=parseFloat(gv('psTravel'))||0;
  var calcEve=morn+salesCash-zp-inkass-other-travel;
  var block=document.getElementById('psCashCalc'), valEl=document.getElementById('psCashCalcVal');
  if(morn||salesCash||zp||inkass||other){block.style.display='block';valEl.textContent=fmt2(calcEve);}
  else block.style.display='none';
  var check=document.getElementById('psCashCheck');
  if(gv('psCashEve')!==''){
    var ent=parseFloat(gv('psCashEve'))||0, diff=Math.round(ent-calcEve);
    check.innerHTML=Math.abs(diff)===0
      ?'<div class="al-ok">✅ Нал вечер сходится</div>'
      :'<div class="al-err">⛔ Расхождение: '+fmt2(diff)+'<br><span style="font-size:10px">Расчётный: '+fmt2(calcEve)+' · Введено: '+fmt2(ent)+'</span></div>';
  } else check.innerHTML='';
  psCalcGoods();
}
function psCalcGoods(){
  var morn=parseFloat(gv('psWoodMorn'))||0;
  var salesCash=parseFloat(gv('psCashRev'))||0;
  var salesCard=(parseFloat(gv('psTerminal'))||0)+(parseFloat(gv('psTransfer'))||0)+(parseFloat(gv('psQR'))||0);
  var income=psReceives.reduce((s,r)=>s+(r.amt||0),0);
  var writeoff=psWriteoffs.reduce((s,w)=>s+(w.amt||0),0);
  var eve=morn+income-salesCash-salesCard-writeoff;
  var block=document.getElementById('psWoodEveBlock'), val=document.getElementById('psWoodEveVal');
  var val2=document.getElementById('psWoodEveVal');
  if(val2) val2.textContent=fmt2(eve);
  var block=document.getElementById('psWoodEveBlock'); if(block) block.style.display='none';
}
function psCalcDrGoods(){
  var morn=parseFloat(gv('psDrMorn'))||0;
  var salesCash=parseFloat(gv('psDrCashRev'))||0;
  var salesCard=(parseFloat(gv('psDrTerminal'))||0)+(parseFloat(gv('psDrTransfer'))||0)+(parseFloat(gv('psDrQR'))||0);
  var income=psDrReceives.reduce((s,r)=>s+(r.amt||0),0);
  var writeoff=psDrWriteoffs.reduce((s,w)=>s+(w.amt||0),0);
  var eve=morn+income-salesCash-salesCard-writeoff;
  var block=document.getElementById('psDrEveBlock'), val=document.getElementById('psDrEveVal');
  var val2=document.getElementById('psDrEveVal');
  if(val2) val2.textContent=fmt2(eve);
  var block=document.getElementById('psDrEveBlock'); if(block) block.style.display='none';
}
function psAddStaffFromWo(idx){
  var allWo=[...psWriteoffs.map(w=>({...w,src:'дерево'})),...psDrWriteoffs.map(w=>({...w,src:'дртовар'}))];
  var w=allWo[idx]; if(!w) return;
  var who=prompt('Кто покупает? (ФИО сотрудника):');
  if(!who) return;
  var opt=parseFloat(prompt('Цена опт (₽):')||'0')||0;
  psStaffs.push({who,item:w.name+(w.num?' (арт.'+w.num+')':''),retail:w.amt,opt,comment:'из списания · '+w.src});
  renderPsLists();
  showToast('✅ Добавлено из списания');
}
function renderPsLists(){
  var wo=document.getElementById('psWriteoffList');
  if(wo) wo.innerHTML=psWriteoffs.map((w,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;background:#2e1a1a;border-radius:8px;padding:8px;margin-bottom:4px;font-size:12px"><span>${w.name} · ${w.qty} · ${w.reason}</span><span style="color:#f06060;font-weight:700">${fmt2(w.amt)} <button onclick="psWriteoffs.splice(${i},1);renderPsLists();psCalcGoods()" style="background:none;border:none;color:#8888aa;cursor:pointer;font-size:14px">✕</button></span></div>`).join('');
  var rc=document.getElementById('psReceiveList');
  if(rc) rc.innerHTML=psReceives.map((r,i)=>`<div style="background:#1a2e1e;border-radius:8px;padding:8px;margin-bottom:4px;font-size:12px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><div style="font-weight:700">${r.name}${r.num?' ('+r.num+')':''}</div>
      <div style="color:#8888aa">${r.qty?r.qty+' шт.':''} ${r.price?'· '+fmt2(r.price)+'/ед.':''} ${r.from?'· от '+r.from:''}</div></div>
      <span style="color:#60f090;font-weight:700;white-space:nowrap">${fmt2(r.amt)} <button onclick="psReceives.splice(${i},1);renderPsLists();psCalcGoods()" style="background:none;border:none;color:#8888aa;cursor:pointer;font-size:14px">✕</button></span>
    </div></div>`).join('');
  var dw=document.getElementById('psDrWriteoffList');
  if(dw) dw.innerHTML=psDrWriteoffs.map((w,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;background:#2e1a1a;border-radius:8px;padding:8px;margin-bottom:4px;font-size:12px"><span>${w.name} · ${w.qty} · ${w.reason}</span><span style="color:#f06060;font-weight:700">${fmt2(w.amt)} <button onclick="psDrWriteoffs.splice(${i},1);renderPsLists();psCalcDrGoods()" style="background:none;border:none;color:#8888aa;cursor:pointer;font-size:14px">✕</button></span></div>`).join('');
  var dr=document.getElementById('psDrReceiveList');
  if(dr) dr.innerHTML=psDrReceives.map((r,i)=>`<div style="background:#1a2e1e;border-radius:8px;padding:8px;margin-bottom:4px;font-size:12px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><div style="font-weight:700">${r.name}${r.num?' ('+r.num+')':''}</div>
      <div style="color:#8888aa">${r.qty?r.qty+' шт.':''} ${r.price?'· '+fmt2(r.price)+'/ед.':''} ${r.from?'· от '+r.from:''}</div></div>
      <span style="color:#60f090;font-weight:700;white-space:nowrap">${fmt2(r.amt)} <button onclick="psDrReceives.splice(${i},1);renderPsLists();psCalcDrGoods()" style="background:none;border:none;color:#8888aa;cursor:pointer;font-size:14px">✕</button></span>
    </div></div>`).join('');
  var woOpts=document.getElementById('psStaffWoOptions');
  var allWo=[...psWriteoffs.map(w=>({...w,src:'дерево'})),...psDrWriteoffs.map(w=>({...w,src:'дртовар'}))];
  if(woOpts){
    if(allWo.length){
      woOpts.innerHTML=allWo.map((w,i)=>`
        <div onclick="psAddStaffFromWo(${i})" style="background:#1e1a2e;border:1px solid #a060f0;border-radius:8px;padding:8px;margin-bottom:4px;cursor:pointer;font-size:12px">
          <div style="font-weight:700">${w.name} · ${w.qty} шт.</div>
          <div style="color:#8888aa">${fmt2(w.amt)} · ${w.src==='дерево'?'🌳 Дерево':'🛍 ДР Товар'}</div>
          <div style="color:#a060f0;font-size:10px">Нажмите чтобы добавить как покупку сотрудника</div>
        </div>`).join('');
    } else {
      woOpts.innerHTML='<div style="font-size:11px;color:#555568;font-style:italic">Добавьте списания выше — они появятся здесь</div>';
    }
  }
  var sl=document.getElementById('psStaffList');
  var st=document.getElementById('psStaffTotal');
  var sv=document.getElementById('psStaffTotalVal');
  var totalOpt=psStaffs.reduce((s,x)=>s+(x.opt||0),0);
  if(sl) sl.innerHTML=psStaffs.map((s,i)=>`<div style="background:#1e1a2e;border-radius:8px;padding:8px;margin-bottom:4px;font-size:12px"><div style="display:flex;justify-content:space-between"><span style="font-weight:700">${s.who}</span><button onclick="psStaffs.splice(${i},1);renderPsLists()" style="background:none;border:none;color:#8888aa;cursor:pointer;font-size:14px">✕</button></div><div>${s.item}</div><div style="color:#8888aa">Розница: ${fmt2(s.retail)} · Опт: ${fmt2(s.opt)}</div>${s.comment?`<div style="color:#8888aa">${s.comment}</div>`:''}</div>`).join('');
  if(st){st.style.display=psStaffs.length?'block':'none';}
  if(sv) sv.textContent=fmt2(totalOpt);
}
var psCurrentInvoice = null;
var psInvoiceCheckState = [];
var psDrCurrentInvoice = null;
var psDrInvoiceCheckState = [];
function getSupplierslist(){ return JSON.parse(localStorage.getItem('iz_suppliers')||'[]'); }
function saveSupplierslist(d){ localStorage.setItem('iz_suppliers',JSON.stringify(d)); }
function psPopulateSuppliers(){
  var dl=document.getElementById('suppliersList'); if(!dl) return;
  var suppliers=getSupplierslist();
  dl.innerHTML=suppliers.map(function(s){ return '<option value="'+s+'">'; }).join('');
}
function psSaveSupplier(){
  var name=((document.getElementById('psDrSupplierName')||{}).value||'').trim();
  if(!name) return;
  var suppliers=getSupplierslist();
  if(!suppliers.includes(name)){ suppliers.push(name); saveSupplierslist(suppliers); psPopulateSuppliers(); }
}
var accState = {};
var subState = {};
function toggleAcc(id){
  var body = document.getElementById('acc_'+id+'_body');
  var arrow = document.getElementById('acc_'+id+'_arrow');
  if(!body) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if(arrow) arrow.textContent = open ? '▶' : '▼';
}
function toggleSub(id){
  var body = document.getElementById(id+'_body');
  var arrow = document.getElementById(id+'_arrow');
  if(!body) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if(arrow) arrow.textContent = open ? '▶' : '▼';
}
function populatePastShiftSellers(){
  const el=document.getElementById('psSeller'); if(!el)return;
  if(session && session.sellerRestoreMode){
    el.innerHTML = '<option>'+session.restrictedSellerName+'</option>';
    el.value = session.restrictedSellerName;
    el.disabled = true;
    return;
  }
  el.disabled = false;
  const sellers=getSellers();
  el.innerHTML=sellers.map(s=>`<option>${s.name}</option>`).join('');
  if(_restoreShift && _restoreShift.sellerName) el.value = _restoreShift.sellerName;
}
