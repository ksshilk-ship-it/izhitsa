let saleItems = [], payMethod = 'cash', staffPayMethod = 'cash', discType = 'pct', discCategory = 'derevo';
function siCalcAmt(){
  var price=parseFloat(gv('siPrice'))||0, qty=parseFloat(gv('siQty'))||1;
  var amtEl=document.getElementById('siAmt'); if(amtEl) amtEl.value = (price*qty)||'';
}
function siCalcFromAmt(){
  var amt=parseFloat(gv('siAmt'))||0, qty=parseFloat(gv('siQty'))||1;
  var priceEl=document.getElementById('siPrice'); if(priceEl && qty>0) priceEl.value = (amt/qty)||'';
}
function siCalcAmtM(){
  var price=parseFloat(gv('siPriceM'))||0, qty=parseFloat(gv('siQtyM'))||1;
  var amtEl=document.getElementById('siAmtM'); if(amtEl) amtEl.value = (price*qty)||'';
}
function siCalcFromAmtM(){
  var amt=parseFloat(gv('siAmtM'))||0, qty=parseFloat(gv('siQtyM'))||1;
  var priceEl=document.getElementById('siPriceM'); if(priceEl && qty>0) priceEl.value = (amt/qty)||'';
}
var _siItemGoodsType = 'derevo';
var _siTypeManualOverride = false;
function siManualSetType(type){
  _siTypeManualOverride = true;
  setSiItemType(type, true);
}
function autoDetectGoodsTypeByName(name){
  if(!name) return null;
  var n = name.toLowerCase().trim();
  var drItems = getRefBook('iz_goods_dr').map(function(g){return (g.name||g).toLowerCase();});
  if(drItems.indexOf(n)>=0) return 'dr';
  var woodItems = getRefBook('iz_goods_derevo').map(function(g){return (g.name||g).toLowerCase();});
  if(woodItems.indexOf(n)>=0) return 'derevo';
  return null; // unknown
}
function siAutoDetectAndSetType(name){
  if(_siTypeManualOverride) return; // don't fight the user's explicit type choice
  var detected = autoDetectGoodsTypeByName(name);
  if(detected && detected !== _siItemGoodsType){
    setSiItemType(detected, true);
  }
}
function getSiSpeciesList(){
  if(_siItemGoodsType!=='dr') return getSpecies();
  var names = getRefBook('iz_dr_species').map(function(g){return g.name||g;}).filter(Boolean);
  names.sort(function(a,b){ return a.toLowerCase().localeCompare(b.toLowerCase(),'ru'); });
  return names;
}
function siAddToSpecies(inputId){
  var el=document.getElementById(inputId); var val=(el&&el.value||'').trim();
  if(!val){ showToast('Введите значение'); return; }
  if(_siItemGoodsType==='dr'){
    var drSp = getRefBook('iz_dr_species');
    if(drSp.some(function(g){return (g.name||g)===val;})){ showToast('Уже есть'); return; }
    var newSp = {id:uid(),name:val};
    drSp.push(newSp);
    localStorage.setItem('iz_dr_species', JSON.stringify(drSp));
    syncArrayAdd('iz_dr_species', newSp);
    if(typeof _clearRefbookTombstone==='function') _clearRefbookTombstone('iz_dr_species', val);
    showToast('✅ Добавлено в Вкус/Состав: '+val);
  } else {
    var before=getSpecies().length; saveSpecies(val);
    if(getSpecies().length>before) showToast('✅ Добавлено в Породы дерева: '+val);
    else showToast('Уже есть в породах дерева');
  }
}
function setSiItemType(type, preserveName){
  _siItemGoodsType = type;
  if(!preserveName){ _siSelectedArticleM=''; var vp=document.getElementById('siVariantPicker'); if(vp) vp.style.display='none'; }
  var lbl = document.getElementById('siSpeciesLabel');
  var inp = document.getElementById('siSpecies');
  var inpM = document.getElementById('siSpeciesM');
  var lblM = document.getElementById('siSpeciesLabelM');
  var isDr = type==='dr';
  if(lbl) lbl.textContent = isDr ? 'Вкус / Состав' : 'Порода дерева';
  if(inp){ inp.placeholder = isDr ? 'Вкус/Состав' : 'Порода'; if(!preserveName) inp.value=''; }
  if(lblM) lblM.textContent = isDr ? 'Вкус / Состав' : 'Порода дерева';
  if(inpM){ inpM.placeholder = isDr ? 'Вкус/Состав' : 'Порода'; if(!preserveName) inpM.value=''; }
  var nameEl = document.getElementById('siName');
  var nameMEl = document.getElementById('siNameM');
  if(nameEl){ if(!preserveName) nameEl.value=''; psjSuggest('siName',getItemNames(type),'siPickName'); }
  if(nameMEl){ if(!preserveName) nameMEl.value=''; }
  ['','M'].forEach(function(suf){
    var db=document.getElementById('siTypeDerevo'+suf), dr=document.getElementById('siTypeDr'+suf);
    if(type==='derevo'){
      if(db) db.style.cssText='flex:1;padding:7px;border-radius:8px;border:2px solid #c8f060;background:#1e2a14;color:#c8f060;font-size:11px;font-weight:700;cursor:pointer';
      if(dr) dr.style.cssText='flex:1;padding:7px;border-radius:8px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:11px;font-weight:600;cursor:pointer';
    } else {
      if(dr) dr.style.cssText='flex:1;padding:7px;border-radius:8px;border:2px solid #a060f0;background:#1e1a2e;color:#a060f0;font-size:11px;font-weight:700;cursor:pointer';
      if(db) db.style.cssText='flex:1;padding:7px;border-radius:8px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:11px;font-weight:600;cursor:pointer';
    }
  });
}
function getItemNames(goodsType){
  var type = goodsType || _siItemGoodsType || 'derevo';
  var key = type==='dr' ? 'iz_goods_dr' : 'iz_goods_derevo';
  var names = {};
  getRefBook(key).forEach(function(it){ if(it.name||it) names[it.name||it]=true; });
  getItemsBase().forEach(function(it){ if(it.name) names[it.name]=true; });
  return Object.keys(names);
}
function siPickName(val){ var el=document.getElementById('siName'); if(el){el.value=val;checkItemDiff();} var box=document.getElementById('siName_sugg'); if(box) box.style.display='none'; }
function siPickNameM(val){ var el=document.getElementById('siNameM'); if(el) el.value=val; var box=document.getElementById('siNameM_sugg'); if(box) box.style.display='none'; _siCheckVariantsM(val); }
var _siSelectedArticleM = '';
function _siGetDrVariants(name){
  var norm = (name||'').toLowerCase().trim();
  if(!norm) return [];
  return getRefBook('iz_goods_dr').filter(function(g){ return (g.name||'').toLowerCase().trim()===norm && g.article; });
}
function _siCheckVariantsM(name){
  _siSelectedArticleM = '';
  var box = document.getElementById('siVariantPicker');
  var list = document.getElementById('siVariantPickerList');
  if(!box || !list) return;
  if(_siItemGoodsType!=='dr'){ box.style.display='none'; return; }
  var variants = _siGetDrVariants(name);
  if(variants.length<2){ box.style.display='none'; return; }
  list.innerHTML = variants.map(function(v){
    return '<button type="button" onpointerdown="event.preventDefault();siPickVariantM('+v.price+',\''+(v.article||'').replace(/'/g,"\\'")+'\')" '+
      'style="text-align:left;padding:8px 10px;background:#22222e;border:1px solid #f0c060;border-radius:8px;color:#f0f0f8;font-size:12px;cursor:pointer">'+
      '№'+(v.article||'—')+' · '+Math.round(v.price).toLocaleString('ru-RU')+'₽</button>';
  }).join('');
  box.style.display='block';
}
function siPickVariantM(price, article){
  _siSelectedArticleM = article;
  var priceEl = document.getElementById('siPriceM'); if(priceEl){ priceEl.value = price; siCalcAmtM(); }
  var box = document.getElementById('siVariantPicker'); if(box) box.style.display='none';
}
function openSaleCatalogPicker(){
  var isDr = _siItemGoodsType==='dr';
  var key = isDr ? 'iz_goods_dr' : 'iz_goods_derevo';
  var items = getRefBook(key);
  var overlay = document.getElementById('saleCatalogOverlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'saleCatalogOverlay';
    overlay.className = 'mo';
    overlay.onclick = function(e){ if(e.target===overlay) overlay.classList.remove('open'); };
    document.body.appendChild(overlay);
  }
  window._scpAllItems = items;
  window._scpQuery = '';
  window._scpCatOpen = {};
  _renderSaleCatalogPicker();
  overlay.classList.add('open');
  setTimeout(function(){ var inp=document.getElementById('scpSearch'); if(inp) inp.focus(); }, 50);
}
function _scpFilterInput(val){
  window._scpQuery = (val||'').toLowerCase().trim();
  _renderSaleCatalogPicker();
}
function _scpToggleCat(cat){
  window._scpCatOpen = window._scpCatOpen || {};
  window._scpCatOpen[cat] = !(window._scpCatOpen[cat]===true);
  _renderSaleCatalogPicker();
}
function _renderSaleCatalogPicker(){
  var overlay = document.getElementById('saleCatalogOverlay'); if(!overlay) return;
  var isDr = _siItemGoodsType==='dr';
  var items = window._scpAllItems||[];
  var q = window._scpQuery||'';
  if(q) items = items.filter(function(it){ return (it.name||'').toLowerCase().indexOf(q)>=0; });
  var groups = {};
  items.forEach(function(it){
    var cat = (it.category||'').trim() || 'Без категории';
    if(!groups[cat]) groups[cat] = [];
    groups[cat].push(it);
  });
  var catNames = Object.keys(groups).sort(function(a,b){
    if(a==='Без категории') return 1;
    if(b==='Без категории') return -1;
    return a.localeCompare(b,'ru');
  });
  window._scpCatOpen = window._scpCatOpen || {};
  var body = !catNames.length ? '<div style="font-size:12px;color:#8888aa;padding:10px 0">Ничего не найдено</div>' :
    catNames.map(function(cat){
      var list = groups[cat].slice().sort(function(a,b){
        if(isDr){
          var pa=a.price||0, pb=b.price||0;
          if(pa!==pb) return pa-pb;
          return (a.name||'').toLowerCase().localeCompare((b.name||'').toLowerCase(),'ru');
        }
        var na=(a.name||'').toLowerCase(), nb=(b.name||'').toLowerCase();
        if(na!==nb) return na.localeCompare(nb,'ru');
        return (a.price||0)-(b.price||0);
      });
      var open = !!q || window._scpCatOpen[cat]===true;
      var header = '<div onclick="_scpToggleCat(\''+cat.replace(/'/g,"\\'")+'\')" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding:9px 10px;margin:8px 0 4px;background:#1a1a22;border-radius:8px">'+
        '<span style="font-size:11px;color:#c8f060;font-weight:700;text-transform:uppercase;letter-spacing:.5px">'+cat+' ('+list.length+')</span>'+
        '<span style="color:#8888aa;font-size:11px">'+(open?'▾':'▸')+'</span>'+
      '</div>';
      if(!open) return header;
      return header + list.map(function(it){
          var priceStr = isDr ? (' · '+Math.round(it.price||0).toLocaleString('ru-RU')+'₽'+(it.article?' · №'+it.article:'')) : '';
          return '<div onclick="_scpPick(\''+(it.name||'').replace(/'/g,"\\'")+'\','+(it.price||0)+',\''+(it.article||'').replace(/'/g,"\\'")+'\')" '+
            'style="padding:9px 10px;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;margin-bottom:5px;cursor:pointer;font-size:13px">'+
            (it.name||'')+'<span style="color:#8888aa;font-size:12px">'+priceStr+'</span>'+
          '</div>';
        }).join('');
    }).join('');
  overlay.innerHTML = '<div class="md">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<div style="font-size:15px;font-weight:700">'+(isDr?'🛍 ДР Товар':'🌳 Дерево')+' — список</div>'+
      '<button onclick="document.getElementById(\'saleCatalogOverlay\').classList.remove(\'open\')" style="background:#22222e;border:1px solid #2e2e3e;border-radius:8px;width:30px;height:30px;color:#8888aa;font-size:16px;cursor:pointer">✕</button>'+
    '</div>'+
    '<input id="scpSearch" class="fi" placeholder="Поиск по названию..." autocomplete="off" oninput="_scpFilterInput(this.value)" style="margin-bottom:8px" value="'+(q||'').replace(/"/g,'&quot;')+'">'+
    '<div style="max-height:60vh;overflow-y:auto">'+body+'</div>'+
  '</div>';
}
function _scpPick(name, price, article){
  var mb = document.getElementById('siManualBlock');
  var nameEl, priceEl;
  if(mb && mb.style.display!=='none'){ nameEl=document.getElementById('siNameM'); priceEl=document.getElementById('siPriceM'); }
  else { nameEl=document.getElementById('siNameM'); priceEl=document.getElementById('siPriceM'); mb.style.display='block'; document.getElementById('siLookupResult').style.display='none'; }
  if(nameEl) nameEl.value = name;
  if(priceEl && price){ priceEl.value = price; siCalcAmtM(); }
  _siCheckVariantsM(name);
  document.getElementById('saleCatalogOverlay').classList.remove('open');
}
function siPickSpecies(val){ var el=document.getElementById('siSpecies'); if(el) el.value=val; var box=document.getElementById('siSpecies_sugg'); if(box) box.style.display='none'; }
function siPickSpeciesM(val){ var el=document.getElementById('siSpeciesM'); if(el) el.value=val; var box=document.getElementById('siSpeciesM_sugg'); if(box) box.style.display='none'; }
function siAddToGoods(inputId){
  var el=document.getElementById(inputId); var val=(el&&el.value||'').trim();
  if(!val){ showToast('Введите наименование'); return; }
  var key = _siItemGoodsType==='dr' ? 'iz_goods_dr' : 'iz_goods_derevo';
  var goods = getRefBook(key);
  var exists = goods.some(function(g){ return ((g&&g.name)||g)===val; });
  if(!exists){
    var newItem = {id:uid(), name:val};
    goods.push(newItem);
    localStorage.setItem(key, JSON.stringify(goods));
    syncArrayAdd(key, newItem);
    if(typeof _clearRefbookTombstone==='function') _clearRefbookTombstone(key, val);
    var allGoods = getRefBook('iz_goods');
    if(!allGoods.some(function(g){return ((g&&g.name)||g)===val;})){
      var newItem2 = {id:uid(), name:val};
      allGoods.push(newItem2);
      localStorage.setItem('iz_goods', JSON.stringify(allGoods));
      syncArrayAdd('iz_goods', newItem2);
    }
    showToast('✅ Добавлено в базу товаров: '+val);
  } else {
    showToast('Уже есть в базе товаров');
  }
}
var _siNoArticleMode = false;
function openManualNoArticle(){
  var numEl=document.getElementById('siNum'); if(numEl) numEl.value='';
  currentLookupItem=null;
  var lr=document.getElementById('siLookupResult'), mb=document.getElementById('siManualBlock');
  if(lr) lr.style.display='none';
  if(mb) mb.style.display='block';
  var dw=document.getElementById('siDiffWarn'); if(dw) dw.style.display='none';
  _siNoArticleMode = true;
  var nameMEl=document.getElementById('siNameM'); if(nameMEl) nameMEl.focus();
}
function _lookupItemInInvoices(numStr, shopName){
  var manual = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var auto = JSON.parse(localStorage.getItem('iz_invoices')||'[]');
  var all = manual.concat(auto).filter(function(inv){ return !shopName || inv.shopName===shopName; });
  all.sort(function(a,b){ return (b.acceptedDate||b.date||'').localeCompare(a.acceptedDate||a.date||''); });
  for(var i=0;i<all.length;i++){
    var inv = all[i];
    var items = inv.acceptedItems || inv.items || [];
    for(var j=0;j<items.length;j++){
      var it = items[j];
      var artNum = it.article||it.num||it.artNum;
      if(artNum!=null && String(artNum)===numStr){
        return {
          num:numStr, name:it.name||'', price:(it.factPrice!=null?it.factPrice:it.price)||0,
          species:it.species||'', goodsType:it.goodsType||inv.goodsType||'derevo',
          qty:null, fromStock:false, fromInvoiceOnly:true
        };
      }
    }
  }
  return null;
}
function lookupItem(num){
  _siNoArticleMode = false;
  var lr=document.getElementById('siLookupResult'), mb=document.getElementById('siManualBlock');
  if(!num.trim()){ lr.style.display='none'; mb.style.display='none'; currentLookupItem=null; return; }
  var numStr=num.trim();
  var shopNm=(typeof _currentShiftView!=='undefined' && _currentShiftView && _currentShiftView.shopName) || (session&&session.shopName);
  var stockEntry=stockGetByNum(shopNm,numStr);
  var items=JSON.parse(localStorage.getItem('iz_items')||'[]');
  var found=stockEntry ? {num:stockEntry.num,name:stockEntry.name,price:stockEntry.price,species:stockEntry.species,goodsType:stockEntry.goodsType,qty:stockEntry.qty,fromStock:true}
    : items.find(function(i){ return String(i.num)===numStr; });
  if(!found) found = _lookupItemInInvoices(numStr, shopNm);
  if(found){
    currentLookupItem=found;
    document.getElementById('siName').value=found.name||'';
    document.getElementById('siPrice').value=found.price||'';
    document.getElementById('siSpecies').value=found.species||'';
    var qEl=document.getElementById('siQty'); if(qEl) qEl.value=qEl.value||'1';
    lr.style.display='block'; mb.style.display='none';
    document.getElementById('siDiffWarn').style.display='none';
    if(found.fromStock){
      var hint=lr.querySelector('.stock-qty-hint');
      if(!hint){ hint=document.createElement('div'); hint.className='stock-qty-hint'; hint.style.cssText='font-size:11px;color:#60c8f0;margin-top:3px'; lr.appendChild(hint); }
      hint.textContent=found.qty>0?('В наличии: '+found.qty+' шт.'):'⚠️ Нет в наличии';
    } else if(found.fromInvoiceOnly){
      var hint2=lr.querySelector('.stock-qty-hint');
      if(!hint2){ hint2=document.createElement('div'); hint2.className='stock-qty-hint'; hint2.style.cssText='font-size:11px;color:#f0c060;margin-top:3px'; lr.appendChild(hint2); }
      hint2.textContent='⚠️ Найден в накладной (не в локальном остатке этого устройства) — проверьте цену и породу';
    }
    siCalcAmt();
  } else {
    currentLookupItem=null; lr.style.display='none'; mb.style.display='block';
    var spM=document.getElementById('siSpeciesM'); if(spM) spM.value='';
    var qMEl=document.getElementById('siQtyM'); if(qMEl) qMEl.value=qMEl.value||'1';
  }
}
function checkItemDiff(){
  const warn=document.getElementById('siDiffWarn'); if(!warn||!currentLookupItem) return;
  const nm=(gv('siName')||'').trim(), pr=parseFloat(gv('siPrice'))||0;
  const bNm=currentLookupItem.name||'', bPr=currentLookupItem.price||0;
  const nd=nm&&nm!==bNm, pd=pr&&pr!==bPr;
  if(nd||pd){ let m=[]; if(nd)m.push('Название'); if(pd)m.push('Цена: '+fmt(bPr)+' → '+fmt(pr)); warn.style.display='block'; warn.innerHTML='⚠️ Расхождение: '+m.join(', '); }
  else warn.style.display='none';
}
function resetSaleForm(){
  var accs = JSON.parse(localStorage.getItem('iz_admin_accounts')||'[]');
  var transferSel = document.getElementById('transferCardSelect');
  var rsSel = document.getElementById('rsAccountSelect');
  var cardAccs = accs.filter(function(a){ return a.type!=='bank'&&a.type!=='cash'; });
  var rsAccs = accs.filter(function(a){ return a.type==='bank'; });
  if(transferSel){
    transferSel.innerHTML='<option value="">— выберите карту —</option>'+
      (cardAccs.length ? cardAccs.map(function(a){return '<option value="'+a.name+'">'+a.name+'</option>';}).join('')
      : '<option disabled>Добавьте карты в настройках Администратора</option>');
  }
  if(rsSel){
    rsSel.innerHTML='<option value="">— выберите РС —</option>'+
      (rsAccs.length ? rsAccs.map(function(a){return '<option value="'+a.name+'">'+a.name+'</option>';}).join('')
      : '<option disabled>Добавьте РС в настройках Администратора</option>');
  }
  var tb=document.getElementById('transferCardBlock'); if(tb)tb.style.display='none';
  var rb=document.getElementById('rsAccountBlock'); if(rb)rb.style.display='none';
  saleItems=[];
  _siTypeManualOverride = false;
  setSiItemType('derevo');
  setDiscCategory('derevo');
  renderSaleItems(); calcSaleTotal();
  ['siNum','siName','siPrice','siQty','siAmt','siSpecies','siNameM','siPriceM','siQtyM','siAmtM','siSpeciesM','saleComment','mixCash','mixCard','discInput','saleDiscount','ordCustName','ordRecipPhone','ordOrdererPhone','ordDeliveryAddr','ordComment'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  var ordChk = document.getElementById('ordDiffOrderer'); if(ordChk){ ordChk.checked=false; toggleOrdererPhone(false); }
  setOrderChannel('Telegram');
  document.getElementById('siLookupResult').style.display='none';
  document.getElementById('siManualBlock').style.display='none';
  document.getElementById('siDiffWarn').style.display='none';
  document.getElementById('saleFinal').textContent='0₽';
  currentLookupItem=null; discType='pct'; setDiscType('pct');
  document.querySelectorAll('#saleMo .pc').forEach(p=>p.classList.remove('active'));
  document.querySelector('#saleMo .pc').classList.add('active'); payMethod='cash';
  document.getElementById('mixedBlock').style.display='none';
  var _shopType = (session && session.shopType) || getShopType(session && session.shopName);
  var rsChip = document.getElementById('pcRS');
  if(rsChip) rsChip.style.display = (_shopType === 'shop') ? 'none' : '';
  _editSaleEntryId = null;
  _svArchiveEditId = null;
  _svArchiveAddMode = false;
  _siNoArticleMode = false;
  var mt = document.querySelector('#saleMo .mt'); if(mt) mt.textContent = 'Оформить продажу';
  var delBtn = document.querySelector('#saleMo .sale-edit-del-btn'); if(delBtn) delBtn.remove();
}
function addSaleItem(){
  let num=(gv('siNum')||'').trim(); let name,price,species,qty=1,hasDiff=false,diffNote='';
  const lr=document.getElementById('siLookupResult'), mb=document.getElementById('siManualBlock');
  if(lr&&lr.style.display!=='none'){
    name=(gv('siName')||'').trim(); price=parseFloat(gv('siPrice'))||0; species=(gv('siSpecies')||'').trim(); qty=parseFloat(gv('siQty'))||1;
    if(!name){showToast('Введите наименование');return;} if(!price){showToast('Введите цену');return;}
    if(currentLookupItem){ const nd=name!==(currentLookupItem.name||''),pd=price!==(currentLookupItem.price||0); if(nd||pd){hasDiff=true;let m=[];if(nd)m.push('название');if(pd)m.push('цена (база: '+fmt(currentLookupItem.price)+')');diffNote='⚠️ '+m.join(', ');} }
  } else if(mb&&mb.style.display!=='none'){
    name=(gv('siNameM')||'').trim(); price=parseFloat(gv('siPriceM'))||0; species=(gv('siSpeciesM')||'').trim(); qty=parseFloat(gv('siQtyM'))||1;
    if(!name){showToast('Введите наименование');return;}
    if(!num && _siNoArticleMode){
    } else {
      hasDiff=true; diffNote='⚠️ артикул не найден в базе';
    }
  } else { showToast('Введите артикул'); return; }
  if(_siItemGoodsType==='dr' && mb && mb.style.display!=='none'){
    var drVariants = _siGetDrVariants(name);
    if(drVariants.length>=2){
      var matched = drVariants.find(function(v){ return Math.round(v.price)===Math.round(price); });
      if(matched){ num = matched.article; hasDiff=false; diffNote=''; }
      else {
        _siCheckVariantsM(name);
        showToast('⚠️ У «'+name+'» несколько вариантов с разными артикулами — выберите нужный вариант выше, не вводите цену вручную');
        return;
      }
    } else if(drVariants.length===1){
      num = drVariants[0].article; hasDiff=false; diffNote='';
    }
  }
  if(qty<=0) qty=1;
  var key = _siItemGoodsType==='dr' ? 'iz_goods_dr' : 'iz_goods_derevo';
  var existingGoods = getRefBook(key);
  var normName = name.toLowerCase().trim();
  var exactGoods = existingGoods.find(function(g){ return (g.name||g).toLowerCase().trim()===normName; });
  if(!exactGoods){
    var closeGoods=null, bestScoreGoods=0;
    existingGoods.forEach(function(g){
      var sc=nameSimilarity(normName,(g.name||g).toLowerCase().trim());
      if(sc>bestScoreGoods){ bestScoreGoods=sc; closeGoods=g; }
    });
    if(bestScoreGoods>=0.65 && closeGoods){
      showDupWarning(name, closeGoods.name||closeGoods, function(useExisting){
        _finalizeAddSaleItem(num, useExisting?(closeGoods.name||closeGoods):name, price, species, qty, hasDiff, diffNote);
      });
      return;
    }
  }
  _finalizeAddSaleItem(num, name, price, species, qty, hasDiff, diffNote);
}
function _finalizeAddSaleItem(num, name, price, species, qty, hasDiff, diffNote){
  var amt=Math.round(price*qty*100)/100;
  saleItems.push({id:uid(),num,name,price,qty,amt,species,goodsType:_siItemGoodsType,hasDiff,diffNote});
  ['siNum','siName','siPrice','siQty','siAmt','siSpecies','siNameM','siPriceM','siQtyM','siAmtM','siSpeciesM'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  var lr=document.getElementById('siLookupResult'), mb=document.getElementById('siManualBlock');
  if(lr) lr.style.display='none'; if(mb) mb.style.display='none'; currentLookupItem=null;
  document.getElementById('siDiffWarn').style.display='none';
  setSiItemType('derevo');
  _siNoArticleMode = false;
  _siSelectedArticleM = '';
  var vp = document.getElementById('siVariantPicker'); if(vp) vp.style.display='none';
  renderSaleItems(); calcSaleTotal();
}
function renderSaleItems(){
  const c=document.getElementById('saleItemsDisplay');
  updateDiscCategoryVisibility();
  if(typeof payMethod!=='undefined' && payMethod==='mixed') renderMixPerItemBlock();
  if(!saleItems.length){c.innerHTML='<div style="font-size:12px;color:#8888aa;padding:4px 0">Добавьте товары ↑</div>';return;}
  c.innerHTML=saleItems.map((it,i)=>`
    <div class="sir" style="border-color:${it.hasDiff?'#f06060':'#2e2e3e'};background:${it.hasDiff?'#2e1a1a':'#22222e'}">
      <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:28px">
        <div style="font-size:11px;font-weight:700;color:#c8f060;background:#1e2a14;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center">${i+1}</div>
        <div class="sir-num" style="color:${it.hasDiff?'#f06060':'#8888aa'};font-size:9px;margin-top:2px">${it.num||'—'}</div>
      </div>
      <div class="sir-info"><div class="sir-name">${it.name}${it.species?` <span style="color:#f0c060;font-size:11px">· ${it.species}</span>`:''} <span style="font-size:10px;padding:1px 6px;border-radius:6px;background:${it.goodsType==='dr'?'#1e1a2e':'#1e2a14'};color:${it.goodsType==='dr'?'#a060f0':'#c8f060'}">${it.goodsType==='dr'?'🛍 ДР':'🌳 Дерево'}</span></div>
        <div class="sir-price" style="color:${it.hasDiff?'#f06060':'#c8f060'}">${(it.qty&&it.qty!==1)?(fmt(it.price)+' × '+it.qty+' = '+fmt(it.amt!=null?it.amt:it.price*it.qty)):fmt(it.amt!=null?it.amt:it.price)}</div>
        ${it.hasDiff?`<div style="font-size:11px;color:#f06060;margin-top:2px">${it.diffNote}</div>`:''}
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        <button class="sir-del" onpointerdown="event.preventDefault();_siCopyItem(${i})" style="background:#1a2a1e;border:1px solid #60f090;border-radius:6px;color:#60f090;font-size:10px;padding:3px 6px">📋</button>
        <button class="sir-del" onclick="siEditItem(${i})" style="border:1px solid #c8f060;border-radius:6px;color:#c8f060;font-size:13px;padding:3px 6px">✏️</button>
        <button class="sir-del" onclick="saleItems.splice(${i},1);renderSaleItems();calcSaleTotal()">✕</button>
      </div>
    </div>`).join('');
}
function _siCopyItem(i){
  var it = saleItems[i]; if(!it) return;
  currentLookupItem = null;
  var lr=document.getElementById('siLookupResult'), mb=document.getElementById('siManualBlock');
  var numEl=document.getElementById('siNum'); if(numEl) numEl.value='';
  if(lr) lr.style.display='none';
  if(mb) mb.style.display='block';
  var nameMEl=document.getElementById('siNameM'); if(nameMEl) nameMEl.value=it.name||'';
  var priceMEl=document.getElementById('siPriceM'); if(priceMEl) priceMEl.value=it.price||'';
  var spMEl=document.getElementById('siSpeciesM'); if(spMEl) spMEl.value=it.species||'';
  var qMEl=document.getElementById('siQtyM'); if(qMEl) qMEl.value=1;
  siCalcAmtM();
  setSiItemType(it.goodsType==='dr'?'dr':'derevo');
  setTimeout(function(){ var f=document.getElementById('siQtyM');if(f)f.focus(); },100);
  showToast('📋 Поля скопированы — измените нужное и добавьте в чек');
}
function siEditItem(i){
  var it = saleItems[i]; if(!it) return;
  saleItems.splice(i,1); renderSaleItems(); calcSaleTotal();
  _siTypeManualOverride = true;
  setSiItemType(it.goodsType==='dr'?'dr':'derevo');
  var numEl=document.getElementById('siNum');
  if(numEl){ numEl.value = it.num||''; }
  if(it.num){
    lookupItem(it.num);
  } else {
    currentLookupItem=null;
    _siNoArticleMode = !it.hasDiff;
  }
  var lr=document.getElementById('siLookupResult'), mb=document.getElementById('siManualBlock');
  if(!it.num){ if(lr) lr.style.display='none'; if(mb) mb.style.display='block'; }
  if(lr && lr.style.display!=='none'){
    var nameEl=document.getElementById('siName'); if(nameEl) nameEl.value=it.name||'';
    var priceEl=document.getElementById('siPrice'); if(priceEl) priceEl.value=it.price||'';
    var spEl=document.getElementById('siSpecies'); if(spEl) spEl.value=it.species||'';
    var qEl=document.getElementById('siQty'); if(qEl) qEl.value=it.qty||1;
    checkItemDiff(); siCalcAmt();
  } else {
    if(mb) mb.style.display='block';
    if(lr) lr.style.display='none';
    var nameMEl=document.getElementById('siNameM'); if(nameMEl) nameMEl.value=it.name||'';
    var priceMEl=document.getElementById('siPriceM'); if(priceMEl) priceMEl.value=it.price||'';
    var spMEl=document.getElementById('siSpeciesM'); if(spMEl) spMEl.value=it.species||'';
    var qMEl=document.getElementById('siQtyM'); if(qMEl) qMEl.value=it.qty||1;
    siCalcAmtM();
  }
  showToast('✏️ Исправьте поля и нажмите ＋');
}
function setDiscCategory(cat){
  discCategory = cat;
  ['derevo','dr'].forEach(function(c){
    var btn = document.getElementById('discCat_'+c);
    if(!btn) return;
    var active = c===cat;
    btn.style.borderWidth = active ? '2px' : '1px';
    btn.style.background = active ? '#1e2a14' : '#22222e';
    btn.style.color = active ? '#c8f060' : '#8888aa';
    btn.style.borderColor = active ? '#c8f060' : '#2e2e3e';
    btn.style.fontWeight = active ? '700' : '600';
  });
}
function updateDiscCategoryVisibility(){
  var block = document.getElementById('discCategoryBlock'); if(!block) return;
  var hasWood = saleItems.some(function(it){ return it.goodsType!=='dr'; });
  var hasDr = saleItems.some(function(it){ return it.goodsType==='dr'; });
  block.style.display = (hasWood && hasDr) ? 'block' : 'none';
  if(!(hasWood && hasDr)) setDiscCategory('derevo');
}
function setDiscType(type){
  discType=type;
  const pb=document.getElementById('discTypePct'),sb=document.getElementById('discTypeSum'),u=document.getElementById('discUnit');
  if(type==='pct'){ pb.style.cssText='flex:1;padding:8px;border-radius:10px;border:2px solid #c8f060;background:#1e2a14;color:#c8f060;font-family:Golos Text,sans-serif;font-size:12px;font-weight:700;cursor:pointer'; sb.style.cssText='flex:1;padding:8px;border-radius:10px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-family:Golos Text,sans-serif;font-size:12px;font-weight:600;cursor:pointer'; if(u)u.textContent='%'; }
  else { sb.style.cssText='flex:1;padding:8px;border-radius:10px;border:2px solid #c8f060;background:#1e2a14;color:#c8f060;font-family:Golos Text,sans-serif;font-size:12px;font-weight:700;cursor:pointer'; pb.style.cssText='flex:1;padding:8px;border-radius:10px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-family:Golos Text,sans-serif;font-size:12px;font-weight:600;cursor:pointer'; if(u)u.textContent='₽'; }
  document.getElementById('discInput').value=''; document.getElementById('saleDiscount').value=''; calcSaleTotal();
}
function calcDiscountFromInput(){
  const total=saleItems.reduce((s,it)=>s+(it.amt!=null?it.amt:it.price*(it.qty||1)),0), inp=parseFloat(gv('discInput'))||0;
  const de=document.getElementById('saleDiscount'); if(!de)return;
  if(discType==='pct'){ de.value=Math.round(total*inp/100)||''; const h=document.getElementById('discHint'); if(h&&inp>0)h.textContent=inp+'% от '+fmt(total)+' = '+fmt(Math.round(total*inp/100)); }
  else de.value=inp||'';
  calcSaleTotal();
}
function calcSaleTotal(){
  const total=saleItems.reduce((s,it)=>s+(it.amt!=null?it.amt:it.price*(it.qty||1)),0), disc=parseFloat(gv('saleDiscount'))||0;
  const el=document.getElementById('saleFinal'); if(el)el.textContent=fmt(Math.max(0,total-disc));
}
var _orderChannel = 'Telegram';
function setPayM(m,el){
  payMethod=m;
  document.querySelectorAll('#saleMo .pc').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('mixedBlock').style.display=m==='mixed'?'grid':'none';
  var transferSel=document.getElementById('transferCardBlock');
  var rsSel=document.getElementById('rsAccountBlock');
  if(transferSel) transferSel.style.display=m==='transfer'?'block':'none';
  if(rsSel) rsSel.style.display=m==='rs'?'block':'none';
  if(m==='mixed') renderMixPerItemBlock(); else { var b=document.getElementById('mixPerItemBlock'); if(b) b.style.display='none'; }
}
function renderMixPerItemBlock(){
  var wrap = document.getElementById('mixPerItemBlock');
  var list = document.getElementById('mixPerItemList');
  if(!wrap || !list) return;
  if(!saleItems.length || saleItems.length<2){ wrap.style.display='none'; return; }
  wrap.style.display='block';
  list.innerHTML = saleItems.map(function(it,idx){
    var amt = it.amt!=null?it.amt:it.price*(it.qty||1);
    var isCash = it.mixPay==='cash', isCard = it.mixPay==='card';
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #2e2e3e">'+
      '<div style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(it.name||'')+' · '+fmt(amt)+'</div>'+
      '<button type="button" onpointerdown="event.preventDefault();setMixItemPay('+idx+',\'cash\')" style="padding:5px 9px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;border:'+(isCash?'2px solid #c8f060':'1px solid #2e2e3e')+';background:'+(isCash?'#1e2a14':'#22222e')+';color:'+(isCash?'#c8f060':'#8888aa')+'">💵 Нал</button>'+
      '<button type="button" onpointerdown="event.preventDefault();setMixItemPay('+idx+',\'card\')" style="padding:5px 9px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;border:'+(isCard?'2px solid #60c8f0':'1px solid #2e2e3e')+';background:'+(isCard?'#0c1a20':'#22222e')+';color:'+(isCard?'#60c8f0':'#8888aa')+'">💳 Безнал</button>'+
    '</div>';
  }).join('');
}
function setMixItemPay(idx, method){
  if(!saleItems[idx]) return;
  saleItems[idx].mixPay = method;
  var mc=document.getElementById('mixCash'), mcr=document.getElementById('mixCard');
  if(mc) mc.value=''; if(mcr) mcr.value='';
  renderMixPerItemBlock();
}
function _mixPerItemCleared(){
  saleItems.forEach(function(it){ delete it.mixPay; });
  renderMixPerItemBlock();
}
var _savingSale = false;
function saveSale(){
  if(_savingSale) return; // guards against double-tap / double-submit creating a duplicate sale entry
  if(!saleItems.length){showToast('Добавьте товары');return;}
  _savingSale = true;
  setTimeout(function(){ _savingSale = false; }, 1200);
  try{
    _saveSaleInner();
  }catch(e){
    _savingSale = false;
    console.log('[saveSale] ошибка:', e);
    showToast('⛔ Ошибка при сохранении продажи: '+(e&&e.message?e.message:e)+'. Попробуйте ещё раз.');
  }
}
function _saveSaleInner(){
  const total=saleItems.reduce((s,it)=>s+(it.amt!=null?it.amt:it.price*(it.qty||1)),0), disc=parseFloat(gv('saleDiscount'))||0, paid=Math.max(0,total-disc);
  let cashPart=0,cardPart=0;
  if(payMethod==='cash')cashPart=paid; else if(payMethod==='mixed'){cashPart=parseFloat(gv('mixCash'))||0;cardPart=parseFloat(gv('mixCard'))||0;} else cardPart=paid;
  var transferDest=gv('transferCardSelect'), rsDest=gv('rsAccountSelect');
  var payLabels={cash:'💵 Нал',terminal:'💳 Терминал',sbp:'📱 СБП',transfer:'🏦 Перевод'+(transferDest?' → '+transferDest:''),qr:'🔲 QR',mixed:'➗ Смешанный',rs:'🏦 РС'+(rsDest?' → '+rsDest:'')};
  const payL=payLabels[payMethod]||payMethod;
  const hasDiff=saleItems.some(i=>i.hasDiff);
  var totalWood = saleItems.reduce(function(s,it){ var a=it.amt!=null?it.amt:it.price*(it.qty||1); return it.goodsType==='dr' ? s : s+a; },0);
  var totalDr = total - totalWood;
  var discWood, discDr;
  if(discCategory==='derevo'){
    discWood = Math.min(disc, totalWood);
    discDr = disc - discWood;
  } else if(discCategory==='dr'){
    discDr = Math.min(disc, totalDr);
    discWood = disc - discDr;
  } else {
    var shareWood = total>0 ? totalWood/total : 0;
    discWood = Math.round(disc*shareWood);
    discDr = disc - discWood;
  }
  var paidWood = Math.max(0, totalWood-discWood);
  var paidDr = Math.max(0, totalDr-discDr);
  var perItemMixed = payMethod==='mixed' && saleItems.length>1 && saleItems.every(function(it){ return it.mixPay==='cash'||it.mixPay==='card'; });
  var cashPartWood, cardPartWood, cashPartDr, cardPartDr;
  if(perItemMixed){
    var cashItemsWood=0, cardItemsWood=0, cashItemsDr=0, cardItemsDr=0;
    saleItems.forEach(function(it){
      var a = it.amt!=null?it.amt:it.price*(it.qty||1);
      var isDr = it.goodsType==='dr';
      if(it.mixPay==='cash'){ if(isDr) cashItemsDr+=a; else cashItemsWood+=a; }
      else { if(isDr) cardItemsDr+=a; else cardItemsWood+=a; }
    });
    var shareCashWood = totalWood>0 ? cashItemsWood/totalWood : 0;
    var shareCashDr = totalDr>0 ? cashItemsDr/totalDr : 0;
    cashPartWood = Math.round(paidWood*shareCashWood);
    cardPartWood = paidWood - cashPartWood;
    cashPartDr = Math.round(paidDr*shareCashDr);
    cardPartDr = paidDr - cashPartDr;
    cashPart = cashPartWood + cashPartDr;
    cardPart = cardPartWood + cardPartDr;
  } else {
    var sharePaidWood = paid>0 ? paidWood/paid : (total>0?totalWood/total:0);
    cashPartWood = Math.round(cashPart*sharePaidWood);
    cardPartWood = Math.round(cardPart*sharePaidWood);
    cashPartDr = cashPart-cashPartWood;
    cardPartDr = cardPart-cardPartWood;
  }
  var hasWood = saleItems.some(function(it){ return it.goodsType!=='dr'; });
  var hasDr = saleItems.some(function(it){ return it.goodsType==='dr'; });
  var overallGoodsType = (hasWood && hasDr) ? 'mixed' : (hasDr ? 'dr' : 'derevo');
  var _onlineOrderInfo = null;
  var _shopTypeNow = session.shopType || getShopType(session.shopName);
  if(_shopTypeNow==='online'){
    _onlineOrderInfo = {
      channel: _orderChannel,
      customerName: gv('ordCustName'),
      recipientPhone: gv('ordRecipPhone'),
      ordererPhone: (document.getElementById('ordDiffOrderer')&&document.getElementById('ordDiffOrderer').checked) ? gv('ordOrdererPhone') : '',
      deliveryAddress: gv('ordDeliveryAddr'),
      orderComment: gv('ordComment')
    };
  }
  var newEntryData = {ts:_workingNowISO(),icon:'💰',
    label:'Продажа',
    sub:saleItems.map(i=>'№'+(i.num||'—')+' '+i.name+(i.goodsType==='dr'?' · ДР':'')+(i.hasDiff?' ⚠️':'')).join(', ')+(disc?' · Скидка '+fmt(disc):'')+' · '+payL,
    items:[...saleItems],totalPrice:total,discount:disc,discCategory:discCategory,totalPaid:paid,payMethod,cashPart,cardPart,goodsType:overallGoodsType,
    hasDiff,comment:gv('saleComment'),amount:paid,amtCls:'inc',amtSign:'+',
    cashEffect:cashPartWood,cardEffect:cardPartWood,staffEffect:0,goodsEffect:-totalWood,
    cashDrEffect:cashPartDr,cardDrEffect:cardPartDr,goodsDrEffect:-totalDr,
    onlineOrder:_onlineOrderInfo};
  if(_svArchiveAddMode && _currentShiftView){
    var jnlArch2 = _currentShiftView.journal||[];
    var newArchEntry = Object.assign({id:uid(), type:'sale'}, newEntryData, {
      addedByAdmin:(session&&(session.name||session.sellerName))||'admin',
      addedAt:new Date().toISOString()
    });
    jnlArch2.push(newArchEntry);
    jnlArch2.sort(function(a,b){ return (a.ts||'').localeCompare(b.ts||''); });
    _currentShiftView.journal = jnlArch2;
    _recordSaleIndependently(newArchEntry, _currentShiftView.shopName);
    try{ stockApplySale(_currentShiftView.shopName, saleItems); }catch(e){}
    try{ logAction('JOURNAL_ENTRY_ADD_MISSED', {entryType:'sale', shopName:_currentShiftView.shopName, snapshot:newArchEntry}, _currentShiftView.id||_currentShiftView._id); }catch(e){}
    svPersist();
    _svArchiveAddMode = false;
    resetSaleForm(); closeMo('saleMo'); _renderShiftView();
    showToast('✅ Пропущенная продажа добавлена');
    return;
  }
  if(_svArchiveEditId && _currentShiftView){
    var jnlArch = _currentShiftView.journal||[];
    var idxArch = jnlArch.findIndex(function(e){ return e.id===_svArchiveEditId; });
    if(idxArch<0){ showToast('Запись не найдена'); _svArchiveEditId=null; _savingSale=false; return; }
    var beforeArch = Object.assign({}, jnlArch[idxArch]);
    var afterArch = Object.assign({}, jnlArch[idxArch], newEntryData, {type:'sale', id:jnlArch[idxArch].id, ts:jnlArch[idxArch].ts, editedAt:new Date().toISOString()});
    jnlArch[idxArch] = afterArch;
    _currentShiftView.journal = jnlArch;
    try{ logEntryEdit(beforeArch, afterArch, _currentShiftView.id||_currentShiftView._id); }catch(e){}
    svPersist();
    _svArchiveEditId = null;
    resetSaleForm(); closeMo('saleMo'); _renderShiftView();
    showToast('✅ Продажа обновлена');
    return;
  }
  if(_editSaleEntryId){
    var idx = journal.findIndex(function(e){ return e.id===_editSaleEntryId; });
    if(idx<0){ showToast('Запись не найдена'); _editSaleEntryId=null; return; }
    var before = Object.assign({}, journal[idx]);
    var after = Object.assign({}, journal[idx], newEntryData, {type:'sale', id:journal[idx].id, ts:journal[idx].ts, editedAt:new Date().toISOString()});
    journal[idx] = after;
    logEntryEdit(before, after);
    saveJ(); resetSaleForm(); closeMo('saleMo'); renderAll();
    showToast('✅ Продажа обновлена');
    return;
  }
  var _liveSaleEntry = Object.assign({id:uid(),type:'sale'}, newEntryData);
  journal.push(_liveSaleEntry);
  _recordSaleIndependently(_liveSaleEntry, session&&session.shopName);
  _backupCheckPassed = false;
  var shopType = session.shopType || getShopType(session.shopName);
  var sourceShop = '';
  if(shopType !== 'shop'){
    sourceShop = (document.getElementById('goodsSource')||{}).value || '';
  }
  try{ stockApplySale(sourceShop || (session&&session.shopName), saleItems); }catch(e){}
  if(shopType !== 'shop' && sourceShop){
    var notif = {
      id:uid(), type:'online_sale',
      fromChannel: session.shopName,
      sellerName: session.sellerName,
      sourceShop: sourceShop,
      items: [...saleItems],
      date: new Date().toISOString().split('T')[0],
      ts: _workingNowISO(),
      read: false,
      orderChannel: _onlineOrderInfo ? _onlineOrderInfo.channel : '',
      customerName: _onlineOrderInfo ? _onlineOrderInfo.customerName : '',
      recipientPhone: _onlineOrderInfo ? _onlineOrderInfo.recipientPhone : '',
      ordererPhone: _onlineOrderInfo ? _onlineOrderInfo.ordererPhone : '',
      deliveryAddress: _onlineOrderInfo ? _onlineOrderInfo.deliveryAddress : '',
      orderComment: _onlineOrderInfo ? _onlineOrderInfo.orderComment : ''
    };
    var alerts = JSON.parse(localStorage.getItem('iz_shop_notifications')||'[]');
    alerts.unshift(notif);
    localStorage.setItem('iz_shop_notifications', JSON.stringify(alerts.slice(0,100)));
    try{ db.collection('iz_shop_notifications').add(notif); }catch(e){}
  }
  saveJ(); resetSaleForm(); closeMo('saleMo'); renderAll();
  logSale(saleItems.length, paid, session.shopName);
  showToast('✅ Продажа '+fmt(paid)+' зафиксирована'+(sourceShop?' · уведомление в '+sourceShop:''));
}
