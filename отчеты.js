function calcTotals(){
  var cash=session.cashMorning||0, card=0, staff=0, goods=session.goodsMorning||0;
  var cashDr=session.cashDrMorning||0, goodsDr=session.goodsDrMorning||0;
  var revenue=0, discount=0;
  journal.forEach(function(e){
    cash+=(e.cashEffect||0); card+=(e.cardEffect||0);
    if(e.staffEffect) staff+=e.staffEffect;
    else if(e.type==='expense' && e.goodsType==='staff') staff-=(e.amount||0);
    goods+=(e.goodsEffect||0);
    cashDr+=(e.cashDrEffect||0); goodsDr+=(e.goodsDrEffect||0);
    if(e.type==='sale'){ revenue+=(e.amount||0); discount+=(e.discount||0); }
  });
  return {cash,card,staff,goods,cashDr,goodsDr,revenue,discount};
}
function calcSellerSummary(){
  var sales = journal.filter(function(e){ return e.type==='sale'; });
  var writeoffs = journal.filter(function(e){ return e.type==='writeoff'; });
  var receives = journal.filter(function(e){ return e.type==='receive'; });
  function emptyPay(){ return {cash:0,terminal:0,sbp:0,transfer:0,qr:0,rs:0}; }
  function group(isDr){
    var listPrice=0, discount=0, pay=emptyPay(), count=0;
    sales.forEach(function(e){
      var items=e.items||[];
      var itemAmt=function(it){ return it.amt!=null?it.amt:(it.price||0)*(it.qty||1); };
      if(!items.length){
        if(isDr) return;
        listPrice += (e.amount||0)+(e.discount||0);
        discount += (e.discount||0);
        count += 1;
        var cash0=e.cashEffect||0, card0=e.cardEffect||0;
        if(e.payMethod==='mixed'){ pay.cash+=cash0; pay.terminal+=card0; }
        else { var k0=pay.hasOwnProperty(e.payMethod)?e.payMethod:'terminal'; pay[k0]+=cash0+card0; }
        return;
      }
      var groupItems = items.filter(function(it){ return isDr ? it.goodsType==='dr' : it.goodsType!=='dr'; });
      if(!groupItems.length) return;
      var groupTotal = groupItems.reduce(function(s,it){ return s+itemAmt(it); },0);
      var saleTotal = e.totalPrice || items.reduce(function(s,it){ return s+itemAmt(it); },0) || 1;
      listPrice += groupTotal;
      if(e.discCategory==='derevo'){
        var woodTotalForSale = items.reduce(function(s,it){ return it.goodsType==='dr'?s:s+itemAmt(it); },0);
        var discWoodForSale = Math.min(e.discount||0, woodTotalForSale);
        discount += isDr ? (e.discount||0)-discWoodForSale : discWoodForSale;
      } else if(e.discCategory==='dr'){
        var drTotalForSale = items.reduce(function(s,it){ return it.goodsType==='dr'?s+itemAmt(it):s; },0);
        var discDrForSale = Math.min(e.discount||0, drTotalForSale);
        discount += isDr ? discDrForSale : (e.discount||0)-discDrForSale;
      } else {
        var share = groupTotal/saleTotal;
        discount += (e.discount||0)*share;
      }
      count += groupItems.reduce(function(s,it){ return s+(it.qty||1); },0);
      var cash = isDr ? (e.cashDrEffect||0) : (e.cashEffect||0);
      var card = isDr ? (e.cardDrEffect||0) : (e.cardEffect||0);
      if(e.payMethod==='mixed'){ pay.cash+=cash; pay.terminal+=card; }
      else { var k=pay.hasOwnProperty(e.payMethod)?e.payMethod:'terminal'; pay[k]+=cash+card; }
    });
    return {listPrice:listPrice, discount:discount, pay:pay, count:count};
  }
  var wood = group(false), dr = group(true);
  var woWood = writeoffs.reduce(function(s,e){ return s-(e.goodsEffect||0); },0);
  var woDr = writeoffs.reduce(function(s,e){ return s-(e.goodsDrEffect||0); },0);
  var rcvWood = receives.reduce(function(s,e){ return s+(e.goodsEffect||0); },0);
  var rcvDr = receives.reduce(function(s,e){ return s+(e.goodsDrEffect||0); },0);
  var totalRevenue = wood.listPrice + dr.listPrice; // includes discounts (полная стоимость)
  var totalDiscount = wood.discount + dr.discount;
  var t = calcTotals();
  var staffWood = journal.reduce(function(s,e){ return e.type==='staff' && (e.goodsType!=='dr') ? s+(e.staffEffect||0) : s; },0);
  var staffDr = journal.reduce(function(s,e){ return e.type==='staff' && e.goodsType==='dr' ? s+(e.staffEffect||0) : s; },0);
  if(staffWood===0 && staffDr===0) staffWood = t.staff;
  return {
    wood: wood, dr: dr,
    totalRevenue: totalRevenue, totalDiscount: totalDiscount,
    staffWood: staffWood, staffDr: staffDr, staffTotal: t.staff,
    staffCashBalance: (session.cashStaffMorning||0) + t.staff,
    cashWood: t.cash, cashDr: t.cashDr, cashTotal: t.cash+t.cashDr+(session.cashStaffMorning||0)+t.staff,
    goodsWood: t.goods, goodsDr: t.goodsDr,
    woWood: woWood, woDr: woDr, rcvWood: rcvWood, rcvDr: rcvDr
  };
}
function renderStatusBar(){
  var c=document.getElementById('mainStatusBar'); if(!c) return;
  var shopType = (session.shopType) || getShopType(session.shopName);
  var isShop = shopType==='shop';
  if(!isShop){
    var t0=calcTotals();
    c.innerHTML='<div style="background:#1a1a22;border-radius:12px;padding:10px 12px;display:grid;grid-template-columns:1fr 1fr;gap:6px">'+
      sbCell('💰 Выручка', t0.revenue, '#c8f060')+
      sbCell('🏷 Скидка', t0.discount, '#f0a060')+
      sbCell('📦 Товар', t0.goods, '#f0c060')+
      sbCell('🛍 Остаток ДР', t0.goodsDr, '#a060f0')+
    '</div>';
    return;
  }
  var s = calcSellerSummary();
  var salesTxCount = journal.filter(function(e){ return e.type==='sale'; }).length;
  var avgCheckCurrent = salesTxCount ? s.totalRevenue/salesTxCount : 0;
  var openedDate = session.openedAt ? new Date(session.openedAt) : null;
  var dateStr = openedDate ? openedDate.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
  var timeStr = openedDate ? openedDate.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) : '—';
  var expenses = journal.filter(function(e){ return e.type==='expense'; });
  var expWood = expenses.filter(function(e){ return !e.goodsType||e.goodsType==='derevo'; }).reduce(function(a,e){ return a+(e.amount||0); },0);
  var expDr = expenses.filter(function(e){ return e.goodsType==='dr'; }).reduce(function(a,e){ return a+(e.amount||0); },0);
  function sbCell(label,val,color,onclick){
    var clickAttr = onclick ? ' onclick="'+onclick+'" style="background:#0f0f13;border-radius:8px;padding:6px 8px;cursor:pointer;border:1px solid #f06060"' : ' style="background:#0f0f13;border-radius:8px;padding:6px 8px"';
    return '<div'+clickAttr+'><div style="font-size:9px;color:#8888aa;line-height:1.3">'+label+(onclick?' ⚠️ нажми':'')+'</div>'+
      '<div style="font-size:13px;font-weight:700;color:'+(color||'#f0f0f8')+'">'+fmt(val)+'</div></div>';
  }
  function payRows(pay){
    return '<div style="font-size:10px;color:#8888aa;display:flex;flex-direction:column;gap:1px;margin-top:2px">'+
      '<div style="display:flex;justify-content:space-between"><span>💵 Нал</span><span>'+fmt(pay.cash)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between"><span>💳 Терминал</span><span>'+fmt(pay.terminal)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between"><span>🏦 Перевод</span><span>'+fmt(pay.transfer)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between"><span>🔲 QR/СБП</span><span>'+fmt(pay.qr+pay.sbp)+'</span></div>'+
      (pay.rs?'<div style="display:flex;justify-content:space-between"><span>🏦 РС</span><span>'+fmt(pay.rs)+'</span></div>':'')+
    '</div>';
  }
  function col(title, color, g){
    return '<div style="background:#0f0f13;border:1px solid #4B5320;border-radius:9px;padding:8px">'+
      '<div style="font-size:10px;color:'+color+';font-weight:700;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid #3a3f1a">'+title+'</div>'+
      '<div style="font-size:14px;font-weight:700">'+fmt(g.listPrice)+'</div>'+
      '<div style="font-size:9px;color:#8888aa;margin-bottom:2px">полная стоимость</div>'+
      payRows(g.pay)+
      '<div style="display:flex;justify-content:space-between;font-size:10px;color:#f0a060;margin-top:3px;padding-top:3px;border-top:1px solid #2e2e3e"><span>🎁 Скидка</span><span>'+fmt(g.discount)+'</span></div>'+
    '</div>';
  }
  c.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;background:#1a1a22;border-radius:9px;padding:7px 10px;margin-bottom:6px;font-size:11px;color:#8888aa">'+
      '<span>📅 '+dateStr+'</span><span>👤 '+(session.sellerName||'')+'</span><span>🕐 открыта '+timeStr+'</span>'+
    '</div>'+
    '<button onpointerdown="event.preventDefault();openFixMorningEntryMo()" style="width:100%;padding:8px;background:#1a1a2e;border:1px dashed #f0c060;border-radius:9px;font-weight:700;font-size:11.5px;color:#f0c060;cursor:pointer;margin-bottom:10px">✏️ Ошиблась при открытии смены? Исправить остатки на утро</button>'+
    '<div style="background:#1c1f12;border:1px solid #4B5320;border-radius:12px;padding:10px;margin-bottom:10px;box-shadow:0 2px 6px rgba(0,0,0,.3)">'+
    '<div style="background:linear-gradient(135deg,#3a3f1a,#2a2e14);border:1px solid #4B5320;border-radius:10px;padding:10px 12px;margin-bottom:10px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center">'+
        '<span style="font-size:11px;color:#c8d4a0">💰 Общая выручка (полная стоимость + скидка)</span>'+
        '<span style="font-size:17px;font-weight:800;color:#c8f060">'+fmt(s.totalRevenue)+'</span>'+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;margin-top:6px;padding-top:6px;border-top:1px solid #3a3f1a">'+
        '<span style="font-size:10px;color:#c8d4a0">🧾 Кол-во продаж: <b style="color:#f0f0f8">'+salesTxCount+'</b></span>'+
        '<span style="font-size:10px;color:#c8d4a0">📊 Средний чек: <b style="color:#f0f0f8">'+fmt(avgCheckCurrent)+'</b></span>'+
      '</div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'+
      col('🌳 ДЕРЕВО','#c8f060', s.wood)+
      col('🛍 ДР ТОВАР','#a060f0', s.dr)+
    '</div>'+
    '<div style="background:#1a1a22;border-radius:9px;padding:8px 10px;margin-bottom:6px">'+
      '<div style="font-size:10px;color:#60c8f0;font-weight:700;margin-bottom:4px">🛒 ПОКУПКИ СОТРУДНИКОВ</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;text-align:center">'+
        sbCell('🌳 Дерево', s.staffWood, '#60c8f0')+sbCell('🛍 ДР', s.staffDr, '#60c8f0')+sbCell('Σ Всего', s.staffTotal, '#60c8f0')+
      '</div>'+
    '</div>'+
    '<div style="background:#1a1a22;border-radius:9px;padding:8px 10px;margin-bottom:6px">'+
      '<div style="font-size:10px;color:#60f090;font-weight:700;margin-bottom:4px">💵 ФАКТ НАЛИЧНЫХ В КАССЕ</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;text-align:center">'+
        sbCell('🌳 Дерево', s.cashWood, '#60f090')+sbCell('🛍 ДР', s.cashDr, '#60f090')+sbCell('🛒 Сотр.', s.staffCashBalance, '#a060f0')+sbCell('Σ Итого', s.cashTotal, '#60f090')+
      '</div>'+
    '</div>'+
    '<div style="background:#1a1a22;border-radius:9px;padding:8px 10px;margin-bottom:6px">'+
      '<div style="font-size:10px;color:#f0a060;font-weight:700;margin-bottom:4px">💸 РАСХОДЫ</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;text-align:center">'+
        sbCell('🌳 Дерево', expWood, '#f0a060')+sbCell('🛍 ДР', expDr, '#f0a060')+sbCell('Σ Всего', expWood+expDr, '#f0a060')+
      '</div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">'+
      sbCell('📦 Остаток · Дерево', s.goodsWood, '#f0c060')+sbCell('📦 Остаток · ДР', s.goodsDr, '#f0c060')+
      sbCell('🗑 Списано · Дерево', s.woWood, '#f06060')+sbCell('🗑 Списано · ДР', s.woDr, '#f06060')+
      sbCell('📥 Приход · Дерево', s.rcvWood, '#60c8f0', s.rcvWood > 50000 ? 'purgeStaleReceives()' : null)+sbCell('📥 Приход · ДР', s.rcvDr, '#60c8f0')+
    '</div>'+
    '</div>'+ // end outer wrapper
    renderZpCard();
}
function calcZpForCurrentShift(){
  var expenses = journal.filter(function(e){ return e.type==='expense'; });
  var summary = calcSellerSummary();
  var netWood = summary.wood.listPrice - summary.wood.discount;
  var netDr = summary.dr.listPrice - summary.dr.discount;
  var totalNet = netWood + netDr;
  var totalGross = summary.wood.listPrice + summary.dr.listPrice;
  var _mySellerName = session.sellerName;
  var zpFact = expenses.filter(function(e){return e.expType==='zp' && (!e.forSeller || e.forSeller===_mySellerName);}).reduce(function(a,e){return a+e.amount;},0);
  var travelFact = expenses.filter(function(e){return e.expType==='travel' && (!e.forSeller || e.forSeller===_mySellerName);}).reduce(function(a,e){return a+e.amount;},0);
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
  var zpCalcWood = 0, zpCalcDr = 0;
  if(totalNet < thresh){
    zpCalcWood = base; zpCalcDr = 0;
  } else {
    zpCalcWood = base + netWood * pct;
    zpCalcDr   = netDr * pct;
  }
  var travelCalc = (s && s.travel) ? s.travel : 0;
  var zpCalcTotal = zpCalcWood + zpCalcDr;
  var zpCalcWithTravel = zpCalcTotal + travelCalc;
  var diff = zpCalcWithTravel - (zpFact + travelFact);
  return {
    zpCalcWood: zpCalcWood, zpCalcDr: zpCalcDr, zpCalcTotal: zpCalcTotal,
    travelCalc: travelCalc, zpFact: zpFact, travelFact: travelFact,
    zpCalcWithTravel: zpCalcWithTravel, diff: diff, totalNet: totalNet, totalGross: totalGross
  };
}
function renderZpCard(){
  if(!session) return '';
  var z = calcZpForCurrentShift();
  var fmt2 = function(n){ return Math.round(n).toLocaleString('ru-RU')+'₽'; };
  var diffColor = z.diff > 0 ? '#f06060' : z.diff < 0 ? '#60f090' : '#8888aa';
  return '<div style="background:#1e2a14;border:2px solid #c8f060;border-radius:14px;padding:14px;margin-top:10px">'+
    '<div style="font-size:11px;color:#c8f060;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">💰 РАСЧЁТ ЗП ЗА ТЕКУЩУЮ СМЕНУ</div>'+
    '<div style="display:flex;flex-direction:column;gap:6px">'+
      '<div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:#8888aa">ЗП расчётная · Дерево</span><span style="color:#c8f060;font-weight:700">'+fmt2(z.zpCalcWood)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:#8888aa">ЗП расчётная · ДР</span><span style="color:#a060f0;font-weight:700">'+fmt2(z.zpCalcDr)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;font-size:12px;padding-top:4px;border-top:1px solid #2e2e3e"><span style="color:#8888aa">Проезд (расчётный)</span><span style="color:#f0a060">'+fmt2(z.travelCalc)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding-top:4px;border-top:1px solid #2e2e3e"><span>Итого расчётная (с проездом)</span><span style="color:#c8f060">'+fmt2(z.zpCalcWithTravel)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;font-size:12px;padding-top:8px;border-top:1px solid #2e2e3e"><span style="color:#8888aa">ЗП факт (взято)</span><span style="color:#f0a060">'+fmt(z.zpFact)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:#8888aa">Проезд (факт)</span><span style="color:#f0a060">'+fmt(z.travelFact)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding-top:4px;border-top:2px solid #2e2e3e"><span>Разница итого</span><span style="color:'+diffColor+'">'+(z.diff>0?'+':'')+fmt2(z.diff)+'</span></div>'+
    '</div>'+
  '</div>';
}
function openFixMorningEntryMo(){
  if(!session) return;
  var setV=function(id,val){ var el=document.getElementById(id); if(el) el.value = (val!=null?val:''); };
  setV('fmeCashMorn', session.cashMorning||0);
  setV('fmeCashDrMorn', session.cashDrMorning||0);
  setV('fmeCashStaffMorn', session.cashStaffMorning||0);
  setV('fmeGoodsMorn', session.goodsMorning||0);
  setV('fmeGoodsDrMorn', session.goodsDrMorning||0);
  setV('fmeReason', '');
  var err = document.getElementById('fmeError'); if(err) err.style.display='none';
  openMo('fixMorningEntryMo');
}
function saveFixMorningEntry(){
  var errEl = document.getElementById('fmeError');
  var reason = ((document.getElementById('fmeReason')||{}).value||'').trim();
  if(!reason){
    if(errEl){ errEl.style.display='block'; errEl.textContent='⛔ Укажите причину правки'; }
    return;
  }
  var g=function(id){ var el=document.getElementById(id); var v=el?parseFloat(el.value):NaN; return isNaN(v)?0:v; };
  var before = {
    cashMorning:session.cashMorning, cashDrMorning:session.cashDrMorning, cashStaffMorning:session.cashStaffMorning,
    goodsMorning:session.goodsMorning, goodsDrMorning:session.goodsDrMorning
  };
  session.cashMorning = g('fmeCashMorn');
  session.cashDrMorning = g('fmeCashDrMorn');
  session.cashStaffMorning = g('fmeCashStaffMorn');
  session.goodsMorning = g('fmeGoodsMorn');
  session.goodsDrMorning = g('fmeGoodsDrMorn');
  session.morningEditedBy = session.sellerName||session.name||'';
  session.morningEditedAt = new Date().toISOString();
  session.morningEditReason = reason;
  try{ logAction('MORNING_ENTRY_SELF_FIX', {before:before, after:{cashMorning:session.cashMorning,cashDrMorning:session.cashDrMorning,cashStaffMorning:session.cashStaffMorning,goodsMorning:session.goodsMorning,goodsDrMorning:session.goodsDrMorning}, reason:reason}); }catch(e){}
  saveS();
  closeMo('fixMorningEntryMo');
  renderAll();
  showToast('✅ Утренние остатки исправлены');
}
function renderAll(){ renderStatusBar(); renderJournal(); renderWriteoffs(); updateInvBadge(); renderPendingAlert(); renderMorningCashDiffBanner(); syncLiveShift(); }
function calcShiftZpStandalone(shopName, report){
  var shiftJournal = (report && report.journal) || [];
  var sales = shiftJournal.filter(function(e){ return e.type==='sale'; });
  var expenses = shiftJournal.filter(function(e){ return e.type==='expense'; });
  function itemAmt(it){ return it.amt!=null?it.amt:(it.price||0)*(it.qty||1); }
  function netFor(isDr){
    var listPrice=0, discount=0;
    sales.forEach(function(e){
      var items=e.items||[];
      if(!items.length){
        if(isDr) return;
        listPrice += (e.amount||0)+(e.discount||0);
        discount += (e.discount||0);
        return;
      }
      var groupItems = items.filter(function(it){ return isDr ? it.goodsType==='dr' : it.goodsType!=='dr'; });
      if(!groupItems.length) return;
      var groupTotal = groupItems.reduce(function(s,it){ return s+itemAmt(it); },0);
      var saleTotal = e.totalPrice || items.reduce(function(s,it){ return s+itemAmt(it); },0) || 1;
      var share = groupTotal/saleTotal;
      listPrice += groupTotal;
      discount += (e.discount||0)*share;
    });
    return listPrice-discount;
  }
  function grossFor(isDr){
    var listPrice=0;
    sales.forEach(function(e){
      var items=e.items||[];
      if(!items.length){
        if(isDr) return;
        listPrice += (e.amount||0)+(e.discount||0);
        return;
      }
      var groupItems = items.filter(function(it){ return isDr ? it.goodsType==='dr' : it.goodsType!=='dr'; });
      if(!groupItems.length) return;
      listPrice += groupItems.reduce(function(s,it){ return s+itemAmt(it); },0);
    });
    return listPrice;
  }
  var hasJournalSales = sales.length>0;
  var netWood, netDr, grossWood, grossDr;
  if(hasJournalSales){
    netWood = netFor(false); netDr = netFor(true);
    grossWood = grossFor(false); grossDr = grossFor(true);
  } else {
    var revFallback = (report && (report.totalRevenue!=null ? report.totalRevenue : (report.cashRevenue||0)+(report.cardRevenue||0)))||0;
    var discFallback = (report && report.totalDiscount)||0;
    netWood = revFallback - discFallback; netDr = 0;
    grossWood = revFallback; grossDr = 0;
  }
  var totalNet = netWood+netDr;
  var totalGross = grossWood+grossDr;
  var zpFact, travelFact;
  var _shiftSellerName = report && report.sellerName;
  var zpEntries = expenses.filter(function(e){return e.expType==='zp' && (!e.forSeller || e.forSeller===_shiftSellerName);});
  var travelEntries = expenses.filter(function(e){return e.expType==='travel' && (!e.forSeller || e.forSeller===_shiftSellerName);});
  zpFact = zpEntries.reduce(function(a,e){return a+e.amount;},0);
  travelFact = travelEntries.reduce(function(a,e){return a+e.amount;},0);
  var zpSettings = JSON.parse(localStorage.getItem('iz_shop_zp_settings')||'{}');
  var s = zpSettings[shopName] || null;
  var base = s ? numDef(s.base, 1500) : 1500;
  var thresh = s ? numDef(s.threshold, 5000) : 5000;
  var pctNorm = s ? (numDef(s.pct, 8)/100) : 0.08;
  var highEnabled = s ? ((s.highEnabled !== undefined) ? s.highEnabled : !!s.highThreshold) : false;
  var highThresh = (s && highEnabled) ? numDef(s.highThreshold, 20000) : null;
  var pctHigh = s ? (numDef(s.highPct, 10)/100) : 0.10;
  if(!s){
    var shopN = (shopName||'').toLowerCase();
    if(shopN.indexOf('горк') >= 0){
      base=2000; thresh=0; pctNorm=0.08; highThresh=20000; pctHigh=0.10;
    } else { base=1500; thresh=5000; pctNorm=0.08; }
  }
  var highThreshGross = s ? ((s.highThreshGross !== undefined) ? s.highThreshGross : true) : true;
  var highThreshBasis = highThreshGross ? totalGross : totalNet;
  var pct = (highThresh!==null && highThreshBasis >= highThresh) ? pctHigh : pctNorm;
  var zpCalcWood = 0, zpCalcDr = 0;
  if(totalNet < thresh){
    zpCalcWood = base; zpCalcDr = 0;
  } else {
    zpCalcWood = base + netWood * pct;
    zpCalcDr   = netDr * pct;
  }
  var travelCalc = (s && s.travel) ? s.travel : 0;
  var zpCalcTotal = zpCalcWood + zpCalcDr;
  var zpCalcWithTravel = zpCalcTotal + travelCalc;
  var diff = zpCalcWithTravel - (zpFact + travelFact);
  return {
    zpCalcWood: zpCalcWood, zpCalcDr: zpCalcDr, zpCalcTotal: zpCalcTotal,
    travelCalc: travelCalc, zpFact: zpFact, travelFact: travelFact,
    zpCalcWithTravel: zpCalcWithTravel, diff: diff, totalNet: totalNet
  };
}
var _personalPeriod = '30'; // '7' | '30' | '90' | 'all' | 'custom'
function setPersonalPeriod(period, el){
  _personalPeriod = period;
  var fromEl = document.getElementById('personalDateFrom'), toEl = document.getElementById('personalDateTo');
  if(period !== 'custom'){
    document.querySelectorAll('#personalPeriodChips div').forEach(function(c){
      c.style.background='#1a1a22'; c.style.color='#8888aa'; c.style.borderWidth='1px'; c.style.borderColor='#2e2e3e';
    });
    if(el){ el.style.background='#c8f060'; el.style.color='#0f0f13'; el.style.borderWidth='2px'; el.style.borderColor='#c8f060'; }
    var today = new Date();
    var toStr = today.toISOString().split('T')[0];
    var fromStr = '';
    if(period !== 'all'){
      var days = parseInt(period,10)||30;
      var fromDate = new Date(today.getTime() - days*86400000);
      fromStr = fromDate.toISOString().split('T')[0];
    }
    if(fromEl) fromEl.value = fromStr;
    if(toEl) toEl.value = period==='all' ? '' : toStr;
  } else {
    document.querySelectorAll('#personalPeriodChips div').forEach(function(c){
      c.style.background='#1a1a22'; c.style.color='#8888aa'; c.style.borderWidth='1px'; c.style.borderColor='#2e2e3e';
    });
  }
  renderPersonalTab();
}
function renderPersonalTab(){
  if(!session) return;
  var sumEl = document.getElementById('personalSummary');
  var listEl = document.getElementById('personalShiftsList');
  if(!sumEl || !listEl) return;
  var fromStr = (document.getElementById('personalDateFrom')||{}).value || '';
  var toStr = (document.getElementById('personalDateTo')||{}).value || '';
  var allShifts = getShifts();
  var mine = allShifts.filter(function(sh){
    if(sh.status && sh.status!=='closed') return false; // skip the live/open shift
    if(sh.sellerName !== session.sellerName) return false;
    if(fromStr && sh.date < fromStr) return false;
    if(toStr && sh.date > toStr) return false;
    return true;
  });
  mine.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
  if(!mine.length){
    sumEl.innerHTML = '<div class="empty"><div class="ei">📈</div>Нет закрытых смен за выбранный период</div>';
    listEl.innerHTML = '';
    return;
  }
  var rows = mine.map(function(sh){
    var shJournal = sh.journal || [];
    var z = calcShiftZpStandalone(sh.shopName, sh);
    var revenue = (sh.totalRevenue!=null ? sh.totalRevenue : (sh.cashRevenue||0)+(sh.cardRevenue||0)+(sh.totalDiscount||0));
    var salesCount = sh.salesCount!=null ? sh.salesCount : shJournal.filter(function(e){return e.type==='sale';}).length;
    return {
      shift: sh, z: z, revenue: revenue, salesCount: salesCount,
      zpFactWithTravel: z.zpFact + z.travelFact
    };
  });
  var shiftsCount = rows.length;
  var totalRevenue = rows.reduce(function(s,r){ return s+r.revenue; },0);
  var totalSalesCount = rows.reduce(function(s,r){ return s+r.salesCount; },0);
  var avgRevenuePerShift = shiftsCount ? totalRevenue/shiftsCount : 0;
  var avgCheck = totalSalesCount ? totalRevenue/totalSalesCount : 0;
  var totalZpCalcNoTravel = rows.reduce(function(s,r){ return s+r.z.zpCalcTotal; },0);
  var totalZpCalcWithTravel = rows.reduce(function(s,r){ return s+r.z.zpCalcWithTravel; },0);
  var avgZpNoTravel = shiftsCount ? totalZpCalcNoTravel/shiftsCount : 0;
  var avgZpWithTravel = shiftsCount ? totalZpCalcWithTravel/shiftsCount : 0;
  var extraPayouts = 0;
  allShifts.forEach(function(sh){
    if(sh.sellerName === session.sellerName) return; // свои смены уже учтены выше
    if(sh.status && sh.status!=='closed') return;
    if(fromStr && sh.date < fromStr) return;
    if(toStr && sh.date > toStr) return;
    (sh.journal||[]).forEach(function(e){
      if(e.type==='expense' && (e.expType==='zp'||e.expType==='travel') && e.forSeller===session.sellerName){
        extraPayouts += (e.amount||0);
      }
    });
  });
  var totalDiff = rows.reduce(function(s,r){ return s+r.z.diff; },0) - extraPayouts;
  var totalZpFact = totalZpCalcWithTravel - totalDiff;
  var fmt2 = function(n){ return Math.round(n).toLocaleString('ru-RU')+'₽'; };
  function sCell(label,val,color){
    return '<div style="background:#0f0f13;border-radius:8px;padding:8px"><div style="font-size:9px;color:#8888aa;line-height:1.3;margin-bottom:2px">'+label+'</div>'+
      '<div style="font-size:14px;font-weight:700;color:'+(color||'#f0f0f8')+'">'+val+'</div></div>';
  }
  var diffColorTotal = totalDiff > 0 ? '#f06060' : totalDiff < 0 ? '#60f090' : '#8888aa';
  sumEl.innerHTML =
    '<div style="background:#1e2a14;border:2px solid #c8f060;border-radius:14px;padding:14px;margin-bottom:14px">'+
      '<div style="font-size:11px;color:#c8f060;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">📊 СВОДКА ЗА ПЕРИОД</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">'+
        sCell('📅 Смен отработано', shiftsCount+'', '#c8f060')+
        sCell('🧾 Средний чек', fmt2(avgCheck), '#f0c060')+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">'+
        sCell('💵 Средний заработок/смену (без проезда)', fmt2(avgZpNoTravel), '#a060f0')+
        sCell('💵 Средний заработок/смену (с проездом)', fmt2(avgZpWithTravel), '#a060f0')+
      '</div>'+
      '<div style="background:#1a2e1e;border:2px solid #c8f060;border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">'+
        '<div>'+
          '<div style="font-size:10px;color:#8888aa;margin-bottom:2px">💰 ИТОГО ЗАРАБОТАНО ЗА ПЕРИОД</div>'+
          '<div style="font-size:10px;color:#555568">(фактически взято с проездом)</div>'+
        '</div>'+
        '<div style="font-size:22px;font-weight:900;color:#c8f060">'+fmt2(totalZpFact)+'</div>'+
      '</div>'+
      (extraPayouts ? '<div style="font-size:10px;color:#8888aa;margin-bottom:8px;padding:0 2px">из них получено в чужие смены: '+fmt2(extraPayouts)+'</div>' : '')+
      '<div style="display:flex;justify-content:space-between;align-items:center;background:#0f0f13;border-radius:8px;padding:10px 12px">'+
        '<span class="u-fs11-gray">Итог за период: расчётная ЗП минус фактически взятая</span>'+
        '<span style="font-size:15px;font-weight:800;color:'+diffColorTotal+'">'+(totalDiff>0?'+':'')+fmt2(totalDiff)+'</span>'+
      '</div>'+
      '<div style="font-size:10px;color:#555568;margin-top:6px">'+(totalDiff>0?'Положительное значение — взято меньше расчётной ЗП':totalDiff<0?'Отрицательное значение — взято больше расчётной ЗП':'Расчётная ЗП и фактически взятая совпадают')+'</div>'+
    '</div>';
  listEl.innerHTML = rows.map(function(r){
    var sh = r.shift, z = r.z;
    var diffColor = z.diff > 0 ? '#f06060' : z.diff < 0 ? '#60f090' : '#8888aa';
    return '<div class="card" style="margin-bottom:8px">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">'+
        '<div>'+
          '<div style="font-family:Unbounded,sans-serif;font-size:13px;font-weight:700">'+(sh.shopName||'')+'</div>'+
          '<div style="font-size:11px;color:#8888aa;margin-top:2px">📅 '+(sh.date||'')+' · 🧾 '+r.salesCount+' продаж</div>'+
        '</div>'+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;font-size:12px;padding-top:6px;border-top:1px solid #2e2e3e">'+
        '<span style="color:#8888aa">ЗП расчётная (с проездом)</span><span style="color:#c8f060;font-weight:700">'+fmt(z.zpCalcWithTravel)+'</span>'+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:3px">'+
        '<span style="color:#8888aa">ЗП факт + проезд (взято)</span><span style="color:#f0a060;font-weight:700">'+fmt(r.zpFactWithTravel)+'</span>'+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-top:5px;padding-top:5px;border-top:1px solid #2e2e3e">'+
        '<span>Разница</span><span style="color:'+diffColor+'">'+(z.diff>0?'+':'')+fmt(z.diff)+'</span>'+
      '</div>'+
    '</div>';
  }).join('');
}
var _ssPeriod = 'month';
var _ssShop = 'all';
function setSsPeriod(p){
  _ssPeriod=p;
  var map={month:'m',quarter:'q',year:'y',custom:'c'};
  ['month','quarter','year','custom'].forEach(function(x){
    var btn=document.getElementById('ss_p_'+map[x]);
    if(!btn) return;
    var active=x===p;
    btn.style.border=active?'2px solid #c8f060':'1px solid #2e2e3e';
    btn.style.background=active?'#1e2a14':'#22222e';
    btn.style.color=active?'#c8f060':'#8888aa';
  });
  var cd=document.getElementById('ss_custom_dates');
  if(cd) cd.style.display=p==='custom'?'flex':'none';
  renderSellerStats();
}
function recalcAllShiftsZp(){
  if(!confirm('Пересчитать начисленную ЗП и проезд для ВСЕХ закрытых смен по правильной формуле? Фактически выданные суммы (взято) не изменятся. Это может занять несколько секунд.')) return;
  var shifts = getShifts();
  var updated = 0;
  shifts.forEach(function(s){
    if(s.status!=='closed') return;
    try{
      var result = calcShiftZpStandalone(s.shopName, s);
      var newZp = result.zpCalcTotal;
      var newTravel = result.travelCalc;
      if(Math.abs((s.zp||0)-newZp)>=1 || Math.abs((s.travel||0)-newTravel)>=1){
        s.zp = newZp;
        s.travel = newTravel;
        if(s.travelFact==null) s.travelFact = result.travelFact;
        s._zpRecalculatedAt = new Date().toISOString();
        updated++;
        _pushShiftWithRetry(s.id||s._id, s);
      }
    }catch(e){ console.log('[recalcAllShiftsZp] ошибка для смены', s.id, e); }
  });
  saveShifts(shifts);
  showToast('✅ Пересчитано смен: '+updated);
  renderSellerStats();
}
function _ssMonthsInRange(range){
  var from=new Date(range.from), to=new Date(range.to);
  var months=(to.getFullYear()-from.getFullYear())*12+(to.getMonth()-from.getMonth())+1;
  return Math.max(1, months);
}
function _ssDateRange(){
  var now=new Date(),y=now.getFullYear(),m=now.getMonth();
  if(_ssPeriod==='month') return {from:y+'-'+String(m+1).padStart(2,'0')+'-01',to:y+'-'+String(m+1).padStart(2,'0')+'-31'};
  if(_ssPeriod==='quarter'){var q=Math.floor(m/3),qm=q*3;return {from:y+'-'+String(qm+1).padStart(2,'0')+'-01',to:y+'-'+String(qm+3).padStart(2,'0')+'-31'};}
  if(_ssPeriod==='year') return {from:y+'-01-01',to:y+'-12-31'};
  var f=(document.getElementById('ss_date_from')||{}).value||'';
  var t=(document.getElementById('ss_date_to')||{}).value||'';
  return {from:f||'2000-01-01',to:t||'2099-12-31'};
}
function renderSellerStats(){
  var range=_ssDateRange();
  var allShifts=getShifts().filter(function(s){
    if(s.status!=='closed'||!s.sellerName) return false;
    if(s.sellerName==='Ксения'&&(s.totalRevenue||0)===0&&(s.cashRevenue||0)===0) return false;
    return s.date>=range.from&&s.date<=range.to;
  });
  var shops=['all'];
  allShifts.forEach(function(s){if(s.shopName&&shops.indexOf(s.shopName)<0)shops.push(s.shopName);});
  var chipEl=document.getElementById('ss_shop_chips');
  if(chipEl) chipEl.innerHTML=shops.map(function(sh){
    var active=_ssShop===sh;
    return '<button onpointerdown="event.preventDefault();_ssShop=\''+sh+'\';renderSellerStats()" style="padding:5px 10px;border-radius:20px;border:'+(active?'2px solid #c8f060':'1px solid #2e2e3e')+';background:'+(active?'#1e2a14':'#22222e')+';color:'+(active?'#c8f060':'#8888aa')+';font-size:11px;font-weight:'+(active?'700':'400')+';cursor:pointer">'+(sh==='all'?'Все магазины':sh)+'</button>';
  }).join('');
  var shifts=_ssShop==='all'?allShifts:allShifts.filter(function(s){return s.shopName===_ssShop;});
  var sellers={};
  shifts.forEach(function(s){
    var name=(s.sellerName||'—').replace(/^Восст. /,'');
    if(!sellers[name])sellers[name]={name:name,shifts:0,revenue:0,sales:0,checks:[],zp:0,zpFact:0,travel:0,hasCashDiff:0,shops:{},disc:0,discCash:0,discSales:0,
      zpCash:0,zpTransfer:0,zpOther:0,travelCash:0,travelTransfer:0,travelOther:0,travelAccrued:0};
    var sel=sellers[name];
    sel.shifts++;
    var rev=(s.cashRevenue||0)+(s.cardRevenue||0)+(s.totalDiscount||0);
    sel.revenue+=rev;
    var sc=s.salesCount||0; sel.sales+=sc;
    if(sc>0) sel.checks.push(rev/sc);
    sel.zp+=s.zp||0; sel.zpFact+=(s.zpFact!=null?s.zpFact:0); sel.travel+=s.travel||0; sel.travelAccrued+=s.travel||0;
    sel.disc+=s.totalDiscount||0;
    (s.journal||[]).forEach(function(e){
      if(e.type==='expense' && (e.expType==='zp'||e.expType==='travel')){
        var pm = e.payMethod||'cash';
        var bucket = e.expType==='zp' ? 'zp' : 'travel';
        if(pm==='cash') sel[bucket+'Cash']+=(e.amount||0);
        else if(pm==='transfer') sel[bucket+'Transfer']+=(e.amount||0);
        else sel[bucket+'Other']+=(e.amount||0);
      }
    });
    (s.journal||[]).forEach(function(e){
      if(e.type==='sale'&&(e.discount||0)>0){
        sel.discSales++;
        if((e.cashPart||e.cashEffect||0)>0) sel.discCash+=(e.discount||0);
      }
    });
    if(s.hasCashDiff) sel.hasCashDiff++;
    if(s.shopName) sel.shops[s.shopName]=(sel.shops[s.shopName]||0)+1;
  });
  var selArr=Object.values(sellers).sort(function(a,b){return b.revenue-a.revenue;});
  var cont=document.getElementById('ss_content');
  if(!selArr.length){cont.innerHTML='<div class="empty"><div class="ei">📊</div>Нет смен за период</div>';return;}
  var fmt=function(n){return Math.round(n).toLocaleString('ru-RU');};
  var totalRev=selArr.reduce(function(s,x){return s+x.revenue;},0);
  var totalShifts=selArr.reduce(function(s,x){return s+x.shifts;},0);
  var totalZp=selArr.reduce(function(s,x){return s+x.zp;},0);
  var medals=['🥇','🥈','🥉'];
  var html='<div style="background:#1e2a14;border:1px solid #2e4e2e;border-radius:12px;padding:12px;margin-bottom:10px">'+
    '<div style="font-size:11px;color:#c8f060;font-weight:700;margin-bottom:6px">📈 ИТОГО ЗА ПЕРИОД</div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
      '<div style="flex:1;min-width:80px;background:#22222e;border-radius:8px;padding:8px;text-align:center"><div class="u-fs11-gray">Выручка</div><div style="font-size:14px;font-weight:700;color:#c8f060">'+fmt(totalRev)+'₽</div></div>'+
      '<div style="flex:1;min-width:80px;background:#22222e;border-radius:8px;padding:8px;text-align:center"><div class="u-fs11-gray">Смен</div><div style="font-size:14px;font-weight:700;color:#f0f0f8">'+totalShifts+'</div></div>'+
      '<div style="flex:1;min-width:80px;background:#22222e;border-radius:8px;padding:8px;text-align:center"><div class="u-fs11-gray">ФОТ</div><div style="font-size:14px;font-weight:700;color:#60f090">'+fmt(totalZp)+'₽</div></div>'+
    '</div></div>'+
  (function(){
    var dt='<div style="background:#1a1a14;border:1px solid #3e3e2e;border-radius:12px;padding:12px;margin-bottom:10px">'+
      '<div style="font-size:11px;color:#f0a060;font-weight:700;margin-bottom:8px">🎁 СРАВНЕНИЕ СКИДОК ПО ПРОДАВЦАМ</div>'+
      '<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:4px;font-size:10px;color:#8888aa;margin-bottom:4px;padding:0 2px">'+
        '<div>Продавец</div><div>Скидки</div><div>%</div><div>нал</div>'+
      '</div>'+
      selArr.map(function(sel){
        var discPct=sel.revenue>0?Math.round(sel.disc/(sel.revenue+sel.disc)*100):0;
        var cashPct=sel.disc>0?Math.round(sel.discCash/sel.disc*100):0;
        var riskColor=discPct>=15?'#f06060':discPct>=8?'#f0a060':'#60f090';
        return '<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:4px;padding:5px 2px;border-top:1px solid #2e2e2e;font-size:11px">'+
          '<div style="font-weight:700">'+sel.name+'</div>'+
          '<div style="color:#f0a060">'+(sel.disc?Math.round(sel.disc).toLocaleString('ru-RU')+'₽':'0')+'</div>'+
          '<div style="color:'+riskColor+';font-weight:700">'+discPct+'%</div>'+
          '<div style="color:'+(cashPct>=70?'#f06060':'#8888aa')+'">'+(sel.disc?cashPct+'%':'—')+'</div>'+
        '</div>';
      }).join('')+
      '<div style="font-size:10px;color:#8888aa;margin-top:8px;padding-top:6px;border-top:1px solid #2e2e2e">🟢 0-7% норма · 🟡 8-14% внимание · 🔴 15%+ подозрительно</div>'+
    '</div>';
    return dt;
  })()+
  '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:12px;padding:12px;margin-bottom:10px">'+
    '<div style="font-size:12px;font-weight:700;color:#c8f060;margin-bottom:8px">🏆 РЕЙТИНГ</div>'+
    selArr.map(function(sel,i){
      var pct=totalRev>0?Math.round(sel.revenue/totalRev*100):0;
      return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #2e2e3e">'+
        '<div style="font-size:16px;width:22px;text-align:center">'+(medals[i]||'#'+(i+1))+'</div>'+
        '<div style="flex:1"><div class="u-fs13-bold">'+sel.name+'</div>'+
          '<div style="margin-top:3px;background:#2e2e3e;border-radius:4px;height:4px">'+
            '<div style="background:#c8f060;border-radius:4px;height:4px;width:'+pct+'%"></div></div></div>'+
        '<div style="text-align:right"><div style="font-size:13px;font-weight:700;color:#c8f060">'+fmt(sel.revenue)+'₽</div>'+
          '<div class="u-fs10-gray">'+sel.shifts+' смен</div></div></div>';
    }).join('')+'</div>'+
  '<div style="font-size:12px;font-weight:700;color:#8888aa;margin:12px 0 8px">КАРТОЧКИ</div>'+
  selArr.map(function(sel){
    var avgRev=sel.shifts>0?sel.revenue/sel.shifts:0;
    var avgCheck=sel.checks.length>0?sel.checks.reduce(function(s,x){return s+x;},0)/sel.checks.length:0;
    var avgZp=sel.shifts>0?sel.zp/sel.shifts:0;
    var avgZpT=sel.shifts>0?(sel.zp+sel.travel)/sel.shifts:0;
    var shopsStr=Object.keys(sel.shops).map(function(sh){return sh+'('+sel.shops[sh]+')';}).join(', ');
    function row(lbl,val,col){return '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1e1e2e;font-size:12px"><span style="color:#8888aa">'+lbl+'</span><span style="font-weight:700;color:'+(col||'#f0f0f8')+'">'+val+'</span></div>';}
    var calKey='ss_cal_'+sel.name.replace(/\s/g,'_');
    var calOpen=window._ssCalOpen&&window._ssCalOpen[calKey];
    var calShifts=shifts.filter(function(s){return (s.sellerName||'').replace(/^Восст\. /,'')===sel.name;});
    var calByDate={};
    calShifts.forEach(function(s){calByDate[s.date]=(calByDate[s.date]||[]);calByDate[s.date].push(s.shopName);});
    var calStats={maxWorkStreak:0,maxRestStreak:0,currentStreak:0,currentStreakType:''};
    var calHtml='';
    if(calOpen){
      var dates=Object.keys(calByDate).sort();
      if(dates.length){
        var firstD=new Date(dates[0]),lastD=new Date(dates[dates.length-1]);
        var workStreak=0, restStreak=0, prevType=null;
        var cursorD=new Date(firstD);
        var dayCells={}; // date -> {worked, streakLen, streakType}
        while(cursorD<=lastD){
          var dStr=cursorD.toISOString().split('T')[0];
          var worked=!!calByDate[dStr];
          if(worked){ workStreak++; restStreak=0; if(workStreak>calStats.maxWorkStreak) calStats.maxWorkStreak=workStreak; }
          else { restStreak++; workStreak=0; if(restStreak>calStats.maxRestStreak) calStats.maxRestStreak=restStreak; }
          dayCells[dStr]={worked:worked};
          cursorD.setDate(cursorD.getDate()+1);
        }
        calStats.currentStreakType = dayCells[dates[dates.length-1]] && workStreak>0 ? 'work' : 'rest';
        calStats.currentStreak = workStreak>0?workStreak:restStreak;
        var monthsAll={};
        var cur2=new Date(firstD.getFullYear(),firstD.getMonth(),1);
        var lastMonthStart=new Date(lastD.getFullYear(),lastD.getMonth(),1);
        while(cur2<=lastMonthStart){
          var mk2=cur2.getFullYear()+'-'+String(cur2.getMonth()+1).padStart(2,'0');
          var daysInM=new Date(cur2.getFullYear(),cur2.getMonth()+1,0).getDate();
          var monthDays=[];
          for(var dnum=1; dnum<=daysInM; dnum++){
            var dObj=new Date(cur2.getFullYear(),cur2.getMonth(),dnum);
            var dKey=dObj.toISOString().split('T')[0];
            if(dObj>=firstD && dObj<=lastD) monthDays.push(dKey);
          }
          monthsAll[mk2]=monthDays;
          cur2.setMonth(cur2.getMonth()+1);
        }
        var mnames=['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
        var dayNames=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
        calHtml='<div style="margin-top:8px;background:#111118;border-radius:8px;padding:8px;overflow-x:auto">';
        calHtml+='<div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">'+
          '<div style="font-size:10px;color:#60f090">🔥 Макс. подряд рабочих: <b>'+calStats.maxWorkStreak+'</b></div>'+
          '<div class="u-fs10-gray">💤 Макс. подряд выходных: <b>'+calStats.maxRestStreak+'</b></div>'+
          '<div style="font-size:10px;color:'+(calStats.currentStreakType==='work'?'#60f090':'#8888aa')+'">Сейчас: <b>'+calStats.currentStreak+' '+(calStats.currentStreakType==='work'?'раб. подряд':'вых. подряд')+'</b></div>'+
        '</div>';
        Object.keys(monthsAll).sort().forEach(function(mk){
          var p=mk.split('-');
          var monthDaysArr=monthsAll[mk];
          if(!monthDaysArr.length) return;
          calHtml+='<div style="font-size:10px;color:#8888aa;font-weight:700;margin-bottom:4px">'+mnames[parseInt(p[1])-1]+' '+p[0]+'</div>';
          calHtml+='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:3px;max-width:280px">'+
            dayNames.map(function(dn){return '<div style="text-align:center;font-size:8px;color:#555568">'+dn+'</div>';}).join('')+
          '</div>';
          var firstOfMonth=new Date(parseInt(p[0]),parseInt(p[1])-1,1);
          var leadEmpty=(firstOfMonth.getDay()+6)%7; // Пн=0..Вс=6
          calHtml+='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:8px;max-width:280px">';
          for(var le=0; le<leadEmpty; le++) calHtml+='<div></div>';
          var daysInMonthFull=new Date(parseInt(p[0]),parseInt(p[1]),0).getDate();
          for(var dn2=1; dn2<=daysInMonthFull; dn2++){
            var dObj2=new Date(parseInt(p[0]),parseInt(p[1])-1,dn2);
            var dKey2=dObj2.toISOString().split('T')[0];
            if(dObj2<firstD || dObj2>lastD){ calHtml+='<div></div>'; continue; }
            var shopsArr=calByDate[dKey2];
            var worked2=!!shopsArr;
            var multi2=worked2&&shopsArr.length>1;
            var isWE2=dObj2.getDay()===0||dObj2.getDay()===6;
            var bg = worked2 ? (multi2?'#2a1a3e':'#1a2e1e') : (isWE2?'#1a1418':'#141418');
            var border = worked2 ? (multi2?'#a060f0':'#60f090') : '#2e2e3e';
            var txtColor = worked2 ? (multi2?'#a060f0':'#60f090') : '#4a4a5a';
            calHtml+='<div style="text-align:center;background:'+bg+';border:1px solid '+border+';border-radius:5px;padding:3px 1px">'+
              '<div style="font-size:10px;font-weight:700;color:'+txtColor+'">'+dn2+'</div>'+
              (worked2?(multi2?'<div style="font-size:7px;color:#a060f0">2М</div>':'<div style="font-size:6.5px;color:#60f090">'+shopsArr[0].replace('Роза Хутор','РХ').replace('Горки','Г').replace('Парк Ривьера Сочи','ПР').replace('Колесо Роза','КР').slice(0,2)+'</div>'):'')+
            '</div>';
          }
          calHtml+='</div>';
        });
        calHtml+='</div>';
      }
    }
    var zpDebt=sel.zp-sel.zpFact;
    var discKey='ss_disc_'+sel.name.replace(/\s/g,'_');
    var zpKey='ss_zp_'+sel.name.replace(/\s/g,'_');
    var travelKey='ss_travel_'+sel.name.replace(/\s/g,'_');
    var cardKey='ss_card_'+sel.name.replace(/\s/g,'_');
    var discOpen=!!(window._ssSecOpen&&window._ssSecOpen[discKey]);
    var zpOpen=!!(window._ssSecOpen&&window._ssSecOpen[zpKey]);
    var travelOpen=!!(window._ssSecOpen&&window._ssSecOpen[travelKey]);
    var cardOpen=!!(window._ssSecOpen&&window._ssSecOpen[cardKey]);
    function secToggle(key,open){
      return 'event.preventDefault();if(!window._ssSecOpen)window._ssSecOpen={};window._ssSecOpen[\''+key+'\']='+(open?'false':'true')+';renderSellerStats()';
    }
    function secHeader(icon,label,extra,color,key,open){
      return '<div onpointerdown="'+secToggle(key,open)+'" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding:2px 0">'+
        '<div style="font-size:10px;color:'+color+';font-weight:700">'+icon+' '+label+(extra?' '+extra:'')+'</div>'+
        '<span style="color:#8888aa;font-size:11px">'+(open?'▾':'▸')+'</span>'+
      '</div>';
    }
    return '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:12px;padding:12px;margin-bottom:10px">'+
      '<div onpointerdown="'+secToggle(cardKey,cardOpen)+'" style="display:flex;justify-content:space-between;align-items:center;'+(cardOpen?'margin-bottom:8px':'')+';cursor:pointer">'+
        '<div style="font-size:14px;font-weight:700">'+sel.name+'</div>'+
        '<div style="display:flex;align-items:center;gap:10px">'+
          (!cardOpen?'<div style="font-size:11px;color:#c8f060;font-weight:700">'+sel.shifts+' см. · '+fmt(sel.revenue)+'₽</div>':'<div class="u-fs10-gray">'+shopsStr+'</div>')+
          '<span style="color:#8888aa;font-size:13px">'+(cardOpen?'▾':'▸')+'</span>'+
        '</div>'+
      '</div>'+
      (!cardOpen?'':(
      row('Смен',sel.shifts)+
      row('Выручка итого',fmt(sel.revenue)+'₽','#c8f060')+
      row('Ср. выручка / смену',fmt(avgRev)+'₽','#c8f060')+
      row('Продаж итого',sel.sales)+
      row('Ср. чек',fmt(avgCheck)+'₽','#60c8f0')+
      '<div style="border-top:1px solid #2e2e3e;margin:6px 0 4px"></div>'+
      (function(){
        if(!sel.disc) return '';
        var discPct=sel.revenue>0?Math.round(sel.disc/(sel.revenue+sel.disc)*100):0;
        var cashDiscPct=sel.disc>0?Math.round(sel.discCash/sel.disc*100):0;
        var avgDiscPerSale=sel.discSales>0?Math.round(sel.disc/sel.discSales):0;
        var riskLvl=discPct>=15?'🔴 Высокий':discPct>=8?'🟡 Средний':'🟢 Норма';
        return '<div style="background:#1a1a14;border:1px solid #3e3e2e;border-radius:10px;padding:10px;margin-bottom:6px">'+
          secHeader('🎁','АНАЛИЗ СКИДОК',riskLvl,'#f0a060',discKey,discOpen)+
          (discOpen?(
            row('Скидки итого',fmt(sel.disc)+'₽','#f0a060')+
            row('Скидки % от выручки',discPct+'%',discPct>=15?'#f06060':discPct>=8?'#f0a060':'#60f090')+
            row('Скидки по наличным',fmt(sel.discCash)+'₽ ('+cashDiscPct+'%)',cashDiscPct>=70?'#f06060':'#f0a060')+
            row('Продаж со скидкой',sel.discSales+' шт.')+
            row('Ср. скидка за сделку',fmt(avgDiscPerSale)+'₽','#f0a060')
          ):'')+
        '</div>';
      })()+
      '<div style="border-top:1px solid #2e2e3e;margin:6px 0 4px"></div>'+
      secHeader('💰','ЗАРПЛАТА','','#60f090',zpKey,zpOpen)+
      (zpOpen?(
        row('ЗП начислена',fmt(sel.zp)+'₽','#60f090')+
        row('ЗП взято (факт)',fmt(sel.zpFact)+'₽','#f0a060')+
        row('  · наличными',fmt(sel.zpCash)+'₽','#8888aa')+
        row('  · переводом',fmt(sel.zpTransfer)+'₽','#8888aa')+
        (sel.zpOther?row('  · иначе',fmt(sel.zpOther)+'₽','#8888aa'):'')+
        row('Долг/Переплата',fmt(Math.abs(zpDebt))+'₽ '+(zpDebt>0?'← долг':zpDebt<0?'→ переплата':'✔ оплачено'),zpDebt>0?'#f06060':zpDebt<0?'#a060f0':'#60f090')+
        row('Ср. ЗП / смену',fmt(avgZp)+'₽','#60f090')+
        row('Ср. ЗП / месяц',fmt(sel.zp/_ssMonthsInRange(range))+'₽','#60f090')
      ):'')+
      (function(){
        var travelDebt = sel.travelAccrued - (sel.travelCash+sel.travelTransfer+sel.travelOther);
        return '<div style="border-top:1px solid #2e2e3e;margin:6px 0 4px"></div>'+
        secHeader('🚌','ПРОЕЗД','','#f0a060',travelKey,travelOpen)+
        (travelOpen?(
          row('Проезд начислен',fmt(sel.travelAccrued)+'₽','#f0a060')+
          row('Проезд выплачен',fmt(sel.travelCash+sel.travelTransfer+sel.travelOther)+'₽','#f0a060')+
          row('  · наличными',fmt(sel.travelCash)+'₽','#8888aa')+
          row('  · переводом',fmt(sel.travelTransfer)+'₽','#8888aa')+
          (sel.travelOther?row('  · иначе',fmt(sel.travelOther)+'₽','#8888aa'):'')+
          row('Долг/Переплата (проезд)',fmt(Math.abs(travelDebt))+'₽ '+(travelDebt>0?'← долг':travelDebt<0?'→ переплата':'✔ оплачено'),travelDebt>0?'#f06060':travelDebt<0?'#a060f0':'#60f090')
        ):'');
      })()+
      (sel.hasCashDiff>0?row('Расхождения кассы',sel.hasCashDiff+' смен','#f06060'):'')+
      '<div onpointerdown="event.preventDefault();if(!window._ssCalOpen)window._ssCalOpen={};window._ssCalOpen[\''+calKey+'\']='+(calOpen?'false':'true')+';renderSellerStats()" '+
        'style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;margin-top:4px;cursor:pointer;border-top:1px solid #2e2e3e">'+
        '<span class="u-fs11-gray">📅 Календарь смен ('+Object.keys(calByDate).length+')</span>'+
        '<span style="color:#8888aa;font-size:12px">'+(calOpen?'▾':'▸')+'</span>'+
      '</div>'+
      calHtml
      ))+
    '</div>';
  }).join('');
  cont.innerHTML=html;
}
function setProfView(mode){
  var simpleBtn=document.getElementById('profView_simple'), detailBtn=document.getElementById('profView_detail');
  var simpleView=document.getElementById('profSimpleView'), detailView=document.getElementById('profDetailView');
  var isSimple = mode==='simple';
  if(simpleBtn) simpleBtn.style.cssText = 'flex:1;padding:8px;border-radius:10px;font-size:12px;cursor:pointer;border:'+(isSimple?'2px solid #c8f060':'1px solid #2e2e3e')+';background:'+(isSimple?'#1e2a14':'#22222e')+';color:'+(isSimple?'#c8f060':'#8888aa')+';font-weight:'+(isSimple?'700':'600');
  if(detailBtn) detailBtn.style.cssText = 'flex:1;padding:8px;border-radius:10px;font-size:12px;cursor:pointer;border:'+(!isSimple?'2px solid #c8f060':'1px solid #2e2e3e')+';background:'+(!isSimple?'#1e2a14':'#22222e')+';color:'+(!isSimple?'#c8f060':'#8888aa')+';font-weight:'+(!isSimple?'700':'600');
  if(simpleView) simpleView.style.display = isSimple ? 'block':'none';
  if(detailView) detailView.style.display = isSimple ? 'none':'block';
  if(isSimple) generateProfitabilityReport(); else generatePeriodReport();
}
function setPrPeriod(type,el){
  document.querySelectorAll('#profDetailView > div:nth-child(2) button').forEach(function(b){
    b.style.background='#22222e'; b.style.color='#8888aa'; b.style.borderColor='#2e2e3e'; b.style.fontWeight='';
  });
  el.style.background='#1e2a14'; el.style.color='#c8f060'; el.style.borderColor='#c8f060'; el.style.fontWeight='700';
  var now=new Date(), today=now.toISOString().split('T')[0], from;
  if(type==='week'){var d=new Date();d.setDate(d.getDate()-6);from=d.toISOString().split('T')[0];}
  else if(type==='month'){var y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0');from=y+'-'+m+'-01';}
  else if(type==='quarter'){var q=Math.floor(now.getMonth()/3),qm=String(q*3+1).padStart(2,'0');from=now.getFullYear()+'-'+qm+'-01';}
  else {generatePeriodReport();return;}
  document.getElementById('prDateFrom').value=from;
  document.getElementById('prDateTo').value=today;
  generatePeriodReport();
}
var prMode = 'live';
function setPrMode(mode, el) {
  prMode = mode;
  ['live','archive','all'].forEach(function(m){
    var btn=document.getElementById('prMode_'+m); if(!btn) return;
    var active=m===mode;
    btn.style.borderWidth=active?'2px':'1px'; btn.style.background=active?'#1e2a14':'#22222e';
    btn.style.color=active?'#c8f060':'#8888aa'; btn.style.borderColor=active?'#c8f060':'#2e2e3e';
    btn.style.fontWeight=active?'700':'400';
  });
  generatePeriodReport();
}
function deletePeriodReportShift(id){
  if(!confirm('Удалить эту смену?')) return;
  addShiftTombstone(id);
  var shifts=getShifts();
  shifts=shifts.filter(function(s){return (s.id||s._id)!==id;});
  saveShifts(shifts);
  try{db.collection('iz_shifts').doc(id).delete();}catch(e){}
  generatePeriodReport();
  showToast('✅ Смена удалена');
}
function generatePeriodReport(){
  var from=(document.getElementById('prDateFrom')||{}).value||'';
  var to=(document.getElementById('prDateTo')||{}).value||'';
  var shopF=(document.getElementById('prShopFilter')||{}).value||'';
  if(!from||!to) return;
  var shifts=getShifts();
  if(prMode==='live') shifts=shifts.filter(function(s){return !s.isArchive;});
  else if(prMode==='archive') shifts=shifts.filter(function(s){return !!s.isArchive;});
  var filtered=shifts.filter(function(s){return s.date>=from&&s.date<=to&&(!shopF||s.shopName===shopF);});
  var modeLabel=prMode==='archive'?'🗄 Архив':prMode==='live'?'📊 Живые':'🔗 Все данные';
  var c=document.getElementById('periodReportBody');
  if(!filtered.length){c.innerHTML='<div class="empty"><div class="ei">📊</div>Нет данных ('+modeLabel+')</div>';return;}
  var totCash=0,totCard=0,totDisc=0,totZp=0,totTravel=0,totInkass=0,totOther=0,totSupplier=0,totDrInkass=0,totDrSupplier=0,totDrOther=0;
  filtered.forEach(function(s){
    totCash+=s.cashRevenue||0;totCard+=s.cardRevenue||0;totDisc+=s.totalDiscount||0;
    var exps=s.expenses||[];
    if(exps.length){
      totZp+=exps.filter(function(e){return e.expType==='zp';}).reduce(function(a,e){return a+e.amount;},0);
      totTravel+=exps.filter(function(e){return e.expType==='travel';}).reduce(function(a,e){return a+e.amount;},0);
      totInkass+=exps.filter(function(e){return e.expType==='inkass'&&e.goodsType!=='dr';}).reduce(function(a,e){return a+e.amount;},0);
      totOther+=exps.filter(function(e){return e.expType==='other'&&e.goodsType!=='dr';}).reduce(function(a,e){return a+e.amount;},0);
      totSupplier+=exps.filter(function(e){return e.expType==='supplier'&&e.goodsType!=='dr';}).reduce(function(a,e){return a+e.amount;},0);
      totDrInkass+=exps.filter(function(e){return e.expType==='inkass'&&e.goodsType==='dr';}).reduce(function(a,e){return a+e.amount;},0);
      totDrSupplier+=exps.filter(function(e){return e.expType==='supplier'&&e.goodsType==='dr';}).reduce(function(a,e){return a+e.amount;},0);
      totDrOther+=exps.filter(function(e){return e.expType==='other'&&e.goodsType==='dr';}).reduce(function(a,e){return a+e.amount;},0);
    } else {
      totZp+=s.zp||0;totTravel+=s.travel||0;totInkass+=s.inkass||0;
      totOther+=s.otherExp||0;totSupplier+=s.supplierExp||0;
      totDrInkass+=s.drInkass||0;totDrSupplier+=s.drSupplierAmt||0;
    }
  });
  var totRev=totCash+totCard+totDisc,totExp=totZp+totTravel+totInkass+totOther+totSupplier+totDrInkass+totDrSupplier+totDrOther;
  var f2=function(n){return Math.round(n||0).toLocaleString('ru-RU')+'₽';};
  var R=function(lbl,val,col){return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #2e2e3e;font-size:13px"><span style="color:#8888aa">'+lbl+'</span><span style="color:'+(col||'#f0f0f8')+';font-weight:700">'+f2(val)+'</span></div>';};
  var byShop={};
  filtered.forEach(function(s){if(!byShop[s.shopName])byShop[s.shopName]={n:0,cash:0,card:0,disc:0};var sh=byShop[s.shopName];sh.n++;sh.cash+=s.cashRevenue||0;sh.card+=s.cardRevenue||0;sh.disc+=s.totalDiscount||0;});
  var bySeller={};
  filtered.forEach(function(s){
    var k=(s.sellerName||'—').replace(/^Восст. /,'');
    if(!bySeller[k])bySeller[k]={n:0,rev:0};
    bySeller[k].n++; bySeller[k].rev+=(s.cashRevenue||0)+(s.cardRevenue||0)+(s.totalDiscount||0);
  });
  var prPct=function(n){return totRev>0?' <span style="color:#555568;font-size:11px">('+Math.round(n/totRev*100)+'%)</span>':'';};
  var Rp=function(lbl,val,col,sp){return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #2e2e3e;font-size:13px"><span style="color:#8888aa">'+lbl+'</span><span style="color:'+(col||'#f0f0f8')+';font-weight:700">'+f2(val)+(sp?prPct(val):'')+'</span></div>';};
  var html='<div style="background:#1e2a14;border:1px solid #c8f060;border-radius:12px;padding:12px;margin-bottom:10px">'+
    '<div style="font-size:11px;color:#8888aa;margin-bottom:8px">📅 '+from+' — '+to+' · '+filtered.length+' смен'+(shopF?' · '+shopF:'')+'</div>'+
    Rp('💵 Нал',totCash,'#60f090',true)+
    Rp('💳 Безнал',totCard,'#60c8f0',true)+
    (totDisc?Rp('🎁 Скидка',totDisc,'#8888aa',true):'')+
    '<div style="display:flex;justify-content:space-between;padding:7px 0;font-size:15px;font-weight:700;border-top:1px solid #2e2e3e;margin-top:2px"><span>Итого выручка</span><span style="color:#c8f060">'+f2(totRev)+'</span></div>'+
    (totExp?'<div style="border-top:1px solid #2e2e3e;padding-top:8px;margin-top:4px">'+
      '<div style="font-size:11px;color:#f06060;font-weight:700;margin-bottom:6px">💸 РАСХОДЫ: '+f2(totExp)+prPct(totExp)+'</div>'+
      (totZp?Rp('💰 ФОТ (ЗП)',totZp,'#f06060',true):'')+
      (totTravel?Rp('🚕 Проезд',totTravel,'#f0a060',true):'')+
      (function(){
        if(!totInkass && !totSupplier && !totOther && !totDrInkass && !totDrSupplier && !totDrOther) return '';
        var inkRows=[], supRows=[], othRows=[], drInkRows=[], drSupRows=[], drOthRows=[];
        filtered.forEach(function(s){
          var exps = s.expenses||[];
          if(exps.length){
            exps.filter(function(e){return e.expType==='inkass'&&e.goodsType!=='dr';}).forEach(function(e){
              inkRows.push({date:s.date,shop:s.shopName,amt:e.amount,note:e.supplier||e.comment||e.sub||''});
            });
          } else if(s.inkass){
            inkRows.push({date:s.date,shop:s.shopName,amt:s.inkass,note:s.inkassComment||''});
          }
          exps.filter(function(e){return e.expType==='inkass'&&e.goodsType==='dr';}).forEach(function(e){
            drInkRows.push({date:s.date,shop:s.shopName,amt:e.amount,note:e.supplier||e.comment||e.sub||''});
          });
          if((s.drInkass||0)>0&&!exps.some(function(e){return e.expType==='inkass'&&e.goodsType==='dr';})){
            drInkRows.push({date:s.date,shop:s.shopName,amt:s.drInkass,note:''});
          }
          if(exps.length){
            exps.filter(function(e){return e.expType==='supplier'&&e.goodsType!=='dr';}).forEach(function(e){
              supRows.push({date:s.date,shop:s.shopName,amt:e.amount,note:e.supplier||e.comment||''});
            });
          } else if(s.supplierExp){
            supRows.push({date:s.date,shop:s.shopName,amt:s.supplierExp,note:s.supplierName||''});
          }
          exps.filter(function(e){return e.expType==='supplier'&&e.goodsType==='dr';}).forEach(function(e){
            drSupRows.push({date:s.date,shop:s.shopName,amt:e.amount,note:e.supplier||e.comment||''});
          });
          if((s.drSupplierAmt||0)>0&&!exps.some(function(e){return e.expType==='supplier'&&e.goodsType==='dr';})){
            drSupRows.push({date:s.date,shop:s.shopName,amt:s.drSupplierAmt,note:s.drSupplierName||''});
          }
          exps.filter(function(e){return e.expType==='other'&&e.goodsType!=='dr';}).forEach(function(e){
            othRows.push({date:s.date,shop:s.shopName,amt:e.amount,note:e.supplier||e.comment||''});
          });
          exps.filter(function(e){return e.expType==='other'&&e.goodsType==='dr';}).forEach(function(e){
            drOthRows.push({date:s.date,shop:s.shopName,amt:e.amount,note:e.supplier||e.comment||''});
          });
          if((s.otherExp||0)>0 && !exps.some(function(e){return e.expType==='other'&&e.goodsType!=='dr';})){
            othRows.push({date:s.date,shop:s.shopName,amt:s.otherExp,note:s.expComment||''});
          }
        });
        inkRows.sort(function(a,b){return b.date.localeCompare(a.date);});
        supRows.sort(function(a,b){return b.date.localeCompare(a.date);});
        othRows.sort(function(a,b){return b.date.localeCompare(a.date);});
        function detailRows(rows){
          return rows.map(function(r){
            return '<div style="display:flex;justify-content:space-between;padding:4px 8px;font-size:11px;border-bottom:1px solid #1e1e2e">'+
              '<div><span style="color:#555568">'+r.date+'</span>'+(r.shop&&!shopF?' <span style="color:#555568">· '+r.shop+'</span>':'')+(r.note?' <span style="color:#8888aa">· '+r.note+'</span>':'')+'</div>'+
              '<span style="font-weight:700;color:#f0a060">'+f2(r.amt)+'</span>'+
            '</div>';
          }).join('');
        }
        function collapsible(id, label, total, rows, col, showPct){
          if(!total) return '';
          var open = window._prExpOpen && window._prExpOpen[id];
          return '<div>'+
            '<div onpointerdown="event.preventDefault();if(!window._prExpOpen)window._prExpOpen={};window._prExpOpen[\''+id+'\']='+(open?'false':'true')+';generatePeriodReport()" '+
              'style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #2e2e3e;font-size:13px;cursor:pointer">'+
              '<span style="color:#8888aa">'+label+' <span style="font-size:10px;color:#3e3e5e">'+(open?'▾':'▸')+'</span></span>'+
              '<span style="color:'+(col||'#f0f0f8')+';font-weight:700">'+f2(total)+(showPct?prPct(total):'')+'</span>'+
            '</div>'+
            (open?'<div style="background:#111118;border-radius:8px;margin:4px 0 6px;overflow:hidden">'+detailRows(rows)+'</div>':'')+
          '</div>';
        }
        return collapsible('inkass','🏦 Инкассация',totInkass,inkRows,'#f0a060',false)+
               collapsible('supplier','📦 Оплата поставщикам',totSupplier,supRows,'#f0a060',false)+
               collapsible('other','📋 Прочие',totOther,othRows,'#8888aa',false)+
               (drInkRows.length?collapsible('drinkass','🏦 Инкассация ДР',drInkRows.reduce(function(s,r){return s+r.amt;},0),drInkRows,'#a060f0',false):'')+
               (drSupRows.length?collapsible('drsupplier','📦 Поставщик ДР',drSupRows.reduce(function(s,r){return s+r.amt;},0),drSupRows,'#a060f0',false):'')+
               (drOthRows.length||totDrOther?collapsible('drother','📋 Прочие ДР',Math.max(drOthRows.reduce(function(s,r){return s+r.amt;},0),totDrOther),drOthRows,'#a060f0',false):'');
      })()+
    '</div>':'')+'</div>';
  if(Object.keys(byShop).length>1){
    html+='<div class="card" style="margin-bottom:10px"><div class="ctitle">По магазинам</div>'+
      Object.entries(byShop).map(function(e){var sh=e[1],rev=sh.cash+sh.card+sh.disc;
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:#22222e;border-radius:8px;margin-bottom:6px">'+
          '<div><div class="u-fs13-bold">🏪 '+e[0]+'</div><div class="u-fs11-gray">'+sh.n+' смен</div></div>'+
          '<div style="font-family:Unbounded,sans-serif;font-size:13px;font-weight:700;color:#c8f060">'+f2(rev)+'</div></div>';
      }).join('')+'</div>';
  }
  html+='<div class="card" style="margin-bottom:10px"><div class="ctitle">По продавцам</div>'+
    Object.entries(bySeller).sort(function(a,b){return b[1].rev-a[1].rev;}).map(function(e){
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:#22222e;border-radius:8px;margin-bottom:6px">'+
        '<div><div class="u-fs13-bold">👤 '+e[0]+'</div><div class="u-fs11-gray">'+e[1].n+' смен</div></div>'+
        '<div style="font-family:Unbounded,sans-serif;font-size:13px;font-weight:700;color:#c8f060">'+f2(e[1].rev)+'</div></div>';
    }).join('')+'</div>';
  if(!window._prOpen) window._prOpen={};
  var byShopMonth={};
  filtered.sort(function(a,b){return b.date.localeCompare(a.date);}).forEach(function(s){
    var shop=s.shopName||'—';
    var mk=s.date?s.date.substring(0,7):'—';
    if(!byShopMonth[shop])byShopMonth[shop]={};
    if(!byShopMonth[shop][mk])byShopMonth[shop][mk]=[];
    byShopMonth[shop][mk].push(s);
  });
  var mnames=['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  function mlbl(k){var p=k.split('-');return p[1]?mnames[parseInt(p[1])-1]+' '+p[0]:k;}
  html+='<div class="card"><div class="ctitle">Список смен ('+filtered.length+')</div>';
  Object.keys(byShopMonth).sort().forEach(function(shop){
    var shopKey='pr_'+shop;
    var shopOpen=window._prOpen[shopKey]!==false;
    var shopTotal=0,shopN=0;
    Object.values(byShopMonth[shop]).forEach(function(arr){arr.forEach(function(s){shopTotal+=(s.cashRevenue||0)+(s.cardRevenue||0)+(s.totalDiscount||0);shopN++;});});
    html+='<div style="margin-bottom:8px">'+
      '<div onpointerdown="event.preventDefault();window._prOpen[\''+shopKey+'\']='+(shopOpen?'false':'true')+';generatePeriodReport()" '+
        'style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#22222e;border-radius:10px;cursor:pointer;margin-bottom:'+(shopOpen?'4px':'0')+'">'+
        '<div><div class="u-fs13-bold">🏪 '+shop+'</div><div class="u-fs10-gray">'+shopN+' смен</div></div>'+
        '<div style="display:flex;align-items:center;gap:8px"><div style="font-family:Unbounded,sans-serif;font-size:13px;font-weight:700;color:#c8f060">'+f2(shopTotal)+'</div>'+
        '<span style="color:#8888aa;font-size:12px">'+(shopOpen?'▾':'▸')+'</span></div>'+
      '</div>';
    if(shopOpen){
      Object.keys(byShopMonth[shop]).sort(function(a,b){return b.localeCompare(a);}).forEach(function(mk){
        var arr=byShopMonth[shop][mk];
        var mkKey='pr_'+shop+'_'+mk;
        var mkOpen=window._prOpen[mkKey]!==false;
        var mkTotal=arr.reduce(function(s,x){return s+(x.cashRevenue||0)+(x.cardRevenue||0)+(x.totalDiscount||0);},0);
        html+='<div style="margin-bottom:4px;margin-left:8px">'+
          '<div onpointerdown="event.preventDefault();window._prOpen[\''+mkKey+'\']='+(mkOpen?'false':'true')+';generatePeriodReport()" '+
            'style="display:flex;justify-content:space-between;align-items:center;padding:5px 10px;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;cursor:pointer;margin-bottom:'+(mkOpen?'4px':'0')+'">'+
            '<span style="font-size:12px;color:#8888aa;font-weight:700">'+mlbl(mk)+'</span>'+
            '<div style="display:flex;align-items:center;gap:6px">'+
              '<span class="u-fs11-gray">'+arr.length+' смен</span>'+
              '<span style="font-family:Unbounded,sans-serif;font-size:12px;font-weight:700;color:#c8f060">'+f2(mkTotal)+'</span>'+
              '<span style="color:#8888aa;font-size:11px">'+(mkOpen?'▾':'▸')+'</span>'+
            '</div>'+
          '</div>';
        if(mkOpen){
          html+='<div>';
          arr.forEach(function(s){
            var rev=(s.cashRevenue||0)+(s.cardRevenue||0)+(s.totalDiscount||0);
            var sid=s.id||s._id||'';
            html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #2e2e3e;font-size:12px">'+
              '<div style="flex:1"><div style="font-weight:700">'+s.date+'</div>'+
              '<div style="color:#8888aa">👤 '+s.sellerName+(s.backfilled?' · 📅 задним числом':'')+'</div></div>'+
              '<div style="display:flex;align-items:center;gap:6px">'+
                '<div style="font-family:Unbounded,sans-serif;font-weight:700;color:#c8f060;font-size:12px">'+f2(rev)+'</div>'+
                (sid?'<button onpointerdown="event.preventDefault();event.stopPropagation();deletePeriodReportShift(\''+sid+'\')" style="padding:3px 7px;border-radius:6px;border:1px solid #f06060;background:none;color:#f06060;font-size:11px;cursor:pointer">🗑</button>':'')+
              '</div></div>';
          });
          html+='</div>';
        }
        html+='</div>';
      });
    }
    html+='</div>';
  });
  html+='</div>';
  c.innerHTML=html;
}
var profPeriodType = 'month';
var PROF_MONTH_NAMES = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function openProfitabilityReport(){
  var shops = getShopNames();
  var shopSel = document.getElementById('profShopFilter');
  if(shopSel) shopSel.innerHTML = '<option value="">Все магазины</option>'+shops.map(function(s){ return '<option>'+s+'</option>'; }).join('');
  var prSel = document.getElementById('prShopFilter');
  if(prSel) prSel.innerHTML = '<option value="">Все магазины</option>'+shops.map(function(s){ return '<option>'+s+'</option>'; }).join('');
  var now = new Date(), curYear = now.getFullYear(), curMonth = now.getMonth();
  var monthSel = document.getElementById('profMonth');
  if(monthSel) monthSel.innerHTML = PROF_MONTH_NAMES.map(function(name,i){ return '<option value="'+i+'"'+(i===curMonth?' selected':'')+'>'+name.charAt(0).toUpperCase()+name.slice(1)+'</option>'; }).join('');
  var yearSel = document.getElementById('profYear');
  if(yearSel){
    var years = [];
    for(var y=curYear; y>=curYear-4; y--) years.push(y);
    yearSel.innerHTML = years.map(function(y){ return '<option value="'+y+'"'+(y===curYear?' selected':'')+'>'+y+'</option>'; }).join('');
  }
  var ym = String(curMonth+1).padStart(2,'0');
  var prFrom = document.getElementById('prDateFrom'), prTo = document.getElementById('prDateTo');
  if(prFrom) prFrom.value = curYear+'-'+ym+'-01';
  if(prTo) prTo.value = new Date(curYear,curMonth+1,0).toISOString().split('T')[0];
  setProfPeriodType('month', document.getElementById('profPeriod_month'));
  setProfView('simple');
  openMo('profitabilityMo');
}
function setProfPeriodType(type, el){
  profPeriodType = type;
  ['month','quarter','half','year','custom'].forEach(function(t){
    var btn = document.getElementById('profPeriod_'+t); if(!btn) return;
    var active = t===type;
    btn.style.borderWidth = active?'2px':'1px'; btn.style.background = active?'#1e2a14':'#22222e';
    btn.style.color = active?'#c8f060':'#8888aa'; btn.style.borderColor = active?'#c8f060':'#2e2e3e';
    btn.style.fontWeight = active?'700':'400';
  });
  var mW=document.getElementById('profMonthWrap'), qW=document.getElementById('profQuarterWrap'),
      hW=document.getElementById('profHalfWrap'), yW=document.getElementById('profYearWrap'),
      cD=document.getElementById('profCustomDates');
  if(mW) mW.style.display = type==='month' ? 'block':'none';
  if(qW) qW.style.display = type==='quarter' ? 'block':'none';
  if(hW) hW.style.display = type==='half' ? 'block':'none';
  if(yW) yW.style.display = (type==='custom') ? 'none':'block';
  if(cD) cD.style.display = type==='custom' ? 'flex':'none';
  generateProfitabilityReport();
}
function _profLastDayOfMonth(y, mIdx){ return new Date(y, mIdx+1, 0).getDate(); }
function _computeRentForShop(shop, from, to, allShifts, rentCfg){
  if(!rentCfg || !rentCfg.amount) return 0;
  var overrides = rentCfg.overrides || {};
  var fromD = new Date(from+'T00:00:00'), toD = new Date(to+'T00:00:00');
  var total = 0;
  var cursor = new Date(fromD.getFullYear(), fromD.getMonth(), 1);
  while(cursor <= toD){
    var y = cursor.getFullYear(), mIdx = cursor.getMonth();
    var monthKey = y+'-'+String(mIdx+1).padStart(2,'0');
    var daysInMonth = new Date(y, mIdx+1, 0).getDate();
    var monthStart = new Date(y, mIdx, 1), monthEnd = new Date(y, mIdx, daysInMonth);
    var rangeStart = fromD > monthStart ? fromD : monthStart;
    var rangeEnd = toD < monthEnd ? toD : monthEnd;
    var daysInRangeThisMonth = Math.round((rangeEnd-rangeStart)/86400000)+1;
    var wholeMonth = daysInRangeThisMonth===daysInMonth;
    var dailyRateThisMonth = rentCfg.mode==='month' ? (rentCfg.amount/daysInMonth) : rentCfg.amount;
    if(daysInRangeThisMonth>0){
      if(overrides[monthKey]!=null){
        total += wholeMonth ? overrides[monthKey] : (overrides[monthKey]/daysInMonth*daysInRangeThisMonth);
      } else if(rentCfg.workedDaysOnly){
        var rangeStartStr = rangeStart.toISOString().split('T')[0], rangeEndStr = rangeEnd.toISOString().split('T')[0];
        var workedDates = {};
        allShifts.forEach(function(s){
          if(s.shopName===shop && s.date>=rangeStartStr && s.date<=rangeEndStr) workedDates[s.date]=true;
        });
        total += dailyRateThisMonth * Object.keys(workedDates).length;
      } else if(rentCfg.mode==='month' && wholeMonth){
        total += rentCfg.amount;
      } else {
        total += dailyRateThisMonth * daysInRangeThisMonth;
      }
    }
    cursor = new Date(y, mIdx+1, 1);
  }
  return total;
}
function generateProfitabilityReport(){
  var c = document.getElementById('profitabilityBody'); if(!c) return;
  var year = parseInt((document.getElementById('profYear')||{}).value) || new Date().getFullYear();
  var from, to, periodLabel;
  if(profPeriodType==='month'){
    var mIdx = parseInt((document.getElementById('profMonth')||{}).value)||0;
    from = year+'-'+String(mIdx+1).padStart(2,'0')+'-01';
    to = year+'-'+String(mIdx+1).padStart(2,'0')+'-'+String(_profLastDayOfMonth(year,mIdx)).padStart(2,'0');
    periodLabel = PROF_MONTH_NAMES[mIdx]+' '+year;
  } else if(profPeriodType==='quarter'){
    var q = parseInt((document.getElementById('profQuarter')||{}).value)||1;
    var qStartM = (q-1)*3;
    from = year+'-'+String(qStartM+1).padStart(2,'0')+'-01';
    to = year+'-'+String(qStartM+3).padStart(2,'0')+'-'+String(_profLastDayOfMonth(year,qStartM+2)).padStart(2,'0');
    periodLabel = 'Q'+q+' '+year;
  } else if(profPeriodType==='half'){
    var h = parseInt((document.getElementById('profHalf')||{}).value)||1;
    if(h===1){ from=year+'-01-01'; to=year+'-06-30'; periodLabel='I полугодие '+year; }
    else { from=year+'-07-01'; to=year+'-12-31'; periodLabel='II полугодие '+year; }
  } else if(profPeriodType==='year'){
    from = year+'-01-01'; to = year+'-12-31'; periodLabel = year+' год';
  } else {
    from = (document.getElementById('profDateFrom')||{}).value||'';
    to = (document.getElementById('profDateTo')||{}).value||'';
    periodLabel = from && to ? (from+' — '+to) : '';
  }
  if(!from||!to){ c.innerHTML='<div class="empty"><div class="ei">📈</div>Укажите период</div>'; return; }
  var shopF = (document.getElementById('profShopFilter')||{}).value||'';
  var shifts = getShifts();
  var filtered = shifts.filter(function(s){ return s.date>=from && s.date<=to && (!shopF||s.shopName===shopF); });
  var f2 = function(n){ return Math.round(n||0).toLocaleString('ru-RU')+'₽'; };
  if(!filtered.length){
    c.innerHTML = '<div class="empty"><div class="ei">📈</div>Нет данных за '+periodLabel+(shopF?' по магазину '+shopF:'')+'</div>';
    return;
  }
  var totCash=0, totCard=0, totDisc=0, totZp=0, totTravel=0, totOper=0;
  filtered.forEach(function(s){
    totCash += s.cashRevenue||0; totCard += s.cardRevenue||0; totDisc += s.totalDiscount||0;
    var exps = s.expenses||[];
    if(exps.length){
      totZp += exps.filter(function(e){ return e.expType==='zp'; }).reduce(function(a,e){ return a+(e.amount||0); },0);
      totTravel += exps.filter(function(e){ return e.expType==='travel'; }).reduce(function(a,e){ return a+(e.amount||0); },0);
      totOper += exps.filter(function(e){ return e.expType==='other'||e.expType==='supplier'; }).reduce(function(a,e){ return a+(e.amount||0); },0);
    } else {
      totZp += s.zp||0; totTravel += s.travel||0;
      totOper += (s.otherExp||0)+(s.supplierExp||0)+(s.drSupplierAmt||0);
    }
  });
  var rentSettings = getShopRentSettings();
  var shiftsForRentCalc = getShifts();
  var totRent = 0;
  if(shopF){
    totRent = _computeRentForShop(shopF, from, to, shiftsForRentCalc, rentSettings[shopF]);
  } else {
    Object.keys(rentSettings).forEach(function(shop){
      totRent += _computeRentForShop(shop, from, to, shiftsForRentCalc, rentSettings[shop]);
    });
  }
  var oborot = totCash + totCard + totDisc;
  var daysInPeriod = Math.round((new Date(to)-new Date(from))/86400000)+1;
  var dohod = totCash + totCard;
  var fot = totZp + totTravel;
  var totalCosts = fot + totOper + totRent;
  var profit = dohod - totalCosts;
  var pct = function(n){ return oborot>0 ? Math.round(n/oborot*1000)/10 : 0; };
  var Row = function(label, val, color, pctVal, bold){
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:'+(bold?'9px':'6px')+' 0;border-bottom:1px solid #2e2e3e">'+
      '<span style="font-size:'+(bold?'14px':'13px')+';color:'+(bold?'#f0f0f8':'#8888aa')+';font-weight:'+(bold?'700':'400')+'">'+label+'</span>'+
      '<span style="font-size:'+(bold?'15px':'13px')+';font-weight:700;color:'+color+'">'+f2(val)+(pctVal!=null?' <span style="color:#555568;font-size:11px;font-weight:400">('+pctVal+'%)</span>':'')+'</span>'+
    '</div>';
  };
  var html = '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:12px;padding:14px">';
  html += '<div style="font-size:11px;color:#8888aa;margin-bottom:10px">📅 '+periodLabel+' · '+filtered.length+' смен'+(shopF?' · '+shopF:' · все магазины')+(daysInPeriod?' · '+daysInPeriod+' дн.':'')+'</div>';
  html += '<div style="font-size:10px;color:#60c8f0;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Оборот</div>';
  html += Row('💵 Нал', totCash, '#60f090');
  html += Row('💳 Безнал', totCard, '#60c8f0');
  html += Row('🎁 Скидка', totDisc, '#8888aa', pct(totDisc));
  html += Row('Итого оборот', oborot, '#c8f060', 100, true);
  html += Row('Итого доход (нал+безнал)', dohod, '#c8f060', pct(dohod), true);
  var todayStr = new Date().toISOString().split('T')[0];
  var avgDivisorDays = daysInPeriod;
  if(to > todayStr){
    var effectiveTo = todayStr < from ? from : todayStr;
    avgDivisorDays = Math.max(1, Math.round((new Date(effectiveTo)-new Date(from))/86400000)+1);
  }
  var avgOborotPerDay = avgDivisorDays>0 ? oborot/avgDivisorDays : 0;
  var avgDohodPerDay = avgDivisorDays>0 ? dohod/avgDivisorDays : 0;
  html += Row('Средняя выручка/день (с учётом скидки)', avgOborotPerDay, '#8888aa');
  html += Row('Средняя выручка/день (без скидки)', avgDohodPerDay, '#8888aa');
  if(to > todayStr) html += '<div style="font-size:10px;color:#8888aa;margin:-4px 0 4px">за '+avgDivisorDays+' прошедших дн. из '+daysInPeriod+'</div>';
  html += '<div style="font-size:10px;color:#f06060;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin:12px 0 4px">Расходы</div>';
  html += Row('💰 ФОТ (оклад/%+проезд)', fot, '#f0a060', pct(fot));
  html += Row('📝 Расходы операционные', totOper, '#f0a060', pct(totOper));
  html += Row('🏠 Аренда', totRent, '#f0a060', pct(totRent))+(!Object.keys(rentSettings).length?'<div style="font-size:10px;color:#8888aa;padding:2px 0 6px">Аренда не настроена — задайте её в Настройках</div>':'');
  html += Row('Итого расходы', totalCosts, '#f06060', pct(totalCosts), true);
  html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0 2px;margin-top:6px;border-top:2px solid '+(profit>=0?'#60f090':'#f06060')+'">'+
    '<span style="font-size:15px;font-weight:700">Доходы − Расходы</span>'+
    '<span style="font-size:19px;font-weight:700;color:'+(profit>=0?'#60f090':'#f06060')+';font-family:Unbounded,sans-serif">'+f2(profit)+'</span>'+
  '</div>';
  html += '<div style="text-align:right;font-size:12px;color:'+(profit>=0?'#60f090':'#f06060')+'">'+pct(profit)+'% от оборота</div>';
  html += '</div>';
  if(!shopF){
    var byShop = {};
    filtered.forEach(function(s){
      if(!byShop[s.shopName]) byShop[s.shopName] = {n:0, cash:0, card:0, disc:0};
      var b = byShop[s.shopName]; b.n++; b.cash+=s.cashRevenue||0; b.card+=s.cardRevenue||0; b.disc+=s.totalDiscount||0;
    });
    html += '<div style="margin-top:10px;font-size:11px;color:#8888aa;font-weight:700;text-transform:uppercase;letter-spacing:.5px">По магазинам</div>';
    Object.keys(byShop).forEach(function(shop){
      var b = byShop[shop], rev = b.cash+b.card+b.disc;
      html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #2e2e3e;font-size:12px">'+
        '<span>🏪 '+shop+' <span style="color:#555568">('+b.n+' см.)</span></span><span style="font-weight:700;color:#c8f060">'+f2(rev)+'</span></div>';
    });
  }
  c.innerHTML = html;
}
