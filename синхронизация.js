// Простое key-value хранилище поверх IndexedDB — для данных, которые не помещаются
// в localStorage (там жёсткий лимит браузера на пару МБ на весь сайт, независимо
// от диска устройства). IndexedDB хранится на диске и переживает перезапуск вкладки.
var _idbPromise = null;
function _idbOpen(){
  if(_idbPromise) return _idbPromise;
  _idbPromise = new Promise(function(resolve, reject){
    if(typeof indexedDB==='undefined'){ reject(new Error('no indexedDB')); return; }
    var req = indexedDB.open('izhitsa_cache', 1);
    req.onupgradeneeded = function(){ req.result.createObjectStore('kv'); };
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error); };
  });
  return _idbPromise;
}
function idbGet(key){
  return _idbOpen().then(function(db){
    return new Promise(function(resolve){
      try{
        var tx = db.transaction('kv','readonly');
        var req = tx.objectStore('kv').get(key);
        req.onsuccess = function(){ resolve(req.result); };
        req.onerror = function(){ resolve(undefined); };
      }catch(e){ resolve(undefined); }
    });
  }).catch(function(){ return undefined; });
}
function idbSet(key, value){
  return _idbOpen().then(function(db){
    return new Promise(function(resolve){
      try{
        var tx = db.transaction('kv','readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = function(){ resolve(true); };
        tx.onerror = function(){ resolve(false); };
      }catch(e){ resolve(false); }
    });
  }).catch(function(){ return false; });
}
var _swReg = null;
var _newSW = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('./izhitsa-sw.js', {scope: './'})
      .then(function(reg) {
        console.log('[PWA] SW зарегистрирован');
        _swReg = reg;
        reg.update(); // проверить обновление сразу при открытии, не дожидаясь таймера
        setInterval(function() { reg.update(); }, 2 * 60 * 1000);
        document.addEventListener('visibilitychange', function(){
          if(document.visibilityState==='visible') reg.update();
        });
        reg.addEventListener('updatefound', function() {
          var newWorker = reg.installing;
          newWorker.addEventListener('statechange', function() {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              var banner = document.getElementById('updateBanner');
              if(banner) { _newSW = newWorker; banner.style.display = 'flex'; }
            }
          });
        });
      })
      .catch(function(e) { console.log('[PWA] SW ошибка:', e); });
  });
}
function checkForNewVersion(){
  try{
    fetch('./синхронизация.js', {cache:'no-store'}).then(function(r){ return r.text(); }).then(function(html){
      var m = html.match(/APP_BUILD_VERSION\s*=\s*'([^']+)'/);
      if(m && m[1] && typeof APP_BUILD_VERSION!=='undefined' && m[1]!==APP_BUILD_VERSION){
        var banner = document.getElementById('updateBanner');
        if(banner && banner.style.display!=='flex') banner.style.display = 'flex';
      }
    }).catch(function(){});
  }catch(e){}
}
window.addEventListener('load', function(){
  setTimeout(checkForNewVersion, 2000);
  setInterval(checkForNewVersion, 2 * 60 * 1000);
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState==='visible') checkForNewVersion();
  });
});
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState!=='visible') return;
  if(typeof session==='undefined' || !session || session.role!=='admin') return;
  try{ if(typeof startAdminShiftListener==='function') startAdminShiftListener(); }catch(e){}
  try{ if(typeof startAdminAlertsListener==='function') startAdminAlertsListener(); }catch(e){}
  try{ if(typeof startAdminAuditListener==='function') startAdminAuditListener(); }catch(e){}
  try{ if(typeof renderTodayShift==='function') renderTodayShift(); }catch(e){}
});
function applyUpdate() {
  var banner = document.getElementById('updateBanner');
  if(banner) banner.innerHTML = '<div style="font-size:13px;color:#f0f0f8;padding:12px">⏳ Загружаю обновление...</div>';
  if(_newSW) { _newSW.postMessage({type:'SKIP_WAITING'}); }
  setTimeout(function(){
    if('caches' in window){
      caches.keys().then(function(names){ names.forEach(function(n){ caches.delete(n); }); })
        .finally(function(){ window.location.href = window.location.pathname + '?v=' + Date.now(); });
    } else {
      window.location.href = window.location.pathname + '?v=' + Date.now();
    }
  }, 1500);
}
function hardRefreshApp() {
  if ('caches' in window) {
    caches.keys().then(function(names){
      names.forEach(function(n){ caches.delete(n); });
    }).finally(function(){
      window.location.href = window.location.pathname + '?v=' + Date.now();
    });
  } else {
    window.location.href = window.location.pathname + '?v=' + Date.now();
  }
}
function checkForAppUpdate() {
  if(_swReg && _swReg.update) { try{ _swReg.update(); }catch(e){} }
}
function forceUpdateNow() {
  showToast('⏳ Обновляю приложение...');
  var reload = function(){ window.location.href = window.location.pathname + '?v=' + Date.now(); };
  var clearCachesThenReload = function(){
    if('caches' in window){
      caches.keys().then(function(names){
        Promise.all(names.map(function(n){ return caches.delete(n); })).finally(reload);
      }).catch(reload);
    } else { reload(); }
  };
  if('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistrations().then(function(regs){
      Promise.all(regs.map(function(r){ return r.unregister(); })).finally(clearCachesThenReload);
    }).catch(clearCachesThenReload);
  } else {
    clearCachesThenReload();
  }
}
function _renderConnStatus(){
  var el = document.getElementById('connStatusBanner');
  if(!el) return;
  if(!navigator.onLine){
    el.style.display='flex';
    el.style.background='#2e1a14';
    el.style.borderColor='#f0a060';
    el.innerHTML='<span style="color:#f0a060;font-size:12px">📡 Нет интернета — работаю с локальными данными</span>';
  } else if(typeof firebase==='undefined' || (typeof _offlineNoFirebase!=='undefined' && _offlineNoFirebase)){
    el.style.display='flex';
    el.style.background='#2e1a14';
    el.style.borderColor='#f0a060';
    el.innerHTML='<span style="color:#f0a060;font-size:12px">⏳ Подключаюсь к облаку...</span>';
  } else {
    el.style.display='none';
  }
}
window.addEventListener('online', function(){
  _renderConnStatus();
  if(typeof _offlineNoFirebase!=='undefined' && _offlineNoFirebase){
    setTimeout(function(){ window.location.reload(); }, 800);
    return;
  }
  setTimeout(function(){
    try{
      Object.keys(_syncUnsubs).forEach(function(k){
        try{ if(typeof _syncUnsubs[k]==='function') _syncUnsubs[k](); }catch(e){}
        delete _syncUnsubs[k];
      });
      if(typeof startSyncListeners==='function') startSyncListeners();
    }catch(e){ console.log('sync reconnect err', e); }

    try{
      db.collection('iz_settings').doc('staff').get({source:'server'}).then(function(snap){
        if(snap.exists && snap.data().staff){
          localStorage.setItem('iz_staff', JSON.stringify(snap.data().staff));
          if(typeof syncDerivedFromStaff==='function') syncDerivedFromStaff(snap.data().staff);
          if(typeof renderSellersAdmin==='function' && document.getElementById('sellersAdminList')) renderSellersAdmin();
        }
      }).catch(function(){});

      pullShiftTombstonesFromCloud(function(tombstonedIds){
        var tset = {}; (tombstonedIds||[]).forEach(function(id){ tset[id]=true; });
        db.collection('iz_shifts').where('status','==','open').get({source:'server'}).then(function(snap){
          var local = JSON.parse(localStorage.getItem('iz_shifts')||'[]');
          var freshIds = {};
          snap.forEach(function(doc){
            if(tset[doc.id]){
              try{ db.collection('iz_shifts').doc(doc.id).delete(); }catch(e){}
              return;
            }
            freshIds[doc.id] = true;
            var exists = local.findIndex(function(s){ return (s.id||s._id)===doc.id; });
            if(exists>=0) local[exists] = Object.assign(local[exists], doc.data(), {id:doc.id});
            else local.push(Object.assign({id:doc.id}, doc.data()));
          });
          local = local.map(function(s){
            if((s.status==='open') && s.id && !freshIds[s.id]){
              return Object.assign({}, s, {status:'closed'});
            }
            return s;
          });
          local = local.filter(function(s){ return !tset[s.id||s._id]; });
          localStorage.setItem('iz_shifts', JSON.stringify(local));
        }).catch(function(){});
      });
    }catch(e){ console.log('fresh data err', e); }

    try{ if(typeof syncLiveShift==='function') syncLiveShift(); }catch(e){}

    try{ if(typeof renderAll==='function') renderAll(); }catch(e){}
    try{ if(typeof renderTodayShift==='function') renderTodayShift(); }catch(e){}
  }, 1000); // небольшая задержка чтобы сеть стабилизировалась
});
window.addEventListener('offline', _renderConnStatus);
document.addEventListener('DOMContentLoaded', _renderConnStatus);
var APP_BUILD_VERSION = '08.30.01';
try{
  var _lvt = document.getElementById('loginVersionTag'); if(_lvt) _lvt.textContent = 'v'+APP_BUILD_VERSION;
  var _hvt = document.getElementById('hdrVersionTag'); if(_hvt) _hvt.textContent = 'v'+APP_BUILD_VERSION;
  var _sdv = document.getElementById('ssDevicesCurVer'); if(_sdv) _sdv.textContent = 'v'+APP_BUILD_VERSION;
}catch(e){}
function _markJournalEntryConfirmed(id){
  try{
    var confirmed = JSON.parse(localStorage.getItem('iz_confirmed_jnl_ids')||'[]');
    if(confirmed.indexOf(id)===-1){ confirmed.push(id); localStorage.setItem('iz_confirmed_jnl_ids', JSON.stringify(confirmed.slice(-500))); }
  }catch(e){}
}
function _isJournalEntryConfirmed(id){
  try{ return JSON.parse(localStorage.getItem('iz_confirmed_jnl_ids')||'[]').indexOf(id)!==-1; }catch(e){ return false; }
}
// Общая логика "надёжно сохранить документ в коллекцию, а при неудаче —
// встать в очередь и повторить позже". Раньше это было отдельно написано
// для продаж и отдельно для расходов/приходов/списаний — хотя устроено
// было один в один, отличалась только коллекция и ключ очереди.
function _writeIndependentDoc(collectionName, queueKey, entry, extraFields, onConfirmed){
  try{
    if(!entry || !entry.id) return;
    var doc = Object.assign({}, entry, extraFields || {}, {
      shopName: (extraFields&&extraFields.shopName) || (session&&session.shopName) || '',
      sellerName: (session&&(session.sellerName||session.name)) || '',
      shiftId: (session&&session.shiftId) || '',
      date: (entry.ts||'').split('T')[0],
      recordedAt: new Date().toISOString()
    });
    if(typeof db==='undefined' || !db){ _queuePendingDoc(queueKey, doc); return; }
    db.collection(collectionName).doc(entry.id).set(doc).then(function(){
      _clearPendingDoc(queueKey, entry.id);
      if(onConfirmed) onConfirmed(entry.id);
    }).catch(function(){
      _queuePendingDoc(queueKey, doc);
    });
  }catch(e){
    try{ _queuePendingDoc(queueKey, Object.assign({}, entry, extraFields||{})); }catch(e2){}
  }
}
function _backupShiftIndependently(report){
  try{
    if(!report || !report.id) return;
    var doc = Object.assign({}, report, {recordedAt: new Date().toISOString()});
    if(typeof db==='undefined' || !db){ _queuePendingDoc('iz_pending_shift_backup', doc); return; }
    db.collection('iz_shift_backup').doc(report.id).set(doc).then(function(){
      _clearPendingDoc('iz_pending_shift_backup', report.id);
    }).catch(function(){
      _queuePendingDoc('iz_pending_shift_backup', doc);
    });
  }catch(e){
    try{ _queuePendingDoc('iz_pending_shift_backup', report); }catch(e2){}
  }
}
function _backupInvoiceIndependently(inv){
  try{
    if(!inv || !inv.id) return;
    var doc = Object.assign({}, inv, {recordedAt: new Date().toISOString()});
    if(typeof db==='undefined' || !db){ _queuePendingDoc('iz_pending_invoice_backup', doc); return; }
    db.collection('iz_invoice_backup').doc(inv.id).set(doc).then(function(){
      _clearPendingDoc('iz_pending_invoice_backup', inv.id);
    }).catch(function(){
      _queuePendingDoc('iz_pending_invoice_backup', doc);
    });
  }catch(e){
    try{ _queuePendingDoc('iz_pending_invoice_backup', inv); }catch(e2){}
  }
}
function _retryPendingShiftBackups(){
  _retryPendingDocs('iz_pending_shift_backup', 'iz_shift_backup', null);
}
function _retryPendingInvoiceBackups(){
  _retryPendingDocs('iz_pending_invoice_backup', 'iz_invoice_backup', null);
}
function _queuePendingDoc(queueKey, doc){
  try{
    var pending = JSON.parse(localStorage.getItem(queueKey)||'[]');
    if(!pending.some(function(d){ return d.id===doc.id; })) pending.push(doc);
    localStorage.setItem(queueKey, JSON.stringify(pending));
  }catch(e){}
}
function _clearPendingDoc(queueKey, id){
  try{
    var pending = JSON.parse(localStorage.getItem(queueKey)||'[]');
    var filtered = pending.filter(function(d){ return d.id!==id; });
    if(filtered.length!==pending.length) localStorage.setItem(queueKey, JSON.stringify(filtered));
  }catch(e){}
}
function _retryPendingDocs(queueKey, collectionName, onConfirmed){
  try{
    if(typeof db==='undefined' || !db) return;
    var pending = JSON.parse(localStorage.getItem(queueKey)||'[]');
    if(!pending.length) return;
    pending.forEach(function(doc){
      db.collection(collectionName).doc(doc.id).set(doc).then(function(){
        _clearPendingDoc(queueKey, doc.id);
        if(onConfirmed) onConfirmed(doc.id);
      }).catch(function(){});
    });
  }catch(e){}
}
function _recordJournalEntryIndependently(entry, shopName, kind){
  _writeIndependentDoc('iz_journal_backup', 'iz_pending_jnl', entry, {kind:kind, shopName:shopName}, _markJournalEntryConfirmed);
}
function _queuePendingJournalEntry(doc){ _queuePendingDoc('iz_pending_jnl', doc); }
function _clearPendingJournalEntry(id){ _clearPendingDoc('iz_pending_jnl', id); }
function _retryPendingJournalEntries(){ _retryPendingDocs('iz_pending_jnl', 'iz_journal_backup', _markJournalEntryConfirmed); }
function _markSaleConfirmed(id){
  try{
    var confirmed = JSON.parse(localStorage.getItem('iz_confirmed_sale_ids')||'[]');
    if(confirmed.indexOf(id)===-1){ confirmed.push(id); localStorage.setItem('iz_confirmed_sale_ids', JSON.stringify(confirmed.slice(-500))); }
  }catch(e){}
}
function _isSaleConfirmed(id){
  try{ return JSON.parse(localStorage.getItem('iz_confirmed_sale_ids')||'[]').indexOf(id)!==-1; }catch(e){ return false; }
}
function _recordSaleIndependently(entry, shopName){
  _writeIndependentDoc('iz_sales', 'iz_pending_sales', entry, {shopName:shopName}, _markSaleConfirmed);
}
function _queuePendingSale(saleDoc){ _queuePendingDoc('iz_pending_sales', saleDoc); }
function _clearPendingSale(id){ _clearPendingDoc('iz_pending_sales', id); }
function _retryPendingSales(){ _retryPendingDocs('iz_pending_sales', 'iz_sales', _markSaleConfirmed); }
function _getDeviceId(){
  try{
    var id = localStorage.getItem('iz_device_id');
    if(!id){ id = (typeof uid==='function'?uid():(Date.now()+'_'+Math.random().toString(36).slice(2))); localStorage.setItem('iz_device_id', id); }
    return id;
  }catch(e){ return 'unknown'; }
}
function _reportAppVersion(){
  try{
    if(typeof db==='undefined' || !db) return;
    var devId = _getDeviceId();
    var ua = navigator.userAgent||'';
    var platform = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : (/Android/.test(ua) ? 'Android' : 'Другое');
    db.collection('iz_device_versions').doc(devId).set({
      version: APP_BUILD_VERSION,
      shopName: (session&&session.shopName) || '',
      sellerName: (session&&(session.sellerName||session.name)) || '',
      role: (session&&session.role) || '',
      platform: platform,
      lastSeen: new Date().toISOString()
    }, {merge:true}).catch(function(){});
  }catch(e){}
}
function renderDeviceVersions(){
  var c = document.getElementById('deviceVersionsList'); if(!c) return;
  c.innerHTML = 'Загрузка...';
  try{
    db.collection('iz_device_versions').orderBy('lastSeen','desc').limit(50).get({source:'server'}).then(function(snap){
      if(snap.empty){ c.innerHTML='<div class="u-fs11-gray">Пока нет данных — устройства ещё не отчитались</div>'; updateSettingsSectionCount('devices', 0); return; }
      var rows = [];
      snap.forEach(function(doc){ rows.push(doc.data()); });
      updateSettingsSectionCount('devices', rows.length);
      c.innerHTML = rows.map(function(d){
        var isCurrent = d.version===APP_BUILD_VERSION;
        var seenAgo = '';
        try{
          var mins = Math.round((Date.now()-new Date(d.lastSeen).getTime())/60000);
          seenAgo = mins<60 ? (mins+' мин назад') : (mins<1440 ? (Math.round(mins/60)+' ч назад') : (Math.round(mins/1440)+' дн назад'));
        }catch(e){}
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #2e2e3e">'+
          '<div>'+
            '<div style="font-size:12px;font-weight:700">'+(d.sellerName||'—')+' · '+(d.shopName||'—')+'</div>'+
            '<div class="u-fs10-gray">'+(d.platform||'')+' · был(а) в сети: '+seenAgo+'</div>'+
          '</div>'+
          '<div style="font-size:12px;font-weight:700;padding:3px 8px;border-radius:6px;background:'+(isCurrent?'#1e2a14':'#2e1a14')+';color:'+(isCurrent?'#c8f060':'#f0a060')+'">v'+(d.version||'?')+'</div>'+
        '</div>';
      }).join('');
    }).catch(function(err){
      c.innerHTML='<div style="font-size:11px;color:#f06060">Не удалось загрузить: '+(err&&err.message||err)+'</div>';
    });
  }catch(e){
    c.innerHTML='<div style="font-size:11px;color:#f06060">Ошибка: '+(e&&e.message||e)+'</div>';
  }
}
var loginRole = 'seller';
function pick(role) {
  loginRole = role;
  var bs = document.getElementById('btnSeller');
  var ba = document.getElementById('btnAdmin');
  var bi = document.getElementById('btnInventory');
  var shopFg = document.getElementById('loginShopFg');
  var selEl = document.getElementById('loginSeller');
  var lb = document.getElementById('loginBtn');
  var label = document.getElementById('loginUserLabel');
  var _resetBtnStyles = function(){
    if(bs){ bs.style.background='#22222e'; bs.style.borderColor='#2e2e3e'; }
    if(ba){ ba.style.background='#22222e'; ba.style.borderColor='#2e2e3e'; }
    if(bi){ bi.style.background='#22222e'; bi.style.borderColor='#2e2e3e'; }
  };
  if(role === 'shopadmin') {
    _resetBtnStyles();
    if(ba){ ba.style.background='#1e1a2e'; ba.style.borderColor='#a060f0'; }
    if(shopFg) shopFg.style.display='none';
    if(label) label.textContent='Администратор';
    if(lb){ lb.textContent='Войти →'; lb.style.background='#a060f0'; lb.style.color='#fff'; }
    var rb = document.getElementById('restoreLoginBtn'); if(rb) rb.style.display='none';
    var admins = JSON.parse(localStorage.getItem('iz_shop_admins')||'[]');
    if(!admins.length){ admins=[{id:'admin_default',name:'Администратор',pass:'admin123'}]; localStorage.setItem('iz_shop_admins', JSON.stringify(admins)); }
    if(selEl) selEl.innerHTML = admins.map(function(a){ return '<option value="'+a.id+'">'+a.name+'</option>'; }).join('');
    var prevBtn = document.getElementById('previewModeBtn');
    if(prevBtn) prevBtn.style.display='block';
    if(admins.length<=1 && typeof db!=='undefined' && db){
      db.collection('iz_settings').doc('staff').get({source:'server'}).then(function(snap){
        if(!snap.exists || !snap.data().staff || !snap.data().staff.length) return;
        localStorage.setItem('iz_staff', JSON.stringify(snap.data().staff));
        if(typeof syncDerivedFromStaff==='function') syncDerivedFromStaff(snap.data().staff);
        if(loginRole!=='shopadmin') return;
        var freshAdmins = JSON.parse(localStorage.getItem('iz_shop_admins')||'[]');
        var sel2 = document.getElementById('loginSeller');
        if(sel2 && freshAdmins.length) sel2.innerHTML = freshAdmins.map(function(a){ return '<option value="'+a.id+'">'+a.name+'</option>'; }).join('');
      }).catch(function(){});
    }
  } else if(role === 'inventory') {
    _resetBtnStyles();
    if(bi){ bi.style.background='#1a1f2e'; bi.style.borderColor='#60c8f0'; }
    if(shopFg) shopFg.style.display='block';
    if(label) label.textContent='Кто считает';
    if(lb){ lb.textContent='Начать пересчёт →'; lb.style.background='#60c8f0'; lb.style.color='#0f0f13'; }
    var prevBtn2 = document.getElementById('previewModeBtn');
    if(prevBtn2) prevBtn2.style.display='none';
    var rb2 = document.getElementById('restoreLoginBtn'); if(rb2) rb2.style.display='none';
    renderLoginInventoryStaff();
  } else {
    _resetBtnStyles();
    if(bs){ bs.style.background='#1e2a14'; bs.style.borderColor='#c8f060'; }
    if(shopFg) shopFg.style.display='block';
    if(label) label.textContent='Продавец';
    if(lb){ lb.textContent='Открыть смену →'; lb.style.background='#c8f060'; lb.style.color='#0f0f13'; }
    var prevBtn = document.getElementById('previewModeBtn');
    if(prevBtn) prevBtn.style.display='none';
    var rb = document.getElementById('restoreLoginBtn'); if(rb) rb.style.display='block';
    renderLoginSellers();
  }
}
function renderLoginInventoryStaff(){
  const shop=gv('loginShop');
  const staff=getInventoryStaff().filter(s=>!s.blocked && (!s.shops || !s.shops.length || s.shops.indexOf(shop)>=0));
  const selEl=document.getElementById('loginSeller');
  const prevSelected = selEl ? selEl.value : '';
  selEl.innerHTML=staff.length
    ?staff.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')
    :'<option value="">— никто не назначен на этот магазин —</option>';
  if(prevSelected && staff.some(function(s){return s.id===prevSelected;})){ selEl.value = prevSelected; }
}
var db;
var _offlineNoFirebase = true;
var _firebaseReady = false;
var _pendingWrites = [];
function _makeStubDb(){
  function sDoc(col,id){
    return {
      get:function(){return Promise.reject(new Error('offline'));},
      set:function(data,opts){_pendingWrites.push({col:col,id:id,data:data,opts:opts});return Promise.resolve();},
      delete:function(){return Promise.resolve();},
      update:function(data){_pendingWrites.push({col:col,id:id,data:data,opts:{merge:true}});return Promise.resolve();},
      onSnapshot:function(a,b){if(b)b({code:'offline'});return function(){};},
      collection:function(c2){return sCol(col+'/'+id+'/'+c2);}
    };
  }
  function sCol(col){
    var q={
      doc:function(id){return sDoc(col,id);},
      get:function(){return Promise.reject(new Error('offline'));},
      add:function(data){_pendingWrites.push({col:col,id:null,data:data});return Promise.resolve({id:'p'+Date.now()});},
      onSnapshot:function(a,b){if(b)b({code:'offline'});return function(){};},
      where:function(){return q;},orderBy:function(){return q;},limit:function(){return q;}
    };
    return q;
  }
  return {collection:function(col){return sCol(col);}};
}
db = _makeStubDb();
var _fbLoadAttempts = 0;
function _initFirebase(){
  function load(cb){
    if(typeof firebase!=='undefined'){cb();return;}
    var done=false;
    var timeoutMs = 8000;
    var timer=setTimeout(function(){
      if(done) return;
      done=true;
      _fbLoadAttempts++;
      console.log('[App] Таймаут загрузки Firebase SDK, попытка', _fbLoadAttempts);
      try{ if(typeof _renderConnStatus==='function') _renderConnStatus(); }catch(e){}
      setTimeout(function(){ _initFirebase(); }, 3000);
    }, timeoutMs);
    function finish(){
      if(done) return;
      done=true;
      clearTimeout(timer);
      cb();
    }
    var s1=document.createElement('script');
    s1.src='https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js';
    s1.onload=function(){
      var s2=document.createElement('script');
      s2.src='https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js';
      s2.onload=finish;s2.onerror=finish;document.head.appendChild(s2);
    };
    s1.onerror=finish;document.head.appendChild(s1);
  }
  load(function(){
    if(typeof firebase==='undefined'){console.log('[App] Firebase офлайн');return;}
    try{
      if(!firebase.apps.length){
        firebase.initializeApp({
          apiKey:"AIzaSyD0hKs-O5hmIFNb1cFLp0_73-tiylQx6Jw",
          authDomain:"izhitsa-6327c.firebaseapp.com",
          projectId:"izhitsa-6327c",
          storageBucket:"izhitsa-6327c.firebasestorage.app",
          messagingSenderId:"1025102190040",
          appId:"1:1025102190040:web:bb3b8e5e61f0b1fa038ead"
        });
      }
      var rdb=firebase.firestore();
      // Firestore's own IndexedDB persistence (enablePersistence) disabled 2026-08-23: its
      // multi-tab-synchronized local cache kept corrupting into "INTERNAL ASSERTION FAILED:
      // Unexpected state" with many sellers/devices open at once, hanging every read/write
      // through it. The app already has its own independent offline/retry layer (localStorage,
      // izhitsa_cache IndexedDB, _pendingSync + _pushShiftWithRetry) that doesn't touch this
      // subsystem, so Firestore calls now always go straight to the network — slower offline,
      // but no more silent corruption or hung promises.
      db=rdb;_offlineNoFirebase=false;_firebaseReady=true;
      if(_pendingWrites.length){
        console.log('[App] Флашим',_pendingWrites.length,'отложенных записей');
        _pendingWrites.forEach(function(w){
          try{if(w.id)rdb.collection(w.col).doc(w.id).set(w.data,w.opts||{merge:true});
          else rdb.collection(w.col).add(w.data);}catch(e){}
        });_pendingWrites=[];
      }
      Object.keys(_syncUnsubs).forEach(function(k){
        try{ if(typeof _syncUnsubs[k]==='function') _syncUnsubs[k](); }catch(e){}
        delete _syncUnsubs[k];
      });
      try{if(typeof startSyncListeners==='function')startSyncListeners();}catch(e){}
      try{if(typeof startStaffLiveSync==='function' && typeof _staffSyncUpdateCb==='function') startStaffLiveSync(_staffSyncUpdateCb);}catch(e){}
      try{if(typeof startStockSync==='function') startStockSync();}catch(e){}
      try{if(typeof _retryPendingShiftSyncs==='function') _retryPendingShiftSyncs();}catch(e){}
      try{if(typeof _retryPendingShiftBackups==='function') _retryPendingShiftBackups();}catch(e){}
      try{if(typeof _retryPendingInvoiceBackups==='function') _retryPendingInvoiceBackups();}catch(e){}
      try{
        if(typeof session!=='undefined' && session && session.role!=='shopadmin' && !session.isPreview && typeof startInvoiceLiveSync==='function'){
          startInvoiceLiveSync();
        }
      }catch(e){}
      try{if(typeof syncLiveShift==='function')syncLiveShift();}catch(e){}
      try{
        if(typeof session!=='undefined' && session && session.role==='shopadmin'){
          if(typeof startAdminShiftListener==='function') startAdminShiftListener();
          if(typeof startAdminAlertsListener==='function') startAdminAlertsListener();
          if(typeof startAdminAuditListener==='function') startAdminAuditListener();
        }
      }catch(e){}
      try{if(typeof _renderConnStatus==='function')_renderConnStatus();}catch(e){}
      console.log('[App] Firebase готов');
    }catch(e){console.log('[App] Ошибка Firebase:',e.message);}
  });
}
var _syncUnsubs = {};
var SYNC_SETTINGS = {
  'iz_admin_shops':      {doc:'sales_sources', field:'data'},
  'iz_shop_admins':      {doc:'admins',   field:'admins'},
  'iz_sellers':          {doc:'sellers',  field:'sellers'},
  'iz_shop_zp_settings': {doc:'zp',       field:'zp'},
  'iz_shop_rent':        {doc:'rent',     field:'data'},
  'iz_items':            {doc:'items',    field:'items'},
  'iz_species':          {doc:'species',  field:'list'},
  'iz_accounts':         {doc:'accounts', field:'accounts'},
  'iz_payment_methods':  {doc:'payment_methods', field:'data'},
  'iz_suppliers':        {doc:'suppliers',     field:'data'},
  'iz_goods':            {doc:'goods',         field:'data'},
  'iz_goods_derevo':     {doc:'goods_derevo',  field:'data'},
  'iz_goods_dr':         {doc:'goods_dr',      field:'data'},
  'iz_dr_species':       {doc:'dr_species',    field:'data'},
  'iz_materials':        {doc:'materials',     field:'data'},
  'iz_work_schedules':   {doc:'work_schedules', field:'data'},
  'iz_employee_statuses': {doc:'employee_statuses', field:'data'},
};
function _syncApplyRemoteValue(lsKey, val){
  if(val === undefined) return;
  var lastSave = _syncSaveGuard[lsKey]||0;
  var justSaved = (Date.now() - lastSave) < 300000; // 5 min guard
  if(!justSaved){
    var shopRefbookKeys2 = ['iz_payment_methods','iz_suppliers','iz_goods','iz_goods_derevo','iz_goods_dr','iz_materials','iz_dr_species','iz_work_schedules'];
    var valToWrite = val;
    if(shopRefbookKeys2.indexOf(lsKey)>=0 && Array.isArray(val)){
      var tombKey2 = lsKey+'_deleted';
      var tombs2 = JSON.parse(localStorage.getItem(tombKey2)||'[]');
      if(tombs2.length){
        valToWrite = val.filter(function(item){
          return tombs2.indexOf((item.name||item||'').toLowerCase().trim())<0;
        });
      }
    }
    localStorage.setItem(lsKey, JSON.stringify(valToWrite));
  }
  if(lsKey === 'iz_admin_shops' || lsKey === 'iz_sellers') { try { pick(loginRole); } catch(e){} }
  if(lsKey === 'iz_admin_shops'){
    try{ if(typeof renderLoginShopSelect==='function') renderLoginShopSelect(); }catch(e){}
    try{ renderShopsManage(); }catch(e){}
    try{ renderShopSettings(); }catch(e){}
    try{ if(typeof renderTodayShift==='function' && document.getElementById('todayShiftContent')) renderTodayShift(); }catch(e){}
    try{ if(typeof renderStatusBar==='function' && document.getElementById('mainStatusBar')) renderStatusBar(); }catch(e){}
  }
  if(lsKey === 'iz_accounts'){
    try{ renderAccountsList(); }catch(e){}
  }
  if(lsKey === 'iz_shop_zp_settings'){
    try{ renderShopSettings(); }catch(e){}
    try{ if(session && document.getElementById('mainStatusBar')) renderStatusBar(); }catch(e){}
  }
  var shopRefbookKeys = ['iz_payment_methods','iz_suppliers','iz_goods','iz_goods_derevo','iz_goods_dr','iz_materials','iz_dr_species','iz_work_schedules'];
  if(shopRefbookKeys.indexOf(lsKey)>=0){
    var book = SHOP_REFBOOKS.find(function(b){ return b.key===lsKey; });
    if(book){
      try{ renderRefbookItemsShop(book.id, book.key); updateRefbookCountShop(book.id, book.key); }catch(e){}
    }
  }
}
function syncListen(lsKey) {
  var m = SYNC_SETTINGS[lsKey]; if(!m || _syncUnsubs[lsKey]) return;
  // Живой onSnapshot иногда не успевает подключиться или молчит на нестабильной сети —
  // разовый прямой запрос сразу при старте гарантирует, что каталог не застрянет в
  // устаревшем виде на конкретном устройстве до следующего изменения на сервере.
  try{
    db.collection('iz_settings').doc(m.doc).get({source:'server'}).then(function(snap){
      if(snap.exists) _syncApplyRemoteValue(lsKey, snap.data()[m.field]);
    }).catch(function(){});
  }catch(e){}
  _syncUnsubs[lsKey] = db.collection('iz_settings').doc(m.doc).onSnapshot(function(snap){
    if(!snap.exists) return;
    _syncApplyRemoteValue(lsKey, snap.data()[m.field]);
  }, function(e){ console.log('syncListen err', lsKey, e.code||e); });
}
var _syncSaveGuard = {}; // lsKey -> timestamp of last local save
function syncSave(lsKey, data) {
  localStorage.setItem(lsKey, JSON.stringify(data));
  var m = SYNC_SETTINGS[lsKey]; if(!m) return;
  _syncSaveGuard[lsKey] = Date.now(); // mark as just saved locally
  var obj = {}; obj[m.field] = data; obj.updatedAt = new Date().toISOString();
  db.collection('iz_settings').doc(m.doc).set(obj, {merge:true}).then(function(){
    _clearPendingRefbookSave(lsKey);
  }).catch(function(e){
    console.log('syncSave err', lsKey, e.code||e);
    _queuePendingRefbookSave(lsKey, obj);
    showToast('⚠️ Не удалось сохранить в облако — сохранится автоматически, когда появится связь');
  });
}
function syncArrayAdd(lsKey, newItem){
  var m = SYNC_SETTINGS[lsKey];
  _syncSaveGuard[lsKey] = Date.now(); // mark as just saved locally
  if(!m) return;
  if(typeof firebase==='undefined' || !firebase.firestore || !firebase.firestore.FieldValue){
    var full = {}; full[m.field] = JSON.parse(localStorage.getItem(lsKey)||'[]'); full.updatedAt = new Date().toISOString();
    _queuePendingRefbookSave(lsKey, full);
    return;
  }
  var upd = {}; upd[m.field] = firebase.firestore.FieldValue.arrayUnion(newItem); upd.updatedAt = new Date().toISOString();
  db.collection('iz_settings').doc(m.doc).set(upd, {merge:true}).then(function(){
    _clearPendingRefbookSave(lsKey);
  }).catch(function(e){
    console.log('syncArrayAdd err', lsKey, e.code||e);
    var full = {}; full[m.field] = JSON.parse(localStorage.getItem(lsKey)||'[]'); full.updatedAt = new Date().toISOString();
    _queuePendingRefbookSave(lsKey, full);
    showToast('⚠️ Не удалось сохранить в облако — сохранится автоматически, когда появится связь');
  });
}
function _queuePendingRefbookSave(lsKey, obj){
  try{
    var pending = JSON.parse(localStorage.getItem('iz_pending_refbook_saves')||'{}');
    pending[lsKey] = obj;
    localStorage.setItem('iz_pending_refbook_saves', JSON.stringify(pending));
  }catch(e){}
}
function _clearPendingRefbookSave(lsKey){
  try{
    var pending = JSON.parse(localStorage.getItem('iz_pending_refbook_saves')||'{}');
    if(pending[lsKey]){ delete pending[lsKey]; localStorage.setItem('iz_pending_refbook_saves', JSON.stringify(pending)); }
  }catch(e){}
}
function _retryPendingRefbookSaves(){
  try{
    if(typeof db==='undefined' || !db) return;
    var pending = JSON.parse(localStorage.getItem('iz_pending_refbook_saves')||'{}');
    var keys = Object.keys(pending);
    if(!keys.length) return;
    keys.forEach(function(lsKey){
      var m = SYNC_SETTINGS[lsKey];
      if(!m){ _clearPendingRefbookSave(lsKey); return; }
      db.collection('iz_settings').doc(m.doc).set(pending[lsKey], {merge:true}).then(function(){
        _clearPendingRefbookSave(lsKey);
      }).catch(function(){});
    });
  }catch(e){}
}
var SHIFTS_LIVE_SYNC_DAYS = 14; // shrunk from 35 on 2026-08-23: localStorage has a hard ~5-10MB
// browser quota (unrelated to actual device disk space) — a 35-day window across all shops'
// journals routinely overflowed it on a full "☁️ Синх" pull. Shifts older than this window
// already live in the higher-capacity IndexedDB archive cache (_extraArchiveShifts), so
// shrinking this just moves more days into storage that was built to hold them.
function _shiftsLiveSyncCutoff(){
  var d = new Date(Date.now() - SHIFTS_LIVE_SYNC_DAYS*86400000);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function _ensureShiftsLoadedForRange(fromDate){
  if(typeof db==='undefined' || !db) return Promise.resolve();
  var cutoff = _shiftsLiveSyncCutoff();
  if(fromDate && fromDate >= cutoff) return Promise.resolve(); // уже покрыто живой синхронизацией
  var q = db.collection('iz_shifts').where('date','<',cutoff);
  if(fromDate) q = q.where('date','>=',fromDate);
  var settled = false;
  var timeoutP = new Promise(function(resolve){
    setTimeout(function(){
      if(settled) return;
      settled = true;
      showToast('⚠️ Не удалось подтянуть старые смены — сервер не отвечает. Попробуйте ещё раз.');
      resolve();
    }, 15000);
  });
  var fetchP = q.get().then(function(snap){
    if(settled) return;
    settled = true;
    var extra = snap.docs.map(function(d){ return Object.assign({_id:d.id, _archiveOnly:true}, d.data()); });
    if(!extra.length) return;
    // Старые смены (за пределами живого 35-дневного окна) держим только в памяти —
    // localStorage у сайта ограничен браузером до нескольких МБ независимо от диска устройства,
    // и постоянное сохранение сюда истории архива рано или поздно упирается в этот лимит.
    var tomb = {}; getShiftTombstones().forEach(function(id){ tomb[id]=true; });
    var localIds = {}; JSON.parse(localStorage.getItem('iz_shifts')||'[]').forEach(function(s){ localIds[s.id||s._id]=true; });
    var existingIds = {}; window._extraArchiveShifts.forEach(function(s){ existingIds[s.id||s._id]=true; });
    var addedAny = false;
    extra.forEach(function(s){
      var sid = s.id||s._id;
      if(sid && !localIds[sid] && !existingIds[sid] && !tomb[sid]){ window._extraArchiveShifts.push(s); addedAny=true; }
    });
    if(addedAny && typeof _persistExtraArchiveShifts==='function') _persistExtraArchiveShifts();
  }).catch(function(e){
    if(settled) return;
    settled = true;
    console.log('[_ensureShiftsLoadedForRange] err', e);
  });
  return Promise.race([fetchP, timeoutP]);
}
function syncListenCollection(lsKey, colName, queryFn) {
  if(_syncUnsubs[lsKey]) return;
  var ref = queryFn ? queryFn(db.collection(colName)) : db.collection(colName);
  _syncUnsubs[lsKey] = ref.onSnapshot(function(snap){
    var docs = snap.docs.map(function(d){ return Object.assign({_id:d.id}, d.data()); });
    docs.sort(function(a,b){ return (b.date||b.closedAt||b.createdAt||'').localeCompare(a.date||a.closedAt||a.createdAt||''); });
    if(lsKey === 'iz_shifts'){
      var tomb = {}; getShiftTombstones().forEach(function(id){ tomb[id]=true; });
      docs = docs.filter(function(d){ return !tomb[d._id||d.id]; });
      var local = JSON.parse(localStorage.getItem(lsKey)||'[]');
      local = local.filter(function(loc){ return !tomb[loc._id||loc.id]; });
      var remoteIds = {};
      docs.forEach(function(d){ remoteIds[d._id||d.id] = true; });
      local.forEach(function(loc){
        var lid = loc._id||loc.id;
        if(lid && !remoteIds[lid]) docs.push(loc);
      });
      docs.sort(function(a,b){ return (b.date||b.closedAt||b.createdAt||'').localeCompare(a.date||a.closedAt||a.createdAt||''); });
    }
    localStorage.setItem(lsKey, JSON.stringify(docs));
    if(lsKey==='iz_shifts'){
      try{if(typeof renderShiftHistory==='function') renderShiftHistory();}catch(e){}
      try{if(typeof renderTodayShift==='function') renderTodayShift();}catch(e){}
    }
  }, function(e){ console.log('col sync err', colName, e.code||e); });
}
function startSyncListeners() {
  ['iz_goods_derevo','iz_goods_dr','iz_species','iz_dr_species','iz_goods','iz_materials'].forEach(function(key){
    var docName = key==='iz_goods_derevo'?'goods_derevo_deleted':
                  key==='iz_goods_dr'?'goods_dr_deleted':
                  key==='iz_species'?'species_deleted':
                  key==='iz_dr_species'?'dr_species_deleted':
                  'refbook_deleted_'+key; // iz_goods → refbook_deleted_iz_goods, iz_materials → refbook_deleted_iz_materials
    db.collection('iz_settings').doc(docName).get().then(function(snap){
      if(snap.exists && snap.data().deleted){
        var tombKey = key+'_deleted';
        var local = JSON.parse(localStorage.getItem(tombKey)||'[]');
        var remote = snap.data().deleted||[];
        var merged = local.slice();
        remote.forEach(function(n){ if(merged.indexOf(n)<0) merged.push(n); });
        localStorage.setItem(tombKey, JSON.stringify(merged));
      }
    }).catch(function(){});
  });
  Object.keys(SYNC_SETTINGS).forEach(syncListen);
  try{ pullShiftTombstonesFromCloud(); }catch(e){}
  syncListenCollection('iz_shifts', 'iz_shifts', function(ref){ return ref.where('date','>=',_shiftsLiveSyncCutoff()); });
  syncListenCollection('iz_invoices', 'iz_invoices');
  syncListenCollection('iz_manual_invoices', 'iz_manual_invoices');
  syncListenCollection('iz_psj', 'iz_psj');
  syncListenCollection('iz_shop_notifications', 'iz_shop_notifications');
}
let session = null, pendingSession = null;
let journal = [];
var restoreMode = false;
var restoreMeta = null;
function _workingNowISO(){
  if(restoreMode && restoreMeta && restoreMeta.date){
    var t=new Date();
    return restoreMeta.date+'T'+String(t.getHours()).padStart(2,'0')+':'+String(t.getMinutes()).padStart(2,'0')+':'+String(t.getSeconds()).padStart(2,'0')+'.000Z';
  }
  if(session && session.isBackfill && session.backfillDate){
    var t2=new Date();
    return session.backfillDate+'T'+String(t2.getHours()).padStart(2,'0')+':'+String(t2.getMinutes()).padStart(2,'0')+':'+String(t2.getSeconds()).padStart(2,'0')+'.000Z';
  }
  return new Date().toISOString();
}
const KEY = {session:'iz_shop_session',journal:'iz_shop_journal',shifts:'iz_shifts',trash:'iz_shop_trash',
  restoreSession:'iz_restore_session',restoreJournal:'iz_restore_journal',
  liveSessionBackup:'iz_live_session_backup',liveJournalBackup:'iz_live_journal_backup',
  shiftTombstones:'iz_shift_tombstones'};
function getStaff() {
  return JSON.parse(localStorage.getItem('iz_staff')||'[]');
}
function saveStaffShop(data) {
  localStorage.setItem('iz_staff', JSON.stringify(data));
  var obj = {staff: data, updatedAt: new Date().toISOString()};
  db.collection('iz_settings').doc('staff').set(obj, {merge:true})
    .catch(function(e){ console.log('saveStaffShop err', e); showToast('⚠️ Сотрудник сохранён только локально! Ошибка облака: '+(e&&e.message||e)); });
  syncDerivedFromStaff(data);
}
function syncDerivedFromStaff(staff) {
  if(!staff || !staff.length) return;
  var sellers = staff.filter(function(s){
    if(s.blocked || s.archived===true) return false;
    return (s.roles && s.roles.indexOf('seller')>=0) || (!s.roles || !s.roles.length);
  }).map(function(s){
    return {id:s.id, name:s.name, pass:s.pass, shops:s.shops||[], blocked:false, rate:s.wsRate||0};
  });
  localStorage.setItem('iz_sellers', JSON.stringify(sellers));
  var invStaff = staff.filter(function(s){
    if(s.blocked || s.archived===true) return false;
    return s.roles && s.roles.indexOf('inventory')>=0;
  }).map(function(s){
    return {id:s.id, name:s.name, pass:s.pass, shops:s.shopsInv||[], blocked:false};
  });
  localStorage.setItem('iz_inventory_staff', JSON.stringify(invStaff));
  var wsRoles = ['мастер','заготовщик','кладовщик','управляющий'];
  var wsEmps = staff.filter(function(s){
    return s.roles && s.roles.some(function(r){ return wsRoles.indexOf(r)>=0; }) && !s.blocked;
  }).map(function(s){
    var r = s.roles.find(function(r){ return wsRoles.indexOf(r)>=0; })||'мастер';
    return {id:s.id, name:s.name, pass:s.pass, role:r, rate:s.wsRate||0, blocked:false};
  });
  localStorage.setItem('ws_employees', JSON.stringify(wsEmps));
  var adminRoles = ['admin','owner','accountant'];
  var admins = staff.filter(function(s){
    return s.roles && s.roles.some(function(r){ return adminRoles.indexOf(r)>=0; }) && !s.blocked;
  }).map(function(s){
    var r = s.roles.find(function(r){ return adminRoles.indexOf(r)>=0; })||'admin';
    return {id:s.id, name:s.name, pass:s.pass, role:r};
  });
  if(!admins.some(function(a){ return a.id==='admin_default'; }))
    admins.unshift({id:'admin_default', name:'Администратор', role:'admin', pass:'admin123'});
  localStorage.setItem('iz_admin_users', JSON.stringify(admins));
  localStorage.setItem('iz_shop_admins', JSON.stringify(admins));
}
function startInvoiceLiveSync(){
  db.collection('iz_invoices').onSnapshot(snap=>{
    localStorage.setItem('iz_invoices',JSON.stringify(snap.docs.map(x=>({_id:x.id,...x.data()}))));
    updateInvBadge(); renderPendingAlert();
    migrateLegacyManualInvoices();
  },()=>{});
  db.collection('iz_manual_invoices').onSnapshot(snap=>{
    localStorage.setItem('iz_manual_invoices',JSON.stringify(snap.docs.map(x=>({_id:x.id,...x.data()}))));
    if(document.getElementById('rcvArchiveDates')) renderReceiveArchive();
  },()=>{});
}
function startStaffLiveSync(onUpdate) {
  if(typeof db === 'undefined') return;
  db.collection('iz_settings').doc('staff').onSnapshot(function(snap){
    if(!snap.exists) return;
    var data = snap.data();
    var val = data && data.staff;
    if(val && val.length) {
      localStorage.setItem('iz_staff', JSON.stringify(val));
      syncDerivedFromStaff(val);
      if(typeof onUpdate === 'function') onUpdate();
    }
  }, function(e){ console.log('staff sync err', e && e.code); });
}
function getSellers(){
  var staff = getStaff();
  if(staff.length) {
    return staff.filter(function(s){ return s.roles && s.roles.indexOf('seller')>=0 && !s.blocked; })
      .map(function(s){ return {id:s.id, name:s.name, pass:s.pass, shops:s.shops||[], blocked:false}; });
  }
  return JSON.parse(localStorage.getItem('iz_sellers')||'[]');
}
function getInventoryStaff(){
  var staff = getStaff();
  if(staff.length) {
    return staff.filter(function(s){ return s.roles && s.roles.indexOf('inventory')>=0 && !s.blocked; })
      .map(function(s){ return {id:s.id, name:s.name, pass:s.pass, shops:s.shopsInv||[], blocked:false}; });
  }
  return JSON.parse(localStorage.getItem('iz_inventory_staff')||'[]');
}
function getShopAdmins(){
  var adminRoles=['admin','owner','accountant'];
  var staff = getStaff();
  if(staff.length) {
    var admins = staff.filter(function(s){ return s.roles && s.roles.some(function(r){return adminRoles.indexOf(r)>=0;}) && !s.blocked; })
      .map(function(s){ return {id:s.id, name:s.name, pass:s.pass}; });
    if(!admins.some(function(a){return a.id==='admin_default';}))
      admins.unshift({id:'admin_default', name:'Администратор', pass:'admin123'});
    return admins;
  }
  var fallback = JSON.parse(localStorage.getItem('iz_shop_admins')||'[]');
  if(!fallback.length) fallback = [{id:'admin_default',name:'Администратор',pass:'admin123'}];
  return fallback;
}
function saveShopAdmins(d){ syncSave('iz_shop_admins', d); }
function getInvoices(){ return JSON.parse(localStorage.getItem('iz_invoices')||'[]').filter(function(i){ return !i.manual; }); }
function saveInvoices(d){ localStorage.setItem('iz_invoices',JSON.stringify(d)); }
var SHOP_TYPE_ORDER = {shop:0, offline:1, online:2, workshop:3};
var ACCOUNT_TYPE_ORDER = {cash:0, card:1, rs:2, bank:2, online:3};
function sortByTypeThenName(arr, typeOrder){
  return arr.slice().sort(function(a,b){
    var ta = typeOrder[(a.type||'')] !== undefined ? typeOrder[a.type||''] : 99;
    var tb = typeOrder[(b.type||'')] !== undefined ? typeOrder[b.type||''] : 99;
    if(ta !== tb) return ta - tb;
    var na = (a.name||a||'').toString();
    var nb = (b.name||b||'').toString();
    return na.localeCompare(nb, 'ru');
  });
}
function getShops(){ return sortByTypeThenName(JSON.parse(localStorage.getItem('iz_admin_shops')||'[]'), SHOP_TYPE_ORDER); }
function saveShops(d){ syncSave('iz_admin_shops', sortByTypeThenName(d, SHOP_TYPE_ORDER)); }
function getShopNames(){ var s=getShops(); return s.length?s.map(x=>x.name||x):['Дерево','ДР Товар']; }
function getShopType(name){
  var shops=getShops();
  var s=shops.find(function(x){return (x.name||x)===name;});
  return s?s.type||'shop':'shop';
}
function saveJ(){ localStorage.setItem(restoreMode?KEY.restoreJournal:KEY.journal,JSON.stringify(journal)); }
function loadAndCleanJournal(){
  var isRestore = restoreMode;
  var raw = JSON.parse(localStorage.getItem(isRestore?KEY.restoreJournal:KEY.journal)||'[]');
  if(!session || !session.openedAt) return raw;
  var shiftDate = session.openedAt.split('T')[0];
  return raw.filter(function(e){
    if(e.type === 'receive' && e.ts){
      var eDate = e.ts.split('T')[0];
      if(eDate < shiftDate) return false;
    }
    return true;
  });
}
function saveS(){ localStorage.setItem(restoreMode?KEY.restoreSession:KEY.session,JSON.stringify(session)); }
function getAuditLog(){ try { return JSON.parse(localStorage.getItem('iz_audit_log_shop')||'[]'); } catch(e) { return []; } }
function saveAuditLog(data){ localStorage.setItem('iz_audit_log_shop',JSON.stringify(data)); }
function logAction(action, details, shiftIdOverride) {
  if(!session) return;
  var log = getAuditLog();
  var entry = {
    id: uid(),
    timestamp: new Date().toISOString(),
    user: session.name||session.sellerName,
    shopName: session.shopName,
    shiftId: shiftIdOverride || session.shiftId || null,
    action: action,
    details: details || {}
  };
  log.push(entry);
  if(log.length > 5000) log.splice(0, log.length - 5000);
  saveAuditLog(log);
  try{ db.collection('iz_audit_log').doc(entry.id).set(entry); }catch(e){}
}
function logSale(itemCount, total, shop){ logAction('SALE', {itemCount:itemCount, total:total, shop:shop}); }
function logWriteoff(reason, amount, shop){ logAction('WRITEOFF', {reason:reason, amount:amount, shop:shop}); }
function logReceive(type, amount, shop){ logAction('RECEIVE', {type:type, amount:amount, shop:shop}); }
function logExpense(category, amount, desc){ logAction('EXPENSE', {category:category, amount:amount, desc:desc}); }
function logShiftOpen(shop, cashAmount){ logAction('SHIFT_OPEN', {shop:shop, cashAmount:cashAmount}); }
function logEntryEdit(before, after, shiftIdOverride){
  logAction('JOURNAL_ENTRY_EDIT', {
    entryType: before.type, entryId: before.id,
    before: {label:before.label, sub:before.sub, amount:before.amount, discount:before.discount,
      payMethod:before.payMethod, cashPart:before.cashPart, cardPart:before.cardPart, items:before.items, comment:before.comment},
    after: {label:after.label, sub:after.sub, amount:after.amount, discount:after.discount,
      payMethod:after.payMethod, cashPart:after.cashPart, cardPart:after.cardPart, items:after.items, comment:after.comment}
  }, shiftIdOverride);
}
function logEntryDelete(entry, shiftIdOverride){
  logAction('JOURNAL_ENTRY_DELETE', {
    entryType: entry.type, entryId: entry.id,
    snapshot: {label:entry.label, sub:entry.sub, amount:entry.amount, discount:entry.discount,
      payMethod:entry.payMethod, cashPart:entry.cashPart, cardPart:entry.cardPart, items:entry.items, comment:entry.comment, ts:entry.ts}
  }, shiftIdOverride);
}
function fmt(n){ return Math.abs(Math.round(n||0)).toLocaleString('ru-RU')+'₽'; }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function gv(id){ return (document.getElementById(id)||{}).value||''; }
var _fsCorruptionPromptShown = false;
function _isFsCorruptionMsg(msg){ return /INTERNAL ASSERTION FAILED/i.test(msg||''); }
function _recoverFsCorruption(){
  if(_fsCorruptionPromptShown) return;
  _fsCorruptionPromptShown = true;
  showToast('🔄 Обнаружена внутренняя ошибка кэша синхронизации — чиню и перезагружаю (данные не пострадают)...');
  try{
    if(indexedDB.databases){
      indexedDB.databases().then(function(dbs){
        var dels = (dbs||[]).filter(function(d){ return d.name && /firestore/i.test(d.name); })
          .map(function(d){ return new Promise(function(res){ var req=indexedDB.deleteDatabase(d.name); req.onsuccess=req.onerror=req.onblocked=function(){res();}; }); });
        Promise.all(dels).finally(function(){ location.reload(); });
      }).catch(function(){ location.reload(); });
    } else { location.reload(); }
  }catch(e){ location.reload(); }
}
function showToast(msg){
  const t=document.getElementById('toast'); t.textContent=msg;
  var isWarn = /⚠️|❌|Ошибка|не удал|не найден/i.test(msg);
  t.style.background = isWarn ? '#2e1a1a' : '#1a2e1a';
  t.style.borderColor = isWarn ? '#f06060' : '#60f090';
  t.style.color = isWarn ? '#f06060' : '#60f090';
  t.classList.add('show');
  clearTimeout(window._toastHideTimer);
  var duration = Math.min(9000, Math.max(2600, msg.length*45));
  window._toastHideTimer = setTimeout(()=>t.classList.remove('show'),duration);
  if(_isFsCorruptionMsg(msg)) setTimeout(_recoverFsCorruption, 300);
}
function _queuePendingInvoice(colName, inv){
  try{
    var pending = JSON.parse(localStorage.getItem('iz_pending_invoices')||'[]');
    if(!pending.some(function(p){ return p.id===inv.id && p.col===colName; })){
      pending.push({col:colName, id:inv.id, data:inv});
      localStorage.setItem('iz_pending_invoices', JSON.stringify(pending));
    }
  }catch(e){}
}
function _clearPendingInvoice(colName, id){
  try{
    var pending = JSON.parse(localStorage.getItem('iz_pending_invoices')||'[]');
    var filtered = pending.filter(function(p){ return !(p.id===id && p.col===colName); });
    if(filtered.length!==pending.length) localStorage.setItem('iz_pending_invoices', JSON.stringify(filtered));
  }catch(e){}
}
function _retryPendingInvoices(){
  try{
    if(typeof db==='undefined' || !db) return;
    var pending = JSON.parse(localStorage.getItem('iz_pending_invoices')||'[]');
    if(!pending.length) return;
    pending.forEach(function(p){
      db.collection(p.col).doc(p.id).set(p.data).then(function(){
        _clearPendingInvoice(p.col, p.id);
      }).catch(function(){});
    });
  }catch(e){}
}
function openMo(id){
  var el = document.getElementById(id);
  if(!el) return;
  document.body.appendChild(el);
  el.classList.add('open');
  requestAnimationFrame(function(){
    var md = el.querySelector('.md');
    if(md){
      var prevDisplay = md.style.display;
      md.style.display = 'none';
      void md.offsetHeight; // force reflow
      md.style.display = prevDisplay;
    }
  });
}
function closeMo(id){
  var el=document.getElementById(id);
  if(el) el.classList.remove('open');
  requestAnimationFrame(function(){
    document.querySelectorAll('.page.active, .mo.open .md').forEach(function(sEl){
      var prevDisplay = sEl.style.display;
      sEl.style.display = 'none';
      void sEl.offsetHeight; // force reflow
      sEl.style.display = prevDisplay;
    });
  });
}
function showPg(name,el){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  var pgEl=document.getElementById('pg-'+name); if(pgEl) pgEl.classList.add('active');
  if(el) el.classList.add('active');
}
function renderLoginSellers(){
  const shop=gv('loginShop');
  const sellers=getSellers().filter(s=>!s.blocked && (!s.shops || !s.shops.length || s.shops.indexOf(shop)>=0));
  const selEl=document.getElementById('loginSeller');
  const prevSelected = selEl ? selEl.value : '';
  selEl.innerHTML=sellers.length
    ?sellers.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')
    :'<option value="">— нет продавцов —</option>';
  if(prevSelected && sellers.some(function(s){return s.id===prevSelected;})){ selEl.value = prevSelected; }
}
function doLogin(){
  const sellerId=gv('loginSeller'), pass=gv('loginPass');
  const err=document.getElementById('loginErr');
  err.style.display='none';
  if(loginRole==='shopadmin'){
    const admins=getShopAdmins();
    const admin=admins.find(a=>a.id===sellerId)||admins[0];
    if(!admin){ err.style.display='block'; err.textContent='Нет администраторов'; return; }
    if(admin.pass!==pass){ err.style.display='block'; err.textContent='Неверный пароль'; return; }
    session={id:admin.id,name:admin.name,role:'shopadmin',shopName:'Все магазины'};
    saveS(); startAdminApp(); return;
  }
  if(loginRole==='inventory'){
    const invShopName=gv('loginShop');
    const invPerson=getInventoryStaff().find(s=>s.id===sellerId);
    if(!invPerson){ err.style.display='block'; err.textContent='Никто не назначен — назначьте себя в Настройках → Сотрудники (роль «Инвентаризация»)'; return; }
    if(invPerson.blocked){ err.style.display='block'; err.textContent='Аккаунт заблокирован'; return; }
    if(invPerson.pass!==pass){ err.style.display='block'; err.textContent='Неверный пароль'; return; }
    if(invPerson.shops && invPerson.shops.length && invPerson.shops.indexOf(invShopName)<0){
      err.style.display='block';
      err.textContent='Этот человек не назначен на магазин «'+invShopName+'»';
      return;
    }
    session={id:invPerson.id,name:invPerson.name,sellerName:invPerson.name,role:'inventory',shopName:invShopName};
    saveS(); startInventoryApp(); return;
  }
  const shopName=gv('loginShop');
  const seller=getSellers().find(s=>s.id===sellerId);
  if(!seller){ err.style.display='block'; err.textContent='Продавец не найден'; return; }
  if(seller.blocked){ err.style.display='block'; err.textContent='Аккаунт заблокирован'; return; }
  if(seller.pass!==pass){ err.style.display='block'; err.textContent='Неверный пароль'; return; }
  if(seller.shops && seller.shops.length && seller.shops.indexOf(shopName)<0){
    err.style.display='block';
    err.textContent='Этот продавец не привязан к магазину «'+shopName+'» (в Ролях указаны: '+seller.shops.join(', ')+')';
    return;
  }
  try{ refreshRecentClosedShiftsFromCloud(shopName); }catch(e){}
  var existing = JSON.parse(localStorage.getItem(KEY.session)||'null');
  var sameSeller = existing && (existing.sellerId===sellerId || existing.sellerName===seller.name);
  if(existing && (existing.isRestoreShift || existing.source==='psj' || existing.backfilled)){
    existing = null;
    localStorage.removeItem(KEY.session);
    localStorage.removeItem(KEY.journal);
  }
  var restoreS = JSON.parse(localStorage.getItem(KEY.restoreSession)||'null');
  if(restoreS && (restoreS.sellerId===sellerId || restoreS.sellerName===seller.name) && restoreS.shopName===shopName){
    var rb = document.getElementById('loginRestoreBanner');
    if(rb) rb.style.display='block';
  }
  if(existing && existing.role!=='shopadmin' && sameSeller && existing.shopName===shopName){
    if(existing.shiftId){
      db.collection('iz_shifts').doc(existing.shiftId).get().then(function(snap){
        if(snap.exists && snap.data().status==='closed'){
          localStorage.removeItem(KEY.session); localStorage.removeItem(KEY.journal);
          showToast('Эта смена уже была закрыта. Открываем новую.');
          doLogin();
          return;
        }
        _shiftForceClosedRemotely = false;
        session = existing;
        journal = loadAndCleanJournal();
        startApp();
        syncLiveShift();
        showToast('📂 Восстановлена незакрытая смена');
      }).catch(function(){
        _shiftForceClosedRemotely = false;
        session = existing;
        journal = loadAndCleanJournal();
        startApp();
        syncLiveShift();
        showToast('📂 Восстановлена незакрытая смена');
      });
      return;
    }
    _shiftForceClosedRemotely = false;
    session = existing;
    journal = loadAndCleanJournal();
    startApp();
    syncLiveShift();
    showToast('📂 Восстановлена незакрытая смена');
    return;
  }
  if(existing && existing.role!=='shopadmin'){
    console.log('Найдена сохранённая смена, но она не подходит этому входу:',
      {existingSellerId:existing.sellerId, existingSellerName:existing.sellerName, existingShop:existing.shopName,
       loginSellerId:sellerId, loginSellerName:seller.name, loginShop:shopName});
  }
  try{
    db.collection('iz_shifts').where('status','==','open')
      .get().then(function(snap){
        var sameSellerShift=null, otherSellerShift=null;
        snap.forEach(function(doc){
          var d=doc.data();
          if(d.shopName!==shopName) return;
          if(d.isRestoreShift || d.source==='psj' || d.backfilled) return;
          if(d.sellerName===seller.name) sameSellerShift=d;
          else if(!otherSellerShift) otherSellerShift=d;
        });
        if(sameSellerShift && !sameSellerShift.isRestoreShift && !sameSellerShift.backfilled){
          var todayStr0 = new Date().toISOString().split('T')[0];
          var shiftDate0 = sameSellerShift.date || (sameSellerShift.openedAt||'').split('T')[0] || '';
          if(shiftDate0 && shiftDate0 < todayStr0){
            db.collection('iz_shifts').doc(sameSellerShift.id).set({status:'closed',_autoFixedStale:true,closedAt: sameSellerShift.closedAt || new Date().toISOString()},{merge:true}).then(function(){
              doLogin();
            }).catch(function(){ doLogin(); });
            try{
              db.collection('iz_audit_log').add({
                id: uid(), timestamp: new Date().toISOString(), user: seller.name, shopName: shopName,
                shiftId: sameSellerShift.id, action: 'STALE_OPEN_SHIFT_AUTOFIXED',
                details: {shopName: shopName, date: shiftDate0}
              });
            }catch(e){}
            showToast('⚠️ Найдена зависшая смена за '+shiftDate0+' — статус исправлен, открываем сегодняшнюю');
            _shiftForceClosedRemotely = false;
            return;
          }
          _shiftForceClosedRemotely = false;
          session = {shopName:sameSellerShift.shopName, sellerName:sameSellerShift.sellerName, sellerId:sellerId,
            shiftId:sameSellerShift.id, openedAt:sameSellerShift.openedAt,
            cashMorning:sameSellerShift.cashMorning, goodsMorning:sameSellerShift.goodsMorning,
            cashDrMorning:sameSellerShift.cashDrMorning, goodsDrMorning:sameSellerShift.goodsDrMorning,
            cashStaffMorning:sameSellerShift.cashStaffMorning, shopType:'shop'};
          journal = sameSellerShift.journal||[];
          saveS(); saveJ();
          startApp();
          syncLiveShift();
          showToast('📂 Восстановлена незакрытая смена (из облака)');
          return;
        }
        var shopTypeNow = getShopType(shopName);
        if(otherSellerShift && shopTypeNow!=='online'){
          var todayStr = new Date().toISOString().split('T')[0];
          var otherDate = (otherSellerShift.date || (otherSellerShift.openedAt||'').split('T')[0] || '');
          var isStaleShift = otherDate && otherDate < todayStr;
          if(isStaleShift){
            try{
              saveAdminAlert({type:'stale_shift_warning', shopName:shopName,
                blockedSellerName:seller.name, activeSellerName:otherSellerShift.sellerName,
                staleDate:otherDate, date:todayStr,
                note:'Смена от '+otherDate+' висит открытой в Firestore — возможно не успела сохраниться при закрытии'});
            }catch(e){}
            showToast('⚠️ Завишшая смена '+otherSellerShift.sellerName+' за '+otherDate+' — админ уведомлён');
          } else {
            err.style.display='block';
            err.textContent='⛔ Смена для «'+shopName+'» уже открыта продавцом '+(otherSellerShift.sellerName||'—')+'. Одновременно вести смену в одном магазине может только один человек.';
            try{
              saveAdminAlert({type:'shift_conflict', shopName:shopName,
                blockedSellerName:seller.name, activeSellerName:otherSellerShift.sellerName,
                date:todayStr});
            }catch(e){}
            return;
          }
        }
        pendingSession={shopName,sellerName:seller.name,sellerId};
        openMorningModal();
      }).catch(function(){
        pendingSession={shopName,sellerName:seller.name,sellerId};
        openMorningModal();
      });
  }catch(e){
    pendingSession={shopName,sellerName:seller.name,sellerId};
    openMorningModal();
  }
}
function doSellerRestoreLogin(){
  const sellerId=gv('loginSeller'), pass=gv('loginPass');
  const err=document.getElementById('loginErr');
  err.style.display='none';
  const seller=getSellers().find(s=>s.id===sellerId);
  if(!seller){ err.style.display='block'; err.textContent='Продавец не найден'; return; }
  if(seller.blocked){ err.style.display='block'; err.textContent='Аккаунт заблокирован'; return; }
  if(seller.pass!==pass){ err.style.display='block'; err.textContent='Неверный пароль'; return; }
  session = {id:seller.id, name:seller.name, role:'shopadmin', shopName:'Все магазины',
    sellerRestoreMode:true, restrictedSellerId:seller.id, restrictedSellerName:seller.name,
    restrictedShops:(seller.shops&&seller.shops.length)?seller.shops:null};
  startSellerRestoreApp();
}
function buildSellerRestoreTabs(){
  const t=document.getElementById('mainTabs'); t.style.display='flex';
  t.innerHTML=
    '<button class="tab active"><div class="ti">🗄</div><span>Восст. смены</span></button>'+
    '<button class="tab" onclick="exitSellerRestore()"><div class="ti">🚪</div><span>Выйти</span></button>';
}
function startSellerRestoreApp(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('appScreen').style.display='block';
  document.getElementById('hdrShop').textContent='📝 Восстановление смены';
  document.getElementById('hdrSeller').textContent=session.restrictedSellerName||session.name;
  buildSellerRestoreTabs();
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  var rPg = document.getElementById('pg-restore');
  if(rPg) rPg.classList.add('active');
  initRestore();
}
function exitSellerRestore(){
  if(_restoreShift && _restoreShift.shop && _restoreShift.date){
    if(!confirm('Выйти? Незакрытая смена восстановления останется сохранённой — вернётесь к ней этой же кнопкой.')) return;
  } else if(!confirm('Выйти из восстановления смены?')) return;
  session=null;
  document.getElementById('mainTabs').style.display='none';
  document.getElementById('appScreen').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
  pick('seller');
}
function startPreviewMode(){
  var selEl = document.getElementById('loginSeller');
  var pass = (document.getElementById('loginPass')||{}).value||'';
  var admins = JSON.parse(localStorage.getItem('iz_shop_admins')||'[]');
  var admin = admins.find(function(a){ return a.id===(selEl&&selEl.value); }) || admins[0];
  if(!admin || admin.pass !== pass){
    var err = document.getElementById('loginErr');
    if(err){ err.style.display='block'; err.textContent='Неверный пароль'; }
    return;
  }
  var shops = getShops();
  var shopOptions = shops.map(function(s,i){ return i+': '+(s.name||s)+' ('+(s.type||'shop')+')'; }).join('\n');
  var choice = prompt('Выберите точку продаж для просмотра (введите номер):\n\n'+shopOptions);
  var idx = parseInt(choice);
  var chosenShop = (choice !== null && !isNaN(idx) && shops[idx]) ? shops[idx] : (shops[0]||{name:'Тест',type:'shop'});
  var shopName = chosenShop.name || chosenShop;
  var shopType = chosenShop.type || getShopType(shopName) || 'shop';
  session = {
    shopName: shopName,
    sellerName: '🔍 ' + admin.name + ' (просмотр)',
    sellerId: 'preview',
    openedAt: new Date().toISOString(),
    cashMorning: shopType==='shop' ? 13600 : 0,
    goodsMorning: 1391857,
    cashDrMorning: 0,
    goodsDrMorning: 59860,
    shopType: shopType,
    isPreview: true
  };
  journal = [{
    id:uid(), type:'open', ts:_workingNowISO(),
    icon:'🔍', label:'Режим просмотра — данные не сохраняются',
    sub:'🏪 '+shopName+' · тип: '+shopType,
    cashEffect:0, cardEffect:0, staffEffect:0, goodsEffect:0
  }];
  saveS(); saveJ();
  startApp();
  setTimeout(function(){
    var hdr = document.getElementById('hdrSeller');
    if(hdr) hdr.style.color = '#a060f0';
  }, 100);
}
function startApp(){
  try{ _reportAppVersion(); }catch(e){}
  setTimeout(_updateDraftBadges, 500);
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('appScreen').style.display='block';
  if(!restoreMode) syncRestoreUIChrome();
  if(!session.isPreview){ migrateLegacyReceiveEntries(); migrateLegacyDrExpenses(); migrateGoodsRefbooks(); }
  try{ var tr=getTrash(), prTr=purgeExpiredTrash(tr); if(prTr.length!==tr.length){ saveTrash(prTr); syncTrashToCloud(prTr); } }catch(e){}
  document.getElementById('hdrShop').textContent=(session.isPreview?'🔍 ':'')+session.shopName;
  if(session.isPreview){
    var hdrEl=document.getElementById('hdrShop');
    if(hdrEl) hdrEl.style.color='#a060f0';
  }
  document.getElementById('hdrSeller').textContent=session.sellerName;
  buildSellerTabs();
  adaptUIForShopType();
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  var jp = document.getElementById('pg-home');
  if(jp) jp.classList.add('active');
  var firstTab = document.querySelector('#mainTabs .tab');
  if(firstTab) firstTab.classList.add('active');
  setTimeout(function(){ renderClose(); }, 100);
  startInvoiceLiveSync();
  document.getElementById('rcvDate').value=new Date().toISOString().split('T')[0];
  if(!session.isPreview) startLiveShiftListener();
  renderAll();
  try{ startStockSync(); }catch(e){}
  setTimeout(function(){ try{ rebuildStock(false); }catch(e){}; },2000);
}
function adaptUIForShopType(){
  var shopType = session.shopType || getShopType(session.shopName);
  var isShop = shopType === 'shop';
  var isOnline = shopType === 'online';
  var isOffline = shopType === 'offline';
  var shopEl = document.getElementById('hdrShop');
  if(shopEl){
    var icon = isShop?'🏪':isOnline?'📱':'🏭';
    shopEl.textContent = icon + ' ' + session.shopName;
  }
  if(shopType === 'offline'){
    var t=document.getElementById('mainTabs');
    if(t) t.innerHTML=`
      <button class="tab active" onclick="showPg('invoices',this);switchRcvMainTab('intake');switchInvTab('incoming')"><div class="ti">📋</div><span>Накладные</span><div class="tbadge" id="invBadge"></div></button>
      <button class="tab" onclick="exitShift()"><div class="ti">🚪</div><span>Выйти</span></button>`;
    document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
    var invPage = document.getElementById('pg-invoices');
    if(invPage) invPage.classList.add('active');
    var invTitle = (invPage&&invPage.querySelector)('.stitle');
    if(invTitle) invTitle.textContent = 'Исходящие накладные · '+session.shopName;
    renderInvoices();
    return; // skip rest of adaptUIForShopType
  }
  if(shopType !== 'shop'){
    if(shopType==='online'){
      document.querySelectorAll('#mainTabs .tab').forEach(function(b){
        var txt = b.textContent;
        if(txt.indexOf('Списание')>=0 || txt.indexOf('Приход')>=0) b.style.display='none';
      });
      var expBtn = document.getElementById('btnExpense');
      if(expBtn) expBtn.style.display='none';
    }
  }
  var optHide = ['clExp_arrow','clWo_arrow','clRcv_arrow','clStaff_arrow'];
  optHide.forEach(function(id){
    var el=document.getElementById(id);
    if(el){
      var block=el.closest('div[style*="border-radius:10px"]');
      if(block) block.style.display = 'block';
    }
  });
  var drAcc=document.getElementById('acc_close_dr');
  if(drAcc) drAcc.style.display = 'block';
  var rsChipEl = document.getElementById('pcRS');
  if(rsChipEl) rsChipEl.style.display = isShop ? 'none' : '';
  if(!isShop){
    var saleMo = document.getElementById('saleMo');
    if(saleMo && !document.getElementById('goodsSourceBlock')){
      var sourceBlock = document.createElement('div');
      sourceBlock.id = 'goodsSourceBlock';
      sourceBlock.className = 'fg';
      var shopNames = getShopNames().filter(function(s){ var t=getShopType(s); return t==='shop'||t==='offline'||t==='workshop'; });
      sourceBlock.innerHTML = '<label class="fl">Откуда списать товар</label>'+
        '<select class="fs" id="goodsSource">'+
        shopNames.map(function(s){ return '<option>'+s+'</option>'; }).join('')+
        '</select>'+
        '<div style="font-size:11px;color:#8888aa;margin-top:4px">Магазину придёт уведомление убрать товар с прилавка</div>';
      var payBlock = saleMo.querySelector('.pay-chips');
      var payContainer = payBlock ? (payBlock.closest('.fg') || payBlock.parentElement) : null;
      if(payContainer) saleMo.querySelector('.md').insertBefore(sourceBlock, payContainer);
    }
    var onlineBlock = document.getElementById('onlineOrderBlock');
    if(onlineBlock) onlineBlock.style.display = isOnline ? 'block' : 'none';
  }
}
function setOrderChannel(ch){
  _orderChannel = ch;
  var tgBtn=document.getElementById('chOrderTg'), instaBtn=document.getElementById('chOrderInsta');
  var onStyle='flex:1;padding:8px;border-radius:9px;border:2px solid #60c8f0;background:#0c1a20;color:#60c8f0;font-size:12px;font-weight:700;cursor:pointer';
  var offStyle='flex:1;padding:8px;border-radius:9px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:600;cursor:pointer';
  if(tgBtn) tgBtn.style.cssText = ch==='ТГ канал' ? onStyle : offStyle;
  if(instaBtn) instaBtn.style.cssText = ch==='Instagram' ? onStyle : offStyle;
}
function toggleOrdererPhone(checked){
  var block = document.getElementById('ordOrdererPhoneBlock');
  if(block) block.style.display = checked ? 'block' : 'none';
}
function buildSellerTabs(){
  const t=document.getElementById('mainTabs'); t.style.display='flex';
  t.innerHTML=`
    <button class="tab active" onclick="showPg('home',this);renderStatusBar()"><div class="ti">🏠</div><span>Главная</span></button>
    <button class="tab" onclick="showPg('journal',this)"><div class="ti">📋</div><span>Журнал</span></button>
    <button class="tab" onclick="showPg('invoices',this);switchRcvMainTab('intake');switchInvTab('incoming');_updateManInvJsonBlock();_updateDraftBadges()"><div class="ti">📥</div><span>Приход</span><div class="tbadge" id="invBadge2"></div></button>
    <button class="tab" onclick="showPg('writeoffs',this);renderWriteoffs()"><div class="ti">🗑</div><span>Списание</span><div id="tabBadgeWo" class="tbadge" style="display:none">●</div></button>
    <button class="tab" onclick="showPg('staff-tab',this);renderStaff()"><div class="ti">🛒</div><span>Покупки</span></button>
    <button class="tab" onclick="showPg('close',this);renderClose()"><div class="ti">🔐</div><span>Закрыть</span></button>
    <button class="tab" onclick="showPg('personal',this);initPersonalTab()"><div class="ti">📈</div><span>Личное</span></button>
    <button class="tab" onclick="showPg('stock',this);initStockPage()"><div class="ti">📦</div><span>Склад</span></button>`;
}
var _personalTabInited = false;
function initPersonalTab(){
  if(!_personalTabInited){
    _personalTabInited = true;
    setPersonalPeriod('30', document.querySelector('#personalPeriodChips div'));
  } else {
    renderPersonalTab();
  }
}
function clearTestSession(){
  var openShifts = _adminActiveShifts.filter(function(s){ return s.status==='open'; });
  if(!openShifts.length){ showToast('Нет открытых смен для сброса'); return; }
  var labels = openShifts.map(function(s){ return s.shopName+' · '+(s.sellerName||'')+' ('+(s.id||'')+')'; }).join('\n');
  if(!confirm('Сбросить следующие открытые смены?\n\n'+labels+'\n\nЭто удалит их без сохранения данных.')) return;
  var ids = {};
  openShifts.forEach(function(s){
    addShiftTombstone(s.id);
    ids[s.id] = true;
    try{ db.collection('iz_shifts').doc(s.id).delete(); }catch(e){}
  });
  var local = getShifts();
  local = local.filter(function(s){ return !ids[s.id||s._id]; });
  saveShifts(local);
  showToast('🗑 Открытые смены сброшены');
}
function startInventoryApp(){
  try{ _reportAppVersion(); }catch(e){}
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('appScreen').style.display='block';
  document.getElementById('mainTabs').style.display='none';
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.getElementById('hdrShop').textContent='📋 '+session.shopName;
  document.getElementById('hdrSeller').textContent=session.name;
  var home = document.getElementById('pg-inventory-home');
  if(home) home.classList.add('active');
  try{ if(typeof loadInvHomeActive==='function') loadInvHomeActive(); }catch(e){}
}
function startAdminApp(){
  try{ _reportAppVersion(); }catch(e){}
  try{ if(typeof _hideLiveSyncFailBanner==='function') _hideLiveSyncFailBanner(); }catch(e){}
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('appScreen').style.display='block';
  document.getElementById('hdrShop').textContent='🔐 Администратор';
  document.getElementById('hdrSeller').textContent=session.name;
  buildAdminTabs();
  const shops=getShopNames();
  ['psShop'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    el.innerHTML=shops.map(s=>`<option>${s}</option>`).join('');
  });
  document.getElementById('psDate').value=new Date().toISOString().split('T')[0];
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  var todayPg = document.getElementById('pg-today');
  if(todayPg) todayPg.classList.add('active');
  renderShiftHistory(); renderSellersAdmin();
  _autoRepairStaffRoles(); // Исправляем записи без ролей при каждом входе
  startAdminShiftListener();
  startAdminAlertsListener();
  startAdminAuditListener();
  renderTodayShift();
  if(!_firebaseReady){
    var _adminRetryCount = 0;
    var _adminRetryTimer = setInterval(function(){
      _adminRetryCount++;
      if(_firebaseReady || _adminRetryCount > 30){
        clearInterval(_adminRetryTimer);
        if(_firebaseReady){
          startAdminShiftListener();
          startAdminAlertsListener();
          startAdminAuditListener();
          renderTodayShift();
        }
      }
    }, 500); // проверяем каждые 500мс до 15 секунд
  }
  migrateOrphanItemNamesToGoods();
}
function buildAdminTabs(){
  const t=document.getElementById('mainTabs'); t.style.display='flex';
  t.innerHTML=`
    <button class="tab active" onclick="showPg('today',this);renderTodayShift()"><div class="ti">📋</div><span>Смена</span></button>
    <button class="tab" onclick="showPg('alerts',this);renderAlertsPage()"><div class="ti">🚨</div><span>Тревога</span><div class="tbadge" id="alertsBadge"></div></button>
    <button class="tab" onclick="_histShowOpen=false;showPg('history',this);renderShiftHistory()"><div class="ti">📁</div><span>Архив</span></button>
    <button class="tab" onclick="showPg('stock',this);initStockPage()"><div class="ti">📦</div><span>Склад</span></button>
    <button class="tab" onclick="showPg('admin-rcv-wo',this);initAdminRcvWo()"><div class="ti">📥</div><span>Приходы</span></button>
    <button class="tab" onclick="showPg('seller-stats',this);renderSellerStats()"><div class="ti">📊</div><span>Продавцы</span></button>
    <button class="tab" onclick="openProfitabilityReport()"><div class="ti">📈</div><span>Рентабельность</span></button>
    <button class="tab" onclick="showPg('sellers',this);renderSellersAdmin()"><div class="ti">👥</div><span>Роли</span></button>
    <button class="tab" onclick="showPg('trash',this);renderTrash()"><div class="ti">🗑</div><span>Корзина</span></button>
    <button class="tab" onclick="showPg('audit',this)"><div class="ti">🕵️</div><span>Аудит</span></button>
    <button class="tab" onclick="showPg('shopsettings',this);renderShopSettings()"><div class="ti">⚙️</div><span>Настройки</span></button>`;
}
function migrateGoodsRefbooks(){
  if(localStorage.getItem('iz_goods_migrated_v1')) return;
  var old = getRefBook('iz_goods');
  if(!old.length){ localStorage.setItem('iz_goods_migrated_v1','1'); return; }
  var existing = getRefBook('iz_goods_derevo');
  var existingNames = {};
  existing.forEach(function(g){ existingNames[(g.name||g)]=true; });
  var toAdd = old.filter(function(g){ return !existingNames[(g.name||g)]; });
  if(toAdd.length){
    var merged = existing.concat(toAdd);
    saveRefBookShop('iz_goods_derevo', merged);
  }
  localStorage.setItem('iz_goods_migrated_v1','1');
}
function renderLoginShopSelect(){
  const shopNames=getShopNames();
  const shopSel=document.getElementById('loginShop');
  if(!shopSel) return;
  const prevSelected = shopSel.value;
  shopSel.innerHTML=shopNames.map(s=>`<option>${s}</option>`).join('');
  if(prevSelected && shopNames.indexOf(prevSelected)>=0){ shopSel.value = prevSelected; }
  try{ onLoginShopChange(); }catch(e){}
}
function onLoginShopChange(){
  if(loginRole==='inventory'){ renderLoginInventoryStaff(); }
  else if(loginRole!=='shopadmin'){ renderLoginSellers(); }
}
function _staffSyncUpdateCb(){
  try{pick(loginRole);}catch(e){}
  try{ if(document.getElementById('sellersAdminList')) renderSellersAdmin(); }catch(e){}
}
function init(){
  try{ if(typeof _hydrateExtraArchiveShiftsFromIdb==='function') _hydrateExtraArchiveShiftsFromIdb(); }catch(e){}
  startSyncListeners();
  try{ startStockSync(); }catch(e){}
  startStaffLiveSync(_staffSyncUpdateCb);
  renderLoginShopSelect();
  var admins=JSON.parse(localStorage.getItem('iz_shop_admins')||'[]');
  if(!admins.length){ admins=[{id:'admin_default',name:'Администратор',pass:'admin123'}]; localStorage.setItem('iz_shop_admins', JSON.stringify(admins)); }
  pick('seller');
  const saved=JSON.parse(localStorage.getItem(KEY.session)||'null');
  if(saved){ session=saved; if(session.role==='shopadmin' && !session.sellerRestoreMode)startAdminApp(); else if(session.role==='inventory'){ startInventoryApp(); } else if(session.sellerRestoreMode){ startSellerRestoreApp(); } else { journal=loadAndCleanJournal(); startApp(); syncLiveShift(); } }
}
