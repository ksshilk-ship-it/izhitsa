function getShopZpSettings(){
  return JSON.parse(localStorage.getItem('iz_shop_zp_settings')||'{}');
}
function getShopRentSettings(){
  return JSON.parse(localStorage.getItem('iz_shop_rent')||'{}');
}
function rentDailyRate(rentCfg){
  if(!rentCfg || !rentCfg.amount) return 0;
  return rentCfg.mode==='month' ? (rentCfg.amount/30) : rentCfg.amount;
}
var _rentEditState = {}; // {shop: {mode, amount, workedDaysOnly, overrides:{'YYYY-MM':amount}}}
var RENT_MONTH_NAMES = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function renderRentSettings(){
  var c = document.getElementById('rentSettingsList'); if(!c) return;
  var shops = getShopNames();
  var settings = getShopRentSettings();
  updateSettingsSectionCount('rent', shops.length);
  if(!shops.length){ c.innerHTML='<div style="font-size:12px;color:#8888aa;padding:8px">Сначала добавьте магазины в разделе выше</div>'; return; }
  shops.forEach(function(shop){
    if(!_rentEditState[shop]){
      var r = settings[shop] || {mode:'month', amount:0, workedDaysOnly:false, overrides:{}};
      _rentEditState[shop] = {mode:r.mode||'month', amount:r.amount||0, workedDaysOnly:!!r.workedDaysOnly, overrides:Object.assign({},r.overrides||{})};
    }
  });
  c.innerHTML = shops.map(function(shop){ return _renderRentShopCard(shop); }).join('');
}
function _renderRentShopCard(shop){
  var sid = encodeURIComponent(shop).replace(/%/g,'_');
  var r = _rentEditState[shop];
  var isMonth = r.mode!=='day';
  var overrideKeys = Object.keys(r.overrides).sort();
  var overridesHtml = overrideKeys.length ? overrideKeys.map(function(k){
    var parts = k.split('-'), mLabel = RENT_MONTH_NAMES[parseInt(parts[1])-1]+' '+parts[0];
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #2e2e3e;font-size:12px">'+
      '<span>'+mLabel+': <b style="color:#c8f060">'+fmt(r.overrides[k])+'</b></span>'+
      '<button type="button" onclick="removeRentOverride(\''+shop.replace(/'/g,"\\'")+'\',\''+k+'\')" style="background:none;border:1px solid #f06060;border-radius:6px;padding:3px 8px;color:#f06060;font-size:11px;cursor:pointer">✕</button>'+
    '</div>';
  }).join('') : '<div style="font-size:11px;color:#555568;padding:4px 0">Помесячных сумм пока нет — используется базовая ставка ниже</div>';
  var now = new Date();
  var monthOpts = RENT_MONTH_NAMES.map(function(n,i){return {i:i,n:n};});
  return '<div style="border:1px solid #2e2e3e;border-radius:12px;margin-bottom:8px;padding:12px">'+
    '<div style="font-size:13px;font-weight:700;margin-bottom:8px">🏪 '+shop+'</div>'+
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'+
      '<input type="checkbox" id="rent_worked_'+sid+'" '+(r.workedDaysOnly?'checked':'')+' onchange="setRentWorkedDaysOnly(\''+shop.replace(/'/g,"\\'")+'\',this.checked)" style="width:18px;height:18px;cursor:pointer">'+
      '<label for="rent_worked_'+sid+'" style="font-size:12px;color:#8888aa;cursor:pointer">Платим только за фактически отработанные дни (не за все дни месяца)</label>'+
    '</div>'+
    '<div style="font-size:11px;color:#8888aa;margin-bottom:4px">Базовая ставка (для месяцев без своей суммы ниже)</div>'+
    '<div style="display:flex;gap:8px;margin-bottom:8px">'+
      '<button type="button" id="rent_mode_month_'+sid+'" onclick="setRentMode(\''+sid+'\',\'month\')" style="flex:1;padding:7px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;border:'+(isMonth?'2px solid #c8f060':'1px solid #2e2e3e')+';background:'+(isMonth?'#1e2a14':'#22222e')+';color:'+(isMonth?'#c8f060':'#8888aa')+'">в месяц</button>'+
      '<button type="button" id="rent_mode_day_'+sid+'" onclick="setRentMode(\''+sid+'\',\'day\')" style="flex:1;padding:7px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;border:'+(!isMonth?'2px solid #c8f060':'1px solid #2e2e3e')+';background:'+(!isMonth?'#1e2a14':'#22222e')+';color:'+(!isMonth?'#c8f060':'#8888aa')+'">в день</button>'+
    '</div>'+
    '<div class="fg" style="margin-bottom:0"><label class="fl">Сумма (₽)</label>'+
      '<input class="fi" type="text" id="rent_amt_'+sid+'" data-mode="'+(isMonth?'month':'day')+'" value="'+(r.amount||'')+'" inputmode="numeric" placeholder="0" oninput="setRentAmount(\''+shop.replace(/'/g,"\\'")+'\',this.value)"></div>'+
    '<div style="font-size:10px;color:#8888aa;margin:4px 0 12px">≈ '+fmt(rentDailyRate(r))+' в день</div>'+
    '<div style="border-top:1px solid #2e2e3e;padding-top:10px">'+
      '<div style="font-size:11px;color:#8888aa;margin-bottom:6px">Своя сумма аренды за конкретный месяц (перекрывает базовую ставку)</div>'+
      overridesHtml+
      '<div style="display:flex;gap:6px;margin-top:8px">'+
        '<select class="fs" id="rent_ovr_month_'+sid+'" style="flex:1;padding:7px;font-size:11px">'+monthOpts.map(function(o){return '<option value="'+o.i+'"'+(o.i===now.getMonth()?' selected':'')+'>'+o.n.charAt(0).toUpperCase()+o.n.slice(1)+'</option>';}).join('')+'</select>'+
        '<select class="fs" id="rent_ovr_year_'+sid+'" style="flex:0 0 80px;padding:7px;font-size:11px">'+[now.getFullYear(),now.getFullYear()+1,now.getFullYear()-1].sort().map(function(y){return '<option value="'+y+'"'+(y===now.getFullYear()?' selected':'')+'>'+y+'</option>';}).join('')+'</select>'+
      '</div>'+
      '<div style="display:flex;gap:6px;margin-top:6px">'+
        '<input class="fi" type="text" id="rent_ovr_amt_'+sid+'" inputmode="numeric" placeholder="Сумма за этот месяц" style="flex:1;padding:7px;font-size:11px;margin:0">'+
        '<button type="button" onclick="addRentOverride(\''+shop.replace(/'/g,"\\'")+'\',\''+sid+'\')" style="flex-shrink:0;padding:7px 14px;background:#1e2a14;border:1px solid #c8f060;border-radius:8px;color:#c8f060;font-size:11px;font-weight:700;cursor:pointer">+ Добавить</button>'+
      '</div>'+
    '</div>'+
  '</div>';
}
function setRentMode(shop, mode){
  if(!_rentEditState[shop]) return;
  _rentEditState[shop].mode = mode;
  _rerenderRentShop(shop);
}
function setRentAmount(shop, val){
  if(!_rentEditState[shop]) return;
  _rentEditState[shop].amount = parseFloat(val)||0;
}
function setRentWorkedDaysOnly(shop, checked){
  if(!_rentEditState[shop]) return;
  _rentEditState[shop].workedDaysOnly = checked;
}
function addRentOverride(shop, sid){
  if(!_rentEditState[shop]) return;
  var mIdx = parseInt((document.getElementById('rent_ovr_month_'+sid)||{}).value)||0;
  var year = parseInt((document.getElementById('rent_ovr_year_'+sid)||{}).value)||new Date().getFullYear();
  var amt = parseFloat((document.getElementById('rent_ovr_amt_'+sid)||{}).value)||0;
  if(!amt){ showToast('Укажите сумму'); return; }
  var key = year+'-'+String(mIdx+1).padStart(2,'0');
  _rentEditState[shop].overrides[key] = amt;
  _rerenderRentShop(shop);
}
function removeRentOverride(shop, key){
  if(!_rentEditState[shop]) return;
  delete _rentEditState[shop].overrides[key];
  _rerenderRentShop(shop);
}
function _rerenderRentShop(shop){
  var shops = getShopNames();
  var idx = shops.indexOf(shop);
  var cards = document.querySelectorAll('#rentSettingsList > div');
  if(cards[idx]) cards[idx].outerHTML = _renderRentShopCard(shop);
}
function saveRentSettings(){
  var shops = getShopNames();
  var settings = {};
  shops.forEach(function(shop){
    if(_rentEditState[shop]) settings[shop] = _rentEditState[shop];
  });
  localStorage.setItem('iz_shop_rent', JSON.stringify(settings));
  syncSave('iz_shop_rent', settings);
  showToast('✅ Аренда сохранена');
}
function numDef(val, def){
  return (val===undefined || val===null || val==='' || isNaN(val)) ? def : val;
}
function saveShopZpSettingsData(d){
  syncSave('iz_shop_zp_settings', d);
}
function renderShopsManage(){
  var c=document.getElementById('shopsManageList'); if(!c) return;
  var shops=getShops();
  updateSettingsSectionCount('shops', shops.length);
  if(!shops.length){ c.innerHTML='<div style="font-size:12px;color:#8888aa;padding:4px">Нет магазинов — добавьте ниже</div>'; return; }
  c.innerHTML=shops.map(function(s,i){
    var typeLabel={shop:'Магазин',online:'Онлайн',offline:'Офлайн/Опт'}[s.type]||s.type||'';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px;background:#1a1a22;border:1px solid #2e2e3e;border-radius:10px;margin-bottom:6px">'+
      '<div><div class="u-fs13-bold">🏪 '+(s.name||s)+'</div>'+
      '<div class="u-fs11-gray">'+typeLabel+'</div></div>'+
      '<div class="u-flex-g6">'+
        '<button onclick="renameShopAdmin('+i+')" style="background:none;border:1px solid #c8f060;border-radius:8px;padding:4px 8px;font-size:11px;color:#c8f060;cursor:pointer">✏️</button>'+
        '<button onclick="deleteShopAdmin('+i+')" style="background:none;border:1px solid #2e2e3e;border-radius:8px;padding:4px 8px;font-size:11px;color:#f06060;cursor:pointer">✕</button>'+
      '</div>'+
    '</div>';
  }).join('');
}
function addShopAdmin(){
  var name=((document.getElementById('newShopName')||{}).value||'').trim();
  var type=(document.getElementById('newShopType')||{}).value||'shop';
  if(!name){showToast('Введите название магазина');return;}
  var shops=getShops();
  if(shops.some(function(s){return (s.name||s)===name;})){showToast('Такой магазин уже есть');return;}
  shops.push({id:uid(), name:name, type:type, createdAt:new Date().toISOString()});
  saveShops(shops);
  document.getElementById('newShopName').value='';
  renderShopsManage(); renderShopSettings();
  showToast('✅ Магазин добавлен');
}
function deleteShopAdmin(idx){
  if(!confirm('Удалить магазин?')) return;
  var shops=getShops(); shops.splice(idx,1);
  saveShops(shops);
  renderShopsManage(); renderShopSettings();
  showToast('🗑 Магазин удалён');
}
function renameShopAdmin(idx){
  var shops=getShops();
  var shop=shops[idx]; if(!shop) return;
  var oldName=shop.name||shop;
  var newName=prompt('Новое название магазина «'+oldName+'»:', oldName);
  if(newName==null) return;
  newName=newName.trim();
  if(!newName || newName===oldName) return;
  if(shops.some(function(s,i){ return i!==idx && (s.name||s)===newName; })){ showToast('Магазин с таким названием уже есть'); return; }
  if(!confirm('Переименовать «'+oldName+'» → «'+newName+'»?\n\nЭто обновит название во всех уже закрытых сменах, корзине, тревогах, настройках ЗП и привязках сотрудников.')) return;
  shops[idx] = Object.assign({}, shop, {name:newName});
  saveShops(shops);
  var renamed = 0;
  try{
    var shifts = getShifts();
    shifts.forEach(function(s){ if(s.shopName===oldName){ s.shopName=newName; renamed++; } });
    saveShifts(shifts);
    shifts.forEach(function(s){ if(s.shopName===newName){ try{ db.collection('iz_shifts').doc(s.id).set(s); }catch(e){} } });
  }catch(e){}
  try{
    var trash = getTrash();
    trash.forEach(function(t){ if(t.shopName===oldName) t.shopName=newName; });
    saveTrash(trash);
    syncTrashToCloud(trash);
  }catch(e){}
  try{
    var alerts = JSON.parse(localStorage.getItem('iz_admin_alerts')||'[]');
    var touchedAlerts = [];
    alerts.forEach(function(a){ if(a.shopName===oldName){ a.shopName=newName; touchedAlerts.push(a); } });
    localStorage.setItem('iz_admin_alerts', JSON.stringify(alerts));
    touchedAlerts.forEach(function(a){ if(a.id){ try{ db.collection('iz_admin_alerts').doc(a.id).set(a); }catch(e){} } });
  }catch(e){}
  try{
    var zpSettings = JSON.parse(localStorage.getItem('iz_shop_zp_settings')||'{}');
    if(zpSettings[oldName]!==undefined){ zpSettings[newName]=zpSettings[oldName]; delete zpSettings[oldName]; }
    localStorage.setItem('iz_shop_zp_settings', JSON.stringify(zpSettings));
  }catch(e){}
  try{
    var staff = getStaff();
    var staffChanged = false;
    staff.forEach(function(st){
      if(Array.isArray(st.shops)){
        var i2 = st.shops.indexOf(oldName);
        if(i2>=0){ st.shops[i2]=newName; staffChanged=true; }
      }
    });
    if(staffChanged) saveStaffShop(staff);
  }catch(e){}
  renderShopsManage(); renderShopSettings();
  showToast('✅ Переименовано: «'+oldName+'» → «'+newName+'» (затронуто записей: '+renamed+')');
}
function renderAccountsList(){
  var c=document.getElementById('accountsList'); if(!c) return;
  var accounts=sortByTypeThenName(JSON.parse(localStorage.getItem('iz_accounts')||'[]'), ACCOUNT_TYPE_ORDER);
  updateSettingsSectionCount('accounts', accounts.length);
  if(!accounts.length){c.innerHTML='<div style="font-size:12px;color:#8888aa;padding:4px">Нет реквизитов</div>';return;}
  c.innerHTML=accounts.map(function(a,i){
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px;background:#1a1a22;border:1px solid #2e2e3e;border-radius:10px;margin-bottom:6px">'+
      '<div><div class="u-fs13-bold">'+(a.type==='rs'?'🏦':'💳')+' '+a.name+'</div>'+
      '<div class="u-fs11-gray">'+(a.type==='rs'?'РС счёт':'Карта')+'</div></div>'+
      '<button onclick="deleteAccountAdmin('+i+')" style="background:none;border:1px solid #2e2e3e;border-radius:8px;padding:4px 8px;font-size:11px;color:#f06060;cursor:pointer">✕</button>'+
    '</div>';
  }).join('');
}
function addAccountAdmin(){
  var name=((document.getElementById('newAccName')||{}).value||'').trim();
  var type=(document.getElementById('newAccType')||{}).value||'card';
  if(!name){showToast('Введите название');return;}
  var accounts=JSON.parse(localStorage.getItem('iz_accounts')||'[]');
  accounts.push({name:name,type:type});
  syncSave('iz_accounts', sortByTypeThenName(accounts, ACCOUNT_TYPE_ORDER));
  document.getElementById('newAccName').value='';
  renderAccountsList(); showToast('✅ Реквизит добавлен');
}
function deleteAccountAdmin(idx){
  var accounts=JSON.parse(localStorage.getItem('iz_accounts')||'[]');
  var sorted=sortByTypeThenName(accounts, ACCOUNT_TYPE_ORDER);
  var target=sorted[idx];
  if(!target) return;
  var rawIdx=accounts.indexOf(target);
  if(rawIdx<0){
    rawIdx=accounts.findIndex(function(a){return a.name===target.name && a.type===target.type;});
  }
  if(rawIdx>=0) accounts.splice(rawIdx,1);
  syncSave('iz_accounts', sortByTypeThenName(accounts, ACCOUNT_TYPE_ORDER));
  renderAccountsList(); showToast('🗑 Реквизит удалён');
}
var SHOP_REFBOOKS = [
  {id:'payments',    icon:'💳', name:'Способы оплаты',          key:'iz_payment_methods'},
  {id:'suppliers',   icon:'🚚', name:'База поставщиков',         key:'iz_suppliers'},
  {id:'goods',       icon:'🌳', name:'База товаров — Дерево',    key:'iz_goods_derevo'},
  {id:'goods_dr',    icon:'🛍', name:'База товаров — ДР Товар',  key:'iz_goods_dr'},
  {id:'goods_all',   icon:'📇', name:'Общий индекс наименований', key:'iz_goods'},
  {id:'materials',   icon:'💎', name:'Породы дерева',            key:'iz_materials'},
  {id:'dr_species',  icon:'🍬', name:'Вкус / Состав (ДР Товар)', key:'iz_dr_species'},
  {id:'schedules',   icon:'⏰', name:'Графики работы',           key:'iz_work_schedules'}
];
function getRefBook(key){
  try{ return JSON.parse(localStorage.getItem(key)||'[]'); } catch(e){ return []; }
}
function saveRefBookShop(key, data){
  localStorage.setItem(key, JSON.stringify(data));
  syncSave(key, data);
  var book = SHOP_REFBOOKS.find(function(b){ return b.key===key; });
  if(book){
    try{ renderRefbookItemsShop(book.id, book.key); updateRefbookCountShop(book.id, book.key); }catch(e){}
  }
}
function renderRefbookSections(){
  var c = document.getElementById('refbookSections'); if(!c) return;
  c.innerHTML = SHOP_REFBOOKS.map(function(book){
    var items = getRefBook(book.key);
    return '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:10px;margin-bottom:8px;overflow:hidden">'+
      '<div onclick="toggleRefbookShop(\''+book.id+'\')" style="display:flex;align-items:center;justify-content:space-between;padding:11px;cursor:pointer">'+
        '<div style="display:flex;align-items:center;gap:9px">'+
          '<span style="font-size:18px">'+book.icon+'</span>'+
          '<div><div class="u-fs13-bold">'+book.name+'</div>'+
          '<div id="rbCount_'+book.id+'" class="u-fs11-gray">'+items.length+' записей</div></div>'+
        '</div>'+
        '<div id="rbArr_'+book.id+'" style="color:#c8f060">▶</div>'+
      '</div>'+
      '<div id="rbBody_'+book.id+'" style="display:none;padding:10px;border-top:1px solid #2e2e3e">'+
        '<div id="rbItems_'+book.id+'"></div>'+
        '<div style="display:flex;gap:8px;margin-top:8px">'+
          '<input class="fi" id="rbNew_'+book.id+'" placeholder="Новая запись" autocomplete="off" style="flex:1;margin:0">'+
          '<button onclick="addRefbookItemShop(\''+book.id+'\',\''+book.key+'\')" style="flex-shrink:0;padding:0 16px;background:#c8f060;border:none;border-radius:8px;color:#0f0f13;font-weight:700;font-size:16px;cursor:pointer">＋</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }).join('');
  SHOP_REFBOOKS.forEach(function(book){ renderRefbookItemsShop(book.id, book.key); });
}
function toggleRefbookShop(id){
  var body=document.getElementById('rbBody_'+id), arr=document.getElementById('rbArr_'+id);
  if(!body) return;
  var open = body.style.display!=='none';
  body.style.display = open?'none':'block';
  if(arr) arr.style.transform = open?'':'rotate(90deg)';
}
var _nfAutoSyncedOnce = false;
function toggleSettingsSection(id){
  var body=document.getElementById('ssBody_'+id), arr=document.getElementById('ssArr_'+id);
  if(!body) return;
  var open = body.style.display!=='none';
  body.style.display = open?'none':'block';
  if(arr) arr.style.transform = open?'':'rotate(90deg)';
  if(id==='namefix' && !open && !_nfAutoSyncedOnce){
    _nfAutoSyncedOnce = true;
    try{ nfSyncFromServer(); }catch(e){}
  }
}
function updateSettingsSectionCount(id, count){
  var el=document.getElementById('ssCount_'+id);
  if(el) el.textContent = count+' записей';
}
function renderRefbookItemsShop(bookId, key){
  var c = document.getElementById('rbItems_'+bookId); if(!c) return;
  var items = getRefBook(key);
  if(!items.length){ c.innerHTML='<div style="font-size:11px;color:#555568;padding:6px 0">Нет записей</div>'; return; }
  var sorted = items.slice().sort(function(a,b){
    var na=(a.name||a).toLowerCase(), nb=(b.name||b).toLowerCase();
    return na.localeCompare(nb,'ru');
  });
  c.innerHTML = sorted.map(function(item, sortedIdx){
    var name = item.name||item;
    var realIdx = items.indexOf(item);
    if(realIdx<0) realIdx = items.findIndex(function(it){ return (it.name||it)===(item.name||item); });
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:#13131a;border-radius:8px;margin-bottom:6px">'+
      '<div style="font-size:12px">'+name+'</div>'+
      '<button onclick="deleteRefbookItemShop(\''+bookId+'\','+realIdx+',\''+key+'\')" style="background:none;border:none;color:#f06060;font-size:14px;cursor:pointer;padding:4px">✕</button>'+
    '</div>';
  }).join('');
}
function _clearRefbookTombstone(key, name){
  var norm = (name||'').toLowerCase().trim();
  if(!norm) return;
  var tombKey = key+'_deleted';
  var tombs = JSON.parse(localStorage.getItem(tombKey)||'[]');
  var idx = tombs.indexOf(norm);
  if(idx<0) return;
  tombs.splice(idx,1);
  localStorage.setItem(tombKey, JSON.stringify(tombs));
  var tombDocKey = key==='iz_goods_derevo'?'goods_derevo_deleted':(key==='iz_goods_dr'?'goods_dr_deleted':'refbook_deleted_'+key);
  try{ db.collection('iz_settings').doc(tombDocKey).set({deleted:tombs,updatedAt:new Date().toISOString()},{merge:true}); }catch(e){}
}
function addRefbookItemShop(bookId, key){
  var input = document.getElementById('rbNew_'+bookId);
  var value = (input.value||'').trim();
  if(!value){ showToast('Введите значение'); return; }
  var existing = getRefBook(key);
  var norm = value.toLowerCase().trim();
  var exact = existing.find(function(c){ return (c.name||c).toLowerCase().trim()===norm; });
  if(exact){ showToast('Уже есть: «'+(exact.name||exact)+'»'); input.value=''; return; }
  var closeMatch=null, bestScore=0;
  existing.forEach(function(c){
    var sc=nameSimilarity(norm,(c.name||c).toLowerCase().trim());
    if(sc>bestScore){ bestScore=sc; closeMatch=c; }
  });
  if(bestScore>=0.65 && closeMatch){
    showDupWarning(value, closeMatch.name||closeMatch, function(useExisting){
      if(!useExisting){
        var items2=getRefBook(key);
        items2.push({id:uid(),name:value});
        items2.sort(function(a,b){return (a.name||a).toLowerCase().localeCompare((b.name||b).toLowerCase(),'ru');});
        saveRefBookShop(key,items2);
        _clearRefbookTombstone(key,value);
        renderRefbookItemsShop(bookId,key);
        updateRefbookCountShop(bookId,key);
        showToast('✅ Сохранено');
      }
      input.value='';
    });
    return;
  }
  var items = getRefBook(key);
  items.push({id:uid(), name:value});
  items.sort(function(a,b){ return (a.name||a).toLowerCase().localeCompare((b.name||b).toLowerCase(),'ru'); });
  saveRefBookShop(key, items);
  _clearRefbookTombstone(key, value);
  input.value='';
  renderRefbookItemsShop(bookId, key);
  updateRefbookCountShop(bookId, key);
  showToast('✅ Сохранено');
}
function deleteRefbookItemShop(bookId, idx, key){
  var items = getRefBook(key);
  var deleted = items.splice(idx,1);
  var tombKey = key+'_deleted';
  var tombs = JSON.parse(localStorage.getItem(tombKey)||'[]');
  if(deleted.length){
    var dname = (deleted[0].name||deleted[0]||'').toLowerCase().trim();
    if(dname && tombs.indexOf(dname)<0) tombs.push(dname);
    localStorage.setItem(tombKey, JSON.stringify(tombs));
    var tombDocKey = key==='iz_goods_derevo'?'goods_derevo_deleted':(key==='iz_goods_dr'?'goods_dr_deleted':'refbook_deleted_'+key);
    try{ db.collection('iz_settings').doc(tombDocKey).set({deleted:tombs,updatedAt:new Date().toISOString()},{merge:true}); }catch(e){}
  }
  saveRefBookShop(key, items);
  renderRefbookItemsShop(bookId, key);
  updateRefbookCountShop(bookId, key);
  showToast('✅ Удалено и сохранено');
}
function _nfCollectMatches(predicate){
  var matches = {};
  function addMatch(name, qty, ref){
    if(!name || !predicate(name)) return;
    if(!matches[name]) matches[name] = {name:name, count:0, qty:0, refs:[]};
    matches[name].count++;
    matches[name].qty += (qty||0);
    matches[name].refs.push(ref);
  }
  getShifts().forEach(function(sh){
    (sh.journal||[]).forEach(function(e){
      if(e.type==='sale' || e.type==='writeoff'){
        (e.items||[]).forEach(function(it, idx){
          addMatch(it.name, it.qty||1, {kind:'shift', shiftId:(sh.id||sh._id), entryId:e.id, itemIdx:idx});
        });
      } else if(e.type==='staff' && e.item){
        addMatch(e.item, e.qty||1, {kind:'shift-staff', shiftId:(sh.id||sh._id), entryId:e.id});
      }
    });
  });
  JSON.parse(localStorage.getItem('iz_invoices')||'[]').forEach(function(inv){
    (inv.items||[]).forEach(function(it, idx){
      addMatch(it.name, it.qty||1, {kind:'invoice', invId:(inv.id||inv._id), itemIdx:idx});
    });
  });
  JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]').forEach(function(inv){
    (inv.items||[]).forEach(function(it, idx){
      addMatch(it.name, it.qty||1, {kind:'manual_invoice', invId:(inv.id||inv._id), itemIdx:idx});
    });
  });
  ['iz_goods_derevo','iz_goods_dr','iz_goods'].forEach(function(key){
    getRefBook(key).forEach(function(it){
      addMatch(it.name||it, 0, {kind:'catalog', bookKey:key});
    });
  });
  return matches;
}
function nfSyncFromServer(){
  var btn = document.getElementById('nfSyncBtn');
  var status = document.getElementById('nfSyncStatus');
  if(typeof db==='undefined' || !db){ showToast('Нет подключения к базе'); return; }
  if(btn){ btn.disabled=true; btn.textContent='⏳ Обновляю...'; }
  if(status){ status.style.display='block'; status.textContent='⏳ Загружаю смены, накладные и справочники с сервера...'; }
  var tasks = [];
  tasks.push(new Promise(function(resolve){
    try{ if(typeof syncShiftsFromFirestore==='function'){ syncShiftsFromFirestore(); }
    }catch(e){}
    setTimeout(resolve, 1500);
  }));
  ['iz_invoices','iz_manual_invoices'].forEach(function(col){
    tasks.push(db.collection(col).get({source:'server'}).then(function(snap){
      var arr = snap.docs.map(function(d){ var v=d.data(); v.id=d.id; return v; });
      localStorage.setItem(col, JSON.stringify(arr));
    }).catch(function(){}));
  });
  [['iz_goods_derevo','goods_derevo'],['iz_goods_dr','goods_dr'],['iz_goods','goods']].forEach(function(pair){
    tasks.push(db.collection('iz_settings').doc(pair[1]).get({source:'server'}).then(function(snap){
      if(snap.exists && snap.data().data) localStorage.setItem(pair[0], JSON.stringify(snap.data().data));
    }).catch(function(){}));
  });
  Promise.all(tasks).then(function(){
    if(btn){ btn.disabled=false; btn.textContent='🔄 Обновить данные с сервера перед поиском'; }
    if(status){ status.textContent='✅ Данные обновлены с сервера'; }
    try{ renderRefbookSections(); }catch(e){} // иначе видимый список "Наименование товаров" остаётся со старой картиной
    searchItemNameOccurrences();
  });
}
function searchItemNameOccurrences(){
  var input = document.getElementById('nfSearchInput');
  var c = document.getElementById('nfResults');
  if(!input || !c) return;
  var q = (input.value||'').trim().toLowerCase();
  var matches = _nfCollectMatches(function(name){ return !q || name.toLowerCase().indexOf(q)>=0; });
  var names = Object.keys(matches);
  if(!names.length){ c.innerHTML='<div style="font-size:12px;color:#8888aa;padding:8px 0">Ничего не найдено</div>'; return; }
  names.sort(function(a,b){ return matches[b].count-matches[a].count; });
  var header = !q ? '<div style="font-size:11px;color:#8888aa;margin-bottom:8px">Все наименования, встречающиеся в продажах, списаниях и накладных ('+names.length+')</div>' : '';
  c.innerHTML = header + names.map(function(n){
    var m = matches[n];
    var usageRefs = m.refs.filter(function(r){ return r.kind!=='catalog'; });
    var inCatalog = m.refs.some(function(r){ return r.kind==='catalog'; });
    var word = usageRefs.length===1?'запись':(usageRefs.length>=2&&usageRefs.length<=4?'записи':'записей');
    var usageLine = usageRefs.length ? (usageRefs.length+' '+word+' · '+m.qty+' шт.') : 'только в справочнике, не используется';
    var esc = n.replace(/"/g,'&quot;');
    var addBtn = (!inCatalog && usageRefs.length) ? '<button onclick="addNameToCatalog(this)" data-name="'+esc+'" style="background:none;border:1px solid #60c8f0;border-radius:8px;padding:5px 10px;color:#60c8f0;font-size:11px;cursor:pointer;white-space:nowrap;flex-shrink:0">➕ В справочник</button>' : '';
    var whoBtn = usageRefs.length ? '<button onclick="showNameSellerBreakdown(this)" data-name="'+esc+'" title="Кто вносил" style="background:none;border:1px solid #a060f0;border-radius:8px;padding:5px 8px;color:#a060f0;font-size:11px;cursor:pointer;white-space:nowrap;flex-shrink:0">👤</button>' : '';
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px;background:#1a1a22;border:1px solid #2e2e3e;border-radius:10px;margin-bottom:6px">'+
      '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:700;word-break:break-word">'+n+(inCatalog?' <span style="font-size:10px;color:#60c8f0;font-weight:600">📚 в справочнике</span>':'')+'</div>'+
      '<div style="font-size:11px;color:#8888aa">'+usageLine+'</div></div>'+
      '<div style="display:flex;gap:6px;flex-shrink:0">'+whoBtn+addBtn+
      '<button onclick="startRenameItemName(this)" data-name="'+esc+'" style="background:none;border:1px solid #c8f060;border-radius:8px;padding:5px 10px;color:#c8f060;font-size:11px;cursor:pointer;white-space:nowrap">✏️ Заменить</button>'+
      '</div>'+
    '</div>';
  }).join('');
}
function showNameSellerBreakdown(btn){
  var name = btn.getAttribute('data-name');
  var matches = _nfCollectMatches(function(n){ return n===name; });
  var m = matches[name];
  var bySeller = {};
  if(m){
    var shifts = getShifts();
    var manInv = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
    var inv = JSON.parse(localStorage.getItem('iz_invoices')||'[]');
    m.refs.forEach(function(r){
      if(r.kind==='catalog') return;
      var who = null;
      if(r.kind==='shift' || r.kind==='shift-staff'){
        var sh = shifts.find(function(s){ return (s.id||s._id)===r.shiftId; });
        who = sh && sh.sellerName;
      } else if(r.kind==='manual_invoice'){
        var iv = manInv.find(function(i){ return (i.id||i._id)===r.invId; });
        who = iv && (iv.createdBy||iv.acceptedBy);
      } else if(r.kind==='invoice'){
        var iv2 = inv.find(function(i){ return (i.id||i._id)===r.invId; });
        who = iv2 && (iv2.acceptedBy||iv2.createdBy);
      }
      who = (who||'').trim() || 'Неизвестно';
      bySeller[who] = (bySeller[who]||0)+1;
    });
  }
  var sellers = Object.keys(bySeller).sort(function(a,b){ return bySeller[b]-bySeller[a]; });
  var rows = sellers.map(function(s){
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 2px;border-bottom:1px solid #2e2e3e;font-size:13px">'+
      '<span>👤 '+s+'</span><span style="font-weight:700;color:#c8f060">'+bySeller[s]+' зап.</span></div>';
  }).join('');
  var overlay = document.getElementById('nfSellerOverlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'nfSellerOverlay';
    overlay.className = 'mo';
    overlay.onclick = function(e){ if(e.target===overlay) overlay.classList.remove('open'); };
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = '<div class="md">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
      '<div style="font-size:15px;font-weight:700;word-break:break-word;padding-right:10px">Кто вносил: «'+name+'»</div>'+
      '<button onclick="document.getElementById(\'nfSellerOverlay\').classList.remove(\'open\')" style="background:#22222e;border:1px solid #2e2e3e;border-radius:8px;width:30px;height:30px;color:#8888aa;font-size:16px;cursor:pointer;flex-shrink:0">✕</button>'+
    '</div>'+
    (rows || '<div style="font-size:12px;color:#8888aa">Нет данных</div>')+
  '</div>';
  overlay.classList.add('open');
}
function _nfInferGoodsType(name){
  var found = null;
  getShifts().some(function(sh){
    return (sh.journal||[]).some(function(e){
      if(e.type!=='sale' && e.type!=='writeoff') return false;
      return (e.items||[]).some(function(it){ if(it.name===name){ found=it.goodsType; return true; } return false; });
    });
  });
  if(found) return found;
  ['iz_invoices','iz_manual_invoices'].some(function(col){
    return JSON.parse(localStorage.getItem(col)||'[]').some(function(inv){
      return (inv.items||[]).some(function(it){ if(it.name===name){ found=it.goodsType||inv.goodsType; return true; } return false; });
    });
  });
  return found||'derevo';
}
function addNameToCatalog(btn){
  var name = btn.getAttribute('data-name');
  var gt = _nfInferGoodsType(name);
  var key = gt==='dr' ? 'iz_goods_dr' : 'iz_goods_derevo';
  var list = getRefBook(key);
  if(list.some(function(it){ return (it.name||it).toLowerCase().trim()===name.toLowerCase().trim(); })){
    showToast('Уже есть в справочнике'); searchItemNameOccurrences(); return;
  }
  list.push({id:uid(), name:name});
  saveRefBookShop(key, list);
  _clearRefbookTombstone(key, name);
  showToast('✅ Добавлено в справочник ('+(gt==='dr'?'ДР Товар':'Дерево')+'): '+name);
  searchItemNameOccurrences();
}
function startRenameItemName(btn){
  var oldName = btn.getAttribute('data-name');
  var newName = prompt('Заменить «'+oldName+'» на:', oldName);
  if(newName==null) return;
  newName = newName.trim();
  if(!newName || newName===oldName) return;
  var matches = _nfCollectMatches(function(name){ return name===oldName; });
  var m = matches[oldName];
  if(!m || !m.count){ showToast('Не найдено записей для замены'); return; }
  var usageCount = m.refs.filter(function(r){ return r.kind!=='catalog'; }).length;
  var inCatalog = m.refs.some(function(r){ return r.kind==='catalog'; });
  var word = usageCount===1?'записи':(usageCount>=2&&usageCount<=4?'записях':'записях');
  var msg = usageCount
    ? 'Заменить «'+oldName+'» → «'+newName+'» в '+usageCount+' '+word+' ('+m.qty+' шт.)'+(inCatalog?' и в справочнике':'')+'?'
    : 'Переименовать «'+oldName+'» → «'+newName+'» в справочнике товаров (в продажах не встречается)?';
  if(!confirm(msg+'\n\nИзменения применятся локально и в облаке. Отменить массово будет нельзя.')) return;
  _nfExecuteRename(m.refs, oldName, newName);
}
function _nfExecuteRename(refs, oldName, newName){
  showToast('⏳ Заменяю...');
  var shiftIds = {}, invIds = {}, manInvIds = {}, catalogKeys = {};
  refs.forEach(function(r){
    if(r.kind==='shift' || r.kind==='shift-staff') shiftIds[r.shiftId]=true;
    else if(r.kind==='invoice') invIds[r.invId]=true;
    else if(r.kind==='manual_invoice') manInvIds[r.invId]=true;
    else if(r.kind==='catalog') catalogKeys[r.bookKey]=true;
  });
  var shifts = getShifts();
  var touchedShifts = [];
  Object.keys(shiftIds).forEach(function(id){
    var sh = shifts.find(function(s){ return (s.id||s._id)===id; });
    if(!sh) return;
    (sh.journal||[]).forEach(function(e){
      if(e.type==='sale' || e.type==='writeoff'){
        (e.items||[]).forEach(function(it){ if(it.name===oldName) it.name=newName; });
      } else if(e.type==='staff' && e.item===oldName){
        e.item = newName;
      }
    });
    touchedShifts.push(sh);
  });
  saveShifts(shifts);
  touchedShifts.forEach(function(sh){
    var id = sh.id||sh._id;
    try{ db.collection('iz_shifts').doc(id).set({journal: sh.journal}, {merge:true}); }catch(e){}
  });
  var invoices = JSON.parse(localStorage.getItem('iz_invoices')||'[]');
  var touchedInv = [];
  Object.keys(invIds).forEach(function(id){
    var inv = invoices.find(function(i){ return (i.id||i._id)===id; });
    if(!inv) return;
    (inv.items||[]).forEach(function(it){ if(it.name===oldName) it.name=newName; });
    touchedInv.push(inv);
  });
  if(touchedInv.length){
    localStorage.setItem('iz_invoices', JSON.stringify(invoices));
    touchedInv.forEach(function(inv){
      var id = inv.id||inv._id;
      try{ db.collection('iz_invoices').doc(id).set(inv,{merge:true}); }catch(e){}
    });
  }
  var manInvoices = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var touchedManInv = [];
  Object.keys(manInvIds).forEach(function(id){
    var inv = manInvoices.find(function(i){ return (i.id||i._id)===id; });
    if(!inv) return;
    (inv.items||[]).forEach(function(it){ if(it.name===oldName) it.name=newName; });
    touchedManInv.push(inv);
  });
  if(touchedManInv.length){
    localStorage.setItem('iz_manual_invoices', JSON.stringify(manInvoices));
    touchedManInv.forEach(function(inv){
      var id = inv.id||inv._id;
      try{ db.collection('iz_manual_invoices').doc(id).set(inv,{merge:true}); }catch(e){}
    });
  }
  var catalogsTouched = 0;
  var catalogKeyList = Object.keys(catalogKeys);
  if(!catalogKeyList.length && touchedShifts.length){
    var gt = null;
    touchedShifts.some(function(sh){
      return (sh.journal||[]).some(function(e){
        if(e.type!=='sale' && e.type!=='writeoff') return false;
        return (e.items||[]).some(function(it){ if(it.name===newName){ gt=it.goodsType; return true; } return false; });
      });
    });
    if(gt) catalogKeyList = [gt==='dr'?'iz_goods_dr':'iz_goods_derevo'];
  }
  catalogKeyList.forEach(function(key){
    var list = getRefBook(key);
    var changed = false;
    list.forEach(function(it){ if((it.name||it)===oldName){ it.name=newName; changed=true; } });
    var normNew = newName.toLowerCase().trim();
    var hasNew = list.some(function(it){ return (it.name||it).toLowerCase().trim()===normNew; });
    if(!hasNew){ list.push({id:uid(), name:newName}); changed=true; }
    if(changed){ saveRefBookShop(key, list); _clearRefbookTombstone(key, newName); catalogsTouched++; }
  });
  var itemsBase = JSON.parse(localStorage.getItem('iz_items')||'[]');
  var itemsBaseChanged = false;
  itemsBase.forEach(function(it){ if(it.name===oldName){ it.name=newName; itemsBaseChanged=true; } });
  if(itemsBaseChanged){
    localStorage.setItem('iz_items', JSON.stringify(itemsBase));
    try{ syncSave('iz_items', itemsBase); }catch(e){}
  }
  searchItemNameOccurrences();
  showToast('✅ Заменено: смен — '+touchedShifts.length+', накладных — '+(touchedInv.length+touchedManInv.length)+(catalogsTouched?', справочник обновлён':''));
}
function updateRefbookCountShop(bookId, key){
  var items = getRefBook(key);
  var el = document.getElementById('rbCount_'+bookId);
  if(el) el.textContent = items.length+' записей';
}
function renderShopSettings(){
  var c = document.getElementById('shopSettingsList'); if(!c) return;
  renderShopsManage(); renderAccountsList(); renderRefbookSections();
  var shops = getShopNames();
  var settings = getShopZpSettings();
  updateSettingsSectionCount('zp', shops.length);
  if(!shops.length){ c.innerHTML='<div style="font-size:12px;color:#8888aa;padding:8px">Сначала добавьте магазины выше</div>'; return; }
  c.innerHTML = shops.map(function(shop){
    var sid = encodeURIComponent(shop).replace(/%/g,'_');
    var s = settings[shop] || {base:1500, pct:8, threshold:5000, travel:0};
    var base = numDef(s.base, 1500), pct = numDef(s.pct, 8), threshold = numDef(s.threshold, 5000), travel = numDef(s.travel, 0);
    var highThresh = numDef(s.highThreshold, 20000), highPct = numDef(s.highPct, 10);
    var highEnabled = (s.highEnabled !== undefined) ? s.highEnabled : !!s.highThreshold;
    var highThreshGross = (s.highThreshGross !== undefined) ? s.highThreshGross : true;
    return '<div style="border:1px solid #2e2e3e;border-radius:12px;margin-bottom:8px;overflow:hidden">'+
      '<div onclick="toggleZpAcc(\''+sid+'\')" style="display:flex;justify-content:space-between;align-items:center;padding:12px;cursor:pointer;background:#1a1a22">'+
        '<div class="u-fs13-bold">🏪 '+shop+'</div>'+
        '<div style="display:flex;align-items:center;gap:8px">'+
          '<div class="u-fs11-gray">база: '+base+'₽ · '+pct+'%</div>'+
          '<div id="zpAcc_arr_'+sid+'" style="color:#c8f060">▶</div>'+
        '</div>'+
      '</div>'+
      '<div id="zpAcc_'+sid+'" style="display:none;padding:12px;background:#0f0f13">'+
        '<div class="fg"><label class="fl">Базовая ставка за выход (₽)</label>'+
          '<input class="fi" type="text" id="zp_base_'+sid+'" value="'+base+'" inputmode="numeric"></div>'+
        '<div class="fg"><label class="fl">Порог выручки для % (₽)</label>'+
          '<input class="fi" type="text" id="zp_thresh_'+sid+'" value="'+threshold+'" inputmode="numeric">'+
          '<div style="font-size:11px;color:#8888aa;margin-top:4px">Ниже порога → только базовая. Оставь поле пустым или 0, если порога нет — процент будет начисляться всегда</div></div>'+
        '<div class="fg"><label class="fl">Процент от выручки (%)</label>'+
          '<input class="fi" type="text" id="zp_pct_'+sid+'" value="'+pct+'" inputmode="numeric" step="0.5"></div>'+
        '<div class="fg"><label class="fl">Проезд за смену (₽)</label>'+
          '<input class="fi" type="text" id="zp_travel_'+sid+'" value="'+travel+'" inputmode="numeric"></div>'+
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'+
          '<input type="checkbox" id="zp_has_high_'+sid+'" '+(highEnabled?'checked':'')+
          ' onchange="toggleHighPct(\''+sid+'\',this.checked)" style="width:18px;height:18px;cursor:pointer">'+
          '<label for="zp_has_high_'+sid+'" style="font-size:12px;color:#8888aa;cursor:pointer">Повышенный % при высокой выручке</label>'+
        '</div>'+
        '<div id="zp_highpct_block_'+sid+'" style="'+(highEnabled?'':'display:none')+'">'+
          '<div class="fg"><label class="fl">Порог повышенного % (₽)</label>'+
            '<input class="fi" type="text" id="zp_highthresh_'+sid+'" value="'+highThresh+'" inputmode="numeric"></div>'+
          '<div class="fg"><label class="fl">Повышенный % (%)</label>'+
            '<input class="fi" type="text" id="zp_highpct_'+sid+'" value="'+highPct+'" inputmode="numeric" step="0.5"></div>'+
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'+
            '<input type="checkbox" id="zp_highgross_'+sid+'" '+(highThreshGross?'checked':'')+' style="width:18px;height:18px;cursor:pointer">'+
            '<label for="zp_highgross_'+sid+'" style="font-size:12px;color:#8888aa;cursor:pointer">Порог считать с учётом скидки (по общей сумме продаж, скидка не вычитается)</label>'+
          '</div>'+
          '<div style="font-size:10px;color:#8888aa;margin:-4px 0 8px">Если снять галочку — порог будет сравниваться с суммой, которая реально пришла (продажи минус скидка)</div>'+
        '</div>'+
        '<button onclick="saveOneShopZp(\''+shop+'\',\''+sid+'\')" style="width:100%;padding:10px;border-radius:10px;border:none;background:#1e2a14;border:1px solid #c8f060;color:#c8f060;font-size:12px;font-weight:700;cursor:pointer;margin-top:4px">💾 Сохранить '+shop+'</button>'+
      '</div>'+
    '</div>';
  }).join('');
}
function toggleZpAcc(sid){
  var body=document.getElementById('zpAcc_'+sid);
  var arr=document.getElementById('zpAcc_arr_'+sid);
  if(!body) return;
  var open=body.style.display!=='none';
  body.style.display=open?'none':'block';
  if(arr) arr.textContent=open?'▶':'▼';
}
function toggleHighPct(sid, checked){
  var block=document.getElementById('zp_highpct_block_'+sid);
  if(block) block.style.display = checked?'block':'none';
}
function saveOneShopZp(shop, sid){
  var settings=getShopZpSettings();
  var hasHigh=(document.getElementById('zp_has_high_'+sid)||{}).checked;
  var highGrossEl=document.getElementById('zp_highgross_'+sid);
  var threshRaw = (document.getElementById('zp_thresh_'+sid)||{}).value;
  settings[shop]={
    base: numDef(parseFloat((document.getElementById('zp_base_'+sid)||{}).value), 1500),
    threshold: (threshRaw==null || threshRaw==='') ? 0 : (parseFloat(threshRaw)||0),
    pct: numDef(parseFloat((document.getElementById('zp_pct_'+sid)||{}).value), 8),
    travel: numDef(parseFloat((document.getElementById('zp_travel_'+sid)||{}).value), 0),
    highThreshold: hasHigh?numDef(parseFloat((document.getElementById('zp_highthresh_'+sid)||{}).value), 20000):null,
    highPct: hasHigh?numDef(parseFloat((document.getElementById('zp_highpct_'+sid)||{}).value), 10):null,
    highEnabled: !!hasHigh,
    highThreshGross: highGrossEl ? !!highGrossEl.checked : true,
  };
  saveShopZpSettingsData(settings);
  renderShopSettings();
  showToast('✅ ЗП для '+shop+' сохранена');
}
function saveShopSettings(){
  var shops=getShopNames();
  var settings=getShopZpSettings();
  shops.forEach(function(shop){
    var sid=encodeURIComponent(shop).replace(/%/g,'_');
    var hasHigh=(document.getElementById('zp_has_high_'+sid)||{}).checked;
    var highGrossEl2=document.getElementById('zp_highgross_'+sid);
    var baseEl=document.getElementById('zp_base_'+sid);
    if(!baseEl) return; // accordion not opened, skip
    var threshRaw2 = (document.getElementById('zp_thresh_'+sid)||{}).value;
    settings[shop]={
      base: numDef(parseFloat(baseEl.value), 1500),
      threshold: (threshRaw2==null || threshRaw2==='') ? 0 : (parseFloat(threshRaw2)||0),
      pct: numDef(parseFloat((document.getElementById('zp_pct_'+sid)||{}).value), 8),
      travel: numDef(parseFloat((document.getElementById('zp_travel_'+sid)||{}).value), 0),
      highThreshold: hasHigh?numDef(parseFloat((document.getElementById('zp_highthresh_'+sid)||{}).value), 20000):null,
      highPct: hasHigh?numDef(parseFloat((document.getElementById('zp_highpct_'+sid)||{}).value), 10):null,
      highEnabled: !!hasHigh,
      highThreshGross: highGrossEl2 ? !!highGrossEl2.checked : true,
    };
  });
  saveShopZpSettingsData(settings);
  showToast('✅ Настройки ЗП сохранены');
}
function renderSuppliersAdmin(){
  var c=document.getElementById('suppliersAdminList'); if(!c)return;
  var suppliers=getSupplierslist();
  if(!suppliers.length){c.innerHTML='<div style="font-size:12px;color:#8888aa;padding:6px">Нет поставщиков</div>';return;}
  c.innerHTML=suppliers.map(function(s,i){
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px;margin-bottom:6px;background:#1a1e2e;border:1px solid #60c8f0;border-radius:10px">'+
      '<div style="font-size:13px;font-weight:600">'+s+'</div>'+
      '<button onclick="deleteSupplierAdmin('+i+')" style="background:none;border:1px solid #2e2e3e;border-radius:8px;padding:4px 8px;font-size:11px;color:#f06060;cursor:pointer">✕</button>'+
    '</div>';
  }).join('');
}
function addSupplierAdmin(){
  var name=((document.getElementById('newSupplierName')||{}).value||'').trim();
  if(!name){showToast('Введите название');return;}
  var suppliers=getSupplierslist();
  if(!suppliers.includes(name)){suppliers.push(name);saveSupplierslist(suppliers);}
  document.getElementById('newSupplierName').value='';
  renderSuppliersAdmin(); showToast('✅ Поставщик добавлен');
}
function deleteSupplierAdmin(idx){
  var suppliers=getSupplierslist(); suppliers.splice(idx,1); saveSupplierslist(suppliers);
  renderSuppliersAdmin(); showToast('🗑 Поставщик удалён');
}
var STAFF_ROLE_LABELS = {
  admin:'🔐 Администратор', owner:'👑 Владелец', accountant:'📊 Бухгалтер',
  seller:'🏪 Продавец', 'мастер':'🔨 Мастер', 'заготовщик':'🪚 Заготовщик',
  'кладовщик':'📦 Кладовщик', 'управляющий':'👑 Управляющий'
};
var STAFF_ADMIN_ROLES = ['admin','owner','accountant'];
function renderSellersAdmin(){
  renderAdminsAdminList();
  const c=document.getElementById('sellersAdminList'); if(!c)return;
  const staff=getStaff();
  var noRoleStaff=staff.filter(function(s){ return s.archived!==true && (!s.roles||!s.roles.length); });
  var repairEl=document.getElementById('staffRepairBtn');
  if(!repairEl && noRoleStaff.length){
    var rb=document.createElement('div');
    rb.id='staffRepairBtn';
    rb.style='background:#2a1e14;border:1px solid #f0a060;border-radius:10px;padding:10px;margin-bottom:10px';
    rb.innerHTML='⚠️ Найдено '+noRoleStaff.length+' сотрудника без роли продавца: <b>'+noRoleStaff.map(function(s){return s.name;}).join(', ')+'</b>'+
      '<br><button onpointerdown="event.preventDefault();repairStaffRoles()" style="margin-top:8px;padding:6px 16px;background:#f0a060;border:none;border-radius:8px;font-weight:700;color:#0f0f13;cursor:pointer">🔧 Добавить роль Продавец</button>';
    c.parentNode.insertBefore(rb, c);
  } else if(repairEl && !noRoleStaff.length){
    repairEl.remove();
  }
  const sellers=staff.filter(function(s){
    if(s.archived===true) return false;
    if(s.roles && s.roles.indexOf('seller')>=0) return true;
    if(!s.roles || !s.roles.length) return true;
    return false;
  });
  var adminRolesSet=STAFF_ADMIN_ROLES;
  var ghosts=staff.filter(function(s){
    if(s.archived===true) return false;
    if(sellers.indexOf(s)>=0) return false;
    if(s.roles && s.roles.some(function(r){return adminRolesSet.indexOf(r)>=0;})) return false;
    return true;
  });
  var ghostHtml='';
  if(ghosts.length){
    ghostHtml='<div style="background:#2a1e14;border:1px solid #f0a060;border-radius:10px;padding:10px;margin-bottom:10px">'+
      '⚠️ Найдено '+ghosts.length+' скрытых записей (не отображаются ни в одном списке из-за нестандартной роли):'+
      ghosts.map(function(s){
        var idx=staff.indexOf(s);
        var roleStr=(s.roles||[]).join(', ')||'(нет ролей)';
        return '<div style="margin-top:8px;padding:8px;background:#1a1a22;border-radius:8px">'+
          '<div class="u-fs13-bold">'+s.name+'</div>'+
          '<div class="u-fs11-gray">роли: '+roleStr+'</div>'+
          '<div style="display:flex;gap:6px;margin-top:6px">'+
            '<button onclick="editStaffShop('+idx+')" style="flex:1;background:none;border:1px solid #2e2e3e;border-radius:8px;padding:6px;font-size:12px;color:#60c8f0;cursor:pointer">✏️ Открыть и исправить роль</button>'+
            '<button onclick="openBlockSeller(\'delete\','+idx+',\''+s.name+'\')" style="flex:1;background:none;border:1px solid #2e2e3e;border-radius:8px;padding:6px;font-size:12px;color:#f06060;cursor:pointer">🗑 Удалить</button>'+
          '</div>'+
        '</div>';
      }).join('')+
    '</div>';
  }
  if(!sellers.length && !ghosts.length){c.innerHTML='<div class="empty"><div class="ei">🏪</div>Нет продавцов</div>';return;}
  c.innerHTML=ghostHtml+sellers.map(function(s){
    const idx=staff.indexOf(s);
    const roleStr=(s.roles||[]).map(function(r){return STAFF_ROLE_LABELS[r]||r;}).join(' · ');
    const shopStr=(s.shops||[]).length?(s.shops||[]).join(', '):'';
    return `
    <div style="background:${s.blocked?'#2e1a1a':'#1a1a22'};border:1px solid ${s.blocked?'#f06060':'#2e2e3e'};border-radius:12px;padding:10px;margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px">
        <div style="font-size:22px">${s.blocked?'🚫':'🏪'}</div>
        <div style="flex:1">
          <div class="u-fs13-bold">${s.name}${s.blocked?' (заблокирован)':''}</div>
          <div style="font-size:11px;color:#8888aa;margin-top:2px">${roleStr}</div>
          ${shopStr?'<div style="font-size:11px;color:#60c8f0;margin-top:2px">📍 '+shopStr+'</div>':''}
          ${s.status?'<div style="font-size:11px;color:#ffb060;margin-top:2px">👤 '+s.status+'</div>':''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button onclick="editStaffShop(${idx})" style="flex:1;min-width:40px;background:none;border:1px solid #2e2e3e;border-radius:8px;padding:6px 8px;font-size:13px;color:#60c8f0;cursor:pointer">✏️</button>
        <button onclick="openBlockSeller('${s.blocked?'unblock':'block'}',${idx},'${s.name}')" style="flex:2;min-width:70px;background:${s.blocked?'#1a2e1e':'#2a1e14'};border:1px solid ${s.blocked?'#60f090':'#f0a060'};border-radius:8px;padding:6px 8px;font-size:11px;color:${s.blocked?'#60f090':'#f0a060'};cursor:pointer;white-space:nowrap">${s.blocked?'Разблок.':'Блок.'}</button>
        <button onclick="openBlockSeller('archive',${idx},'${s.name}')" style="flex:1;min-width:40px;background:none;border:1px solid #2e2e3e;border-radius:8px;padding:6px 8px;font-size:13px;color:#8888aa;cursor:pointer">📥</button>
        <button onclick="openBlockSeller('delete',${idx},'${s.name}')" style="flex:1;min-width:40px;background:none;border:1px solid #2e2e3e;border-radius:8px;padding:6px 8px;font-size:13px;color:#f06060;cursor:pointer">✕</button>
      </div>
    </div>`;
  }).join('');
}
function openBlockSeller(type,idx,name){
  blockSellerAction={type,idx,name};
  document.getElementById('blockSellerTitle').textContent={block:'Заблокировать '+name+'?',unblock:'Разблокировать '+name+'?',delete:'Удалить '+name+'?',archive:'Перенести в архив '+name+'?'}[type];
  document.getElementById('blockSellerBody').innerHTML={block:'<div style="font-size:13px;color:#8888aa">Сотрудник не сможет войти.</div>',unblock:'<div style="font-size:13px;color:#8888aa">Сотрудник снова сможет войти.</div>',delete:'<div style="font-size:13px;color:#f06060">⚠️ Удалится безвозвратно.</div>',archive:'<div style="font-size:13px;color:#8888aa">Сотрудник переместится в архив и пропадёт из общего списка. Доступ для входа не меняется.</div>'}[type];
  const btn=document.getElementById('blockSellerBtn');
  btn.textContent={block:'🚫 Заблокировать',unblock:'✅ Разблокировать',delete:'🗑 Удалить',archive:'📥 В архив'}[type];
  btn.className=type==='unblock'?'btn':(type==='archive'?'btn sec':'btn red');
  openMo('blockSellerMo');
}
function confirmBlockSeller(){
  if(!blockSellerAction)return;
  const {type,idx}=blockSellerAction;
  const staff=getStaff();
  if(!staff[idx]){closeMo('blockSellerMo');return;}
  if(type==='delete')staff.splice(idx,1);
  else if(type==='block'){staff[idx].blocked=true; staff[idx].blockedByStatus=false;}
  else if(type==='unblock'){staff[idx].blocked=false; staff[idx].blockedByStatus=false;}
  else if(type==='archive'){staff[idx].archived=true;}
  saveStaffShop(staff);
  closeMo('blockSellerMo'); renderSellersAdmin();
  showToast(type==='delete'?'🗑 Удалено':type==='block'?'🚫 Заблокировано':type==='archive'?'📥 Перенесено в архив':'✅ Разблокировано');
}
function renderAdminsAdminList(){
  const c=document.getElementById('adminsAdminList'); if(!c)return;
  const staff=getStaff();
  const admins=staff.filter(function(s){ return s.roles && s.roles.some(function(r){return STAFF_ADMIN_ROLES.indexOf(r)>=0;}) && !s.archived; });
  if(!admins.length){c.innerHTML='<div style="font-size:12px;color:#8888aa;padding:8px">Нет администраторов</div>';return;}
  c.innerHTML=admins.map(function(a){
    const idx=staff.indexOf(a);
    const roleStr=(a.roles||[]).map(function(r){return STAFF_ROLE_LABELS[r]||r;}).join(' · ');
    return `
    <div style="padding:10px;margin-bottom:8px;background:${a.blocked?'#2e1a1a':'#1e1a2e'};border:1px solid ${a.blocked?'#f06060':'#a060f0'};border-radius:12px">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px">
        <div style="font-size:22px">${a.blocked?'🚫':'🔐'}</div>
        <div style="flex:1">
          <div class="u-fs13-bold">${a.name}${a.blocked?' (заблокирован)':''}</div>
          <div class="u-fs11-gray">${roleStr}</div>
          ${a.status?'<div style="font-size:11px;color:#ffb060;margin-top:2px">👤 '+a.status+'</div>':''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button onclick="editStaffShop(${idx})" style="flex:1;min-width:40px;background:none;border:1px solid #2e2e3e;border-radius:8px;padding:6px 8px;font-size:13px;color:#60c8f0;cursor:pointer">✏️</button>
        <button onclick="openBlockSeller('${a.blocked?'unblock':'block'}',${idx},'${a.name}')" style="flex:2;min-width:70px;background:${a.blocked?'#1a2e1e':'#2a1e14'};border:1px solid ${a.blocked?'#60f090':'#f0a060'};border-radius:8px;padding:6px 8px;font-size:11px;color:${a.blocked?'#60f090':'#f0a060'};cursor:pointer;white-space:nowrap">${a.blocked?'Разблок.':'Блок.'}</button>
        <button onclick="openBlockSeller('archive',${idx},'${a.name}')" style="flex:1;min-width:40px;background:none;border:1px solid #2e2e3e;border-radius:8px;padding:6px 8px;font-size:13px;color:#8888aa;cursor:pointer">📥</button>
        <button onclick="openBlockSeller('delete',${idx},'${a.name}')" style="flex:1;min-width:40px;background:none;border:1px solid #2e2e3e;border-radius:8px;padding:6px 8px;font-size:13px;color:#f06060;cursor:pointer">✕</button>
      </div>
    </div>`;
  }).join('');
}
function toggleStaffArchiveShop(){
  var body=document.getElementById('staffArchiveBodyShop');
  var arrow=document.getElementById('staffArchiveArrowShop');
  if(!body) return;
  var open = body.style.display!=='none';
  body.style.display = open?'none':'block';
  if(arrow) arrow.textContent = open?'▶':'▼';
  if(!open) renderStaffArchiveShop();
}
function renderStaffArchiveShop(){
  var body=document.getElementById('staffArchiveBodyShop'); if(!body) return;
  var staff=getStaff();
  var archived=staff.filter(function(s){ return s.archived; });
  var cnt=document.getElementById('staffArchiveCountShop');
  if(cnt) cnt.textContent = archived.length?'('+archived.length+')':'';
  if(!archived.length){
    body.innerHTML='<div style="font-size:12px;color:#8888aa;padding:8px">Архив пуст</div>';
    return;
  }
  body.innerHTML=archived.map(function(s){
    var idx=staff.indexOf(s);
    var roleStr=(s.roles||[]).map(function(r){return STAFF_ROLE_LABELS[r]||r;}).join(' · ');
    return `
    <div style="background:#0f0f13;border:1px solid #2e2e3e;border-radius:12px;padding:10px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700;color:#8888aa">${s.name}</div>
          <div style="font-size:11px;color:#8888aa;margin-top:2px">${roleStr}</div>
          ${s.status?'<div style="font-size:11px;color:#ffb060;margin-top:2px">👤 '+s.status+'</div>':''}
        </div>
        <div style="display:flex;gap:4px">
          <button onclick="unarchiveStaffShop(${idx})" style="background:none;border:1px solid #2e2e3e;border-radius:8px;padding:4px 8px;font-size:11px;color:#60c8f0;cursor:pointer">↩️ Вернуть</button>
          <button onclick="openBlockSeller('delete',${idx},'${s.name}')" style="background:none;border:1px solid #2e2e3e;border-radius:8px;padding:4px 8px;font-size:10px;color:#f06060;cursor:pointer">✕</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
function repairStaffRoles(){
  var staff=getStaff();
  var fixed=0;
  staff.forEach(function(s){
    if(!s.roles || !s.roles.length){
      s.roles=['seller']; fixed++;
      console.log('[repair] Added seller to:', s.name);
    }
  });
  if(fixed){
    saveStaffShop(staff);
    renderSellersAdmin();
    showToast('✅ Исправлено '+fixed+' записей — добавлена роль Продавец');
  } else {
    showToast('Нет записей без ролей — сотрудник не найден');
  }
}
function unarchiveStaffShop(idx){
  var staff=getStaff();
  if(!staff[idx]) return;
  staff[idx].archived=false;
  saveStaffShop(staff);
  renderSellersAdmin();
  renderStaffArchiveShop();
}
var _selectedStatus2='';
function renderStaffStatusChips2(){
  var c=document.getElementById('staffStatusChips2'); if(!c) return;
  var statuses=getRefBook('iz_employee_statuses');
  var options=[''].concat(statuses);
  c.innerHTML=options.map(function(s){
    var name=s.name||s||'';
    var label=name||'— не указан —';
    var active=(_selectedStatus2===name);
    return '<button type="button" onclick="pickStaffStatus2(\''+name+'\')" style="padding:8px 14px;border-radius:10px;font-size:12px;cursor:pointer;border:1px solid '+(active?'#c8f060':'#2e2e3e')+';background:'+(active?'#1e2a14':'#1a1a22')+';color:'+(active?'#c8f060':'#f0f0f8')+'">'+label+'</button>';
  }).join('');
}
function pickStaffStatus2(name){
  _selectedStatus2=name;
  renderStaffStatusChips2();
}
function openAddStaffModalShop(){
  var shops=getShops();
  var container=document.getElementById('staffShopsList2');
  if(container){
    container.innerHTML=shops.map(function(sh){
      var name=sh.name||sh;
      return '<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer">'+
        '<input type="checkbox" value="'+name+'" data-shopcheck="1" style="width:14px;height:14px"> '+name+'</label>';
    }).join('');
  }
  _selectedStatus2='';
  renderStaffStatusChips2();
  ['staffName2','staffPass2','staffWsRate2'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  document.querySelectorAll('#staffRolesBlock2 input[type=checkbox]').forEach(function(cb){ cb.checked=false; });
  document.getElementById('staffMo2Title').textContent='👤 Добавить сотрудника';
  _editStaffIdx=-1;
  openMo('staffMo2');
}
var _editStaffIdx=-1;
function editStaffShop(idx){
  var staff=getStaff();
  var s=staff[idx]; if(!s) return;
  _editStaffIdx=idx;
  var shops=getShops();
  var container=document.getElementById('staffShopsList2');
  if(container){
    container.innerHTML=shops.map(function(sh){
      var name=sh.name||sh;
      var checked=s.shops && s.shops.indexOf(name)>=0?'checked':'';
      return '<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer">'+
        '<input type="checkbox" value="'+name+'" data-shopcheck="1" '+checked+' style="width:14px;height:14px"> '+name+'</label>';
    }).join('');
  }
  _selectedStatus2=s.status||'';
  renderStaffStatusChips2();
  document.getElementById('staffName2').value=s.name||'';
  document.getElementById('staffPass2').value=s.pass||'';
  document.getElementById('staffWsRate2').value=s.wsRate||'';
  document.querySelectorAll('#staffRolesBlock2 input[type=checkbox]').forEach(function(cb){
    cb.checked = s.roles && s.roles.indexOf(cb.value)>=0;
  });
  document.getElementById('staffMo2Title').textContent='✏️ Редактировать сотрудника';
  openMo('staffMo2');
}
function saveUnifiedStaffShop(){
  var name=gv('staffName2').trim();
  var pass=gv('staffPass2').trim();
  if(!name||!pass){showToast('Введите имя и пароль');return;}
  var roles=[];
  document.querySelectorAll('#staffRolesBlock2 input[type=checkbox]:checked').forEach(function(cb){ roles.push(cb.value); });
  var shops2=[];
  document.querySelectorAll('#staffShopsList2 input[type=checkbox]:checked').forEach(function(cb){ shops2.push(cb.value); });
  if(shops2.length && roles.indexOf('seller')<0){ roles.push('seller'); }
  if(!roles.length){showToast('Выберите хотя бы одну роль');return;}
  var shops=[];
  document.querySelectorAll('#staffShopsList2 input[type=checkbox]:checked').forEach(function(cb){ shops.push(cb.value); });
  var wsRate=parseFloat(gv('staffWsRate2'))||0;
  var status=_selectedStatus2||'';
  var staff=getStaff();
  var entryBase, prev=null;
  if(_editStaffIdx>=0 && staff[_editStaffIdx]){
    var existing=staff[_editStaffIdx];
    prev=existing;
    var collision=staff.findIndex(function(s,i){return i!==_editStaffIdx && (s.name||'').trim().toLowerCase()===name.toLowerCase();});
    if(collision>=0){showToast('Сотрудник с таким именем уже есть (см. блок ⚠️ в списке, если его не видно)');return;}
    entryBase=existing;
  } else {
    if(staff.some(function(s){return (s.name||'').trim().toLowerCase()===name.toLowerCase();})){showToast('Сотрудник с таким именем уже есть (см. блок ⚠️ в списке, если его не видно)');return;}
    entryBase={blocked:false,blockedByStatus:false,createdAt:new Date().toISOString()};
  }
  var blocked=entryBase.blocked||false;
  var blockedByStatus=entryBase.blockedByStatus||false;
  if(status==='Уволен'){
    if(!blocked){ blocked=true; blockedByStatus=true; }
  } else if(blockedByStatus && status!=='Уволен'){
    blocked=false; blockedByStatus=false;
  }
  var entry=Object.assign({}, entryBase, {
    id: entryBase.id||uid(), name:name, pass:pass, roles:roles, shops:shops, wsRate:wsRate, status:status,
    blocked:blocked, blockedByStatus:blockedByStatus,
    updatedAt:new Date().toISOString()
  });
  if(_editStaffIdx>=0 && staff[_editStaffIdx]) staff[_editStaffIdx]=entry; else staff.push(entry);
  saveStaffShop(staff);
  closeMo('staffMo2');
  renderSellersAdmin();
  var prevBlocked=prev?(prev.blocked||false):false;
  var msg='✅ Сотрудник сохранён';
  if(blocked && !prevBlocked) msg+=' · 🚫 доступ автоматически заблокирован (статус «Уволен»)';
  else if(!blocked && prevBlocked && prev && prev.blockedByStatus) msg+=' · ✅ доступ автоматически разблокирован';
  showToast(msg);
}
