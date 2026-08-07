function _downloadJSON(filename, dataObj){
  try{
    var blob = new Blob([JSON.stringify(dataObj, null, 2)], {type:'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    showToast('✅ Файл сохранён: '+filename);
  }catch(e){
    showToast('❌ Не удалось скачать: '+(e&&e.message||e));
  }
}
function _todayStr(){ return new Date().toISOString().split('T')[0]; }
function _lsGet(key){ try{ return JSON.parse(localStorage.getItem(key)||'null'); }catch(e){ return null; } }
function exportFullBackup(){
  var data = {
    exportedAt: new Date().toISOString(),
    exportType: 'full_backup',
    shifts: _lsGet(KEY.shifts),
    manualInvoices: _lsGet('iz_manual_invoices'),
    invoices: _lsGet('iz_invoices'),
    stock: _lsGet('iz_stock'),
    items: _lsGet('iz_items'),
    goodsDerevo: _lsGet('iz_goods_derevo'),
    goodsDr: _lsGet('iz_goods_dr'),
    suppliers: _lsGet('iz_suppliers'),
    shopAdmins: _lsGet('iz_shop_admins'),
    sellers: _lsGet('iz_sellers'),
    shopZpSettings: _lsGet('iz_shop_zp_settings'),
    shopRent: _lsGet('iz_shop_rent'),
    trash: _lsGet(KEY.trash)
  };
  _downloadJSON('izhitsa-backup-полный-'+_todayStr()+'.json', data);
}
function exportShiftsData(){
  _downloadJSON('izhitsa-смены-'+_todayStr()+'.json', {exportedAt:new Date().toISOString(), shifts:_lsGet(KEY.shifts)});
}
function exportInvoicesData(){
  _downloadJSON('izhitsa-накладные-'+_todayStr()+'.json', {exportedAt:new Date().toISOString(), manualInvoices:_lsGet('iz_manual_invoices'), invoices:_lsGet('iz_invoices')});
}
function exportStockData(){
  _downloadJSON('izhitsa-остатки-склада-'+_todayStr()+'.json', {exportedAt:new Date().toISOString(), stock:_lsGet('iz_stock')});
}
function exportCatalogData(){
  _downloadJSON('izhitsa-каталог-товаров-'+_todayStr()+'.json', {exportedAt:new Date().toISOString(), items:_lsGet('iz_items'), goodsDerevo:_lsGet('iz_goods_derevo'), goodsDr:_lsGet('iz_goods_dr'), suppliers:_lsGet('iz_suppliers')});
}
function exportStaffData(){
  _downloadJSON('izhitsa-сотрудники-'+_todayStr()+'.json', {exportedAt:new Date().toISOString(), shopAdmins:_lsGet('iz_shop_admins'), sellers:_lsGet('iz_sellers')});
}
function exportSettingsData(){
  _downloadJSON('izhitsa-настройки-'+_todayStr()+'.json', {exportedAt:new Date().toISOString(), shopZpSettings:_lsGet('iz_shop_zp_settings'), shopRent:_lsGet('iz_shop_rent')});
}
function _loadXLSXLib(cb){
  if(typeof XLSX!=='undefined'){ cb(); return; }
  showToast('⏳ Загружаю модуль Excel...');
  var s=document.createElement('script');
  s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  s.onload=function(){ cb(); };
  s.onerror=function(){ showToast('❌ Не удалось загрузить модуль Excel — нужен интернет хотя бы один раз для этого'); };
  document.head.appendChild(s);
}
function _downloadExcel(filename, sheetName, headers, rows){
  var ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
  showToast('✅ Файл сохранён: '+filename);
}
function exportShiftsExcel(){
  _loadXLSXLib(function(){
    var shifts = _lsGet(KEY.shifts)||[];
    var headers = ['Дата','Магазин','Продавец','Статус','Открыта','Закрыта',
      'Выручка нал (Дерево)','Выручка безнал (Дерево)','Скидка (Дерево)',
      'Выручка нал (ДР)','Выручка безнал (ДР)','Скидка (ДР)',
      'Остаток утро Дерево','Остаток вечер Дерево','Остаток утро ДР','Остаток вечер ДР',
      'Нал утро','Нал вечер (расч.)','Нал вечер (факт)','Итого расходы'];
    var rows = shifts.map(function(s){
      var exps=(s.journal||[]).filter(function(e){return e.type==='expense';});
      var totExp=exps.reduce(function(a,e){return a+(e.amount||0);},0);
      var goodsDrEve = s.drGoodsEvening!=null ? s.drGoodsEvening : s.goodsDrEvening;
      var calcEve = (s.cashMorning||0) + (s.journal||[]).reduce(function(a,e){return a+(e.cashEffect||0);},0);
      return [
        s.date||'', s.shopName||'', (s.sellerName||'').replace(/^Восст\.\s*/,''), s.status||'',
        s.openedAt||'', s.closedAt||'',
        s.cashRevenue||0, s.cardRevenue||0, s.totalDiscount||0,
        s.drCashRevenue||0, s.drCardRevenue||0, s.drDiscount||0,
        s.goodsMorning||0, s.goodsEvening||0, s.goodsDrMorning||0, goodsDrEve||0,
        s.cashMorning||0, calcEve, s.cashEvening!=null?s.cashEvening:'',
        totExp
      ];
    });
    _downloadExcel('izhitsa-смены-'+_todayStr()+'.xlsx','Смены',headers,rows);
  });
}
function exportReceivesExcel(){
  _loadXLSXLib(function(){
    var shifts = _lsGet(KEY.shifts)||[];
    var headers = ['Дата','Время','Магазин','Продавец','Тип товара','Откуда/поставщик','Число позиций','Сумма','Накладная'];
    var rows = [];
    shifts.forEach(function(s){
      (s.journal||[]).filter(function(e){return e.type==='receive';}).forEach(function(e){
        var timePart = (e.ts||'').split('T')[1]||'';
        rows.push([
          s.date||'', timePart.slice(0,5), s.shopName||'', (s.sellerName||'').replace(/^Восст\.\s*/,''),
          e.goodsType==='dr'?'ДР':'Дерево', (e.sub||'').split('·')[0].trim()||'', 
          (e.items||[]).length||'', e.amount||0, e.label||''
        ]);
      });
    });
    rows.sort(function(a,b){ return (a[0]+a[1]).localeCompare(b[0]+b[1]); });
    _downloadExcel('izhitsa-приходы-'+_todayStr()+'.xlsx','Приходы',headers,rows);
  });
}
function exportWriteoffsExcel(){
  _loadXLSXLib(function(){
    var shifts = _lsGet(KEY.shifts)||[];
    var headers = ['Дата','Время','Магазин','Продавец','Тип товара','Причина','Сумма'];
    var rows = [];
    shifts.forEach(function(s){
      (s.journal||[]).filter(function(e){return e.type==='writeoff';}).forEach(function(e){
        var timePart = (e.ts||'').split('T')[1]||'';
        var items = e.items||[];
        if(items.length){
          items.forEach(function(it){
            rows.push([
              s.date||'', timePart.slice(0,5), s.shopName||'', (s.sellerName||'').replace(/^Восст\.\s*/,''),
              e.goodsType==='dr'?'ДР':'Дерево', it.reason||e.label||'', it.amt||0
            ]);
          });
        } else {
          rows.push([
            s.date||'', timePart.slice(0,5), s.shopName||'', (s.sellerName||'').replace(/^Восст\.\s*/,''),
            e.goodsType==='dr'?'ДР':'Дерево', e.reason||e.label||'', e.amount||0
          ]);
        }
      });
    });
    rows.sort(function(a,b){ return (a[0]+a[1]).localeCompare(b[0]+b[1]); });
    _downloadExcel('izhitsa-списания-'+_todayStr()+'.xlsx','Списания',headers,rows);
  });
}
var RESTORE_SHIFT_KEY = 'iz_restore_shift';
var _restoreShift = null;
function getRestoreShift(){
  try{ return JSON.parse(localStorage.getItem(RESTORE_SHIFT_KEY)||'null'); }catch(e){ return null; }
}
function saveRestoreShift(sh){
  if(sh) localStorage.setItem(RESTORE_SHIFT_KEY, JSON.stringify(sh));
  else localStorage.removeItem(RESTORE_SHIFT_KEY);
}
function rstShiftPopulateSellers(){
  var shop = (document.getElementById('rstShiftShop')||{}).value || '';
  var sel = document.getElementById('rstShiftSeller');
  if(session && session.sellerRestoreMode){
    if(sel){ sel.innerHTML = '<option value="'+session.restrictedSellerId+'">'+session.restrictedSellerName+'</option>'; sel.disabled=true; }
    return;
  }
  var sellers = getSellers().filter(function(s){ return !s.blocked && (!s.shops || !s.shops.length || s.shops.indexOf(shop)>=0); });
  if(sel){ sel.disabled=false; sel.innerHTML = sellers.map(function(s){ return '<option value="'+s.id+'">'+s.name+'</option>'; }).join(''); }
}
function initRestoreShiftUI(){
  var shops = getShopNames();
  if(session && session.sellerRestoreMode && session.restrictedShops){
    shops = shops.filter(function(s){ return session.restrictedShops.indexOf(s)>=0; });
  }
  var shopSel = document.getElementById('rstShiftShop');
  if(shopSel){
    shopSel.innerHTML = shops.map(function(s){ return '<option>'+s+'</option>'; }).join('');
    shopSel.disabled = !!(session && session.sellerRestoreMode && shops.length<=1);
  }
  rstShiftPopulateSellers();
  var d = document.getElementById('rstShiftDate');
  if(d && !d.value) d.value = new Date().toISOString().split('T')[0];
  if(d) d.max = new Date().toISOString().split('T')[0]; // a "past" shift can't be in the future
  var restricted = !!(session && session.sellerRestoreMode);
  var invBtn = document.getElementById('rst_tab_invoices');
  var jrnBtn = document.getElementById('rst_tab_journal');
  var actBtn = document.getElementById('rst_tab_activate');
  var openToggleBtn = document.getElementById('rstSh_open');
  var listToggleBtn = document.getElementById('rstSh_list');
  if(invBtn) invBtn.style.display = restricted ? '' : 'none';
  if(jrnBtn) jrnBtn.style.display = restricted ? '' : 'none';
  if(actBtn) actBtn.style.display = restricted ? 'none' : '';
  var visibleTabCount = restricted ? 3 : 2; // (накл+журнал+смены) vs (активация+смены)
  var grid = document.getElementById('rstTabsGrid');
  if(grid) grid.style.gridTemplateColumns = Array(visibleTabCount).fill('1fr').join(' ');
  if(openToggleBtn) openToggleBtn.style.display = restricted ? '' : 'none';
  if(listToggleBtn) listToggleBtn.style.display = restricted ? 'none' : '';
  _restoreShift = restricted ? getRestoreShift() : null;
  if(!restricted){
    switchRstShTab('list');
  } else {
    renderRestoreShiftState();
  }
}
function renderRestoreShiftState(){
  var closedBlock = document.getElementById('rstShiftClosed');
  var openBlock = document.getElementById('rstShiftOpen');
  var mainBlock = document.getElementById('rstMainBlock');
  if(!closedBlock || !openBlock || !mainBlock) return;
  if(_restoreShift && _restoreShift.shop && _restoreShift.date){
    closedBlock.style.display = 'none';
    openBlock.style.display = 'block';
    document.getElementById('rstShiftSummary').textContent =
      '🏪 ' + _restoreShift.shop + ' · 👤 ' + (_restoreShift.sellerName||'—') + ' · 📅 ' + _restoreShift.date;
    var psjShop = document.getElementById('psjShop');
    if(psjShop){ psjShop.innerHTML = '<option>'+_restoreShift.shop+'</option>'; psjShop.value = _restoreShift.shop; }
    var psjSeller = document.getElementById('psjSeller');
    if(psjSeller){ psjSeller.innerHTML = '<option value="'+(_restoreShift.sellerId||'')+'">'+(_restoreShift.sellerName||'')+'</option>'; psjSeller.value = _restoreShift.sellerId||''; }
    var psjDate = document.getElementById('psjDate');
    if(psjDate){ psjDate.value = _restoreShift.date; }
    var info = document.getElementById('rstjShiftInfo');
    if(info) info.textContent = '🏪 ' + _restoreShift.shop + ' · 👤 ' + (_restoreShift.sellerName||'—') + ' · 📅 ' + _restoreShift.date;
    ['rstInvShop','rstActShop'].forEach(function(id){
      var el=document.getElementById(id); if(el && el.tagName==='SELECT'){
        var opt=Array.prototype.find.call(el.options, function(o){return o.value===_restoreShift.shop || o.text===_restoreShift.shop;});
        if(opt) el.value = opt.value;
      }
    });
    var psShopEl = document.getElementById('psShop');
    if(psShopEl){ psShopEl.innerHTML = '<option>'+_restoreShift.shop+'</option>'; psShopEl.value = _restoreShift.shop; }
    var psSellerEl = document.getElementById('psSeller');
    if(psSellerEl){ psSellerEl.innerHTML = '<option>'+(_restoreShift.sellerName||'')+'</option>'; psSellerEl.value = _restoreShift.sellerName||''; }
    var psDateEl = document.getElementById('psDate');
    if(psDateEl){ psDateEl.value = _restoreShift.date; }
    ['rstInvDate'].forEach(function(id){
      var el=document.getElementById(id); if(el && !el.value) el.value=_restoreShift.date;
    });
    psjLoadJournal();
    try{ psSyncFromJournal(); }catch(e){}
  } else {
    closedBlock.style.display = 'block';
    openBlock.style.display = 'none';
  }
  updateRstMainBlockVisibility();
}
function enterRestoreMode(meta){
  if(session && !restoreMode){
    localStorage.setItem(KEY.liveSessionBackup, JSON.stringify(session));
    localStorage.setItem(KEY.liveJournalBackup, JSON.stringify(journal));
  }
  restoreMode = true;
  restoreMeta = meta;
  var savedRestoreSession = JSON.parse(localStorage.getItem(KEY.restoreSession)||'null');
  var savedRestoreJournal = JSON.parse(localStorage.getItem(KEY.restoreJournal)||'[]');
  if(savedRestoreSession && savedRestoreSession.shopName===meta.shop && savedRestoreSession.sellerId===meta.sellerId
     && savedRestoreSession.openedAt && savedRestoreSession.openedAt.indexOf(meta.date)===0){
    session = savedRestoreSession;
    journal = savedRestoreJournal;
    startApp();
    syncRestoreUIChrome();
    showToast('📂 Восстановлена незавершённая смена восстановления');
    return;
  }
  localStorage.removeItem(KEY.restoreJournal);
  localStorage.removeItem(KEY.restoreSession);
  session = null; journal = [];
  pendingSession = {shopName:meta.shop, sellerName:'Восст. '+(meta.sellerName||''), sellerId:meta.sellerId, _restoreOpenedAt: meta.date+'T09:00:00.000Z', isRestoreShift:true};
  openMorningModal();
}
function exitRestoreMode(opts){
  opts = opts || {};
  if(session && session.shiftId && !opts._closedProperly){
    try{
      db.collection('iz_shifts').where('shopName','==',session.shopName)
        .where('status','==','open').get().then(function(snap){
          snap.forEach(function(doc){
            if(doc.data().isRestoreShift || doc.data().closedByRestore ||
               doc.id===session.shiftId){
              doc.ref.delete();
            }
          });
        });
    }catch(e){}
  }
  restoreMode = false;
  restoreMeta = null;
  try{ syncRestoreUIChrome(); }catch(e){}
  var liveS = JSON.parse(localStorage.getItem(KEY.liveSessionBackup)||'null');
  var liveJ = JSON.parse(localStorage.getItem(KEY.liveJournalBackup)||'[]');
  document.getElementById('mainTabs').style.display='none';
  document.getElementById('appScreen').style.display='none';
  document.getElementById('loginScreen').style.display='none';
  if(liveS){
    session = liveS; journal = liveJ;
    localStorage.removeItem(KEY.liveSessionBackup);
    localStorage.removeItem(KEY.liveJournalBackup);
    if(session.role==='shopadmin' && !session.sellerRestoreMode){ startAdminApp(); }
    else if(session.sellerRestoreMode){ startSellerRestoreApp(); }
    else { startApp(); syncLiveShift(); }
    switchRst('shifts');
    renderRestoreShiftState();
  } else {
    session = null; journal = [];
    document.getElementById('loginScreen').style.display='flex';
    pick('seller');
  }
}
function syncRestoreUIChrome(){
  _updateManInvJsonBlock();
  _updateManInvJsonBlock();
  var banner = document.getElementById('restoreModeBanner');
  var btnWrap = document.getElementById('restoreImportBtnWrap');
  if(btnWrap) btnWrap.style.display = restoreMode ? 'block' : 'none';
  if(!banner) return;
  banner.style.display = restoreMode ? 'flex' : 'none';
  if(restoreMode && restoreMeta){
    banner.querySelector('span').textContent = '🕘 Восстановление: '+restoreMeta.shop+' · '+restoreMeta.date;
  }
}
function openRestoreShift(){
  var shop = gv('rstShiftShop');
  var sellerSel = document.getElementById('rstShiftSeller');
  var sellerId = sellerSel ? sellerSel.value : '';
  var sellerName = sellerSel && sellerSel.selectedIndex>=0 ? sellerSel.options[sellerSel.selectedIndex].text : '';
  var date = gv('rstShiftDate');
  if(!shop || !date){ showToast('Выберите магазин и дату'); return; }
  if(session && session.sellerRestoreMode){
    if(sellerId!==session.restrictedSellerId){ showToast('⛔ Можно вносить только свою смену'); return; }
    if(session.restrictedShops && session.restrictedShops.indexOf(shop)<0){ showToast('⛔ Этот магазин недоступен'); return; }
  }
  if(date>=new Date().toISOString().split('T')[0]){ showToast('⛔ Можно восстановить только прошедший день'); return; }
  enterRestoreMode({shop:shop, sellerId:sellerId, sellerName:sellerName, date:date});
}
function closeRestoreShift(){
  if(!confirm('Закрыть смену восстановления? Уже внесённые записи останутся сохранёнными.')) return;
  _restoreShift = null;
  saveRestoreShift(null);
  renderRestoreShiftState();
  showToast('🔒 Смена восстановления закрыта');
}
function goToRestoreShiftCheck(){
  switchRst('shifts');
  try{ psSyncFromJournal(); }catch(e){}
  showToast('📊 Сверьте кассу и остаток товара, затем нажмите «Подтвердить и закрыть смену»');
}
function confirmAndCloseRestoreShift(){
  var cashMorn=gv('psCashMorn'), cashEve=gv('psCashEve');
  if(cashMorn===''||cashEve===''){
    if(!confirm('Поля кассы (нал утро/вечер) не заполнены. Закрыть смену без проверки?')) return;
  }
  if(!confirm('Подтвердить и закрыть смену восстановления?')) return;
  var wasRestricted = !!(session && session.sellerRestoreMode);
  _restoreShift = null;
  saveRestoreShift(null);
  renderRestoreShiftState();
  if(wasRestricted){
    showToast('🔒 Смена сохранена. Администратор проверит и подтвердит её в общей статистике.');
  } else {
    switchRstShTab('list');
    showToast('🔒 Смена восстановления закрыта и проверена');
  }
}
var _rstShTab = 'open';
function switchRstShTab(tab){
  _rstShTab = tab;
  var isOpen = tab==='open';
  document.getElementById('rstSh_open_tab').style.display = isOpen?'block':'none';
  document.getElementById('rstSh_list_tab').style.display = isOpen?'none':'block';
  var b1=document.getElementById('rstSh_open'), b2=document.getElementById('rstSh_list');
  if(b1){ b1.style.borderWidth=isOpen?'2px':'1px'; b1.style.background=isOpen?'#1e2a14':'#22222e'; b1.style.color=isOpen?'#c8f060':'#8888aa'; b1.style.borderColor=isOpen?'#c8f060':'#2e2e3e'; b1.style.fontWeight=isOpen?'700':'400'; }
  if(b2){ b2.style.borderWidth=isOpen?'1px':'2px'; b2.style.background=isOpen?'#22222e':'#1e2a14'; b2.style.color=isOpen?'#8888aa':'#c8f060'; b2.style.borderColor=isOpen?'#2e2e3e':'#c8f060'; b2.style.fontWeight=isOpen?'400':'700'; }
  if(!isOpen) renderRestoreShiftsList();
  updateRstMainBlockVisibility();
}
function updateRstMainBlockVisibility(){
  var mainBlock = document.getElementById('rstMainBlock'); if(!mainBlock) return;
  var shiftCard = document.getElementById('rstShiftCard');
  if(restoreMode && session && session.shopName){
    if(shiftCard) shiftCard.style.display = 'none';
    mainBlock.style.display = 'block';
    return;
  }
  if(shiftCard) shiftCard.style.display = 'block';
  var shouldShow = _rstShTab==='open' && !!(_restoreShift && _restoreShift.shop && _restoreShift.date);
  mainBlock.style.display = shouldShow ? 'block' : 'none';
}
function renderRestoreShiftsList(){
  var c=document.getElementById('rstShiftsList'); if(!c) return;
  var entries = getPsjEntries();
  if(!entries.length){ c.innerHTML='<div class="empty"><div class="ei">📋</div>Нет смен восстановления</div>'; return; }
  var groups = {};
  entries.forEach(function(e){
    var shopKey = e.shopName || '';
    var key = shopKey+'|'+e.date;
    if(!groups[key]) groups[key] = {shop:(e.shopName||null), date:e.date, sellerName:e.sellerName||'', count:0, revenue:0, activated:true};
    var g = groups[key];
    g.count++;
    if(e.type==='sale') g.revenue += (e.cashEffect||0)+(e.cardEffect||0)+(e.discEffect||0);
    if(!e.activated) g.activated = false;
    if(e.sellerName) g.sellerName = e.sellerName;
  });
  var list = Object.keys(groups).map(function(k){ return groups[k]; });
  list.sort(function(a,b){ return b.date.localeCompare(a.date); });
  c.innerHTML = list.map(function(g){
    var statusBadge = g.activated
      ? '<span style="font-size:10px;background:#1e2a14;color:#60f090;border:1px solid #60f090;border-radius:6px;padding:2px 6px">✅ Активировано</span>'
      : '<span style="font-size:10px;background:#2a1e14;color:#f0a060;border:1px solid #f0a060;border-radius:6px;padding:2px 6px">🕐 Не активировано</span>';
    var shopLabel = g.shop ? g.shop : '⚠ без магазина';
    var shopArg = g.shop ? "'"+g.shop.replace(/'/g,"\\'")+"'" : 'null';
    return '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:12px;padding:10px;margin-bottom:8px">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'+
        '<div>'+
          '<div class="u-fs13-bold">🏪 '+shopLabel+' · 📅 '+g.date+'</div>'+
          '<div style="font-size:11px;color:#8888aa;margin-top:2px">👤 '+(g.sellerName||'—')+' · 📒 '+g.count+' записей'+(g.revenue?' · 💰 '+Math.round(g.revenue).toLocaleString('ru-RU')+'₽':'')+'</div>'+
        '</div>'+
        statusBadge+
      '</div>'+
      '<div class="u-flex-g6">'+
        '<button onclick="reopenRestoreShift('+shopArg+',\''+g.date+'\')" style="flex:1;background:none;border:1px solid #c8f060;border-radius:8px;padding:6px 8px;font-size:12px;color:#c8f060;cursor:pointer">📂 Открыть</button>'+
        (g.activated
          ? '<button onclick="activateRestoreShift('+shopArg+',\''+g.date+'\')" style="flex:1;background:none;border:1px solid #60f090;border-radius:8px;padding:6px 8px;font-size:12px;color:#60f090;cursor:pointer">🔄 Обновить в архиве</button>'
          : '<button onclick="activateRestoreShift('+shopArg+',\''+g.date+'\')" style="flex:1;background:none;border:1px solid #60f090;border-radius:8px;padding:6px 8px;font-size:12px;color:#60f090;cursor:pointer">✅ Активировать</button>')+
        '<button onclick="deleteRestoreShift('+shopArg+',\''+g.date+'\')" style="flex:0 0 40px;background:none;border:1px solid #f06060;border-radius:8px;padding:6px 4px;font-size:13px;color:#f06060;cursor:pointer">✕</button>'+
      '</div>'+
    '</div>';
  }).join('');
}
function deleteRestoreShift(shop, date){
  var label = (shop===null ? '⚠ без магазина' : shop) + ' · ' + date;
  if(!confirm('Удалить смену "'+label+'" и ВСЕ её записи журнала ('+
    getPsjEntries().filter(function(e){ return (shop===null ? !e.shopName : e.shopName===shop) && e.date===date; }).length+
    ')? Действие необратимо.')) return;
  var toDelete = [], toKeep = [];
  getPsjEntries().forEach(function(e){
    var matches = (shop===null ? !e.shopName : e.shopName===shop) && e.date===date;
    if(matches) toDelete.push(e); else toKeep.push(e);
  });
  savePsjEntries(toKeep);
  toDelete.forEach(function(e){
    try{ db.collection('iz_psj').doc(e.id).delete(); }catch(err){}
  });
  if(_restoreShift && (shop===null ? !_restoreShift.shop : _restoreShift.shop===shop) && _restoreShift.date===date){
    _restoreShift = null;
    saveRestoreShift(null);
    renderRestoreShiftState();
  }
  renderRestoreShiftsList();
  showToast('🗑 Смена удалена ('+toDelete.length+' записей)');
}
function reopenRestoreShift(shop, date){
  var entries = getPsjEntries().filter(function(e){ return (shop===null ? !e.shopName : e.shopName===shop) && e.date===date; });
  var sellerName = '';
  for(var i=entries.length-1;i>=0;i--){ if(entries[i].sellerName){ sellerName=entries[i].sellerName; break; } }
  var sellerId = '';
  var sellers = getSellers();
  var match = sellers.find(function(s){ return s.name===sellerName; });
  if(match) sellerId = match.id;
  _restoreShift = {shop:(shop||''), sellerId:sellerId, sellerName:sellerName, date:date, openedAt:new Date().toISOString()};
  saveRestoreShift(_restoreShift);
  switchRstShTab('open');
  renderRestoreShiftState();
  switchRst('shifts');
  showToast('📂 Смена открыта для проверки: '+(shop||'(без магазина)')+' · '+date);
}
function activateRestoreShift(shop, date){
  if(!confirm('Активировать смену '+(shop||'(без магазина)')+' · '+date+'? Данные войдут в общую статистику.')) return;
  var entries = getPsjEntries();
  var activated = 0;
  entries.forEach(function(e){
    if((shop===null ? !e.shopName : e.shopName===shop) && e.date===date && !e.activated){
      e.activated=true; e.activatedAt=new Date().toISOString(); activated++;
    }
  });
  savePsjEntries(entries);
  var entriesForShift = entries.filter(function(e){
    return (shop===null ? !e.shopName : e.shopName===shop) && e.date===date;
  });
  if(entriesForShift.length){
    var sellerName = '';
    for(var i=entriesForShift.length-1;i>=0;i--){ if(entriesForShift[i].sellerName){ sellerName=entriesForShift[i].sellerName; break; } }
    var cashRev=0, cardRev=0, disc=0, exp=0, zpExp=0, travelExp=0, inkassExp=0;
    var journalForShift = entriesForShift.map(function(e){
      cashRev += e.cashEffect||0; cardRev += e.cardEffect||0; disc += e.discEffect||0;
      if(e.type==='expense'){
        exp += e.amount||0;
        if(e.expType==='zp') zpExp += e.amount||0;
        else if(e.expType==='travel') travelExp += e.amount||0;
        else if(e.expType==='inkass') inkassExp += e.amount||0;
      }
      return { id:e.id, type:e.type, ts:e.date+'T12:00:00.000Z', icon: {sale:'💰',writeoff:'🗑️',receive:'📥',expense:'💸',staff:'🛒'}[e.type]||'📝',
        label:e.label, sub:e.sub, amount:e.amount, amtCls:e.type==='sale'?'pos':'exp', amtSign:e.amtSign,
        goodsType: e.goodsType, items: e.items, who: e.who, opt: e.opt, retail: e.retail, from: e.from, expType: e.expType,
        cashEffect:e.cashEffect||0, cardEffect:e.cardEffect||0, staffEffect:0, goodsEffect: e.type==='sale'?-(e.amount||0): e.type==='receive'?(e.amount||0): e.type==='writeoff'?-(e.amount||0):0 };
    });
    var shiftObj = {
      id: uid(), source: 'psj', isArchive: true, backfilled: true, activated: true, activatedAt: new Date().toISOString(),
      shopName: shop||'', sellerName: sellerName, date: date,
      openedAt: date+'T09:00:00.000Z', closedAt: date+'T21:00:00.000Z', status: 'closed',
      cashRevenue: cashRev, cardRevenue: cardRev, totalDiscount: disc,
      totalRevenue: cashRev + cardRev + disc,
      salesCount: journalForShift.filter(function(e){return e.type==='sale';}).length,
      zp: zpExp, travel: travelExp, inkass: inkassExp,
      otherExp: exp - zpExp - travelExp - inkassExp,
      supplierExp: journalForShift.filter(function(e){return e.type==='expense'&&e.expType==='supplier'&&e.goodsType!=='dr';}).reduce(function(s,e){return s+e.amount;},0),
      drInkass: journalForShift.filter(function(e){return e.type==='expense'&&e.expType==='inkass'&&e.goodsType==='dr';}).reduce(function(s,e){return s+e.amount;},0),
      drSupplierAmt: journalForShift.filter(function(e){return e.type==='expense'&&e.expType==='supplier'&&e.goodsType==='dr';}).reduce(function(s,e){return s+e.amount;},0),
      expenses: journalForShift.filter(function(e){return e.type==='expense';}),
      journal: journalForShift,
      savedAt: new Date().toISOString(), savedBy: (session&&session.name)||'Admin'
    };
    var shifts = getShifts();
    var oldPsjShifts = shifts.filter(function(s){ return s.date===date && s.shopName===(shop||'') && s.source==='psj'; });
    shifts = shifts.filter(function(s){ return !(s.date===date && s.shopName===(shop||'') && s.source==='psj'); });
    shifts.unshift(shiftObj);
    saveShifts(shifts);
    try {
      oldPsjShifts.forEach(function(old){
        var oldId = old.id || old._id;
        if(oldId) db.collection('iz_shifts').doc(oldId).delete().catch(function(){});
      });
      db.collection('iz_shifts').doc(shiftObj.id).set(shiftObj);
    } catch(e) {}
  }
  var acts=JSON.parse(localStorage.getItem('iz_activations')||'[]');
  acts.unshift({id:uid(), from:date, to:date, shopName:shop, activatedAt:new Date().toISOString(), count:activated, by:(session&&session.name)||'Admin'});
  localStorage.setItem('iz_activations', JSON.stringify(acts));
  renderRestoreShiftsList();
  try{ renderActivatedList(); }catch(e){}
  showToast(entriesForShift.length ? ('✅ Смена обновлена в архиве ('+entriesForShift.length+' записей)') : '✅ Активировано '+activated+' записей');
}
function psjDiagnostic(){
  var rj = localStorage.getItem('iz_restore_journal');
  var rs = localStorage.getItem('iz_restore_session');
  var psjRaw = localStorage.getItem('iz_psj');
  var psjEntries = JSON.parse(psjRaw||'[]');
  var msg = 'iz_restore_journal: '+(rj?JSON.parse(rj).length+' записей':'пусто')+'\n';
  msg += 'iz_restore_session: '+(rs?'есть':'пусто')+'\n';
  msg += 'iz_psj: '+psjEntries.length+' записей\n';
  if(psjEntries.length){
    var last = psjEntries.slice(-5);
    last.forEach(function(e){
      msg += '  '+e.date+' '+e.type+' '+e.shopName+' '+Math.round(e.amount||0)+'₽\n';
    });
  }
  db.collection('iz_psj').orderBy('createdAt','desc').limit(10).get({source:'server'}).then(function(snap){
    var msg2 = 'Firestore iz_psj: '+snap.size+' документов\n';
    snap.forEach(function(d){
      var data=d.data();
      msg2+='  '+data.date+' '+data.type+' '+data.shopName+' '+Math.round(data.amount||0)+'₽\n';
    });
    alert(msg2);
  }).catch(function(e){ alert('Firestore error: '+e.message); });
  alert(msg);
}
function psjInit() {
  renderRestoreShiftState();
}
var PSJ_KEY = 'iz_psj';
function getPsjEntries() {
  return JSON.parse(localStorage.getItem(PSJ_KEY) || '[]');
}
function savePsjEntries(entries) {
  localStorage.setItem(PSJ_KEY, JSON.stringify(entries));
  try{
    entries.forEach(function(e){
      var docId = e.id || e._id;
      if(docId) db.collection('iz_psj').doc(docId).set(e, {merge:true}).catch(function(){});
    });
  }catch(ex){}
}
function psjLoadJournal() {
  var date = (document.getElementById('psjDate')||{}).value || '';
  var shop = (document.getElementById('psjShop')||{}).value || '';
  var entries = getPsjEntries().filter(function(e){ return e.date === date && e.shopName === shop; });
  var list = document.getElementById('psjList');
  if(!list) return;
  if(!entries.length) {
    list.innerHTML = '<div class="empty"><div class="ei">📒</div>Нет записей за этот день</div>';
    document.getElementById('psjDaySummary').style.display = 'none';
    return;
  }
  list.innerHTML = entries.map(function(e) {
    var icon = {sale:'💰',writeoff:'🗑️',receive:'📥',expense:'💸',staff:'🛒'}[e.type] || '📝';
    var color = {sale:'#60f090',writeoff:'#f06060',receive:'#60c8f0',expense:'#f0a060',staff:'#a060f0'}[e.type] || '#f0f0f8';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #2e2e3e">' +
      '<div>' +
        '<div class="u-fs13-bold">'+icon+' '+e.label+'</div>' +
        '<div style="font-size:11px;color:#8888aa;margin-top:2px">'+e.sub+'</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<div style="font-family:Unbounded,sans-serif;font-size:13px;font-weight:700;color:'+color+'">'+e.amtSign+(Math.round(e.amount||0)).toLocaleString('ru-RU')+'₽</div>' +
        '<button onclick="editPsjEntry(\''+e.id+'\')" style="background:none;border:1px solid #3e3e4e;border-radius:6px;padding:4px 7px;color:#c8f060;font-size:11px;cursor:pointer">✏️</button>' +
        '<button onclick="deletePsjEntry(\''+e.id+'\')" style="background:none;border:1px solid #3e2e2e;border-radius:6px;padding:4px 7px;color:#f06060;font-size:11px;cursor:pointer">✕</button>' +
      '</div>' +
    '</div>';
  }).join('');
  var totCash=0, totCard=0, totDisc=0, totExp=0;
  entries.forEach(function(e){
    if(e.type==='sale'){ totCash+=e.cashEffect||0; totCard+=e.cardEffect||0; totDisc+=e.discEffect||0; }
    if(e.type==='expense') totExp+=e.amount||0;
  });
  var totRev = totCash + totCard + totDisc;
  var summary = document.getElementById('psjDaySummary');
  summary.style.display = 'block';
  summary.innerHTML = '<div style="background:#1e2a14;border:1px solid #c8f060;border-radius:12px;padding:12px;margin-bottom:4px">' +
    '<div style="font-size:11px;color:#8888aa;margin-bottom:6px;font-weight:700">ИТОГИ ДНЯ — '+date+'</div>' +
    '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span style="color:#8888aa">💵 Нал</span><span style="color:#60f090;font-weight:700">'+Math.round(totCash).toLocaleString('ru-RU')+'₽</span></div>' +
    '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span style="color:#8888aa">💳 Безнал</span><span style="color:#60c8f0;font-weight:700">'+Math.round(totCard).toLocaleString('ru-RU')+'₽</span></div>' +
    (totDisc ? '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span style="color:#8888aa">🎁 Скидка</span><span style="color:#8888aa;font-weight:700">'+Math.round(totDisc).toLocaleString('ru-RU')+'₽</span></div>' : '') +
    '<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;padding:6px 0;border-top:1px solid #2e2e3e;margin-top:4px"><span>Итого выручка</span><span style="color:#c8f060">'+Math.round(totRev).toLocaleString('ru-RU')+'₽</span></div>' +
    (totExp ? '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span style="color:#8888aa">💸 Расходы</span><span style="color:#f06060;font-weight:700">'+Math.round(totExp).toLocaleString('ru-RU')+'₽</span></div>' : '') +
    '<button onclick="savePsjAsShift()" style="width:100%;margin-top:10px;padding:10px;border-radius:10px;border:none;background:#c8f060;color:#0f0f13;font-weight:700;font-size:13px;cursor:pointer">💾 Сохранить как отчёт за день</button>' +
  '</div>';
}
function deletePsjEntry(id) {
  var entries = getPsjEntries().filter(function(e){ return e.id !== id; });
  savePsjEntries(entries);
  try{ db.collection('iz_psj').doc(id).delete(); }catch(e){}
  psjLoadJournal();
}
var psjPayMethod = 'cash';
var _psjSaleItems = [], _psjWoItems = [], _psjRcvItems = [], _psjStaffItems = [];
var _psjEditEntryId = null, _psjEditType = null;
function _psjNewItem(extra){
  return Object.assign({art:'', name:'', species:'', price:0, qty:1, amt:0, goodsType:'derevo'}, extra||{});
}
var PSJ_MO_TITLES = {
  psjSaleMo:'Продажа (задним числом)', psjWriteoffMo:'Списание (задним числом)',
  psjReceiveMo:'Приход товара (задним числом)', psjExpenseMo:'Расходы (задним числом)',
  psjStaffMo:'Покупка сотрудника (задним числом)'
};
function openPsjMo(type) {
  psjPayMethod = 'cash';
  _psjEditEntryId = null; _psjEditType = null;
  Object.keys(PSJ_MO_TITLES).forEach(function(modalId){
    var modal=document.getElementById(modalId); if(!modal) return;
    var mt=modal.querySelector('.mt'); if(mt) mt.textContent = PSJ_MO_TITLES[modalId];
    var delBtn=modal.querySelector('.psj-edit-del-btn'); if(delBtn) delBtn.remove();
  });
  if(type==='sale') {
    _psjSaleItems = [_psjNewItem()];
    renderPsjItems('sale');
    ['psjSaleDisc','psjSaleComment'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
    document.getElementById('psjMixedBlock').style.display='none';
    document.querySelectorAll('#psjSaleMo .pc').forEach(function(p){ p.classList.remove('active'); });
    var first = document.querySelector('#psjSaleMo .pc'); if(first) first.classList.add('active');
    psjCalcSale();
    openMo('psjSaleMo');
  } else if(type==='writeoff') {
    _psjWoItems = [_psjNewItem({reason:''})];
    renderPsjItems('wo');
    openMo('psjWriteoffMo');
  } else if(type==='receive') {
    _psjRcvItems = [_psjNewItem()];
    renderPsjItems('rcv');
    var fromEl=document.getElementById('psjRcvFrom'); if(fromEl) fromEl.value='';
    openMo('psjReceiveMo');
  } else if(type==='expense') {
    ['psjExpAmt','psjExpComment'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
    openMo('psjExpenseMo');
  } else if(type==='staff') {
    _psjStaffItems = [_psjNewItem({retail:0})];
    renderPsjItems('staff');
    var whoEl=document.getElementById('psjStaffWho'); if(whoEl) whoEl.value='';
    openMo('psjStaffMo');
  }
}
function editPsjEntry(id){
  var entry = getPsjEntries().find(function(e){ return e.id===id; });
  if(!entry){ showToast('Запись не найдена'); return; }
  var type = entry.type;
  openPsjMo(type); // resets arrays + opens modal
  _psjEditEntryId = id;
  _psjEditType = type;
  var items = (entry.items||[]).map(function(it){
    return _psjNewItem({art:it.art||'', name:(it.name==='Без названия'?'':it.name)||'', species:it.species||'', price:it.price||0, qty:it.qty||1, amt:it.amt||0, goodsType:it.goodsType||'derevo', reason:it.reason||'', retail:it.retail||0});
  });
  if(!items.length) items = [_psjNewItem()];
  if(type==='sale'){
    _psjSaleItems = items;
    renderPsjItems('sale');
    var discEl=document.getElementById('psjSaleDisc'); if(discEl) discEl.value = entry.discEffect||'';
    var commEl=document.getElementById('psjSaleComment'); if(commEl) commEl.value = entry.comment||'';
    var method = 'cash';
    if((entry.cashEffect||0)>0 && (entry.cardEffect||0)>0) method='mixed';
    else if((entry.cardEffect||0)>0 && !(entry.cashEffect>0)){
      var subParts = (entry.sub||'').split(' · ');
      var last = subParts[subParts.length-1];
      var map = {'terminal':'terminal','sbp':'sbp','transfer':'transfer','qr':'qr'};
      method = map[last] || 'terminal';
    }
    setPsjPayM(method, document.querySelector('#psjSaleMo .pc[onclick*="\''+method+'\'"]'));
    if(method==='mixed'){
      var mc=document.getElementById('psjMixCash'); if(mc) mc.value=entry.cashEffect||'';
      var mcr=document.getElementById('psjMixCard'); if(mcr) mcr.value=entry.cardEffect||'';
    }
    psjCalcSale();
    document.querySelector('#psjSaleMo .mt').textContent = '✏️ Редактирование продажи';
  } else if(type==='writeoff'){
    _psjWoItems = items;
    renderPsjItems('wo');
    document.querySelector('#psjWriteoffMo .mt').textContent = '✏️ Редактирование списания';
  } else if(type==='receive'){
    _psjRcvItems = items;
    renderPsjItems('rcv');
    var fromEl=document.getElementById('psjRcvFrom'); if(fromEl) fromEl.value = entry.from||'';
    document.querySelector('#psjReceiveMo .mt').textContent = '✏️ Редактирование прихода';
  } else if(type==='expense'){
    var amtEl=document.getElementById('psjExpAmt'); if(amtEl) amtEl.value = entry.amount||'';
    var typeEl=document.getElementById('psjExpType'); if(typeEl) typeEl.value = entry.expType||'other';
    var commEl=document.getElementById('psjExpComment'); if(commEl) commEl.value = entry.sub||'';
    document.querySelector('#psjExpenseMo .mt').textContent = '✏️ Редактирование расхода';
  } else if(type==='staff'){
    _psjStaffItems = items;
    renderPsjItems('staff');
    var whoEl=document.getElementById('psjStaffWho'); if(whoEl) whoEl.value = entry.who||'';
    document.querySelector('#psjStaffMo .mt').textContent = '✏️ Редактирование покупки сотрудника';
  }
  var modalId = {sale:'psjSaleMo', writeoff:'psjWriteoffMo', receive:'psjReceiveMo', expense:'psjExpenseMo', staff:'psjStaffMo'}[type];
  var modal = document.getElementById(modalId);
  if(modal){
    var existingDel = modal.querySelector('.psj-edit-del-btn');
    if(existingDel) existingDel.remove();
    var delBtn = document.createElement('button');
    delBtn.className = 'btn red psj-edit-del-btn';
    delBtn.style.marginTop = '8px';
    delBtn.textContent = '🗑 Удалить запись';
    delBtn.onclick = function(){ closeMo(modalId); deletePsjEntry(id); };
    var cancelBtn = modal.querySelector('.md > .btn.sec');
    if(cancelBtn) cancelBtn.parentNode.insertBefore(delBtn, cancelBtn);
  }
}
function setPsjPayM(method, el) {
  psjPayMethod = method;
  document.querySelectorAll('#psjSaleMo .pc').forEach(function(p){ p.classList.remove('active'); });
  if(el) el.classList.add('active');
  document.getElementById('psjMixedBlock').style.display = method==='mixed' ? 'flex' : 'none';
}
function psjSuggest(inputId, list, onPick){
  var box = document.getElementById(inputId+'_sugg');
  if(!box) return;
  var val = (document.getElementById(inputId)||{}).value||'';
  val = val.trim().toLowerCase();
  if(!val){ box.style.display='none'; box.innerHTML=''; return; }
  var matches = list.filter(function(s){ return s.toLowerCase().indexOf(val)===0; }).slice(0,8);
  if(!matches.length){ box.style.display='none'; box.innerHTML=''; return; }
  box.innerHTML = matches.map(function(m){
    return '<div onpointerdown="event.preventDefault();'+onPick+'(\''+m.replace(/'/g,"\\'")+'\')" style="padding:8px 10px;font-size:12px;color:#f0f0f8;border-bottom:1px solid #2e2e3e;cursor:pointer">'+m+'</div>';
  }).join('');
  box.style.display='block';
}
function psjHideSugg(inputId){
  setTimeout(function(){ var box=document.getElementById(inputId+'_sugg'); if(box) box.style.display='none'; }, 150);
}
function _psjItemsArr(group){
  return group==='sale'?_psjSaleItems : group==='wo'?_psjWoItems : group==='rcv'?_psjRcvItems : _psjStaffItems;
}
function _psjContainerId(group){
  return group==='sale'?'psjSaleItems' : group==='wo'?'psjWoItems' : group==='rcv'?'psjRcvItems' : 'psjStaffItems';
}
function _psjColor(group){
  return group==='sale'?'#c8f060' : group==='wo'?'#f06060' : group==='rcv'?'#60c8f0' : '#a060f0';
}
function renderPsjItems(group){
  var arr = _psjItemsArr(group);
  var c = document.getElementById(_psjContainerId(group)); if(!c) return;
  var color = _psjColor(group);
  var items = getItemsBase(), species = getSpecies();
  c.innerHTML = arr.map(function(item, i){
    var nameId = 'psj_'+group+'_name_'+i;
    var speciesId = 'psj_'+group+'_species_'+i;
    var artId = 'psj_'+group+'_art_'+i;
    var priceId = 'psj_'+group+'_price_'+i;
    var qtyId = 'psj_'+group+'_qty_'+i;
    var amtId = 'psj_'+group+'_amt_'+i;
    var hintId = 'psj_'+group+'_hint_'+i;
    var goodsDerevoId = 'psj_'+group+'_gd_'+i;
    var goodsDrId = 'psj_'+group+'_gdr_'+i;
    var isDerevo = item.goodsType!=='dr';
    var html = '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:10px;padding:10px;margin-bottom:8px">';
    if(arr.length>1){
      html += '<div style="display:flex;justify-content:flex-end;margin-bottom:4px">'+
        '<button type="button" onclick="psjDelItem(\''+group+'\','+i+')" style="background:none;border:1px solid #3e2e2e;border-radius:6px;padding:2px 7px;color:#f06060;font-size:11px;cursor:pointer">✕ Удалить позицию</button>'+
      '</div>';
    }
    html += '<div style="display:flex;gap:5px;margin-bottom:6px">'+
      '<div style="flex:0 0 64px"><div class="u-fs10-gray-mb3">Артикул</div>'+
        '<input class="fi u-inp-compact" id="'+artId+'" value="'+(item.art||'')+'" placeholder="№" autocomplete="off" oninput="psjItemArtInput(\''+group+'\','+i+',this.value)"></div>'+
      '<div style="flex:1;position:relative"><div class="u-fs10-gray-mb3">Наименование</div>'+
        '<input class="fi u-inp-compact" id="'+nameId+'" value="'+(item.name||'')+'" placeholder="Название изделия" autocomplete="off" '+
          'oninput="psjItemField(\''+group+'\','+i+',\'name\',this.value);psjSuggest(\''+nameId+'\','+JSON.stringify(items.map(function(it){return it.name||'';}).filter(Boolean))+',\'psjPickName_'+group+'_'+i+'\')" '+
          'onfocus="psjSuggest(\''+nameId+'\','+JSON.stringify(items.map(function(it){return it.name||'';}).filter(Boolean))+',\'psjPickName_'+group+'_'+i+'\')" '+
          'onblur="psjHideSugg(\''+nameId+'\')">'+
        '<div id="'+nameId+'_sugg" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:50;background:#22222e;border:1px solid #3e3e4e;border-radius:8px;max-height:160px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:2px"></div>'+
      '</div>'+
      '<div style="flex:0 0 90px;position:relative"><div class="u-fs10-gray-mb3">Порода</div>'+
        '<input class="fi u-inp-compact" id="'+speciesId+'" value="'+(item.species||'')+'" placeholder="Порода" autocomplete="off" '+
          'oninput="psjItemField(\''+group+'\','+i+',\'species\',this.value);psjSuggest(\''+speciesId+'\','+JSON.stringify(species)+',\'psjPickSpecies_'+group+'_'+i+'\')" '+
          'onfocus="psjSuggest(\''+speciesId+'\','+JSON.stringify(species)+',\'psjPickSpecies_'+group+'_'+i+'\')" '+
          'onblur="psjHideSugg(\''+speciesId+'\')">'+
        '<div id="'+speciesId+'_sugg" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:50;background:#22222e;border:1px solid #3e3e4e;border-radius:8px;max-height:160px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:2px"></div>'+
      '</div>'+
    '</div>';
    html += '<div id="'+hintId+'" style="font-size:10px;color:#8888aa;margin-bottom:6px;display:'+(item._hint?'block':'none')+'">'+(item._hint||'')+'</div>';
    html += '<div style="display:flex;gap:5px;margin-bottom:6px">'+
      '<div style="flex:1"><div class="u-fs10-gray-mb3">Цена за ед.</div>'+
        '<input class="fi u-inp-compact" type="text" id="'+priceId+'" value="'+(item.price||'')+'" placeholder="0" inputmode="numeric" oninput="psjItemField(\''+group+'\','+i+',\'price\',this.value)"></div>'+
      '<div style="flex:1"><div class="u-fs10-gray-mb3">Кол-во</div>'+
        '<input class="fi u-inp-compact" type="text" id="'+qtyId+'" value="'+(item.qty||1)+'" placeholder="1" inputmode="numeric" oninput="psjItemField(\''+group+'\','+i+',\'qty\',this.value)"></div>'+
      '<div style="flex:1"><div class="u-fs10-gray-mb3">Сумма (₽)</div>'+
        '<input class="fi u-inp-compact" type="text" id="'+amtId+'" value="'+(item.amt||'')+'" placeholder="0" inputmode="numeric" oninput="psjItemField(\''+group+'\','+i+',\'amt\',this.value)"></div>'+
    '</div>';
    if(group==='wo'){
      html += '<div class="fg" style="margin-bottom:6px"><input class="fi u-inp-compact" id="psj_wo_reason_'+i+'" value="'+(item.reason||'')+'" placeholder="Причина списания" autocomplete="off" oninput="psjItemField(\'wo\','+i+',\'reason\',this.value)"></div>';
    }
    if(group==='staff'){
      html += '<div class="fg" style="margin-bottom:6px"><div class="u-fs10-gray-mb3">Розница (₽)</div><input class="fi u-inp-compact" type="text" id="psj_staff_retail_'+i+'" value="'+(item.retail||'')+'" placeholder="0" inputmode="numeric" oninput="psjItemField(\'staff\','+i+',\'retail\',this.value)"></div>';
    }
    html += '<div style="display:flex;gap:8px">'+
      '<button type="button" id="'+goodsDerevoId+'" onclick="psjSetItemGoods(\''+group+'\','+i+',\'derevo\')" style="flex:1;padding:8px;border-radius:9px;border:'+(isDerevo?'2px solid #c8f060':'1px solid #2e2e3e')+';background:'+(isDerevo?'#1e2a14':'#22222e')+';color:'+(isDerevo?'#c8f060':'#8888aa')+';font-size:12px;font-weight:'+(isDerevo?'700':'400')+';cursor:pointer">🌳 Дерево</button>'+
      '<button type="button" id="'+goodsDrId+'" onclick="psjSetItemGoods(\''+group+'\','+i+',\'dr\')" style="flex:1;padding:8px;border-radius:9px;border:'+(!isDerevo?'2px solid #c8f060':'1px solid #2e2e3e')+';background:'+(!isDerevo?'#1e2a14':'#22222e')+';color:'+(!isDerevo?'#c8f060':'#8888aa')+';font-size:12px;font-weight:'+(!isDerevo?'700':'400')+';cursor:pointer">🛍 ДР Товар</button>'+
    '</div>';
    html += '</div>';
    return html;
  }).join('');
}
function psjItemField(group, i, field, val){
  var arr = _psjItemsArr(group);
  if(!arr[i]) return;
  if(field==='price'||field==='qty'||field==='amt'){
    val = parseFloat(val)||0;
    arr[i][field]=val;
    if(field!=='amt'){
      var price=arr[i].price||0, qty=arr[i].qty||0;
      if(price && qty){
        arr[i].amt = Math.round(price*qty);
        var amtEl=document.getElementById('psj_'+group+'_amt_'+i);
        if(amtEl) amtEl.value = arr[i].amt;
      }
    }
  } else {
    arr[i][field]=val;
  }
  if(group==='sale') psjCalcSale();
}
function psjItemArtInput(group, i, val){
  var arr=_psjItemsArr(group); if(!arr[i]) return;
  arr[i].art = val;
  var hintEl = document.getElementById('psj_'+group+'_hint_'+i);
  if(!val.trim()){ if(hintEl) hintEl.style.display='none'; arr[i]._hint=''; return; }
  var items = getItemsBase();
  var found = items.find(function(it){ return String(it.num)===val.trim(); });
  if(found){
    if(found.name) arr[i].name = found.name;
    if(!arr[i].price) arr[i].price = found.price||0;
    arr[i]._hint = '✓ '+(found.name||'(без названия в базе)');
    renderPsjItems(group);
    if(group==='sale') psjCalcSale();
  } else {
    arr[i]._hint = '⚠ Артикул не найден — заполните вручную';
    if(hintEl){ hintEl.style.display='block'; hintEl.style.color='#f06060'; hintEl.textContent=arr[i]._hint; }
  }
}
function psjSetItemGoods(group, i, type){
  var arr=_psjItemsArr(group); if(!arr[i]) return;
  arr[i].goodsType = type;
  renderPsjItems(group);
}
function psjAddSaleItem(){ _psjSaleItems.push(_psjNewItem()); renderPsjItems('sale'); }
function psjAddWoItem(){ _psjWoItems.push(_psjNewItem({reason:''})); renderPsjItems('wo'); }
function showInvChatGptPrompt(){
  var prompt =
    'Ты распознаёшь накладную на товар по фото.\n\n'+
    'ВАЖНО — формат ответа:\n'+
    '- Без вступлений, без пояснений, без рассуждений вслух.\n'+
    '- Сразу создай и пришли JSON-файл для скачивания (не печатай JSON текстом в чате).\n'+
    '- Если фото несколько — пришли ОДИН файл со всеми позициями.\n\n'+
    'Структура JSON-файла — один объект:\n\n'+
    '{\n'+
    '  "num": "номер накладной если виден, иначе null",\n'+
    '  "date": "ГГГГ-ММ-ДД если дата видна, иначе null",\n'+
    '  "from": "откуда пришёл товар если указано",\n'+
    '  "goodsType": "derevo",\n'+
    '  "items": [\n'+
    '    {\n'+
    '      "article": "артикул или номер изделия если есть, иначе null",\n'+
    '      "name": "наименование товара",\n'+
    '      "species": "порода дерева если указана, иначе null",\n'+
    '      "qty": 1,\n'+
    '      "price": 1500\n'+
    '    }\n'+
    '  ]\n'+
    '}\n\n'+
    'Правила распознавания:\n'+
    '- "article" — артикул, номер изделия, штрихкод, любой код товара. Если не указан — null.\n'+
    '- "name" — название изделия: Доска, Менажница, Ложка, Подсвечник и т.д.\n'+
    '- "species" — порода дерева: Дуб, Каштан, Орех грецкий, Акация и т.д. Если не указана — null.\n'+
    '- "qty" — количество штук. Если не указано — 1.\n'+
    '- "price" — цена за штуку в рублях, число без знака ₽. Если не читается — 0.\n'+
    '- "goodsType": "derevo" для деревянных изделий, "dr" если это свечи, косметика, другой не-деревянный товар.\n'+
    '- Распознай ВСЕ строки накладной, ничего не пропускай.\n'+
    '- Если строка плохо читается — впиши лучшую догадку, не пропускай.\n'+
    '- Год не указан — считай 2026.';
  var el = document.getElementById('invChatGptPromptText');
  if(el) el.value = prompt;
  openMo('invChatGptPromptMo');
}
function copyInvChatGptPrompt(){
  var ta = document.getElementById('invChatGptPromptText');
  if(!ta) return;
  ta.select();
  try{
    document.execCommand('copy');
    showToast('✅ Скопировано');
  }catch(e){
    showToast('Скопируйте текст вручную');
  }
}
function psjLoadInvoiceFile(input){
  var file = input.files && input.files[0];
  if(!file) return;
  var resultEl = document.getElementById('psjInvFileResult');
  if(resultEl) resultEl.innerHTML = '⏳ Читаю файл...';
  var reader = new FileReader();
  reader.onload = function(e){
    try{
      var data = JSON.parse(e.target.result);
      var invs = Array.isArray(data) ? data : [data];
      var inv = invs.find(function(i){ return i.items && i.items.length; });
      if(!inv){
        if(resultEl) resultEl.innerHTML = '<span style="color:#f06060">❌ Накладная без позиций</span>';
        return;
      }
      var fromEl = document.getElementById('psjRcvFrom');
      if(fromEl && !fromEl.value) fromEl.value = inv.from || inv.destName || inv.shopName || 'Мастерская Ижица';
      _psjRcvItems = (inv.items||[]).map(function(it){
        return {
          id: uid(),
          num: it.article||it.num||it.artNum||'',
          name: it.name||'',
          species: it.species||'',
          price: it.price||it.factPrice||0,
          qty: it.qty||1,
          goodsType: it.goodsType||(inv.goodsType||'derevo')
        };
      });
      renderPsjItems('rcv');
      var total = _psjRcvItems.reduce(function(s,it){return s+(it.qty||1)*(it.price||0);},0);
      if(resultEl) resultEl.innerHTML = '<span style="color:#60f090">✅ Загружено '+_psjRcvItems.length+' позиций · '+Math.round(total).toLocaleString('ru-RU')+'₽</span><br>'+
        '<span class="u-fs10-gray">'+(inv.num||'')+'</span>';
      input.value='';
    }catch(err){
      if(resultEl) resultEl.innerHTML = '<span style="color:#f06060">❌ Ошибка: '+err.message+'</span>';
    }
  };
  reader.readAsText(file);
}
function psjAddRcvItem(){ _psjRcvItems.push(_psjNewItem()); renderPsjItems('rcv'); }
function psjAddStaffItem(){ _psjStaffItems.push(_psjNewItem({retail:0})); renderPsjItems('staff'); }
function psjDelItem(group, i){
  var arr=_psjItemsArr(group);
  arr.splice(i,1);
  renderPsjItems(group);
  if(group==='sale') psjCalcSale();
}
['sale','wo','rcv','staff'].forEach(function(group){
  for(var i=0;i<20;i++){
    (function(group,i){
      window['psjPickName_'+group+'_'+i] = function(val){
        var arr=_psjItemsArr(group); if(!arr[i]) return;
        arr[i].name = val;
        var found = getItemsBase().find(function(it){ return it.name===val; });
        if(found){ if(found.num) arr[i].art=String(found.num); if(found.price && !arr[i].price) arr[i].price=found.price; }
        renderPsjItems(group);
        if(group==='sale') psjCalcSale();
      };
      window['psjPickSpecies_'+group+'_'+i] = function(val){
        var arr=_psjItemsArr(group); if(!arr[i]) return;
        arr[i].species = val;
        renderPsjItems(group);
      };
    })(group,i);
  }
});
function psjCalcSale() {
  var total = _psjSaleItems.reduce(function(s,it){ return s+(it.amt||(it.price*it.qty)||0); }, 0);
  var disc = parseFloat((document.getElementById('psjSaleDisc')||{}).value)||0;
  var paid = Math.max(0, total - disc);
  var el = document.querySelector('#psjSaleTotal span:last-child');
  if(el) el.textContent = Math.round(paid).toLocaleString('ru-RU')+'₽';
}
function savePsjEntry(type) {
  ['sale','wo','rcv','staff'].forEach(function(group){
    var arr = _psjItemsArr(group);
    arr.forEach(function(item, i){
      var artEl = document.getElementById('psj_'+group+'_art_'+i);
      var nameEl = document.getElementById('psj_'+group+'_name_'+i);
      var speciesEl = document.getElementById('psj_'+group+'_species_'+i);
      var priceEl = document.getElementById('psj_'+group+'_price_'+i);
      var qtyEl = document.getElementById('psj_'+group+'_qty_'+i);
      var amtEl = document.getElementById('psj_'+group+'_amt_'+i);
      if(artEl) item.art = artEl.value;
      if(nameEl) item.name = nameEl.value;
      if(speciesEl) item.species = speciesEl.value;
      if(priceEl) item.price = parseFloat(priceEl.value)||0;
      if(qtyEl) item.qty = parseFloat(qtyEl.value)||0;
      if(amtEl) item.amt = parseFloat(amtEl.value)||0;
    });
  });
  var date = (document.getElementById('psjDate')||{}).value || new Date().toISOString().split('T')[0];
  var shopName = (document.getElementById('psjShop')||{}).value || '';
  var sellerEl = document.getElementById('psjSeller');
  var sellerName = sellerEl ? sellerEl.options[sellerEl.selectedIndex]&&sellerEl.options[sellerEl.selectedIndex].text : '';
  var entries = getPsjEntries();
  var savedCount = 0;
  function pushEntry(props){
    if(_psjEditEntryId){
      var idx = entries.findIndex(function(e){ return e.id===_psjEditEntryId; });
      if(idx>=0){
        var old = entries[idx];
        var entry = Object.assign({}, old, props, { date: date, shopName: shopName, sellerName: sellerName, type: type, id: old.id, editedAt: new Date().toISOString() });
        entries[idx] = entry;
        try { db.collection('iz_psj').doc(entry.id).set(entry); } catch(e) {}
        savedCount++;
        return;
      }
    }
    var entry = Object.assign({ id: uid(), date: date, shopName: shopName, sellerName: sellerName, type: type, ts: _workingNowISO(), isArchive: true }, props);
    entries.push(entry);
    try { db.collection('iz_psj').doc(entry.id).set(entry); } catch(e) {}
    savedCount++;
  }
  if(type==='sale') {
    var validItems = _psjSaleItems.filter(function(it){ return (it.name && it.name.trim()) || (it.amt>0) || (it.price>0 && it.qty>0); });
    if(!validItems.length){ showToast('Добавьте хотя бы одну позицию'); return; }
    var totalAmt = validItems.reduce(function(s,it){ return s+(it.amt||(it.price*it.qty)||0); }, 0);
    var disc = parseFloat((document.getElementById('psjSaleDisc')||{}).value)||0;
    var paid = Math.max(0, totalAmt - disc);
    var isCash = psjPayMethod==='cash';
    var isMixed = psjPayMethod==='mixed';
    var totalCash = isCash ? paid : (isMixed ? parseFloat((document.getElementById('psjMixCash')||{}).value)||0 : 0);
    var totalCard = (!isCash && !isMixed) ? paid : (isMixed ? parseFloat((document.getElementById('psjMixCard')||{}).value)||0 : 0);
    var comment = (document.getElementById('psjSaleComment')||{}).value||'';
    var hasDerevo = validItems.some(function(it){ return it.goodsType!=='dr'; });
    var hasDr = validItems.some(function(it){ return it.goodsType==='dr'; });
    var overallGoodsType = (hasDerevo && hasDr) ? 'mixed' : (hasDr ? 'dr' : 'derevo');
    validItems.forEach(function(it){
      if(it.art && it.name) autoSaveToItemBase(it.name, it.art, it.price, it.goodsType);
      if(it.species) saveSpecies(it.species);
    });
    var itemsSummary = validItems.map(function(it){
      return (it.art?'№'+it.art+' ':'')+(it.name||'Без названия')+(it.species?' · '+it.species:'')+(it.qty?' × '+it.qty:'');
    }).join(', ');
    pushEntry({
      label:'Продажа', sub: itemsSummary+' · '+(isCash?'Нал':psjPayMethod),
      amount: totalAmt, amtSign:'+', goodsType: overallGoodsType,
      items: validItems.map(function(it){
        return { art:it.art, name:it.name||'Без названия', species:it.species, price:it.price, qty:it.qty, amt: it.amt||(it.price*it.qty)||0, goodsType: it.goodsType };
      }),
      cashEffect: totalCash, cardEffect: totalCard, discEffect: disc,
      comment: comment
    });
    closeMo('psjSaleMo');
  } else if(type==='writeoff') {
    var validItems = _psjWoItems.filter(function(it){ return (it.name && it.name.trim()) || (it.amt>0) || (it.price>0 && it.qty>0); });
    if(!validItems.length){ showToast('Добавьте хотя бы одну позицию'); return; }
    var totalAmt = validItems.reduce(function(s,it){ return s+(it.amt||(it.price*it.qty)||0); }, 0);
    var hasDerevo = validItems.some(function(it){ return it.goodsType!=='dr'; });
    var hasDr = validItems.some(function(it){ return it.goodsType==='dr'; });
    var overallGoodsType = (hasDerevo && hasDr) ? 'mixed' : (hasDr ? 'dr' : 'derevo');
    validItems.forEach(function(it){ if(it.species) saveSpecies(it.species); });
    var itemsSummary = validItems.map(function(it){
      return (it.art?'№'+it.art+' ':'')+(it.name||'Без названия')+(it.species?' · '+it.species:'')+(it.qty?' × '+it.qty:'')+(it.reason?' · '+it.reason:'');
    }).join(', ');
    pushEntry({
      label:'Списание', sub: itemsSummary,
      amount: totalAmt, amtSign:'−', goodsType: overallGoodsType,
      items: validItems.map(function(it){
        return { art:it.art, name:it.name||'Без названия', species:it.species, price:it.price, qty:it.qty, amt: it.amt||(it.price*it.qty)||0, goodsType: it.goodsType, reason: it.reason };
      }),
      cashEffect:0, cardEffect:0, discEffect:0
    });
    closeMo('psjWriteoffMo');
  } else if(type==='receive') {
    var validItems = _psjRcvItems.filter(function(it){ return (it.name && it.name.trim()) || (it.amt>0) || (it.price>0 && it.qty>0); });
    if(!validItems.length){ showToast('Добавьте хотя бы одну позицию'); return; }
    var from = (document.getElementById('psjRcvFrom')||{}).value||'';
    var totalAmt = validItems.reduce(function(s,it){ return s+(it.amt||(it.price*it.qty)||0); }, 0);
    var hasDerevo = validItems.some(function(it){ return it.goodsType!=='dr'; });
    var hasDr = validItems.some(function(it){ return it.goodsType==='dr'; });
    var overallGoodsType = (hasDerevo && hasDr) ? 'mixed' : (hasDr ? 'dr' : 'derevo');
    validItems.forEach(function(it){
      if(it.art && it.name) autoSaveToItemBase(it.name, it.art, it.price, it.goodsType);
      if(it.species) saveSpecies(it.species);
    });
    var itemsSummary = validItems.map(function(it){
      return (it.art?'№'+it.art+' ':'')+(it.name||'Без названия')+(it.species?' · '+it.species:'')+(it.qty?' × '+it.qty:'');
    }).join(', ') + (from?' · от '+from:'');
    pushEntry({
      label:'Приход товара', sub: itemsSummary,
      amount: totalAmt, amtSign:'+', goodsType: overallGoodsType,
      items: validItems.map(function(it){
        return { art:it.art, name:it.name||'Без названия', species:it.species, price:it.price, qty:it.qty, amt: it.amt||(it.price*it.qty)||0, goodsType: it.goodsType };
      }),
      from: from,
      cashEffect:0, cardEffect:0, discEffect:0
    });
    closeMo('psjReceiveMo');
  } else if(type==='expense') {
    var amt = parseFloat((document.getElementById('psjExpAmt')||{}).value)||0;
    var expType = (document.getElementById('psjExpType')||{}).value||'other';
    var comment = (document.getElementById('psjExpComment')||{}).value||'';
    if(!amt){ showToast('Введите сумму'); return; }
    var expLabels = {zp:'Зарплата',travel:'Дорога',inkass:'Инкассация',other:'Расход'};
    pushEntry({
      label:'Расход · '+(expLabels[expType]||'Прочее'), sub:comment,
      amount:amt, amtSign:'−', cashEffect:0, cardEffect:0, discEffect:0, expType:expType
    });
    closeMo('psjExpenseMo');
  } else if(type==='staff') {
    var who = (document.getElementById('psjStaffWho')||{}).value||'';
    var validItems = _psjStaffItems.filter(function(it){ return (it.name && it.name.trim()) || (it.amt>0) || (it.price>0 && it.qty>0); });
    if(!who||!validItems.length){ showToast('Заполните поля'); return; }
    var totalRetail = validItems.reduce(function(s,it){ return s+(it.retail||0); }, 0);
    var totalOpt = validItems.reduce(function(s,it){ return s+(it.amt||(it.price*it.qty)||0); }, 0);
    var hasDerevo = validItems.some(function(it){ return it.goodsType!=='dr'; });
    var hasDr = validItems.some(function(it){ return it.goodsType==='dr'; });
    var overallGoodsType = (hasDerevo && hasDr) ? 'mixed' : (hasDr ? 'dr' : 'derevo');
    validItems.forEach(function(it){
      if(it.art && it.name) autoSaveToItemBase(it.name, it.art, it.price, it.goodsType);
      if(it.species) saveSpecies(it.species);
    });
    var itemsSummary = validItems.map(function(it){
      return (it.art?'№'+it.art+' ':'')+(it.name||'Без названия')+(it.species?' · '+it.species:'')+(it.qty?' × '+it.qty:'');
    }).join(', ');
    pushEntry({
      label:'Покупка сотр.', sub: who+' · '+itemsSummary,
      amount: totalRetail, amtSign:'+', goodsType: overallGoodsType,
      items: validItems.map(function(it){
        return { art:it.art, name:it.name||'Без названия', species:it.species, price:it.price, qty:it.qty, amt: it.amt||(it.price*it.qty)||0, retail: it.retail||0, goodsType: it.goodsType };
      }),
      who: who, opt: totalOpt, retail: totalRetail,
      cashEffect:0, cardEffect:0, discEffect:0
    });
    closeMo('psjStaffMo');
  }
  if(savedCount){
    var wasEdit = !!_psjEditEntryId;
    _psjEditEntryId = null; _psjEditType = null;
    savePsjEntries(entries);
    psjLoadJournal();
    try{ psSyncFromJournal(); }catch(e){}
    showToast(wasEdit ? '✅ Запись обновлена' : '✅ Запись добавлена');
  }
}
function savePsjAsShift() {
  var date = (document.getElementById('psjDate')||{}).value || '';
  var shopName = (document.getElementById('psjShop')||{}).value || '';
  var sellerEl = document.getElementById('psjSeller');
  var sellerName = sellerEl ? sellerEl.options[sellerEl.selectedIndex]&&sellerEl.options[sellerEl.selectedIndex].text : '';
  var entries = getPsjEntries().filter(function(e){ return e.date === date && e.shopName === shopName; });
  if(!entries.length){ showToast('Нет записей для сохранения'); return; }
  var cashRev=0, cardRev=0, disc=0, exp=0;
  var journal = entries.map(function(e){
    cashRev += e.cashEffect||0; cardRev += e.cardEffect||0; disc += e.discEffect||0;
    if(e.type==='expense') exp += e.amount||0;
    return { id:e.id, type:e.type, ts:e.date+'T12:00:00.000Z', icon: {sale:'💰',writeoff:'🗑️',receive:'📥',expense:'💸',staff:'🛒'}[e.type]||'📝',
      label:e.label, sub:e.sub, amount:e.amount, amtCls:e.type==='sale'?'pos':'exp', amtSign:e.amtSign,
      goodsType: e.goodsType, items: e.items, who: e.who, opt: e.opt, retail: e.retail, from: e.from, expType: e.expType,
      cashEffect:e.cashEffect||0, cardEffect:e.cardEffect||0, staffEffect:0, goodsEffect: e.type==='sale'?-(e.amount||0): e.type==='receive'?(e.amount||0): e.type==='writeoff'?-(e.amount||0):0 };
  });
  var shift = {
    id: uid(), source: 'psj', isArchive: true, backfilled: true, status: 'closed',
    shopName: shopName, sellerName: sellerName, date: date,
    openedAt: date+'T09:00:00.000Z', closedAt: date+'T21:00:00.000Z',
    cashRevenue: cashRev, cardRevenue: cardRev, totalDiscount: disc,
    totalRevenue: cashRev + cardRev + disc,
    salesCount: journal.filter(function(e){return e.type==='sale';}).length,
    zp: journal.filter(function(e){return e.type==='expense'&&e.expType==='zp';}).reduce(function(s,e){return s+e.amount;},0),
    travel: journal.filter(function(e){return e.type==='expense'&&e.expType==='travel';}).reduce(function(s,e){return s+e.amount;},0),
    inkass: journal.filter(function(e){return e.type==='expense'&&e.expType==='inkass'&&e.goodsType!=='dr';}).reduce(function(s,e){return s+e.amount;},0),
    otherExp: journal.filter(function(e){return e.type==='expense'&&e.expType==='other'&&e.goodsType!=='dr';}).reduce(function(s,e){return s+e.amount;},0),
    supplierExp: journal.filter(function(e){return e.type==='expense'&&e.expType==='supplier'&&e.goodsType!=='dr';}).reduce(function(s,e){return s+e.amount;},0),
    drInkass: journal.filter(function(e){return e.type==='expense'&&e.expType==='inkass'&&e.goodsType==='dr';}).reduce(function(s,e){return s+e.amount;},0),
    drSupplierAmt: journal.filter(function(e){return e.type==='expense'&&e.expType==='supplier'&&e.goodsType==='dr';}).reduce(function(s,e){return s+e.amount;},0),
    expenses: journal.filter(function(e){return e.type==='expense';}),
    journal: journal,
    savedAt: new Date().toISOString(), savedBy: (session&&session.name)||'Admin'
  };
  var shifts = getShifts();
  shifts = shifts.filter(function(s){ return !(s.date===date && s.shopName===shopName && s.source==='psj'); });
  shifts.unshift(shift);
  saveShifts(shifts);
  try { db.collection('iz_shifts').doc(shift.id).set(shift); } catch(e) {}
  showToast('✅ Отчёт за '+date+' сохранён');
}
var duPhotoFiles = [];
var duPendingRecognized = [];
var AI_PROXY_URL = 'https://izhitsa-ai-proxy.YOUR-SUBDOMAIN.workers.dev';
function fileToBase64(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e){ resolve(e.target.result.split(',')[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function showRecognizedEntries(entries, shopName) {
  duPendingRecognized = entries.map(function(e){ return Object.assign({}, e, {shopName: shopName}); });
  var res = document.getElementById('duRecognizeResult');
  var uncertain = entries.filter(function(e){ return e.uncertain; }).length;
  var html = '<div class="card" style="margin-bottom:10px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<div class="ctitle" style="margin:0">Распознано: '+entries.length+'</div>' +
      (uncertain ? '<div style="font-size:11px;color:#f0a060;font-weight:700">⚠️ '+uncertain+' под вопросом</div>' : '<div style="font-size:11px;color:#60f090;font-weight:700">✅ Всё чётко</div>') +
    '</div>';
  html += entries.map(function(e, i) {
    var isU = e.uncertain;
    var typeLabel = {sale:'💰 Продажа',expense:'💸 Расход',writeoff:'🗑 Списание',receive:'📥 Приход'}[e.type]||'📝';
    var payLabel = {cash:'💵 Нал',terminal:'💳 Терминал',sbp:'📱 СБП',transfer:'🏦 Перевод',qr:'🔲 QR',mixed:'➗ Смешанный'}[e.payMethod]||e.payMethod||'';
    return '<div style="background:'+(isU?'#2e1a00':'#1a1a22')+';border:1px solid '+(isU?'#f0a060':'#2e2e3e')+';border-radius:10px;padding:10px;margin-bottom:8px">' +
      (isU?'<div style="font-size:10px;color:#f0a060;font-weight:700;margin-bottom:6px">⚠️ ПРОВЕРЬТЕ</div>':'') +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">' +
        '<div><div class="u-fs13-bold">'+typeLabel+' · '+(e.name||'?')+'</div>' +
        '<div class="u-fs11-gray">'+e.date+(e.sellerName?' · '+e.sellerName:'')+(e.article?' · №'+e.article:'')+'</div></div>' +
        '<div style="font-family:Unbounded,sans-serif;font-size:13px;font-weight:700;color:'+(isU?'#f0a060':'#c8f060')+'">'+Math.round(e.amount||0).toLocaleString('ru-RU')+'₽</div>' +
      '</div>' +
      (e.type==='sale'?'<div class="u-fs11-gray">'+payLabel+(e.discount?' · скидка '+e.discount+'₽':'')+'</div>':'') +
      '<div style="display:flex;gap:6px;margin-top:8px">' +
        '<button onclick="editRecognized('+i+')" style="flex:1;padding:6px;border-radius:8px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:11px;cursor:pointer">✏️ Правка</button>' +
        '<button onclick="removeRecognized('+i+')" style="padding:6px 10px;border-radius:8px;border:1px solid #3e2e2e;background:#2e1a1a;color:#f06060;font-size:11px;cursor:pointer">✕</button>' +
      '</div></div>';
  }).join('');
  html += '<button class="btn" onclick="confirmPhotoImport()" style="width:100%;margin-top:4px">💾 Сохранить все в журнал</button></div>';
  res.innerHTML = html;
}
function removeRecognized(i) {
  duPendingRecognized.splice(i,1);
  showRecognizedEntries(duPendingRecognized, (duPendingRecognized[0]&&duPendingRecognized[0].shopName)||'');
}
function editRecognized(i) {
  var e = duPendingRecognized[i];
  var newAmt = prompt('Сумма для "'+e.name+'":', e.amount||0);
  if(newAmt!==null){ duPendingRecognized[i].amount=parseFloat(newAmt)||0; duPendingRecognized[i].uncertain=false; }
  showRecognizedEntries(duPendingRecognized, (duPendingRecognized[0]&&duPendingRecognized[0].shopName)||'');
}
function confirmPhotoImport() {
  if(!duPendingRecognized.length){ showToast('Нет записей'); return; }
  var shopName = (document.getElementById('duPhotoShop')||{}).value || '';
  var existing = getPsjEntries(); var added=0;
  duPendingRecognized.forEach(function(e){
    var date = normalizeDate(e.date);
    var entry = { id:uid(), date:date, shopName:shopName, sellerName:e.sellerName||'',
      type:e.type||'sale', ts:_workingNowISO(),
      label:{sale:'Продажа',expense:'Расход',writeoff:'Списание',receive:'Приход товара'}[e.type||'sale'],
      sub:(e.name||'')+(e.article?' №'+e.article:'')+(e.payMethod?' · '+e.payMethod:''),
      amount:e.amount||0, amtSign:e.type==='expense'||e.type==='writeoff'?'−':'+',
      cashEffect:e.cashAmount||(e.payMethod==='cash'&&e.type==='sale'?(e.amount||0):0),
      cardEffect:e.cardAmount||(e.payMethod!=='cash'&&e.type==='sale'?(e.amount||0):0),
      discEffect:e.discount||0, goodsType:e.goodsType||'derevo', comment:e.comment||'', source:'photo_import'
    };
    existing.push(entry);
    try{ db.collection('iz_psj').doc(entry.id).set(entry); }catch(err){}
    added++;
  });
  savePsjEntries(existing);
  var hist=JSON.parse(localStorage.getItem('iz_photo_imports')||'[]');
  hist.unshift({id:uid(),date:new Date().toISOString().split('T')[0],count:added,shopName:shopName,importedAt:new Date().toISOString()});
  localStorage.setItem('iz_photo_imports',JSON.stringify(hist.slice(0,30)));
  duPendingRecognized=[]; duPhotoFiles=[];
  document.getElementById('duPhotoPreview').style.display='none';
  document.getElementById('duRecognizeBtn').style.display='none';
  document.getElementById('duRecognizeResult').style.display='none';
  document.getElementById('duPhotoInput').value='';
  renderDuPhotoHistory();
  showToast('✅ Добавлено '+added+' записей в журнал');
}
function normalizeDate(str) {
  if(!str) return new Date().toISOString().split('T')[0];
  if(/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  var p=str.split('.'); if(p.length>=2){ var d=p[0].padStart(2,'0'),m=p[1].padStart(2,'0'),y=p[2]||new Date().getFullYear().toString(); if(y.length===2)y='20'+y; return y+'-'+m+'-'+d; }
  return new Date().toISOString().split('T')[0];
}
function renderDuPhotoHistory() {
  var c=document.getElementById('duPhotoHistory'); if(!c) return;
  var hist=JSON.parse(localStorage.getItem('iz_photo_imports')||'[]');
  if(!hist.length){ c.innerHTML='<div class="empty"><div class="ei">📷</div>Загрузок не было</div>'; return; }
  c.innerHTML=hist.map(function(h){
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#22222e;border-radius:10px;margin-bottom:6px">'+
      '<div><div class="u-fs13-bold">📷 '+h.shopName+'</div>'+
      '<div class="u-fs11-gray">'+h.date+' · '+h.count+' записей</div></div>'+
      '<div style="color:#60f090;font-weight:700;font-size:12px">+'+h.count+'</div></div>';
  }).join('');
}
var pendingImportData = null;
function readImportFile(file){
  var reader = new FileReader();
  reader.onload = function(e){
    var content = e.target.result;
    var ext = file.name.split('.').pop().toLowerCase();
    try {
      var data;
      if(ext==='json'){ data=JSON.parse(content); if(!Array.isArray(data)) data=[data]; }
      else if(ext==='csv'){ data=parseCsvToShifts(content); }
      else { showImportError('Формат не поддерживается. Используйте JSON или CSV.'); return; }
      validateAndPreviewImport(data, file.name);
    } catch(err){ showImportError('Ошибка чтения: '+err.message); }
  };
  reader.readAsText(file,'UTF-8');
}
function parseCsvToShifts(csv){
  var lines=csv.trim().split('\n'); if(lines.length<2) throw new Error('CSV пустой');
  var headers=lines[0].split(',').map(function(h){return h.trim().replace(/"/g,'');});
  var shifts=[];
  for(var i=1;i<lines.length;i++){
    if(!lines[i].trim()) continue;
    var vals=lines[i].split(',').map(function(v){return v.trim().replace(/"/g,'');});
    var obj={}; headers.forEach(function(h,j){obj[h]=vals[j]||'';});
    ['cashMorning','cashEvening','cashRevenue','cardRevenue','discount','goodsMorning','goodsEvening','zp','inkass','otherExp'].forEach(function(k){if(obj[k]!==undefined)obj[k]=parseFloat(obj[k])||0;});
    shifts.push(obj);
  }
  return shifts;
}
function validateAndPreviewImport(data, filename){
  if(!data||!data.length){showImportError('Файл пустой.'); return;}
  var errors=[], valid=[];
  data.forEach(function(row,i){
    if(!row.date){errors.push('Строка '+(i+1)+': нет даты'); return;}
    if(!row.shopName){errors.push('Строка '+(i+1)+': нет магазина'); return;}
    valid.push({id:uid(),source:'import',isArchive:true,backfilled:true,
      shopName:row.shopName, sellerName:row.sellerName||'—', date:row.date,
      openedAt:row.date+'T09:00:00.000Z', closedAt:row.date+'T21:00:00.000Z',
      cashMorning:parseFloat(row.cashMorning)||0, cashEvening:parseFloat(row.cashEvening)||0,
      cashRevenue:parseFloat(row.cashRevenue)||0, cardRevenue:parseFloat(row.cardRevenue)||0,
      totalDiscount:parseFloat(row.discount)||0,
      goodsMorning:parseFloat(row.goodsMorning)||0, goodsEvening:parseFloat(row.goodsEvening)||0,
      zp:parseFloat(row.zp)||0, inkass:parseFloat(row.inkass)||0, otherExp:parseFloat(row.otherExp)||0,
      comment:row.comment||'', importedAt:new Date().toISOString(), importFile:filename
    });
  });
  pendingImportData=valid;
  var res=document.getElementById('rstjFileResult'), html='';
  if(errors.length) html+='<div class="al-warn" style="margin-bottom:8px">⚠️ Пропущено '+errors.length+' строк: '+errors.slice(0,3).join('; ')+'</div>';
  if(!valid.length){
    html+='<div class="al-err">❌ Нет корректных данных.</div>';
    pendingImportData=null; document.getElementById('rstjFileConfirmBtn').style.display='none';
  } else {
    var byShop={};
    valid.forEach(function(s){(byShop[s.shopName]=byShop[s.shopName]||[]).push(s);});
    html+='<div class="al-ok" style="margin-bottom:10px">✅ Найдено <strong>'+valid.length+'</strong> смен · '+valid[0].date+' — '+valid[valid.length-1].date+'</div>';
    Object.keys(byShop).forEach(function(shop){
      var rows=byShop[shop];
      var rev=rows.reduce(function(s,r){return s+(r.cashRevenue||0)+(r.cardRevenue||0)+(r.totalDiscount||0);},0);
      html+='<div style="background:#22222e;border-radius:10px;padding:10px;margin-bottom:6px;font-size:12px">'+
        '<div style="font-weight:700">🏪 '+shop+'</div>'+
        '<div style="color:#8888aa">Смен: '+rows.length+' · Выручка: <span style="color:#c8f060">'+Math.round(rev).toLocaleString('ru-RU')+'₽</span></div></div>';
    });
    document.getElementById('rstjFileConfirmBtn').style.display='block';
  }
  document.getElementById('rstjFileCancelBtn').style.display='block';
  res.style.display='block'; res.innerHTML=html;
}
function showImportError(msg){
  var res=document.getElementById('rstjFileResult');
  res.style.display='block'; res.innerHTML='<div class="al-err">❌ '+msg+'</div>';
  document.getElementById('importConfirmBtn').style.display='none';
  document.getElementById('importCancelBtn').style.display='block';
}
function confirmImport(){
  if(!pendingImportData||!pendingImportData.length) return;
  var existing=getShifts();
  var deduped=pendingImportData.filter(function(s){
    return !existing.some(function(e){return e.date===s.date&&e.shopName===s.shopName;});
  });
  var dupes=pendingImportData.length-deduped.length;
  var merged=existing.concat(deduped);
  merged.sort(function(a,b){return b.date.localeCompare(a.date);});
  saveShifts(merged);
  deduped.forEach(function(s){try{db.collection('iz_shifts').doc(s.id).set(s);}catch(e){}});
  var hist=JSON.parse(localStorage.getItem('iz_photo_imports')||'[]');
  hist.unshift({id:uid(),date:new Date().toISOString().split('T')[0],count:deduped.length,
    shopName:(pendingImportData[0]&&pendingImportData[0].shopName)||'разные магазины',
    importedAt:new Date().toISOString()});
  localStorage.setItem('iz_photo_imports',JSON.stringify(hist.slice(0,30)));
  cancelImport(); renderRstjHistory();
  showToast('✅ Импортировано '+deduped.length+' смен'+(dupes?' ('+dupes+' дублей пропущено)':''));
}
function cancelImport(){
  pendingImportData=null;
  var res=document.getElementById('rstjFileResult'); if(res){ res.style.display='none'; res.innerHTML=''; }
  var cb=document.getElementById('rstjFileConfirmBtn'); if(cb) cb.style.display='none';
  var xb=document.getElementById('rstjFileCancelBtn'); if(xb) xb.style.display='none';
  var fi=document.getElementById('rstjFileInput'); if(fi) fi.value='';
}
function downloadTemplate(){
  var t=JSON.stringify([{date:'2024-01-15',shopName:'Роза Хутор',sellerName:'Ксения',cashMorning:5000,cashEvening:8200,cashRevenue:12000,cardRevenue:8500,discount:500,goodsMorning:450000,goodsEvening:438000,zp:1500,inkass:0,otherExp:200,comment:''}],null,2);
  var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([t],{type:'application/json'})); a.download='izhitsa_template.json'; a.click();
}
function downloadCsvTemplate(){
  var csv='date,shopName,sellerName,cashMorning,cashEvening,cashRevenue,cardRevenue,discount,goodsMorning,goodsEvening,zp,inkass,otherExp,comment\n2024-01-15,Роза Хутор,Ксения,5000,8200,12000,8500,500,450000,438000,1500,0,200,';
  var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); a.download='izhitsa_template.csv'; a.click();
}
function initRestore() {
  initRestoreShiftUI();
  if(session && session.sellerRestoreMode) switchRst('invoices');
}
function switchRst(tab) {
  var tabs = ['invoices','journal','activate','shifts'];
  tabs.forEach(function(t) {
    var el = document.getElementById('rst_'+t);
    var btn = document.getElementById('rst_tab_'+t);
    if(el) el.style.display = t===tab ? 'block' : 'none';
    if(btn) {
      btn.style.borderWidth = t===tab ? '2px' : '1px';
      btn.style.background = t===tab ? '#1e2a14' : '#22222e';
      btn.style.color = t===tab ? '#c8f060' : '#8888aa';
      btn.style.borderColor = t===tab ? '#c8f060' : '#2e2e3e';
      btn.style.fontWeight = t===tab ? '700' : '400';
    }
  });
  if(tab==='invoices') { rstInitInvoices(); }
  if(tab==='journal') { rstInitJournal(); switchRstJ('photo', document.getElementById('rstj_photo')); }
  if(tab==='activate') { rstInitActivate(); }
  if(tab==='shifts') { populatePastShiftSellers(); }
}
var rstInvItems = [];
function rstInitInvoices() {
  var shops = getShopNames();
  var restricted = !!(session && session.sellerRestoreMode);
  if(restricted && session.restrictedShops){
    shops = shops.filter(function(s){ return session.restrictedShops.indexOf(s)>=0; });
  }
  var sel = document.getElementById('rstInvShop');
  if(sel){
    sel.innerHTML = shops.map(function(s){return '<option>'+s+'</option>';}).join('');
    if(restricted && _restoreShift && _restoreShift.shop){ sel.value = _restoreShift.shop; sel.disabled = true; }
    else sel.disabled = false;
  }
  var d = document.getElementById('rstInvDate');
  if(d && !d.value) d.value = new Date().toISOString().split('T')[0];
  rstInvItems = [];
  renderRstInvItems();
  loadPendingInvoices();
  renderAcceptedInvoices();
}
function addRstInvItem() {
  rstInvItems.push({name:'',article:'',qty:1,price:0});
  renderRstInvItems();
}
var _rstPickFns = {};
function renderRstInvItems() {
  var c = document.getElementById('rstInvItems'); if(!c) return;
  if(!rstInvItems.length) { c.innerHTML='<div style="font-size:12px;color:#8888aa;padding:4px">Нет позиций</div>'; return; }
  var names = _manInvNameOptions();
  rstInvItems.forEach(function(_,i){
    window['_rstPick_'+i] = function(val){
      rstInvItems[i].name=val;
      var el=document.getElementById('rstInvName_'+i); if(el) el.value=val;
      rstCalcInvTotal();
    };
  });
  c.innerHTML = rstInvItems.map(function(item,i){
    return '<div style="background:#1a1a22;border-radius:10px;padding:10px;margin-bottom:6px">' +
      '<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">' +
        '<input class="fi" placeholder="Арт." value="'+(item.article||item.num||'')+'" oninput="rstInvItems['+i+'].article=this.value;rstInvItems['+i+'].num=this.value" style="flex:0 0 80px;margin:0;font-size:12px">' +
        '<div style="flex:1;position:relative">' +
          '<input class="fi" id="rstInvName_'+i+'" placeholder="Наименование" value="'+item.name+'" autocomplete="off" ' +
            'oninput="rstInvItems['+i+'].name=this.value;rstCalcInvTotal();psjSuggest(\'rstInvName_'+i+'\',_manInvNameOptions(),\'_rstPick_'+i+'\')" ' +
            'onfocus="psjSuggest(\'rstInvName_'+i+'\',_manInvNameOptions(),\'_rstPick_'+i+'\')" ' +
            'onblur="psjHideSugg(\'rstInvName_'+i+'\')" style="margin:0;font-size:12px;width:100%">' +
          '<div id="rstInvName_'+i+'_sugg" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:25;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;max-height:160px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:2px"></div>' +
        '</div>' +
        '<button onpointerdown="event.preventDefault();rstInvItems.splice('+i+',1);renderRstInvItems();rstCalcInvTotal()" style="flex-shrink:0;background:none;border:1px solid #3e2e2e;border-radius:8px;padding:5px 8px;color:#f06060;font-size:12px;cursor:pointer">✕</button>' +
      '</div>' +
      '<div class="u-flex-g6">' +
        '<input class="fi" type="text" placeholder="Кол" value="'+item.qty+'" oninput="rstInvItems['+i+'].qty=parseFloat(this.value)||1;rstCalcInvTotal()" style="flex:0 0 70px;margin:0;font-size:12px" inputmode="numeric">' +
        '<input class="fi" type="text" placeholder="Цена ₽" value="'+item.price+'" oninput="rstInvItems['+i+'].price=parseFloat(this.value)||0;rstCalcInvTotal()" style="flex:1;margin:0;font-size:12px" inputmode="numeric">' +
      '</div>' +
    '</div>';
  }).join('');
  rstCalcInvTotal();
}
function rstCalcInvTotal() {
  var total = rstInvItems.reduce(function(s,i){return s+(i.qty||1)*(i.price||0);},0);
  var el = document.getElementById('rstInvTotal');
  if(el) el.textContent = rstInvItems.length ? 'Итого: '+Math.round(total).toLocaleString('ru-RU')+'₽ · '+rstInvItems.length+' позиций' : '';
}
var _rstInvGoodsType = 'derevo';
function setRstInvType(gt){
  _rstInvGoodsType = gt;
  var btnD=document.getElementById('rstInvTypeDerevo');
  var btnDr=document.getElementById('rstInvTypeDr');
  if(btnD){ btnD.style.borderWidth=gt==='derevo'?'2px':'1px'; btnD.style.borderColor=gt==='derevo'?'#c8f060':'#2e2e3e'; btnD.style.background=gt==='derevo'?'#1e2a14':'#22222e'; btnD.style.color=gt==='derevo'?'#c8f060':'#8888aa'; }
  if(btnDr){ btnDr.style.borderWidth=gt==='dr'?'2px':'1px'; btnDr.style.borderColor=gt==='dr'?'#a060f0':'#2e2e3e'; btnDr.style.background=gt==='dr'?'#1e102a':'#22222e'; btnDr.style.color=gt==='dr'?'#a060f0':'#8888aa'; }
}
function saveRstInvoice() {
  var shop = (document.getElementById('rstInvShop')||{}).value||'';
  var date = (document.getElementById('rstInvDate')||{}).value||new Date().toISOString().split('T')[0];
  var from = (document.getElementById('rstInvFrom')||{}).value||'Мастерская';
  var num = (document.getElementById('rstInvNum')||{}).value||uid().substring(0,6);
  if(!rstInvItems.length){showToast('Добавьте позиции');return;}
  var totalAmt = rstInvItems.reduce(function(s,i){return s+(i.qty||1)*(i.price||0);},0);
  var gt = _rstInvGoodsType||'derevo';
  var inv = {
    id:uid(), date:date, shopName:shop, from:from, num:num,
    goodsType:gt,
    items:rstInvItems.map(function(i){return Object.assign({goodsType:gt},i);}),
    totalAmt:totalAmt, isArchive:true, source:'restore',
    status:'accepted', acceptedAt:new Date().toISOString()
  };
  var invs = JSON.parse(localStorage.getItem('iz_archive_invoices')||'[]');
  invs.unshift(inv);
  localStorage.setItem('iz_archive_invoices', JSON.stringify(invs));
  try{db.collection('iz_archive_invoices').doc(inv.id).set(inv);}catch(e){}
  var entries = getPsjEntries();
  inv.items.forEach(function(item){
    var itemAmt=(item.qty||1)*(item.price||0);
    var isDr=(item.goodsType||gt)==='dr';
    entries.push({id:uid(),date:date,shopName:shop,sellerName:'',type:'receive',
      ts:_workingNowISO(),label:'Приход '+(isDr?'ДР Товар':'Дерево'),
      sub:item.name+(item.article?' №'+item.article:'')+'· накл. '+num+' от '+from,
      amount:itemAmt,amtSign:'+',
      goodsType:isDr?'dr':'derevo',
      goodsEffect:isDr?0:itemAmt,
      goodsDrEffect:isDr?itemAmt:0,
      cashEffect:0,cardEffect:0,discEffect:0,isArchive:true,source:'invoice_restore'
    });
  });
  savePsjEntries(entries);
  rstInvItems=[]; _rstInvGoodsType='derevo'; setRstInvType('derevo');
  document.getElementById('rstInvFrom').value='';
  document.getElementById('rstInvNum').value='';
  renderRstInvItems(); renderAcceptedInvoices();
  showToast('✅ Накладная принята на баланс '+shop);
}
function loadPendingInvoices() {
  var c = document.getElementById('rstPendingInvoices'); if(!c) return;
  try {
    db.collection('iz_invoices').where('status','==','pending').get().then(function(snap){
      if(snap.empty){c.innerHTML='<div class="empty"><div class="ei">📋</div>Нет входящих накладных</div>';return;}
      c.innerHTML = snap.docs.map(function(doc){
        var inv = doc.data();
        rstPendingInvoicesData[doc.id] = inv;
        return '<div style="background:#1a1e2e;border:1px solid #60c8f0;border-radius:10px;padding:12px;margin-bottom:8px">'+
          '<div class="u-fs13-bold">📋 Накладная №'+inv.num+' · '+inv.date+'</div>'+
          '<div style="font-size:11px;color:#8888aa;margin:4px 0">Из: '+(inv.from||'Мастерская')+' · '+((inv.items||[]).length)+' позиций</div>'+
          '<div style="display:flex;gap:8px;margin-top:8px">'+
            '<select class="fs" id="inv_shop_'+doc.id+'" style="flex:1;margin:0">'+getShopNames().map(function(s){return '<option>'+s+'</option>';}).join('')+'</select>'+
            '<input class="fi" type="date" id="inv_date_'+doc.id+'" value="'+inv.date+'" style="flex:1;margin:0;-webkit-appearance:none;color-scheme:dark">'+
          '</div>'+
          '<button onclick="acceptPendingInvoice(\''+doc.id+'\')" style="width:100%;margin-top:8px;padding:9px;border-radius:10px;border:none;background:#60f090;color:#0f0f13;font-weight:700;font-size:12px;cursor:pointer">✅ Принять</button>'+
        '</div>';
      }).join('');
    });
  } catch(e) { c.innerHTML='<div style="font-size:12px;color:#8888aa;padding:8px">Нет подключения к базе</div>'; }
}
var rstPendingInvoicesData = {};
function acceptPendingInvoice(docId) {
  var inv = rstPendingInvoicesData[docId] || {};
  var shop = (document.getElementById('inv_shop_'+docId)||{}).value||'';
  var date = (document.getElementById('inv_date_'+docId)||{}).value||inv.date||new Date().toISOString().split('T')[0];
  inv.shopName=shop; inv.date=date; inv.status='accepted'; inv.isArchive=true; inv.acceptedAt=new Date().toISOString();
  var invs=JSON.parse(localStorage.getItem('iz_archive_invoices')||'[]');
  invs.unshift(inv); localStorage.setItem('iz_archive_invoices',JSON.stringify(invs));
  try{db.collection('iz_invoices').doc(docId).update({status:'accepted',shopName:shop,date:date});}catch(e){}
  var entries=getPsjEntries();
  (inv.items||[]).forEach(function(item){
    entries.push({id:uid(),date:date,shopName:shop,sellerName:'',type:'receive',
      ts:_workingNowISO(),label:'Приход товара',
      sub:item.name+(item.article?' №'+item.article:'')+' · накл. '+(inv.num||''),
      amount:(item.qty||1)*(item.price||0),amtSign:'+',cashEffect:0,cardEffect:0,discEffect:0,isArchive:true});
  });
  savePsjEntries(entries);
  loadPendingInvoices(); renderAcceptedInvoices();
  showToast('✅ Накладная принята');
}
function toggleArchiveInvType(invId, idx){
  var invs = JSON.parse(localStorage.getItem('iz_archive_invoices')||'[]');
  var inv = invs.find(function(i){ return i.id===invId; });
  if(!inv) return;
  var newType = (inv.goodsType==='dr') ? 'derevo' : 'dr';
  if(!confirm('Изменить тип с "'+(inv.goodsType==='dr'?'ДР Товар':'Дерево')+'" на "'+(newType==='dr'?'ДР Товар':'Дерево')+'"?')) return;
  inv.goodsType = newType;
  (inv.items||[]).forEach(function(it){ it.goodsType=newType; });
  localStorage.setItem('iz_archive_invoices', JSON.stringify(invs));
  try{ db.collection('iz_archive_invoices').doc(invId).set(inv,{merge:true}); }catch(e){}
  var entries = getPsjEntries();
  entries.forEach(function(e){
    if(e.source==='invoice_restore' && e.sub && e.sub.indexOf(inv.num)>=0){
      e.goodsType = newType;
      var amt = e.amount||0;
      e.goodsEffect = newType==='dr' ? 0 : amt;
      e.goodsDrEffect = newType==='dr' ? amt : 0;
    }
  });
  savePsjEntries(entries);
  renderAcceptedInvoices();
  showToast('✅ Тип изменён на '+(newType==='dr'?'ДР Товар':'Дерево'));
}
function renderAcceptedInvoices() {
  var c=document.getElementById('rstAcceptedInvoices'); if(!c) return;
  var invs=JSON.parse(localStorage.getItem('iz_archive_invoices')||'[]');
  if(!invs.length){c.innerHTML='<div class="empty"><div class="ei">📦</div>Нет принятых</div>';return;}
  c.innerHTML=invs.slice(0,20).map(function(inv,idx){
    var gt=inv.goodsType||'derevo';
    var gtLabel=gt==='dr'?'🛍 ДР':'🌳 Дерево';
    var gtColor=gt==='dr'?'#a060f0':'#c8f060';
    return '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:10px;margin-bottom:6px;padding:10px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
        '<div>'+
          '<div class="u-fs13-bold">📋 №'+inv.num+' · '+inv.date+'</div>'+
          '<div class="u-fs11-gray">'+inv.shopName+' · '+(inv.items||[]).length+' поз. · '+Math.round(inv.totalAmt||0).toLocaleString('ru-RU')+'₽</div>'+
        '</div>'+
        '<span style="font-size:11px;font-weight:700;color:'+gtColor+'">'+gtLabel+'</span>'+
      '</div>'+
      '<div class="u-flex-g6">'+
        '<button type="button" onpointerdown="event.preventDefault();toggleArchiveInvType(\''+inv.id+'\','+idx+')" style="flex:1;padding:6px;border-radius:8px;border:1px solid '+gtColor+';background:none;color:'+gtColor+';font-size:11px;font-weight:700;cursor:pointer">⇄ Изменить тип</button>'+
      '</div>'+
    '</div>';
  }).join('');
}
function rstInitJournal() {
  var shops = getShopNames();
  ['rstjPhotoShop'].forEach(function(id){
    var sel=document.getElementById(id);
    if(sel) sel.innerHTML=shops.map(function(s){return '<option>'+s+'</option>';}).join('');
  });
  psjInit();
  renderRstjHistory();
}
function switchRstJ(tab, el) {
  ['photo','file','manual'].forEach(function(t){
    var panel=document.getElementById('rstj_'+t+'_tab');
    var btn=document.getElementById('rstj_'+t);
    if(panel) panel.style.display=t===tab?'block':'none';
    if(btn){btn.style.borderWidth=t===tab?'2px':'1px';btn.style.background=t===tab?'#1e2a14':'#22222e';btn.style.color=t===tab?'#c8f060':'#8888aa';btn.style.borderColor=t===tab?'#c8f060':'#2e2e3e';btn.style.fontWeight=t===tab?'700':'400';}
  });
}
var rstjPhotoFiles=[];
function handleRstjPhotoSelect(input){rstjPhotoFiles=Array.from(input.files);rstjShowPreview();}
function handleRstjPhotoDrop(ev){ev.preventDefault();rstjPhotoFiles=Array.from(ev.dataTransfer.files).filter(function(f){return f.type.startsWith('image/');});rstjShowPreview();}
function rstjShowPreview(){
  var p=document.getElementById('rstjPhotoPreview'),btn=document.getElementById('rstjRecognizeBtn');
  if(!rstjPhotoFiles.length){p.style.display='none';btn.style.display='none';return;}
  p.style.display='block';
  p.innerHTML='<div style="font-size:12px;color:#8888aa;margin-bottom:6px">Выбрано: '+rstjPhotoFiles.length+' фото</div>'+
    '<div style="display:flex;gap:6px;flex-wrap:wrap">'+rstjPhotoFiles.map(function(f){return '<img src="'+URL.createObjectURL(f)+'" style="width:70px;height:70px;object-fit:cover;border-radius:8px;border:1px solid #2e2e3e">';}).join('')+'</div>';
  btn.style.display='block';
}
function rstjRecognize(){
  if(!rstjPhotoFiles.length){showToast('Выберите фото');return;}
  var shopName=(document.getElementById('rstjPhotoShop')||{}).value||'';
  var sellerHint=(document.getElementById('rstjPhotoSeller')||{}).value||'';
  var res=document.getElementById('rstjRecognizeResult');
  var btn=document.getElementById('rstjRecognizeBtn');
  btn.textContent='⏳ Распознаю...';btn.disabled=true;
  res.style.display='block';
  res.innerHTML='<div class="card"><div style="text-align:center;padding:20px"><div style="font-size:24px">🤖</div><div style="font-size:13px;color:#8888aa;margin-top:8px">AI читает журнал...</div></div></div>';
  var promises=rstjPhotoFiles.map(function(f){return fileToBase64(f);});
  Promise.all(promises).then(function(b64arr){
    var images=b64arr.map(function(b,i){return{mediaType:rstjPhotoFiles[i].type||'image/jpeg',base64:b};});
    var prompt='Распознай рукописный журнал продаж магазина "'+shopName+'".'+(sellerHint?'\nПродавец: '+sellerHint:'')+'\nПравила: нал→cash+cashAmount, П/Т/QR/СБП→cardAmount. Год 2026. Для групп товаров под одной скобкой указывай реальную цену каждого товара в поле price (через запятую, не делить общую сумму поровну).';
    return fetch(AI_PROXY_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:prompt,images:images})});
  }).then(function(r){return r.json();}).then(function(data){
    btn.textContent='🤖 Распознать AI';btn.disabled=false;
    if(data.error){res.innerHTML='<div class="al-err">❌ Ошибка сервера: '+(data.error.message||data.error)+'</div>';return;}
    var text=((data.choices||[])[0]||{}).message && data.choices[0].message.content || '';
    try{
      var parsed=JSON.parse(text);
      var entries=parsed.entries||[];
      if(!entries.length){res.innerHTML='<div class="al-warn">⚠️ Записей не найдено</div>';return;}
      showRstjRecognized(entries,shopName,res);
    }catch(e){res.innerHTML='<div class="al-err">❌ Не удалось распознать.<br><small>'+text.substring(0,150)+'</small></div>';}
  }).catch(function(e){btn.textContent='🤖 Распознать AI';btn.disabled=false;res.innerHTML='<div class="al-err">❌ '+e.message+'</div>';});
}
var rstjPending=[];
var rstjActiveResultEl=null; // контейнер, в который сейчас отрисован rstjPending —
function showRstjRecognized(entries,shopName,res){
  rstjPending=entries.map(function(e){return Object.assign({},e,{shopName:shopName});});
  rstjActiveResultEl=res;
  var uncertain=entries.filter(function(e){return e.uncertain;}).length;
  var html='<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div class="ctitle" style="margin:0">Распознано: '+entries.length+'</div>'+(uncertain?'<div style="font-size:11px;color:#f0a060;font-weight:700">⚠️ '+uncertain+' проверьте</div>':'<div style="font-size:11px;color:#60f090;font-weight:700">✅ Всё чётко</div>')+'</div>';
  html+=entries.map(function(e,i){
    var isU=e.uncertain;
    var tl={sale:'💰 Продажа',expense:'💸 Расход',writeoff:'🗑 Списание',receive:'📥 Приход'}[e.type]||'📝';
    return '<div style="background:'+(isU?'#2e1a00':'#1a1a22')+';border:1px solid '+(isU?'#f0a060':'#2e2e3e')+';border-radius:10px;padding:10px;margin-bottom:8px">'+
      (isU?'<div style="font-size:10px;color:#f0a060;font-weight:700;margin-bottom:4px">⚠️ ПРОВЕРЬТЕ</div>':'')+
      '<div style="display:flex;justify-content:space-between"><div><div class="u-fs13-bold">'+tl+' · '+(e.name||'?')+'</div><div class="u-fs11-gray">'+e.date+(e.sellerName?' · '+e.sellerName:'')+'</div></div><div style="font-family:Unbounded,sans-serif;font-size:13px;font-weight:700;color:'+(isU?'#f0a060':'#c8f060')+'">'+Math.round(e.amount||0).toLocaleString('ru-RU')+'₽</div></div>'+
      '<div style="display:flex;gap:6px;margin-top:8px"><button onclick="rstjEditEntry('+i+')" style="flex:1;padding:5px;border-radius:8px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:11px;cursor:pointer">✏️ Правка</button><button onclick="rstjRemoveEntry('+i+')" style="padding:5px 8px;border-radius:8px;border:1px solid #3e2e2e;background:#2e1a1a;color:#f06060;font-size:11px;cursor:pointer">✕</button></div>'+
    '</div>';
  }).join('');
  html+='<button class="btn" onclick="rstjSaveAll()" style="width:100%;margin-top:4px">💾 Сохранить в журнал</button></div>';
  res.innerHTML=html;
}
function rstjEditEntry(i){var e=rstjPending[i];var a=prompt('Сумма для "'+e.name+'"',e.amount||0);if(a!==null){rstjPending[i].amount=parseFloat(a)||0;rstjPending[i].uncertain=false;}var res=rstjActiveResultEl||document.getElementById('rstjRecognizeResult');showRstjRecognized(rstjPending,(rstjPending[0]&&rstjPending[0].shopName)||'',res);}
function rstjRemoveEntry(i){rstjPending.splice(i,1);var res=rstjActiveResultEl||document.getElementById('rstjRecognizeResult');if(rstjPending.length)showRstjRecognized(rstjPending,(rstjPending[0]&&rstjPending[0].shopName)||'',res);else res.innerHTML='';}
function rstjSaveAll(){
  if(!rstjPending.length){showToast('Нет записей');return;}
  var shopName=(rstjPending[0]&&rstjPending[0].shopName)||(document.getElementById('rstjPhotoShop')||{}).value||'';
  var added=0;
  if(restoreMode && session && session.shopName===shopName){
    rstjPending.forEach(function(e){
      var amt = e.amount||0;
      var cashAmt = e.cashAmount!=null ? e.cashAmount : (e.payMethod==='cash' && e.type==='sale' ? amt : 0);
      var cardAmt = e.cardAmount!=null ? e.cardAmount : (e.payMethod!=='cash' && e.type==='sale' ? amt : 0);
      var isDr = (e.goodsType||'derevo')==='dr';
      var typeLabel={sale:'Продажа',expense:'Расход',writeoff:'Списание',receive:'Приход товара'}[e.type||'sale'];
      var entry = {
        id:uid(), type:e.type||'sale', ts:_workingNowISO(),
        icon:{sale:'💰',writeoff:'🗑️',receive:'📥',expense:'💸'}[e.type||'sale']||'📝',
        label:typeLabel,
        sub:(e.name||'')+(e.article?' №'+e.article:'')+(e.sellerName?' · '+e.sellerName:'')+' · '+(e.payMethod||''),
        amount:amt, amtSign:(e.type==='expense'||e.type==='writeoff')?'−':'+',
        amtCls:(e.type==='expense'||e.type==='writeoff')?'exp':'inc',
        comment:(e.comment||'')+(e.uncertain?' ⚠️ требует проверки':''),
        source:'chatgpt_restore',
        goodsType:isDr?'dr':'derevo'
      };
      if((e.type||'sale')==='sale'){
        var names = (e.name||'Товар').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
        var articles = (e.article||'').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
        if(!names.length) names = ['Товар'];
        var pricesRaw = (e.price!=null ? String(e.price) : '').split(',').map(function(s){ return parseFloat(s.trim()); }).filter(function(n){ return !isNaN(n); });
        var fallbackPerItem = Math.round((amt/names.length)*100)/100;
        entry.items = names.map(function(nm, idx){
          var pr = pricesRaw[idx]!=null ? pricesRaw[idx] : fallbackPerItem;
          return {id:uid(), num:articles[idx]||'', name:nm, price:pr, qty:1, amt:pr,
            species:'', goodsType:isDr?'dr':'derevo', hasDiff:!!e.uncertain,
            diffNote:e.uncertain?'⚠️ распознано через ChatGPT, проверьте':''};
        });
        entry.totalPrice = amt + (e.discount||0);
        entry.totalPaid = amt;
        entry.payMethod = e.payMethod || (cashAmt>0 && cardAmt>0 ? 'mixed' : cashAmt>0 ? 'cash' : 'terminal');
        entry.cashPart = cashAmt;
        entry.cardPart = cardAmt;
        entry.discCategory = isDr ? 'dr' : 'derevo';
      }
      if(!isDr){
        entry.cashEffect = (e.type==='sale')?cashAmt:0;
        entry.cardEffect = (e.type==='sale')?cardAmt:0;
        entry.goodsEffect = e.type==='sale' ? -amt : e.type==='receive' ? amt : e.type==='writeoff' ? -amt : 0;
        if(e.type==='expense') entry.cashEffect = -amt;
      } else {
        entry.cashDrEffect = (e.type==='sale')?cashAmt:0;
        entry.cardDrEffect = (e.type==='sale')?cardAmt:0;
        entry.goodsDrEffect = e.type==='sale' ? -amt : e.type==='receive' ? amt : e.type==='writeoff' ? -amt : 0;
        if(e.type==='expense') entry.cashDrEffect = -amt;
      }
      if(e.discount){ entry.discount = e.discount; }
      journal.push(entry);
      added++;
    });
    saveJ();
    rstjPending=[];rstjPhotoFiles=[];rstjActiveResultEl=null;
    document.getElementById('rstjPhotoPreview').style.display='none';
    document.getElementById('rstjRecognizeBtn').style.display='none';
    document.getElementById('rstjRecognizeResult').style.display='none';
    document.getElementById('rstjPhotoInput').value='';
    var gptRes2=document.getElementById('rstjGptFileResult'); if(gptRes2) gptRes2.innerHTML='';
    var gptFi2=document.getElementById('rstjGptFileInput'); if(gptFi2) gptFi2.value='';
    renderAll();
    showToast('✅ Добавлено '+added+' записей в журнал смены');
    return;
  }
  var existing=getPsjEntries();
  rstjPending.forEach(function(e){
    var entry={id:uid(),date:normalizeDate(e.date),shopName:e.shopName||shopName,sellerName:e.sellerName||'',
      type:e.type||'sale',ts:_workingNowISO(),
      label:{sale:'Продажа',expense:'Расход',writeoff:'Списание',receive:'Приход товара'}[e.type||'sale'],
      sub:(e.name||'')+(e.article?' №'+e.article:'')+' · '+(e.payMethod||''),
      amount:e.amount||0,amtSign:e.type==='expense'||e.type==='writeoff'?'−':'+',
      cashEffect:e.cashAmount||(e.payMethod==='cash'&&e.type==='sale'?e.amount||0:0),
      cardEffect:e.cardAmount||(e.payMethod!=='cash'&&e.type==='sale'?e.amount||0:0),
      discEffect:e.discount||0,goodsType:e.goodsType||'derevo',
      comment:e.comment||'',isArchive:true,source:'photo_restore'};
    existing.push(entry);
    try{db.collection('iz_psj').doc(entry.id).set(entry);}catch(err){}
    added++;
  });
  savePsjEntries(existing);
  var hist=JSON.parse(localStorage.getItem('iz_photo_imports')||'[]');
  hist.unshift({id:uid(),date:new Date().toISOString().split('T')[0],count:added,shopName:shopName,importedAt:new Date().toISOString()});
  localStorage.setItem('iz_photo_imports',JSON.stringify(hist.slice(0,30)));
  rstjPending=[];rstjPhotoFiles=[];rstjActiveResultEl=null;
  document.getElementById('rstjPhotoPreview').style.display='none';
  document.getElementById('rstjRecognizeBtn').style.display='none';
  document.getElementById('rstjRecognizeResult').style.display='none';
  document.getElementById('rstjPhotoInput').value='';
  var gptRes=document.getElementById('rstjGptFileResult'); if(gptRes) gptRes.innerHTML='';
  var gptFi=document.getElementById('rstjGptFileInput'); if(gptFi) gptFi.value='';
  renderRstjHistory();
  if(_restoreShift && _restoreShift.shop===shopName){ try{ psjLoadJournal(); }catch(e){} }
  showToast('✅ Добавлено '+added+' записей в журнал — откройте вкладку «Вручную», чтобы их увидеть и поправить');
}
function showChatGptPromptTemplate(){
  var prompt =
    'Ты распознаёшь рукописный журнал продаж по фото.\n\n'+
    'ВАЖНО — формат ответа:\n'+
    '- Без вступлений, без пояснений, без рассуждений вслух, без вопросов мне.\n'+
    '- Сразу создай и пришли JSON-файл для скачивания (не печатай JSON текстом в чате).\n'+
    '- Если фото несколько и я присылаю их по одной — каждый раз присылай ОТДЕЛЬНЫЙ новый файл с записями именно с этого фото, не жди, пока я пришлю все фото.\n\n'+
    'Структура: JSON-массив объектов, каждый объект в точности в таком формате:\n\n'+
    '[\n'+
    '  {\n'+
    '    "date": "ДД.ММ или ГГГГ-ММ-ДД",\n'+
    '    "sellerName": "имя продавца если указано",\n'+
    '    "type": "sale",\n'+
    '    "name": "наименование товара",\n'+
    '    "article": "артикул или null",\n'+
    '    "price": 1500,\n'+
    '    "amount": 1500,\n'+
    '    "discount": 0,\n'+
    '    "payMethod": "cash",\n'+
    '    "cashAmount": 1500,\n'+
    '    "cardAmount": 0,\n'+
    '    "goodsType": "derevo",\n'+
    '    "comment": "",\n'+
    '    "uncertain": false\n'+
    '  }\n'+
    ']\n\n'+
    'Магазин в JSON указывать НЕ нужно — это поле я добавлю сама в приложении.\n\n'+
    'Правила распознавания:\n'+
    '- "type": "sale" — продажа, "expense" — расход, "writeoff" — списание, "receive" — приход товара\n'+
    '- "price" — цена ИМЕННО ЭТОГО товара, как написано в столбце "Цена" журнала напротив его строки. Для одиночной (не сгруппированной) продажи price совпадает с amount.\n'+
    '- "payMethod": "cash" если наличные, "terminal"/"sbp"/"qr"/"transfer" если безнал, "mixed" если смешанная оплата\n'+
    '- Если оплата наличными — сумму укажи в "cashAmount", если безналом — в "cardAmount" (для смешанной — в оба поля по факту, и cashAmount+cardAmount должны давать amount минус discount)\n'+
    '- "goodsType": "derevo" для деревянных изделий, "dr" для остальных товаров (ДР Товар)\n'+
    '- Год не указан на фото — считай 2026\n'+
    '- Если запись плохо читается или ты не уверен(а) — поставь "uncertain": true и впиши свою лучшую догадку. НЕ пропускай такие строки.\n'+
    '- Распознай ВСЕ строки на фото, ничего не пропускай и не сокращай список.\n\n'+
    'ВАЖНОЕ ПРАВИЛО ПРО ГРУППЫ ТОВАРОВ:\n'+
    'Иногда несколько строк с разными товарами объединены в журнале одной фигурной или квадратной скобкой '+
    'и у них ОДНА общая сумма оплаты на всех (одна цифра в столбце "нал" или "безнал" стоит напротив всей скобки) — '+
    'но при этом У КАЖДОГО ТОВАРА В СТРОКЕ ВСЁ РАВНО ЕСТЬ СВОЯ ЦЕНА в столбце "Цена", просто оплачены они одной суммой на кассе. '+
    'В этом случае:\n'+
    '- Сделай ОДНУ запись в JSON на всю группу, а не отдельную запись на каждый товар.\n'+
    '- В поле "name" перечисли все товары группы через запятую, например: "Свеча, Доска, Ложка".\n'+
    '- В поле "price" перечисли через запятую РЕАЛЬНУЮ цену каждого товара из столбца "Цена", в том же порядке, что и в "name" — например "1650, 1550, 700". НЕ дели общую сумму поровну, бери цену каждой строки как она написана.\n'+
    '- В "amount", "cashAmount"/"cardAmount" укажи ту единую сумму, что стоит у скобки (это то, что реально получено на кассу) — она может не совпадать с суммой всех price, если в скобке была скидка или округление, это нормально.\n'+
    '- Если у каждой строки в скобке всё же указан отдельный артикул — перечисли все артикулы через запятую в "article" в том же порядке, что и товары в "name".\n'+
    '- Если непонятно, объединены строки скобкой или нет — лучше поставь "uncertain": true и сделай отдельные записи, чем гадать.';
  document.getElementById('chatGptPromptText').value = prompt;
  openMo('chatGptPromptMo');
}
function copyChatGptPrompt(){
  var ta = document.getElementById('chatGptPromptText');
  ta.select(); ta.setSelectionRange(0, 99999);
  try { document.execCommand('copy'); showToast('✅ Скопировано'); }
  catch(e) {
    if(navigator.clipboard){ navigator.clipboard.writeText(ta.value).then(function(){ showToast('✅ Скопировано'); }); }
    else { showToast('Скопируйте вручную из поля'); }
  }
}
function handleRstjGptFileSelect(input){
  var file=input.files[0]; if(!file) return;
  readRstjGptFile(file);
}
function handleRstjGptFileDrop(ev){
  ev.preventDefault();
  var f=ev.dataTransfer.files[0];
  if(f){ document.getElementById('rstjGptFileInput').files=ev.dataTransfer.files; readRstjGptFile(f); }
}
function readRstjGptFile(file){
  var res = document.getElementById('rstjGptFileResult');
  var reader = new FileReader();
  reader.onload = function(e){
    var raw = e.target.result;
    var clean = raw.replace(/```json|```/g,'').trim();
    var entries;
    try { entries = JSON.parse(clean); }
    catch(err){ res.innerHTML='<div class="al-err">❌ Не удалось прочитать JSON. Проверьте, что в файле только текст ответа ChatGPT, без лишнего.<br><small style="color:#8888aa">'+err.message+'</small></div>'; return; }
    if(!Array.isArray(entries)){ entries = entries.entries || [entries]; }
    if(!entries.length){ res.innerHTML='<div class="al-warn">⚠️ В файле нет записей.</div>'; return; }
    var shopName, dateLabel;
    if(restoreMode && session && session.shopName){
      shopName = session.shopName;
      dateLabel = restoreMeta ? restoreMeta.date : (session.openedAt||'').split('T')[0];
    } else if(_restoreShift && _restoreShift.shop){
      shopName = _restoreShift.shop;
      dateLabel = _restoreShift.date;
    } else {
      res.innerHTML='<div class="al-err">❌ Сначала откройте смену восстановления (магазин и дату).</div>';
      return;
    }
    res.innerHTML = '<div class="al-ok" style="margin-bottom:8px">✅ Прочитано '+entries.length+' записей для «'+shopName+' · '+dateLabel+'» — проверьте и сохраните</div>';
    showRstjRecognized(entries, shopName, res);
  };
  reader.onerror = function(){ res.innerHTML='<div class="al-err">❌ Не удалось прочитать файл.</div>'; };
  reader.readAsText(file, 'UTF-8');
}
function openRestoreImportMo(){
  showPg('restore');
  updateRstMainBlockVisibility();
  switchRst('journal');
  switchRstJ('photo', document.getElementById('rstj_photo'));
  var backBtn = document.getElementById('restoreBackToShiftBtn');
  if(backBtn) backBtn.style.display = 'inline-block';
  var shopSel = document.getElementById('rstjPhotoShop');
  if(shopSel && session){
    for(var i=0;i<shopSel.options.length;i++){ if(shopSel.options[i].value===session.shopName){ shopSel.selectedIndex=i; break; } }
  }
  var sellerInput = document.getElementById('rstjPhotoSeller');
  if(sellerInput && session) sellerInput.value = session.sellerName||'';
}
function closeRestoreImportAndReturn(){
  var backBtn = document.getElementById('restoreBackToShiftBtn');
  if(backBtn) backBtn.style.display = 'none';
  showPg('home');
}
function handleRstjFileSelect(input){
  var file=input.files[0]; if(!file) return;
  readImportFile(file); // reuse existing
  document.getElementById('rstjFileResult').style.display='block';
  document.getElementById('rstjFileConfirmBtn').style.display='block';
  document.getElementById('rstjFileCancelBtn').style.display='block';
}
function handleRstjFileDrop(ev){ev.preventDefault();var f=ev.dataTransfer.files[0];if(f){document.getElementById('rstjFileInput').files=ev.dataTransfer.files;handleRstjFileSelect({files:ev.dataTransfer.files});}}
function rstjConfirmFileImport(){confirmImport();rstjCancelFile();}
function rstjCancelFile(){document.getElementById('rstjFileResult').style.display='none';document.getElementById('rstjFileConfirmBtn').style.display='none';document.getElementById('rstjFileCancelBtn').style.display='none';document.getElementById('rstjFileInput').value='';}
function renderRstjHistory(){
  var c=document.getElementById('rstjHistory'); if(!c) return;
  var hist=JSON.parse(localStorage.getItem('iz_photo_imports')||'[]');
  if(!hist.length){c.innerHTML='<div class="empty"><div class="ei">📷</div>Загрузок не было</div>';return;}
  c.innerHTML=hist.slice(0,10).map(function(h,i){
    var delKey = h.id||('idx:'+i);
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px;background:#22222e;border-radius:10px;margin-bottom:5px">'+
      '<div><div style="font-size:12px;font-weight:700">📷 '+h.shopName+'</div><div class="u-fs11-gray">'+h.date+' · '+h.count+' записей</div></div>'+
      '<div style="display:flex;align-items:center;gap:8px">'+
        '<div style="color:#60f090;font-weight:700;font-size:12px">+'+h.count+'</div>'+
        '<button onclick="deleteRstjHistoryEntry(\''+delKey+'\')" style="background:none;border:1px solid #3e2e2e;border-radius:6px;padding:3px 7px;color:#f06060;font-size:11px;cursor:pointer">✕</button>'+
      '</div>'+
    '</div>';
  }).join('');
}
function deleteRstjHistoryEntry(key){
  var hist=JSON.parse(localStorage.getItem('iz_photo_imports')||'[]');
  if(key.indexOf('idx:')===0){
    var idx=parseInt(key.slice(4),10);
    hist.splice(idx,1);
  } else {
    hist=hist.filter(function(h){ return h.id!==key; });
  }
  localStorage.setItem('iz_photo_imports',JSON.stringify(hist));
  renderRstjHistory();
}
function rstInitActivate(){
  var shops=getShopNames();
  var sel=document.getElementById('rstActShop');
  if(sel) sel.innerHTML='<option value="">Все магазины</option>'+shops.map(function(s){return '<option>'+s+'</option>';}).join('');
  var now=new Date(),y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0');
  var df=document.getElementById('rstActFrom'),dt=document.getElementById('rstActTo');
  if(df&&!df.value) df.value=y+'-'+m+'-01';
  if(dt&&!dt.value) dt.value=new Date(y,now.getMonth()+1,0).toISOString().split('T')[0];
  rstActPreview();
  renderActivatedList();
}
function setActPeriod(type,el){
  document.querySelectorAll('#rst_activate button[type=button]').forEach(function(b){b.style.background='#22222e';b.style.color='#8888aa';b.style.borderWidth='1px';b.style.borderColor='#2e2e3e';});
  el.style.background='#1e2a14';el.style.color='#c8f060';el.style.borderWidth='2px';el.style.borderColor='#c8f060';
  var now=new Date(),today=now.toISOString().split('T')[0],from,to=today;
  if(type==='month'){var y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0');from=y+'-'+m+'-01';}
  else if(type==='quarter'){var q=Math.floor(now.getMonth()/3),qm=String(q*3+1).padStart(2,'0');from=now.getFullYear()+'-'+qm+'-01';}
  else if(type==='year'){from=now.getFullYear()+'-01-01';}
  else{rstActPreview();return;}
  document.getElementById('rstActFrom').value=from;
  document.getElementById('rstActTo').value=to;
  rstActPreview();
}
function rstActPreview(){
  var from=(document.getElementById('rstActFrom')||{}).value||'';
  var to=(document.getElementById('rstActTo')||{}).value||'';
  var shop=(document.getElementById('rstActShop')||{}).value||'';
  var c=document.getElementById('rstActPreviewBlock'); if(!c) return;
  if(!from||!to){c.style.display='none';return;}
  var entries=getPsjEntries().filter(function(e){return e.date>=from&&e.date<=to&&(!shop||e.shopName===shop)&&e.isArchive&&!e.activated;});
  var shifts=getShifts().filter(function(s){return s.date>=from&&s.date<=to&&(!shop||s.shopName===shop)&&s.isArchive&&!s.activated;});
  c.style.display='block';
  var totRev=0;
  entries.forEach(function(e){if(e.type==='sale')totRev+=(e.cashEffect||0)+(e.cardEffect||0)+(e.discEffect||0);});
  c.innerHTML='<div style="background:#1e2a14;border:1px solid #c8f060;border-radius:10px;padding:12px">'+
    '<div style="font-size:12px;color:#8888aa;margin-bottom:8px">Период: '+from+' — '+to+(shop?' · '+shop:'')+'</div>'+
    '<div style="font-size:13px;margin-bottom:4px">📒 Записей журнала: <strong style="color:#c8f060">'+entries.length+'</strong></div>'+
    '<div style="font-size:13px;margin-bottom:4px">📋 Смен: <strong style="color:#c8f060">'+shifts.length+'</strong></div>'+
    '<div style="font-size:13px">💰 Выручка к активации: <strong style="color:#c8f060">'+Math.round(totRev).toLocaleString('ru-RU')+'₽</strong></div>'+
  '</div>';
}
function activateArchivePeriod(){
  var from=(document.getElementById('rstActFrom')||{}).value||'';
  var to=(document.getElementById('rstActTo')||{}).value||'';
  var shop=(document.getElementById('rstActShop')||{}).value||'';
  if(!from||!to){showToast('Укажите период');return;}
  if(!confirm('Активировать период '+from+' — '+to+'? Данные войдут в общую статистику.')){return;}
  var entries=getPsjEntries();
  var activated=0;
  entries.forEach(function(e){
    if(e.date>=from&&e.date<=to&&(!shop||e.shopName===shop)&&e.isArchive&&!e.activated){
      e.activated=true; e.activatedAt=new Date().toISOString(); activated++;
    }
  });
  savePsjEntries(entries);
  var groupsToBuild = {};
  entries.forEach(function(e){
    if(e.date>=from && e.date<=to && (!shop||e.shopName===shop)){
      var gKey = (e.shopName||'')+'|'+e.date;
      if(!groupsToBuild[gKey]) groupsToBuild[gKey] = [];
      groupsToBuild[gKey].push(e);
    }
  });
  var shifts=getShifts();
  Object.keys(groupsToBuild).forEach(function(gKey){
    var groupEntries = groupsToBuild[gKey];
    var gShop = groupEntries[0].shopName||'';
    var gDate = groupEntries[0].date;
    var sellerName = '';
    for(var i=groupEntries.length-1;i>=0;i--){ if(groupEntries[i].sellerName){ sellerName=groupEntries[i].sellerName; break; } }
    var cashRev=0, cardRev=0, disc=0, exp=0;
    var journalForShift = groupEntries.map(function(e){
      cashRev += e.cashEffect||0; cardRev += e.cardEffect||0; disc += e.discEffect||0;
      if(e.type==='expense') exp += e.amount||0;
      return { id:e.id, type:e.type, ts:e.date+'T12:00:00.000Z', icon: {sale:'💰',writeoff:'🗑️',receive:'📥',expense:'💸',staff:'🛒'}[e.type]||'📝',
        label:e.label, sub:e.sub, amount:e.amount, amtCls:e.type==='sale'?'pos':'exp', amtSign:e.amtSign,
        goodsType: e.goodsType, items: e.items, who: e.who, opt: e.opt, retail: e.retail, from: e.from, expType: e.expType,
        cashEffect:e.cashEffect||0, cardEffect:e.cardEffect||0, staffEffect:0, goodsEffect: e.type==='sale'?-(e.amount||0): e.type==='receive'?(e.amount||0): e.type==='writeoff'?-(e.amount||0):0 };
    });
    var shiftObj = {
      id: uid(), source: 'psj', isArchive: true, backfilled: true, activated: true, activatedAt: new Date().toISOString(),
      shopName: gShop, sellerName: sellerName, date: gDate,
      openedAt: gDate+'T09:00:00.000Z', closedAt: gDate+'T21:00:00.000Z', status: 'closed',
      cashRevenue: cashRev, cardRevenue: cardRev, totalDiscount: disc,
      totalRevenue: cashRev + cardRev + disc,
      salesCount: journalForShift.filter(function(e){return e.type==='sale';}).length,
      zp: journalForShift.filter(function(e){return e.type==='expense'&&e.expType==='zp';}).reduce(function(s,e){return s+e.amount;},0),
      travel: journalForShift.filter(function(e){return e.type==='expense'&&e.expType==='travel';}).reduce(function(s,e){return s+e.amount;},0),
      inkass: journalForShift.filter(function(e){return e.type==='expense'&&e.expType==='inkass'&&e.goodsType!=='dr';}).reduce(function(s,e){return s+e.amount;},0),
      otherExp: journalForShift.filter(function(e){return e.type==='expense'&&e.expType==='other'&&e.goodsType!=='dr';}).reduce(function(s,e){return s+e.amount;},0),
      supplierExp: journalForShift.filter(function(e){return e.type==='expense'&&e.expType==='supplier'&&e.goodsType!=='dr';}).reduce(function(s,e){return s+e.amount;},0),
      drInkass: journalForShift.filter(function(e){return e.type==='expense'&&e.expType==='inkass'&&e.goodsType==='dr';}).reduce(function(s,e){return s+e.amount;},0),
      drSupplierAmt: journalForShift.filter(function(e){return e.type==='expense'&&e.expType==='supplier'&&e.goodsType==='dr';}).reduce(function(s,e){return s+e.amount;},0),
      expenses: journalForShift.filter(function(e){return e.type==='expense';}),
      journal: journalForShift,
      savedAt: new Date().toISOString(), savedBy: (session&&session.name)||'Admin'
    };
    shifts = shifts.filter(function(s){ return !(s.date===gDate && s.shopName===gShop && s.source==='psj'); });
    shifts.unshift(shiftObj);
    try { db.collection('iz_shifts').doc(shiftObj.id).set(shiftObj); } catch(e) {}
  });
  saveShifts(shifts);
  var acts=JSON.parse(localStorage.getItem('iz_activations')||'[]');
  acts.unshift({id:uid(),from:from,to:to,shopName:shop||'Все',activatedAt:new Date().toISOString(),count:activated,by:(session&&session.name)||'Admin'});
  localStorage.setItem('iz_activations',JSON.stringify(acts));
  rstActPreview(); renderActivatedList();
  showToast('✅ Активировано '+activated+' записей за период '+from+' — '+to);
}
function renderActivatedList(){
  var c=document.getElementById('rstActivatedList'); if(!c) return;
  var acts=JSON.parse(localStorage.getItem('iz_activations')||'[]');
  if(!acts.length){c.innerHTML='<div class="empty"><div class="ei">✅</div>Нет активированных периодов</div>';return;}
  c.innerHTML=acts.map(function(a){
    return '<div style="padding:10px;background:#1e2a14;border:1px solid #c8f060;border-radius:10px;margin-bottom:6px">'+
      '<div class="u-fs13-bold">✅ '+a.from+' — '+a.to+'</div>'+
      '<div style="font-size:11px;color:#8888aa;margin-top:3px">'+a.shopName+' · '+a.count+' записей · '+a.activatedAt.split('T')[0]+' · '+a.by+'</div>'+
    '</div>';
  }).join('');
}
function manInvLoadFile(input){
  var file = input.files && input.files[0];
  if(!file) return;
  var resultEl = document.getElementById('manInvFileResult');
  if(resultEl) resultEl.innerHTML='⏳ Читаю файл...';
  var reader = new FileReader();
  reader.onload = function(e){
    try{
      var data = JSON.parse(e.target.result);
      var invs = Array.isArray(data) ? data : [data];
      var inv = invs.find(function(i){ return i.items && i.items.length; }) || invs[0];
      if(!inv){ if(resultEl) resultEl.innerHTML='<span style="color:#f06060">❌ Нет позиций в файле</span>'; return; }
      var numEl=document.getElementById('manInvNum');
      var fromEl=document.getElementById('manInvFrom');
      var dateEl=document.getElementById('manInvDate');
      if(numEl && inv.num) numEl.value=inv.num;
      if(fromEl && !fromEl.value) fromEl.value=inv.from||inv.destName||'Мастерская Ижица';
      if(dateEl && inv.date && !dateEl.value){
        var d=inv.date;
        if(d && d.indexOf('.')>0){ var p=d.split('.'); if(p.length===3) d=p[2]+'-'+p[1]+'-'+p[0]; }
        dateEl.value=d;
      }
      var gt = inv.goodsType||'derevo';
      setManInvType(gt);
      _manInvItems = (inv.items||[]).map(function(it){
        return { article:it.article||it.num||it.artNum||'', name:it.name||'', species:it.species||'', price:it.price||it.factPrice||0, qty:it.qty||1, goodsType:it.goodsType||gt };
      });
      _manInvExpanded = -1;
      renderManInvItems();
      updateManInvTotal();
      saveManInvDraft();
      var total=_manInvItems.reduce(function(s,it){return s+(it.qty||1)*(it.price||0);},0);
      if(resultEl) resultEl.innerHTML='<span style="color:#60f090">✅ Загружено '+_manInvItems.length+' позиций · '+Math.round(total).toLocaleString('ru-RU')+'₽</span>';
      input.value='';
    }catch(err){
      if(resultEl) resultEl.innerHTML='<span style="color:#f06060">❌ Ошибка: '+err.message+'</span>';
    }
  };
  reader.readAsText(file);
}
var _rcvWordFixes = [
  {from:'доска', to:'Доска'},
  {from:'доска для подачи', to:'Доска для подачи'},
  {from:'поднос', to:'Поднос'},
  {from:'менажница', to:'Менажница'},
  {from:'ложка', to:'Ложка'},
  {from:'лопатка', to:'Лопатка'},
  {from:'капа', to:'Капа'},
  {from:'соусник', to:'Соусник'},
  {from:'подсвечник', to:'Подсвечник'},
  {from:'кружка', to:'Кружка'},
  {from:'тарелка', to:'Тарелка'},
  {from:'миска', to:'Миска'},
  {from:'вилка', to:'Вилка'},
  {from:'нож', to:'Нож'},
  {from:'чашка', to:'Чашка'},
  {from:'блюдце', to:'Блюдце'},
  {from:'бокал', to:'Бокал'},
  {from:'стакан', to:'Стакан'},
  {from:'подставка', to:'Подставка'},
  {from:'рамка', to:'Рамка'},
  {from:'шкатулка', to:'Шкатулка'},
  {from:'шпатель', to:'Шпатель'}
];
function ghOnFileSelected(input){
  var nameEl = document.getElementById('ghFileName');
  var pathEl = document.getElementById('ghPathInput');
  var file = input.files && input.files[0];
  if(nameEl) nameEl.textContent = file ? file.name : 'Выбрать файл (.html, .js, .css...)';
  if(pathEl && file && !pathEl.value.trim()) pathEl.value = file.name;
}
function uploadToGitHub(){
  var tokenEl = document.getElementById('ghTokenInput');
  var statusEl = document.getElementById('ghUploadStatus');
  var pathEl = document.getElementById('ghPathInput');
  var token = (tokenEl && tokenEl.value.trim()) || localStorage.getItem('iz_gh_token') || '';
  if(!token){ if(statusEl) statusEl.innerHTML='<span style="color:#f06060">❌ Введите токен</span>'; return; }
  var fileInput = document.getElementById('ghFileInput');
  var selectedFile = fileInput && fileInput.files && fileInput.files[0];
  var path = (pathEl && pathEl.value.trim()) || (selectedFile && selectedFile.name) || 'izhitsa-shop.html';
  localStorage.setItem('iz_gh_token', token);
  if(statusEl) statusEl.innerHTML='⏳ Читаю текущий файл с GitHub ('+path+')...';
  var owner = 'ksshilk-ship-it';
  var repo = 'izhitsa';
  var apiBase = 'https://api.github.com/repos/'+owner+'/'+repo+'/contents/'+path;
  fetch(apiBase, {
    headers: {'Authorization': 'token '+token, 'Accept': 'application/vnd.github.v3+json'}
  }).then(function(r){
    if(!r.ok){ throw new Error('GitHub API: HTTP '+r.status+' ('+r.statusText+') — проверьте путь "'+path+'"'); }
    return r.json();
  }).then(function(meta){
    var sha = meta.sha;
    if(!sha){ throw new Error('Нет SHA: '+(meta.message||JSON.stringify(meta))); }
    if(statusEl) statusEl.innerHTML='⏳ Читаю файл...';
    var filePromise;
    if(selectedFile){
      filePromise = new Promise(function(resolve, reject){
        var reader = new FileReader();
        reader.onload = function(e){ resolve(e.target.result); };
        reader.onerror = function(){ reject(new Error('Ошибка чтения файла')); };
        reader.readAsText(selectedFile);
      });
    } else {
      filePromise = fetch(window.location.href).then(function(r){ return r.text(); });
    }
    return filePromise.then(function(content){
      var b64 = btoa(unescape(encodeURIComponent(content)));
      if(statusEl) statusEl.innerHTML='⏳ Загружаю на GitHub ('+path+', '+Math.round(b64.length/1024)+' КБ)...';
      return fetch(apiBase, {
        method: 'PUT',
        headers: {
          'Authorization': 'token '+token,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: 'Update '+path+' via in-app upload',
          content: b64,
          sha: sha,
          branch: 'main'
        })
      }).then(function(r){ var s=r.status; return r.json().then(function(j){ return {status:s,body:j}; }); });
    });
  }).then(function(res){
    var result=res.body; var httpStatus=res.status;
    if(result.content && result.content.sha){
      if(statusEl) statusEl.innerHTML='<span style="color:#60f090">✅ '+path+' загружен! GitHub Pages обновится через 1-2 минуты.</span>';
      if(tokenEl) tokenEl.value='';
    } else {
      if(statusEl) statusEl.innerHTML='<span style="color:#f06060">❌ HTTP '+httpStatus+': '+(result.message||JSON.stringify(result))+'</span>';
    }
  }).catch(function(err){
    var msg = err.message||String(err);
    if(msg==='Failed to fetch'||msg==='Load failed'||msg==='NetworkError when attempting to fetch resource.'){
      msg = 'Сетевая ошибка. Проверьте: 1) интернет 2) открыт ли сайт по HTTPS 3) попробуйте в Safari вместо приложения';
    }
    if(statusEl) statusEl.innerHTML='<span style="color:#f06060">❌ '+msg+'</span>';
  });
}
var _nameMatchQueue = [];   // [{oldName, newName, type, path}]
var _nameMatchIdx = 0;
var _nameMatchApproved = [];
var _nameMatchSkipped = 0;
function nameSimilarity(a, b){
  var na = a.toLowerCase().trim();
  var nb = b.toLowerCase().trim();
  if(na === nb) return 1.0;
  if(nb.indexOf(na) >= 0 || na.indexOf(nb) >= 0) return 0.85;
  var wa = na.split(/\s+/);
  var wb = nb.split(/\s+/);
  var matches = wa.filter(function(w){ return wb.indexOf(w) >= 0; }).length;
  var score = matches / Math.max(wa.length, wb.length);
  if(wa[0] === wb[0]) score = Math.min(1, score + 0.2);
  return score;
}
function nameMatchShowNext(){
  if(_nameMatchIdx >= _nameMatchQueue.length){
    closeMo('nameMatchMo');
    nameMatchApplyAll();
    return;
  }
  var item = _nameMatchQueue[_nameMatchIdx];
  var prog = document.getElementById('nameMatchProgress');
  var oldEl = document.getElementById('nameMatchOld');
  var newEl = document.getElementById('nameMatchNew');
  var ctxEl = document.getElementById('nameMatchCtx');
  if(prog) prog.textContent = (_nameMatchIdx+1) + ' из ' + _nameMatchQueue.length;
  if(oldEl) oldEl.textContent = item.oldName;
  if(newEl) newEl.textContent = item.newName;
  if(ctxEl) ctxEl.textContent = item.ctx + ' (схожесть: ' + Math.round(item.score*100) + '%)';
  openMo('nameMatchMo');
}
function nameMatchApplyAll(){
  if(!_nameMatchApproved.length){
    showToast('Проверка завершена · пропущено: '+_nameMatchSkipped);
    return;
  }
  var renameMap = {};
  _nameMatchApproved.forEach(function(a){ renameMap[a.oldName.toLowerCase().trim()] = a.newName; });
  function fixName(name){
    if(!name) return name;
    return renameMap[name.toLowerCase().trim()] || name;
  }
  var changed = 0;
  var shifts = JSON.parse(localStorage.getItem('iz_shifts')||'[]');
  shifts.forEach(function(sh){
    var shChanged = false;
    (sh.journal||[]).forEach(function(e){
      (e.items||[]).forEach(function(it){
        var nn = fixName(it.name);
        if(nn !== it.name){ it.name=nn; changed++; shChanged=true; }
      });
    });
    if(shChanged){
      try{ db.collection('iz_shifts').doc(sh.id||sh._id).set(sh,{merge:true}); }catch(e){}
    }
  });
  localStorage.setItem('iz_shifts', JSON.stringify(shifts));
  var manInvs = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  manInvs.forEach(function(inv){
    var invChanged = false;
    (inv.items||[]).forEach(function(it){
      var nn = fixName(it.name);
      if(nn !== it.name){ it.name=nn; changed++; invChanged=true; }
    });
    if(invChanged){
      var id=inv.id||inv._id;
      if(id) try{ db.collection('iz_manual_invoices').doc(id).set(inv,{merge:true}); }catch(e){}
    }
  });
  localStorage.setItem('iz_manual_invoices', JSON.stringify(manInvs));
  var wsInvs = JSON.parse(localStorage.getItem('iz_invoices')||'[]');
  wsInvs.forEach(function(inv){
    var invChanged = false;
    (inv.items||[]).forEach(function(it){
      var nn = fixName(it.name);
      if(nn !== it.name){ it.name=nn; changed++; invChanged=true; }
    });
    (inv.acceptedItems||[]).forEach(function(it){
      var nn = fixName(it.name);
      if(nn !== it.name){ it.name=nn; changed++; invChanged=true; }
    });
    if(invChanged){
      var id=inv.id||inv._id;
      if(id) try{ db.collection('iz_invoices').doc(id).set(inv,{merge:true}); }catch(e){}
    }
  });
  localStorage.setItem('iz_invoices', JSON.stringify(wsInvs));
  var stock = JSON.parse(localStorage.getItem('iz_stock')||'{}');
  Object.keys(stock).forEach(function(sn){
    Object.keys(stock[sn]||{}).forEach(function(key){
      var it=stock[sn][key];
      var nn=fixName(it.name);
      if(nn!==it.name){ it.name=nn; changed++; }
    });
  });
  localStorage.setItem('iz_stock', JSON.stringify(stock));
  showToast('✅ Переименовано: '+changed+' позиций · одобрено: '+_nameMatchApproved.length+' · пропущено: '+_nameMatchSkipped);
}
var _dupWarnCallback = null; // function(useExisting)
function dupWarnUseExisting(){
  var banner = document.getElementById('dupWarnBanner');
  if(banner) banner.style.display='none';
  if(_dupWarnCallback) _dupWarnCallback(true);
  _dupWarnCallback = null;
}
function dupWarnDismiss(){
  var banner = document.getElementById('dupWarnBanner');
  if(banner) banner.style.display='none';
  if(_dupWarnCallback) _dupWarnCallback(false);
  _dupWarnCallback = null;
}
function showDupWarning(entered, existingName, onDismiss){
  var banner = document.getElementById('dupWarnBanner');
  var entEl = document.getElementById('dupWarnEntered');
  var exEl = document.getElementById('dupWarnExisting');
  if(!banner) return;
  if(entEl) entEl.textContent = entered;
  if(exEl) exEl.textContent = existingName;
  banner.style.display='flex';
  _dupWarnCallback = onDismiss;
}
var _speciesMatchQueue = [];
var _speciesMatchIdx = 0;
var _speciesMatchApproved = [];
var _speciesMatchSkipped = 0;
var _speciesMatchQueue_active = false;
function nameMatchShowNextSpecies(){
  if(_speciesMatchIdx >= _speciesMatchQueue.length){
    closeMo('nameMatchMo');
    speciesMatchApplyAll();
    return;
  }
  var item = _speciesMatchQueue[_speciesMatchIdx];
  var prog=document.getElementById('nameMatchProgress');
  var oldEl=document.getElementById('nameMatchOld');
  var newEl=document.getElementById('nameMatchNew');
  var ctxEl=document.getElementById('nameMatchCtx');
  if(prog) prog.textContent=(_speciesMatchIdx+1)+' из '+_speciesMatchQueue.length+' · Породы дерева';
  if(oldEl) oldEl.textContent=item.oldName;
  if(newEl) newEl.textContent=item.newName;
  if(ctxEl) ctxEl.textContent=item.ctx+' (схожесть: '+Math.round(item.score*100)+'%)';
  openMo('nameMatchMo');
}
function speciesMatchApplyAll(){
  if(!_speciesMatchApproved.length){
    showToast('Проверка пород завершена · пропущено: '+_speciesMatchSkipped);
    _speciesMatchQueue_active = false;
    return;
  }
  var renameMap={};
  _speciesMatchApproved.forEach(function(a){ renameMap[a.oldName.toLowerCase().trim()]=a.newName; });
  function fixSpecies(name){
    if(!name) return name;
    return renameMap[name.toLowerCase().trim()]||name;
  }
  var changed=0;
  var shifts=JSON.parse(localStorage.getItem('iz_shifts')||'[]');
  shifts.forEach(function(sh){
    var shChanged=false;
    (sh.journal||[]).forEach(function(e){
      (e.items||[]).forEach(function(it){
        var nn=fixSpecies(it.species);
        if(nn!==it.species){ it.species=nn; changed++; shChanged=true; }
      });
    });
    if(shChanged) try{ db.collection('iz_shifts').doc(sh.id||sh._id).set(sh,{merge:true}); }catch(e){}
  });
  localStorage.setItem('iz_shifts',JSON.stringify(shifts));
  var manInvs=JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  manInvs.forEach(function(inv){
    var invChanged=false;
    (inv.items||[]).forEach(function(it){
      var nn=fixSpecies(it.species);
      if(nn!==it.species){ it.species=nn; changed++; invChanged=true; }
    });
    if(invChanged){ var id=inv.id||inv._id; if(id) try{ db.collection('iz_manual_invoices').doc(id).set(inv,{merge:true}); }catch(e){} }
  });
  localStorage.setItem('iz_manual_invoices',JSON.stringify(manInvs));
  var wsInvs=JSON.parse(localStorage.getItem('iz_invoices')||'[]');
  wsInvs.forEach(function(inv){
    var invChanged=false;
    (inv.items||[]).concat(inv.acceptedItems||[]).forEach(function(it){
      var nn=fixSpecies(it.species);
      if(nn!==it.species){ it.species=nn; changed++; invChanged=true; }
    });
    if(invChanged){ var id=inv.id||inv._id; if(id) try{ db.collection('iz_invoices').doc(id).set(inv,{merge:true}); }catch(e){} }
  });
  localStorage.setItem('iz_invoices',JSON.stringify(wsInvs));
  var stock=JSON.parse(localStorage.getItem('iz_stock')||'{}');
  Object.keys(stock).forEach(function(sn){
    Object.keys(stock[sn]||{}).forEach(function(key){
      var it=stock[sn][key];
      var nn=fixSpecies(it.species);
      if(nn!==it.species){ it.species=nn; changed++; }
    });
  });
  localStorage.setItem('iz_stock',JSON.stringify(stock));
  _speciesMatchQueue_active=false;
  showToast('✅ Пород исправлено: '+changed+' · одобрено: '+_speciesMatchApproved.length+' · пропущено: '+_speciesMatchSkipped);
}
var _drMatchQueue = [];
var _drMatchIdx = 0;
var _drMatchApproved = [];
var _drMatchSkipped = 0;
var _drMatchQueue_active = false;
function drMatchShowNext(){
  if(_drMatchIdx>=_drMatchQueue.length){
    closeMo('nameMatchMo');
    drMatchApplyAll();
    return;
  }
  var item=_drMatchQueue[_drMatchIdx];
  var fieldLabel = item.field==='species' ? '🛍 Состав/Вкус' : '🛍 Название ДР';
  var prog=document.getElementById('nameMatchProgress');
  var oldEl=document.getElementById('nameMatchOld');
  var newEl=document.getElementById('nameMatchNew');
  var ctxEl=document.getElementById('nameMatchCtx');
  if(prog) prog.textContent=(_drMatchIdx+1)+' из '+_drMatchQueue.length+' · '+fieldLabel;
  if(oldEl) oldEl.textContent=item.oldName;
  if(newEl) newEl.textContent=item.newName;
  if(ctxEl) ctxEl.textContent=item.ctx+' (схожесть: '+Math.round(item.score*100)+'%)';
  openMo('nameMatchMo');
}
function nameMatchDecision(approve){
  if(_drMatchQueue_active){
    if(approve) _drMatchApproved.push(_drMatchQueue[_drMatchIdx]);
    else _drMatchSkipped++;
    _drMatchIdx++;
    drMatchShowNext();
  } else if(_speciesMatchQueue_active){
    if(approve) _speciesMatchApproved.push(_speciesMatchQueue[_speciesMatchIdx]);
    else _speciesMatchSkipped++;
    _speciesMatchIdx++;
    nameMatchShowNextSpecies();
  } else {
    if(approve) _nameMatchApproved.push(_nameMatchQueue[_nameMatchIdx]);
    else _nameMatchSkipped++;
    _nameMatchIdx++;
    nameMatchShowNext();
  }
}
function nameMatchFinish(){
  closeMo('nameMatchMo');
  if(_drMatchQueue_active){
    if(_drMatchApproved.length) drMatchApplyAll(); else showToast('Проверка завершена без изменений');
  } else if(_speciesMatchQueue_active){
    if(_speciesMatchApproved.length) speciesMatchApplyAll(); else showToast('Проверка завершена без изменений');
  } else {
    if(_nameMatchApproved.length) nameMatchApplyAll(); else showToast('Проверка завершена без изменений');
  }
}
function drMatchApplyAll(){
  if(!_drMatchApproved.length){
    showToast('ДР: проверка завершена · пропущено: '+_drMatchSkipped);
    _drMatchQueue_active=false; return;
  }
  var renameNames={}, renameSpecies={};
  _drMatchApproved.forEach(function(a){
    if(a.field==='species') renameSpecies[a.oldName.toLowerCase().trim()]=a.newName;
    else renameNames[a.oldName.toLowerCase().trim()]=a.newName;
  });
  function fixDrName(n){ if(!n) return n; return renameNames[n.toLowerCase().trim()]||n; }
  function fixDrSp(n){ if(!n) return n; return renameSpecies[n.toLowerCase().trim()]||n; }
  var changed=0;
  var shifts=JSON.parse(localStorage.getItem('iz_shifts')||'[]');
  shifts.forEach(function(sh){
    var shChanged=false;
    (sh.journal||[]).forEach(function(e){
      (e.items||[]).forEach(function(it){
        if(it.goodsType!=='dr') return;
        var nn=fixDrName(it.name); if(nn!==it.name){ it.name=nn; changed++; shChanged=true; }
        var ns=fixDrSp(it.species); if(ns!==it.species){ it.species=ns; changed++; shChanged=true; }
      });
    });
    if(shChanged) try{ db.collection('iz_shifts').doc(sh.id||sh._id).set(sh,{merge:true}); }catch(e){}
  });
  localStorage.setItem('iz_shifts',JSON.stringify(shifts));
  var manInvs=JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  manInvs.forEach(function(inv){
    var invChanged=false;
    (inv.items||[]).forEach(function(it){
      var nn=fixDrName(it.name); if(nn!==it.name){ it.name=nn; changed++; invChanged=true; }
      var ns=fixDrSp(it.species); if(ns!==it.species){ it.species=ns; changed++; invChanged=true; }
    });
    if(invChanged){ var id=inv.id||inv._id; if(id) try{ db.collection('iz_manual_invoices').doc(id).set(inv,{merge:true}); }catch(e){} }
  });
  localStorage.setItem('iz_manual_invoices',JSON.stringify(manInvs));
  var wsInvs=JSON.parse(localStorage.getItem('iz_invoices')||'[]');
  wsInvs.forEach(function(inv){
    var invChanged=false;
    (inv.items||[]).concat(inv.acceptedItems||[]).forEach(function(it){
      if(it.goodsType!=='dr') return;
      var nn=fixDrName(it.name); if(nn!==it.name){ it.name=nn; changed++; invChanged=true; }
      var ns=fixDrSp(it.species); if(ns!==it.species){ it.species=ns; changed++; invChanged=true; }
    });
    if(invChanged){ var id=inv.id||inv._id; if(id) try{ db.collection('iz_invoices').doc(id).set(inv,{merge:true}); }catch(e){} }
  });
  localStorage.setItem('iz_invoices',JSON.stringify(wsInvs));
  _drMatchQueue_active=false;
  showToast('✅ ДР исправлено: '+changed+' · одобрено: '+_drMatchApproved.length+' · пропущено: '+_drMatchSkipped);
}
