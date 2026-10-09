var _manualInvMigrationDone = false;
function migrateLegacyManualInvoices(){
  if(_manualInvMigrationDone) return;
  var all = JSON.parse(localStorage.getItem('iz_invoices')||'[]');
  var legacy = all.filter(function(i){ return i.manual; });
  if(!legacy.length){ _manualInvMigrationDone = true; return; }
  _manualInvMigrationDone = true;
  var manualList = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var existingIds = {};
  manualList.forEach(function(m){ existingIds[String(m._id!=null?m._id:m.id)]=true; });
  legacy.forEach(function(inv){
    var iid = String(inv._id!=null?inv._id:inv.id);
    if(!existingIds[iid]){
      manualList.unshift(inv);
      try{
        db.collection('iz_manual_invoices').doc(iid).set(inv).then(function(){
          try{ db.collection('iz_invoices').doc(iid).delete(); }catch(e){}
        }).catch(function(err){
          console.log('[migrateLegacyManualInvoices] перенос не удался, старую копию не трогаем:', iid, err);
        });
      }catch(e){}
    } else {
      try{ db.collection('iz_invoices').doc(iid).delete(); }catch(e){}
    }
  });
  localStorage.setItem('iz_manual_invoices', JSON.stringify(manualList));
  var remaining = all.filter(function(i){ return !i.manual; });
  localStorage.setItem('iz_invoices', JSON.stringify(remaining));
  renderInvoices(); renderReceiveArchive();
}
function migrateLegacyReceiveEntries(){
  if(!journal.length) return;
  var localShifts = [];
  try{ localShifts = getShifts(); }catch(e){}
  _reconcileReceiveEntries(_archivedReceiveInvIds(localShifts));
  try{
    db.collection('iz_shifts').where('shopName','==',session.shopName).get().then(function(snap){
      var remoteShifts = snap.docs.map(function(d){ return Object.assign({_id:d.id}, d.data()); });
      var changed = _reconcileReceiveEntries(_archivedReceiveInvIds(remoteShifts));
      if(changed) renderAll();
    }).catch(function(){});
  }catch(e){}
}
window._dupReceiveIds = [];
function checkDuplicateReceives(){
  var resEl = document.getElementById('dupCheckResult');
  if(resEl) resEl.innerHTML = '<div style="font-size:12px;color:#8888aa;padding:6px 0">⏳ Проверяю…</div>';
  db.collection('iz_shifts').where('shopName','==',session.shopName).get().then(function(snap){
    var allShifts = snap.docs.map(function(d){ return Object.assign({_id:d.id}, d.data()); });
    var closedShifts = allShifts.filter(function(s){ return s.id!==session.shiftId && !s._deleted; }); // не только закрытые — см. _archivedReceiveInvIds
    var archived = {}; // invId -> info about the closed shift it's already counted in
    closedShifts.forEach(function(s){
      (s.journal||[]).forEach(function(e){
        if(e.type==='receive' && e.invId) archived[e.invId] = {date:s.date, amount:e.amount, label:e.label};
      });
    });
    var dupes = journal.filter(function(e){ return e.type==='receive' && e.invId && archived[e.invId]; });
    var manualIds = {}; JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]').forEach(function(i){ manualIds[String(i._id!=null?i._id:i.id)]=true; });
    var autoIds = {}; getInvoices().forEach(function(i){ autoIds[String(i._id!=null?i._id:i.id)]=true; });
    var orphans = journal.filter(function(e){
      if(e.type!=='receive' || !e.invId) return false;
      if(archived[e.invId]) return false; // already counted as a cross-shift dupe above
      return !manualIds[e.invId] && !autoIds[e.invId];
    });
    if(!dupes.length && !orphans.length){
      if(resEl) resEl.innerHTML = '<div style="font-size:12px;color:#60f090;padding:6px 0">✅ Задвоений не найдено — текущая смена чистая</div>';
      window._dupReceiveIds = [];
      return;
    }
    var total = dupes.reduce(function(s,e){ return s+(e.amount||0); },0);
    var listHtml = dupes.map(function(e){
      var info = archived[e.invId] || {};
      return '<div style="font-size:12px;padding:5px 0;border-bottom:1px solid #2e2e3e">'+
        '<b>'+(e.label||'Приёмка')+'</b> — '+Math.round(e.amount||0).toLocaleString('ru-RU')+'₽'+
        '<br><span style="color:#8888aa">уже учтена в закрытой смене от '+(info.date||'?')+'</span>'+
      '</div>';
    }).join('');
    var orphanTotal = orphans.reduce(function(s,e){ return s+(e.amount||0); },0);
    var orphanHtml = orphans.map(function(e){
      return '<div style="font-size:12px;padding:5px 0;border-bottom:1px solid #2e2e3e">'+
        '<b>'+(e.label||'Приёмка')+'</b> — '+Math.round(e.amount||0).toLocaleString('ru-RU')+'₽'+
        '<br><span style="color:#8888aa">накладная удалена, но запись осталась в журнале</span>'+
      '</div>';
    }).join('');
    if(resEl) resEl.innerHTML =
      (dupes.length ? '<div style="font-size:12px;color:#f0a060;margin-bottom:4px;font-weight:700">⚠️ Найдено '+dupes.length+' задвоенных записей на '+Math.round(total).toLocaleString('ru-RU')+'₽:</div>'+listHtml : '')+
      (orphans.length ? '<div style="font-size:12px;color:#f0a060;margin:8px 0 4px;font-weight:700">⚠️ Найдено '+orphans.length+' записей от удалённых накладных на '+Math.round(orphanTotal).toLocaleString('ru-RU')+'₽:</div>'+orphanHtml : '')+
      '<button onclick="removeDuplicateReceives()" style="margin-top:8px;width:100%;padding:9px;border-radius:8px;border:none;background:#f06060;color:#fff;font-size:12px;font-weight:700;cursor:pointer">🗑 Убрать из текущей смены</button>'+
      (dupes.length ? '<div style="font-size:10px;color:#8888aa;margin-top:4px">Сами накладные и их учёт в смене от '+(closedShifts[0]?closedShifts[0].date:'')+' не удаляются — убирается только повторная запись в сегодняшней смене.</div>' : '');
    window._dupReceiveIds = dupes.concat(orphans).map(function(e){ return e.id; });
  }).catch(function(err){
    if(resEl) resEl.innerHTML = '<div style="font-size:12px;color:#f06060;padding:6px 0">⛔ Не удалось проверить (нет сети?). Попробуйте ещё раз.</div>';
  });
}
function removeDuplicateReceives(){
  var ids = window._dupReceiveIds||[];
  if(!ids.length) return;
  if(!confirm('Убрать '+ids.length+' записей (задвоения и/или записи от удалённых накладных) из текущей смены?')) return;
  var toRemove = journal.filter(function(e){ return ids.indexOf(e.id)>=0; });
  toRemove.forEach(function(entry){
    try{ logEntryDelete(entry); }catch(e){}
    addToTrash(entry, {reason:'duplicate_receive_cleanup'});
  });
  journal = journal.filter(function(e){ return ids.indexOf(e.id)<0; });
  saveJ();
  try{ syncLiveShift(); }catch(e){}
  renderAll();
  window._dupReceiveIds = [];
  var resEl = document.getElementById('dupCheckResult');
  if(resEl) resEl.innerHTML = '<div style="font-size:12px;color:#60f090;padding:6px 0">✅ Убрано из текущей смены</div>';
  showToast('✅ Задвоения убраны');
}
function migrateLegacyDrExpenses(){
  if(!journal.length) return;
  var changed = false;
  journal.forEach(function(e){
    if(e.type==='expense' && e.goodsType==='dr' && e.cashEffect && !e.cashDrEffect){
      e.cashDrEffect = e.cashEffect;
      e.cashEffect = 0;
      changed = true;
    }
  });
  if(changed) saveJ();
}
function migrateOrphanItemNamesToGoods(){
  if(localStorage.getItem('iz_orphan_names_migrated_v1')) return; // разовая миграция, не гонять при каждом входе
  var items = getItemsBase();
  if(!items.length) return;
  var goods = getRefBook('iz_goods');
  var goodsNames = {};
  goods.forEach(function(g){ var n=(g&&g.name)||g; if(n) goodsNames[n]=true; });
  var goodsTombsM = JSON.parse(localStorage.getItem('iz_goods_deleted')||'[]');
  var added = 0;
  items.forEach(function(it){
    var n = it && it.name && it.name.trim();
    if(n && !goodsNames[n] && goodsTombsM.indexOf(n.toLowerCase())<0){
      goods.push({id:uid(), name:n});
      goodsNames[n] = true;
      added++;
    }
  });
  if(added) saveRefBookShop('iz_goods', goods);
  localStorage.setItem('iz_orphan_names_migrated_v1','1');
}
function renderAdminInvoices(){
  var c = document.getElementById('adminInvoicesList'); if(!c) return;
  var manual = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var incoming = JSON.parse(localStorage.getItem('iz_invoices')||'[]');
  var all = manual.concat(incoming.filter(function(inv){
    return !manual.some(function(m){ return m.id===inv.id; });
  }));
  all.sort(function(a,b){ return (b.acceptedAt||b.date||'').localeCompare(a.acceptedAt||a.date||''); });
  if(!all.length){ c.innerHTML='<div class="empty"><div class="ei">📦</div>Накладных нет</div>'; return; }
  c.innerHTML = all.map(function(inv){
    var itemsStr = (inv.items||[]).map(function(it){ return (it.name||'')+(it.qty&&it.qty!==1?' × '+it.qty:'')+(it.price?' · '+fmt(it.price):''); }).join(', ');
    var total = inv.totalAmt || (inv.items||[]).reduce(function(s,it){ return s+(it.qty||1)*(it.price||0); },0);
    return '<div style="background:#1a1a22;border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:8px" id="ainv_'+inv.id+'">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">' +
        '<div>' +
          '<div class="u-fs13-bold">'+(inv.num||'—')+'</div>' +
          '<div style="font-size:11px;color:var(--t2)">'+(inv.date||'')+' · '+(inv.from||inv.destName||'')+'</div>' +
          '<div style="font-size:11px;color:var(--t2);margin-top:2px">'+itemsStr+'</div>' +
        '</div>' +
        '<div style="font-size:13px;font-weight:700;color:var(--accent)">'+fmt(total)+'</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;margin-top:8px">' +
        '<button onclick="adminEditInvoice(\''+inv.id+'\')" style="flex:1;padding:7px;border-radius:8px;border:1px solid var(--border);background:var(--s2);color:var(--accent);font-size:11px;cursor:pointer">✏️ Исправить</button>' +
        '<button onclick="adminDeleteInvoice(\''+inv.id+'\')" style="padding:7px 12px;border-radius:8px;border:1px solid #3e2020;background:#2a1010;color:#f06060;font-size:11px;cursor:pointer">🗑 Удалить</button>' +
      '</div>' +
    '</div>';
  }).join('');
}
function adminDeleteInvoice(id){
  if(!confirm('Удалить накладную? Это действие нельзя отменить.')) return;
  var manual = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  manual = manual.filter(function(inv){ return inv.id !== id; });
  localStorage.setItem('iz_manual_invoices', JSON.stringify(manual));
  var incoming = JSON.parse(localStorage.getItem('iz_invoices')||'[]');
  incoming = incoming.filter(function(inv){ return inv.id !== id; });
  localStorage.setItem('iz_invoices', JSON.stringify(incoming));
  try{ db.collection('iz_invoices').doc(id).delete(); }catch(e){}
  renderAdminInvoices();
  showToast('✅ Накладная удалена');
}
function adminEditInvoice(id){
  var manual = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var incoming = JSON.parse(localStorage.getItem('iz_invoices')||'[]');
  var inv = manual.find(function(i){ return i.id===id; }) || incoming.find(function(i){ return i.id===id; });
  if(!inv) return;
  var card = document.getElementById('ainv_'+id); if(!card) return;
  var itemsHtml = (inv.items||[]).map(function(item,i){
    return '<div style="display:flex;gap:5px;margin-bottom:5px;align-items:center">' +
      '<input class="fi" value="'+(item.name||'')+'" placeholder="Наименование" style="flex:2;margin:0;padding:6px;font-size:12px" onchange="_aie_name(\''+id+'\','+i+',this.value)">' +
      '<input class="fi" type="text" inputmode="numeric" value="'+(item.qty||1)+'" style="flex:0 0 45px;margin:0;padding:6px;font-size:12px;text-align:center" onchange="_aie_qty(\''+id+'\','+i+',this.value)">' +
      '<input class="fi" type="text" inputmode="numeric" value="'+(item.price||0)+'" style="flex:1;margin:0;padding:6px;font-size:12px;text-align:center" onchange="_aie_price(\''+id+'\','+i+',this.value)">' +
    '</div>';
  }).join('');
  card.innerHTML = '<div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:8px">✏️ Редактировать: '+(inv.num||'')+'</div>' +
    '<div class="fg" style="margin-bottom:6px"><label class="fl">Номер</label><input class="fi" id="aie_num_'+id+'" value="'+(inv.num||'')+'" style="margin:0;padding:7px"></div>' +
    '<div class="fg" style="margin-bottom:6px"><label class="fl">Дата</label><input class="fi" type="date" id="aie_date_'+id+'" value="'+(inv.date||'')+'" style="margin:0;padding:7px;color-scheme:dark"></div>' +
    '<div class="fg" style="margin-bottom:6px"><label class="fl">Откуда</label><input class="fi" id="aie_from_'+id+'" value="'+(inv.from||'')+'" style="margin:0;padding:7px"></div>' +
    '<div style="font-size:10px;color:var(--t2);margin-bottom:4px">ПОЗИЦИИ (наим. · кол-во · цена)</div>' +
    itemsHtml +
    '<div style="display:flex;gap:6px;margin-top:8px">' +
      '<button onclick="adminSaveInvoice(\''+id+'\')" style="flex:1;padding:8px;border-radius:8px;border:none;background:var(--accent);color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer">💾 Сохранить</button>' +
      '<button onclick="renderAdminInvoices()" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:none;color:var(--t2);font-size:12px;cursor:pointer">Отмена</button>' +
    '</div>';
  window._aie_data = window._aie_data || {};
  window._aie_data[id] = JSON.parse(JSON.stringify(inv));
}
function _aie_name(id,i,v){ if(window._aie_data&&window._aie_data[id]&&window._aie_data[id].items[i]) window._aie_data[id].items[i].name=v; }
function _aie_qty(id,i,v){ if(window._aie_data&&window._aie_data[id]&&window._aie_data[id].items[i]) window._aie_data[id].items[i].qty=parseFloat(v)||1; }
function _aie_price(id,i,v){ if(window._aie_data&&window._aie_data[id]&&window._aie_data[id].items[i]) window._aie_data[id].items[i].price=parseFloat(v)||0; }
function adminSaveInvoice(id){
  var data = window._aie_data && window._aie_data[id]; if(!data) return;
  data.num = (document.getElementById('aie_num_'+id)||{}).value || data.num;
  data.date = (document.getElementById('aie_date_'+id)||{}).value || data.date;
  data.from = (document.getElementById('aie_from_'+id)||{}).value || data.from;
  data.totalAmt = (data.items||[]).reduce(function(s,it){ return s+(it.qty||1)*(it.price||0); },0);
  data.editedAt = new Date().toISOString();
  data.editedBy = session ? (session.name||session.sellerName||'') : 'admin';
  var manual = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var mi = manual.findIndex(function(i){ return i.id===id; });
  if(mi>=0) manual[mi]=data; else manual.unshift(data);
  localStorage.setItem('iz_manual_invoices', JSON.stringify(manual));
  try{ db.collection('iz_invoices').doc(id).set(data,{merge:true}); }catch(e){}
  if(window._aie_data) delete window._aie_data[id];
  renderAdminInvoices();
  showToast('✅ Накладная сохранена');
}
var _woItemGoodsType = 'derevo';
function setWoItemType(type){
  _woItemGoodsType = type;
  var bD=document.getElementById('woTypeDerevo'), bDr=document.getElementById('woTypeDr');
  if(!bD||!bDr) return;
  if(type==='derevo'){
    bD.style.border='2px solid #c8f060'; bD.style.background='#1e2a14'; bD.style.color='#c8f060'; bD.style.fontWeight='700';
    bDr.style.border='1px solid #2e2e3e'; bDr.style.background='#22222e'; bDr.style.color='#8888aa'; bDr.style.fontWeight='600';
  } else {
    bDr.style.border='2px solid #a060f0'; bDr.style.background='#1e1a2e'; bDr.style.color='#a060f0'; bDr.style.fontWeight='700';
    bD.style.border='1px solid #2e2e3e'; bD.style.background='#22222e'; bD.style.color='#8888aa'; bD.style.fontWeight='600';
  }
}
function woPickName(val){ var el=document.getElementById('woName'); if(el) el.value=val; var box=document.getElementById('woName_sugg'); if(box) box.style.display='none'; }
function woPickSpecies(val){ var el=document.getElementById('woSpecies'); if(el) el.value=val; var box=document.getElementById('woSpecies_sugg'); if(box) box.style.display='none'; }
function lookupWoItem(num){
  if(!num.trim()) return;
  // Сначала — наличие на складе своего магазина: списывают то, что лежит на полке.
  var st = (typeof stockGetByNum==='function') ? stockGetByNum(session&&session.shopName, num.trim()) : null;
  if(st && (st.qty||0)>0){
    var nEl=document.getElementById('woName'), pEl=document.getElementById('woPrice'), sEl=document.getElementById('woSpecies');
    if(nEl) nEl.value = st.name||''; if(pEl) pEl.value = st.price||''; if(sEl) sEl.value = st.species||'';
    setWoItemType(st.goodsType==='dr'?'dr':'derevo');
    woCalcAmt();
    return;
  }
  var items = JSON.parse(localStorage.getItem('iz_items')||'[]');
  var found = items.find(function(i){ return String(i.num)===num.trim(); });
  if(found){
    var nameEl=document.getElementById('woName'), priceEl=document.getElementById('woPrice'), spEl=document.getElementById('woSpecies');
    if(nameEl) nameEl.value = found.name||'';
    if(priceEl) priceEl.value = found.price||'';
    if(spEl) spEl.value = found.species||'';
    if(found.category==='dr') setWoItemType('dr'); else setWoItemType('derevo');
    woCalcAmt();
  }
}
// Подсказки «из наличия» в списании продавца: склад своего магазина (📦) + каталог (📚).
var _woSuggMatches = [];
function woStockSugg(field, val){
  var inputId = field==='num' ? 'woNum' : 'woName';
  var box = document.getElementById(inputId+'_sugg'); if(!box) return;
  if(typeof _psjCancelHideSugg==='function') _psjCancelHideSugg(inputId);
  _woSuggMatches = _stockCatalogMatches(session&&session.shopName, null, field, val);
  if(!_woSuggMatches.length){ box.style.display='none'; box.innerHTML=''; return; }
  box.innerHTML = _woSuggMatches.map(function(m,k){
    return '<div onclick="woStockPick('+k+',\''+inputId+'\')" style="padding:8px 10px;font-size:12px;color:#f0f0f8;border-bottom:1px solid #2e2e3e;cursor:pointer">'+_stockMatchLabel(m)+'</div>';
  }).join('');
  box.style.display='block';
}
function woStockPick(k, inputId){
  var m = _woSuggMatches[k]; if(!m) return;
  var set = function(id, v){ var el=document.getElementById(id); if(el) el.value = v; };
  if(m.num) set('woNum', m.num);
  set('woName', m.name);
  if(m.species) set('woSpecies', m.species);
  if(m.price) set('woPrice', m.price);
  setWoItemType(m.gt==='dr'?'dr':'derevo');
  woCalcAmt();
  var box = document.getElementById(inputId+'_sugg'); if(box) box.style.display='none';
}
function woCalcAmt(){
  var price=parseFloat(gv('woPrice'))||0, qty=parseFloat(gv('woQty'))||1;
  var amtEl=document.getElementById('woAmt'); if(amtEl) amtEl.value = (price*qty)||'';
}
function woCalcFromAmt(){
  var amt=parseFloat(gv('woAmt'))||0, qty=parseFloat(gv('woQty'))||1;
  var priceEl=document.getElementById('woPrice'); if(priceEl && qty>0) priceEl.value = (amt/qty)||'';
}
var woItems = [];
function _woDraftKey(){ return 'iz_wo_draft_'+(session&&session.shopName||''); }
function saveWoDraft(){
  if(!session) return;
  var reason = gv('woReason')||'';
  if(!woItems.length && !reason){ localStorage.removeItem(_woDraftKey()); return; }
  localStorage.setItem(_woDraftKey(), JSON.stringify({reason:reason, items:woItems}));
}
function loadWoDraft(){
  try{
    var raw = localStorage.getItem(_woDraftKey());
    if(!raw) return false;
    var d = JSON.parse(raw);
    if(!d) return false;
    woItems = d.items||[];
    var rEl=document.getElementById('woReason'); if(rEl&&d.reason) rEl.value=d.reason;
    return woItems.length>0||!!d.reason;
  }catch(e){ return false; }
}
function clearWoDraft(){ localStorage.removeItem(_woDraftKey()); }
function discardWoDraft(){
  if(!confirm('Удалить черновик списания? Все добавленные позиции будут потеряны.')) return;
  clearWoDraft(); woItems=[];
  var rEl=document.getElementById('woReason'); if(rEl) rEl.value='';
  renderWoItems();
  var b=document.getElementById('woDraftBanner'); if(b) b.style.display='none';
}
function addWoItem(){
  const name=(gv('woName')||'').trim();
  const reason=(gv('woReason')||'').trim();
  const amt=parseFloat(gv('woAmt'))||0;
  if(!reason){ showToast('Укажите причину списания (сверху формы)'); return; }
  if(!name){ showToast('Введите наименование'); return; }
  if(!amt){ showToast('Введите сумму'); return; }
  const isDr = _woItemGoodsType==='dr';
  const species=(gv('woSpecies')||'').trim();
  const price=parseFloat(gv('woPrice'))||0;
  const qty=parseFloat(gv('woQty'))||1;
  const num=(gv('woNum')||'').trim();
  woItems.push({id:uid(), num, name, species, price, qty, amt, reason, goodsType: isDr?'dr':'derevo'});
  ['woNum','woName','woSpecies','woAmt'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  var qtyEl=document.getElementById('woQty'); if(qtyEl) qtyEl.value='';
  var priceEl=document.getElementById('woPrice'); if(priceEl) priceEl.value='';
  setWoItemType('derevo');
  saveWoDraft();
  renderWoItems();
}
function removeWoItem(i){
  woItems.splice(i,1);
  saveWoDraft();
  renderWoItems();
}
function renderWoItems(){
  var c=document.getElementById('woItemsDisplay');
  var totalEl=document.getElementById('woTotalDisplay'), totalAmtEl=document.getElementById('woTotalAmt');
  if(!c) return;
  if(!woItems.length){
    c.innerHTML='';
    if(totalEl) totalEl.style.display='none';
    return;
  }
  c.innerHTML=woItems.map(function(it,i){
    var typeBadge = it.goodsType==='dr'
      ? '<span style="font-size:10px;padding:1px 6px;border-radius:6px;background:#1e1a2e;color:#a060f0">🛍 ДР</span>'
      : '<span style="font-size:10px;padding:1px 6px;border-radius:6px;background:#1e2a14;color:#c8f060">🌳 Дерево</span>';
    var priceLine = (it.qty&&it.qty!==1) ? (fmt(it.price)+' × '+it.qty+' = '+fmt(it.amt)) : fmt(it.amt);
    return '<div class="sir" style="border-color:#f06060;background:#22222e">'+
      '<div class="sir-num" style="color:#8888aa">'+(it.num||'—')+'</div>'+
      '<div class="sir-info"><div class="sir-name">'+it.name+(it.species?' <span style="color:#f0c060;font-size:11px">· '+it.species+'</span>':'')+' '+typeBadge+'</div>'+
        '<div class="sir-price" style="color:#f06060">'+priceLine+'</div>'+
        '<div style="font-size:11px;color:#8888aa;margin-top:2px">'+it.reason+'</div>'+
      '</div>'+
      '<div style="display:flex;gap:4px;flex-shrink:0">'+
        '<button class="sir-del" onpointerdown="event.preventDefault();_woCopyItem('+i+')" style="background:#1a2a1e;border-color:#60f090;color:#60f090;font-size:10px">📋</button>'+
        '<button class="sir-del" onclick="removeWoItem('+i+')">✕</button>'+
      '</div>'+
    '</div>';
  }).join('');
  var total = woItems.reduce(function(s,it){ return s+(it.amt||0); },0);
  if(totalEl){ totalEl.style.display='flex'; }
  if(totalAmtEl) totalAmtEl.textContent = fmt(total);
}
function _woCopyItem(i){
  var src = woItems[i];
  var nameEl=document.getElementById('woName');
  var specEl=document.getElementById('woSpecies');
  var priceEl=document.getElementById('woPrice');
  var qtyEl=document.getElementById('woQty');
  var amtEl=document.getElementById('woAmt');
  if(nameEl) nameEl.value=src.name||'';
  if(specEl) specEl.value=src.species||'';
  if(priceEl) priceEl.value=src.price||'';
  if(qtyEl) qtyEl.value=src.qty&&src.qty!==1?src.qty:'';
  if(amtEl) amtEl.value='';
  setWoItemType(src.goodsType==='dr'?'dr':'derevo');
  setTimeout(function(){ var f=document.getElementById('woQty');if(f)f.focus(); },100);
  showToast('📋 Поля скопированы — измените нужное и добавьте');
}
function resetWoForm(){
  woItems=[];
  ['woNum','woName','woSpecies','woAmt','woReason'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  var qtyEl=document.getElementById('woQty'); if(qtyEl) qtyEl.value='';
  var priceEl=document.getElementById('woPrice'); if(priceEl) priceEl.value='';
  var _wr=document.getElementById('woReval'); if(_wr) _wr.checked=false;
  setWoItemType('derevo');
  renderWoItems();
}
function openWoModal(){
  var hasDraft = !woItems.length ? loadWoDraft() : true;
  var banner = document.getElementById('woDraftBanner');
  if(banner) banner.style.display = hasDraft && woItems.length ? 'flex' : 'none';
  if(!hasDraft) resetWoForm();
  else renderWoItems();
  openMo('woMo');
}
var _savingWriteoff = false;
function saveWriteoff(){
  if(_savingWriteoff) return; // guards against double-tap / double-submit creating duplicate записи
  _savingWriteoff = true;
  setTimeout(function(){ _savingWriteoff = false; }, 1500);
  var hasPendingFields = (gv('woName')||'').trim() || (gv('woAmt')||'').trim();
  if(hasPendingFields){
    addWoItem();
    if(!woItems.length) return; // addWoItem already showed a validation toast
  }
  if(!woItems.length){ showToast('Добавьте хотя бы одну позицию'); return; }
  var groups = []; // [{reason, goodsType, items:[...]}]
  woItems.forEach(function(it){
    var isDr = it.goodsType==='dr';
    var g = groups.find(function(g){ return g.reason===it.reason && g.isDr===isDr; });
    if(!g){ g={reason:it.reason, isDr:isDr, items:[]}; groups.push(g); }
    g.items.push(it);
  });
  var baseTs = Date.now();
  var isReval = !!(document.getElementById('woReval')||{}).checked;
  groups.forEach(function(g, idx){
    if(isReval) g.items.forEach(function(it){ it.isRevaluation = true; });
    var total = g.items.reduce(function(s,it){ return s+(it.amt||0); },0);
    var totalQty = g.items.reduce(function(s,it){ return s+(it.qty||1); },0);
    var ts = new Date(baseTs+idx).toISOString();
    var namesPreview = g.items.map(function(it){ return it.name; }).join(', ');
    var sub = g.items.length===1
      ? ((g.items[0].num?'№'+g.items[0].num+' ':'')+g.items[0].name+(g.items[0].species?' · '+g.items[0].species:'')+(g.items[0].qty&&g.items[0].qty!==1?' × '+g.items[0].qty:'')+' · '+g.reason)
      : (g.items.length+' позиций ('+totalQty+' шт.): '+namesPreview+' · '+g.reason);
    var entry = {id:uid(),type:'writeoff',ts:ts,icon:'🗑️',label:(isReval?'🔄 ПЕРЕОЦЕНКА · ':'')+'Списание',
      sub:sub,
      goodsType: g.isDr?'dr':'derevo', items: g.items,
      amount:total,amtCls:'exp',amtSign:'−',cashEffect:0,cardEffect:0,staffEffect:0,
      goodsEffect: g.isDr?0:-total, goodsDrEffect: g.isDr?-total:0};
    if(isReval) entry.isRevaluation = true;
    journal.push(entry);
    _recordJournalEntryIndependently(entry, session&&session.shopName, 'writeoff');
    _backupCheckPassed = false;
    g.items.forEach(function(it){ logWriteoff(it.reason, it.amt, session.shopName); });
    if(isReval){ try{ logAction('REVALUATION', {direction:'writeoff', goodsType:g.isDr?'dr':'derevo', itemCount:g.items.length, names:namesPreview, amount:total, reason:g.reason, shop:session&&session.shopName}); }catch(e){} }
  });
  var total = woItems.reduce(function(s,it){ return s+(it.amt||0); },0);
  var count = woItems.length;
  // Переоценка — тот же физический товар с новой ценой: количество на складе не меняем
  // (как у прихода-переоценки, у которого qty тоже 0), иначе изделие «пропадало» со склада.
  try{ if(!isReval) stockApplyWriteoff(session&&session.shopName, woItems); }catch(e){}
  saveJ(); clearWoDraft(); resetWoForm();
  closeMo('woMo'); renderAll();
  showToast((isReval?'🔄 Переоценка: списано ':'🗑️ Списано ')+count+(count===1?' позиция':' позиций')+' на '+fmt(total));
}
var _retItemGoodsType = 'derevo';
var returnItems = [];
var _returnRefundMethod = 'cash';
function setReturnItemType(type){
  _retItemGoodsType = type;
  var bD=document.getElementById('retTypeDerevo'), bDr=document.getElementById('retTypeDr');
  if(!bD||!bDr) return;
  if(type==='derevo'){
    bD.style.border='2px solid #c8f060'; bD.style.background='#1e2a14'; bD.style.color='#c8f060'; bD.style.fontWeight='700';
    bDr.style.border='1px solid #2e2e3e'; bDr.style.background='#22222e'; bDr.style.color='#8888aa'; bDr.style.fontWeight='600';
  } else {
    bDr.style.border='2px solid #a060f0'; bDr.style.background='#1e1a2e'; bDr.style.color='#a060f0'; bDr.style.fontWeight='700';
    bD.style.border='1px solid #2e2e3e'; bD.style.background='#22222e'; bD.style.color='#8888aa'; bD.style.fontWeight='600';
  }
}
function retPickName(val){ var el=document.getElementById('retName'); if(el) el.value=val; var box=document.getElementById('retName_sugg'); if(box) box.style.display='none'; }
function retPickSpecies(val){ var el=document.getElementById('retSpecies'); if(el) el.value=val; var box=document.getElementById('retSpecies_sugg'); if(box) box.style.display='none'; }
function lookupReturnItem(num){
  if(!num.trim()) return;
  var items = JSON.parse(localStorage.getItem('iz_items')||'[]');
  var found = items.find(function(i){ return String(i.num)===num.trim(); });
  if(found){
    var nameEl=document.getElementById('retName'), priceEl=document.getElementById('retPrice'), spEl=document.getElementById('retSpecies');
    if(nameEl) nameEl.value = found.name||'';
    if(priceEl) priceEl.value = found.price||'';
    if(spEl) spEl.value = found.species||'';
    if(found.category==='dr') setReturnItemType('dr'); else setReturnItemType('derevo');
    retCalcAmt();
  }
}
function retCalcAmt(){
  var price=parseFloat(gv('retPrice'))||0, qty=parseFloat(gv('retQty'))||1;
  var amtEl=document.getElementById('retAmt'); if(amtEl) amtEl.value = (price*qty)||'';
}
function retCalcFromAmt(){
  var amt=parseFloat(gv('retAmt'))||0, qty=parseFloat(gv('retQty'))||1;
  var priceEl=document.getElementById('retPrice'); if(priceEl && qty>0) priceEl.value = (amt/qty)||'';
}
function addReturnItem(){
  const name=(gv('retName')||'').trim();
  const amt=parseFloat(gv('retAmt'))||0;
  if(!name){ showToast('Введите наименование'); return; }
  if(!amt){ showToast('Введите сумму'); return; }
  const isDr = _retItemGoodsType==='dr';
  const species=(gv('retSpecies')||'').trim();
  const price=parseFloat(gv('retPrice'))||0;
  const qty=parseFloat(gv('retQty'))||1;
  const num=(gv('retNum')||'').trim();
  returnItems.push({id:uid(), num, name, species, price, qty, amt, goodsType: isDr?'dr':'derevo'});
  ['retNum','retName','retSpecies','retAmt'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  var qtyEl=document.getElementById('retQty'); if(qtyEl) qtyEl.value='';
  var priceEl=document.getElementById('retPrice'); if(priceEl) priceEl.value='';
  setReturnItemType('derevo');
  renderReturnItems();
}
function removeReturnItem(i){
  returnItems.splice(i,1);
  renderReturnItems();
}
function renderReturnItems(){
  var c=document.getElementById('retItemsDisplay');
  var totalEl=document.getElementById('retTotalDisplay'), totalAmtEl=document.getElementById('retTotalAmt');
  if(!c) return;
  if(!returnItems.length){
    c.innerHTML='';
    if(totalEl) totalEl.style.display='none';
    return;
  }
  c.innerHTML=returnItems.map(function(it,i){
    var typeBadge = it.goodsType==='dr'
      ? '<span style="font-size:10px;padding:1px 6px;border-radius:6px;background:#1e1a2e;color:#a060f0">🛍 ДР</span>'
      : '<span style="font-size:10px;padding:1px 6px;border-radius:6px;background:#1e2a14;color:#c8f060">🌳 Дерево</span>';
    var priceLine = (it.qty&&it.qty!==1) ? (fmt(it.price)+' × '+it.qty+' = '+fmt(it.amt)) : fmt(it.amt);
    return '<div class="sir" style="border-color:#60c8f0;background:#22222e">'+
      '<div class="sir-num" style="color:#8888aa">'+(it.num||'—')+'</div>'+
      '<div class="sir-info"><div class="sir-name">'+it.name+(it.species?' <span style="color:#f0c060;font-size:11px">· '+it.species+'</span>':'')+' '+typeBadge+'</div>'+
        '<div class="sir-price" style="color:#60c8f0">'+priceLine+'</div>'+
      '</div>'+
      '<div style="display:flex;gap:4px;flex-shrink:0">'+
        '<button class="sir-del" onclick="removeReturnItem('+i+')">✕</button>'+
      '</div>'+
    '</div>';
  }).join('');
  var total = returnItems.reduce(function(s,it){ return s+(it.amt||0); },0);
  if(totalEl){ totalEl.style.display='flex'; }
  if(totalAmtEl) totalAmtEl.textContent = fmt(total);
}
function setReturnRefundMethod(m, el){
  _returnRefundMethod = m;
  document.querySelectorAll('#retMo .pc').forEach(function(p){ p.classList.remove('active'); });
  if(el) el.classList.add('active');
}
function resetReturnForm(){
  returnItems=[];
  ['retNum','retName','retSpecies','retAmt','retReason'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  var qtyEl=document.getElementById('retQty'); if(qtyEl) qtyEl.value='';
  var priceEl=document.getElementById('retPrice'); if(priceEl) priceEl.value='';
  setReturnItemType('derevo');
  _returnRefundMethod='cash';
  document.querySelectorAll('#retMo .pc').forEach(function(p){ p.classList.remove('active'); });
  var cashChip=document.getElementById('retPcCash'); if(cashChip) cashChip.classList.add('active');
  var otherShiftEl=document.getElementById('retOtherShift'); if(otherShiftEl) otherShiftEl.checked=false;
  renderReturnItems();
}
function openReturnMo(){
  resetReturnForm();
  openMo('retMo');
}
function stockApplyReturn(shopName, items){
  if(!shopName) return;
  items.forEach(function(it){
    var artNum = it.num || it.article;
    if(!artNum) artNum = _noArticleStockKey(it.name, it.price, it.species, it.goodsType);
    if(!artNum) return;
    stockUpdateQty(shopName, artNum, it.name, it.price, it.species, it.goodsType, it.size||'', (it.qty||1), null);
  });
}
var _savingReturn = false;
function saveReturn(){
  if(_savingReturn) return; // guards against double-tap / double-submit creating duplicate записи
  _savingReturn = true;
  setTimeout(function(){ _savingReturn = false; }, 1500);
  var hasPendingFields = (gv('retName')||'').trim() || (gv('retAmt')||'').trim();
  if(hasPendingFields){
    addReturnItem();
    if(!returnItems.length) return;
  }
  if(!returnItems.length){ showToast('Добавьте хотя бы одну позицию'); return; }
  var reason = (gv('retReason')||'').trim();
  if(!reason){ showToast('Укажите причину возврата'); return; }
  var totalWood = returnItems.filter(function(it){ return it.goodsType!=='dr'; }).reduce(function(s,it){ return s+(it.amt||0); },0);
  var totalDr = returnItems.filter(function(it){ return it.goodsType==='dr'; }).reduce(function(s,it){ return s+(it.amt||0); },0);
  var total = totalWood+totalDr;
  var isCash = _returnRefundMethod==='cash';
  var namesPreview = returnItems.map(function(it){ return it.name; }).join(', ');
  var sub = returnItems.length===1
    ? ((returnItems[0].num?'№'+returnItems[0].num+' ':'')+returnItems[0].name+(returnItems[0].species?' · '+returnItems[0].species:'')+(returnItems[0].qty&&returnItems[0].qty!==1?' × '+returnItems[0].qty:'')+' · '+reason)
    : (returnItems.length+' позиций: '+namesPreview+' · '+reason);
  var payLabels = {cash:'💵 Нал',terminal:'💳 Терминал',sbp:'📱 СБП',transfer:'🏦 Перевод'};
  var isOtherShift = !!(document.getElementById('retOtherShift')||{}).checked;
  var entry = {id:uid(), type:'return', ts:_workingNowISO(), icon:'↩️', label:'Возврат',
    sub:sub+' · возврат '+(payLabels[_returnRefundMethod]||_returnRefundMethod)+(isOtherShift?' · продажа из другой смены':''),
    items: returnItems, reason: reason, refundMethod: _returnRefundMethod, excludeFromRevenue: isOtherShift,
    goodsType: (totalWood&&totalDr)?'mixed':(totalDr?'dr':'derevo'),
    amount: total, amtCls:'exp', amtSign:'−', staffEffect:0,
    cashEffect: isCash?-totalWood:0, cardEffect: isCash?0:-totalWood,
    cashDrEffect: isCash?-totalDr:0, cardDrEffect: isCash?0:-totalDr,
    goodsEffect: totalWood, goodsDrEffect: totalDr};
  journal.push(entry);
  try{ _recordJournalEntryIndependently(entry, session&&session.shopName, 'return'); }catch(e){}
  _backupCheckPassed = false;
  try{ stockApplyReturn(session&&session.shopName, returnItems); }catch(e){}
  logAction('RETURN', {reason:reason, amount:total, refundMethod:_returnRefundMethod, itemCount:returnItems.length, excludeFromRevenue:isOtherShift, shop:session&&session.shopName});
  saveJ(); resetReturnForm();
  closeMo('retMo'); renderAll();
  showToast('↩️ Возврат оформлен на '+fmt(total));
}
var _rcvGoodsType = 'derevo';
function setRcvGoodsType(type, el){
  _rcvGoodsType = type;
  var btnD = document.getElementById('rcvTypeDerevo');
  var btnDr = document.getElementById('rcvTypeDr');
  if(btnD){ btnD.style.borderColor = type==='derevo'?'#c8f060':'#2e2e3e'; btnD.style.background = type==='derevo'?'#1e2a14':'#22222e'; btnD.style.color = type==='derevo'?'#c8f060':'#8888aa'; }
  if(btnDr){ btnDr.style.borderColor = type==='dr'?'#a060f0':'#2e2e3e'; btnDr.style.background = type==='dr'?'#1e1a2e':'#22222e'; btnDr.style.color = type==='dr'?'#a060f0':'#8888aa'; }
}
function lookupReceiveItem(num){
  var hint = document.getElementById('rcvLookupHint');
  if(!num.trim()){ if(hint) hint.style.display='none'; return; }
  var items = JSON.parse(localStorage.getItem('iz_items')||'[]');
  var found = items.find(function(i){ return String(i.num)===num.trim(); });
  if(found){
    var nameEl=document.getElementById('rcvName'), priceEl=document.getElementById('rcvPrice');
    if(nameEl && !nameEl.value) nameEl.value = found.name||'';
    if(priceEl && !priceEl.value) priceEl.value = found.price||'';
    if(hint){
      hint.style.display='block';
      hint.innerHTML='✅ <strong>'+found.name+'</strong>'+(found.price?' · '+Math.round(found.price).toLocaleString('ru-RU')+'₽':'')+(found.status?' · '+found.status:'');
    }
  } else {
    if(hint){ hint.style.display='block'; hint.innerHTML='<span style="color:#8888aa">Артикул не найден — заполните вручную</span>'; }
  }
}
var _savingReceive = false;
function saveReceive(){
  var name=gv('rcvName'),price=parseFloat(gv('rcvPrice'))||0;
  if(!name){showToast('Введите наименование');return;} if(!price){showToast('Введите цену');return;}
  if(_savingReceive) return; // guards against double-tap / double-submit creating duplicate записи
  _savingReceive = true;
  setTimeout(function(){ _savingReceive = false; }, 1500);
  var article=gv('rcvArticle');
  var rcvQtyNum=parseFloat(gv('rcvQty'))||1;
  var isDr = _rcvGoodsType === 'dr';
  // «Это переоценка» — как у админа в карточке смены: пометка в истории, а на складе количество не растёт
  // (переоценка правит цену уже существующего изделия, а не добавляет новую единицу).
  var isReval = !!(document.getElementById('rcvReval')||{}).checked;
  var entry = {id:uid(),type:'receive',ts:_workingNowISO(),icon:'📥',
    label:(isReval?'🔄 ПЕРЕОЦЕНКА · ':'')+'Приход '+(isDr?'ДР Товар':'товара'),
    sub:(article?'№'+article+' ':'')+name+(gv('rcvQty')?' · '+gv('rcvQty'):'')+' · '+gv('rcvFrom')+' · '+gv('rcvDate'),
    amount:price,amtCls:'neu',cashEffect:0,cardEffect:0,staffEffect:0,
    goodsEffect: isDr?0:price, goodsDrEffect: isDr?price:0,
    goodsType: _rcvGoodsType,
    article:article};
  if(isReval) entry.isRevaluation = true;
  journal.push(entry);
  _recordJournalEntryIndependently(entry, session&&session.shopName, 'receive');
  _backupCheckPassed = false;
  if(article){ try{ stockApplyReceive(session&&session.shopName,[{num:article,name:name,price:price,qty:rcvQtyNum,goodsType:_rcvGoodsType}],gv('rcvDate')||new Date().toISOString().split('T')[0],undefined,isReval); }catch(e){} }
  if(isReval){ try{ logAction('REVALUATION', {direction:'receive', goodsType:_rcvGoodsType, itemCount:1, names:name, amount:price, shop:session&&session.shopName}); }catch(e){} }
  saveJ(); ['rcvArticle','rcvName','rcvQty','rcvPrice','rcvFrom'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  var _rv=document.getElementById('rcvReval'); if(_rv) _rv.checked=false;
  logReceive(gv('rcvFrom'), price, session.shopName);
  var hint=document.getElementById('rcvLookupHint'); if(hint) hint.style.display='none';
  setRcvGoodsType('derevo'); // reset to Дерево
  closeMo('receiveMo'); renderAll(); showToast((isReval?'🔄 Переоценка: ':'📥 ')+(isDr?'🛍 ДР Товар':'🌳 Дерево')+' принят: '+fmt(price));
}
var spGoodsType = 'derevo';
function setSpGoods(type, el){
  spGoodsType = type;
  var db=document.getElementById('spGoodsDerevo'), dr=document.getElementById('spGoodsDr');
  if(type==='derevo'){
    if(db) db.style.cssText='flex:1;padding:8px;border-radius:10px;border:2px solid #c8f060;background:#1e2a14;color:#c8f060;font-size:12px;font-weight:700;cursor:pointer';
    if(dr) dr.style.cssText='flex:1;padding:8px;border-radius:10px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:600;cursor:pointer';
  } else {
    if(dr) dr.style.cssText='flex:1;padding:8px;border-radius:10px;border:2px solid #a060f0;background:#1e1a2e;color:#a060f0;font-size:12px;font-weight:700;cursor:pointer';
    if(db) db.style.cssText='flex:1;padding:8px;border-radius:10px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:600;cursor:pointer';
  }
}
function setStaffPayM(m,el){ staffPayMethod=m; document.querySelectorAll('#staffMo .pc').forEach(p=>p.classList.remove('active')); el.classList.add('active'); }
function spPickName(val){ var el=document.getElementById('spItem'); if(el) el.value=val; var box=document.getElementById('spItem_sugg'); if(box) box.style.display='none'; }
function spPickSpecies(val){ var el=document.getElementById('spSpecies'); if(el) el.value=val; var box=document.getElementById('spSpecies_sugg'); if(box) box.style.display='none'; }
function lookupSpItem(num){
  if(!num.trim()) return;
  var items = JSON.parse(localStorage.getItem('iz_items')||'[]');
  var found = items.find(function(i){ return String(i.num)===num.trim(); });
  if(found){
    var nameEl=document.getElementById('spItem'), priceEl=document.getElementById('spPrice'), spEl=document.getElementById('spSpecies');
    if(nameEl) nameEl.value = found.name||'';
    if(priceEl) priceEl.value = found.price||'';
    if(spEl) spEl.value = found.species||'';
    if(found.category==='dr') setSpGoods('dr'); else setSpGoods('derevo');
    spCalcRetail();
  }
}
function spCalcRetail(){
  var price=parseFloat(gv('spPrice'))||0, qty=parseFloat(gv('spQty'))||1;
  var retEl=document.getElementById('spRetail'); if(retEl) retEl.value = (price*qty)||'';
}
function spCalcFromRetail(){
  var ret=parseFloat(gv('spRetail'))||0, qty=parseFloat(gv('spQty'))||1;
  var priceEl=document.getElementById('spPrice'); if(priceEl && qty>0) priceEl.value = (ret/qty)||'';
}
function saveStaff(){
  const who=gv('spWho'),item=gv('spItem'),pay=parseFloat(gv('spPay'))||0;
  if(!who||!item||!pay){showToast('Заполните поля');return;}
  const retail=parseFloat(gv('spRetail'))||0;
  const species=gv('spSpecies'), num=gv('spNum'), qty=parseFloat(gv('spQty'))||1;
  const payL={cash:'💵 Нал',terminal:'💳 Терминал',sbp:'📱 СБП',transfer:'🏦 Перевод'}[staffPayMethod];
  const isCard=staffPayMethod!=='cash';
  journal.push({id:uid(),type:'staff',ts:_workingNowISO(),icon:'🛒',label:'Покупка сотр.: '+who,
    sub:(num?'№'+num+' ':'')+item+(species?' · '+species:'')+(qty&&qty!==1?' × '+qty:'')+' · '+fmt(retail)+' · '+fmt(pay)+' '+payL,
    amount:pay,amtCls:'neu',
    goodsType:spGoodsType,species,article:num,qty,price:parseFloat(gv('spPrice'))||0,
    cashEffect:0,cardEffect:isCard?pay:0,staffEffect:staffPayMethod==='cash'?pay:0,
    goodsEffect:spGoodsType==='dr'?0:-retail, goodsDrEffect:spGoodsType==='dr'?-retail:0});
  saveJ(); ['spWho','spNum','spItem','spSpecies','spPrice','spRetail','spPay','spComment'].forEach(id=>{var el=document.getElementById(id); if(el) el.value='';});
  var qtyEl=document.getElementById('spQty'); if(qtyEl) qtyEl.value='1';
  setSpGoods('derevo');
  var _spN=gv('spNum'),_spSh=session&&session.shopName;
  if(_spN&&_spSh){ try{ stockUpdateQty(_spSh,_spN,gv('spItem'),parseFloat(gv('spPrice'))||0,gv('spSpecies'),spGoodsType,'',-( parseFloat(gv('spQty'))||1),null); }catch(e){} }
  closeMo('staffMo'); renderAll(); renderStaff(); showToast('🛒 Покупка зафиксирована');
}
function renderStaff(){
  const c=document.getElementById('staffList'); if(!c)return;
  const items=journal.filter(e=>e.type==='staff');
  if(!items.length){c.innerHTML='<div class="empty"><div class="ei">🛒</div>Покупок нет</div>';return;}
  c.innerHTML=items.map(e=>`<div class="ji"><div class="ji-ic staff">🛒</div><div class="ji-body"><div class="ji-title">${e.label}</div><div class="ji-sub">${e.sub}</div></div><div class="ji-amt neu">${fmt(e.amount)}</div></div>`).join('');
}
function renderWriteoffs(){
  const cWood=document.getElementById('writeoffsListWood'), cDr=document.getElementById('writeoffsListDr');
  if(!cWood||!cDr) return;
  const items=journal.filter(e=>e.type==='writeoff');
  const wood=items.filter(e=>e.goodsType!=='dr');
  const dr=items.filter(e=>e.goodsType==='dr');
  function row(e){
    var time = new Date(e.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
    return '<div class="ji">'+
      '<div class="ji-ic writeoff">🗑️</div>'+
      '<div class="ji-body">'+
        '<div class="ji-title">'+e.label+'</div>'+
        (e.sub?'<div class="ji-sub">'+e.sub+'</div>':'')+
        '<div class="ji-time">'+time+'</div>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:6px">'+
        '<div class="ji-amt exp">−'+fmt(e.amount)+'</div>'+
        '<button onclick="editWriteoff(\''+e.id+'\')" style="background:none;border:1px solid #2e2e3e;border-radius:8px;padding:4px 8px;color:#c8f060;font-size:13px;cursor:pointer">✏️</button>'+
      '</div>'+
    '</div>';
  }
  cWood.innerHTML = wood.length ? wood.map(row).join('') : '<div class="empty"><div class="ei">🌳</div>Списаний нет</div>';
  cDr.innerHTML = dr.length ? dr.map(row).join('') : '<div class="empty"><div class="ei">🛍</div>Списаний нет</div>';
}
var _woEditId = null;
var _woEditItems = [];
function editWriteoff(id){
  var e = journal.find(function(j){ return j.id===id; });
  if(!e) return;
  _woEditId = id;
  _woEditItems = e.items ? JSON.parse(JSON.stringify(e.items))
    : [{id:uid(), name:(e.sub||'').split(' · ')[0]||'', num:'', species:e.species||'', price:e.price||e.amount, qty:e.qty||1, amt:e.amount, reason:e.reason||'', goodsType:e.goodsType||'derevo'}];
  var mo = document.getElementById('woEditMo');
  if(!mo) return;
  document.getElementById('woEditReason').value = e.reason || (_woEditItems[0]&&_woEditItems[0].reason)||'';
  setWoEditType(e.goodsType==='dr' ? 'dr' : 'derevo');
  renderWoEditItems();
  openMo('woEditMo');
}
var _woEditGoodsType = 'derevo';
function setWoEditType(type){
  _woEditGoodsType = type;
  var db=document.getElementById('woEditTypeDerevo'), dr=document.getElementById('woEditTypeDr');
  if(type==='derevo'){
    if(db) db.style.cssText='flex:1;padding:7px;border-radius:8px;border:2px solid #c8f060;background:#1e2a14;color:#c8f060;font-size:11px;font-weight:700;cursor:pointer';
    if(dr) dr.style.cssText='flex:1;padding:7px;border-radius:8px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:11px;font-weight:600;cursor:pointer';
  } else {
    if(dr) dr.style.cssText='flex:1;padding:7px;border-radius:8px;border:2px solid #a060f0;background:#1e1a2e;color:#a060f0;font-size:11px;font-weight:700;cursor:pointer';
    if(db) db.style.cssText='flex:1;padding:7px;border-radius:8px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:11px;font-weight:600;cursor:pointer';
  }
}
function renderWoEditItems(){
  var c = document.getElementById('woEditItemsList'); if(!c) return;
  c.innerHTML = _woEditItems.map(function(it,i){
    return '<div style="margin-bottom:8px;background:#1a1a22;border-radius:8px;padding:8px">'+
      '<div style="display:flex;gap:5px;margin-bottom:5px;align-items:center">'+
        '<input class="fi" value="'+(it.num||it.article||'')+'" placeholder="Арт." style="flex:0 0 72px;margin:0;padding:6px;font-size:12px;text-align:center" oninput="_woEditNum('+i+',this.value)">'+
        '<input class="fi" value="'+(it.name||'')+'" placeholder="Наименование" style="flex:2;margin:0;padding:6px;font-size:12px" oninput="_woEditName('+i+',this.value)">'+
        '<button type="button" onclick="_woEditDel('+i+')" style="background:none;border:1px solid #3e2e2e;border-radius:8px;padding:6px 9px;color:#f06060;font-size:13px;cursor:pointer;flex-shrink:0">✕</button>'+
      '</div>'+
      '<div style="display:flex;gap:5px;align-items:center">'+
        '<input class="fi" type="text" value="'+(it.qty||1)+'" inputmode="numeric" placeholder="Кол" style="flex:0 0 60px;margin:0;padding:6px;font-size:12px;text-align:center" oninput="_woEditQty('+i+',this.value)">'+
        '<input class="fi" type="text" value="'+(it.price||it.amt||0)+'" inputmode="numeric" placeholder="Цена" style="flex:1;margin:0;padding:6px;font-size:12px;text-align:center" oninput="_woEditPrice('+i+',this.value)">'+
        '<div style="flex:0 0 70px;font-size:11px;color:#f06060;text-align:right">'+fmt((it.qty||1)*(it.price||0))+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
  _updateWoEditTotal();
}
function _woEditNum(i,v){ if(_woEditItems[i]){ _woEditItems[i].num=v; _woEditItems[i].article=v; } }
function _woEditName(i,v){ if(_woEditItems[i]) _woEditItems[i].name=v; }
function _woEditQty(i,v){ if(_woEditItems[i]){ _woEditItems[i].qty=parseFloat(v)||1; _woEditItems[i].amt=(_woEditItems[i].qty)*(_woEditItems[i].price||0); _updateWoEditTotal(); } }
function _woEditPrice(i,v){ if(_woEditItems[i]){ _woEditItems[i].price=parseFloat(v)||0; _woEditItems[i].amt=(_woEditItems[i].qty||1)*_woEditItems[i].price; _updateWoEditTotal(); } }
function _woEditDel(i){ _woEditItems.splice(i,1); renderWoEditItems(); }
function addWoEditItem(){ _woEditItems.push({id:uid(),name:'',num:'',species:'',price:0,qty:1,amt:0,reason:'',goodsType:'derevo'}); renderWoEditItems(); }
function _updateWoEditTotal(){
  var total=_woEditItems.reduce(function(s,it){return s+(it.amt||0);},0);
  var qty=_woEditItems.reduce(function(s,it){return s+(it.qty||1);},0);
  var el=document.getElementById('woEditTotal');
  if(el) el.innerHTML=_woEditItems.length
    ?'<div style="display:flex;justify-content:space-between;align-items:center;background:#2e1a1a;border:1px solid #f06060;border-radius:10px;padding:10px 14px;font-weight:700">'+
      '<span style="color:#8888aa;font-size:13px">Итого: '+qty+' шт. · '+_woEditItems.length+' позиций</span>'+
      '<span style="color:#f06060;font-size:16px">'+fmt(total)+'</span></div>':'';
}
function saveWoEdit(){
  var reason=(document.getElementById('woEditReason')||{}).value||'';
  if(!reason){ showToast('Укажите причину'); return; }
  if(!_woEditItems.length){ showToast('Добавьте хотя бы одну позицию'); return; }
  var idx=journal.findIndex(function(j){ return j.id===_woEditId; });
  if(idx<0){ showToast('Запись не найдена'); return; }
  var orig=journal[idx];
  var isDr=_woEditGoodsType==='dr';
  var total=_woEditItems.reduce(function(s,it){return s+(it.amt||0);},0);
  var count=_woEditItems.length;
  var totalQty=_woEditItems.reduce(function(s,it){return s+(it.qty||1);},0);
  var namesPreview=_woEditItems.map(function(it){return it.name;}).join(', ');
  var sub=count===1
    ?(((_woEditItems[0].num)?'№'+_woEditItems[0].num+' ':'')+_woEditItems[0].name+(_woEditItems[0].species?' · '+_woEditItems[0].species:'')+(_woEditItems[0].qty&&_woEditItems[0].qty!==1?' × '+_woEditItems[0].qty:'')+' · '+reason)
    :(count+' позиций ('+totalQty+' шт.): '+namesPreview+' · '+reason);
  var artsList=_woEditItems.filter(function(it){return it.num||it.article;}).map(function(it){return '№'+(it.num||it.article);}).join(', ');
  _woEditItems.forEach(function(it){ it.reason=reason; it.goodsType=_woEditGoodsType; });
  journal[idx]=Object.assign({},orig,{
    sub:sub, reason:reason, items:_woEditItems, goodsType:_woEditGoodsType,
    amount:total, goodsEffect:isDr?0:-total, goodsDrEffect:isDr?-total:0,
    editedAt:new Date().toISOString()
  });
  saveJ(); closeMo('woEditMo'); renderAll();
  showToast('✅ Списание исправлено');
}
function deleteWoEntry(){
  if(!confirm('Удалить это списание из журнала?')) return;
  journal=journal.filter(function(j){ return j.id!==_woEditId; });
  saveJ(); closeMo('woEditMo'); renderAll();
  showToast('🗑 Списание удалено');
}
function createInvoiceFromJournal(){
  var sales = journal.filter(function(e){ return e.type==='sale'; });
  if(!sales.length){ showToast('Нет продаж в журнале'); return; }
  var num = 'НКЛ-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+uid().slice(0,4).toUpperCase();
  var items = sales.map(function(s){ return {name:s.sub, price:s.amount, num:'', sale:true}; });
  var inv = {
    id:uid(), num:num, date:new Date().toISOString().split('T')[0],
    sourceName:session.shopName, createdBy:session.shopName,
    sellerName:session.sellerName, status:'pending',
    items:items, total:sales.reduce(function(s,e){return s+e.amount;},0)
  };
  var invs = getInvoices(); invs.unshift(inv);
  localStorage.setItem('iz_invoices', JSON.stringify(invs));
  try{ db.collection('iz_invoices').add(inv); }catch(e){}
  showToast('✅ Накладная '+num+' сформирована');
  renderInvoices();
}
function updateInvBadge(){
  const p=getInvoices().filter(i=>i.destName===(session&&session.shopName)&&i.status==='pending');
  const b=document.getElementById('invBadge'); if(b){b.style.display=p.length?'block':'none';b.textContent=p.length;}
  const b2=document.getElementById('invBadge2'); if(b2){b2.style.display=p.length?'block':'none';b2.textContent=p.length;}
  const tb=document.getElementById('pendingInvBadge');
  if(tb) tb.innerHTML = p.length ? ' <span style="background:#f0a060;color:#1a1206;border-radius:6px;padding:1px 6px;font-size:10px;font-weight:700">'+p.length+'</span>' : '';
}
function renderInvoices(){
  const c=document.getElementById('invoicesList'); if(!c)return;
  var shopType = session.shopType || getShopType(session.shopName||'');
  if(shopType === 'offline'){
    const all=getInvoices();
    const outgoing=all.filter(i=>i.sourceName===(session&&session.shopName)||i.createdBy===(session&&session.shopName));
    const todaySales=journal.filter(e=>e.type==='sale');
    let html='';
    if(todaySales.length){
      html+=`<div style="background:#1e2a14;border:1px solid #c8f060;border-radius:12px;padding:12px;margin-bottom:10px">
        <div style="font-size:12px;color:#c8f060;font-weight:700;margin-bottom:8px">📋 Текущая смена — ${todaySales.length} продаж</div>
        ${todaySales.map(s=>`<div style="font-size:12px;color:#8888aa;padding:3px 0">· ${s.sub}</div>`).join('')}
        <button onclick="createInvoiceFromJournal()" style="width:100%;margin-top:10px;padding:10px;background:#c8f060;border:none;border-radius:8px;font-family:Unbounded,sans-serif;font-size:12px;font-weight:700;cursor:pointer;color:#0f0f13">
          📋 Сформировать накладную
        </button>
      </div>`;
    }
    if(outgoing.length){
      html+=outgoing.map(inv=>`
        <div class="card" style="border-color:${inv.disputed?'#f06060':inv.status==='accepted'?'#60f090':'#f0a060'}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div>
              <div style="font-family:Unbounded,sans-serif;font-size:13px;font-weight:700">${inv.num}</div>
              <div class="u-fs11-gray">📅 ${inv.date} · 📦 ${inv.destName||'—'} · ${(inv.items&&inv.items.length)||0} изд.</div>
            </div>
            <span style="font-size:10px;padding:3px 8px;border-radius:6px;font-weight:700;
              background:${inv.disputed?'#2e1a1a':inv.status==='accepted'?'#1a2e1e':'#2a1e14'};
              color:${inv.disputed?'#f06060':inv.status==='accepted'?'#60f090':'#f0a060'}">
              ${inv.disputed?'⚠️ Расхождение':inv.status==='accepted'?'✅ Принята':'⏳ Ожидает'}
            </span>
          </div>
          ${(inv.items||[]).slice(0,3).map(it=>`<div style="font-size:12px;color:#8888aa;padding:2px 0">· №${it.num||'—'} ${it.name}</div>`).join('')}
        </div>`).join('');
    }
    if(!html) html='<div class="empty"><div class="ei">📋</div>Исходящих накладных нет</div>';
    c.innerHTML=html;
    return;
  }
  const sh=getInvoices().filter(i=>i.destName===(session&&session.shopName));
  const pending=sh.filter(i=>i.status==='pending');
  let html='';
  if(!pending.length) html='<div class="empty"><div class="ei">📦</div>Нет накладных, ожидающих приёмки</div>';
  else {
    html+=pending.map(inv=>{
      var iid=String(inv._id!=null?inv._id:inv.id);
      var progress = loadInvProgress(iid);
      var checkedCount = progress && progress.invCheckState ? progress.invCheckState.filter(function(s){return s.ok;}).length : 0;
      return `<div class="card" style="border-color:#f0a060" id="shinv_${iid}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div><div style="font-family:Unbounded,sans-serif;font-size:13px;font-weight:700;color:#f0a060">${inv.num}</div><div class="u-fs11-gray">📅 ${inv.date} · ${inv.items.length} изд.</div>
          ${progress?`<div style="font-size:11px;color:#c8f060;margin-top:2px">⏸ Приёмка начата: отмечено ${checkedCount}/${inv.items.length}</div>`:''}
          ${inv.isTransfer?`<div style="font-size:11px;color:#60c8f0;margin-top:2px">🚚 Перемещение из «${inv.sourceName||''}»</div>`:''}
          ${inv.editRequest?`<div style="font-size:11px;color:#f0c060;margin-top:2px">⏳ Заявка на исправление у администратора — ждём решения</div>`:''}</div>
        </div>
        <button class="btn" style="margin:0;margin-bottom:6px${inv.editRequest&&!_rcvIsAdmin()?';opacity:.5':''}" onclick="openInvoice('${iid}')">📋 ${progress?'Продолжить приёмку':'Открыть и принять'}</button>
        <div class="u-flex-g6">
          <button onclick="openInvoice('${iid}',true)" style="flex:1;padding:7px;border-radius:8px;border:1px solid #2e2e3e;background:#22222e;color:#c8f060;font-size:11px;cursor:pointer">✏️ Править</button>
          ${_rcvIsAdmin()?`<button onclick="deleteShopInvoice('${iid}')" style="padding:7px 12px;border-radius:8px;border:1px solid #3e2020;background:#2a1010;color:#f06060;font-size:11px;cursor:pointer">🗑 Удалить</button>`:''}
        </div>
      </div>`;
    }).join('');
  }
  c.innerHTML=html;
}
window._shInvEdit = window._shInvEdit || {};
window._shInvExpandedMap = window._shInvExpandedMap || {}; // id -> expanded index
function renderShInvItems(id, contextId){
  var data = window._shInvEdit[id]; if(!data) return;
  var items = data.items||[];
  var expandIdx = window._shInvExpandedMap[id] != null ? window._shInvExpandedMap[id] : -1;
  var html = items.map(function(item, i){
    var isOpen = (i === expandIdx);
    var isFilled = !!(item.name || item.num || item.article);
    var artNum = item.num || item.article || '';
    var summary = (artNum?'№'+artNum+' ':'')+(item.name||'—')+(item.species?' · '+item.species:'')+(item.qty&&item.qty>1?' ×'+item.qty:'');
    var total = Math.round((item.qty||1)*(item.price||0));
    if(!isOpen && isFilled){
      return '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:10px;padding:7px 8px;margin-bottom:5px;display:flex;align-items:center;gap:6px">'+
        '<div style="flex-shrink:0;width:22px;height:22px;background:#2e2e3e;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#8888aa">'+(i+1)+'</div>'+
        '<div style="flex:1;overflow:hidden;min-width:0">'+
          '<div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+summary+'</div>'+
          '<div class="u-fs10-gray">'+(total?total.toLocaleString('ru-RU')+'₽':'')+'</div>'+
        '</div>'+
        '<button type="button" onpointerdown="event.preventDefault();_shInvToggle(\''+id+'\','+i+')" '+
          'style="flex-shrink:0;background:#22222e;border:1px solid #3e3e4e;border-radius:8px;padding:5px 9px;color:#c8f060;font-size:13px;cursor:pointer">▼</button>'+
      '</div>';
    }
    return '<div style="background:#1a1a22;border:2px solid #c8f06044;border-radius:10px;padding:9px;margin-bottom:5px">'+
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">'+
        '<div style="flex-shrink:0;width:22px;height:22px;background:#c8f06033;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#c8f060">'+(i+1)+'</div>'+
        '<div style="font-size:10px;color:#c8f060;font-weight:700;flex:1">ПОЗИЦИЯ '+(i+1)+'</div>'+
        (isFilled ? '<button type="button" onpointerdown="event.preventDefault();_shInvToggle(\''+id+'\','+i+')" style="background:#22222e;border:1px solid #3e3e4e;border-radius:8px;padding:4px 9px;color:#8888aa;font-size:13px;cursor:pointer">▲</button>' : '')+
      '</div>'+
      '<div style="display:flex;gap:5px;margin-bottom:5px;align-items:center">'+
        '<input class="fi" value="'+artNum+'" placeholder="Арт." style="flex:0 0 70px;margin:0;padding:6px;font-size:12px;text-align:center" oninput="_shInvNum(\''+id+'\','+i+',this.value)">'+
        '<input class="fi" value="'+(item.name||'')+'" placeholder="Наименование" style="flex:2;margin:0;padding:6px;font-size:12px" oninput="_shInvName(\''+id+'\','+i+',this.value)">'+
      '</div>'+
      '<div style="position:relative;margin-bottom:5px">'+
        '<input class="fi" id="shinv_sp_'+id+'_'+i+'" value="'+(item.species||'').replace(/"/g,'&quot;')+'" placeholder="Порода дерева" autocomplete="off" style="margin:0;padding:6px;font-size:12px" '+
          'oninput="_shInvSpActive={id:\''+id+'\',i:'+i+'};_shInvSpecies(\''+id+'\','+i+',this.value);psjSuggest(\'shinv_sp_'+id+'_'+i+'\',getSpecies(),\'_shInvPickSpecies\')" '+
          'onfocus="_shInvSpActive={id:\''+id+'\',i:'+i+'};psjSuggest(\'shinv_sp_'+id+'_'+i+'\',getSpecies(),\'_shInvPickSpecies\')" '+
          'onblur="psjHideSugg(\'shinv_sp_'+id+'_'+i+'\')">'+
        '<div id="shinv_sp_'+id+'_'+i+'_sugg" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:20;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;max-height:160px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:2px"></div>'+
      '</div>'+
      '<div style="display:flex;gap:5px;align-items:center">'+
        '<input class="fi" type="text" value="'+(item.qty!=null?item.qty:1)+'" inputmode="numeric" placeholder="Кол" style="flex:0 0 60px;margin:0;padding:6px;font-size:12px;text-align:center" oninput="_shInvQty(\''+id+'\','+i+',this.value)">'+
        '<input class="fi" type="text" value="'+(item.price||0)+'" inputmode="numeric" placeholder="Цена" style="flex:1;margin:0;padding:6px;font-size:12px;text-align:center" oninput="_shInvPrice(\''+id+'\','+i+',this.value)">'+
        '<div style="font-size:11px;color:#c8a060;flex:0 0 60px;text-align:right">'+(total?total.toLocaleString('ru-RU')+'₽':'')+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
  var cont = document.getElementById(contextId||('shinv_items_'+id));
  if(cont) cont.innerHTML = html;
}
function _shInvToggle(id, i){
  window._shInvExpandedMap[id] = (window._shInvExpandedMap[id]===i) ? -1 : i;
  renderShInvItems(id);
}
function editShopInvoice(id){
  try{ if(typeof _buildUsedArticleIndex==='function') _buildUsedArticleIndex(); }catch(e){}
  var inv = getInvoices().find(function(i){ return String(i._id!=null?i._id:i.id)===id; });
  if(!inv) return;
  var card = document.getElementById('shinv_'+id); if(!card) return;
  window._shInvEdit[id] = JSON.parse(JSON.stringify(inv));
  window._shInvExpandedMap[id] = -1; // all collapsed by default
  card.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:#c8f060;margin-bottom:8px">✏️ Исправление: '+(inv.num||'')+'</div>'+
    (_rcvIsAdmin()?'':'<div style="font-size:10.5px;color:#f0c060;margin-bottom:8px;line-height:1.4">Правки уйдут администратору на одобрение. До решения накладную принять нельзя — после одобрения она обновится и её можно будет принять.</div>')+
    '<div class="fg" style="margin-bottom:6px"><label class="fl">Номер</label><input class="fi" id="shinv_num_'+id+'" value="'+(inv.num||'')+'" style="margin:0;padding:7px"></div>'+
    '<div class="fg" style="margin-bottom:6px"><label class="fl">Дата</label><input class="fi" type="date" id="shinv_date_'+id+'" value="'+(inv.date||'')+'" style="margin:0;padding:7px;-webkit-appearance:none;color-scheme:dark"></div>'+
    '<div style="font-size:10px;color:#8888aa;margin-bottom:4px">ПОЗИЦИИ (арт. · наим. · порода · кол-во · цена)</div>'+
    '<div id="shinv_items_'+id+'"></div>'+
    '<div style="display:flex;gap:6px;margin-top:8px">'+
      '<button onclick="saveShopInvoice(\''+id+'\')" style="flex:1;padding:8px;border-radius:8px;border:none;background:#c8f060;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer">'+(_rcvIsAdmin()?'💾 Сохранить':'📨 Отправить заявку на исправление')+'</button>'+
      (inv.status==='accepted'
        ? '<button onclick="openRcvArchiveDate(\''+(inv.acceptedDate||inv.date||'—')+'\')" style="padding:8px 12px;border-radius:8px;border:1px solid #2e2e3e;background:none;color:#8888aa;font-size:12px;cursor:pointer">Отмена</button>'
        : '<button onclick="renderInvoices()" style="padding:8px 12px;border-radius:8px;border:1px solid #2e2e3e;background:none;color:#8888aa;font-size:12px;cursor:pointer">Отмена</button>')+
    '</div>';
  renderShInvItems(id);
}
function _shInvNum(id,i,v){ if(window._shInvEdit[id]&&window._shInvEdit[id].items[i]) window._shInvEdit[id].items[i].num=v; }
function _shInvName(id,i,v){ if(window._shInvEdit[id]&&window._shInvEdit[id].items[i]) window._shInvEdit[id].items[i].name=v; }
function _shInvQty(id,i,v){ if(window._shInvEdit[id]&&window._shInvEdit[id].items[i]) window._shInvEdit[id].items[i].qty=parseFloat(v)||1; }
var _shInvSpActive = null;
function _shInvSpecies(id,i,v){ if(window._shInvEdit[id]&&window._shInvEdit[id].items[i]) window._shInvEdit[id].items[i].species=v; }
function _shInvPickSpecies(val){
  var a=_shInvSpActive; if(!a) return;
  _shInvSpecies(a.id, a.i, val);
  var el=document.getElementById('shinv_sp_'+a.id+'_'+a.i); if(el) el.value=val;
  var box=document.getElementById('shinv_sp_'+a.id+'_'+a.i+'_sugg'); if(box) box.style.display='none';
}
function _shInvPrice(id,i,v){ if(window._shInvEdit[id]&&window._shInvEdit[id].items[i]) window._shInvEdit[id].items[i].price=parseFloat(v)||0; }
// Что изменилось в накладной — строками для заявки администратору.
function _invEditDiff(oldInv, nw){
  var out = [];
  if(String(oldInv.num||'')!==String(nw.num||'')) out.push('№: «'+(oldInv.num||'—')+'» → «'+(nw.num||'—')+'»');
  if(String(oldInv.date||'')!==String(nw.date||'')) out.push('дата: '+(oldInv.date||'—')+' → '+(nw.date||'—'));
  var oi = oldInv.items||[], ni = nw.items||[];
  var lbl = function(it){ return ((it.num||it.article)?'№'+(it.num||it.article)+' ':'')+(it.name||'—'); };
  for(var k=0;k<Math.max(oi.length,ni.length);k++){
    var a = oi[k], b = ni[k];
    if(!a){ out.push('поз.'+(k+1)+' добавлена: '+lbl(b)+(b.species?' · '+b.species:'')+' ×'+(b.qty||1)+' · '+fmt(b.price||0)); continue; }
    if(!b){ out.push('поз.'+(k+1)+' удалена: '+lbl(a)); continue; }
    var ch = [];
    if(String(a.num||a.article||'')!==String(b.num||b.article||'')) ch.push('№ '+(a.num||a.article||'—')+' → '+(b.num||b.article||'—'));
    if(String(a.name||'')!==String(b.name||'')) ch.push('название «'+(a.name||'—')+'» → «'+(b.name||'—')+'»');
    if(String(a.species||'')!==String(b.species||'')) ch.push('порода «'+(a.species||'—')+'» → «'+(b.species||'—')+'»');
    if((a.qty||1)!==(b.qty||1)) ch.push('кол-во '+(a.qty||1)+' → '+(b.qty||1));
    if((a.price||0)!==(b.price||0)) ch.push('цена '+fmt(a.price||0)+' → '+fmt(b.price||0));
    if(ch.length) out.push('поз.'+(k+1)+' ('+lbl(a)+'): '+ch.join(', '));
  }
  return out;
}
function _submitInvoiceEditRequest(id, orig, req, diff, onDone){
  db.collection('iz_invoices').doc(id).set({editRequest:req}, {merge:true}).then(function(){
    // Повторная заявка по той же накладной заменяет прежнюю: сначала снимаем старые уведомления,
    // и только потом создаём новое — иначе запрос мог захватить и новое.
    var newAlert = function(){
      saveAdminAlert({type:'invoice_edit', invId:id, invNum:orig.num||'', shopName:orig.destName||(session&&session.shopName)||'',
        sellerName:req.by, date:new Date().toLocaleDateString('ru-RU'), isTransfer:!!orig.isTransfer, sourceName:orig.sourceName||'', changes:diff});
    };
    try{
      db.collection('iz_admin_alerts').where('invId','==',id).get({source:'server'}).then(function(as){
        var ups = [];
        as.forEach(function(d){ var x=d.data(); if(x.type==='invoice_edit' && !x.read) ups.push(d.ref.update({read:true}).catch(function(){})); });
        return Promise.all(ups);
      }).then(newAlert, newAlert);
    }catch(e){ newAlert(); }
    var invs = getInvoices(); var ix = invs.findIndex(function(i){ return String(i._id!=null?i._id:i.id)===id; });
    if(ix>=0){ invs[ix].editRequest = req; saveInvoices(invs); }
    if(onDone) onDone();
    renderInvoices();
    showToast('📨 Заявка отправлена администратору — накладную можно будет принять после решения');
  }).catch(function(err){ showToast('❌ Заявка не отправилась: '+(err&&err.message||err)); });
}
function saveShopInvoice(id){
  var data = window._shInvEdit[id]; if(!data) return;
  if(!_rcvIsAdmin()){
    // Продавец не правит накладную сам — отправляет заявку; накладная остаётся как была.
    var orig = getInvoices().find(function(i){ return String(i._id!=null?i._id:i.id)===id; }) || {};
    var req = {num:(gv('shinv_num_'+id)||data.num||'').trim(), date:gv('shinv_date_'+id)||data.date||'',
      items:(data.items||[]).map(function(it){ return {num:it.num||it.article||'', article:it.num||it.article||'', name:it.name||'', species:it.species||'', price:it.price||0, qty:it.qty||1, goodsType:it.goodsType||data.goodsType||'derevo'}; }),
      by:(session&&(session.sellerName||session.name))||'', at:new Date().toISOString()};
    var diff = _invEditDiff(orig, req);
    if(!diff.length){ showToast('Изменений нет'); return; }
    if(!confirm('Отправить администратору заявку на исправление накладной '+(orig.num||'')+'?\n\n'+diff.join('\n'))) return;
    _submitInvoiceEditRequest(id, orig, req, diff, function(){ delete window._shInvEdit[id]; });
    return;
  }
  if(typeof _findArtDupInItems==='function'){
    var _col2 = [];
    var _artDupMsg2 = _findArtDupInItems(data.items, id, data.destName||data.shopName, data.isTransfer?data.sourceName:null, _col2);
    if(_artDupMsg2){ showToast('⛔ '+_artDupMsg2+' — исправьте номер'); return; }
    if(!_confirmTagCollisions(_col2, data.destName||data.shopName)) return;
  }
  var wasAccepted = data.status==='accepted';
  var oldNum = (getInvoices().find(function(i){ return String(i._id!=null?i._id:i.id)===id; })||{}).num;
  data.num = (document.getElementById('shinv_num_'+id)||{}).value || data.num;
  data.date = (document.getElementById('shinv_date_'+id)||{}).value || data.date;
  data.editedAt = new Date().toISOString();
  data.editedBy = (session&&session.sellerName)||'';
  var invs = getInvoices();
  var idx = invs.findIndex(function(i){ return String(i._id!=null?i._id:i.id)===id; });
  if(idx>=0) invs[idx]=data;
  saveInvoices(invs);
  try{ db.collection('iz_invoices').doc(id).set(data,{merge:true}); }catch(e){}
  if(wasAccepted){
    var newTotal = (data.items||[]).reduce(function(s,it){ return s+(it.qty||1)*(it.price||0); },0);
    var je = journal.find(function(e){ return e.type==='receive' && e.label==='Приёмка '+oldNum; });
    if(je){
      je.label = 'Приёмка '+data.num;
      je.amount = newTotal;
      var jeGt = data.goodsType || (data.category==='dr'?'dr':'derevo');
      je.goodsType = jeGt;
      je.goodsEffect = jeGt==='dr' ? 0 : newTotal;
      je.goodsDrEffect = jeGt==='dr' ? newTotal : 0;
      saveJ();
    }
  }
  delete window._shInvEdit[id];
  renderAll(); renderInvoices(); renderReceiveArchive();
  showToast('✅ Накладная исправлена');
}
function deleteShopInvoice(id){
  if(!_rcvIsAdmin()){ showToast('Удалить накладную может только администратор — отправьте заявку на исправление'); return; }
  if(!confirm('Удалить накладную? Это действие нельзя отменить.')) return;
  var inv = getInvoices().find(function(i){ return String(i._id!=null?i._id:i.id)===id; });
  if(!inv) return;
  var wasAccepted = inv.status==='accepted';
  var invs = getInvoices().filter(function(i){ return String(i._id!=null?i._id:i.id)!==id; });
  saveInvoices(invs);
  try{ db.collection('iz_invoices').doc(id).delete(); }catch(e){}
  clearInvProgress(id);
  if(wasAccepted){
    var jIdx = journal.findIndex(function(e){ return e.type==='receive' && e.label==='Приёмка '+inv.num; });
    if(jIdx>=0){
      try{ logEntryDelete(journal[jIdx]); }catch(err){}
      addToTrash(journal[jIdx], {reason:'shop_invoice_deleted'});
      journal.splice(jIdx,1);
      saveJ();
      try{ syncLiveShift(); }catch(e){}
    }
  }
  renderAll(); renderInvoices(); renderReceiveArchive();
  showToast('✅ Накладная удалена');
}
function _invProgressKey(invId){ return 'iz_inv_progress_'+invId; }
function saveInvProgress(){
  if(!currentInvId) return;
  try{
    localStorage.setItem(_invProgressKey(currentInvId), JSON.stringify({
      invCheckState: invCheckState, who: gv('invWho')||'', sig: _invItemsSig(_currentInvItems)
    }));
  }catch(e){}
}
function loadInvProgress(invId){
  try{
    var raw = localStorage.getItem(_invProgressKey(invId));
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}
function clearInvProgress(invId){ localStorage.removeItem(_invProgressKey(invId)); }
var _currentInvItems = [];
// Отпечаток позиций: если накладную исправили (одобренная заявка), отметки приёмки, сделанные
// по старому списку, к новым строкам не относятся — их сбрасываем.
function _invItemsSig(items){
  return JSON.stringify((items||[]).map(function(it){ return [it.num||it.article||'', it.name||'', it.species||'', it.price||0, it.qty||1]; }));
}
function openInvoice(invId, editMode){
  try{ if(typeof _buildUsedArticleIndex==='function') _buildUsedArticleIndex(); }catch(e){}
  currentInvId=invId; const inv=getInvoices().find(i=>(i.id||i._id)===invId); if(!inv)return;
  if(inv.editRequest && !_rcvIsAdmin()){ showToast('⏳ По этой накладной заявка на исправление у администратора — принять можно после его решения'); return; }
  _currentInvItems = inv.items;
  var saved = loadInvProgress(invId);
  if(saved && saved.sig && saved.sig!==_invItemsSig(inv.items)){ clearInvProgress(invId); saved = null; }
  invCheckState=inv.items.map(function(it,i){
    if(saved && saved.invCheckState && saved.invCheckState[i]){
      var sv = saved.invCheckState[i];
      return {ok: !!sv.ok, factPrice: sv.factPrice!=null?sv.factPrice:it.price, species: sv.species!=null?sv.species:(it.species||'')};
    }
    return {ok:false, factPrice:it.price, species:it.species||''};
  });
  document.getElementById('invMoTitle').textContent=inv.num;
  document.getElementById('invMoSub').textContent='Отгружено '+inv.date+' · '+inv.items.length+' изд.'+(saved?' · ⏸ продолжение приёмки':'');
  document.getElementById('invWho').value=(saved && saved.who) || (session&&session.sellerName)||'';
  document.getElementById('invMoItems').innerHTML=inv.items.map((item,i)=>`
    <div class="inv-row" id="invrow${i}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="flex:1"><div class="u-fs13-bold">№${item.num||'—'} ${item.name}${item.qty&&item.qty!==1?' × '+item.qty:''}</div>
        <div class="u-fs11-gray">По накладной: ${fmt(item.price)}${item.species?' · '+item.species:''}</div></div>
        <div class="check-circle${invCheckState[i].ok?' checked':''}" id="invok${i}" onclick="toggleInvItem(${i})">${invCheckState[i].ok?'✓':''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="u-fs11-gray">Факт:</span>
        <input id="invfact${i}" type="text" value="${invCheckState[i].factPrice}" inputmode="numeric" oninput="checkInvDiff(${i},${item.price})"
          style="flex:1;padding:7px 10px;background:#0f0f13;border:1px solid ${Math.abs(invCheckState[i].factPrice-item.price)>0?'#f06060':'#2e2e3e'};border-radius:8px;color:${Math.abs(invCheckState[i].factPrice-item.price)>0?'#f06060':'#f0f0f8'};font-size:13px;outline:none;text-align:right"> ₽
      </div>
    </div>`).join('');
  _invShowMode('accept');
  updateInvMoTotal();
  openMo('invMo');
  if(editMode) invStartEdit();
}
// «✏️ ПРАВИТЬ» в окне приёмки: вся накладная переходит в режим исправления — любое поле любой
// строки, удаление и новые строки. У продавца сохранение — это заявка администратору (накладная
// остаётся прежней, принять её можно после одобрения уже в новом виде), у админа — сразу.
var _invEd = null, _invEdActive = null;
function _invShowMode(mode){
  var a = document.getElementById('invAcceptPart'), e = document.getElementById('invEditPart');
  if(a) a.style.display = mode==='edit' ? 'none' : '';
  if(e) e.style.display = mode==='edit' ? '' : 'none';
}
function invStartEdit(){
  var inv = getInvoices().find(function(i){ return (i.id||i._id)===currentInvId; }); if(!inv) return;
  _invEd = {gt:inv.goodsType||'derevo', num:inv.num||'', date:inv.date||'',
    items:(inv.items||[]).map(function(it){ return {num:it.num||it.article||'', name:it.name||'', species:it.species||'', price:it.price||0, qty:it.qty||1, goodsType:it.goodsType||inv.goodsType||'derevo'}; })};
  var n = document.getElementById('invEdNum'); if(n) n.value = _invEd.num;
  var d = document.getElementById('invEdDate'); if(d) d.value = _invEd.date;
  var hint = document.getElementById('invEdHint');
  if(hint) hint.textContent = _rcvIsAdmin() ? 'Исправьте накладную и сохраните — после этого её можно принять.'
    : 'Исправьте всё, что не совпадает с тем, что пришло. Правки уйдут администратору на согласование; после одобрения накладная обновится и её можно будет принять.';
  var b = document.getElementById('invEdSaveBtn'); if(b) b.textContent = _rcvIsAdmin() ? '💾 Сохранить накладную' : '📨 Отправить на согласование';
  _invShowMode('edit');
  _invEdRender();
}
function invCancelEdit(){ _invEd = null; _invShowMode('accept'); }
function _invEdRender(){
  var box = document.getElementById('invEdItems'); if(!box || !_invEd) return;
  var esc = function(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); };
  var inp = function(i,f,v,ph,w,mode,sugg){
    return '<div style="position:relative;'+(w?'flex:0 0 '+w:'flex:1')+';min-width:0"><input id="inved_'+f+'_'+i+'" value="'+esc(v)+'" placeholder="'+ph+'" autocomplete="off"'+
      (mode?' inputmode="'+mode+'"':'')+' oninput="_invEdEdit('+i+',\''+f+'\',this.value)'+(sugg?';_invEdActive={i:'+i+',f:\''+f+'\'};psjSuggest(\'inved_'+f+'_'+i+'\','+sugg+',\'_invEdPick\')':'')+'"'+
      (sugg?' onfocus="_invEdActive={i:'+i+',f:\''+f+'\'};psjSuggest(\'inved_'+f+'_'+i+'\','+sugg+',\'_invEdPick\')" onblur="psjHideSugg(\'inved_'+f+'_'+i+'\')"':'')+
      ' style="width:100%;box-sizing:border-box;padding:6px 8px;background:#0f0f13;border:1px solid #2e2e3e;border-radius:8px;color:#f0f0f8;font-size:12px;outline:none">'+
      (sugg?'<div id="inved_'+f+'_'+i+'_sugg" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:30;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;max-height:160px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:2px;min-width:180px"></div>':'')+
    '</div>';
  };
  var isDr = _invEd.gt==='dr';
  var total = 0;
  box.innerHTML = _invEd.items.map(function(r,i){
    var sum = (r.price||0)*(r.qty||1); total += sum;
    return '<div style="background:'+(r.isNew?'#1a2a1e':'#1a1a22')+';border:1px '+(r.isNew?'dashed #60f090':'solid #2e2e3e')+';border-radius:10px;padding:8px;margin-bottom:6px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:11px;font-weight:700;color:'+(r.isNew?'#60f090':'#8888aa')+'">'+(r.isNew?'🆕 Новая позиция':'Позиция '+(i+1))+'</span>'+
        '<button type="button" onclick="_invEd.items.splice('+i+',1);_invEdRender()" style="background:none;border:none;color:#f06060;font-size:14px;cursor:pointer" title="Убрать строку">✕</button></div>'+
      '<div style="display:flex;gap:5px;margin-bottom:5px">'+inp(i,'num',r.num,'№','70px','numeric')+inp(i,'name',r.name,'Наименование',null,null,'getItemNames(_invEd.gt)')+'</div>'+
      '<div style="display:flex;gap:5px;align-items:center">'+(isDr?'':inp(i,'species',r.species,'Порода',null,null,'getSpecies()'))+
        inp(i,'price',r.price||'','Цена','70px','numeric')+inp(i,'qty',r.qty||1,'Кол','50px','numeric')+
        '<span id="inved_sum_'+i+'" style="flex-shrink:0;min-width:54px;text-align:right;font-size:11px;font-weight:700;color:#c8f060">'+(sum?fmt(sum):'')+'</span></div>'+
    '</div>';
  }).join('');
  var t = document.getElementById('invEdTotal'); if(t) t.textContent = _invEd.items.length+' поз. · '+fmt(total);
}
function invEdAddRow(){
  if(!_invEd) return;
  _invEd.items.push({num:'', name:'', species:'', price:0, qty:1, goodsType:_invEd.gt, isNew:true});
  _invEdRender();
  var el = document.getElementById('inved_name_'+(_invEd.items.length-1)); if(el) try{ el.focus(); el.scrollIntoView({block:'center'}); }catch(e){}
}
function _invEdEdit(i, f, v){
  var r = _invEd && _invEd.items[i]; if(!r) return;
  r[f] = (f==='price'||f==='qty') ? (parseFloat(String(v).replace(',','.'))||0) : v;
  if(f==='price'||f==='qty'){
    var el = document.getElementById('inved_sum_'+i); if(el){ var sm=(r.price||0)*(r.qty||1); el.textContent = sm?fmt(sm):''; }
    var total = _invEd.items.reduce(function(s,x){ return s+(x.price||0)*(x.qty||1); },0);
    var t = document.getElementById('invEdTotal'); if(t) t.textContent = _invEd.items.length+' поз. · '+fmt(total);
  }
}
function _invEdPick(val){
  var a = _invEdActive; if(!a) return;
  var el = document.getElementById('inved_'+a.f+'_'+a.i); if(el) el.value = val;
  _invEdEdit(a.i, a.f, val);
  var box = document.getElementById('inved_'+a.f+'_'+a.i+'_sugg'); if(box) box.style.display='none';
}
function invSaveEdit(){
  if(!_invEd) return;
  var inv = getInvoices().find(function(i){ return (i.id||i._id)===currentInvId; }); if(!inv) return;
  var iid = String(inv._id!=null?inv._id:inv.id);
  var num = (gv('invEdNum')||'').trim(), date = gv('invEdDate')||inv.date||'';
  if(!num){ showToast('⛔ Укажите номер накладной'); return; }
  var rows = _invEd.items.filter(function(r){ return String(r.name||'').trim() || String(r.num||'').trim() || r.price; });
  if(!rows.length){ showToast('⛔ В накладной не осталось позиций'); return; }
  var spList = (typeof getSpecies==='function' ? getSpecies() : []).map(function(x){ return String(x).toLowerCase(); });
  for(var k=0;k<rows.length;k++){
    var r = rows[k], n = String(r.num||'').trim(), sp = String(r.species||'').trim();
    if(!String(r.name||'').trim()){ showToast('⛔ Строка '+(k+1)+': нужно наименование'); return; }
    if(!(r.qty>0)){ showToast('⛔ Строка '+(k+1)+': нужно количество'); return; }
    if(n && !/^\d+$/.test(n)){ showToast('⛔ Строка '+(k+1)+': номер — только цифры'); return; }
    if(_invEd.gt!=='dr' && sp && spList.indexOf(sp.toLowerCase())<0 && !_rcvIsAdmin()){ showToast('⛔ Строка '+(k+1)+': породы «'+sp+'» нет в списке — выберите из подсказки'); return; }
  }
  var items = rows.map(function(r){ var n=String(r.num||'').trim();
    return {num:n, article:n, name:String(r.name).trim(), species:String(r.species||'').trim(), price:r.price||0, qty:r.qty||1, goodsType:r.goodsType||_invEd.gt}; });
  var req = {num:num, date:date, items:items, by:(session&&(session.sellerName||session.name))||'', at:new Date().toISOString()};
  var diff = _invEditDiff(inv, req);
  if(!diff.length){ showToast('Изменений нет'); invCancelEdit(); return; }
  if(!_rcvIsAdmin()){
    if(!confirm('Отправить администратору на согласование исправления накладной '+(inv.num||'')+'?\n\n'+diff.join('\n'))) return;
    _submitInvoiceEditRequest(iid, inv, req, diff, function(){ _invEd = null; clearInvProgress(iid); closeMo('invMo'); });
    return;
  }
  if(typeof _findArtDupInItems==='function'){
    var col = [];
    var dupMsg = _findArtDupInItems(items, iid, inv.destName||inv.shopName, inv.isTransfer?inv.sourceName:null, col);
    if(dupMsg){ showToast('⛔ '+dupMsg+' — исправьте номер'); return; }
    if(!_confirmTagCollisions(col, inv.destName||inv.shopName)) return;
  }
  if(!confirm('Сохранить исправления накладной?\n\n'+diff.join('\n'))) return;
  var total = items.reduce(function(s,it){ return s+(it.price||0)*(it.qty||1); },0);
  var who = (session&&(session.name||session.sellerName))||'admin';
  var upd = {num:num, date:date, items:items, total:total, editRequest:null, editedAt:new Date().toISOString(), editedBy:who};
  db.collection('iz_invoices').doc(iid).set(upd, {merge:true}).then(function(){
    var invs = getInvoices(); var ix = invs.findIndex(function(i){ return (i.id||i._id)===currentInvId; });
    if(ix>=0){ Object.assign(invs[ix], upd); saveInvoices(invs); }
    if(inv.isTransfer && inv.sourceName){
      try{ var p = _syncTransferWriteoff(iid, inv.sourceName, items, num); if(p && p.catch) p.catch(function(err){ showToast('⚠️ Списание у «'+inv.sourceName+'» не обновилось: '+(err&&err.message||err)); }); }catch(err){}
    }
    _invEd = null; clearInvProgress(iid);
    renderInvoices();
    openInvoice(currentInvId);
    showToast('✅ Накладная исправлена — теперь её можно принять');
  }).catch(function(err){ showToast('❌ Не сохранилось: '+(err&&err.message||err)); });
}
function updateInvMoTotal(){
  var totalAmt=0, totalQty=0, allQty=0;
  _currentInvItems.forEach(function(it,i){
    var q = it.qty||1;
    allQty += q;
    if(invCheckState[i] && invCheckState[i].ok){
      totalQty += q;
      totalAmt += (invCheckState[i].factPrice!=null?invCheckState[i].factPrice:it.price)*q;
    }
  });
  var qtyEl=document.getElementById('invMoTotalQty'); if(qtyEl) qtyEl.textContent=totalQty;
  var qtyAllEl=document.getElementById('invMoTotalQtyAll'); if(qtyAllEl) qtyAllEl.textContent=allQty;
  var amtEl=document.getElementById('invMoTotalAmt'); if(amtEl) amtEl.textContent=fmt(totalAmt);
}
function toggleInvItem(i){ invCheckState[i].ok=!invCheckState[i].ok; const ok=invCheckState[i].ok; const el=document.getElementById('invok'+i); if(el){el.textContent=ok?'✓':'';el.classList.toggle('checked',ok);} saveInvProgress(); updateInvMoTotal(); }
function checkInvDiff(i,orig){ const fEl=document.getElementById('invfact'+i),row=document.getElementById('invrow'+i); if(!fEl)return; const f=parseFloat(fEl.value)||0,diff=Math.abs(f-orig)>0; invCheckState[i].factPrice=f; if(fEl){fEl.style.borderColor=diff?'#f06060':'#2e2e3e';fEl.style.color=diff?'#f06060':'#f0f0f8';} saveInvProgress(); updateInvMoTotal(); }
function pauseInvoice(){
  saveInvProgress();
  closeMo('invMo');
  showToast('⏸ Прогресс сохранён — можно продолжить позже');
}
function acceptInvoice(){
  const who=gv('invWho'); if(!who){showToast('Укажите кто принял');return;}
  const invs=getInvoices(); const inv=invs.find(i=>(i.id||i._id)===currentInvId); if(!inv)return;
  if(typeof _findArtDupInItems==='function'){
    var _col3 = [];
    var _artDupMsg3 = _findArtDupInItems(inv.items, inv.id||inv._id, inv.destName||inv.shopName, inv.isTransfer?inv.sourceName:null, _col3);
    if(_artDupMsg3){ showToast('⛔ '+_artDupMsg3+' — исправьте номер через «✏️ Править» перед приёмкой'); return; }
    if(!_confirmTagCollisions(_col3, inv.destName||inv.shopName)) return;
  }
  var todayStr = _workingNowISO().split('T')[0];
  var invDate = inv.date||'';
  if(invDate && invDate < todayStr){
    if(!confirm('⚠️ Накладная от '+invDate+', а сегодня '+todayStr+'. Если принять сейчас — приход попадёт в смену за сегодня, а не за '+invDate+'. Продолжить?')){
      return;
    }
  }
  var invRef = db.collection('iz_invoices').doc(currentInvId);
  invRef.get({source:'server'}).then(function(snap){
    if(snap.exists && snap.data().status==='accepted'){
      showToast('⚠️ Эта накладная уже принята на другом устройстве ('+(snap.data().acceptedBy||'?')+'). Повторный приём отменён, чтобы не задвоить остатки.');
      closeMo('invMo'); renderInvoices();
      return;
    }
    _acceptInvoiceProceed(inv, who);
  }).catch(function(){
    _acceptInvoiceProceed(inv, who);
  });
}
function _acceptInvoiceProceed(inv, who){
  const invs=getInvoices();
  const inv2=JSON.parse(JSON.stringify(inv));
  const accepted=inv2.items.map((it,i)=>({...it,factPrice:(invCheckState[i]&&invCheckState[i].factPrice!=null?invCheckState[i].factPrice:it.price),ok:(invCheckState[i]&&invCheckState[i].ok)||false}));
  inv2.status='accepted'; inv2.acceptedBy=who; inv2.acceptedDate=new Date().toISOString().split('T')[0]; inv2.acceptedItems=accepted;
  const idx=invs.findIndex(i=>(i.id||i._id)===currentInvId); invs[idx]=inv2; saveInvoices(invs);
  // Цена в строке — за штуку: раньше количество не учитывалось (накладные мастерской идут по
  // одной вещи на строку), а отгрузка из другого магазина приходит строками «Ложка × 10».
  // ДР-позиции идут в остаток ДР, а не Дерева.
  var _isDrLine = function(a){ return (a.goodsType||inv2.goodsType)==='dr'; };
  const goodsTotal=accepted.reduce((s,a)=>s+a.factPrice*(a.qty||1),0);
  const _goodsDrTotal=accepted.reduce((s,a)=>s+(_isDrLine(a)?a.factPrice*(a.qty||1):0),0);
  var _rcvEntry = {id:uid(),type:'receive',ts:_workingNowISO(),icon:'📥',label:'Приёмка '+inv2.num+(inv2.isTransfer?' (из «'+inv2.sourceName+'»)':''),
    sub:inv2.items.length+' поз. · принял: '+who,amount:goodsTotal,amtCls:'neu',cashEffect:0,cardEffect:0,staffEffect:0,goodsEffect:goodsTotal-_goodsDrTotal,goodsDrEffect:_goodsDrTotal,
    goodsType:(_goodsDrTotal>0 && _goodsDrTotal===goodsTotal) ? 'dr' : (inv2.goodsType==='dr'?'derevo':(inv2.goodsType||'derevo')),
    invId:inv2.id||inv2._id, acceptedBy:who};
  journal.push(_rcvEntry);
  _recordJournalEntryIndependently(_rcvEntry, session&&session.shopName, 'receive');
  _backupCheckPassed = false;
  try{ stockApplyReceive(session&&session.shopName, accepted, inv2.acceptedDate, inv2.goodsType); }catch(e){}
  saveJ(); try{ db.collection('iz_invoices').doc(currentInvId).set(inv2); }catch(e){}
  clearInvProgress(currentInvId);
  closeMo('invMo'); renderAll(); renderInvoices(); renderReceiveArchive(); showToast('✅ Накладная принята');
}
var expType = 'zp';
var expGoodsType = 'derevo';
function setExpGoods(type, el){
  expGoodsType = type;
  var db = document.getElementById('expGoodsDerevo');
  var dr = document.getElementById('expGoodsDr');
  var stf = document.getElementById('expGoodsStaff');
  var dBlock = document.getElementById('expTypeDerevoBlock');
  var drBlock = document.getElementById('expTypeDrBlock');
  var stfBlock = document.getElementById('expTypeStaffBlock');
  var offStyle = 'flex:1;padding:8px;border-radius:10px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:600;cursor:pointer';
  if(db) db.style.cssText = type==='derevo' ? 'flex:1;padding:8px;border-radius:10px;border:2px solid #c8f060;background:#1e2a14;color:#c8f060;font-size:12px;font-weight:700;cursor:pointer' : offStyle;
  if(dr) dr.style.cssText = type==='dr' ? 'flex:1;padding:8px;border-radius:10px;border:2px solid #a060f0;background:#1e1a2e;color:#a060f0;font-size:12px;font-weight:700;cursor:pointer' : offStyle;
  if(stf) stf.style.cssText = type==='staff' ? 'flex:1;padding:8px;border-radius:10px;border:2px solid #60c8f0;background:#0c1a20;color:#60c8f0;font-size:12px;font-weight:700;cursor:pointer' : offStyle;
  if(dBlock) dBlock.style.display = type==='derevo' ? 'block' : 'none';
  if(drBlock) drBlock.style.display = type==='dr' ? 'block' : 'none';
  if(stfBlock) stfBlock.style.display = type==='staff' ? 'block' : 'none';
  expType = type==='derevo' ? 'zp' : 'inkass';
  document.getElementById('expSupplierBlock').style.display='none';
}
var _expPayMethod = 'cash';
function setExpPayMethod(m, el){
  _expPayMethod = m;
  document.querySelectorAll('#expPayMethodChips .pc').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
}
function setExpType(type, el){
  expType = type;
  document.querySelectorAll('#expTypeChips .pc, #expTypeDrChips .pc').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  var supBlock = document.getElementById('expSupplierBlock');
  if(supBlock) supBlock.style.display = (type==='supplier') ? 'block' : 'none';
  var payBlock = document.getElementById('expPayMethodBlock');
  if(payBlock) payBlock.style.display = (type==='zp'||type==='travel') ? 'block' : 'none';
  var forSellerBlock = document.getElementById('expForSellerBlock');
  if(forSellerBlock) forSellerBlock.style.display = (type==='zp'||type==='travel') ? 'block' : 'none';
  if(type!=='zp'&&type!=='travel'){
    _expPayMethod='cash';
    document.querySelectorAll('#expPayMethodChips .pc').forEach(function(p,i){ p.classList.toggle('active', i===0); });
    var toggleEl = document.getElementById('expForSellerToggle');
    if(toggleEl){ toggleEl.checked=false; toggleExpForSeller(false); }
  }
}
function openExpenseMo(){
  var toggleEl = document.getElementById('expForSellerToggle');
  if(toggleEl) toggleEl.checked=false;
  toggleExpForSeller(false);
  var sel = document.getElementById('expForSellerSelect');
  if(sel){
    var sellers = getSellers().filter(function(s){
      return !s.shops || !s.shops.length || s.shops.indexOf(session&&session.shopName)>=0;
    }).filter(function(s){ return s.name!==(session&&session.sellerName); });
    sel.innerHTML = sellers.map(function(s){ return '<option value="'+s.name.replace(/"/g,'&quot;')+'">'+s.name+'</option>'; }).join('');
  }
  openMo('expMo');
}
function toggleExpForSeller(checked){
  var sel = document.getElementById('expForSellerSelect');
  var hint = document.getElementById('expForSellerHint');
  if(sel) sel.style.display = checked ? 'block' : 'none';
  if(hint) hint.style.display = checked ? 'block' : 'none';
}
var _savingExpense = false;
function saveExpense(){
  var amt = parseFloat((document.getElementById('expAmt')||{}).value)||0;
  if(!amt){showToast('Введите сумму');return;}
  if(_savingExpense) return; // guards against double-tap / double-submit creating duplicate записи
  _savingExpense = true;
  setTimeout(function(){ _savingExpense = false; }, 1500);
  var comment = (document.getElementById('expComment')||{}).value||'';
  var supplier = (document.getElementById('expSupplierName')||{}).value||'';
  var labels = {zp:'💰 ЗП',travel:'🚌 Проезд',inkass:'🏦 Инкассация',other:'📝 Прочее',supplier:'🏭 Поставщику'};
  var isStaff = expGoodsType==='staff';
  var label = labels[expType] + (expGoodsType==='dr'?' (ДР)':(isStaff?' (Покупки сотр.)':''));
  var isDr = expGoodsType==='dr';
  var isZpOrTravel = (expType==='zp'||expType==='travel');
  var payMethod = isZpOrTravel ? _expPayMethod : 'cash';
  var payMethodLabels = {cash:'💵 наличными',transfer:'🏦 переводом',other:'📝 иначе'};
  var forSellerToggle = document.getElementById('expForSellerToggle');
  var forSellerSel = document.getElementById('expForSellerSelect');
  var forSeller = (isZpOrTravel && forSellerToggle && forSellerToggle.checked && forSellerSel) ? (forSellerSel.value||'') : '';
  var _expEntry = {
    id:uid(), type:'expense', ts:_workingNowISO(),
    icon:'💸', label:'Расход: '+label+(forSeller?' → '+forSeller:''),
    sub:fmt(amt)+(isZpOrTravel?' · '+payMethodLabels[payMethod]:'')+(forSeller?' · выдано: '+forSeller:'')+(supplier?' · '+supplier:'')+(comment?' · '+comment:''),
    expType, goodsType:expGoodsType, amount:amt, comment, supplier, payMethod, forSeller:(forSeller||null),
    amtCls:'exp', amtSign:'−',
    cashEffect: (isDr || isStaff || (isZpOrTravel && payMethod!=='cash'))?0:-amt,
    cashDrEffect: (isDr && !(isZpOrTravel && payMethod!=='cash'))?-amt:0,
    cardEffect:0, staffEffect: isStaff?-amt:0, goodsEffect:0
  };
  journal.push(_expEntry);
  _recordJournalEntryIndependently(_expEntry, session&&session.shopName, 'expense');
  _backupCheckPassed = false;
  saveJ();
  logExpense(expType, amt, comment);
  document.getElementById('expAmt').value='';
  document.getElementById('expComment').value='';
  if(document.getElementById('expSupplierName')) document.getElementById('expSupplierName').value='';
  expGoodsType='derevo'; setExpGoods('derevo', document.getElementById('expGoodsDerevo'));
  _expPayMethod='cash';
  if(forSellerToggle){ forSellerToggle.checked=false; toggleExpForSeller(false); }
  closeMo('expMo');
  renderAll();
  showToast(forSeller ? ('💸 Расход '+fmt(amt)+' записан — зачтётся продавцу '+forSeller) : ('💸 Расход '+fmt(amt)+' записан'));
}
var _manInvItems = [];
var _manInvCounter = 1;
function _showDraftSaved(elId){
  var el=document.getElementById(elId);
  if(!el) return;
  el.style.display='inline-flex';
  el.textContent='✅ Черновик сохранён — можно выйти';
  el.style.color='#60f090';
  clearTimeout(el._t);
  el._t=setTimeout(function(){
    el.textContent='💾 Черновик автосохраняется';
    el.style.color='#8888aa';
  }, 2000);
}
function _updateDraftBadges(){
  var hasinv=!!localStorage.getItem(_manInvDraftKey?_manInvDraftKey():'');
  var rcvBadge=document.getElementById('tabBadgeRcv');
  if(rcvBadge) rcvBadge.style.display=hasinv?'block':'none';
  var haswo=!!localStorage.getItem(_woDraftKey?_woDraftKey():'');
  var woBadge=document.getElementById('tabBadgeWo');
  if(woBadge) woBadge.style.display=haswo?'block':'none';
}
function _manInvDraftKey(){ return 'iz_man_inv_draft_'+(session&&session.shopName||''); }
function saveManInvDraft(){
  if(!session) return;
  var draft = {
    num: gv('manInvNum')||'', date: gv('manInvDate')||'', from: gv('manInvFrom')||'',
    goodsType: _manInvGoodsType||'derevo',
    items: _manInvItems
  };
  if(!draft.num && !draft.from && !_manInvItems.length){
    localStorage.removeItem(_manInvDraftKey());
    _updateDraftBadges();
    return;
  }
  localStorage.setItem(_manInvDraftKey(), JSON.stringify(draft));
  _showDraftSaved('manInvDraftStatus');
  _updateDraftBadges();
}
function loadManInvDraft(){
  if(!session) return false;
  try{
    var raw = localStorage.getItem(_manInvDraftKey());
    if(!raw) return false;
    var draft = JSON.parse(raw);
    if(!draft) return false;
    _manInvItems = draft.items||[];
    if(draft.goodsType) { _manInvGoodsType=draft.goodsType; setManInvType(draft.goodsType); }
    var numEl=document.getElementById('manInvNum'); if(numEl && draft.num) numEl.value=draft.num;
    var dateEl=document.getElementById('manInvDate'); if(dateEl && draft.date) dateEl.value=draft.date;
    var fromEl=document.getElementById('manInvFrom'); if(fromEl && draft.from) fromEl.value=draft.from;
    return _manInvItems.length>0 || !!draft.from;
  }catch(e){ return false; }
}
function clearManInvDraft(){ localStorage.removeItem(_manInvDraftKey()); }
function discardManInvDraft(){
  if(!confirm('Удалить черновик накладной? Все введённые позиции будут потеряны.')) return;
  clearManInvDraft();
  _manInvItems = []; _manInvExpanded = -1;
  var numEl=document.getElementById('manInvNum'); if(numEl) numEl.value='';
  var dateEl=document.getElementById('manInvDate'); if(dateEl) dateEl.value='';
  var fromEl=document.getElementById('manInvFrom'); if(fromEl) fromEl.value='';
  renderManInvItems(); updateManInvTotal();
  var banner=document.getElementById('manInvDraftBanner'); if(banner) banner.style.display='none';
  initManualInvoice();
}
function switchRcvMainTab(tab){
  var sections = {intake:'rcvMainSection_intake', archive:'rcvMainSection_archive'};
  var tabs = {intake:'rcvMainTab_intake', archive:'rcvMainTab_archive'};
  Object.keys(sections).forEach(function(t){
    var sec = document.getElementById(sections[t]);
    var btn = document.getElementById(tabs[t]);
    if(sec) sec.style.display = t===tab ? 'block' : 'none';
    if(btn){
      btn.style.borderWidth = t===tab ? '2px' : '1px';
      btn.style.background = t===tab ? '#1e2a14' : '#22222e';
      btn.style.color = t===tab ? '#c8f060' : '#8888aa';
      btn.style.borderColor = t===tab ? '#c8f060' : '#2e2e3e';
      btn.style.fontWeight = t===tab ? '700' : '400';
    }
  });
  if(tab==='archive') renderReceiveArchive();
}
function fmtRcvDate(dateStr){
  if(!dateStr) return '—';
  var d = new Date(dateStr+'T00:00:00');
  if(isNaN(d.getTime())) return dateStr;
  var wd = ['вс','пн','вт','ср','чт','пт','сб'][d.getDay()];
  return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'})+' ('+wd+')';
}
function _rcvInvoiceAmount(inv){
  if(inv.totalAmt!=null) return inv.totalAmt;
  return (inv.items||[]).reduce(function(s,it){
    var price = it.factPrice!=null ? it.factPrice : (it.price||0);
    return s+(it.qty||1)*price;
  },0);
}
function getAllAcceptedInvoicesForShop(){
  var shopName = session.shopName;
  var auto = getInvoices().filter(function(i){ return i.destName===shopName && i.status==='accepted'; })
    .map(function(i){ return Object.assign({}, i, {_src:'auto', _dateKey:i.acceptedDate||i.date||'—'}); });
  var manual = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]')
    .filter(function(i){ return i.destName===shopName && i.status==='accepted'; })
    .map(function(i){ return Object.assign({}, i, {_src:'manual', _dateKey:i.date||'—'}); });
  return auto.concat(manual);
}
function renderReceiveArchive(){
  var c = document.getElementById('rcvArchiveDates'); if(!c) return;
  closeRcvArchiveDate();
  var all = getAllAcceptedInvoicesForShop();
  if(!all.length){ c.innerHTML='<div class="empty"><div class="ei">🗄</div>Архив пуст</div>'; return; }
  var groups = {};
  all.forEach(function(inv){ (groups[inv._dateKey]=groups[inv._dateKey]||[]).push(inv); });
  var dates = Object.keys(groups).sort().reverse();
  c.innerHTML = dates.map(function(date){
    var items = groups[date];
    var total = items.reduce(function(s,i){ return s+_rcvInvoiceAmount(i); },0);
    return '<div class="card" style="cursor:pointer" onclick="openRcvArchiveDate(\''+date+'\')">'+
      '<div style="display:flex;justify-content:space-between;align-items:center">'+
        '<div><div style="font-weight:700;font-size:14px">'+fmtRcvDate(date)+'</div>'+
        '<div class="u-fs11-gray">'+items.length+' '+(items.length===1?'накладная':'накладных')+'</div></div>'+
        '<div style="display:flex;align-items:center;gap:6px">'+
          '<div style="font-size:15px;font-weight:700;color:#c8f060">'+Math.round(total).toLocaleString('ru-RU')+'₽</div>'+
          '<div style="color:#8888aa;font-size:14px">›</div>'+
        '</div>'+
      '</div>'+
    '</div>';
  }).join('');
}
function _receiveStillInOpenShift(inv){
  var iid = String(inv._id!=null?inv._id:inv.id);
  if(restoreMode) return true;
  return journal.some(function(e){
    if(e.type!=='receive') return false;
    if(inv._src==='manual') return e.invId===iid;
    return e.label==='Приёмка '+inv.num;
  });
}
function openRcvArchiveDate(date){
  var all = getAllAcceptedInvoicesForShop().filter(function(i){ return i._dateKey===date; });
  var listEl = document.getElementById('rcvArchiveDates');
  var detailEl = document.getElementById('rcvArchiveDetail');
  if(!detailEl) return;
  if(listEl) listEl.style.display='none';
  detailEl.style.display='block';
  var isAdmin = session && session.role==='shopadmin';
  var total = all.reduce(function(s,i){ return s+_rcvInvoiceAmount(i); },0);
  var html = '<button onclick="closeRcvArchiveDate()" style="margin-bottom:10px;padding:7px 12px;border-radius:8px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;cursor:pointer">← Назад к датам</button>'+
    '<div style="font-size:13px;color:#8888aa;margin-bottom:10px">'+fmtRcvDate(date)+' · '+all.length+' накладных · <b style="color:#c8f060">'+Math.round(total).toLocaleString('ru-RU')+'₽</b></div>';
  html += all.map(function(inv){
    var iid = String(inv._id!=null?inv._id:inv.id);
    var amt = _rcvInvoiceAmount(inv);
    var isManual = inv._src==='manual';
    var editFn = isManual ? "editManualInvoice('"+iid+"')" : "editShopInvoice('"+iid+"')";
    var delFn = isManual ? "deleteManualInvoice('"+iid+"')" : "deleteShopInvoice('"+iid+"')";
    var cardId = isManual ? 'maninv_'+iid : 'shinv_'+iid;
    var srcLabel = isManual ? '✏️ вручную' : '📦 из мастерской';
    var canEdit = isAdmin || _receiveStillInOpenShift(inv);
    var actionsHtml = canEdit
      ? '<div class="u-flex-g6">'+
          '<button onclick="'+editFn+'" style="flex:1;padding:7px;border-radius:8px;border:1px solid #2e2e3e;background:#22222e;color:#c8f060;font-size:11px;cursor:pointer">✏️ Исправить</button>'+
          '<button onclick="'+delFn+'" style="padding:7px 12px;border-radius:8px;border:1px solid #3e2020;background:#2a1010;color:#f06060;font-size:11px;cursor:pointer">🗑 Удалить</button>'+
        '</div>'
      : '<div style="font-size:11px;color:#8888aa;padding:6px 0">🔒 Смена закрыта — исправить может только администратор</div>';
    return '<div class="card" id="'+cardId+'" style="margin-bottom:8px">'+
      '<div style="display:flex;justify-content:space-between;margin-bottom:6px">'+
        '<div><div style="font-weight:700;font-size:13px">'+(inv.num||'')+'</div>'+
        '<div class="u-fs11-gray">'+(inv.from||inv.destName||'')+' · '+(inv.items||[]).length+' позиций · '+srcLabel+'</div></div>'+
        '<div style="font-size:14px;font-weight:700;color:#60f090;white-space:nowrap">'+Math.round(amt).toLocaleString('ru-RU')+'₽</div>'+
      '</div>'+
      actionsHtml+
    '</div>';
  }).join('');
  detailEl.innerHTML = html;
}
function closeRcvArchiveDate(){
  var listEl = document.getElementById('rcvArchiveDates');
  var detailEl = document.getElementById('rcvArchiveDetail');
  if(detailEl){ detailEl.style.display='none'; detailEl.innerHTML=''; }
  if(listEl) listEl.style.display='block';
}
function _updateManInvJsonBlock(){
  var el=document.getElementById('manInvJsonBlock');
  if(el) el.style.display=restoreMode?'block':'none';
}
function switchInvTab(tab) {
  _updateManInvJsonBlock();
  var tabs = ['incoming','manual'];
  tabs.forEach(function(t) {
    var sec = document.getElementById('invSection_'+t);
    var btn = document.getElementById('invTab_'+t);
    if(sec) sec.style.display = t===tab ? 'block' : 'none';
    if(btn) {
      btn.style.borderWidth = t===tab ? '2px' : '1px';
      btn.style.background = t===tab ? '#1e2a14' : '#22222e';
      btn.style.color = t===tab ? '#c8f060' : '#8888aa';
      btn.style.borderColor = t===tab ? '#c8f060' : '#2e2e3e';
      btn.style.fontWeight = t===tab ? '700' : '400';
    }
  });
  if(tab === 'incoming') renderInvoices();
  if(tab === 'manual') { initManualInvoice(); }
}
function shopAbbrev(shopName){
  if(!shopName) return 'Магазин';
  var map = {
    'роза хутор': 'РозаХутор',
    'розахутор': 'РозаХутор',
    'горки': 'Горки',
    'опт': 'ОПТ',
    'тг канал': 'ТГ',
    'тгканал': 'ТГ',
    'парк ривьера сочи': 'Ривьера',
    'instagram': 'Instagram',
    'мастерская': 'Мастерская'
  };
  var key = shopName.toLowerCase().trim();
  if(map[key]) return map[key];
  return shopName.replace(/\s+/g,'').slice(0,10);
}
function generateManInvNum(forDate){
  var d = forDate ? new Date(forDate+'T00:00:00') : new Date();
  if(isNaN(d.getTime())) d = new Date();
  var dd = String(d.getDate()).padStart(2,'0');
  var mm = String(d.getMonth()+1).padStart(2,'0');
  var yyyy = d.getFullYear();
  var shopName = (session && session.shopName) || '';
  var shopShort = shopAbbrev(shopName);
  var existing = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var monthKey = yyyy+'-'+mm;
  var monthInvs = existing.filter(function(inv){
    if(!inv.num) return false;
    var invDate = inv.date||'';
    return invDate.indexOf(monthKey)===0 && inv.destName===shopName;
  });
  var n = String(monthInvs.length + 1).padStart(3,'0');
  return n+'/'+dd+'.'+mm+'.'+yyyy+'/'+(shopShort||'Магазин');
}
function initManualInvoice() {
  try{ if(typeof _buildUsedArticleIndex==='function') _buildUsedArticleIndex(); }catch(e){}
  var hadInMemory = _manInvItems.length>0;
  var restored = false;
  if(!hadInMemory){
    restored = loadManInvDraft();
  }
  var dateEl = document.getElementById('manInvDate');
  if(dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
  var numEl = document.getElementById('manInvNum');
  if(numEl) {
    numEl.value = generateManInvNum(dateEl && dateEl.value);
  }
  renderManInvItems(); updateManInvTotal();
  var banner = document.getElementById('manInvDraftBanner');
  if(banner) banner.style.display = (restored || hadInMemory) && _manInvItems.length ? 'flex' : 'none';
}
var _manInvExpanded = -1; // index of currently expanded item (-1 = last)
function addManInvItem() {
  _manInvItems.push({name:'', article:'', species:'', qty:1, price:0});
  _manInvExpanded = _manInvItems.length - 1; // expand new item, collapse others
  renderManInvItems();
  saveManInvDraft();
  setTimeout(function(){
    var c=document.getElementById('manInvItems');
    if(c) c.lastElementChild && c.lastElementChild.scrollIntoView({behavior:'smooth',block:'nearest'});
  }, 80);
}
function _manInvToggle(i){
  _manInvExpanded = (_manInvExpanded===i) ? -1 : i;
  renderManInvItems();
}
function renderManInvItems() {
  var c = document.getElementById('manInvItems'); if(!c) return;
  if(!_manInvItems.length) {
    c.innerHTML='<div style="font-size:12px;color:#8888aa;padding:4px">Нет позиций — добавьте ниже</div>';
    return;
  }
  var expandIdx = _manInvExpanded >= 0 ? _manInvExpanded : _manInvItems.length - 1;
  var items = getItemsBase();
  c.innerHTML = _manInvItems.map(function(item, i) {
    var isOpen = (i === expandIdx);
    var isFilled = !!(item.name || item.article);
    var summary = (item.article?'№'+item.article+' ':'')+(item.name||'—')+(item.species?' · '+item.species:'')+(item.qty>1?' × '+item.qty:'')+(item.price?' · '+item.price+'₽':'');
    var dlId = 'manInvDl_'+i; // kept for compat but not used
    if(!isOpen && isFilled){
      return '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:10px;padding:7px 8px;margin-bottom:5px;display:flex;align-items:center;gap:6px">'+
        '<div style="flex-shrink:0;width:22px;height:22px;background:#2e2e3e;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#8888aa">'+(i+1)+'</div>'+
        '<div style="flex:1;overflow:hidden;min-width:0">'+
          '<div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+summary+'</div>'+
          '<div class="u-fs10-gray">'+(item.price?Math.round((item.qty||1)*item.price).toLocaleString('ru-RU')+'₽':'')+'</div>'+
        '</div>'+
        '<button type="button" onpointerdown="event.preventDefault();_manInvToggle('+i+')" '+
          'style="flex-shrink:0;background:#22222e;border:1px solid #3e3e4e;border-radius:8px;padding:5px 9px;color:#c8f060;font-size:13px;cursor:pointer">▼</button>'+
        '<button type="button" onpointerdown="event.preventDefault();_manInvDel('+i+')" '+
          'style="flex-shrink:0;background:none;border:1px solid #3e2e2e;border-radius:8px;padding:5px 8px;color:#f06060;font-size:12px;cursor:pointer">✕</button>'+
      '</div>';
    }
    return '<div style="background:#1a1a22;border:2px solid #c8f06055;border-radius:10px;padding:10px;margin-bottom:6px">'+
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">'+
        '<div style="flex-shrink:0;width:22px;height:22px;background:#c8f06033;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#c8f060">'+(i+1)+'</div>'+
        '<div style="font-size:10px;color:#c8f060;font-weight:700;flex:1">ПОЗИЦИЯ '+(i+1)+'</div>'+
        (isFilled ? '<button type="button" onpointerdown="event.preventDefault();_manInvToggle('+i+')" style="background:#22222e;border:1px solid #3e3e4e;border-radius:8px;padding:4px 9px;color:#8888aa;font-size:13px;cursor:pointer">▲</button>' : '')+
      '</div>'+
      '<div style="display:flex;gap:6px;margin-bottom:6px">'+
        '<div style="flex:0 0 90px">'+
          '<div class="u-fs10-gray-mb3">АРТИКУЛ</div>'+
          '<input class="fi u-inp-compact" value="'+item.article+'" placeholder="№" '+
            'oninput="_manInvArt('+i+',this.value)">'+
        '</div>'+
        '<div style="flex:1">'+
          '<div class="u-fs10-gray-mb3">НАИМЕНОВАНИЕ</div>'+
          '<div style="display:flex;gap:4px;position:relative">'+
            '<input class="fi" id="manInvName_'+i+'" value="'+item.name+'" placeholder="Название" autocomplete="off" '+
              'oninput="_manInvName('+i+',this.value);siAutoDetectAndSetType(this.value);psjSuggest(\'manInvName_'+i+'\',_manInvNameOptions(),\'_manInvPickName_'+i+'\')" '+
              'onfocus="psjSuggest(\'manInvName_'+i+'\',_manInvNameOptions(),\'_manInvPickName_'+i+'\')" '+
              'onblur="psjHideSugg(\'manInvName_'+i+'\');_manInvCheckNameDup('+i+');_manInvAutoFillFromCatalog('+i+')" style="margin:0;padding:8px;flex:1">'+
            '<div id="manInvName_'+i+'_sugg" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:25;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;max-height:180px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:2px"></div>'+
            '<button type="button" onclick="openManInvCatalogPicker('+i+')" title="Список из справочника" '+
              'style="background:#60c8f0;border:none;border-radius:8px;padding:6px 9px;font-weight:700;color:#0f0f13;cursor:pointer;font-size:13px;flex-shrink:0">📚</button>'+
          '</div>'+
          '<div id="manInvNameWarn_'+i+'" style="display:none;margin-top:5px;padding:7px 9px;background:#2e1a1a;border:1px solid #f06060;border-radius:8px;font-size:11px;color:#f06060"></div>'+
        '</div>'+
      '</div>'+
      '<div class="fg" style="margin-bottom:6px;position:relative">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">'+
          '<div class="u-fs10-gray-mb3" style="margin:0">ПОРОДА ДЕРЕВА</div>'+
          '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:#8888aa;cursor:pointer">'+
            '<input type="checkbox" '+(item._multiSpecies?'checked':'')+' onchange="_manInvToggleMultiSpecies('+i+',this.checked)"> неск. материалов'+
          '</label>'+
        '</div>'+
        (item._multiSpecies ? _manInvRenderSpeciesMulti(i, item) : (
        '<div class="u-flex-g6">'+
          '<input class="fi" id="manInvSpecies_'+i+'" value="'+(item.species||'')+'" placeholder="Порода" autocomplete="off" '+
            'oninput="_manInvSpeciesActive='+i+';_manInvSpecies('+i+',this.value);psjSuggest(\'manInvSpecies_'+i+'\',getSpecies(),\'_manInvPickSpeciesIdx\')" '+
            'onfocus="_manInvSpeciesActive='+i+';psjSuggest(\'manInvSpecies_'+i+'\',getSpecies(),\'_manInvPickSpeciesIdx\')" '+
            'onblur="psjHideSugg(\'manInvSpecies_'+i+'\');_manInvAutoFillFromCatalog('+i+')" style="margin:0;padding:8px;flex:1">'+
          (_rcvIsAdmin()?'<button type="button" onclick="_manInvAddSpecies('+i+')" style="background:#22222e;border:1px solid #f0c060;border-radius:10px;padding:0 14px;color:#f0c060;font-weight:700;cursor:pointer;flex-shrink:0">＋</button>':'')+
        '</div>'+
        '<div id="manInvSpecies_'+i+'_sugg" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:20;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;max-height:160px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:2px"></div>'))+
      '</div>'+
      '<div style="display:flex;gap:6px;align-items:center">'+
        '<div style="flex:1">'+
          '<div class="u-fs10-gray-mb3">КОЛ-ВО</div>'+
          '<input class="fi u-inp-compact" type="text" value="'+(item.qty&&item.qty!==1?item.qty:'')+'" placeholder="1" '+
            'oninput="_manInvQty('+i+',this.value)" inputmode="numeric">'+
        '</div>'+
        '<div style="flex:1">'+
          '<div class="u-fs10-gray-mb3">ЦЕНА ₽</div>'+
          '<input class="fi u-inp-compact" type="text" value="'+(item.price?item.price:'')+'" placeholder="0" '+
            'oninput="_manInvPrice('+i+',this.value)" inputmode="numeric">'+
        '</div>'+
        '<button type="button" onpointerdown="event.preventDefault();_manInvCopy('+i+')" '+
          'style="background:#1a2a1e;border:1px solid #60f090;border-radius:8px;padding:8px 10px;color:#60f090;font-size:11px;font-weight:700;cursor:pointer;margin-top:14px">📋</button>'+
        '<button type="button" onclick="_manInvDel('+i+')" '+
          'style="background:none;border:1px solid #3e2e2e;border-radius:8px;padding:8px 10px;color:#f06060;font-size:13px;cursor:pointer;margin-top:14px">✕</button>'+
      '</div>'+
    '</div>';
  }).join('');
  updateManInvTotal();
}
function _manInvName(i, val) { _manInvItems[i].name = val; updateManInvTotal(); saveManInvDraft(); }
function _manInvCheckNameDup(i){
  var warnEl = document.getElementById('manInvNameWarn_'+i);
  if(!warnEl || _manInvItems[i]==null) return;
  var name = (_manInvItems[i].name||'').trim();
  if(!name){ warnEl.style.display='none'; return; }
  var key = _manInvGoodsType==='dr' ? 'iz_goods_dr' : 'iz_goods_derevo';
  var existing = getRefBook(key);
  var norm = name.toLowerCase().trim();
  var exact = existing.some(function(g){ return ((g&&g.name)||g).toLowerCase().trim()===norm; });
  if(exact){ warnEl.style.display='none'; return; }
  var closeMatch=null, bestScore=0;
  existing.forEach(function(g){
    var gn=(g&&g.name)||g;
    var sc=nameSimilarity(norm, gn.toLowerCase().trim());
    if(sc>bestScore){ bestScore=sc; closeMatch=gn; }
  });
  warnEl.style.display='block';
  if(bestScore>=0.65 && closeMatch){
    warnEl.innerHTML = '⚠️ Похоже на существующее «'+closeMatch+'» — точно новое название? '+
      '<button type="button" onpointerdown="event.preventDefault();_manInvUseExistingName('+i+',\''+closeMatch.replace(/'/g,"\\'")+'\')" style="margin-left:4px;background:#f06060;border:none;border-radius:6px;padding:3px 8px;color:#1a0e0e;font-weight:700;font-size:10px;cursor:pointer">Использовать «'+closeMatch+'»</button>';
  } else {
    warnEl.innerHTML = '⚠️ Такого названия нет в справочнике «'+(_manInvGoodsType==='dr'?'ДР Товар':'Дерево')+'». Если это не опечатка — добавьте через 📚, чтобы оно попало в базу.';
  }
}
function _manInvUseExistingName(i, name){
  if(_manInvItems[i]==null) return;
  _manInvItems[i].name = name;
  var el = document.getElementById('manInvName_'+i); if(el) el.value = name;
  var warnEl = document.getElementById('manInvNameWarn_'+i); if(warnEl) warnEl.style.display='none';
  updateManInvTotal(); saveManInvDraft();
}
function openManInvCatalogPicker(i){
  var isDr = _manInvGoodsType==='dr';
  var key = isDr ? 'iz_goods_dr' : 'iz_goods_derevo';
  var items = getRefBook(key);
  var overlay = document.getElementById('manInvCatalogOverlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'manInvCatalogOverlay';
    overlay.className = 'mo';
    overlay.onclick = function(e){ if(e.target===overlay) overlay.classList.remove('open'); };
    document.body.appendChild(overlay);
  }
  window._micAllItems = items;
  window._micQuery = '';
  window._micCatOpen = {};
  window._micTargetIdx = i;
  _renderManInvCatalogPicker();
  overlay.classList.add('open');
  setTimeout(function(){ var inp=document.getElementById('micSearch'); if(inp) inp.focus(); }, 50);
}
function _micFilterInput(val){
  window._micQuery = (val||'').toLowerCase().trim();
  _renderManInvCatalogPicker();
}
function _micToggleCat(cat){
  window._micCatOpen = window._micCatOpen || {};
  window._micCatOpen[cat] = !(window._micCatOpen[cat]===true);
  _renderManInvCatalogPicker();
}
function _renderManInvCatalogPicker(){
  var overlay = document.getElementById('manInvCatalogOverlay'); if(!overlay) return;
  var isDr = _manInvGoodsType==='dr';
  var items = window._micAllItems||[];
  var q = window._micQuery||'';
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
  window._micCatOpen = window._micCatOpen || {};
  var targetIdx = window._micTargetIdx;
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
        return (a.species||'').toLowerCase().localeCompare((b.species||'').toLowerCase(),'ru');
      });
      var open = !!q || window._micCatOpen[cat]===true;
      var header = '<div onclick="_micToggleCat(\''+cat.replace(/'/g,"\\'")+'\')" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding:9px 10px;margin:8px 0 4px;background:#1a1a22;border-radius:8px">'+
        '<span style="font-size:11px;color:#c8f060;font-weight:700;text-transform:uppercase;letter-spacing:.5px">'+cat+' ('+list.length+')</span>'+
        '<span style="color:#8888aa;font-size:11px">'+(open?'▾':'▸')+'</span>'+
      '</div>';
      if(!open) return header;
      return header + list.map(function(it){
          var priceStr = (isDr || it.article) ? (' · '+Math.round(it.price||0).toLocaleString('ru-RU')+'₽'+(it.article?' · №'+it.article:'')) : '';
          var speciesStr = (!isDr && it.species) ? ' · '+it.species : '';
          return '<div onclick="_micPick('+targetIdx+',\''+(it.name||'').replace(/'/g,"\\'")+'\','+(it.price||0)+',\''+(it.article||'').replace(/'/g,"\\'")+'\',\''+(it.species||'').replace(/'/g,"\\'")+'\')" '+
            'style="padding:9px 10px;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;margin-bottom:5px;cursor:pointer;font-size:13px">'+
            (it.name||'')+'<span style="color:#8888aa;font-size:12px">'+speciesStr+priceStr+'</span>'+
          '</div>';
        }).join('');
    }).join('');
  overlay.innerHTML = '<div class="md">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<div style="font-size:15px;font-weight:700">'+(isDr?'🛍 ДР Товар':'🌳 Дерево')+' — список</div>'+
      '<button onclick="document.getElementById(\'manInvCatalogOverlay\').classList.remove(\'open\')" style="background:#22222e;border:1px solid #2e2e3e;border-radius:8px;width:30px;height:30px;color:#8888aa;font-size:16px;cursor:pointer">✕</button>'+
    '</div>'+
    '<input id="micSearch" class="fi" placeholder="Поиск по названию..." autocomplete="off" oninput="_micFilterInput(this.value)" style="margin-bottom:8px" value="'+(q||'').replace(/"/g,'&quot;')+'">'+
    '<div style="max-height:60vh;overflow-y:auto">'+body+'</div>'+
  '</div>';
}
function _micPick(i, name, price, article, species){
  if(_manInvItems[i]==null) return;
  _manInvItems[i].name = name;
  if(price) _manInvItems[i].price = price;
  if(article) _manInvItems[i].article = article;
  if(species) _manInvItems[i].species = species;
  var overlay = document.getElementById('manInvCatalogOverlay'); if(overlay) overlay.classList.remove('open');
  updateManInvTotal(); saveManInvDraft();
  renderManInvItems();
}
function _manInvPickNameAt(i,val){
  if(_manInvItems[i]!=null){ _manInvItems[i].name=val; siAutoDetectAndSetType(val); }
  var el=document.getElementById('manInvName_'+i); if(el) el.value=val;
  updateManInvTotal(); saveManInvDraft();
  renderManInvItems();
}
(function(){
  for(var _ii=0;_ii<50;_ii++){
    (function(idx){
      window['_manInvPickName_'+idx]=function(val){ _manInvPickNameAt(idx,val); };
    })(_ii);
  }
})();
function _manInvArt(i, val) { _manInvItems[i].article = val; saveManInvDraft(); }
function _manInvSpecies(i, val) { if(_manInvItems[i]) _manInvItems[i].species = val; saveManInvDraft(); }
var _manInvSpeciesActive = 0;
function _manInvPickSpeciesIdx(val){
  var i = _manInvSpeciesActive;
  var el = document.getElementById('manInvSpecies_'+i);
  if(el) el.value = val;
  if(_manInvItems[i]) _manInvItems[i].species = val;
  var box = document.getElementById('manInvSpecies_'+i+'_sugg');
  if(box) box.style.display = 'none';
  saveManInvDraft();
  _manInvAutoFillFromCatalog(i);
}
function _manInvAutoFillFromCatalog(i){
  if(_manInvGoodsType==='dr') return;
  var item = _manInvItems[i]; if(!item) return;
  if(item.article) return; // артикул уже указан вручную или из списка — не перезаписываем
  var name = (item.name||'').trim(), species = (item.species||'').trim();
  if(!name || !species) return;
  var norm = name.toLowerCase(), normSp = species.toLowerCase();
  var match = (getRefBook('iz_goods_derevo')||[]).find(function(c){
    return c.article && (c.name||'').toLowerCase().trim()===norm && (c.species||'').toLowerCase().trim()===normSp;
  });
  if(match){
    item.price = match.price;
    item.article = match.article;
    saveManInvDraft();
    setTimeout(function(){
      renderManInvItems();
      showToast('✅ Подтянуто из каталога: '+match.price+'₽ · арт. '+match.article);
    }, 0);
    return;
  }
  // Совпадения по каталогу нет — позиция принимается без артикула (по наименованию и породе).
  // Раньше система сама сочиняла артикул («Ложка»+«Орех» → «ЛОЖКОР»,
  // «Спил»+«Липа» → «СПИЛЛИП»), которого нет в каталоге, — и проверка прихода тут же отвергала
  // его же как несуществующий. Артикулы заводит только админ в «С артикулом вручную».
}
function _manInvAddSpecies(i){
  if(!_rcvIsAdmin()){ showToast('Добавлять породы в справочник может только администратор'); return; }
  var el = document.getElementById('manInvSpecies_'+i);
  var val = (el && el.value || '').trim();
  if(!val){ showToast('Введите породу'); return; }
  var list = getSpecies();
  var norm = val.toLowerCase().trim();
  var exact = list.find(function(s){ return (s.name||s).toLowerCase().trim()===norm; });
  if(exact){ showToast('Уже есть: «'+(exact.name||exact)+'»'); return; }
  var closeMatch=null, bestScore=0;
  list.forEach(function(s){ var sc=nameSimilarity(norm,(s.name||s).toLowerCase().trim()); if(sc>bestScore){bestScore=sc;closeMatch=s;} });
  if(bestScore>=0.65 && closeMatch){
    showDupWarning(val, closeMatch.name||closeMatch, function(useEx){
      if(!useEx){ saveSpecies(val); showToast('✅ Добавлено: '+val); }
    });
    return;
  }
  saveSpecies(val);
  showToast('✅ Добавлено в породы дерева: '+val);
}
// Браслеты/бусы/чётки часто сделаны не из одной породы (дерево+камень, две породы дерева) —
// раньше это приходилось впихивать одной строкой в «Порода», не разобрать потом что где.
// Галочка «неск. материалов» превращает поле в список строк; служебные _multiSpecies/_speciesParts
// живут только на элементе черновика (._manInvItems[i]) и не попадают в сохранённую накладную —
// saveManualInvoice() собирает items только из настоящих полей (name/article/species/qty/price).
// Итоговая item.species всегда остаётся обычной строкой через « + », как и везде в системе.
function _manInvToggleMultiSpecies(i, checked){
  var item = _manInvItems[i]; if(!item) return;
  item._multiSpecies = checked;
  if(checked){
    if(!item._speciesParts || !item._speciesParts.length) item._speciesParts = [item.species||''];
  } else {
    _manInvRecombineSpecies(i);
  }
  renderManInvItems();
  saveManInvDraft();
}
function _manInvRenderSpeciesMulti(i, item){
  var parts = item._speciesParts && item._speciesParts.length ? item._speciesParts : [''];
  return '<div style="display:flex;flex-direction:column;gap:6px">'+
    parts.map(function(val, pIdx){
      var esc = (val||'').replace(/"/g,'&quot;');
      return '<div style="display:flex;gap:6px;position:relative">'+
        '<input class="fi" id="manInvSpeciesPart_'+i+'_'+pIdx+'" value="'+esc+'" placeholder="Материал '+(pIdx+1)+'" autocomplete="off" style="margin:0;padding:8px;flex:1" '+
          'oninput="_manInvSpeciesPartActive={row:'+i+',part:'+pIdx+'};_manInvSpeciesPartInput('+i+','+pIdx+',this.value);psjSuggest(\'manInvSpeciesPart_'+i+'_'+pIdx+'\',getSpecies(),\'_manInvPickSpeciesPartIdx\')" '+
          'onfocus="_manInvSpeciesPartActive={row:'+i+',part:'+pIdx+'};psjSuggest(\'manInvSpeciesPart_'+i+'_'+pIdx+'\',getSpecies(),\'_manInvPickSpeciesPartIdx\')" '+
          'onblur="psjHideSugg(\'manInvSpeciesPart_'+i+'_'+pIdx+'\');_manInvAutoFillFromCatalog('+i+')">'+
        (parts.length>1 ? '<button type="button" onpointerdown="event.preventDefault();_manInvRemoveSpeciesPart('+i+','+pIdx+')" style="background:none;border:1px solid #3e2e2e;border-radius:8px;padding:0 10px;color:#f06060;cursor:pointer;flex-shrink:0">✕</button>' : '')+
        '<div id="manInvSpeciesPart_'+i+'_'+pIdx+'_sugg" style="display:none;position:absolute;top:100%;left:0;right:36px;z-index:20;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;max-height:160px;overflow-y:auto;margin-top:2px"></div>'+
      '</div>';
    }).join('')+
    '<button type="button" onpointerdown="event.preventDefault();_manInvAddSpeciesPart('+i+')" style="align-self:flex-start;background:#22222e;border:1px solid #f0c060;border-radius:8px;padding:6px 12px;color:#f0c060;font-size:11px;font-weight:700;cursor:pointer">＋ Добавить материал</button>'+
  '</div>';
}
function _manInvRecombineSpecies(i){
  var item = _manInvItems[i]; if(!item) return;
  var parts = item._speciesParts || [];
  item.species = parts.filter(function(p){ return p && p.trim(); }).join(' + ');
}
function _manInvSpeciesPartInput(i, pIdx, val){
  var item = _manInvItems[i]; if(!item) return;
  if(!item._speciesParts) item._speciesParts = [''];
  item._speciesParts[pIdx] = val;
  _manInvRecombineSpecies(i);
  saveManInvDraft();
}
function _manInvAddSpeciesPart(i){
  var item = _manInvItems[i]; if(!item) return;
  if(!item._speciesParts) item._speciesParts = [''];
  item._speciesParts.push('');
  renderManInvItems();
  saveManInvDraft();
  var last = item._speciesParts.length-1;
  setTimeout(function(){ var el=document.getElementById('manInvSpeciesPart_'+i+'_'+last); if(el) el.focus(); }, 0);
}
function _manInvRemoveSpeciesPart(i, pIdx){
  var item = _manInvItems[i]; if(!item) return;
  item._speciesParts.splice(pIdx,1);
  if(!item._speciesParts.length) item._speciesParts=[''];
  _manInvRecombineSpecies(i);
  renderManInvItems();
  saveManInvDraft();
}
var _manInvSpeciesPartActive = {row:-1, part:-1};
function _manInvPickSpeciesPartIdx(val){
  var row = _manInvSpeciesPartActive.row, part = _manInvSpeciesPartActive.part;
  if(row<0 || part<0) return;
  var item = _manInvItems[row]; if(!item) return;
  if(!item._speciesParts) item._speciesParts = [''];
  item._speciesParts[part] = val;
  var el = document.getElementById('manInvSpeciesPart_'+row+'_'+part); if(el) el.value = val;
  _manInvRecombineSpecies(row);
  var box = document.getElementById('manInvSpeciesPart_'+row+'_'+part+'_sugg'); if(box) box.style.display='none';
  saveManInvDraft();
  _manInvAutoFillFromCatalog(row);
}
function _manInvQty(i, val) { _manInvItems[i].qty = parseFloat(val)||1; updateManInvTotal(); saveManInvDraft(); }
function _manInvPrice(i, val) { _manInvItems[i].price = parseFloat(val)||0; updateManInvTotal(); saveManInvDraft(); }
function _manInvDel(i) { _manInvItems.splice(i,1); renderManInvItems(); saveManInvDraft(); }
function _manInvCopy(i) {
  var src = _manInvItems[i];
  var copy = {name:src.name||'', species:src.species||'', qty:src.qty||1, price:src.price||0, article:''};
  _manInvItems.splice(i+1, 0, copy);
  _manInvExpanded = i+1;
  renderManInvItems();
  saveManInvDraft();
  showToast('📋 Позиция скопирована');
}
function updateManInvTotal() {
  var total = _manInvItems.reduce(function(s,it){ return s+(it.qty||1)*(it.price||0); }, 0);
  var totalQty = _manInvItems.reduce(function(s,it){ return s+(it.qty||1); }, 0);
  var el = document.getElementById('manInvTotal');
  if(el) el.innerHTML = _manInvItems.length
    ? '<div style="display:flex;justify-content:space-between;align-items:center;background:#1e2a14;border:1px solid #c8f060;border-radius:10px;padding:10px 14px;font-weight:700">'+
        '<span style="color:#8888aa;font-size:13px">Итого: '+totalQty+' шт. · '+_manInvItems.length+' '+(_manInvItems.length===1?'позиция':'позиций')+'</span>'+
        '<span style="color:#c8f060;font-size:16px">'+Math.round(total).toLocaleString('ru-RU')+'₽</span>'+
      '</div>'
    : '';
}
var _manInvGoodsType = 'derevo';
function setAdminInvType(invId, type){
  var _existing = window._manInvEdit[invId];
  if(_existing && _existing.goodsType===type) return;
  if(_existing && (_existing.items||[]).length && !confirm('Сменить категорию накладной на '+(type==='dr'?'🛍 ДР Товар':'🌳 Дерево')+'? В накладной уже '+_existing.items.length+' позици'+(_existing.items.length===1?'я':(_existing.items.length<5?'и':'й'))+' — проверьте, что не ошиблись.')) return;
  window._manInvEdit[invId] = window._manInvEdit[invId]||{};
  window._manInvEdit[invId].goodsType = type;
  var btnD = document.getElementById('adminInvTypeDerevo_'+invId);
  var btnDr = document.getElementById('adminInvTypeDr_'+invId);
  if(btnD){ btnD.style.borderColor = type==='derevo'?'#c8f060':'#2e2e3e'; btnD.style.background = type==='derevo'?'#1e2a14':'#22222e'; btnD.style.color = type==='derevo'?'#c8f060':'#8888aa'; }
  if(btnDr){ btnDr.style.borderColor = type==='dr'?'#a060f0':'#2e2e3e'; btnDr.style.background = type==='dr'?'#1e1a2e':'#22222e'; btnDr.style.color = type==='dr'?'#a060f0':'#8888aa'; }
}
// Смена категории здесь не трогает уже добавленные позиции — они остаются как есть, но
// дальнейшие подсказки/каталог будут уже по другой категории. Если в накладную уже что-то
// добавлено, случайный тап не по той кнопке легко остаётся незамеченным — просим подтверждение.
function setManInvType(type){
  if(type===_manInvGoodsType) return;
  if(_manInvItems.length && !confirm('Сменить категорию накладной на '+(type==='dr'?'🛍 ДР Товар':'🌳 Дерево')+'? В накладной уже '+_manInvItems.length+' позици'+(_manInvItems.length===1?'я':(_manInvItems.length<5?'и':'й'))+' — проверьте, что не ошиблись.')) return;
  _manInvGoodsType = type;
  var btnD = document.getElementById('manInvTypeDerevo');
  var btnDr = document.getElementById('manInvTypeDr');
  if(btnD){ btnD.style.borderColor = type==='derevo'?'#c8f060':'#2e2e3e'; btnD.style.background = type==='derevo'?'#1e2a14':'#22222e'; btnD.style.color = type==='derevo'?'#c8f060':'#8888aa'; }
  if(btnDr){ btnDr.style.borderColor = type==='dr'?'#a060f0':'#2e2e3e'; btnDr.style.background = type==='dr'?'#1e1a2e':'#22222e'; btnDr.style.color = type==='dr'?'#a060f0':'#8888aa'; }
}
// Приход вручную раньше принимал любой текст: продавец завёл лопатки с выдуманными артикулами
// (ЛОПАМИК1…) и несуществующей породой «Микс», которую сам же добавил в справочник кнопкой «＋».
// Теперь у продавца: артикул — только номер изделия (цифры) или артикул из каталога «С артикулом
// вручную»; наименование и порода — только из справочников, иначе заявка администратору
// (тот же баннер, что в продаже). Администратора не проверяем — заявки летят ему же.
function _rcvIsAdmin(){ return !!(session && session.role==='shopadmin'); }
function _rcvCheckItemsAgainstCatalog(items, goodsType, onlyIdx){
  if(_rcvIsAdmin()) return null;
  var catalog = getRefBook(goodsType==='dr' ? 'iz_goods_dr' : 'iz_goods_derevo') || [];
  var names = {};
  catalog.forEach(function(g){ var n = String((g&&g.name)||g||'').toLowerCase().trim(); if(n) names[n] = true; });
  var catalogArts = _catalogArticleSet();
  var species = {};
  getSpecies().forEach(function(sp){ species[String(sp||'').toLowerCase().trim()] = true; });
  // Несуществующие артикулы — все сразу, а не по одному: раньше продавец исправлял поз. 5,
  // жал «Принять» и получал ту же ошибку про поз. 7, и так по кругу.
  var badArts = [];
  for(var j=0;j<(items||[]).length;j++){
    if(onlyIdx && !onlyIdx[j]) continue;
    var itj = items[j]; if(!itj || !String(itj.name||'').trim()) continue;
    var artj = String(itj.article||itj.num||'').trim();
    if(artj && !/^\d+$/.test(artj) && !catalogArts[artj.toLowerCase()]) badArts.push({idx:j, bad:artj});
  }
  if(badArts.length) return {type:'article', list:badArts};
  for(var i=0;i<(items||[]).length;i++){
    if(onlyIdx && !onlyIdx[i]) continue;
    var it = items[i]; if(!it) continue;
    var nm = String(it.name||'').trim(); if(!nm) continue;
    if(!names[nm.toLowerCase()]) return {type:'name', item:it, idx:i};
    if(goodsType!=='dr'){
      var parts = String(it.species||'').split(/\s*\+\s*/);
      for(var p=0;p<parts.length;p++){
        var part = parts[p].trim();
        if(part && !species[part.toLowerCase()]) return {type:'species', item:it, idx:i, bad:part};
      }
    }
  }
  return null;
}
function _rcvReportCatalogIssue(iss, goodsType, items, rerender){
  if(iss.type==='article'){
    var lst = iss.list.map(function(x){ return 'поз. '+(x.idx+1)+' «'+x.bad+'»'; }).join(', ');
    var msg = 'Таких артикулов нет в каталоге: '+lst+'.\n\nАртикул может быть только номером изделия (цифры), артикулом из каталога или пустым — тогда обязательна порода.';
    if(items && confirm(msg+'\n\nОчистить поле «Артикул» у этих позиций?')){
      iss.list.forEach(function(x){ if(items[x.idx]){ items[x.idx].article=''; items[x.idx].num=''; } });
      if(rerender) rerender();
      showToast('Артикулы очищены у '+iss.list.length+' поз. — проверьте, что у них указана порода, и сохраните снова');
    } else if(!items){ showToast('⛔ '+msg); }
    return;
  }
  if(iss.type==='name'){ showNameRequestBanner(iss.item.name, iss.item.species, iss.item.price, goodsType, 'name'); return; }
  showNameRequestBanner(iss.item.name, iss.bad, iss.item.price, goodsType, 'species');
}
function saveManualInvoice() {
  if(!_manInvItems.length) { showToast('Добавьте позиции'); return; }
  var _rcvIss = _rcvCheckItemsAgainstCatalog(_manInvItems, _manInvGoodsType);
  if(_rcvIss){ _rcvReportCatalogIssue(_rcvIss, _manInvGoodsType, _manInvItems, function(){ renderManInvItems(); saveManInvDraft(); }); return; }
  if(_manInvGoodsType!=='dr'){
    for(var _vi=0; _vi<_manInvItems.length; _vi++){
      var _vit = _manInvItems[_vi];
      if(!_vit || !(_vit.name||'').trim()) continue;
      if(!_vit.article && !(_vit.species||'').trim()){
        // Раньше: «без артикула порода обязательна» — продавцы читали это как «впиши артикул» и
        // выдумывали его (ЛОПАМИК…), лишь бы не указывать породу. Артикул не нужен, если его нет в базе.
        showToast('⛔ Выберите породу из списка для «'+_vit.name+'» (поз. '+(_vi+1)+'). Артикул не нужен, если его нет в базе — оставьте поле пустым');
        return;
      }
    }
  }
  // Переоценка: те же изделия (те же номера) возвращаются на баланс по новой цене — проверки на
  // «номер уже занят» и «похожая накладная» к ней не применяются.
  var isReval = !!(document.getElementById('manInvReval')||{}).checked;
  if(!isReval && typeof _findArtDupInItems==='function'){
    var _col0 = [];
    var _artDupMsg0 = _findArtDupInItems(_manInvItems, null, session&&session.shopName, null, _col0);
    if(_artDupMsg0){ showToast('⛔ '+_artDupMsg0+' — исправьте номер'); return; }
    if(!_confirmTagCollisions(_col0, session&&session.shopName)) return;
  }
  var num = (document.getElementById('manInvNum')||{}).value || 'НАК-???';
  var docDate = (document.getElementById('manInvDate')||{}).value || new Date().toISOString().split('T')[0];
  var from = (document.getElementById('manInvFrom')||{}).value || '';
  var totalAmt = _manInvItems.reduce(function(s,it){ return s+(it.qty||1)*(it.price||0); }, 0);
  // Эта форма — второй, независимый способ внести накладную вручную (Склад.js, вкладка
  // Приход), и раньше здесь вообще не было проверки на дубли — только в форме смены (смены.js)
  // такая проверка была. Именно через отсутствие проверки в одной из двух форм 14.07 была
  // задвоена реальная поставка — используем ту же общую проверку в обеих формах.
  if(!isReval && typeof _findDuplicateInvoiceCandidate==='function'){
    var possibleDupManInv = _findDuplicateInvoiceCandidate(session.shopName, _manInvItems, totalAmt, docDate);
    if(!_confirmNotDuplicateInvoice(possibleDupManInv, totalAmt, _manInvItems.length)) return;
  }
  if(from) saveSupplier(from);
  var now = new Date();
  var acceptedDateStr = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  var inv = {
    id: uid(), num: num, date: acceptedDateStr, docDate: docDate, from: from,
    destName: session.shopName,
    goodsType: _manInvGoodsType,
    items: _manInvItems.map(function(it){ return {name:it.name, article:it.article, species:it.species, qty:it.qty, price:it.price}; }),
    totalAmt: totalAmt,
    status: 'accepted',
    acceptedAt: now.toISOString(),
    acceptedDate: now.toLocaleDateString('ru-RU'),
    createdBy: session.sellerName || session.name || '',
    manual: true
  };
  if(isReval) inv.isRevaluation = true;
  var existing = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  existing.unshift(inv);
  localStorage.setItem('iz_manual_invoices', JSON.stringify(existing));
  db.collection('iz_manual_invoices').doc(inv.id).set(inv).catch(function(e){
    console.log('[saveManualInvoice] ошибка сохранения в облако:', e);
    _queuePendingInvoice('iz_manual_invoices', inv);
    showToast('⚠️ Накладная сохранена только на телефоне — досошлётся автоматически, когда появится связь');
  });
  try{ _backupInvoiceIndependently(inv); }catch(e){}
  var _gt4save = _manInvGoodsType || 'derevo';
  // Раньше здесь новое название+порода+артикул из приёмки автоматически добавлялись в каталог
  // «С артикулом вручную» (_woodCatalogAutoRegister) — но этот раздел админ ведёт сама, вручную,
  // и такие «подсаженные» записи (например, накладная с артикулами от мастерской) там были не
  // нужны и не ожидались. Теперь приёмка использует системный артикул только для этой конкретной
  // накладной — каталог «С артикулом вручную» пополняет только сама админ через «+».
  _manInvItems.forEach(function(item){
    autoSaveToItemBase(item.name, item.article, item.price, _gt4save);
  });
  var _isDrInv = _manInvGoodsType === 'dr';
  var _manRcvEntry = {
    id:uid(), type:'receive', ts:_workingNowISO(), icon:'📥',
    label:(isReval?'🔄 ПЕРЕОЦЕНКА · ':'')+'Приёмка '+num+(_isDrInv?' (ДР)':''),
    sub:_manInvItems.length+' изд.'+(from?' · от '+from:'')+(inv.createdBy?' · принял: '+inv.createdBy:''),
    amount:totalAmt,
    amtCls:'neu', cashEffect:0, cardEffect:0, staffEffect:0,
    goodsEffect: _isDrInv ? 0 : totalAmt,
    goodsDrEffect: _isDrInv ? totalAmt : 0,
    goodsType: _manInvGoodsType,
    invId:inv.id, acceptedBy:inv.createdBy||''
  };
  if(isReval) _manRcvEntry.isRevaluation = true;
  journal.push(_manRcvEntry);
  if(isReval){
    // на складе переоценка только обновляет цену изделий с номером (qty не растёт) — см. stockApplyReceive
    try{ stockApplyReceive(session.shopName, _manInvItems.map(function(it){ return {num:it.article||it.num, name:it.name, price:it.price, qty:it.qty, species:it.species, goodsType:_gt4save}; }), acceptedDateStr, _gt4save, true); }catch(e){}
    try{ logAction('REVALUATION', {direction:'receive', goodsType:_gt4save, itemCount:_manInvItems.length, names:_manInvItems.map(function(it){return it.name;}).join(', '), amount:totalAmt, shop:session.shopName, invNum:num}); }catch(e){}
  }
  var _rvBox=document.getElementById('manInvReval'); if(_rvBox) _rvBox.checked=false;
  _manInvGoodsType = 'derevo'; setManInvType('derevo'); // reset
  saveJ();
  _manInvItems = [];
  var numEl = document.getElementById('manInvNum');
  if(numEl) {
    var dateElAfter = document.getElementById('manInvDate');
    numEl.value = generateManInvNum(dateElAfter && dateElAfter.value);
  }
  var fromEl = document.getElementById('manInvFrom'); if(fromEl) fromEl.value='';
  clearManInvDraft();
  var banner=document.getElementById('manInvDraftBanner'); if(banner) banner.style.display='none';
  renderManInvItems();
  renderReceiveArchive();
  renderAll();
  showToast((isReval?'🔄 Переоценка ':'✅ Накладная ')+num+' принята на баланс');
}
window._manInvEdit = window._manInvEdit || {};
function editManualInvoice(id){
  try{ if(typeof _buildUsedArticleIndex==='function') _buildUsedArticleIndex(); }catch(e){}
  var all = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var inv = all.find(function(i){ return String(i._id!=null?i._id:i.id)===id; });
  if(!inv) return;
  var card = document.getElementById('maninv_'+id); if(!card) return;
  window._manInvEdit[id] = JSON.parse(JSON.stringify(inv));
  var curType3 = inv.goodsType || (inv.category==='dr'?'dr':'derevo');
  var bD3 = curType3==='derevo'
    ? 'flex:1;padding:9px;border-radius:10px;border:2px solid #c8f060;background:#1e2a14;color:#c8f060;font-size:12px;font-weight:700;cursor:pointer'
    : 'flex:1;padding:9px;border-radius:10px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:700;cursor:pointer';
  var bDr3 = curType3==='dr'
    ? 'flex:1;padding:9px;border-radius:10px;border:2px solid #a060f0;background:#1e1a2e;color:#a060f0;font-size:12px;font-weight:700;cursor:pointer'
    : 'flex:1;padding:9px;border-radius:10px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:700;cursor:pointer';
  card.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:#c8f060;margin-bottom:8px">✏️ Исправление: '+(inv.num||'')+'</div>'+
    '<div class="fg" style="margin-bottom:6px"><label class="fl">Номер</label><input class="fi" id="maninv_num_'+id+'" value="'+(inv.num||'')+'" style="margin:0;padding:7px"></div>'+
    '<div class="fg" style="margin-bottom:6px"><label class="fl">Дата приёмки</label><input class="fi" type="date" id="maninv_date_'+id+'" value="'+(inv.date||'')+'" style="margin:0;padding:7px;-webkit-appearance:none;color-scheme:dark"></div>'+
    '<div class="fg" style="margin-bottom:6px"><label class="fl">Дата накладной</label><input class="fi" type="date" id="maninv_docdate_'+id+'" value="'+(inv.docDate||inv.date||'')+'" style="margin:0;padding:7px;-webkit-appearance:none;color-scheme:dark"></div>'+
    '<div class="fg" style="margin-bottom:6px"><label class="fl">От кого</label><input class="fi" id="maninv_from_'+id+'" value="'+(inv.from||'')+'" style="margin:0;padding:7px"></div>'+
    '<div style="font-size:10px;color:#8888aa;margin-bottom:4px">ТИП ТОВАРА</div>'+
    '<div style="display:flex;gap:8px;margin-bottom:10px">'+
      '<button type="button" id="maninvTypeDerevo_'+id+'" onpointerdown="event.preventDefault();setSellerInvType(\''+id+'\',\'derevo\')" style="'+bD3+'">🌳 Дерево</button>'+
      '<button type="button" id="maninvTypeDr_'+id+'" onpointerdown="event.preventDefault();setSellerInvType(\''+id+'\',\'dr\')" style="'+bDr3+'">🛍 ДР Товар</button>'+
    '</div>'+
    '<div style="font-size:10px;color:#8888aa;margin-bottom:4px">ПОЗИЦИИ (арт. · наим. · порода · кол-во · цена)</div>'+
    '<div id="maninv_items_'+id+'"></div>'+
    '<button type="button" onclick="addManInvEditItem(\''+id+'\')" class="btn sec" style="font-size:12px;margin:6px 0 0">＋ Добавить позицию</button>'+
    '<div id="maninv_total_'+id+'" style="margin-top:8px"></div>'+
    '<div style="display:flex;gap:6px;margin-top:8px">'+
      '<button onclick="saveManualInvoiceEdit(\''+id+'\')" style="flex:1;padding:8px;border-radius:8px;border:none;background:#c8f060;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer">💾 Сохранить</button>'+
      '<button onclick="openRcvArchiveDate(\''+(inv.date||'—')+'\')" style="padding:8px 12px;border-radius:8px;border:1px solid #2e2e3e;background:none;color:#8888aa;font-size:12px;cursor:pointer">Отмена</button>'+
    '</div>';
  renderManInvEditItems(id);
}
function setSellerInvType(id, type){
  var _data = window._manInvEdit[id];
  if(!_data) return;
  if(_data.goodsType===type) return;
  if((_data.items||[]).length && !confirm('Сменить категорию накладной на '+(type==='dr'?'🛍 ДР Товар':'🌳 Дерево')+'? В накладной уже '+_data.items.length+' позици'+(_data.items.length===1?'я':(_data.items.length<5?'и':'й'))+' — проверьте, что не ошиблись.')) return;
  window._manInvEdit[id].goodsType = type;
  var bD=document.getElementById('maninvTypeDerevo_'+id), bDr=document.getElementById('maninvTypeDr_'+id);
  if(bD) bD.style.cssText = type==='derevo'
    ? 'flex:1;padding:9px;border-radius:10px;border:2px solid #c8f060;background:#1e2a14;color:#c8f060;font-size:12px;font-weight:700;cursor:pointer'
    : 'flex:1;padding:9px;border-radius:10px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:700;cursor:pointer';
  if(bDr) bDr.style.cssText = type==='dr'
    ? 'flex:1;padding:9px;border-radius:10px;border:2px solid #a060f0;background:#1e1a2e;color:#a060f0;font-size:12px;font-weight:700;cursor:pointer'
    : 'flex:1;padding:9px;border-radius:10px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:700;cursor:pointer';
}
var _manInvEditActive = {id:null, i:null};
function _manInvNameOptions(goodsType){
  var key = (goodsType||_manInvGoodsType)==='dr' ? 'iz_goods_dr' : 'iz_goods_derevo';
  var names = getRefBook(key).map(function(it){ return (it&&it.name)||it; }).filter(Boolean);
  var uniq = {};
  return names.filter(function(n){ var k=n.toLowerCase(); if(uniq[k]) return false; uniq[k]=true; return true; });
}
window._manInvEditExpanded = {}; // id -> expanded index
function _manInvEditToggle(id, i){
  window._manInvEditExpanded[id] = (window._manInvEditExpanded[id]===i) ? -1 : i;
  renderManInvEditItems(id);
}
function renderManInvEditItems(id){
  var data = window._manInvEdit[id]; if(!data) return;
  var c = document.getElementById('maninv_items_'+id); if(!c) return;
  var expandIdx = window._manInvEditExpanded[id] != null ? window._manInvEditExpanded[id] : -1;
  c.innerHTML = (data.items||[]).map(function(item,i){
    var nameId = 'maninv_name_'+id+'_'+i;
    var spId = 'maninv_species_'+id+'_'+i;
    var isOpen = (i === expandIdx);
    var isFilled = !!(item.name || item.article);
    var artNum = item.article||item.num||'';
    var summary = (artNum?'№'+artNum+' ':'')+(item.name||'—')+(item.species?' · '+item.species:'')+(item.qty&&item.qty>1?' ×'+item.qty:'');
    var total = Math.round((item.qty||1)*(item.price||0));
    if(!isOpen && isFilled){
      return '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:10px;padding:7px 8px;margin-bottom:5px;display:flex;align-items:center;gap:6px">'+
        '<div style="flex-shrink:0;width:22px;height:22px;background:#2e2e3e;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#8888aa">'+(i+1)+'</div>'+
        '<div style="flex:1;overflow:hidden;min-width:0">'+
          '<div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+summary+'</div>'+
          '<div class="u-fs10-gray">'+(total?total.toLocaleString('ru-RU')+'₽':'')+'</div>'+
        '</div>'+
        '<button type="button" onpointerdown="event.preventDefault();_manInvEditToggle(\''+id+'\','+i+')" '+
          'style="flex-shrink:0;background:#22222e;border:1px solid #3e3e4e;border-radius:8px;padding:5px 9px;color:#c8f060;font-size:13px;cursor:pointer">▼</button>'+
        '<button type="button" onpointerdown="event.preventDefault();removeManInvEditItem(\''+id+'\','+i+')" '+
          'style="flex-shrink:0;background:none;border:1px solid #3e2e2e;border-radius:8px;padding:5px 8px;color:#f06060;font-size:12px;cursor:pointer">✕</button>'+
      '</div>';
    }
    return '<div style="background:#1a1a22;border:2px solid #c8f06055;border-radius:10px;padding:9px;margin-bottom:5px">'+
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">'+
        '<div style="flex-shrink:0;width:22px;height:22px;background:#c8f06033;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#c8f060">'+(i+1)+'</div>'+
        '<div style="font-size:10px;color:#c8f060;font-weight:700;flex:1">ПОЗИЦИЯ '+(i+1)+'</div>'+
        (isFilled ? '<button type="button" onpointerdown="event.preventDefault();_manInvEditToggle(\''+id+'\','+i+')" style="background:#22222e;border:1px solid #3e3e4e;border-radius:8px;padding:4px 9px;color:#8888aa;font-size:13px;cursor:pointer">▲</button>' : '')+
      '</div>'+
      '<div style="display:flex;gap:5px;margin-bottom:6px;align-items:center">'+
        '<input class="fi" value="'+artNum+'" placeholder="Арт." style="flex:0 0 70px;margin:0;padding:6px;font-size:12px;text-align:center" oninput="_manInvEditArt(\''+id+'\','+i+',this.value)">'+
        '<div style="flex:2;position:relative">'+
          '<input class="fi" id="'+nameId+'" value="'+(item.name||'')+'" placeholder="Наименование" autocomplete="off" style="margin:0;padding:6px;font-size:12px" '+
            'oninput="_manInvEditName(\''+id+'\','+i+',this.value);_manInvEditSuggestName(\''+id+'\','+i+')" '+
            'onfocus="_manInvEditSuggestName(\''+id+'\','+i+')" '+
            'onblur="psjHideSugg(\''+nameId+'\')">'+
          '<div id="'+nameId+'_sugg" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:20;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;max-height:160px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:2px"></div>'+
        '</div>'+
        '<button type="button" onclick="removeManInvEditItem(\''+id+'\','+i+')" style="background:none;border:1px solid #3e2e2e;border-radius:8px;padding:6px 8px;color:#f06060;font-size:13px;cursor:pointer;flex-shrink:0">✕</button>'+
      '</div>'+
      '<div style="margin-bottom:6px;position:relative">'+
        '<div style="font-size:9px;color:#8888aa;margin-bottom:3px">ПОРОДА ДЕРЕВА</div>'+
        '<div style="display:flex;gap:5px">'+
          '<input class="fi" id="'+spId+'" value="'+(item.species||'')+'" placeholder="Порода" autocomplete="off" style="margin:0;padding:6px;font-size:12px;flex:1" '+
            'oninput="_manInvEditActive={id:\''+id+'\',i:'+i+'};_manInvEditSpecies(\''+id+'\','+i+',this.value);psjSuggest(\''+spId+'\',getSpecies(),\'_manInvEditPickSpeciesIdx\')" '+
            'onfocus="_manInvEditActive={id:\''+id+'\',i:'+i+'};psjSuggest(\''+spId+'\',getSpecies(),\'_manInvEditPickSpeciesIdx\')" '+
            'onblur="psjHideSugg(\''+spId+'\')">'+
          (_rcvIsAdmin()?'<button type="button" onclick="_manInvEditAddSpecies(\''+id+'\','+i+')" style="background:#22222e;border:1px solid #f0c060;border-radius:8px;padding:0 12px;color:#f0c060;font-weight:700;cursor:pointer;flex-shrink:0">＋</button>':'')+
        '</div>'+
        '<div id="'+spId+'_sugg" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:20;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;max-height:160px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:2px"></div>'+
      '</div>'+
      '<div style="display:flex;gap:5px">'+
        '<input class="fi" type="text" value="'+(item.qty!=null?item.qty:1)+'" inputmode="numeric" placeholder="Кол-во" style="flex:1;margin:0;padding:6px;font-size:12px;text-align:center" oninput="_manInvEditQty(\''+id+'\','+i+',this.value)">'+
        '<input class="fi" type="text" value="'+(item.price||0)+'" inputmode="numeric" placeholder="Цена" style="flex:1;margin:0;padding:6px;font-size:12px;text-align:center" oninput="_manInvEditPrice(\''+id+'\','+i+',this.value)">'+
        '<div style="font-size:11px;color:#c8a060;flex:0 0 60px;text-align:right;padding-top:8px">'+(total?total.toLocaleString('ru-RU')+'₽':'')+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
  updateManInvEditTotal(id);
}
function addManInvEditItem(id){
  var data = window._manInvEdit[id]; if(!data) return;
  data.items = data.items||[];
  data.items.push({name:'', article:'', species:'', qty:1, price:0});
  window._manInvEditExpanded[id] = data.items.length - 1; // expand new item
  renderManInvEditItems(id);
}
function removeManInvEditItem(id,i){
  var data = window._manInvEdit[id]; if(!data) return;
  data.items.splice(i,1);
  renderManInvEditItems(id);
}
function updateManInvEditTotal(id){
  var data = window._manInvEdit[id]; if(!data) return;
  var total = (data.items||[]).reduce(function(s,it){ return s+(it.qty||1)*(it.price||0); },0);
  var totalQty = (data.items||[]).reduce(function(s,it){ return s+(it.qty||1); },0);
  var el = document.getElementById('maninv_total_'+id);
  if(el) el.innerHTML = (data.items||[]).length
    ? '<div style="display:flex;justify-content:space-between;align-items:center;background:#1e2a14;border:1px solid #c8f060;border-radius:10px;padding:10px 14px;font-weight:700">'+
        '<span style="color:#8888aa;font-size:13px">Итого: '+totalQty+' шт. · '+(data.items||[]).length+' '+((data.items||[]).length===1?'позиция':'позиций')+'</span>'+
        '<span style="color:#c8f060;font-size:16px">'+Math.round(total).toLocaleString('ru-RU')+'₽</span>'+
      '</div>'
    : '';
}
function _manInvEditName(id,i,v){ if(window._manInvEdit[id]&&window._manInvEdit[id].items[i]) window._manInvEdit[id].items[i].name=v; }
function _manInvEditArt(id,i,v){ if(window._manInvEdit[id]&&window._manInvEdit[id].items[i]) window._manInvEdit[id].items[i].article=v; }
function _manInvEditSpecies(id,i,v){ if(window._manInvEdit[id]&&window._manInvEdit[id].items[i]) window._manInvEdit[id].items[i].species=v; }
function _manInvEditQty(id,i,v){ if(window._manInvEdit[id]&&window._manInvEdit[id].items[i]){ window._manInvEdit[id].items[i].qty=parseFloat(v)||1; updateManInvEditTotal(id); } }
function _manInvEditPrice(id,i,v){ if(window._manInvEdit[id]&&window._manInvEdit[id].items[i]){ window._manInvEdit[id].items[i].price=parseFloat(v)||0; updateManInvEditTotal(id); } }
// Правка накладной админом (архив) показывала только голые названия без цены/артикула — продавцу
// приходилось выбирать вслепую, а артикул не подтягивался вовсе. Та же обогащённая подсказка,
// что уже есть в форме продажи (см. siSuggestNameM) и в форме исправления записи (editItemForm):
// показывает реальные варианты из каталога (цена+артикул, у дерева ещё порода) прямо в списке.
function _manInvEditSuggestName(id, i){
  var nameId = 'maninv_name_'+id+'_'+i;
  var box = document.getElementById(nameId+'_sugg');
  var input = document.getElementById(nameId);
  if(!box || !input) return;
  var val = (input.value||'').trim().toLowerCase();
  if(!val){ box.style.display='none'; box.innerHTML=''; return; }
  var data = window._manInvEdit[id]; if(!data) return;
  var gt = data.goodsType || 'derevo';
  var words = val.split(/\s+/).filter(Boolean);
  var names = _manInvNameOptions(gt).filter(function(s){
    var low = s.toLowerCase();
    return words.every(function(w){ return low.indexOf(w)>=0; });
  });
  names.sort(function(a,b){
    var la=a.toLowerCase(), lb=b.toLowerCase();
    var ai=la.indexOf(words[0]||''), bi=lb.indexOf(words[0]||'');
    if(ai!==bi) return ai-bi;
    return a.length-b.length;
  });
  if(!names.length){ box.style.display='none'; box.innerHTML=''; return; }
  var isWood = gt!=='dr';
  var rows = [];
  names.forEach(function(nm){
    var variants = _siGetGoodsVariants(nm, gt);
    variants.forEach(function(v){ rows.push({name:nm, price:v.price, article:v.article, species:v.species||null}); });
    // Простое «без артикула» остаётся выбираемым, даже когда у названия уже есть варианты —
    // на случай, когда ни одна порода/цена из каталога не подходит к тому, что принимают.
    rows.push({name:nm, price:null, article:null, species:null});
  });
  box.innerHTML = rows.map(function(r){
    var infoStr = r.price!=null
      ? ' · '+Math.round(r.price).toLocaleString('ru-RU')+'₽'+(r.article?' · №'+r.article:'')+(isWood&&r.species?' · '+r.species:'')
      : '';
    var priceArg = r.price!=null ? r.price : 'null';
    var artArg = r.article ? "'"+r.article.replace(/'/g,"\\'")+"'" : 'null';
    var spArg = r.species ? "'"+r.species.replace(/'/g,"\\'")+"'" : 'null';
    return '<div onclick="_manInvEditPickVariant(\''+id+'\','+i+',\''+r.name.replace(/'/g,"\\'")+'\','+priceArg+','+artArg+','+spArg+')" '+
      'style="padding:8px 10px;font-size:12px;color:#f0f0f8;border-bottom:1px solid #2e2e3e;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:6px">'+
      '<span>'+r.name+'</span><span style="color:#8888aa;font-size:11px;white-space:nowrap;flex-shrink:0">'+infoStr+'</span></div>';
  }).join('');
  box.style.display='block';
}
function _manInvEditPickVariant(id, i, name, price, article, species){
  var data = window._manInvEdit[id]; if(!data || !data.items[i]) return;
  data.items[i].name = name;
  // price/article===null — выбрали «просто название» намеренно (см. _manInvEditSuggestName);
  // если до этого уже стояли цена/артикул от другого варианта, их нужно сбросить, а не оставить
  // как случайный остаток, рассинхронизированный с новым выбором.
  data.items[i].price = price!=null ? price : 0;
  data.items[i].article = article || '';
  if(species) data.items[i].species = species;
  var box = document.getElementById('maninv_name_'+id+'_'+i+'_sugg'); if(box) box.style.display='none';
  renderManInvEditItems(id);
}
function _manInvEditPickSpeciesIdx(val){
  var id=_manInvEditActive.id, i=_manInvEditActive.i;
  if(id==null||i==null) return;
  var el = document.getElementById('maninv_species_'+id+'_'+i);
  if(el) el.value = val;
  if(window._manInvEdit[id] && window._manInvEdit[id].items[i]) window._manInvEdit[id].items[i].species = val;
  var box = document.getElementById('maninv_species_'+id+'_'+i+'_sugg');
  if(box) box.style.display='none';
}
function _manInvEditAddSpecies(id,i){
  if(!_rcvIsAdmin()){ showToast('Добавлять породы в справочник может только администратор'); return; }
  var el = document.getElementById('maninv_species_'+id+'_'+i);
  var val = (el && el.value || '').trim();
  if(!val){ showToast('Введите породу'); return; }
  var before = getSpecies().length;
  saveSpecies(val);
  if(getSpecies().length>before) showToast('✅ Добавлено в породы дерева: '+val);
  else showToast('Уже есть в породах дерева');
}
function _recalcClosedShiftGoodsForInvoice(invoiceId){
  var inv = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]').find(function(i){ return String(i.id)===String(invoiceId); });
  if(!inv) return {touched:0};
  var shifts = getShifts();
  var target = null;
  shifts.forEach(function(s){
    if(target || s.status!=='closed') return;
    var e = (s.journal||[]).find(function(je){ return je.type==='receive' && je.invId===invoiceId; });
    if(e) target = s;
  });
  if(!target) return {touched:0};
  var isDr = (inv.goodsType==='dr');
  var entry = target.journal.find(function(je){ return je.type==='receive' && je.invId===invoiceId; });
  // Ставим точку отсчёта ДО правки записи журнала — иначе первый же пересчёт после
  // этого изменения не будет знать, от чего считать сдвиг (см. _ensureGoodsEveningAnchor).
  if(typeof _ensureGoodsEveningAnchor==='function') _ensureGoodsEveningAnchor(target);
  entry.goodsType = inv.goodsType||'derevo';
  entry.goodsEffect = isDr?0:(inv.totalAmt||0);
  entry.goodsDrEffect = isDr?(inv.totalAmt||0):0;
  entry.label = 'Приёмка '+inv.num+(isDr?' (ДР)':'');
  // Пересчёт «со сдвигом» (см. _recalcGoodsEveningPreserveDelta в синхронизация.js) —
  // не затирает ручную правку остатка этой смены, если она была.
  if(typeof _recalcGoodsEveningPreserveDelta==='function') _recalcGoodsEveningPreserveDelta(target);
  saveShifts(shifts);
  _pushShiftWithRetry(target.id||target._id, target);
  var cascadeResult = _cascadeGoodsForward(target, shifts);
  return {touched: 1 + cascadeResult.touched};
}
function _cascadeGoodsForward(target, shifts){
  // Пересчёт «со сдвигом» (см. _recalcGoodsEveningPreserveDelta в синхронизация.js) —
  // не затирает ручную правку остатка/недостачу, зафиксированную на смене дальше по
  // цепочке, а просто двигает её на ту же величину, что и утро.
  function recalcOne(sh){
    if(typeof _recalcGoodsEveningPreserveDelta==='function') _recalcGoodsEveningPreserveDelta(sh);
  }
  var touched = [];
  var needsReview = [];
  var chain = shifts.filter(function(s){ return s.shopName===target.shopName && s.status==='closed'; })
    .sort(function(a,b){ return (a.openedAt||a.date||'').localeCompare(b.openedAt||b.date||''); });
  var startIdx = chain.findIndex(function(s){ return (s.id||s._id)===(target.id||target._id); });
  if(startIdx<0) return {touched:0, needsReview:[]};
  var prev = target;
  var stopWood = false, stopDr = false;
  for(var i=startIdx+1; i<chain.length; i++){
    var sh = chain[i];
    var changed = false;
    // Точка отсчёта ставится по состоянию ДО того, как каскад ниже поменяет её утро —
    // иначе на первом же касании этой смены пересчёт вечера ниже не сдвинется вообще
    // (см. _ensureGoodsEveningAnchor в синхронизация.js).
    if(typeof _ensureGoodsEveningAnchor==='function') _ensureGoodsEveningAnchor(sh);
    if(!stopWood){
      var expMorn = prev.goodsEvening||0;
      if((sh.goodsMornSource||'auto')==='auto'){
        if(Math.round(sh.goodsMorning||0)!==Math.round(expMorn)){ sh.goodsMorning=expMorn; changed=true; }
      } else if(Math.abs((sh.goodsMorning||0)-expMorn)>=1){
        stopWood=true;
        needsReview.push({shopName:sh.shopName, date:sh.date, id:sh.id||sh._id, field:'Дерево', entered:Math.round(sh.goodsMorning||0), expected:Math.round(expMorn)});
      }
    }
    if(!stopDr){
      var expDrMorn = prev.drGoodsEvening||0;
      if((sh.goodsDrMornSource||'auto')==='auto'){
        if(Math.round(sh.goodsDrMorning||0)!==Math.round(expDrMorn)){ sh.goodsDrMorning=expDrMorn; changed=true; }
      } else if(Math.abs((sh.goodsDrMorning||0)-expDrMorn)>=1){
        stopDr=true;
        needsReview.push({shopName:sh.shopName, date:sh.date, id:sh.id||sh._id, field:'ДР Товар', entered:Math.round(sh.goodsDrMorning||0), expected:Math.round(expDrMorn)});
      }
    }
    var oldEve=sh.goodsEvening, oldDrEve=sh.drGoodsEvening;
    recalcOne(sh);
    if(sh.goodsEvening!==oldEve || sh.drGoodsEvening!==oldDrEve) changed=true;
    if(changed) touched.push(sh);
    prev = sh;
    if(stopWood && stopDr) break;
  }
  if(touched.length){
    saveShifts(shifts);
    touched.forEach(function(s){ _pushShiftWithRetry(s.id||s._id, s); });
  }
  return {touched:touched.length, needsReview:needsReview};
}
function saveManualInvoiceEdit(id){
  var data = window._manInvEdit[id]; if(!data) return;
  // Проверяем только новые/изменённые позиции — иначе старая накладная с историческим названием
  // не дала бы продавцу поправить даже количество.
  var _origInv = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]').find(function(x){ return String(x._id!=null?x._id:x.id)===id; });
  var _origItems = (_origInv && _origInv.items) || [];
  var _changedIdx = {};
  (data.items||[]).forEach(function(it, k){
    var o = _origItems[k];
    if(!o || String(o.name||'')!==String(it.name||'') || String(o.article||o.num||'')!==String(it.article||it.num||'') || String(o.species||'')!==String(it.species||'')) _changedIdx[k] = true;
  });
  if((data.goodsType||'derevo')!=='dr'){
    for(var _ek=0; _ek<(data.items||[]).length; _ek++){
      var _eit = data.items[_ek];
      if(!_changedIdx[_ek] || !_eit || !(_eit.name||'').trim()) continue;
      if(!(_eit.article||_eit.num) && !(_eit.species||'').trim()){
        showToast('⛔ Выберите породу из списка для «'+_eit.name+'» (поз. '+(_ek+1)+'). Артикул не нужен, если его нет в базе — оставьте поле пустым');
        return;
      }
    }
  }
  var _rcvIssE = _rcvCheckItemsAgainstCatalog(data.items, data.goodsType||'derevo', _changedIdx);
  if(_rcvIssE){ _rcvReportCatalogIssue(_rcvIssE, data.goodsType||'derevo', data.items, function(){ renderManInvEditItems(id); }); return; }
  if(typeof _findArtDupInItems==='function'){
    var _col1 = [];
    var _artDupMsg1 = _findArtDupInItems(data.items, id, data.destName||data.shopName, null, _col1);
    if(_artDupMsg1){ showToast('⛔ '+_artDupMsg1+' — исправьте номер'); return; }
    if(!_confirmTagCollisions(_col1, data.destName||data.shopName)) return;
  }
  var all = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var idx = all.findIndex(function(i){ return String(i._id!=null?i._id:i.id)===id; });
  if(idx<0) return;
  var oldDate = all[idx].date;
  var oldNum = all[idx].num;
  data.num = (document.getElementById('maninv_num_'+id)||{}).value || data.num;
  data.date = (document.getElementById('maninv_date_'+id)||{}).value || data.date;
  data.docDate = (document.getElementById('maninv_docdate_'+id)||{}).value || data.docDate;
  data.from = (document.getElementById('maninv_from_'+id)||{}).value || data.from;
  data.totalAmt = (data.items||[]).reduce(function(s,it){ return s+(it.qty||1)*(it.price||0); },0);
  data.editedAt = new Date().toISOString();
  data.editedBy = (session&&session.sellerName)||'';
  all[idx]=data;
  localStorage.setItem('iz_manual_invoices', JSON.stringify(all));
  db.collection('iz_manual_invoices').doc(id).set(data,{merge:true}).catch(function(e){
    console.log('[saveManualInvoiceEdit] ошибка сохранения:', e);
    _queuePendingInvoice('iz_manual_invoices', data);
    showToast('⚠️ Правка накладной сохранена только на телефоне — досошлётся автоматически');
  });
  try{ _backupInvoiceIndependently(Object.assign({}, data, {id:id})); }catch(e){}
  var oldEntry = journal.find(function(e){
    if(e.type!=='receive') return false;
    if(e.invId) return e.invId===id;
    return e.sub && e.sub.indexOf(oldNum)>=0;
  });
  var preservedTs = oldEntry ? oldEntry.ts : new Date().toISOString();
  if(data.date && data.date!==oldDate){
    var tod = preservedTs.indexOf('T')>=0 ? preservedTs.slice(preservedTs.indexOf('T')) : 'T12:00:00.000Z';
    preservedTs = data.date+tod;
  }
  journal = journal.filter(function(e){
    if(e.type!=='receive') return true;
    if(e.invId) return e.invId!==id;
    return !(e.sub && e.sub.indexOf(oldNum)>=0);
  });
  (data.items||[]).forEach(function(item){
    autoSaveToItemBase(item.name, item.article, item.price, (data.goodsType==='dr'?'dr':'derevo'));
  });
  var _sellerGt = data.goodsType || 'derevo';
  var _isDrSeller = _sellerGt==='dr';
  var _editedRcv = {
    id:uid(), type:'receive', ts:preservedTs, icon:'📥',
    label:(data.isRevaluation?'🔄 ПЕРЕОЦЕНКА · ':'')+'Приёмка '+data.num+(_isDrSeller?' (ДР)':''),
    sub:(data.items||[]).length+' изд.'+(data.from?' · от '+data.from:'')+(data.createdBy?' · принял: '+data.createdBy:''),
    amount:data.totalAmt,
    amtCls:'neu', cashEffect:0, cardEffect:0, staffEffect:0,
    goodsType:_sellerGt,
    goodsEffect:_isDrSeller?0:data.totalAmt,
    goodsDrEffect:_isDrSeller?data.totalAmt:0,
    invId:id, editedAt:new Date().toISOString(), acceptedBy:data.createdBy||''
  };
  if(data.isRevaluation) _editedRcv.isRevaluation = true; // не кладём undefined — Firestore такое не принимает
  journal.push(_editedRcv);
  saveJ();
  delete window._manInvEdit[id];
  renderAll(); renderReceiveArchive();
  var _recalcResult = null;
  try{ _recalcResult = _recalcClosedShiftGoodsForInvoice(id); }catch(e){ console.log('[saveManualInvoiceEdit] recalc err', e); }
  if(_recalcResult && _recalcResult.touched){
    showToast('✅ Накладная исправлена, пересчитано смен: '+_recalcResult.touched);
    try{ renderShiftHistory(); }catch(e){}
  } else {
    showToast('✅ Накладная исправлена');
  }
}
function deleteManualInvoice(id){
  if(!confirm('Удалить накладную? Это действие нельзя отменить.')) return;
  var all = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var inv = all.find(function(i){ return String(i._id!=null?i._id:i.id)===id; });
  if(!inv) return;
  var remaining = all.filter(function(i){ return String(i._id!=null?i._id:i.id)!==id; });
  localStorage.setItem('iz_manual_invoices', JSON.stringify(remaining));
  try{ db.collection('iz_manual_invoices').doc(id).delete(); }catch(e){}
  var num = inv.num;
  journal.forEach(function(e){
    if(e.type!=='receive') return;
    var matches = e.invId ? e.invId===id : (e.sub && e.sub.indexOf(num)>=0);
    if(matches){
      try{ logEntryDelete(e); }catch(err){}
      addToTrash(e, {reason:'manual_invoice_deleted'});
    }
  });
  journal = journal.filter(function(e){
    if(e.type!=='receive') return true;
    if(e.invId) return e.invId!==id;
    return !(e.sub && e.sub.indexOf(num)>=0);
  });
  saveJ();
  try{ syncLiveShift(); }catch(e){}
  renderAll(); renderReceiveArchive();
  showToast('✅ Накладная удалена');
}
function getItemsBase() {
  var existingNames = {};
  var detailed = [];
  var allCatalog = getRefBook('iz_goods_derevo').concat(getRefBook('iz_goods_dr'));
  allCatalog.forEach(function(g){
    var name = (g && g.name) || (typeof g==='string' ? g : '');
    if(!name) return;
    var norm = name.toLowerCase().trim();
    if(!existingNames[norm]){
      existingNames[norm] = true;
      detailed.push({name:name, num:'', price:0, category:''});
    }
  });
  var _itmTombs = JSON.parse(localStorage.getItem('iz_goods_derevo_deleted')||'[]')
    .concat(JSON.parse(localStorage.getItem('iz_goods_dr_deleted')||'[]'));
  var legacy = JSON.parse(localStorage.getItem('iz_items')||'[]');
  legacy.forEach(function(it){
    if(_itmTombs.indexOf((it.name||'').toLowerCase().trim())>=0) return;
    if(!it.name) return;
    var norm = it.name.toLowerCase().trim();
    if(!existingNames[norm]){
      existingNames[norm] = true;
      detailed.push(it);
    } else {
      var found = detailed.find(function(d){ return d.name.toLowerCase().trim()===norm; });
      if(found && it.num && !found.num) found.num = it.num;
    }
  });
  detailed.sort(function(a,b){ return (a.name||'').localeCompare(b.name||'','ru'); });
  return detailed;
}
function autoSaveToItemBase(name, num, price, category){
  if(!name||!name.trim()) return;
  var items = getItemsBase();
  var found = items.find(function(it){ return (num && String(it.num)===String(num)) || it.name===name; });
  if(found){
    if(num) found.num=num;
    if(price) found.price=price;
    if(category) found.category=category;
  } else {
    items.push({name:name.trim(), num:num||'', price:price||0, category:category||''});
  }
  localStorage.setItem('iz_items', JSON.stringify(items));
  try{
    db.collection('iz_settings').doc('items').get({source:'server'}).then(function(snap){
      var remoteItems = (snap.exists && snap.data().items) ? snap.data().items : [];
      var localKeys = {};
      items.forEach(function(it){ localKeys[(it.num||'')+'|'+(it.name||'')] = true; });
      var missingFromLocal = remoteItems.filter(function(it){
        return !localKeys[(it.num||'')+'|'+(it.name||'')];
      });
      var merged = missingFromLocal.length ? items.concat(missingFromLocal) : items;
      if(missingFromLocal.length){ localStorage.setItem('iz_items', JSON.stringify(merged)); }
      db.collection('iz_settings').doc('items').set({items:merged}).catch(function(e){ console.log('[autoSaveToItemBase] ошибка сохранения каталога', e); });
    }).catch(function(){
      try{ db.collection('iz_settings').doc('items').set({items:items}); }catch(e){}
    });
  }catch(e){}
  var goods = getRefBook('iz_goods');
  var existsInGoods = goods.some(function(g){ return ((g&&g.name)||g)===name.trim(); });
  var goodsTombs = JSON.parse(localStorage.getItem('iz_goods_deleted')||'[]');
  var wasDeleted = goodsTombs.indexOf(name.trim().toLowerCase())>=0;
  if(!existsInGoods && !wasDeleted){
    goods.push({id:uid(), name:name.trim()});
    saveRefBookShop('iz_goods', goods);
  }
}
function getSpecies() {
  var materials = getRefBook('iz_materials');
  var names = materials.map(function(m){ return (m && m.name) || (typeof m==='string' ? m : ''); }).filter(Boolean);
  var legacy = JSON.parse(localStorage.getItem('iz_species')||'[]');
  legacy.forEach(function(s){ if(s && names.indexOf(s)<0) names.push(s); });
  // Каталог «С артикулом вручную» (iz_goods_derevo) редактирует только админ — если порода уже
  // указана там на карточке товара, она тем самым уже подтверждена и не должна требовать
  // отдельного дублирующего добавления в «Породы дерева»: иначе продавца блокирует проверка
  // species на ровном месте («Катальпа» есть на карточке «Лопатка», но продать нельзя, пока
  // её вручную не продублируют в другой справочник).
  (getRefBook('iz_goods_derevo')||[]).forEach(function(it){
    var sp = (it && it.species || '').trim();
    if(sp && names.indexOf(sp)<0) names.push(sp);
  });
  names.sort(function(a,b){ return a.toLowerCase().localeCompare(b.toLowerCase(),'ru'); });
  return names;
}
function saveSpecies(name) {
  if(!name||!name.trim()) return;
  name = name.trim();
  var materials = getRefBook('iz_materials');
  var exists = materials.some(function(m){ return ((m && m.name) || m)===name; });
  var matTombs = JSON.parse(localStorage.getItem('iz_materials_deleted')||'[]');
  var wasDeleted = matTombs.indexOf(name.toLowerCase())>=0;
  if(!exists && !wasDeleted){
    var newMat = {id:uid(), name:name};
    materials.push(newMat);
    localStorage.setItem('iz_materials', JSON.stringify(materials));
    syncArrayAdd('iz_materials', newMat);
    try{ renderRefbookItemsShop('materials','iz_materials'); updateRefbookCountShop('materials','iz_materials'); }catch(e){}
  }
}
// Продавцы годами вписывали породу от руки — сокращения и опечатки («Орех», «Оех», «Сейквоя»,
// «Дуб») дробят одну и ту же породу на разные группы и в «Сводке без артикула», и при поиске
// совпадений для «Применить артикулы задним числом». Приводим известные варианты к тому
// каноническому названию, под которым порода реально заведена в каталоге «С артикулом вручную».
var _woodSpeciesAliases = {
  'орех':'Орех грецкий', 'оех':'Орех грецкий',
  'сейквоя':'Секвойя',
  'дуб':'Дуб скальный'
};
function _woodSpeciesNormalize(raw){
  var s = String(raw||'').trim();
  if(!s) return s;
  return _woodSpeciesAliases[s.toLowerCase()] || s;
}
// Для фильтра «чётки/браслеты/бусы без породы дерева» (аудит пород) — в поле «порода» у этих
// изделий часто записана смесь из дерева И камня/металла через запятую («Кап карагача, агат»),
// а отдельного признака «это порода дерева» или «это камень» в базе нет (getSpecies() читает
// общий справочник iz_materials, где всё вперемешку). Определяем «есть ли дерево в составе» по
// списку корней известных пород — эвристика, не 100% точная база: если появится порода, которой
// здесь нет, список надо будет дополнить.
var _WOOD_SPECIES_KEYWORDS = [
  'дуб','орех','ясен','клён','клен','берёз','берез','сосн','листвен','тик','венге','махагон',
  'бук','вяз','самшит','секвой','каштан','платан','шелковиц','абрикос','вишн','черешн','яблон',
  'акаци','кари','гикори','ироко','палисандр','эбен','зебран','падук','мербау','ятоба','карагач',
  'груш','слив','ольх','явор','берест','тополь','ив','лип','кедр','пихт','ель','можжевельник',
  'граб','зизифус','бархат'
];
function _speciesLabelHasWood(label){
  var s = String(label||'').toLowerCase();
  if(!s || s==='—') return false;
  return _WOOD_SPECIES_KEYWORDS.some(function(kw){ return s.indexOf(kw)>=0; });
}
function _isJewelryNames(namesObj){
  var re = /чётк|четк|браслет|бус/i;
  return Object.keys(namesObj||{}).some(function(n){ return re.test(n); });
}
function getSuppliers() {
  var base = ['Мастерская Ижица'];
  var saved = JSON.parse(localStorage.getItem('iz_suppliers')||'[]');
  var names = saved.map(function(s){ return s.name||s; });
  base.forEach(function(b){ if(names.indexOf(b)<0) names.push(b); });
  return names.sort(function(a,b){ return a.localeCompare(b,'ru'); });
}
function saveSupplier(name) {
  if(!name||!name.trim()) return;
  var saved = JSON.parse(localStorage.getItem('iz_suppliers')||'[]');
  var names = saved.map(function(s){ return s.name||s; });
  if(names.indexOf(name.trim())<0) {
    saved.push({name:name.trim(), addedAt:new Date().toISOString()});
    localStorage.setItem('iz_suppliers', JSON.stringify(saved));
    try { db.collection('iz_settings').doc('suppliers').set({suppliers:saved,updatedAt:new Date().toISOString()},{merge:true}); } catch(e){}
  }
}
function showSupplierDropdown(query) {
  var drop = document.getElementById('manInvFromDrop'); if(!drop) return;
  var q = (query||'').trim().toLowerCase();
  var suppliers = getSuppliers();
  var filtered = q ? suppliers.filter(function(s){ return s.toLowerCase().includes(q); }) : suppliers;
  if(!filtered.length) { drop.style.display='none'; return; }
  drop.style.display='block';
  drop.innerHTML = filtered.map(function(s){
    return '<div class="item-dropdown-item" onmousedown="selectSupplier(\''+s.replace(/'/g,"\\'")+'\')">' +
      '<span class="iname">'+s+'</span></div>';
  }).join('');
  if(!drop._cl) {
    drop._cl=true;
    document.addEventListener('click', function(e){
      var inp=document.getElementById('manInvFrom');
      if(inp&&!inp.contains(e.target)&&!drop.contains(e.target)) drop.style.display='none';
    });
  }
}
function selectSupplier(name) {
  var el=document.getElementById('manInvFrom'); if(el) el.value=name;
  var drop=document.getElementById('manInvFromDrop'); if(drop) drop.style.display='none';
}
function addNewSupplier() {
  var el=document.getElementById('manInvFrom');
  var name=(el&&el.value||'').trim();
  if(!name) name=prompt('Введите название поставщика:');
  if(!name||!name.trim()) return;
  saveSupplier(name.trim());
  if(el) el.value=name.trim();
  showToast('✅ Поставщик «'+name+'» добавлен в базу');
}
function purgeStaleReceives(){
  if(!session || !session.openedAt){ showToast('Нет активной смены'); return; }
  var shiftDateStr = session.openedAt.split('T')[0];
  var before = journal.length;
  journal = journal.filter(function(e){
    if(e.type !== 'receive') return true;
    if(!e.ts) return true; // no timestamp - keep
    var eDateStr = e.ts.split('T')[0];
    return eDateStr >= shiftDateStr; // keep only same day or later
  });
  var removed = before - journal.length;
  saveJ();
  renderAll();
  if(removed > 0){
    showToast('✅ Удалено ' + removed + ' старых записей прихода');
  } else {
    showToast('Старых записей не найдено');
  }
}
var _adminRcvPeriod = 'today';
var _adminRcvShop = '';
var _adminRcvType = 'receive';
var _adminRcvGt = ''; // '' — все, 'derevo' — только Дерево, 'dr' — только ДР Товар
function findAndCleanDuplicateReceives(){
  var shifts = getShifts();
  var groups = {};
  shifts.forEach(function(s, sIdx){
    (s.journal||[]).forEach(function(e, eIdx){
      if(e.type!=='receive') return;
      var key = s.shopName+'|'+s.date+'|'+(e.label||'')+'|'+Math.round(e.amount||0);
      if(!groups[key]) groups[key]=[];
      groups[key].push({shiftIdx:sIdx, entryIdx:eIdx, shopName:s.shopName, date:s.date, entry:e});
    });
  });
  var dupGroups = Object.keys(groups).filter(function(k){ return groups[k].length>1; }).map(function(k){ return groups[k]; });
  if(!dupGroups.length){ showToast('✅ Дублей приходов не найдено'); return; }
  var totalDup = dupGroups.reduce(function(s,g){ return s+g.length-1; },0);
  var summary = dupGroups.slice(0,10).map(function(g){
    return '• '+g[0].shopName+' · '+g[0].date+' · '+(g[0].entry.label||'')+' · '+g.length+' шт. вместо 1';
  }).join('\n');
  if(!confirm('Найдено '+dupGroups.length+' групп дублей, лишних записей: '+totalDup+'\n\n'+summary+(dupGroups.length>10?'\n...и ещё '+(dupGroups.length-10):'')+'\n\nОставить по одной записи в каждой группе (самую первую), остальные убрать в корзину?')) return;
  var toRemove = [];
  dupGroups.forEach(function(g){
    g.slice(1).forEach(function(item){ toRemove.push(item); });
  });
  toRemove.sort(function(a,b){ return b.entryIdx-a.entryIdx; });
  var touchedShifts = {};
  toRemove.forEach(function(item){
    var s = shifts[item.shiftIdx];
    var jnl = s.journal||[];
    var e = jnl[item.entryIdx];
    if(!e || e.id!==item.entry.id) return; // на всякий случай, если что-то сдвинулось
    addToTrash(e, {shopName:s.shopName, shiftId:s.id, deletedByOverride:(session&&(session.name||session.sellerName))||'admin (очистка дублей прихода)'});
    jnl.splice(item.entryIdx,1);
    s.journal = jnl;
    touchedShifts[item.shiftIdx]=true;
  });
  saveShifts(shifts);
  Object.keys(touchedShifts).forEach(function(idx){
    var s = shifts[idx];
    _pushShiftWithRetry(s.id||s._id, s);
  });
  showToast('✅ Убрано дублей: '+toRemove.length);
  try{ renderAdminRcvWo(); }catch(e){}
}
function renumberManualInvoices(){
  var invoices = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var groups = {};
  invoices.forEach(function(inv){
    if(!inv.num || !inv.destName) return;
    var d = (inv.date||inv.acceptedAt||'').slice(0,10);
    var monthKey = d.slice(0,7);
    if(monthKey.length!==7) return;
    var gk = inv.destName+'|'+monthKey;
    (groups[gk]=groups[gk]||[]).push(inv);
  });
  var plan = [];
  Object.keys(groups).forEach(function(gk){
    var arr = groups[gk];
    arr.sort(function(a,b){ return (a.acceptedAt||a.date||'').localeCompare(b.acceptedAt||b.date||''); });
    arr.forEach(function(inv, idx){
      var d = new Date((inv.date||'').slice(0,10)+'T00:00:00');
      if(isNaN(d.getTime())) d = new Date(inv.acceptedAt||Date.now());
      var dd = String(d.getDate()).padStart(2,'0');
      var mm = String(d.getMonth()+1).padStart(2,'0');
      var yyyy = d.getFullYear();
      var shopShort = shopAbbrev(inv.destName);
      var n = String(idx+1).padStart(3,'0');
      var newNum = n+'/'+dd+'.'+mm+'.'+yyyy+'/'+(shopShort||'Магазин');
      if(newNum !== inv.num) plan.push({inv:inv, oldNum:inv.num, newNum:newNum});
    });
  });
  if(!plan.length){ showToast('✅ Все номера накладных уже соответствуют правильному порядку'); return; }
  var summary = plan.slice(0,15).map(function(p){
    return '• '+p.inv.destName+': '+p.oldNum+' → '+p.newNum;
  }).join('\n');
  if(!confirm('Будет изменена нумерация '+plan.length+' накладных (только номер, суммы и товары не меняются):\n\n'+summary+(plan.length>15?'\n...и ещё '+(plan.length-15):'')+'\n\nПродолжить?')) return;
  var shifts = getShifts();
  var touchedShifts = {};
  plan.forEach(function(p){
    p.inv.num = p.newNum;
    shifts.forEach(function(s, sIdx){
      (s.journal||[]).forEach(function(e){
        if(e.type==='receive' && e.invId===p.inv.id){
          e.label = 'Приёмка '+p.newNum+(p.inv.goodsType==='dr'?' (ДР)':'');
          touchedShifts[sIdx]=true;
        }
      });
    });
    if(typeof journal!=='undefined' && journal && journal.length){
      journal.forEach(function(e){
        if(e.type==='receive' && e.invId===p.inv.id){
          e.label = 'Приёмка '+p.newNum+(p.inv.goodsType==='dr'?' (ДР)':'');
        }
      });
      try{ saveJ(); }catch(e){}
    }
  });
  localStorage.setItem('iz_manual_invoices', JSON.stringify(invoices));
  plan.forEach(function(p){
    try{ db.collection('iz_manual_invoices').doc(p.inv.id).set({num:p.newNum}, {merge:true}); }catch(e){}
  });
  saveShifts(shifts);
  Object.keys(touchedShifts).forEach(function(idx){
    var s = shifts[idx];
    _pushShiftWithRetry(s.id||s._id, s);
  });
  showToast('✅ Перенумеровано накладных: '+plan.length);
  try{ renderAdminRcvWo(); }catch(e){}
}
function openLostDataMo(){
  var sel = document.getElementById('lostDataShop');
  if(sel){
    var shops = getShopNames();
    sel.innerHTML = shops.map(function(s){ return '<option value="'+s.replace(/"/g,'&quot;')+'">'+s+'</option>'; }).join('');
  }
  var today = new Date().toISOString().split('T')[0];
  var fromEl = document.getElementById('lostDataFrom'), toEl = document.getElementById('lostDataTo');
  if(fromEl && !fromEl.value) fromEl.value = today;
  if(toEl && !toEl.value) toEl.value = today;
  var resEl = document.getElementById('lostDataResult'); if(resEl) resEl.innerHTML = '';
  openMo('lostDataMo');
}
window._lostShiftOrphans = {};
function findLostShiftData(){
  var shop = (document.getElementById('lostDataShop')||{}).value || '';
  var from = (document.getElementById('lostDataFrom')||{}).value || '';
  var to = (document.getElementById('lostDataTo')||{}).value || '';
  var resEl = document.getElementById('lostDataResult');
  if(!shop || !from || !to){ showToast('Укажите магазин и период'); return; }
  if(typeof db==='undefined' || !db){ if(resEl) resEl.innerHTML='<div style="color:#f06060;font-size:12px">Нет подключения к базе</div>'; return; }
  if(resEl) resEl.innerHTML = '<div style="font-size:12px;color:#8888aa">⏳ Ищу...</div>';
  Promise.all([
    db.collection('iz_sales').where('shopName','==',shop).get(),
    db.collection('iz_journal_backup').where('shopName','==',shop).get(),
    db.collection('iz_shifts').where('shopName','==',shop).get(),
    db.collection('iz_shift_backup').where('shopName','==',shop).get().catch(function(){ return {docs:[]}; })
  ]).then(function(results){
    var inRange = function(d){ return d && d>=from && d<=to; };
    var sales = results[0].docs.map(function(d){ return d.data(); }).filter(function(e){ return inRange(e.date); });
    var jnl = results[1].docs.map(function(d){ return d.data(); }).filter(function(e){ return inRange(e.date); });
    var existingShiftIds = {};
    results[2].docs.forEach(function(d){ var s=d.data(); existingShiftIds[s.id||d.id]=true; });
    var exactBackups = results[3].docs.map(function(d){ return d.data(); })
      .filter(function(s){ return inRange(s.date) && !existingShiftIds[s.id]; });
    window._lostShiftExactBackups = {}; exactBackups.forEach(function(s){ window._lostShiftExactBackups[s.id] = s; });
    var backedUpIds = {}; exactBackups.forEach(function(s){ backedUpIds[s.id] = true; });
    var allEntries = sales.concat(jnl).filter(function(e){ return !e.shiftId || !backedUpIds[e.shiftId]; });
    var byShift = {};
    allEntries.forEach(function(e){
      var sid = e.shiftId || ('bez-id-'+e.date);
      if(!byShift[sid]) byShift[sid] = {shiftId:e.shiftId||'', date:e.date, sellerName:e.sellerName, entries:[]};
      byShift[sid].entries.push(e);
    });
    var orphans = Object.keys(byShift).filter(function(sid){ return !existingShiftIds[sid]; }).map(function(sid){ return byShift[sid]; });
    window._lostShiftOrphans = {}; orphans.forEach(function(o){ window._lostShiftOrphans[o.shiftId||('bez-id-'+o.date)] = o; });
    if(!resEl) return;
    if(!orphans.length && !exactBackups.length){
      resEl.innerHTML = '<div style="color:#60f090;font-size:12px">Осиротевших записей не найдено — либо данных за этот период нет вообще, либо все они уже привязаны к существующим сменам в архиве.</div>';
      return;
    }
    var exactHtml = exactBackups.map(function(s){
      return '<div style="background:#16241a;border:1px solid #60f090;border-radius:10px;padding:10px;margin-bottom:8px">'+
        '<div style="font-weight:700;font-size:12px;color:#60f090">✅ Точная копия найдена</div>'+
        '<div style="font-size:12px;margin-top:2px">'+(s.date||'—')+' · '+(s.shopName||'')+' · '+(s.sellerName||'—')+'</div>'+
        '<div style="font-size:11px;color:#8888aa;margin:4px 0">Продаж: '+(s.salesCount||0)+' · Выручка: '+Math.round(s.totalRevenue||0).toLocaleString('ru-RU')+'₽</div>'+
        '<button onclick="restoreExactShiftBackup(\''+s.id+'\')" style="width:100%;margin-top:8px;padding:8px;border-radius:8px;border:1px solid #60f090;background:#1e2a14;color:#60f090;font-size:11px;font-weight:700;cursor:pointer">✅ Восстановить точную копию</button>'+
      '</div>';
    }).join('');
    var orphanHtml = orphans.map(function(o){
      var total = o.entries.reduce(function(s,e){ return s+(e.type==='sale'?(e.totalPaid||e.amount||0):0); },0);
      var salesCnt = o.entries.filter(function(e){return e.type==='sale';}).length;
      var expCnt = o.entries.filter(function(e){return e.type==='expense';}).length;
      var rcvCnt = o.entries.filter(function(e){return e.type==='receive';}).length;
      var woCnt = o.entries.filter(function(e){return e.type==='writeoff';}).length;
      var key = o.shiftId||('bez-id-'+o.date);
      return '<div style="background:#1a1a22;border:1px solid #f0a060;border-radius:10px;padding:10px;margin-bottom:8px">'+
        '<div style="font-weight:700;font-size:12px;color:#f0a060">'+(o.date||'дата неизвестна')+' · '+(o.sellerName||'—')+'</div>'+
        '<div style="font-size:11px;color:#8888aa;margin:4px 0">Найдено: '+salesCnt+' продаж, '+expCnt+' расходов, '+rcvCnt+' приходов, '+woCnt+' списаний</div>'+
        '<div style="font-size:13px;color:#c8f060;font-weight:700">Сумма продаж: '+Math.round(total).toLocaleString('ru-RU')+'₽</div>'+
        '<button onclick="reconstructShiftFromOrphans(\''+key+'\',\''+shop.replace(/'/g,"\\'")+'\')" style="width:100%;margin-top:8px;padding:8px;border-radius:8px;border:1px solid #60f090;background:#16241a;color:#60f090;font-size:11px;font-weight:700;cursor:pointer">♻️ Собрать смену из этих данных (приблизительно)</button>'+
      '</div>';
    }).join('');
    resEl.innerHTML = exactHtml + orphanHtml;
  }).catch(function(e){
    if(resEl) resEl.innerHTML = '<div style="color:#f06060;font-size:12px">Ошибка поиска: '+(e.message||e.code||e)+'</div>';
  });
}
function restoreExactShiftBackup(id){
  var s = window._lostShiftExactBackups && window._lostShiftExactBackups[id];
  if(!s){ showToast('Данные не найдены, повторите поиск'); return; }
  if(!confirm('Восстановить смену "'+s.shopName+' · '+s.date+'" из точной резервной копии? Это оригинальные данные смены, включая остатки кассы.')) return;
  var shifts = getShifts();
  shifts.unshift(s);
  saveShifts(shifts);
  try{ db.collection('iz_shifts').doc(id).set(s); }catch(e){}
  showToast('✅ Смена восстановлена из резервной копии');
  try{ renderShiftHistory(); }catch(e){}
  findLostShiftData();
}
function reconstructShiftFromOrphans(key, shopName){
  var o = window._lostShiftOrphans && window._lostShiftOrphans[key];
  if(!o){ showToast('Данные не найдены, повторите поиск'); return; }
  if(!confirm('Собрать смену "'+shopName+' · '+o.date+'" из '+o.entries.length+' найденных записей?\n\nВНИМАНИЕ: остатки кассы утро/вечер и точная сверка наличных при этом НЕ восстанавливаются (их не было в резервных записях) — их нужно будет проверить и поправить вручную после создания.')) return;
  var entries = o.entries.slice().sort(function(a,b){ return (a.ts||'').localeCompare(b.ts||''); });
  var sales = entries.filter(function(e){return e.type==='sale';});
  var cashRev=0, cardRev=0, disc=0;
  sales.forEach(function(e){ cashRev+=(e.cashEffect||0)+(e.cashDrEffect||0); cardRev+=(e.cardEffect||0)+(e.cardDrEffect||0); disc+=e.discount||0; });
  var newId = (o.shiftId && o.shiftId.indexOf('bez-id-')!==0) ? o.shiftId : uid();
  var report = {
    id:newId, status:'closed', source:'reconstructed', shopName:shopName,
    sellerName:(o.sellerName||''), date:o.date,
    openedAt: entries.length?entries[0].ts:null,
    closedAt: new Date().toISOString(),
    cashMorning:0, goodsMorning:0, cashEvening:null, goodsEvening:0,
    salesCount:sales.length, totalRevenue:sales.reduce(function(s,e){return s+(e.totalPaid||e.amount||0);},0),
    cashRevenue:cashRev, cardRevenue:cardRev, totalDiscount:disc,
    expenses: entries.filter(function(e){return e.type==='expense';}),
    journal: entries,
    _reconstructed:true, _reconstructedAt:new Date().toISOString(),
    _reconstructedNote:'Восстановлено из резервных записей продаж/расходов. Остатки кассы утро/вечер требуют ручной проверки.'
  };
  var shifts = getShifts();
  shifts.unshift(report);
  saveShifts(shifts);
  try{ db.collection('iz_shifts').doc(newId).set(report); }catch(e){}
  showToast('✅ Смена собрана и добавлена в архив — проверьте остатки кассы вручную');
  try{ renderShiftHistory(); }catch(e){}
  findLostShiftData();
}
function initAdminRcvWo(){
  var chips = document.getElementById('adminRcvShopChips');
  if(chips){
    var shops = getShopNames().filter(function(s){ var t=getShopType(s); return t==='shop'||t==='offline'||t==='workshop'; });
    chips.innerHTML = '<div onclick="adminRcvSetShop(\'\',this)" style="padding:5px 12px;border-radius:20px;border:2px solid #c8f060;background:#1e2a14;color:#c8f060;font-size:11px;font-weight:700;cursor:pointer">Все</div>' +
      shops.map(function(s){ return '<div onclick="adminRcvSetShop(\''+s+'\',this)" style="padding:5px 12px;border-radius:20px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:11px;font-weight:700;cursor:pointer">'+s+'</div>'; }).join('');
  }
  renderAdminRcvWo();
}
function setAdminRcvPeriod(p, el){
  _adminRcvPeriod = p;
  var chips = document.getElementById('adminRcvPeriodChips');
  if(chips) chips.querySelectorAll('div').forEach(function(d){
    d.style.borderColor='#2e2e3e'; d.style.background='#22222e'; d.style.color='#8888aa'; d.style.borderWidth='1px';
  });
  if(el){ el.style.borderColor='#c8f060'; el.style.background='#1e2a14'; el.style.color='#c8f060'; el.style.borderWidth='2px'; }
  var cr = document.getElementById('adminRcvCustomRange');
  if(cr) cr.style.display = p==='custom' ? 'flex' : 'none';
  if(p==='year' || p==='custom'){
    var range = _adminRcvDateRange();
    try{ _ensureShiftsLoadedForRange(range.from).then(renderAdminRcvWo); }catch(e){ renderAdminRcvWo(); }
  } else {
    renderAdminRcvWo();
  }
}
function adminRcvCustomRangeChanged(){
  var range = _adminRcvDateRange();
  try{ _ensureShiftsLoadedForRange(range.from).then(renderAdminRcvWo); }catch(e){ renderAdminRcvWo(); }
}
function adminRcvSetShop(shop, el){
  _adminRcvShop = shop;
  var chips = document.getElementById('adminRcvShopChips');
  if(chips) chips.querySelectorAll('div').forEach(function(d){
    d.style.borderColor='#2e2e3e'; d.style.background='#22222e'; d.style.color='#8888aa'; d.style.borderWidth='1px';
  });
  if(el){ el.style.borderColor='#c8f060'; el.style.background='#1e2a14'; el.style.color='#c8f060'; el.style.borderWidth='2px'; }
  renderAdminRcvWo();
}
function adminRcvSetGt(gt, el){
  _adminRcvGt = gt;
  var chips = document.getElementById('adminRcvGtChips');
  if(chips) chips.querySelectorAll('div').forEach(function(d){
    d.style.borderColor='#2e2e3e'; d.style.background='#22222e'; d.style.color='#8888aa'; d.style.borderWidth='1px';
  });
  if(el){ el.style.borderColor='#c8f060'; el.style.background='#1e2a14'; el.style.color='#c8f060'; el.style.borderWidth='2px'; }
  renderAdminRcvWo();
}
function adminRcvSetType(type, el){
  _adminRcvType = type;
  var btnR = document.getElementById('adminRcvBtnRcv');
  var btnW = document.getElementById('adminRcvBtnWo');
  if(type==='receive'){
    if(btnR){ btnR.style.borderColor='#60f090'; btnR.style.background='#1e2a14'; btnR.style.color='#60f090'; btnR.style.borderWidth='2px'; }
    if(btnW){ btnW.style.borderColor='#2e2e3e'; btnW.style.background='#22222e'; btnW.style.color='#8888aa'; btnW.style.borderWidth='1px'; }
  } else {
    if(btnW){ btnW.style.borderColor='#f06060'; btnW.style.background='#2a1e1e'; btnW.style.color='#f06060'; btnW.style.borderWidth='2px'; }
    if(btnR){ btnR.style.borderColor='#2e2e3e'; btnR.style.background='#22222e'; btnR.style.color='#8888aa'; btnR.style.borderWidth='1px'; }
  }
  renderAdminRcvWo();
}
function _adminRcvDateRange(){
  var now = new Date();
  var todayStr = now.toISOString().split('T')[0];
  if(_adminRcvPeriod==='today') return {from:todayStr, to:todayStr};
  if(_adminRcvPeriod==='week'){
    var d = new Date(now); d.setDate(d.getDate()-6);
    return {from:d.toISOString().split('T')[0], to:todayStr};
  }
  if(_adminRcvPeriod==='month'){
    var d = new Date(now); d.setDate(d.getDate()-29);
    return {from:d.toISOString().split('T')[0], to:todayStr};
  }
  if(_adminRcvPeriod==='year'){
    var d = new Date(now); d.setFullYear(d.getFullYear()-1);
    return {from:d.toISOString().split('T')[0], to:todayStr};
  }
  if(_adminRcvPeriod==='custom'){
    return {
      from:(document.getElementById('adminRcvFrom')||{}).value||todayStr,
      to:(document.getElementById('adminRcvTo')||{}).value||todayStr
    };
  }
  return {from:todayStr, to:todayStr};
}
var _adminRcvOpen = {}; // groupKey -> bool
function adminRcvToggle(key){
  _adminRcvOpen[key] = !_adminRcvOpen[key];
  renderAdminRcvWo();
}
function adminToggleMoveDate(btn, entryId, shiftId, shopName){
  var existing = btn.parentElement.querySelector('.moveDateForm');
  if(existing){ existing.remove(); return; }
  var form = document.createElement('div');
  form.className = 'moveDateForm';
  form.style.cssText = 'margin-top:8px;padding:8px;background:#1a1410;border:1px solid #f0a060;border-radius:8px';
  form.innerHTML =
    '<div style="font-size:11px;color:#f0a060;margin-bottom:6px">На какую дату реально пришёл этот товар? Смена на эту дату у магазина «'+shopName+'» должна уже существовать.</div>'+
    '<input class="fi" type="date" id="moveDateInput_'+entryId+'" style="margin:0 0 6px;padding:7px;-webkit-appearance:none;color-scheme:dark">'+
    '<button type="button" onclick="adminMoveReceiptDate(\''+entryId+'\',\''+shiftId+'\')" style="width:100%;padding:8px;border-radius:8px;border:none;background:#f0a060;color:#1a1206;font-weight:700;font-size:12px;cursor:pointer">Перенести приход на эту дату</button>';
  btn.parentElement.appendChild(form);
}
function adminMoveReceiptDate(entryId, sourceShiftId){
  var dateInput = document.getElementById('moveDateInput_'+entryId);
  var newDate = dateInput && dateInput.value;
  if(!newDate){ showToast('Укажи новую дату'); return; }
  var formEl = dateInput ? dateInput.closest('.moveDateForm') : null;
  if(formEl){
    if(formEl.dataset.moving==='1') return;
    formEl.dataset.moving='1';
    formEl.querySelectorAll('button').forEach(function(b){ b.disabled=true; b.style.opacity='0.5'; });
  }
  var shifts = getShifts();
  var srcIdx = shifts.findIndex(function(s){ return (s.id||s._id)===sourceShiftId; });
  if(srcIdx<0){ showToast('Исходная смена не найдена локально — сначала нажми ☁️ Синх'); return; }
  var srcShift = shifts[srcIdx];
  var jnl = srcShift.journal||[];
  var eIdx = jnl.findIndex(function(e){ return e.id===entryId; });
  if(eIdx<0){ showToast('Запись прихода не найдена в смене — возможно, уже перенесена'); return; }
  if(srcShift.date===newDate){ showToast('Это и есть текущая дата прихода'); return; }
  var entry = jnl[eIdx];
  var tgtIdx = shifts.findIndex(function(s){ return s.shopName===srcShift.shopName && s.date===newDate; });
  if(tgtIdx<0){
    showToast('⚠️ У магазина «'+srcShift.shopName+'» нет смены за '+newDate+'. Сначала должна существовать смена на эту дату (открытая или закрытая), потом перенос.');
    return;
  }
  var tgtJnlCheck = shifts[tgtIdx].journal||[];
  var alreadyMoved = tgtJnlCheck.some(function(e){
    return e.type==='receive' && e.label===entry.label && Math.abs((e.amount||0)-(entry.amount||0))<1;
  });
  if(alreadyMoved && !confirm('⚠️ В смене на '+newDate+' уже есть приход с такой же меткой и суммой ('+fmt(entry.amount||0)+'). Похоже, эта запись уже переносилась раньше.\n\nВсё равно перенести ещё раз?')){
    if(formEl){ formEl.dataset.moving=''; formEl.querySelectorAll('button').forEach(function(b){ b.disabled=false; b.style.opacity='1'; }); }
    return;
  }
  if(!confirm('Перенести приход "'+(entry.label||entry.sub||'')+'" на '+newDate+' — из смены '+srcShift.date+' в смену '+newDate+'? Остатки товара в обеих сменах пересчитаются.')){
    if(formEl){ formEl.dataset.moving=''; formEl.querySelectorAll('button').forEach(function(b){ b.disabled=false; b.style.opacity='1'; }); }
    return;
  }
  addToTrash(entry, {shopName:srcShift.shopName, shiftId:srcShift.id, deletedByOverride:(session&&(session.name||session.sellerName))||'admin (перенос даты прихода)'});
  jnl.splice(eIdx,1);
  srcShift.journal = jnl;
  var timePart = (entry.ts||'').split('T')[1] || '12:00:00.000Z';
  var movedEntry = Object.assign({}, entry, {
    id: uid(),
    ts: newDate+'T'+timePart,
    movedFrom: srcShift.date,
    movedFromEntryId: entry.id,
    movedAt: new Date().toISOString(),
    movedBy: (session&&(session.name||session.sellerName))||'admin'
  });
  var tgtShift = shifts[tgtIdx];
  tgtShift.journal = (tgtShift.journal||[]).concat([movedEntry])
    .sort(function(a,b){ return (a.ts||'').localeCompare(b.ts||''); });
  saveShifts(shifts);
  try{ logAction('RECEIPT_DATE_MOVED', {entryId:entryId, from:srcShift.date, to:newDate, shopName:srcShift.shopName}, srcShift.id||srcShift._id); }catch(e){}
  _pushShiftWithRetry(srcShift.id||srcShift._id, srcShift);
  _pushShiftWithRetry(tgtShift.id||tgtShift._id, tgtShift);
  showToast('✅ Приход перенесён на '+newDate);
  try{ renderAdminRcvWo(); }catch(e){}
}
// Удаление накладной админом со страницы «Приходы». Раньше удалить накладную можно было только
// из открытой смены самого продавца (deleteManualInvoice) — админ не мог убрать ни накладную,
// ни приход из уже закрытой смены. Удаляем всё связанное разом, чтобы ничего не «всплыло» снова:
//  • запись прихода в журнале смены (в корзину на 7 дней — с облачным «надгробием» для устройств продавцов),
//  • сам документ накладной (копия сохраняется в iz_deleted_invoices — можно восстановить руками),
//  • остаток товара смены (вечер сдвигается на сумму прихода, дальше по цепочке — каскадом),
//  • количество изделий на складе магазина.
function adminDeleteReceipt(entryId, shiftId, invId){
  if(!(session && session.role==='shopadmin')){ showToast('⛔ Удалять накладные может только администратор'); return; }
  var shifts = getShifts();
  var srcShift = shifts.find(function(s){ return (s.id||s._id)===shiftId; });
  if(!srcShift){ showToast('Смена не найдена локально — сначала нажми ☁️ Синх'); return; }
  var srcEntry = (srcShift.journal||[]).find(function(e){ return e.id===entryId; });
  if(!srcEntry){ showToast('Запись прихода не найдена в смене — возможно, уже удалена'); return; }
  var manAll = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var wsAll = JSON.parse(localStorage.getItem('iz_invoices')||'[]');
  var inv = null, invCol = '';
  if(invId){
    inv = manAll.find(function(i){ return String(i._id!=null?i._id:i.id)===String(invId) || String(i.id)===String(invId); });
    if(inv) invCol = 'iz_manual_invoices';
    else { inv = wsAll.find(function(i){ return String(i.id||i._id)===String(invId); }); if(inv) invCol = 'iz_invoices'; }
  }
  // Все смены, где есть приход по этой накладной (обычно одна)
  var targets = [];
  shifts.forEach(function(sh){
    (sh.journal||[]).forEach(function(e){
      if(e.type!=='receive') return;
      if((invId && e.invId===invId) || (sh===srcShift && e.id===entryId)) targets.push({sh:sh, entry:e});
    });
  });
  var total = targets.reduce(function(a,t){ return a+((_rcvWoodAmt(t.entry)+_rcvDrAmt(t.entry))||t.entry.amount||0); },0);
  var label = (inv&&inv.num) ? ('накладную '+inv.num) : ('приход «'+(srcEntry.label||srcEntry.sub||'')+'»');
  if(!confirm('Удалить '+label+' ('+Math.round(total).toLocaleString('ru-RU')+'₽) из магазина «'+srcShift.shopName+'»?\n\n'+
    '• запись исчезнет из смены ('+srcShift.date+') и из «Приходов»\n'+
    '• остаток товара смены и последующих смен пересчитается\n'+
    '• количество изделий на складе магазина уменьшится\n'+
    (inv?'• сама накладная будет удалена (копия сохранится в архиве удалённых)\n':'')+
    '\nЗапись прихода можно вернуть из «Корзины» в течение 7 дней.')) return;
  var adminName = (session&&(session.name||session.sellerName))||'admin';
  var nowIso = new Date().toISOString();
  var touchedShifts = [];
  targets.forEach(function(t){
    var sh = t.sh;
    if(touchedShifts.indexOf(sh)<0) touchedShifts.push(sh);
    try{ if(sh.status==='closed' && typeof _ensureGoodsEveningAnchor==='function') _ensureGoodsEveningAnchor(sh); }catch(e){}
    try{ addToTrash(t.entry, {shopName:sh.shopName, shiftId:sh.id||sh._id, reason:'invoice_deleted_by_admin', deletedByOverride:adminName+' (удаление накладной)'}); }catch(e){}
    sh.journal = (sh.journal||[]).filter(function(e){ return e.id!==t.entry.id; });
  });
  touchedShifts.forEach(function(sh){
    if(sh.status==='closed' && typeof _recalcGoodsEveningPreserveDelta==='function') _recalcGoodsEveningPreserveDelta(sh);
    sh.editedAt = nowIso; sh.editedBy = adminName; sh.editReason = 'Удалена накладная'+((inv&&inv.num)?(' '+inv.num):'');
  });
  saveShifts(shifts);
  touchedShifts.forEach(function(sh){
    try{ logAction('RECEIPT_DELETED', {invId:invId||null, invNum:(inv&&inv.num)||null, shopName:sh.shopName, shiftDate:sh.date, amount:total}, sh.id||sh._id); }catch(e){}
    _pushShiftWithRetry(sh.id||sh._id, sh);
  });
  // склад магазина: минус изделия из накладной (только существующие позиции, не ниже нуля)
  try{
    var items = inv ? (inv.acceptedItems||inv.items||[]) : (srcEntry.items||[]);
    var isRev = srcEntry.isRevaluation;
    if(items.length && !isRev){
      var stock = getStock(); var shopStock = stock[srcShift.shopName]||{}; var changed=false;
      items.forEach(function(it){
        var gt = it.goodsType||(it.category==='dr'?'dr':((inv&&inv.goodsType)||srcEntry.goodsType||'derevo'));
        var artNum = it.article||it.num||it.artNum;
        if(!artNum) artNum = _noArticleStockKey(it.name, it.factPrice||it.price||0, it.species, gt);
        var ent = artNum ? shopStock[String(artNum)] : null;
        if(ent){ ent.qty = Math.max(0,(ent.qty||0)-(it.qty||1)); changed=true; }
      });
      if(changed){ stock[srcShift.shopName]=shopStock; saveStock(stock); }
    }
  }catch(e){ console.log('[adminDeleteReceipt] склад:', e); }
  // сама накладная
  if(inv && invCol){
    var did = String(inv._id!=null?inv._id:inv.id);
    try{ db.collection('iz_deleted_invoices').doc(did).set(Object.assign({}, inv, {deletedAt:nowIso, deletedBy:adminName, fromCollection:invCol, fromShiftId:shiftId})); }catch(e){}
    try{ db.collection(invCol).doc(did).delete(); }catch(e){}
    var list = invCol==='iz_manual_invoices' ? manAll : wsAll;
    localStorage.setItem(invCol, JSON.stringify(list.filter(function(i){ return String(i._id!=null?i._id:i.id)!==did; })));
  }
  // остатки следующих смен
  var casc = 0;
  touchedShifts.forEach(function(sh){
    try{ if(sh.status==='closed'){ var r = _cascadeGoodsForward(sh, getShifts()); casc += (r&&r.touched)||0; } }catch(e){ console.log('[adminDeleteReceipt] cascade', e); }
  });
  showToast('🗑 Накладная удалена'+(casc?(' · пересчитано смен дальше: '+casc):''));
  try{ renderAdminRcvWo(); }catch(e){}
  try{ renderShiftHistory(); }catch(e){}
}
function adminOpenInvoiceFromList(invId, shiftId){
  if(!shiftId){ svOpenInvoiceFromReceive(invId); return; }
  var local = getShifts().find(function(s){ return (s.id||s._id)===shiftId; });
  function openWith(sh){
    // Смена из списка приходов — локальная копия, которая может отставать от облака; правка накладной
    // потом записывает эту смену целиком, поэтому берём свежую копию из облака (как openShiftView).
    sh = Object.assign({}, sh, {id: shiftId}); delete sh._pendingSync; delete sh._archiveOnly;
    try{ if(sh.status==='closed' && typeof _ensureGoodsEveningAnchor==='function') _ensureGoodsEveningAnchor(sh); }catch(e){}
    _currentShiftView = sh;
    svOpenInvoiceFromReceive(invId);
  }
  try{
    db.collection('iz_shifts').doc(shiftId).get({source:'server'}).then(function(snap){
      if(snap.exists) openWith(snap.data());
      else if(local) openWith(local);
      else showToast('⚠️ Смена этой накладной не найдена — нажми ☁️ Синх и попробуй снова');
    }).catch(function(){
      if(local) openWith(local); else showToast('⚠️ Смена этой накладной не найдена локально — нажми ☁️ Синх и попробуй снова');
    });
  }catch(e){
    if(local) openWith(local); else showToast('⚠️ Смена этой накладной не найдена локально — нажми ☁️ Синх и попробуй снова');
  }
}
function _showFallbackInvoiceView(invId){
  var r = (window._adminRcvRowsByInv||{})[invId];
  if(!r){ showToast('Накладная не найдена — возможно, удалена'); return; }
  document.getElementById('adminInvTitle').textContent = '📋 '+(r.label||'Накладная')+' (только просмотр)';
  var itemsHtml = (r.items&&r.items.length)
    ? r.items.map(function(it){
        return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #2e2e3e;font-size:12px">'+
          '<span>'+(it.name||it.article||'—')+(it.species?' · '+it.species:'')+'</span>'+
          '<span>'+(it.qty||1)+' × '+Math.round(it.price||0).toLocaleString('ru-RU')+'₽</span>'+
        '</div>';
      }).join('')
    : '<div style="font-size:12px;color:#8888aa">Состав позиций недоступен — сохранилась только итоговая сумма.</div>';
  document.getElementById('adminInvBody').innerHTML =
    '<div style="background:#2e2a14;border:1px solid #f0c060;border-radius:9px;padding:8px 10px;margin-bottom:10px;font-size:11px;color:#f0c060">⚠️ Оригинал накладной не найден (ни на устройстве, ни в облаке) — редактирование недоступно. Ниже данные из журнала смены на момент приёмки.</div>'+
    '<div style="font-size:11px;color:#8888aa;margin-bottom:6px">'+(r.shop||'')+(r.date?' · '+r.date:'')+'</div>'+
    itemsHtml+
    '<div style="display:flex;justify-content:space-between;font-weight:700;padding-top:8px;margin-top:6px;border-top:1px solid #2e2e3e"><span>Итого</span><span>'+Math.round(r.amount||0).toLocaleString('ru-RU')+'₽</span></div>'+
    '<button onclick="closeMo(\'adminInvMo\')" style="width:100%;margin-top:12px;padding:9px;border-radius:8px;border:1px solid #2e2e3e;background:none;color:#8888aa;font-size:12px;cursor:pointer">Закрыть</button>';
  openMo('adminInvMo');
}
function renderAdminRcvWo(){
  var range = _adminRcvDateRange();
  var allShifts = getShifts();
  var type = _adminRcvType;
  var manInvAll = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  var wsInvAll = JSON.parse(localStorage.getItem('iz_invoices')||'[]');
  var allInvCache = manInvAll.concat(wsInvAll);
  var rows = [];
  allShifts.forEach(function(sh){
    var sn = sh.shopName||'';
    if(_adminRcvShop && sn !== _adminRcvShop) return;
    var shDate = sh.date || (sh.openedAt||'').split('T')[0];
    if(shDate < range.from || shDate > range.to) return;
    (sh.journal||[]).forEach(function(e){
      if(e.type !== type) return;
      var amt = type==='receive' ? ((_rcvWoodAmt(e)+_rcvDrAmt(e))||e.amount||0) : (e.amount||0);
      var invNum = '';
      var invItemsFallback = null;
      var invAcceptedByFallback = '';
      if(e.invId){
        var found = allInvCache.find(function(i){ return (i.id||i._id)===e.invId; });
        if(found&&found.num) invNum = found.num;
        if(found) invItemsFallback = found.acceptedItems||found.items||null;
        if(found) invAcceptedByFallback = found.acceptedBy||found.createdBy||'';
      }
      var rowItems = (e.items&&e.items.length) ? e.items : (invItemsFallback||[]);
      rows.push({shop:sn, date:shDate, ts:e.ts||shDate, label:invNum?'Приёмка '+invNum:String(e.label||e.sub||'').replace(/^Отгрузка →/,'Перемещение →'), sub:e.sub||'', amount:amt, goodsType:(type==='receive'&&_rcvIsDrOnly(e))?'dr':(e.goodsType||'derevo'), invId:e.invId||null, entryId:e.id||null, shiftId:sh.id||sh._id||null, items:rowItems, reason:e.reason||'', isRevaluation:!!e.isRevaluation, acceptedBy:e.acceptedBy||invAcceptedByFallback||''});
    });
    if(type==='receive'){
      (sh.goodsReceives||[]).forEach(function(r){ rows.push({shop:sn,date:shDate,ts:shDate,label:'Приход Дерево',sub:r.name||'',amount:r.amt||r.amount||0,goodsType:'derevo',items:[],isRevaluation:!!r.isRevaluation}); });
      (sh.drGoodsReceives||[]).forEach(function(r){ rows.push({shop:sn,date:shDate,ts:shDate,label:'Приход ДР',sub:r.name||'',amount:r.amt||r.amount||0,goodsType:'dr',items:[],isRevaluation:!!r.isRevaluation}); });
    }
    if(type==='writeoff'){
      (sh.goodsWriteoffs||[]).forEach(function(r){ rows.push({shop:sn,date:shDate,ts:shDate,label:'Списание Дерево',sub:r.name||'',amount:r.amt||(r.price*r.qty)||0,goodsType:'derevo',items:[],reason:r.reason||'',isRevaluation:!!r.isRevaluation}); });
      (sh.drGoodsWriteoffs||[]).forEach(function(r){ rows.push({shop:sn,date:shDate,ts:shDate,label:'Списание ДР',sub:r.name||'',amount:r.amt||(r.price*r.qty)||0,goodsType:'dr',items:[],reason:r.reason||'',isRevaluation:!!r.isRevaluation}); });
    }
  });
  // Фильтр по виду товара — чтобы можно было быстро посмотреть отдельно приходы/списания только
  // Дерева или только ДР Товара, а не искать их вперемешку в общем списке.
  if(_adminRcvGt) rows = rows.filter(function(r){ return r.goodsType===_adminRcvGt; });
  rows.sort(function(a,b){ return (b.ts||b.date).localeCompare(a.ts||a.date); });
  window._adminRcvRowsByInv = {};
  rows.forEach(function(r){ if(r.invId) window._adminRcvRowsByInv[r.invId] = r; });
  var totalWood=0, totalDr=0;
  var qtyArtWood=0, qtyNoArtWood=0, qtyArtDr=0, qtyNoArtDr=0;
  rows.forEach(function(r){
    var qa=0, qn=0;
    (r.items||[]).forEach(function(it){
      var q = it.qty||1;
      if(it.article||it.num) qa+=q; else qn+=q;
    });
    r.qtyArt=qa; r.qtyNoArt=qn;
    if(r.goodsType==='dr'){ totalDr+=r.amount; qtyArtDr+=qa; qtyNoArtDr+=qn; }
    else { totalWood+=r.amount; qtyArtWood+=qa; qtyNoArtWood+=qn; }
  });
  function _qtyLine(qa, qn){
    return (qa+qn) ? '<div class="u-fs10-gray" style="margin-top:2px">'+(qa+qn)+' шт. ('+qa+' с арт. · '+qn+' без)</div>' : '';
  }
  var sumEl=document.getElementById('adminRcvSummary');
  if(sumEl){
    sumEl.innerHTML='<div style="display:flex;gap:8px;margin-bottom:4px">'+
      '<div style="background:#1a2e1e;border:1px solid #2e4e2e;border-radius:10px;padding:8px 12px;flex:1"><div class="u-fs10-gray">🌳 Дерево</div><div style="font-size:15px;font-weight:700;color:#c8f060">'+Math.round(totalWood).toLocaleString('ru-RU')+'₽</div>'+_qtyLine(qtyArtWood,qtyNoArtWood)+'</div>'+
      '<div style="background:#1e1a2e;border:1px solid #3e2e4e;border-radius:10px;padding:8px 12px;flex:1"><div class="u-fs10-gray">🛍 ДР Товар</div><div style="font-size:15px;font-weight:700;color:#a060f0">'+Math.round(totalDr).toLocaleString('ru-RU')+'₽</div>'+_qtyLine(qtyArtDr,qtyNoArtDr)+'</div>'+
      '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:10px;padding:8px 12px;flex:1"><div class="u-fs10-gray">Итого</div><div style="font-size:15px;font-weight:700;color:#f0f0f8">'+Math.round(totalWood+totalDr).toLocaleString('ru-RU')+'₽</div>'+_qtyLine(qtyArtWood+qtyArtDr,qtyNoArtWood+qtyNoArtDr)+'</div>'+
    '</div>'+
    '<div class="u-fs11-gray">'+rows.length+' записей · '+range.from+(range.from!==range.to?' — '+range.to:'')+'</div>';
  }
  var listEl=document.getElementById('adminRcvList');
  if(!listEl) return;
  if(!rows.length){ listEl.innerHTML='<div class="empty"><div class="ei">'+(type==='receive'?'📥':'🗑')+'</div>Нет записей за период</div>'; return; }
  var groupByMonth = (_adminRcvPeriod==='year') ||
    (_adminRcvPeriod==='custom' && (function(){
      var f=document.getElementById('adminRcvFrom'), t=document.getElementById('adminRcvTo');
      var df=new Date((f&&f.value)||range.from), dt=new Date((t&&t.value)||range.to);
      return (dt-df)/(1000*86400)>31;
    })());
  function rowCard(r){
    var gtColor=r.goodsType==='dr'?'#a060f0':'#60f090';
    var gtLabel=r.goodsType==='dr'?'🛍 ДР':'🌳';
    var timeStr=r.ts?new Date(r.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
    return '<div style="background:#13131a;border:1px solid '+(r.isRevaluation?'#f0a060':'#2a2a3a')+';border-radius:10px;padding:10px 12px;margin-bottom:6px">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div style="flex:1">'+
          '<div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">'+
            '<span style="font-size:10px;font-weight:700;color:'+gtColor+'">'+gtLabel+'</span>'+
            '<span class="u-fs10-gray">'+r.shop+'</span>'+
            (timeStr?'<span style="font-size:10px;color:#606080">· '+timeStr+'</span>':'')+
            (r.isRevaluation?'<span style="font-size:10px;font-weight:700;color:#f0a060;background:#2a1e10;border-radius:6px;padding:1px 6px">🔄 ПЕРЕОЦЕНКА</span>':'')+
          '</div>'+
          '<div class="u-fs13-bold">'+r.label+'</div>'+
          (r.sub&&r.sub!==r.label?'<div class="u-fs11-gray">'+r.sub+'</div>':'')+
          (type==='receive'&&r.acceptedBy?'<div style="font-size:11px;color:#60c8f0;margin-top:2px">👤 принял: '+r.acceptedBy+'</div>':'')+
          (r.reason?'<div style="font-size:11px;color:#a060f0">'+r.reason+'</div>':'')+
          ((r.qtyArt||r.qtyNoArt)?'<div style="font-size:11px;color:#8888aa;margin-top:2px">'+(r.qtyArt+r.qtyNoArt)+' шт. ('+r.qtyArt+' с арт. · '+r.qtyNoArt+' без)</div>':'')+
        '</div>'+
        '<div style="text-align:right;padding-left:10px;flex-shrink:0">'+
          '<div style="font-size:15px;font-weight:700;color:'+gtColor+'">'+Math.round(r.amount).toLocaleString('ru-RU')+'₽</div>'+
        '</div>'+
      '</div>'+
      (r.invId?'<button type="button" onclick="adminOpenInvoiceFromList(\''+r.invId+'\',\''+(r.shiftId||'')+'\')" style="font-size:11px;padding:3px 9px;background:#22222e;border:1px solid #2e2e3e;border-radius:6px;color:#60c8f0;cursor:pointer;margin-top:5px;margin-right:6px">📋 Открыть накладную</button>':'')+
      (type==='receive'&&r.entryId&&r.shiftId&&session&&session.role==='shopadmin'?'<button type="button" onclick="adminDeleteReceipt(\''+r.entryId+'\',\''+r.shiftId+'\',\''+(r.invId||'')+'\')" style="font-size:11px;padding:3px 9px;background:#2e1a1a;border:1px solid #f06060;border-radius:6px;color:#f06060;cursor:pointer;margin-top:5px;margin-left:6px">🗑 Удалить накладную</button>':'')+
      (type==='writeoff'&&r.entryId&&r.shiftId&&(r.items||[]).length&&session&&session.role==='shopadmin'?'<button type="button" onclick="adminEditWo(\''+r.entryId+'\',\''+r.shiftId+'\')" style="font-size:11px;padding:3px 9px;background:#22222e;border:1px solid #c8f060;border-radius:6px;color:#c8f060;cursor:pointer;margin-top:5px;margin-right:6px">✏️ Изменить накладную</button>':'')+
      (r.entryId&&r.shiftId?'<button type="button" onclick="adminToggleMoveDate(this,\''+r.entryId+'\',\''+r.shiftId+'\',\''+r.shop.replace(/'/g,"\\'")+'\')" style="font-size:11px;padding:3px 9px;background:#22222e;border:1px solid #2e2e3e;border-radius:6px;color:#f0a060;cursor:pointer;margin-top:5px">📅 Изменить дату '+(type==='writeoff'?'списания':'прихода')+'</button>':'')+
    '</div>';
  }
  function groupHeader(key, label, count, total, isOpen, qtyArt, qtyNoArt){
    var totalStr = Math.round(total).toLocaleString('ru-RU')+'₽';
    var qtyStr = ((qtyArt||qtyNoArt)) ? ' · '+((qtyArt||0)+(qtyNoArt||0))+' шт. ('+(qtyArt||0)+' с арт. / '+(qtyNoArt||0)+' без)' : '';
    return '<div onpointerdown="event.preventDefault();adminRcvToggle(\''+key+'\')" '+
      'style="background:#1a1a22;border:1px solid #3e3e4e;border-radius:12px;padding:10px 14px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;cursor:pointer">'+
      '<div>'+
        '<div class="u-fs13-bold">'+label+'</div>'+
        '<div class="u-fs11-gray">'+count+' накладных · '+totalStr+qtyStr+'</div>'+
      '</div>'+
      '<div style="font-size:16px;color:#c8f060">'+(isOpen?'▲':'▼')+'</div>'+
    '</div>';
  }
  var html = '';
  if(groupByMonth){
    var byMonth = {};
    rows.forEach(function(r){
      var mm = r.date.slice(0,7); // yyyy-mm
      if(!byMonth[mm]) byMonth[mm]={rows:[],total:0,count:0,qtyArt:0,qtyNoArt:0};
      byMonth[mm].rows.push(r); byMonth[mm].total+=r.amount; byMonth[mm].count++; byMonth[mm].qtyArt+=r.qtyArt; byMonth[mm].qtyNoArt+=r.qtyNoArt;
    });
    var months = Object.keys(byMonth).sort().reverse();
    months.forEach(function(mm){
      var mData=byMonth[mm];
      var mLabel=(function(){
        var parts=mm.split('-');
        var mNames=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
        return mNames[parseInt(parts[1],10)-1]+' '+parts[0];
      })();
      var mOpen=!!_adminRcvOpen['m_'+mm];
      html+=groupHeader('m_'+mm,mLabel,mData.count,mData.total,mOpen,mData.qtyArt,mData.qtyNoArt);
      if(mOpen){
        var byDay={};
        mData.rows.forEach(function(r){ var d=r.date; if(!byDay[d]) byDay[d]={rows:[],total:0,count:0,qtyArt:0,qtyNoArt:0}; byDay[d].rows.push(r); byDay[d].total+=r.amount; byDay[d].count++; byDay[d].qtyArt+=r.qtyArt; byDay[d].qtyNoArt+=r.qtyNoArt; });
        var days=Object.keys(byDay).sort().reverse();
        days.forEach(function(d){
          var dData=byDay[d]; var parts=d.split('-');
          var dLabel=parts[2]+'.'+parts[1]+'.'+parts[0];
          var dKey='d_'+d; var dOpen=!!_adminRcvOpen[dKey];
          html+='<div style="margin-left:12px">';
          html+=groupHeader(dKey,dLabel,dData.count,dData.total,dOpen,dData.qtyArt,dData.qtyNoArt);
          if(dOpen){ html+='<div style="margin-left:12px">'; dData.rows.forEach(function(r){ html+=rowCard(r); }); html+='</div>'; }
          html+='</div>';
        });
      }
    });
  } else {
    var byDay2={};
    rows.forEach(function(r){ var d=r.date; if(!byDay2[d]) byDay2[d]={rows:[],total:0,count:0,qtyArt:0,qtyNoArt:0}; byDay2[d].rows.push(r); byDay2[d].total+=r.amount; byDay2[d].count++; byDay2[d].qtyArt+=r.qtyArt; byDay2[d].qtyNoArt+=r.qtyNoArt; });
    var days2=Object.keys(byDay2).sort().reverse();
    days2.forEach(function(d){
      var dData=byDay2[d]; var parts=d.split('-');
      var dLabel=parts[2]+'.'+parts[1]+'.'+parts[0];
      var dKey='d2_'+d; var dOpen=!!_adminRcvOpen[dKey];
      if(days2.length===1 && _adminRcvPeriod==='today'){
        dData.rows.forEach(function(r){ html+=rowCard(r); });
      } else {
        html+=groupHeader(dKey,dLabel,dData.count,dData.total,dOpen,dData.qtyArt,dData.qtyNoArt);
        if(dOpen){ html+='<div style="margin-left:12px">'; dData.rows.forEach(function(r){ html+=rowCard(r); }); html+='</div>'; }
      }
    });
  }
  listEl.innerHTML = html||'<div class="empty"><div class="ei">📥</div>Нет записей</div>';
}
function getStock(){
  try{ return JSON.parse(localStorage.getItem('iz_stock')||'{}'); }catch(e){ return {}; }
}
function saveStock(stock){
  // Раньше localStorage.setItem здесь падал синхронно при переполнении памяти телефона и
  // обрывал функцию ДО цикла отправки в Firestore ниже — значит, при переполнении остаток
  // не обновлялся вообще нигде (ни локально, ни в облаке), и товар оставался «не в наличии»
  // даже после реальной приёмки/продажи (тот же инцидент 09.09.2026, что и с задвоением
  // продаж — переполнение памяти на телефоне продавца). _safeLocalSet сама пробует освободить
  // место и не бросает исключение, так что цикл ниже теперь выполняется всегда.
  if(typeof _safeLocalSet==='function') _safeLocalSet('iz_stock', JSON.stringify(stock));
  else localStorage.setItem('iz_stock', JSON.stringify(stock));
  var shops=Object.keys(stock);
  shops.forEach(function(sn){
    try{ db.collection('iz_settings').doc('stock_'+sn.replace(/\s+/g,'_')).set({items:stock[sn],updatedAt:new Date().toISOString()}); }catch(e){}
  });
}
function stockGetByNum(shopName,num){
  if(!shopName||!num) return null;
  var stock=getStock();
  var ss=stock[shopName]||{};
  return ss[String(num)]||null;
}
function _noArticleStockKey(name,price,species,goodsType){
  var nm=(name||'').trim().toLowerCase().replace(/\s+/g,'_').slice(0,30);
  if(!nm) return null;
  var pr=Math.round(parseFloat(price)||0);
  if(goodsType==='dr'){
    return 'DR_'+nm+'_'+pr;
  }
  var sp=(species||'').trim().toLowerCase().replace(/\s+/g,'_').slice(0,20);
  return 'WD_'+nm+'_'+pr+(sp?'_'+sp:'');
}
function stockUpdateQty(shopName,num,name,price,species,goodsType,size,qtyDelta,date){
  if(!shopName||!num) return;
  var stock=getStock();
  if(!stock[shopName]) stock[shopName]={};
  var key=String(num);
  if(!stock[shopName][key]){
    stock[shopName][key]={num:key,name:name||'',price:price||0,species:species||'',goodsType:goodsType||'derevo',size:size||'',qty:0,lastReceived:'',lastSold:''};
  }
  var entry=stock[shopName][key];
  if(name) entry.name=name;
  if(price) entry.price=price;
  if(species) entry.species=species;
  if(goodsType) entry.goodsType=goodsType;
  if(size) entry.size=size;
  var prevQty = entry.qty||0;
  entry.qty=Math.max(0,prevQty+qtyDelta);
  if(qtyDelta>0) entry.lastReceived=date||new Date().toISOString().split('T')[0];
  if(qtyDelta<0 && entry.qty===0){
    entry.lastSold=date||new Date().toISOString().split('T')[0];
  }
  saveStock(stock);
}
// Списание уменьшает склад так же, как продажа: по артикулу, а у безартикульной позиции — по
// ключу название+цена(+порода), с тем же поиском похожей записи остатка, что и в продаже.
// Раньше списание продавца уменьшало склад только для позиций с номером, а списание админом из
// карточки смены — не уменьшало вовсе.
function stockApplyWriteoff(shopName,items){
  stockApplySale(shopName, (items||[]).filter(function(it){ return !it.isRevaluation; }));
}
function stockApplySale(shopName,items){
  if(!shopName) return;
  var stock=getStock();
  var shopStock=stock[shopName]||{};
  items.forEach(function(it){
    var hasRealArticle = !!(it.article||it.num||it.artNum);
    var artNum=it.article||it.num||it.artNum;
    if(!artNum) artNum=_noArticleStockKey(it.name,it.price,it.species,it.goodsType);
    if(!artNum) return;
    var useKey = artNum;
    if(!hasRealArticle && !(shopStock[artNum] && (shopStock[artNum].qty||0)>0)){
      var found = _findStockKeyByNamePrice(shopStock, it.name, it.price, it.goodsType, artNum);
      if(found) useKey = found;
    }
    stockUpdateQty(shopName,useKey,it.name,it.price,it.species,it.goodsType,it.size,-(it.qty||1),null);
  });
}
function _findStockKeyByNamePrice(shopStock, name, price, goodsType, excludeKey){
  var nm=(name||'').trim().toLowerCase();
  var pr=Math.round(parseFloat(price)||0);
  if(!nm) return null;
  var candidates = Object.keys(shopStock).filter(function(k){
    if(k===excludeKey) return false;
    var e = shopStock[k];
    if(!e || (e.qty||0)<=0) return false;
    if((e.goodsType||'derevo')!==(goodsType||'derevo')) return false;
    if((e.name||'').trim().toLowerCase()!==nm) return false;
    if(Math.round(parseFloat(e.price)||0)!==pr) return false;
    return true;
  });
  if(!candidates.length) return null;
  var noSpecies = candidates.find(function(k){ return !(shopStock[k].species||'').trim(); });
  return noSpecies || candidates[0];
}
function stockApplyReceive(shopName,items,date,invGoodsType,isRevaluation){
  if(!shopName) return;
  items.forEach(function(it){
    var gt=it.goodsType||(it.category==='dr'?'dr':(invGoodsType||'derevo'));
    var artNum=it.article||it.num||it.artNum;
    var pr=it.price||it.factPrice||0;
    if(!artNum) artNum=_noArticleStockKey(it.name,pr,it.species,gt);
    if(!artNum) return;
    // Переоценка правит цену уже существующего изделия, а не добавляет новую единицу — раньше
    // это не учитывалось, и переоценка одного товара молча плюсовала ему фантомную штуку в остаток.
    stockUpdateQty(shopName,artNum,it.name,pr,it.species,gt,it.size||'',(isRevaluation?0:(it.qty||1)),date);
  });
}
function rebuildStock(showMsg){
  var stock={};
  var shops=getShopNames();
  shops.forEach(function(sn){ stock[sn]={}; });
  var manInvs=JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  // По возрастанию времени приёмки: цена изделия берётся у ПОСЛЕДНЕЙ накладной (иначе более старая
  // накладная, обработанная позже, возвращала прежнюю цену поверх переоценки).
  var _manInvsAsc = manInvs.slice().sort(function(a,b){ return String(a.acceptedAt||a.date||'').localeCompare(String(b.acceptedAt||b.date||'')); });
  _manInvsAsc.forEach(function(inv){
    var sn=inv.destName||inv.shopName||inv.shop;
    if(!sn) return;
    if(!stock[sn]) stock[sn]={};
    var date=inv.acceptedAt?inv.acceptedAt.split('T')[0]:(inv.date||'');
    var itemsList=inv.acceptedItems||inv.items||[];
    var invGoodsType = inv.goodsType || (inv.category==='dr'?'dr':'derevo');
    itemsList.forEach(function(it){
      var artNum=it.article||it.num||it.artNum;
      var gt=it.goodsType||(it.category==='dr'?'dr':invGoodsType);
      var pr=it.factPrice||it.price||0;
      if(!artNum) artNum=_noArticleStockKey(it.name,pr,it.species,gt);
      if(!artNum) return;
      var key=String(artNum);
      var qty=inv.isRevaluation ? 0 : (it.qty||1); // переоценка — тот же товар с новой ценой, не новая поставка
      if(!stock[sn][key]) stock[sn][key]={num:key,name:it.name||'',price:pr,species:it.species||'',goodsType:gt,size:it.size||'',qty:0,lastReceived:''};
      stock[sn][key].qty+=qty;
      if(date>(stock[sn][key].lastReceived||'')) stock[sn][key].lastReceived=date;
      if(it.name) stock[sn][key].name=it.name;
      if(pr) stock[sn][key].price=pr;
      if(!it.goodsType && invGoodsType) stock[sn][key].goodsType=gt;
    });
  });
  var wsInvs=JSON.parse(localStorage.getItem('iz_invoices')||'[]');
  wsInvs.forEach(function(inv){
    if(inv.status!=='accepted') return;
    var sn=inv.destName||inv.shopName;
    if(!sn) return;
    if(!stock[sn]) stock[sn]={};
    var date=inv.acceptedAt?inv.acceptedAt.split('T')[0]:(inv.acceptedDate||inv.date||'');
    var itemsList=inv.acceptedItems||inv.items||[];
    var wsInvGoodsType = inv.goodsType||(inv.category==='dr'?'dr':'derevo');
    itemsList.forEach(function(it){
      var artNum=it.article||it.num||it.artNum;
      var gt=it.goodsType||wsInvGoodsType||'derevo';
      var pr=it.factPrice||it.price||0;
      if(!artNum) artNum=_noArticleStockKey(it.name,pr,it.species,gt);
      if(!artNum) return;
      var key=String(artNum);
      var qty=it.qty||1;
      if(!stock[sn][key]) stock[sn][key]={num:key,name:it.name||'',price:pr,species:it.species||'',goodsType:gt,size:it.size||'',qty:0,lastReceived:''};
      stock[sn][key].qty+=qty;
      if(date>(stock[sn][key].lastReceived||'')) stock[sn][key].lastReceived=date;
      if(pr) stock[sn][key].price=pr;
    });
  });
  var allShifts=JSON.parse(localStorage.getItem('iz_shifts')||'[]');
  var countedInvIds={};
  manInvs.forEach(function(inv){ var id=inv.id||inv._id; if(id) countedInvIds[String(id)]=true; });
  wsInvs.forEach(function(inv){ var id=inv.id||inv._id; if(id) countedInvIds[String(id)]=true; });
  allShifts.forEach(function(sh){
    var sn=sh.shopName; if(!sn) return;
    if(!stock[sn]) stock[sn]={};
    var legacyRcvDate = sh.date || (sh.closedAt?sh.closedAt.split('T')[0]:(sh.openedAt?sh.openedAt.split('T')[0]:''));
    (sh.goodsReceives||[]).forEach(function(it){
      var an=it.article||it.num; if(!an) an=_noArticleStockKey(it.name,it.price,it.species,'derevo');
      if(!an) return;
      var k=String(an);
      if(!stock[sn][k]) stock[sn][k]={num:k,name:it.name||'',price:it.price||0,species:it.species||'',goodsType:'derevo',size:'',qty:0,lastReceived:''};
      stock[sn][k].qty+=(it.qty||1);
      if(legacyRcvDate>(stock[sn][k].lastReceived||'')) stock[sn][k].lastReceived=legacyRcvDate;
    });
    (sh.drGoodsReceives||[]).forEach(function(it){
      var an=it.article||it.num; if(!an) an=_noArticleStockKey(it.name,it.price,it.species,'dr');
      if(!an) return;
      var k=String(an);
      if(!stock[sn][k]) stock[sn][k]={num:k,name:it.name||'',price:it.price||0,species:it.species||'',goodsType:'dr',size:'',qty:0,lastReceived:''};
      stock[sn][k].qty+=(it.qty||1);
      if(legacyRcvDate>(stock[sn][k].lastReceived||'')) stock[sn][k].lastReceived=legacyRcvDate;
    });
    (sh.goodsWriteoffs||[]).forEach(function(it){
      var an=it.article||it.num; if(!an) an=_noArticleStockKey(it.name,it.price,it.species,'derevo');
      if(!an || !stock[sn][String(an)]) return;
      var k=String(an);
      stock[sn][k].qty=Math.max(0,(stock[sn][k].qty||0)-(it.qty||1));
    });
    (sh.drGoodsWriteoffs||[]).forEach(function(it){
      var an=it.article||it.num; if(!an) an=_noArticleStockKey(it.name,it.price,it.species,'dr');
      if(!an || !stock[sn][String(an)]) return;
      var k=String(an);
      stock[sn][k].qty=Math.max(0,(stock[sn][k].qty||0)-(it.qty||1));
    });
    var shJ=sh.journal||[];
    shJ.forEach(function(e){
      if(e.type==='sale'){
        var saleDate=e.ts?e.ts.split('T')[0]:(sh.date||sh.closedAt?sh.closedAt.split('T')[0]:'');
        (e.items||[]).forEach(function(it){
          var hasArt = !!(it.article||it.num||it.artNum||it.art);
          var artNum=it.article||it.num||it.artNum||it.art;
          if(!artNum) artNum=_noArticleStockKey(it.name,it.price,it.species,it.goodsType);
          if(!artNum) return;
          var key=String(artNum);
          if(!stock[sn][key] && !hasArt){
            var foundKey = _findStockKeyByNamePrice(stock[sn], it.name, it.price, it.goodsType, key);
            if(foundKey) key = foundKey;
          }
          if(!stock[sn][key]) return;
          var prev=stock[sn][key].qty||0;
          stock[sn][key].qty=Math.max(0,prev-(it.qty||1));
          if(saleDate && stock[sn][key].qty===0){
            if(!stock[sn][key].lastSold || saleDate>stock[sn][key].lastSold)
              stock[sn][key].lastSold=saleDate;
          }
          if(saleDate && (!stock[sn][key].lastSold || saleDate>stock[sn][key].lastSold))
            stock[sn][key]._lastSaleDate=saleDate;
        });
      } else if(e.type==='receive'){
        if(e.invId && countedInvIds[String(e.invId)]) return;
        var rcvItem = e.items && e.items[0];
        var rcvArt = e.article||(rcvItem&&(rcvItem.article||rcvItem.num));
        var rcvGt = e.goodsType||'derevo';
        var rcvPrice = (rcvItem&&rcvItem.price!=null) ? rcvItem.price : (e.amount||0);
        // Переоценка (isRevaluation) — это тот же самый физический товар, который уже стоит на
        // складе, просто с новой ценой, а не новая поставка. Раньше qty прибавлялось всегда,
        // независимо от этого флага, поэтому переоценка одного изделия молча плюсовала ему
        // фантомную единицу — например, одна доска после переоценки начинала числиться как две.
        var rcvQty = e.isRevaluation ? 0 : ((rcvItem&&rcvItem.qty) ? rcvItem.qty : 1);
        if(!rcvArt && rcvItem){
          rcvArt = _noArticleStockKey(rcvItem.name||e.name, rcvPrice, rcvItem.species, rcvGt);
        }
        if(rcvArt){
          var key=String(rcvArt);
          if(!stock[sn][key]) stock[sn][key]={num:key,name:e.name||(rcvItem&&rcvItem.name)||'',price:rcvPrice,species:(rcvItem&&rcvItem.species)||'',goodsType:rcvGt,size:'',qty:0,lastReceived:''};
          // Раньше цена обновлялась только при первом создании ключа (например, из исходной
          // накладной) — последующие приходы того же артикула (в т.ч. переоценка) двигали qty,
          // но никогда не обновляли price, так что rebuildStock() при каждом логине/пересчёте
          // молча откатывал любую правку цены обратно к самой первой известной цене.
          if(rcvPrice) stock[sn][key].price=rcvPrice;
          if(rcvItem&&rcvItem.name) stock[sn][key].name=rcvItem.name;
          // Порода/размер, в отличие от цены и названия, раньше обновлялись только при первом
          // создании ключа — правка породы (например, из инвентаризации) держалась только до
          // следующего rebuildStock(), а потом молча откатывалась к самой первой известной породе.
          if(rcvItem&&rcvItem.species) stock[sn][key].species=rcvItem.species;
          if(rcvItem&&rcvItem.size) stock[sn][key].size=rcvItem.size;
          stock[sn][key].qty+=rcvQty;
          stock[sn][key].goodsType=rcvGt;
          var d=e.ts?e.ts.split('T')[0]:'';
          if(d>(stock[sn][key].lastReceived||'')) stock[sn][key].lastReceived=d;
        } else if(e.invId && !countedInvIds[String(e.invId)]){
          var linkedInv = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]')
            .concat(JSON.parse(localStorage.getItem('iz_invoices')||'[]'))
            .find(function(i){ return (i.id||i._id)===e.invId; });
          if(linkedInv){
            var liGt = linkedInv.goodsType||(linkedInv.category==='dr'?'dr':'derevo');
            var liDate = linkedInv.acceptedAt?linkedInv.acceptedAt.split('T')[0]:(linkedInv.date||'');
            (linkedInv.items||[]).forEach(function(it){
              var an=it.article||it.num||it.artNum;
              var pr=it.factPrice||it.price||0;
              var gt=it.goodsType||liGt;
              if(!an) an=_noArticleStockKey(it.name,pr,it.species,gt);
              if(!an) return;
              var k=String(an);
              if(!stock[sn][k]) stock[sn][k]={num:k,name:it.name||'',price:pr,species:it.species||'',goodsType:gt,size:'',qty:0,lastReceived:''};
              stock[sn][k].qty+=(it.qty||1);
              if(liDate>(stock[sn][k].lastReceived||'')) stock[sn][k].lastReceived=liDate;
              countedInvIds[String(e.invId)]=true;
            });
          }
        }
      } else if(e.type==='writeoff'){
        (e.items||[]).forEach(function(it){
          var artNum=it.article||it.num||it.artNum;
          if(!artNum) artNum=_noArticleStockKey(it.name,it.price,it.species,it.goodsType);
          if(!artNum) return;
          var key=String(artNum);
          if(!stock[sn][key]) return;
          stock[sn][key].qty=Math.max(0,(stock[sn][key].qty||0)-(it.qty||1));
        });
      } else if(e.type==='staff'){
        var stArt=e.article||e.num||e.artNum;
        if(stArt){
          var key=String(stArt);
          if(stock[sn]&&stock[sn][key]){
            stock[sn][key].qty=Math.max(0,(stock[sn][key].qty||0)-(e.qty||1));
          }
        }
      }
    });
  });
  if(session&&session.shopName){
    var sn=session.shopName;
    if(!stock[sn]) stock[sn]={};
    journal.forEach(function(e){
      if(e.type==='sale'){
        (e.items||[]).forEach(function(it){
          var artNum=it.num||it.article||it.artNum;
          if(!artNum) artNum=_noArticleStockKey(it.name,it.price,it.species,it.goodsType);
          if(!artNum) return;
          var key=String(artNum);
          if(!stock[sn][key]) return;
          stock[sn][key].qty=Math.max(0,(stock[sn][key].qty||0)-(it.qty||1));
        });
      } else if(e.type==='writeoff'){
        (e.items||[]).forEach(function(it){
          var artNum=it.num||it.article||it.artNum;
          if(!artNum) artNum=_noArticleStockKey(it.name,it.price,it.species,it.goodsType);
          if(!artNum) return;
          var key=String(artNum);
          if(!stock[sn][key]) return;
          stock[sn][key].qty=Math.max(0,(stock[sn][key].qty||0)-(it.qty||1));
        });
      } else if(e.type==='staff'){
        if(e.article&&stock[sn]&&stock[sn][String(e.article)]){
          stock[sn][String(e.article)].qty=Math.max(0,(stock[sn][String(e.article)].qty||0)-(e.qty||1));
        }
      }
    });
  }
  Object.keys(stock).forEach(function(sn){
    Object.keys(stock[sn]||{}).forEach(function(key){
      var it=stock[sn][key];
      if((it.qty||0)===0 && !it.lastSold && it._lastSaleDate){
        it.lastSold=it._lastSaleDate;
      }
      delete it._lastSaleDate;
    });
  });
  saveStock(stock);
  if(showMsg){
    var total=0;
    Object.keys(stock).forEach(function(sn){ total+=Object.keys(stock[sn]).length; });
    showToast('✅ Остатки пересчитаны по всей истории продаж и приходов: '+total+' позиций во всех магазинах');
  }
  try{ renderStockPage(); }catch(e){}
}
var _stockMode = 'avail';
var _stockSort = 'date_desc'; // default: newest first // 'avail' | 'archive'
var _stockFilters = {}; // {article, name, species, type, shop}
var _stockSortOptions = [
  {key:'date_desc',  label:'📅 Новее'},
  {key:'date_asc',   label:'📅 Старее'},
  {key:'sold_desc',  label:'✓ Продано ↓'},
  {key:'sold_asc',   label:'✓ Продано ↑'},
  {key:'price_desc', label:'💰 Дороже'},
  {key:'price_asc',  label:'💰 Дешевле'}
];
function renderStockSortBtns(){
  var c=document.getElementById('stockSortBtns'); if(!c) return;
  c.innerHTML=_stockSortOptions.map(function(opt){
    var active=_stockSort===opt.key;
    return '<div onpointerdown="event.preventDefault();setStockSort(&quot;'+opt.key+'&quot;)" '+
      'style="padding:5px 10px;border-radius:16px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;'+
      'border:'+(active?'2px solid #c8f060':'1px solid #2e2e3e')+';'+
      'background:'+(active?'#1e2a14':'#22222e')+';'+
      'color:'+(active?'#c8f060':'#8888aa')+'">'+opt.label+'</div>';
  }).join('');
}
function setStockSort(key){
  _stockSort=key;
  renderStockSortBtns();
  renderStockPage();
}
function setStockMode(mode){
  _stockMode = mode;
  var btns = {avail:'stockModeAvail', archive:'stockModeArchive', byproduct:'stockModeProduct', byinvoice:'stockModeInvoice'};
  var colors = {avail:'#c8f060', archive:'#f0a060', byproduct:'#60c8f0', byinvoice:'#a060f0'};
  var bgs = {avail:'#1e2a14', archive:'#2a1e10', byproduct:'#0c1a20', byinvoice:'#1a1420'};
  Object.keys(btns).forEach(function(m){
    var btn = document.getElementById(btns[m]);
    if(!btn) return;
    var active = m===mode;
    btn.style.borderColor = active?colors[m]:'#2e2e3e';
    btn.style.background = active?bgs[m]:'#22222e';
    btn.style.color = active?colors[m]:'#8888aa';
    btn.style.borderWidth = active?'2px':'1px';
  });
  var isCustomView = (mode==='byproduct'||mode==='byinvoice');
  var filterByRow = document.getElementById('stockFilterBy'); if(filterByRow && filterByRow.parentElement) filterByRow.parentElement.style.display = isCustomView?'none':'block';
  var sortRow = document.getElementById('stockSortBtns'); if(sortRow && sortRow.parentElement) sortRow.parentElement.style.display = isCustomView?'none':'flex';
  var rebuildRow = document.getElementById('stockFilterCount'); if(rebuildRow && rebuildRow.parentElement) rebuildRow.parentElement.style.display = isCustomView?'none':'flex';
  if(mode==='byproduct'){ renderStockByProduct(); return; }
  if(mode==='byinvoice'){ renderStockByInvoice(); return; }
  renderStockPage();
}
function _stockGroupShops(){
  var isAdmin=session&&session.role==='shopadmin';
  var filterShop=(document.getElementById('stockFilterShop')||{}).value||'';
  if(filterShop) return [filterShop];
  return isAdmin?getShopNames():(session&&session.shopName?[session.shopName]:[]);
}
function renderStockByProduct(){
  var listEl = document.getElementById('stockList'); if(!listEl) return;
  var sumEl = document.getElementById('stockSummary'); if(sumEl) sumEl.innerHTML='';
  var rows = _stockGetAllItems().filter(function(it){ return (it.qty||0)>0; });
  var groups = {};
  rows.forEach(function(it){
    var key = (it.name||'—').trim();
    if(!groups[key]) groups[key] = {name:key, qty:0, sum:0, items:[]};
    groups[key].qty += (it.qty||0);
    groups[key].sum += (it.qty||0)*(it.price||0);
    groups[key].items.push(it);
  });
  var groupList = Object.values(groups).sort(function(a,b){ return b.qty-a.qty; });
  if(!groupList.length){ listEl.innerHTML = '<div class="empty"><div class="ei">📦</div>Нет товаров в наличии</div>'; return; }
  listEl.innerHTML = '<div style="font-size:11px;color:#8888aa;margin-bottom:8px">'+groupList.length+' наименований в наличии</div>'+
    groupList.map(function(g,gi){
      var gkey = 'stprod_'+gi;
      return '<div style="border:1px solid #2e2e3e;border-radius:12px;margin-bottom:8px;overflow:hidden">'+
        '<div onclick="_toggleStockGroup(\''+gkey+'\')" style="display:flex;justify-content:space-between;align-items:center;padding:12px;cursor:pointer;background:#1a1a22">'+
          '<div class="u-fs13-bold">'+g.name+'</div>'+
          '<div style="display:flex;align-items:center;gap:8px">'+
            '<div style="font-size:12px;color:#c8f060;font-weight:700">'+g.qty+' шт. · '+fmt(g.sum)+'</div>'+
            '<span id="'+gkey+'_arr" style="color:#8888aa">▶</span>'+
          '</div>'+
        '</div>'+
        '<div id="'+gkey+'" style="display:none;padding:0 12px 12px">'+
          g.items.sort(function(a,b){ return (a.species||'').localeCompare(b.species||'','ru'); }).map(function(it){
            return '<div style="display:flex;justify-content:space-between;padding:8px;background:#13131a;border-radius:8px;margin-top:6px;font-size:12px">'+
              '<div><span style="color:#8888aa">№'+(it.num||'—')+'</span> · '+(it.species||'')+' · <span style="color:#555568">'+(it._shop||'')+'</span></div>'+
              '<div style="font-weight:700">'+it.qty+' шт. · '+fmt(it.price||0)+'</div>'+
            '</div>';
          }).join('')+
        '</div>'+
      '</div>';
    }).join('');
}
function _toggleStockGroup(key){
  var el = document.getElementById(key); var arr = document.getElementById(key+'_arr');
  if(!el) return;
  var open = el.style.display==='block';
  el.style.display = open?'none':'block';
  if(arr) arr.textContent = open?'▶':'▾';
}
function renderStockByInvoice(){
  var listEl = document.getElementById('stockList'); if(!listEl) return;
  var sumEl = document.getElementById('stockSummary'); if(sumEl) sumEl.innerHTML='';
  var shops = _stockGroupShops();
  var stock = getStock();
  var allInv = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]').concat(JSON.parse(localStorage.getItem('iz_invoices')||'[]'));
  var invoices = allInv.filter(function(iv){ return shops.indexOf(iv.destName||iv.shopName)>=0 && iv.status==='accepted'; });
  invoices.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
  if(!invoices.length){ listEl.innerHTML = '<div class="empty"><div class="ei">📥</div>Принятых накладных не найдено</div>'; return; }
  listEl.innerHTML = '<div style="font-size:11px;color:#8888aa;margin-bottom:8px">'+invoices.length+' накладных. Показывает текущий остаток по каждому артикулу — если по этому же артикулу были и другие приходы, остаток общий на всех, не только из этой накладной.</div>'+
    invoices.map(function(inv, ii){
      var ikey = 'stinv_'+ii;
      var shopName = inv.destName||inv.shopName;
      var shopStock = stock[shopName]||{};
      var items = inv.acceptedItems||inv.items||[];
      var stillHave = 0, soldOut = 0;
      var rows = items.map(function(it){
        var art = String(it.num||it.article||'');
        var stockItem = shopStock[art];
        var curQty = stockItem ? (stockItem.qty||0) : 0;
        var received = it.qty||1;
        if(curQty>0) stillHave++; else soldOut++;
        var statusIcon = curQty<=0 ? '🔴' : (curQty<received ? '🟡' : '🟢');
        return '<div style="display:flex;justify-content:space-between;padding:8px;background:#13131a;border-radius:8px;margin-top:6px;font-size:12px">'+
          '<div>'+statusIcon+' <span style="color:#8888aa">№'+(art||'—')+'</span> '+(it.name||'')+'</div>'+
          '<div style="text-align:right"><div>получено: '+received+'</div><div style="color:'+(curQty<=0?'#f06060':'#60f090')+'">в наличии: '+curQty+'</div></div>'+
        '</div>';
      }).join('');
      var acceptedByLbl = inv.acceptedBy || inv.createdBy || '';
      return '<div style="border:1px solid #2e2e3e;border-radius:12px;margin-bottom:8px;overflow:hidden">'+
        '<div onclick="_toggleStockGroup(\''+ikey+'\')" style="display:flex;justify-content:space-between;align-items:center;padding:12px;cursor:pointer;background:#1a1a22">'+
          '<div><div class="u-fs13-bold">'+(inv.num?'№'+inv.num+' · ':'')+(inv.date||'')+'</div>'+
            '<div class="u-fs10-gray">'+shopName+(inv.from?' · от '+inv.from:'')+' · '+items.length+' поз.</div>'+
            (acceptedByLbl?'<div style="font-size:10px;color:#60c8f0;margin-top:2px">👤 принял: '+acceptedByLbl+'</div>':'')+'</div>'+
          '<div style="display:flex;align-items:center;gap:8px">'+
            '<div class="u-fs11-gray">🟢'+stillHave+' 🔴'+soldOut+'</div>'+
            '<span id="'+ikey+'_arr" style="color:#8888aa">▶</span>'+
          '</div>'+
        '</div>'+
        '<div id="'+ikey+'" style="display:none;padding:0 12px 12px">'+rows+'</div>'+
      '</div>';
    }).join('');
}
// ════ Задвоение номеров изделий ════
// Каждый номер изделия (артикул) должен встречаться в приёмках ровно один раз за всю историю —
// это уникальная бирка, которую мастерская наносит на конкретную физическую вещь. Если один и
// тот же номер попадает в приёмку дважды под разными названиями — это ломает остатки (обе вещи
// делят один слот на складе) и путает продавцов при продаже/списании. Индекс строится по ВСЕМ
// сменам всех магазинов сразу (номер должен быть уникален для всей сети, а не в рамках одного
// магазина), поэтому используется одним и тем же кодом и для аудита, и для проверки при вводе.
var _usedArtIndex = null; // num(string) -> [{shop,date,name,species,invId,invNum}]
var _usedArtIndexAt = 0;
function _buildUsedArticleIndex(forceRefresh){
  var now = Date.now();
  if(_usedArtIndex && !forceRefresh && (now - _usedArtIndexAt) < 10*60*1000){
    return _buildWriteoffArtIndex().then(function(){ return _usedArtIndex; }, function(){ return _usedArtIndex; });
  }
  // Состав позиций живёт в самих документах накладной (iz_manual_invoices / iz_invoices) —
  // items у "Приёмки" в журнале смены НЕ хранятся (там только итоговая сумма), поэтому
  // раньше сканирование по журналу пропускало все накладные, внесённые вручную (именно там
  // и нашлось реальное задвоение №51962 — Менажница/Подсвечник).
  return Promise.all([
    db.collection('iz_manual_invoices').get({source:'server'}),
    db.collection('iz_invoices').get({source:'server'})
  ]).then(function(res){
    var idx = {};
    function addOcc(num, occ){
      var key = String(num||'').trim();
      if(!key) return;
      if(!idx[key]) idx[key] = [];
      idx[key].push(occ);
    }
    function scanInvoiceSnap(snap){
      snap.forEach(function(doc){
        var inv = doc.data();
        if(inv.isRevaluation) return; // переоценка возвращает те же номера — это не задвоение
        var invId = inv.id!=null ? inv.id : (inv._id!=null ? inv._id : doc.id);
        var items = inv.acceptedItems || inv.items || [];
        items.forEach(function(it){
          addOcc(it.num||it.article, {shop:inv.destName||inv.shopName||'—', date:inv.date||inv.acceptedDate||'—', name:it.name||'—', species:it.species||'', invId:invId, invNum:inv.num||''});
        });
      });
    }
    scanInvoiceSnap(res[0]);
    scanInvoiceSnap(res[1]);
    _usedArtIndex = idx;
    _usedArtIndexAt = now;
    return idx;
  }).then(function(idx){
    return _buildWriteoffArtIndex().then(function(){ return idx; }, function(){ return idx; });
  });
}
// Списания по номерам — нужны, чтобы при перемещении между магазинами разрешать повторную
// приёмку номера только если в старом магазине его уже списали. Берём из iz_journal_backup:
// туда каждая запись журнала уходит сразу, в т.ч. из ещё открытой смены (сам журнал открытой
// смены живёт только на телефоне продавца). Без кэша — списание могли сделать минуты назад.
var _woArtIndex = null; // num -> [{shop,date}]
function _buildWriteoffArtIndex(){
  return db.collection('iz_journal_backup').where('kind','==','writeoff').get({source:'server'}).then(function(snap){
    var idx = {};
    snap.forEach(function(doc){
      var e = doc.data();
      if(e.isRevaluation) return; // переоценка: товар остаётся на месте
      var date = e.date || String(e.ts||'').split('T')[0];
      (e.items||[]).forEach(function(it){
        if(it.isRevaluation) return;
        var key = String(it.num||it.article||'').trim();
        if(!key) return;
        (idx[key] = idx[key]||[]).push({shop:e.shopName||'', date:date});
      });
    });
    _woArtIndex = idx;
    return idx;
  });
}
// Синхронная проверка одного номера по уже загруженному индексу (для проверки при вводе —
// без ожидания сети). excludeInvId — чтобы не считать «задвоением» ту же самую накладную,
// которую сейчас редактируют (иначе уже сохранённый номер этой же позиции ложно ловился бы
// как задвоение сам с собой).
function _checkArtDupSync(num, excludeInvId){
  if(!_usedArtIndex) return null;
  var key = String(num||'').trim();
  if(!key) return null;
  var occs = _usedArtIndex[key];
  if(!occs || !occs.length) return null;
  var filtered = excludeInvId ? occs.filter(function(o){ return o.invId!==excludeInvId; }) : occs;
  return filtered.length ? filtered : null;
}
function loadDupArticleAudit(forceRefresh){
  var status = document.getElementById('daStatus');
  var results = document.getElementById('daResults');
  if(status){ status.style.display='block'; status.textContent='⏳ Загружаю все приёмки по всем магазинам...'; }
  if(results) results.innerHTML='';
  var settled = false;
  var timeoutP = new Promise(function(resolve){ setTimeout(function(){ if(!settled){ settled=true; resolve('timeout'); } }, 20000); });
  var fetchP = _buildUsedArticleIndex(forceRefresh).then(function(){ if(!settled){ settled=true; } return 'ok'; })
    .catch(function(){ if(!settled){ settled=true; } return 'error'; });
  Promise.race([fetchP, timeoutP]).then(function(result){
    if(status){
      status.style.display = result==='ok' ? 'none' : 'block';
      if(result==='timeout') status.textContent = '⚠️ Сервер не отвечает — попробуйте ещё раз';
      else if(result==='error') status.textContent = '❌ Не удалось загрузить данные';
    }
    renderDupArticleAudit();
  });
}
function renderDupArticleAudit(){
  var c = document.getElementById('daResults'); if(!c) return;
  if(!_usedArtIndex){ c.innerHTML = '<div class="empty"><div class="ei">🔢</div>Нажмите «Проверить все приёмки»</div>'; return; }
  var numericOnly = (document.getElementById('daNumericOnly')||{}).checked;
  var catalogArts = _catalogArticleSet();
  var dupKeys = Object.keys(_usedArtIndex).filter(function(num){
    var occs = _usedArtIndex[num];
    if(occs.length < 2) return false;
    if(catalogArts[String(num).toLowerCase()]) return false; // артикул модели из каталога — повтор нормален
    // «Числовой артикул» — уникальная бирка на конкретной физической вещи (например 51962).
    // Коды вроде «СвечСот02» — общий шифр партии товара без индивидуальной нумерации, там
    // повтор ожидаем и не является ошибкой. По умолчанию показываем только числовые, чтобы
    // не топить реальную проблему в шуме от партийных кодов.
    if(numericOnly && !/^\d+$/.test(num)) return false;
    return true;
  }).sort(function(a,b){ return _usedArtIndex[b].length - _usedArtIndex[a].length; });
  if(!dupKeys.length){ c.innerHTML = '<div class="empty"><div class="ei">✅</div>Задвоений номеров не найдено</div>'; return; }
  c.innerHTML = '<div style="font-size:12px;color:#f06060;font-weight:700;margin-bottom:8px">⚠️ Найдено '+dupKeys.length+' номеров, использованных больше одного раза</div>'+
    dupKeys.map(function(num){
      var occs = _usedArtIndex[num];
      return '<div style="background:#2e1a1a;border:1px solid #f06060;border-radius:10px;padding:10px 12px;margin-bottom:8px">'+
        '<div style="font-size:13px;font-weight:700;color:#f06060;margin-bottom:6px">№'+num+' — встречается '+occs.length+' раз</div>'+
        occs.map(function(o){
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-top:1px solid #3e2020;font-size:12px">'+
            '<div><b>'+o.name+'</b>'+(o.species?' · '+o.species:'')+'<div class="u-fs10-gray">'+o.shop+' · '+o.date+'</div></div>'+
            (o.invId?'<button type="button" onclick="adminOpenInvoiceFromList(\''+o.invId+'\',\''+(o.shiftId||'')+'\')" style="font-size:10px;padding:3px 8px;background:#22222e;border:1px solid #2e2e3e;border-radius:6px;color:#60c8f0;cursor:pointer;flex-shrink:0;margin-left:8px">📋 Открыть</button>':'')+
          '</div>';
        }).join('')+
      '</div>';
    }).join('');
}
// Сводка «что когда-либо продавалось/принималось/считалось под этим названием без артикула,
// по какой цене и какой породы» — нужна для ручного переноса старых записей в каталог (см.
// addWoodGoodsVariant в прочее.js). Артикул у ДР Товара обязателен всегда, поэтому смотрим
// только Дерево. Источники ровно те же три, что видит человек «в приёмках/продажах/инвентаризациях»:
// накладные (iz_manual_invoices/iz_invoices — как в _buildUsedArticleIndex), продажи из журналов
// всех смен (iz_shifts), и подсчёты всех инвентаризаций (iz_inventory_sessions/iz_inventory_counts).
function _naArticleOf(it){ return String((it&&(it.num||it.article))||'').trim(); }
// Единственная надёжная проверка «смена ещё открыта», как в смены.js:4376 (_shiftStillOpen) —
// НЕ sh.status!=='closed'. У части старых/архивных смен status вообще не 'closed' буквально
// (пустой, другое значение), хотя у них есть closedAt и в интерфейсе они показываются закрытыми
// («🔐 Закрыта: ...»). Проверка по status!=='closed' считала такие смены «ещё открытыми» —
// и в «Сводке без артикула» на них навешивался неверный ярлык «⏳ смена ещё открыта», и
// «Применить артикулы задним числом» пропускал их совсем, хотя на самом деле трогать их можно.
function _shIsShiftOpen(sh){ return sh.status==='open' || !sh.closedAt; }
// pendingReason — почему запись пока недостижима для «Применить артикулы задним числом»
// (тот инструмент нарочно трогает только закрытые смены и принятые накладные, а инвентаризации
// не сканирует вообще): 'open_shift' — смена ещё открыта, 'pending_invoice' — накладная ещё не
// принята, 'inventory' — это инвентаризация, туда автоподстановка артикулов не добирается никогда.
var NA_PENDING_LABELS = {open_shift:'смена ещё открыта', pending_invoice:'накладная не принята', inventory:'инвентаризация — переносится только вручную'};
function _naPendingBadge(pending){
  var reasons = Object.keys(pending||{});
  var total = reasons.reduce(function(s,k){ return s+pending[k]; },0);
  if(!total) return '';
  var label = reasons.length===1 ? NA_PENDING_LABELS[reasons[0]] : 'ждут: '+reasons.map(function(r){ return NA_PENDING_LABELS[r]; }).join(', ');
  return '<span style="color:#f0a060;font-size:10px">⏳ '+total+' — '+label+'</span>';
}
function _naAddRow(byName, name, species, price, qty, source, ref, pendingReason){
  name = String(name||'').trim(); if(!name) return;
  species = _woodSpeciesNormalize(species);
  var g = byName[name] || (byName[name] = {total:0, variants:{}});
  g.total += qty||0;
  var vk = (species||'—')+'|'+(price||0);
  var v = g.variants[vk] || (g.variants[vk] = {vk:vk, species:species||'—', price:price||0, qty:0, count:0, receive:0, sale:0, inventory:0, refs:[], pending:{}});
  v.qty += qty||0; v.count++;
  v[source] = (v[source]||0) + 1;
  if(pendingReason){ v.pending[pendingReason] = (v.pending[pendingReason]||0)+1; }
  if(ref){ ref.source = source; ref.qty = qty||0; ref.pendingReason = pendingReason||null; v.refs.push(ref); }
}
// Аудит поля «порода дерева» за всё время: полный список того, что реально когда-либо было
// вписано туда (приёмки, продажи, списания, инвентаризации — все магазины, весь период, вне
// зависимости от того, есть ли уже артикул и закрыта ли смена/принята ли накладная — это не
// инструмент действия, а просто отчёт, поэтому ограничений retro-apply тут нет). Группирует по
// _woodSpeciesNormalize (та же нормализация опечаток/сокращений, что и в Сводке/ретро-аудите),
// но показывает и то, как именно порода была написана «как есть» — чтобы видеть реальные опечатки
// и решать, какие ещё добавить в алиасы или в справочник пород.
function loadSpeciesAudit(){
  var status = document.getElementById('spStatus');
  var results = document.getElementById('spResults');
  if(status){ status.style.display='block'; status.textContent='⏳ Собираю все значения породы дерева...'; }
  if(results) results.innerHTML='';
  var byNorm = {};
  // change — где физически лежит эта запись (для последующего переименования, см.
  // _speciesRenameApply ниже): без него аудит был бы только витриной, а сам текст остался бы
  // навсегда неисправимым без ручного перебора записей одну за одной.
  function note(rawSpecies, itemName, source, qty, change){
    var raw = String(rawSpecies||'').trim();
    var isEmpty = !raw;
    var label = isEmpty ? '—' : _woodSpeciesNormalize(raw);
    var key = isEmpty ? '—' : label.toLowerCase();
    var g = byNorm[key] || (byNorm[key] = {label:label, count:0, qty:0, variants:{}, names:{}, receive:0, sale:0, writeoff:0, inventory:0, changes:[]});
    g.count++;
    g.qty += (qty||0);
    g[source] = (g[source]||0)+1;
    if(!isEmpty) g.variants[raw] = (g.variants[raw]||0)+1;
    var nm = (itemName||'').trim();
    if(nm) g.names[nm] = (g.names[nm]||0)+1;
    // Раньше запись о местоположении сохранялась только для непустой породы (нужна была лишь
    // для переименования). Для перехода «к этой записи/смене» нужна и для пустой породы тоже —
    // иначе группу «❓ Без породы» (актуально для украшений без дерева в составе) было бы видно,
    // но некуда перейти.
    if(change){
      if(!isEmpty) change.oldRaw = raw;
      change.qty = qty; change.itemName = nm;
      g.changes.push(change);
    }
  }
  function scanInvoiceSnap(snap, kind){
    snap.forEach(function(doc){
      var inv = doc.data();
      if(inv.isRevaluation) return;
      if((inv.goodsType||'derevo')==='dr') return;
      var field = inv.acceptedItems ? 'acceptedItems' : 'items';
      var items = inv[field] || [];
      items.forEach(function(it, idx){
        if((it.goodsType||inv.goodsType||'derevo')==='dr') return;
        note(it.species, it.name, 'receive', it.qty||1, {kind:kind, id:doc.id, field:field, idx:idx, shop:inv.shopName, date:inv.acceptedDate||inv.date});
      });
    });
  }
  var tasks = [
    db.collection('iz_manual_invoices').get({source:'server'}).then(function(snap){ scanInvoiceSnap(snap,'manual_invoice'); }),
    db.collection('iz_invoices').get({source:'server'}).then(function(snap){ scanInvoiceSnap(snap,'invoice'); }),
    db.collection('iz_shifts').get({source:'server'}).then(function(snap){
      snap.forEach(function(doc){
        var sh = doc.data();
        (sh.journal||[]).forEach(function(e, eIdx){
          if(e.type!=='sale' && e.type!=='writeoff') return;
          (e.items||[]).forEach(function(it, iIdx){
            if((it.goodsType||'derevo')==='dr') return;
            note(it.species, it.name, e.type==='sale'?'sale':'writeoff', it.qty||1, {kind:'shift', id:doc.id, entryIdx:eIdx, itemIdx:iIdx, shop:sh.shopName, date:sh.date});
          });
        });
      });
    }),
    db.collection('iz_inventory_sessions').get({source:'server'}).then(function(snap){
      var sessions = snap.docs.map(function(d){ var x=d.data(); x.id=d.id; return x; })
        .filter(function(x){ return (x.goodsType||'derevo')!=='dr'; });
      return Promise.all(sessions.map(function(sx){
        return db.collection('iz_inventory_counts').where('sessionId','==',sx.id).get({source:'server'}).then(function(csnap){
          csnap.forEach(function(cd){
            var c = cd.data();
            note(c.species, c.name, 'inventory', c.countedQty||0, {kind:'inventory', id:cd.id, shop:sx.shopName, date:sx.inventoryDate||(sx.startedAt||'').slice(0,10)});
          });
        });
      }));
    })
  ];
  var settled = false;
  var timeoutP = new Promise(function(resolve){ setTimeout(function(){ if(!settled){ settled=true; resolve('timeout'); } }, 25000); });
  var fetchP = Promise.all(tasks).then(function(){ if(!settled){ settled=true; } return 'ok'; })
    .catch(function(){ if(!settled){ settled=true; } return 'error'; });
  Promise.race([fetchP, timeoutP]).then(function(result){
    if(status){
      status.style.display = result==='ok' ? 'none' : 'block';
      if(result==='timeout') status.textContent = '⚠️ Сервер не отвечает — попробуйте ещё раз';
      else if(result==='error') status.textContent = '❌ Не удалось загрузить данные';
    }
    window._spData = byNorm;
    _renderSpeciesAudit();
  });
}
window._spRenameOpen = window._spRenameOpen || {};
function _spToggleRename(idx){
  window._spRenameOpen[idx] = !window._spRenameOpen[idx];
  _renderSpeciesAudit();
}
window._spJewelryNoWoodFilter = false;
function _spToggleJewelryNoWoodFilter(){
  window._spJewelryNoWoodFilter = !window._spJewelryNoWoodFilter;
  _renderSpeciesAudit();
}
window._spRecordsOpen = window._spRecordsOpen || {};
function _spToggleRecords(idx){
  window._spRecordsOpen[idx] = !window._spRecordsOpen[idx];
  _renderSpeciesAudit();
}
var _SP_CHANGE_ICON = {shift:'💰', manual_invoice:'📥', invoice:'📥', inventory:'📋'};
var _SP_CHANGE_LABEL = {shift:'Смена', manual_invoice:'Накладная', invoice:'Накладная', inventory:'Инвентаризация'};
// Переход к настоящей записи — та же логика, что уже используется в «Применить артикулы задним
// числом» (_retroArtOpenShift) и в карточке смены (svOpenInvoiceFromReceive): если документ ещё
// не в локальном кэше (аудит сканирует всё облако, а не только то, что открывали на этом
// устройстве), сначала подгружаем его.
function _spOpenChangeRef(kind, id){
  if(kind==='shift'){ _retroArtOpenShift(id); return; }
  if(kind==='manual_invoice' || kind==='invoice'){ svOpenInvoiceFromReceive(id); return; }
  if(kind==='inventory'){ _spOpenInventoryRef(id); return; }
}
function _spOpenInventoryRef(countId){
  showToast('⏳ Загружаю запись...');
  db.collection('iz_inventory_counts').doc(countId).get({source:'server'}).then(function(snap){
    if(!snap.exists){ showToast('⚠️ Запись не найдена'); return null; }
    var c = snap.data();
    return db.collection('iz_inventory_sessions').doc(c.sessionId).get({source:'server'});
  }).then(function(ssnap){
    if(!ssnap || !ssnap.exists) return;
    var sx = ssnap.data(); sx.id = ssnap.id;
    var key = (sx.shopName||'')+'|'+(sx.inventoryDate||(sx.startedAt||'').slice(0,10));
    if(!_invAdmGroups[key]) _invAdmGroups[key] = {key:key, shopName:sx.shopName, date:sx.inventoryDate||(sx.startedAt||'').slice(0,10), sessions:[sx]};
    if(typeof invAdmOpen==='function') invAdmOpen(key);
  }).catch(function(){ showToast('❌ Не удалось загрузить сессию инвентаризации'); });
}
function _renderSpeciesAudit(){
  var host = document.getElementById('spResults'); if(!host) return;
  var byNorm = window._spData || {};
  var keys = Object.keys(byNorm);
  if(!keys.length){ host.innerHTML = '<div class="empty"><div class="ei">🌲</div>Нажмите «Собрать список»</div>'; return; }
  var filterOn = !!window._spJewelryNoWoodFilter;
  var filterBtn = '<button type="button" onclick="_spToggleJewelryNoWoodFilter()" style="width:100%;margin-bottom:8px;padding:8px;background:'+(filterOn?'#c8f060':'#22222e')+';border:1px solid '+(filterOn?'#c8f060':'#2e2e3e')+';border-radius:8px;color:'+(filterOn?'#0f0f13':'#c8c8d8')+';font-size:11.5px;font-weight:700;cursor:pointer">'+(filterOn?'✕ Сбросить фильтр':'💍 Чётки/браслеты/бусы без породы дерева')+'</button>';
  if(filterOn){
    keys = keys.filter(function(k){ return _isJewelryNames(byNorm[k].names) && !_speciesLabelHasWood(byNorm[k].label); });
  }
  keys.sort(function(a,b){
    if(a==='—') return 1; if(b==='—') return -1;
    return byNorm[b].count - byNorm[a].count;
  });
  if(!keys.length){ host.innerHTML = filterBtn+'<div class="empty"><div class="ei">💍</div>Ничего не найдено — либо порода указана везде, либо это не чётки/браслеты/бусы</div>'; return; }
  var totalRecords = keys.reduce(function(s,k){ return s+byNorm[k].count; },0);
  host.innerHTML = filterBtn+'<div style="font-size:11px;color:#8888aa;margin-bottom:8px">'+keys.length+' уникальн'+(keys.length===1?'ое значение':(keys.length<5?'ых значения':'ых значений'))+' · '+totalRecords+' запис'+(totalRecords===1?'ь':(totalRecords<5?'и':'ей'))+' всего</div>'+
    keys.map(function(k, idx){
      var g = byNorm[k];
      var isEmpty = k==='—';
      var variantKeys = Object.keys(g.variants);
      var hasVariants = variantKeys.length>1 || (variantKeys.length===1 && variantKeys[0].toLowerCase()!==g.label.toLowerCase());
      var srcParts = [];
      if(g.receive) srcParts.push('📥×'+g.receive);
      if(g.sale) srcParts.push('💰×'+g.sale);
      if(g.writeoff) srcParts.push('🗑️×'+g.writeoff);
      if(g.inventory) srcParts.push('📋×'+g.inventory);
      var variantsHtml = hasVariants ? '<div style="padding:4px 10px 8px 20px;font-size:10.5px;color:#8888aa">как написано: '+
        variantKeys.sort(function(a,b){ return g.variants[b]-g.variants[a]; }).map(function(v){ return '«'+v+'» ×'+g.variants[v]; }).join(' · ')+
      '</div>' : '';
      var nameKeys = Object.keys(g.names).sort(function(a,b){ return g.names[b]-g.names[a]; });
      var namesHtml = nameKeys.length ? '<div style="padding:0 10px 8px 20px;font-size:10.5px;color:#8888aa">в названиях: '+nameKeys.slice(0,6).map(function(n){ return n+' ('+g.names[n]+')'; }).join(', ')+(nameKeys.length>6?'…':'')+'</div>' : '';
      var renameOpen = !!window._spRenameOpen[idx];
      var kEsc = k.replace(/'/g,"\\'");
      var editBtn = isEmpty ? '' : '<button type="button" onpointerdown="event.preventDefault();_spToggleRename('+idx+')" style="background:#22222e;border:1px solid #2e2e3e;border-radius:6px;width:24px;height:24px;color:#8888aa;font-size:12px;cursor:pointer;flex-shrink:0">✏️</button>';
      var renameHtml = renameOpen ? '<div style="padding:6px 10px 10px 20px;display:flex;gap:6px;align-items:center">'+
        '<input type="text" id="spRenameInput_'+idx+'" value="'+g.label.replace(/"/g,'&quot;')+'" style="flex:1;background:#13131a;border:1px solid #2e2e3e;border-radius:8px;padding:6px 8px;color:#f0f0f8;font-size:12px">'+
        '<button type="button" onclick="_speciesRenameApply(\''+kEsc+'\','+idx+')" style="background:#c8f060;border:none;border-radius:8px;padding:6px 10px;color:#0f0f13;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap">Применить</button>'+
      '</div>' : '';
      var changes = g.changes || [];
      var recordsOpen = !!window._spRecordsOpen[idx];
      var recordsBtn = changes.length ? '<div style="padding:0 10px 8px 20px">'+
        '<button type="button" onclick="_spToggleRecords('+idx+')" style="background:none;border:none;color:#60c8f0;font-size:10.5px;cursor:pointer;padding:0">'+(recordsOpen?'▲ Скрыть записи':'🔗 Перейти к записям ('+changes.length+')')+'</button>'+
      '</div>' : '';
      var recordsHtml = recordsOpen ? '<div style="padding:0 10px 8px 20px">'+
        changes.slice(0,30).map(function(ch){
          var icon = _SP_CHANGE_ICON[ch.kind]||'📌', lbl = _SP_CHANGE_LABEL[ch.kind]||ch.kind;
          var sub = (ch.shop||'—')+(ch.date?' · '+ch.date:'')+(ch.itemName?' · '+ch.itemName:'');
          return '<div onclick="_spOpenChangeRef(\''+ch.kind+'\',\''+String(ch.id).replace(/'/g,"\\'")+'\')" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #22222e;font-size:11px;cursor:pointer">'+
            '<div><span>'+icon+' '+lbl+'</span><div class="u-fs10-gray">'+sub+'</div></div>'+
            '<span style="color:#60c8f0;font-size:13px;flex-shrink:0">↗</span>'+
          '</div>';
        }).join('')+(changes.length>30?'<div style="font-size:10px;color:#8888aa;padding:4px 0">…и ещё '+(changes.length-30)+'</div>':'')+
      '</div>' : '';
      return '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;margin-bottom:6px;overflow:hidden">'+
        '<div style="padding:8px 10px;display:flex;justify-content:space-between;align-items:center;gap:8px">'+
          '<div style="font-size:12px;font-weight:700;color:'+(isEmpty?'#8888aa':'#f0c060')+';display:flex;align-items:center;gap:6px">'+editBtn+'<span>'+(isEmpty?'❓ Без породы':'🪵 '+g.label)+'</span></div>'+
          '<div style="font-size:10.5px;color:#8888aa;text-align:right;white-space:nowrap">'+g.count+' зап. · '+g.qty+' шт.<div>'+srcParts.join(' ')+'</div></div>'+
        '</div>'+
        renameHtml + variantsHtml + namesHtml + recordsBtn + recordsHtml +
      '</div>';
    }).join('');
}
// Переименовывает породу во ВСЕХ записях этой группы (все варианты написания, попавшие в неё
// при сканировании) — то же ограничение по безопасности, что и в «Применить артикулы задним
// числом»: открытые смены и непринятые накладные не трогаем (продавец может их ещё редактировать),
// и перед записью перечитываем документ заново — если запись там уже не совпадает с тем, что
// видели при сканировании (кто-то успел поправить), эту конкретную позицию пропускаем, а не
// затираем поверх чужой более свежей правки.
function _speciesRenameApply(key, idx){
  var data = window._spData; if(!data) return;
  var g = data[key]; if(!g){ showToast('Группа не найдена — соберите список заново'); return; }
  var inputEl = document.getElementById('spRenameInput_'+idx);
  var newName = (inputEl && inputEl.value || '').trim();
  if(!newName){ showToast('Введите новое название породы'); return; }
  if(newName.toLowerCase()===key){ showToast('Совпадает с текущим — менять нечего'); return; }
  var changes = g.changes || [];
  if(!changes.length){ showToast('Нет записей для переименования'); return; }
  if(!confirm('Переименовать «'+g.label+'» в «'+newName+'» в '+changes.length+' запис'+(changes.length===1?'и':(changes.length<5?'ях':'ях'))+'? Открытые смены и непринятые накладные не тронутся — переименуются там при следующем запуске после закрытия/приёмки.')) return;
  var byDoc = {};
  changes.forEach(function(ch){
    var dk = ch.kind+'_'+ch.id;
    if(!byDoc[dk]) byDoc[dk] = {kind:ch.kind, id:ch.id, items:[]};
    byDoc[dk].items.push(ch);
  });
  var status = document.getElementById('spStatus');
  if(status){ status.style.display='block'; status.textContent='⏳ Переименовываю...'; }
  var applied = 0, skippedPending = 0, skippedChanged = 0;
  var errors = [];
  var tasks = Object.keys(byDoc).map(function(dk){
    var u = byDoc[dk];
    if(u.kind==='inventory'){
      var it0 = u.items[0];
      return db.collection('iz_inventory_counts').doc(u.id).get({source:'server'}).then(function(snap){
        if(!snap.exists) return;
        var c = snap.data();
        if(String(c.species||'').trim()!==it0.oldRaw){ skippedChanged++; return; }
        return db.collection('iz_inventory_counts').doc(u.id).update({species:newName}).then(function(){ applied++; });
      }).catch(function(err){ errors.push({kind:'инвентаризация', id:u.id, message:(err&&err.message)||String(err)}); });
    }
    if(u.kind==='shift'){
      var ref = db.collection('iz_shifts').doc(u.id);
      return ref.get({source:'server'}).then(function(snap){
        if(!snap.exists) return;
        var sh = snap.data();
        if(_shIsShiftOpen(sh)){ skippedPending += u.items.length; return; }
        var journal = sh.journal||[];
        var count = 0;
        u.items.forEach(function(ch){
          var e = journal[ch.entryIdx];
          if(!e || !e.items || !e.items[ch.itemIdx]) return;
          var it = e.items[ch.itemIdx];
          if(String(it.species||'').trim()!==ch.oldRaw){ skippedChanged++; return; }
          it.species = newName;
          count++;
        });
        if(!count) return;
        return ref.set(_shiftForCloud(sh)).then(function(){ applied += count; });
      }).catch(function(err){ errors.push({kind:'смена', id:u.id, message:(err&&err.message)||String(err)}); });
    }
    var col = u.kind==='manual_invoice' ? 'iz_manual_invoices' : 'iz_invoices';
    var ref2 = db.collection(col).doc(u.id);
    return ref2.get({source:'server'}).then(function(snap){
      if(!snap.exists) return;
      var inv = snap.data();
      if(inv.status!=='accepted'){ skippedPending += u.items.length; return; }
      var count = 0;
      u.items.forEach(function(ch){
        var arr = inv[ch.field];
        if(!arr || !arr[ch.idx]) return;
        var it = arr[ch.idx];
        if(String(it.species||'').trim()!==ch.oldRaw){ skippedChanged++; return; }
        it.species = newName;
        count++;
      });
      if(!count) return;
      return ref2.set(inv).then(function(){ applied += count; });
    }).catch(function(err){ errors.push({kind:'накладная', id:u.id, message:(err&&err.message)||String(err)}); });
  });
  Promise.all(tasks).then(function(){
    if(status) status.style.display='none';
    try{ logAction('SPECIES_RENAME', {from:g.label, to:newName, applied:applied, skippedPending:skippedPending, skippedChanged:skippedChanged, failedDocs:errors.length}); }catch(e){}
    var msg = '✅ Переименовано: '+applied;
    if(skippedPending) msg += ' · пропущено (открыто): '+skippedPending;
    if(skippedChanged) msg += ' · пропущено (изменилось): '+skippedChanged;
    if(errors.length) msg += ' · ошибок: '+errors.length;
    showToast(msg);
    delete window._spRenameOpen[idx];
    loadSpeciesAudit();
  });
}
function loadNoArticleAudit(){
  var status = document.getElementById('naStatus');
  var results = document.getElementById('naResults');
  if(status){ status.style.display='block'; status.textContent='⏳ Собираю накладные, продажи по всем сменам и инвентаризации...'; }
  if(results) results.innerHTML='';
  var byName = {};
  function scanInvoiceSnap(snap){
    snap.forEach(function(doc){
      var inv = doc.data();
      if(inv.isRevaluation) return; // переоценка возвращает те же вещи — не новое наблюдение
      if((inv.goodsType||'derevo')==='dr') return;
      var items = inv.acceptedItems || inv.items || [];
      var invId = inv.id!=null ? inv.id : (inv._id!=null ? inv._id : doc.id);
      var pendingReason = inv.status!=='accepted' ? 'pending_invoice' : null;
      items.forEach(function(it){
        if((it.goodsType||inv.goodsType||'derevo')==='dr') return;
        if(_naArticleOf(it)) return;
        _naAddRow(byName, it.name, it.species, it.price, it.qty||1, 'receive', {
          shop: inv.destName||inv.shopName||'—', date: inv.date||inv.acceptedDate||'—', invId: invId, invNum: inv.num||''
        }, pendingReason);
      });
    });
  }
  var tasks = [
    db.collection('iz_manual_invoices').get({source:'server'}).then(scanInvoiceSnap),
    db.collection('iz_invoices').get({source:'server'}).then(scanInvoiceSnap),
    db.collection('iz_shifts').get({source:'server'}).then(function(snap){
      snap.forEach(function(doc){
        var sh = doc.data();
        var pendingReason = _shIsShiftOpen(sh) ? 'open_shift' : null;
        (sh.journal||[]).forEach(function(e){
          if(e.type!=='sale') return;
          (e.items||[]).forEach(function(it){
            if((it.goodsType||'derevo')==='dr') return;
            if(_naArticleOf(it)) return;
            _naAddRow(byName, it.name, it.species, it.price, it.qty||1, 'sale', {
              shop: sh.shopName||'—', date: sh.date||'—', shiftId: sh.id||doc.id, entryId: e.id
            }, pendingReason);
          });
        });
      });
    }),
    db.collection('iz_inventory_sessions').get({source:'server'}).then(function(snap){
      var sessions = snap.docs.map(function(d){ var x=d.data(); x.id=d.id; return x; })
        .filter(function(x){ return (x.goodsType||'derevo')!=='dr'; });
      return Promise.all(sessions.map(function(sx){
        return db.collection('iz_inventory_counts').where('sessionId','==',sx.id).get({source:'server'}).then(function(csnap){
          csnap.forEach(function(cd){
            var c = cd.data();
            if(_naArticleOf(c)) return;
            _naAddRow(byName, c.name, c.species, c.price, c.countedQty||0, 'inventory', {
              shop: sx.shopName||'—', date: _iaSessDate(sx), sessionId: sx.id
            }, 'inventory');
          });
        });
      }));
    })
  ];
  var settled = false;
  var timeoutP = new Promise(function(resolve){ setTimeout(function(){ if(!settled){ settled=true; resolve('timeout'); } }, 25000); });
  var fetchP = Promise.all(tasks).then(function(){ if(!settled){ settled=true; } return 'ok'; })
    .catch(function(){ if(!settled){ settled=true; } return 'error'; });
  Promise.race([fetchP, timeoutP]).then(function(result){
    if(status){
      status.style.display = result==='ok' ? 'none' : 'block';
      if(result==='timeout') status.textContent = '⚠️ Сервер не отвечает — попробуйте ещё раз';
      else if(result==='error') status.textContent = '❌ Не удалось загрузить данные';
    }
    window._naData = byName;
    window._naOpen = {};
    _naRenderResults();
  });
}
function _naToggle(name){
  window._naOpen = window._naOpen || {};
  window._naOpen[name] = !window._naOpen[name];
  _naRenderResults();
}
function _naPorodaWord(n){
  var n10=n%10, n100=n%100;
  if(n10===1 && n100!==11) return 'порода';
  if(n10>=2 && n10<=4 && (n100<10||n100>=20)) return 'породы';
  return 'пород';
}
function _naRenderResults(){
  var host = document.getElementById('naResults'); if(!host) return;
  var byName = window._naData || {};
  var names = Object.keys(byName);
  if(!names.length){ host.innerHTML = '<div class="empty"><div class="ei">🪵</div>Нажмите «Собрать сводку»</div>'; return; }
  names.sort(function(a,b){ return byName[b].total-byName[a].total; });
  host.innerHTML = '<div style="font-size:11px;color:#8888aa;margin-bottom:8px">'+names.length+' наименований без артикула — нажмите на название, чтобы развернуть по породам</div>'+
    names.map(function(nm){
      var g = byName[nm];
      var variants = Object.keys(g.variants).map(function(k){ return g.variants[k]; });
      // Сначала группируем по породе (это и есть «вариация дерева»), а цены — уже списком
      // внутри неё: иначе цена и порода вперемешку в одной строке не читаются вообще, особенно
      // когда цена со временем менялась (инфляция), а порода часто вообще не записывалась.
      var bySpecies = {}, order = [];
      variants.forEach(function(v){
        var sp = (v.species && v.species!=='—') ? v.species : '—';
        if(!bySpecies[sp]){ bySpecies[sp] = {species:sp, qty:0, prices:[]}; order.push(sp); }
        bySpecies[sp].qty += v.qty;
        bySpecies[sp].prices.push(v);
      });
      var speciesGroups = order.map(function(sp){ return bySpecies[sp]; });
      // «Без породы» — это недостающие данные, а не реальная вариация дерева, поэтому её всегда
      // показываем последней и отдельным блоком, чтобы не мешала видеть настоящие породы.
      speciesGroups.sort(function(a,b){
        if(a.species==='—') return 1; if(b.species==='—') return -1;
        return b.qty-a.qty;
      });
      var speciesCount = speciesGroups.filter(function(s){ return s.species!=='—'; }).length;
      var noSpeciesQty = (bySpecies['—']||{qty:0}).qty;
      var open = !!(window._naOpen||{})[nm];
      var esc = nm.replace(/'/g,"\\'").replace(/"/g,'&quot;');
      var summaryBits = speciesCount+' '+_naPorodaWord(speciesCount)+(noSpeciesQty?' + без породы '+noSpeciesQty+' шт.':'');
      var head = '<div onclick="_naToggle(\''+esc+'\')" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding:9px;background:#1a1a22;border:1px solid #2e2e3e;border-radius:'+(open?'10px 10px 0 0':'10px')+';margin-bottom:'+(open?'0':'6px')+'">'+
        '<div style="font-size:12px;font-weight:700">🌳 '+nm+'</div>'+
        '<div style="font-size:10.5px;color:#8888aa;display:flex;gap:6px;align-items:center;text-align:right"><span>'+summaryBits+' · '+g.total+' шт. всего</span><span style="color:#555568">'+(open?'▾':'▸')+'</span></div>'+
      '</div>';
      if(!open) return head;
      var body = '<div style="padding:2px 0 4px;margin-bottom:6px;border:1px solid #2e2e3e;border-top:none;border-radius:0 0 10px 10px;background:#13131a">'+
        speciesGroups.map(function(sg){
          var isNone = sg.species==='—';
          var prices = sg.prices.slice().sort(function(a,b){ return b.qty-a.qty; });
          var speciesHead = '<div style="padding:7px 10px 3px;font-size:11px;font-weight:700;color:'+(isNone?'#8888aa':'#f0c060')+'">'+(isNone?'❓ Без указанной породы':'🪵 '+sg.species)+' — '+sg.qty+' шт.'+(isNone?' (нельзя привязать к дереву)':'')+'</div>';
          var priceRows = prices.map(function(v){
            var srcParts = [];
            if(v.receive) srcParts.push('📥×'+v.receive);
            if(v.sale) srcParts.push('💰×'+v.sale);
            if(v.inventory) srcParts.push('📋×'+v.inventory);
            var vkEsc = v.vk.replace(/'/g,"\\'").replace(/"/g,'&quot;');
            var pendingBadge = _naPendingBadge(v.pending);
            return '<div onclick="_naShowDetail(\''+esc+'\',\''+vkEsc+'\')" style="padding:5px 10px 5px 20px;border-bottom:1px solid #22222e;font-size:11.5px;cursor:pointer">'+
              '<div style="display:flex;justify-content:space-between;align-items:center">'+
                '<span style="color:#c8f060;font-weight:700">'+Math.round(v.price).toLocaleString('ru-RU')+'₽</span>'+
                '<span style="display:flex;gap:8px;align-items:center;color:#8888aa;flex-shrink:0"><span>'+v.qty+' шт.</span><span style="font-size:10px">'+srcParts.join(' ')+'</span><span style="color:#60c8f0">🔎</span></span>'+
              '</div>'+
              (pendingBadge ? '<div style="text-align:right;margin-top:2px">'+pendingBadge+'</div>' : '')+
            '</div>';
          }).join('');
          return speciesHead + priceRows;
        }).join('')+
      '</div>';
      return head + body;
    }).join('');
}
function _naShowDetail(name, vk){
  var g = (window._naData||{})[name]; if(!g) return;
  var v = g.variants[vk]; if(!v) return;
  var overlay = document.getElementById('naDetailOverlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'naDetailOverlay';
    overlay.className = 'mo';
    overlay.onclick = function(e){ if(e.target===overlay) overlay.classList.remove('open'); };
    document.body.appendChild(overlay);
  }
  var srcIcon = {receive:'📥', sale:'💰', inventory:'📋'};
  var srcLabel = {receive:'Приёмка', sale:'Продажа', inventory:'Инвентаризация'};
  var refs = (v.refs||[]).slice().sort(function(a,b){ return String(b.date||'').localeCompare(String(a.date||'')); });
  var word = refs.length===1?'запись':(refs.length>=2&&refs.length<=4?'записи':'записей');
  var rows = refs.map(function(r){
    var pendingTag = r.pendingReason ? '<div style="color:#f0a060;font-size:10px;margin-top:1px">⏳ '+NA_PENDING_LABELS[r.pendingReason]+'</div>' : '';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #22222e;font-size:12px">'+
      '<div><span>'+(srcIcon[r.source]||'')+' '+(srcLabel[r.source]||r.source)+'</span>'+
        '<div class="u-fs10-gray">'+(r.shop||'—')+' · '+(r.date||'—')+(r.invNum?' · накл. '+r.invNum:'')+'</div>'+pendingTag+'</div>'+
      '<div style="color:#c8f060;font-weight:700;flex-shrink:0">'+r.qty+' шт.</div>'+
    '</div>';
  }).join('');
  overlay.innerHTML = '<div class="md">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
      '<div style="font-size:14px;font-weight:700">'+name+(v.species!=='—'?' · '+v.species:'')+'<div style="font-size:12px;color:#c8f060">'+Math.round(v.price).toLocaleString('ru-RU')+'₽</div></div>'+
      '<button onclick="document.getElementById(\'naDetailOverlay\').classList.remove(\'open\')" style="background:#22222e;border:1px solid #2e2e3e;border-radius:8px;width:30px;height:30px;color:#8888aa;font-size:16px;cursor:pointer;flex-shrink:0">✕</button>'+
    '</div>'+
    '<div style="font-size:11px;color:#8888aa;margin-bottom:8px">'+refs.length+' '+word+' · '+v.qty+' шт. всего</div>'+
    '<div style="max-height:60vh;overflow-y:auto">'+(rows||'<div style="font-size:12px;color:#8888aa">Нет записей</div>')+'</div>'+
  '</div>';
  overlay.classList.add('open');
}
// Применение артикулов задним числом: как только в каталоге появилась позиция «название+порода
// (+цена)» с настоящим артикулом (см. addWoodGoodsVariant/addDrGoodsVariant в прочее.js), эту же
// связку могли уже сто раз принять/продать/списать без артикула — вручную искать и проставлять
// артикул в каждой из этих старых записей нереально. Инструмент сканирует накладные и ЗАКРЫТЫЕ
// смены (открытые не трогаем — их может редактировать продавец прямо сейчас), находит позиции
// БЕЗ артикула, чьё имя+порода(+цена) точно совпадает с каталогом, и только заполняет пустое
// поле — никогда не перезаписывает то, что уже есть. Предпросмотр обязателен перед применением.
function _retroArtBuildLookup(freshDerevo, freshDr){
  var lookup = {};
  (freshDerevo || getRefBook('iz_goods_derevo') || []).filter(function(c){ return c.article; }).forEach(function(c){
    var k = 'wood|'+(c.name||'').toLowerCase().trim()+'|'+_woodSpeciesNormalize(c.species).toLowerCase().trim()+'|'+(c.price||0);
    lookup[k] = c.article;
  });
  (freshDr || getRefBook('iz_goods_dr') || []).filter(function(c){ return c.article; }).forEach(function(c){
    var k = 'dr|'+(c.name||'').toLowerCase().trim()+'|'+(c.price||0);
    lookup[k] = c.article;
  });
  return lookup;
}
function _retroArtKeyFor(name, species, price, goodsType){
  if(goodsType==='dr') return 'dr|'+String(name||'').toLowerCase().trim()+'|'+(price||0);
  return 'wood|'+String(name||'').toLowerCase().trim()+'|'+_woodSpeciesNormalize(species).toLowerCase().trim()+'|'+(price||0);
}
function loadRetroArticleAudit(){
  var status = document.getElementById('raStatus');
  var results = document.getElementById('raResults');
  if(results) results.innerHTML='';
  if(status){ status.style.display='block'; status.textContent='⏳ Обновляю каталог с сервера...'; }
  // Раньше каталог для сравнения читался из локального кэша устройства (getRefBook) — если он
  // отстал от облака (например, только что добавили позиции с другого устройства), совпадения
  // молча не находились, хотя каталог на сервере их уже содержит. Сканы накладных/смен и так шли
  // прямо с сервера — подтягиваем оттуда же и сам каталог, прежде чем строить таблицу поиска.
  Promise.all([
    db.collection('iz_settings').doc('goods_derevo').get({source:'server'}).then(function(snap){ return (snap.exists && snap.data().data) || null; }).catch(function(){ return null; }),
    db.collection('iz_settings').doc('goods_dr').get({source:'server'}).then(function(snap){ return (snap.exists && snap.data().data) || null; }).catch(function(){ return null; })
  ]).then(function(res){
    if(res[0]) localStorage.setItem('iz_goods_derevo', JSON.stringify(res[0]));
    if(res[1]) localStorage.setItem('iz_goods_dr', JSON.stringify(res[1]));
    _retroArtScan(_retroArtBuildLookup(res[0], res[1]), status);
  });
}
function _retroArtScan(lookup, status){
  if(!Object.keys(lookup).length){
    if(status){ status.style.display='block'; status.textContent='⚠️ В каталоге «С артикулом вручную» пока пусто — сначала занесите туда позиции'; }
    return;
  }
  if(status){ status.style.display='block'; status.textContent='⏳ Ищу совпадения в накладных и закрытых сменах...'; }
  var docUpdates = {};
  var matchStats = {};
  function articleOf(it){ return String((it&&(it.num||it.article))||'').trim(); }
  function noteMatch(article, name, species, price, qty, source, ref, goodsType){
    if(!matchStats[article]) matchStats[article]={name:name, species:species, price:price, goodsType:goodsType||'derevo', count:0, qty:0, receive:0, sale:0, writeoff:0, refs:[], shops:{}};
    matchStats[article].count++;
    matchStats[article].qty += (qty||0);
    matchStats[article][source] = (matchStats[article][source]||0)+1;
    if(ref){ ref.source = source; ref.qty = qty||0; matchStats[article].refs.push(ref); if(ref.shop) matchStats[article].shops[ref.shop]=true; }
  }
  function scanInvoiceDoc(doc, kind){
    var inv = doc.data();
    if(inv.isRevaluation || inv.status!=='accepted') return;
    var field = inv.acceptedItems ? 'acceptedItems' : 'items';
    var items = inv[field] || [];
    var changes = [];
    var shop = inv.destName||inv.shopName||'—', date = inv.date||inv.acceptedDate||'—', invNum = inv.num||'';
    items.forEach(function(it, idx){
      if(articleOf(it)) return;
      var gt = it.goodsType || inv.goodsType || 'derevo';
      var key = _retroArtKeyFor(it.name, it.species, it.price, gt);
      var art = lookup[key];
      if(!art) return;
      changes.push({idx:idx, article:art, field:field});
      noteMatch(art, it.name, it.species, it.price, it.qty, 'receive', {
        shop:shop, date:date, invNum:invNum, invId:doc.id, isManual: kind==='manual_invoice'
      }, gt);
    });
    if(changes.length) docUpdates[kind+'_'+doc.id] = {kind:kind, id:doc.id, changes:changes};
  }
  function scanShiftDoc(doc){
    var sh = doc.data();
    if(_shIsShiftOpen(sh)) return;
    var journal = sh.journal||[];
    var changes = [];
    var shop = sh.shopName||'—', date = sh.date||'—';
    journal.forEach(function(e, eIdx){
      if(e.type!=='sale' && e.type!=='writeoff') return;
      (e.items||[]).forEach(function(it, iIdx){
        if(articleOf(it)) return;
        var gt = it.goodsType || e.goodsType || 'derevo';
        var key = _retroArtKeyFor(it.name, it.species, it.price, gt);
        var art = lookup[key];
        if(!art) return;
        changes.push({entryIdx:eIdx, itemIdx:iIdx, article:art});
        noteMatch(art, it.name, it.species, it.price, it.qty, e.type==='sale'?'sale':'writeoff', {
          shop:shop, date:date, who:sh.sellerName||'', shiftId:doc.id
        }, gt);
      });
    });
    if(changes.length) docUpdates['shift_'+doc.id] = {kind:'shift', id:doc.id, changes:changes};
  }
  var tasks = [
    db.collection('iz_manual_invoices').get({source:'server'}).then(function(snap){ snap.forEach(function(d){ scanInvoiceDoc(d,'manual_invoice'); }); }),
    db.collection('iz_invoices').get({source:'server'}).then(function(snap){ snap.forEach(function(d){ scanInvoiceDoc(d,'invoice'); }); }),
    db.collection('iz_shifts').get({source:'server'}).then(function(snap){ snap.forEach(function(d){ scanShiftDoc(d); }); })
  ];
  var settled = false;
  var timeoutP = new Promise(function(resolve){ setTimeout(function(){ if(!settled){ settled=true; resolve('timeout'); } }, 30000); });
  var fetchP = Promise.all(tasks).then(function(){ if(!settled){ settled=true; } return 'ok'; })
    .catch(function(){ if(!settled){ settled=true; } return 'error'; });
  Promise.race([fetchP, timeoutP]).then(function(result){
    if(status){
      status.style.display = result==='ok' ? 'none' : 'block';
      if(result==='timeout') status.textContent = '⚠️ Сервер не отвечает — попробуйте ещё раз';
      else if(result==='error') status.textContent = '❌ Не удалось загрузить данные';
    }
    window._retroArtPending = {docUpdates:docUpdates, matchStats:matchStats};
    _renderRetroArtPreview();
  });
}
function _renderRetroArtPreview(){
  var host = document.getElementById('raResults'); if(!host) return;
  var data = window._retroArtPending;
  if(!data){ host.innerHTML=''; return; }
  var articles = Object.keys(data.matchStats);
  if(!articles.length){
    host.innerHTML = '<div class="empty"><div class="ei">✅</div>Совпадений не найдено — либо все уже с артикулами, либо в каталоге нет подходящих позиций</div>';
    return;
  }
  var totalRecords = articles.reduce(function(s,a){ return s+data.matchStats[a].count; },0);
  articles.sort(function(a,b){ return data.matchStats[b].count - data.matchStats[a].count; });
  host.innerHTML = '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">'+
      '<div style="font-size:12px;color:#f0c060;font-weight:700">Найдено: '+totalRecords+' запис'+(totalRecords===1?'ь':(totalRecords<5?'и':'ей'))+' по '+articles.length+' артикул'+(articles.length===1?'у':(articles.length<5?'ам':'ам'))+' — нажмите на строку, чтобы увидеть сами записи, или «Применить» по одному артикулу</div>'+
      '<button type="button" onclick="applyRetroArticleAudit()" style="flex-shrink:0;padding:7px 11px;background:#c8f060;border:none;border-radius:8px;color:#0f0f13;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap">✅ Применить всё</button>'+
    '</div>'+
    articles.map(function(art){
      var m = data.matchStats[art];
      var srcParts = [];
      if(m.receive) srcParts.push('📥×'+m.receive);
      if(m.sale) srcParts.push('💰×'+m.sale);
      if(m.writeoff) srcParts.push('🗑️×'+m.writeoff);
      var artEsc = art.replace(/'/g,"\\'");
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;margin-bottom:5px;font-size:11.5px;gap:8px">'+
        '<div onclick="_retroArtShowDetail(\''+artEsc+'\')" style="cursor:pointer;flex:1;min-width:0">'+
          '<div><b>№'+art+'</b> — '+(m.name||'')+(m.species?' · '+m.species:'')+' · '+Math.round(m.price||0).toLocaleString('ru-RU')+'₽</div>'+
          '<div style="color:#8888aa">'+m.count+' зап. · '+srcParts.join(' ')+' 🔎</div>'+
        '</div>'+
        '<button type="button" onclick="event.stopPropagation();applyRetroArticleAudit(\''+artEsc+'\')" style="flex-shrink:0;padding:7px 11px;background:#c8f060;border:none;border-radius:8px;color:#0f0f13;font-size:11px;font-weight:700;cursor:pointer">✅ Применить</button>'+
      '</div>';
    }).join('');
}
// Переход к настоящей смене вместо текстового описания записи: если смена ещё не в локальном
// кэше (обычное дело — этот аудит сканирует всё облако, а не только то, что открывали на этом
// устройстве), сначала подгружаем её и добавляем в кэш, потом открываем как обычно.
function _retroArtOpenShift(shiftId){
  var shifts = getShifts();
  var found = shifts.find(function(s){ return (s.id||s._id)===shiftId; });
  if(found){ openShiftView(shiftId); return; }
  showToast('⏳ Загружаю смену...');
  db.collection('iz_shifts').doc(shiftId).get({source:'server'}).then(function(snap){
    if(!snap.exists){ showToast('⚠️ Смена не найдена'); return; }
    var sh = snap.data(); sh.id = shiftId;
    var arr = getShifts(); arr.push(sh); saveShifts(arr);
    openShiftView(shiftId);
  }).catch(function(){ showToast('❌ Не удалось загрузить смену'); });
}
function _retroArtShowDetail(article){
  var data = window._retroArtPending; if(!data) return;
  var m = data.matchStats[article]; if(!m) return;
  var overlay = document.getElementById('naDetailOverlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'naDetailOverlay';
    overlay.className = 'mo';
    overlay.onclick = function(e){ if(e.target===overlay) overlay.classList.remove('open'); };
    document.body.appendChild(overlay);
  }
  var srcIcon = {receive:'📥', sale:'💰', writeoff:'🗑️'};
  var srcLabel = {receive:'Приёмка', sale:'Продажа', writeoff:'Списание'};
  var refs = (m.refs||[]).slice().sort(function(a,b){ return String(b.date||'').localeCompare(String(a.date||'')); });
  var word = refs.length===1?'запись':(refs.length>=2&&refs.length<=4?'записи':'записей');
  var rows = refs.map(function(r){
    var navCall = r.source==='receive'
      ? (r.invId ? "svOpenInvoiceFromReceive('"+r.invId+"')" : '')
      : (r.shiftId ? "_retroArtOpenShift('"+r.shiftId+"')" : '');
    var openCall = navCall ? "document.getElementById('naDetailOverlay').classList.remove('open');"+navCall : '';
    return '<div onclick="'+openCall+'" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #22222e;font-size:12px;cursor:pointer">'+
      '<div><span>'+(srcIcon[r.source]||'')+' '+(srcLabel[r.source]||r.source)+(r.who?' · '+r.who:'')+'</span>'+
        '<div class="u-fs10-gray">'+(r.shop||'—')+' · '+(r.date||'—')+(r.invNum?' · накл. '+r.invNum:'')+'</div></div>'+
      '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0"><span style="color:#c8f060;font-weight:700">'+r.qty+' шт.</span><span style="color:#60c8f0;font-size:13px">↗</span></div>'+
    '</div>';
  }).join('');
  overlay.innerHTML = '<div class="md">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
      '<div style="font-size:14px;font-weight:700">№'+article+'<div style="font-size:12px;color:#8888aa;font-weight:400">'+(m.name||'')+(m.species?' · '+m.species:'')+' · '+Math.round(m.price||0).toLocaleString('ru-RU')+'₽</div></div>'+
      '<button onclick="document.getElementById(\'naDetailOverlay\').classList.remove(\'open\')" style="background:#22222e;border:1px solid #2e2e3e;border-radius:8px;width:30px;height:30px;color:#8888aa;font-size:16px;cursor:pointer;flex-shrink:0">✕</button>'+
    '</div>'+
    '<div style="font-size:11px;color:#8888aa;margin-bottom:8px">'+refs.length+' '+word+' · '+m.qty+' шт. всего — все получат артикул №'+article+'</div>'+
    '<div style="max-height:60vh;overflow-y:auto">'+(rows||'<div style="font-size:12px;color:#8888aa">Нет записей</div>')+'</div>'+
  '</div>';
  overlay.classList.add('open');
}
// articleFilter не задан — применить все найденные совпадения разом (оставлено для отладки/на
// всякий случай); задан — применить только этот артикул, не трогая остальные строки предпросмотра
// (по одной строке за раз, как и просили — чтобы не давить одну общую кнопку на всё сразу).
// Удаляет из предпросмотра (matchStats + docUpdates) только те записи, которые реально были
// записаны на сервер — по конкретному документу u (kind+id), а не по артикулу вообще. Документ,
// который упал с ошибкой, в предпросмотре ОСТАЁТСЯ — иначе после «неудачного успеха» повторный
// скан снова покажет те же записи без единого объяснения, что случилось на самом деле.
function _retroArtRemoveApplied(data, u){
  var byArticle = {};
  u.changes.forEach(function(ch){ byArticle[ch.article] = (byArticle[ch.article]||0)+1; });
  Object.keys(byArticle).forEach(function(article){
    var st = data.matchStats[article]; if(!st) return;
    var toRemove = byArticle[article];
    st.refs = (st.refs||[]).filter(function(r){
      if(toRemove<=0) return true;
      var matches = u.kind==='shift' ? (r.shiftId===u.id) : (r.invId===u.id);
      if(!matches) return true;
      toRemove--;
      st.count--; st.qty -= (r.qty||0);
      if(r.source && st[r.source]!=null) st[r.source]--;
      return false;
    });
    if(st.count<=0) delete data.matchStats[article];
  });
  var dk = u.kind+'_'+u.id;
  var stillDoc = data.docUpdates[dk];
  if(stillDoc){
    stillDoc.changes = stillDoc.changes.filter(function(ch){ return u.changes.indexOf(ch)<0; });
    if(!stillDoc.changes.length) delete data.docUpdates[dk];
  }
}
// До этого артикул на такой товар не заводился — он лежал в остатке под синтетическим ключом
// «название+цена+порода» (_noArticleStockKey, см. stockApplySale/stockApplyReceive). Простановка
// артикула в исторические записи (выше) НЕ трогает остаток — он как лежал под старым синтетическим
// ключом, так и остаётся там. Если это не перенести, дальнейший поиск «сколько в наличии» по
// НОВОМУ артикулу будет видеть пустоту, хотя физически товар на месте — просто остаток застрял
// под старым ключом. Переносим qty с синтетического ключа на реальный артикул в остатке каждого
// магазина, где этот товар встречался.
function _retroArtMigrateStock(article, name, species, price, goodsType, shopNames){
  var syntheticKey = _noArticleStockKey(name, price, species, goodsType);
  if(!syntheticKey || syntheticKey===article) return Promise.resolve();
  var tasks = (shopNames||[]).map(function(shopName){
    var docId = 'stock_'+shopName.replace(/\s+/g,'_');
    return db.collection('iz_settings').doc(docId).get({source:'server'}).then(function(snap){
      var items = (snap.exists && snap.data().items) || {};
      var synth = items[syntheticKey];
      if(!synth || !((synth.qty||0)>0)) return;
      var target = items[article] || {num:article, name:name, price:price||0, species:species||'', goodsType:goodsType||'derevo', size:'', qty:0, lastReceived:'', lastSold:''};
      target.name = name; target.price = price||target.price; target.species = species||target.species;
      target.qty = (target.qty||0) + (synth.qty||0);
      if(synth.lastReceived && synth.lastReceived>(target.lastReceived||'')) target.lastReceived = synth.lastReceived;
      items[article] = target;
      delete items[syntheticKey];
      return db.collection('iz_settings').doc(docId).set({items:items, updatedAt:new Date().toISOString()}).then(function(){
        try{
          var local = getStock(); local[shopName] = items;
          (typeof _safeLocalSet==='function'?_safeLocalSet:localStorage.setItem)('iz_stock', JSON.stringify(local));
        }catch(e){}
      });
    }).catch(function(){});
  });
  return Promise.all(tasks);
}
function applyRetroArticleAudit(articleFilter){
  var data = window._retroArtPending;
  if(!data){ showToast('Нечего применять'); return; }
  var relevantDocs = [];
  var totalRecords = 0;
  var articleMeta = {};
  Object.keys(data.docUpdates).forEach(function(dk){
    var u = data.docUpdates[dk];
    var changes = articleFilter ? u.changes.filter(function(ch){ return ch.article===articleFilter; }) : u.changes;
    if(!changes.length) return;
    relevantDocs.push({kind:u.kind, id:u.id, changes:changes});
    totalRecords += changes.length;
    changes.forEach(function(ch){
      if(articleMeta[ch.article]) return;
      var st = data.matchStats[ch.article]; if(!st) return;
      articleMeta[ch.article] = {name:st.name, species:st.species, price:st.price, goodsType:st.goodsType, shops:Object.keys(st.shops||{})};
    });
  });
  if(!relevantDocs.length){ showToast('Нечего применять'); return; }
  var confirmMsg = articleFilter
    ? 'Проставить артикул №'+articleFilter+' в '+totalRecords+' позициях ('+relevantDocs.length+' документов)? Меняются только записи, где артикула ещё нет.'
    : 'Проставить артикулы в '+totalRecords+' позициях ('+relevantDocs.length+' документов — накладные/смены)? Меняются только записи, где артикула ещё нет — существующие данные не трогаются.';
  if(!confirm(confirmMsg)) return;
  var status = document.getElementById('raStatus');
  if(status){ status.style.display='block'; status.textContent='⏳ Применяю...'; }
  var applied = 0;
  var errors = [];
  var succeededDocs = [];
  // Раньше applied++ считался ДО завершения записи (ref.set), так что при ошибке записи (например,
  // документ смены разросся за пределы лимита Firestore на размер документа — эта смена НЕ
  // закрывалась много дней) тост «Применено: N» всё равно показывал успех, хотя на сервере
  // ничего не менялось — и повторный скан снова находил те же самые записи без артикула.
  // Теперь applied увеличивается только внутри .then() ПОСЛЕ реального подтверждения записи,
  // а причина ошибки (err.message) сохраняется и показывается — а не просто считается в failedDocs.
  var tasks = relevantDocs.map(function(u){
    if(u.kind==='shift'){
      var ref = db.collection('iz_shifts').doc(u.id);
      return ref.get({source:'server'}).then(function(snap){
        if(!snap.exists) return;
        var sh = snap.data();
        var journal = sh.journal||[];
        var count = 0;
        u.changes.forEach(function(ch){
          var e = journal[ch.entryIdx];
          if(!e || !e.items || !e.items[ch.itemIdx]) return;
          var it = e.items[ch.itemIdx];
          if(it.num || it.article) return;
          it.num = ch.article; it.article = ch.article;
          count++;
        });
        if(!count) return;
        return ref.set(_shiftForCloud(sh)).then(function(){ applied += count; succeededDocs.push(u); });
      }).catch(function(err){ errors.push({kind:'смена', id:u.id, message:(err&&err.message)||String(err)}); });
    }
    var col = u.kind==='manual_invoice' ? 'iz_manual_invoices' : 'iz_invoices';
    var ref2 = db.collection(col).doc(u.id);
    return ref2.get({source:'server'}).then(function(snap){
      if(!snap.exists) return;
      var inv = snap.data();
      var count = 0;
      u.changes.forEach(function(ch){
        var arr = inv[ch.field];
        if(!arr || !arr[ch.idx]) return;
        var it = arr[ch.idx];
        if(it.num || it.article) return;
        it.num = ch.article; it.article = ch.article;
        count++;
      });
      if(!count) return;
      return ref2.set(inv).then(function(){ applied += count; succeededDocs.push(u); });
    }).catch(function(err){ errors.push({kind:'накладная', id:u.id, message:(err&&err.message)||String(err)}); });
  });
  Promise.all(tasks).then(function(){
    var succeededArticles = {};
    succeededDocs.forEach(function(u){ u.changes.forEach(function(ch){ succeededArticles[ch.article]=true; }); });
    return Promise.all(Object.keys(succeededArticles).map(function(art){
      var m = articleMeta[art]; if(!m) return null;
      return _retroArtMigrateStock(art, m.name, m.species, m.price, m.goodsType, m.shops);
    }));
  }).then(function(){
    if(status) status.style.display='none';
    try{ logAction('RETRO_ARTICLE_APPLY', {appliedCount:applied, failedDocs:errors.length, article:articleFilter||'all'}); }catch(e){}
    succeededDocs.forEach(function(u){ _retroArtRemoveApplied(data, u); });
    var errorBlock = errors.length
      ? '<div style="margin-top:8px;padding:8px 10px;background:#2a1414;border:1px solid #5a2020;border-radius:8px">'+
        '<div style="font-size:11px;font-weight:700;color:#f06060;margin-bottom:4px">❌ Не удалось записать ('+errors.length+' документ'+(errors.length===1?'':(errors.length<5?'а':'ов'))+') — данные НЕ изменены:</div>'+
        errors.map(function(er){ return '<div style="font-size:10.5px;color:#c88;margin-bottom:2px">'+er.kind+' '+er.id+': '+er.message+'</div>'; }).join('')+
      '</div>' : '';
    var articlesLeft = Object.keys(data.matchStats).length;
    var host = document.getElementById('raResults');
    if(articlesLeft){
      _renderRetroArtPreview();
      if(host && errorBlock) host.insertAdjacentHTML('afterbegin', errorBlock);
    } else {
      window._retroArtPending = null;
      if(host) host.innerHTML = '<div class="empty"><div class="ei">✅</div>Готово: проставлено артикулов — '+applied+'</div>'+errorBlock;
    }
    showToast(errors.length ? '⚠️ Применено: '+applied+' · ошибок: '+errors.length : '✅ Применено: '+applied+' позиций');
  });
}
// Запрет повторного использования номера изделия при приёмке — та же проверка вызывается из
// всех форм, где продавец может вписать/поправить номер (новая накладная вручную, исправление
// накладной, приём накладной от мастерской). Если индекс ещё не подгрузился (нет сети/только
// открыли форму) — не блокируем, чтобы не мешать работать оффлайн; индекс предзагружается при
// открытии этих форм заранее, так что в норме к моменту сохранения он уже готов.
// Перемещение между магазинами (отдельного механизма нет — списание в одном магазине + приёмка в
// другом) — та же физическая вещь с той же биркой законно принимается второй раз. Разрешаем,
// только если ПОСЛЕДНИЙ раз номер принимали в другом магазине И там его после этого списали —
// иначе вещь числилась бы на двух балансах сразу.
function _artWrittenOffAt(num, shop, sinceDate){
  var wos = (_woArtIndex||{})[num] || [];
  return wos.some(function(w){ return w.shop===shop && String(w.date||'')>=String(sinceDate||''); });
}
// Артикул из каталога «С артикулом вручную» (ЛопаткаКатал01 и т.п.) — это артикул МОДЕЛИ
// (наименование+порода+цена), под ним принимается сколько угодно одинаковых изделий. Правило
// «один номер = одна физическая вещь» относится только к биркам изделий из мастерской.
function _catalogArticleSet(){
  var set = {};
  ['iz_goods_derevo','iz_goods_dr'].forEach(function(k){
    (getRefBook(k)||[]).forEach(function(c){ if(c && c.article) set[String(c.article).trim().toLowerCase()] = true; });
  });
  return set;
}
function _confirmTagCollisions(cols, shop){
  if(!cols || !cols.length) return true;
  var lines = cols.map(function(c){ return '№'+c.num+': у вас «'+c.name+'», а этот номер уже числится за «'+c.prevName+'» ('+c.prevShop+', '+c.prevDate+')'; });
  if(!confirm('Под одним номером — разные изделия:\n'+lines.join('\n')+'\n\nОдна из бирок записана с ошибкой. Принять всё равно? Администратор получит уведомление, чтобы разобраться с номером.')) return false;
  try{
    saveAdminAlert({type:'tag_collision', shopName:shop||'', sellerName:(session&&(session.sellerName||session.name))||'', date:new Date().toLocaleDateString('ru-RU'), items:cols});
  }catch(e){}
  return true;
}
function _findArtDupInItems(items, excludeInvId, destShop, transferFrom, collisions){
  if(!_usedArtIndex) return null;
  var seenInThisInvoice = {};
  var catalogArts = _catalogArticleSet();
  for(var i=0;i<(items||[]).length;i++){
    var num = String((items[i].num||items[i].article||'')).trim();
    if(!num) continue;
    if(catalogArts[num.toLowerCase()]) continue;
    // Уникальная бирка одной физической вещи — только номер из цифр (52275). Буквенные коды
    // (Свеч04, СвечСот02, Макраме01) — шифр партии: под ним десятки одинаковых изделий, и одна
    // партия законно приходит в несколько магазинов — повтор тут не ошибка (как и в аудите
    // «Задвоение номеров»). Раньше Колесо не могло принять свечи с Горок, потому что ту же
    // партию «Свеч04» уже приняла Роза Хутор.
    if(!/^\d+$/.test(num)) continue;
    if(seenInThisInvoice[num]) return '№'+num+' указан в этой накладной дважды';
    seenInThisInvoice[num] = true;
    var occs = _checkArtDupSync(num, excludeInvId);
    if(occs && occs.length){
      var latest = occs.slice().sort(function(a,b){ return String(b.date||'').localeCompare(String(a.date||'')); })[0];
      // Тот же номер, но ДРУГОЕ изделие (№49802: «Доска д/разделки» на Колесе и «Толкушка» сейчас)
      // — это путаница с биркой, а не одна вещь на двух балансах. Приход не блокируем: вызывающий
      // спросит подтверждение и сообщит админу (см. _confirmTagCollisions).
      var _nn = function(x){ return String(x||'').toLowerCase().replace(/\s+/g,' ').trim(); };
      if(collisions && _nn(latest.name) && _nn(items[i].name) && _nn(latest.name)!==_nn(items[i].name)){
        collisions.push({num:num, name:items[i].name||'', prevName:latest.name||'', prevShop:latest.shop||'', prevDate:latest.date||''});
        continue;
      }
      var otherShop = destShop && latest.shop && latest.shop!==destShop;
      if(otherShop && _artWrittenOffAt(num, latest.shop, latest.date)) continue;
      // Накладная перемещения: отправитель сам списал эту вещь этой же накладной — она физически
      // приехала оттуда. Если номер при этом «висит» ещё и на третьем магазине — это старая путаница
      // с биркой (две разные вещи под одним номером, напр. №51919 «Капа» на Ривьере и «Доска» с
      // Горок), к перемещению отношения не имеет и разбирается в аудите «Задвоение номеров».
      if(otherShop && transferFrom) continue;
      if(otherShop){
        // списание могли сделать только что — подтягиваем свежий список к следующему нажатию
        try{ _buildWriteoffArtIndex(); }catch(e){}
        return '№'+num+' «'+latest.name+'» числится на магазине '+latest.shop+' (принят '+latest.date+') и там не списан — сначала спишите его на '+latest.shop+', потом принимайте здесь';
      }
      return '№'+num+' уже был использован: «'+latest.name+'» ('+latest.shop+', '+latest.date+')';
    }
  }
  return null;
}
function stockOnFilterChange(){
  var sel = document.getElementById('stockFilterBy');
  var filterBy = sel ? sel.value : '';
  var container = document.getElementById('stockFilterInput');
  if(!container) return;
  if(!filterBy){ container.style.display='none'; container.innerHTML=''; return; }
  container.style.display='block';
  if(filterBy==='article'){
    container.innerHTML='<input class="fi" id="stockInputArticle" placeholder="Введите артикул..." oninput="stockApplyFilter()" style="margin:0">';
    setTimeout(function(){ var el=document.getElementById('stockInputArticle'); if(el) el.focus(); },100);
  } else if(filterBy==='name'){
    var catalog = getRefBook('iz_goods_derevo').concat(getRefBook('iz_goods_dr'));
    var names = [];
    var seenNorm = {};
    catalog.forEach(function(c){
      var n = (c.name||c||'').trim();
      if(!n) return;
      var norm = n.toLowerCase();
      if(!seenNorm[norm]){ seenNorm[norm]=true; names.push(n); }
    });
    names.sort(function(a,b){ return a.localeCompare(b,'ru'); });
    container.innerHTML='<select class="fs" id="stockInputName" onchange="stockApplyFilter()" style="margin:0"><option value="">— Все наименования —</option>'+
      names.map(function(n){ return '<option value="'+n+'">'+n+'</option>'; }).join('')+'</select>';
  } else if(filterBy==='species'){
    var specs = [];
    var seenSpec = {};
    getSpecies().forEach(function(s){
      var n=typeof s==='string'?s:(s.name||s||'');
      n=n.trim(); if(!n) return;
      var norm=n.toLowerCase();
      if(!seenSpec[norm]){ seenSpec[norm]=true; specs.push(n); }
    });
    getRefBook('iz_dr_species').forEach(function(s){
      var n=(s.name||s||'').trim(); if(!n) return;
      var norm=n.toLowerCase();
      if(!seenSpec[norm]){ seenSpec[norm]=true; specs.push(n); }
    });
    specs.sort(function(a,b){ return a.localeCompare(b,'ru'); });
    container.innerHTML='<select class="fs" id="stockInputSpecies" onchange="stockApplyFilter()" style="margin:0"><option value="">— Все породы/составы —</option>'+
      specs.map(function(s){ return '<option value="'+s+'">'+s+'</option>'; }).join('')+'</select>';
  } else if(filterBy==='type'){
    container.innerHTML='<select class="fs" id="stockInputType" onchange="stockApplyFilter()" style="margin:0">'+
      '<option value="">— Все типы —</option>'+
      '<option value="derevo">🌳 Дерево</option>'+
      '<option value="dr">🛍 ДР Товар</option>'+
    '</select>';
  } else if(filterBy==='age'){
    container.innerHTML=
      '<div style="font-size:11px;color:#8888aa;margin-bottom:6px">Товар на складе дольше:</div>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
        '<div onpointerdown="event.preventDefault();stockSetAge(\'week\',this)" style="padding:6px 14px;border-radius:20px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:700;cursor:pointer">Недели</div>'+
        '<div onpointerdown="event.preventDefault();stockSetAge(\'month\',this)" style="padding:6px 14px;border-radius:20px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:700;cursor:pointer">Месяца</div>'+
        '<div onpointerdown="event.preventDefault();stockSetAge(\'quarter\',this)" style="padding:6px 14px;border-radius:20px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:700;cursor:pointer">Квартала</div>'+
        '<div onpointerdown="event.preventDefault();stockSetAge(\'year\',this)" style="padding:6px 14px;border-radius:20px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:700;cursor:pointer">Года</div>'+
        '<div onpointerdown="event.preventDefault();stockSetAge(\'custom\',this)" style="padding:6px 14px;border-radius:20px;border:1px solid #2e2e3e;background:#22222e;color:#8888aa;font-size:12px;font-weight:700;cursor:pointer">📅 Период</div>'+
      '</div>'+
      '<div id="stockAgeCustom" style="display:none;margin-top:8px;display:none">'+
        '<div style="font-size:11px;color:#8888aa;margin-bottom:4px">Поступил с</div>'+
        '<input class="fi" type="date" id="stockAgeDateFrom" style="-webkit-appearance:none;color-scheme:dark;margin:0;margin-bottom:6px" oninput="stockApplyFilter()">'+
        '<div style="font-size:11px;color:#8888aa;margin-bottom:4px">по</div>'+
        '<input class="fi" type="date" id="stockAgeDateTo" style="-webkit-appearance:none;color-scheme:dark;margin:0" oninput="stockApplyFilter()">'+
      '</div>';
  }
}
var _stockAgeMode = ''; // 'week'|'month'|'quarter'|'year'|'custom'
function stockSetAge(mode, el){
  _stockAgeMode = mode;
  var container = document.getElementById('stockFilterInput');
  if(container){
    var chips = container.querySelectorAll('div[onpointerdown]');
    chips.forEach(function(c){
      c.style.borderColor='#2e2e3e'; c.style.background='#22222e'; c.style.color='#8888aa'; c.style.borderWidth='1px';
    });
    if(el){ el.style.borderColor='#f0a060'; el.style.background='#2a1e10'; el.style.color='#f0a060'; el.style.borderWidth='2px'; }
  }
  var customDiv = document.getElementById('stockAgeCustom');
  if(customDiv) customDiv.style.display = mode==='custom' ? 'block' : 'none';
  stockApplyFilter();
}
function _stockAgeCutoff(){
  var now = new Date();
  if(_stockAgeMode==='week'){ now.setDate(now.getDate()-7); }
  else if(_stockAgeMode==='month'){ now.setMonth(now.getMonth()-1); }
  else if(_stockAgeMode==='quarter'){ now.setMonth(now.getMonth()-3); }
  else if(_stockAgeMode==='year'){ now.setFullYear(now.getFullYear()-1); }
  else { return null; }
  return now.toISOString().split('T')[0];
}
function stockApplyFilter(){
  var filterBy = (document.getElementById('stockFilterBy')||{}).value||'';
  _stockFilters = {};
  if(filterBy==='article'){ _stockFilters.article = ((document.getElementById('stockInputArticle')||{}).value||'').trim().toLowerCase(); }
  else if(filterBy==='name'){ _stockFilters.name = (document.getElementById('stockInputName')||{}).value||''; }
  else if(filterBy==='species'){ _stockFilters.species = (document.getElementById('stockInputSpecies')||{}).value||''; }
  else if(filterBy==='type'){ _stockFilters.type = (document.getElementById('stockInputType')||{}).value||''; }
  else if(filterBy==='age'){
    if(_stockAgeMode==='custom'){
      _stockFilters.ageFrom = (document.getElementById('stockAgeDateFrom')||{}).value||'';
      _stockFilters.ageTo = (document.getElementById('stockAgeDateTo')||{}).value||'';
    } else if(_stockAgeMode){
      _stockFilters.ageCutoff = _stockAgeCutoff();
      _stockFilters.ageMode = _stockAgeMode;
    }
  }
  renderStockPage();
}
function _stockGetAllItems(){
  var isAdmin=session&&session.role==='shopadmin';
  var stock=getStock();
  var filterShop=(document.getElementById('stockFilterShop')||{}).value||'';
  var shopsToShow=isAdmin?Object.keys(stock):(session&&session.shopName?[session.shopName]:[]);
  if(filterShop) shopsToShow=[filterShop];
  var rows=[];
  shopsToShow.forEach(function(sn){
    var ss=stock[sn]||{};
    Object.keys(ss).forEach(function(key){ rows.push(Object.assign({},ss[key],{_shop:sn})); });
  });
  return rows;
}
function _fetchMissingInvoicesById(cb){
  try{
    if(typeof db==='undefined' || !db){ cb(); return; }
    var shifts = getShifts();
    var manualIds = {};
    JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]').forEach(function(i){ manualIds[String(i._id!=null?i._id:i.id)]=true; });
    var wsIds = {};
    JSON.parse(localStorage.getItem('iz_invoices')||'[]').forEach(function(i){ wsIds[String(i._id!=null?i._id:i.id)]=true; });
    var missing = {};
    shifts.forEach(function(sh){
      (sh.journal||[]).forEach(function(e){
        if(e.type==='receive' && e.invId && !manualIds[String(e.invId)] && !wsIds[String(e.invId)]){
          missing[String(e.invId)] = true;
        }
      });
    });
    var ids = Object.keys(missing);
    if(!ids.length){ cb(); return; }
    var remaining = ids.length;
    var done = function(){ remaining--; if(remaining<=0) cb(); };
    ids.forEach(function(invId){
      db.collection('iz_manual_invoices').doc(invId).get({source:'server'}).then(function(snap){
        if(snap.exists){
          var manArr = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
          if(!manArr.some(function(i){ return String(i._id||i.id)===invId; })){
            manArr.push(Object.assign({id:invId}, snap.data()));
            localStorage.setItem('iz_manual_invoices', JSON.stringify(manArr));
          }
          done();
        } else {
          db.collection('iz_invoices').doc(invId).get({source:'server'}).then(function(snap2){
            if(snap2.exists){
              var invArr = JSON.parse(localStorage.getItem('iz_invoices')||'[]');
              if(!invArr.some(function(i){ return String(i._id||i.id)===invId; })){
                invArr.push(Object.assign({id:invId}, snap2.data()));
                localStorage.setItem('iz_invoices', JSON.stringify(invArr));
              }
            }
            done();
          }).catch(done);
        }
      }).catch(done);
    });
  }catch(e){ cb(); }
}
function initStockPage(){
  try{ rebuildStock(false); }catch(e){}
  _fetchMissingInvoicesById(function(){
    try{ rebuildStock(false); if(_stockMode==='byinvoice') renderStockByInvoice(); else if(_stockMode==='avail') renderStockPage(); }catch(e){}
  });
  var isAdmin=session&&session.role==='shopadmin';
  var _trBtn=document.getElementById('stockTransferBtn'); if(_trBtn) _trBtn.style.display=isAdmin?'block':'none';
  var shopRow=document.getElementById('stockShopRow');
  var shopSel=document.getElementById('stockFilterShop');
  var titleEl=document.getElementById('stockPageTitle');
  if(isAdmin){
    if(shopRow) shopRow.style.display='block';
    if(shopSel){
      shopSel.innerHTML='<option value="">Все магазины</option>'+
        getShopNames().map(function(s){ return '<option value="'+s+'">'+s+'</option>'; }).join('');
    }
    if(titleEl) titleEl.textContent='Склад (все магазины)';
  } else {
    if(shopRow) shopRow.style.display='none';
    if(titleEl) titleEl.textContent='Склад · '+(session&&session.shopName||'');
  }
  _stockMode='avail';
  _stockFilters={};
  _stockSort='date_desc';
  var sel=document.getElementById('stockFilterBy'); if(sel) sel.selectedIndex=0;
  var inp=document.getElementById('stockFilterInput'); if(inp){ inp.style.display='none'; inp.innerHTML=''; }
  setStockMode('avail');
  renderStockSortBtns();
}
function renderStockPage(){
  var isAdmin=session&&session.role==='shopadmin';
  var rows=_stockGetAllItems();
  var f=_stockFilters;
  var modeFiltered=rows.filter(function(it){
    if(_stockMode==='avail') return (it.qty||0)>0;
    return (it.qty||0)===0;
  });
  var filtered=modeFiltered.filter(function(it){
    if(f.article && (it.num||'').toLowerCase().indexOf(f.article)<0) return false;
    if(f.name && (it.name||'').toLowerCase().trim()!==f.name.toLowerCase().trim()) return false;
    if(f.species && (it.species||'')!==f.species) return false;
    if(f.type && it.goodsType!==f.type) return false;
    if(f.ageCutoff && it.lastReceived && it.lastReceived > f.ageCutoff) return false;
    if(f.ageCutoff && !it.lastReceived) return false; // no date — exclude from "old" filter
    if(f.ageFrom && it.lastReceived && it.lastReceived < f.ageFrom) return false;
    if(f.ageTo && it.lastReceived && it.lastReceived > f.ageTo) return false;
    return true;
  });
  filtered.sort(function(a,b){
    if(_stockFilters.ageCutoff||_stockFilters.ageFrom){
      var rd=(a.lastReceived||'').localeCompare(b.lastReceived||'');
      return rd!==0?rd:(a.name||'').localeCompare(b.name||'','ru');
    }
    if(_stockSort==='price_desc') return (b.price||0)-(a.price||0);
    if(_stockSort==='price_asc')  return (a.price||0)-(b.price||0);
    if(_stockSort==='sold_desc')  return (b.lastSold||'').localeCompare(a.lastSold||'');
    if(_stockSort==='sold_asc')   return (a.lastSold||'').localeCompare(b.lastSold||'');
    if(_stockSort==='date_asc')   return (a.lastReceived||'').localeCompare(b.lastReceived||'');
    return (b.lastReceived||'').localeCompare(a.lastReceived||'');
  });
  var chipsEl=document.getElementById('stockActiveFilters');
  if(chipsEl){
    var chips=[];
    if(f.article) chips.push('Арт: '+f.article);
    if(f.name) chips.push('Товар: '+f.name);
    if(f.species) chips.push('Порода: '+f.species);
    if(f.type) chips.push(f.type==='dr'?'🛍 ДР Товар':'🌳 Дерево');
    var ageLabels={'week':'⏱ >1 недели','month':'⏱ >1 месяца','quarter':'⏱ >1 квартала','year':'⏱ >1 года'};
    if(f.ageMode && ageLabels[f.ageMode]) chips.push(ageLabels[f.ageMode]);
    if(f.ageFrom||f.ageTo) chips.push('⏱ период '+(f.ageFrom||'')+'—'+(f.ageTo||''));
    chipsEl.innerHTML=chips.map(function(c){
      return '<div style="padding:4px 10px;background:#1e2a14;border:1px solid #c8f060;border-radius:20px;font-size:11px;color:#c8f060">'+c+'</div>';
    }).join('');
  }
  var sumEl=document.getElementById('stockSummary');
  if(sumEl){
    var woodCount=0,drCount=0,totalAmt=0;
    filtered.forEach(function(it){
      var q=it.qty||0;
      var price=it.price||0;
      if(_stockMode==='archive'){
        if(it.goodsType==='dr') drCount++; else woodCount++;
        totalAmt+=price; // price per unit for archived items
      } else {
        if(it.goodsType==='dr') drCount+=q; else woodCount+=q;
        totalAmt+=q*price;
      }
    });
    var modeLabel=_stockMode==='avail'?'в наличии':'продано';
    var woodLabel=_stockMode==='archive'?woodCount+' поз.':woodCount+' шт.';
    var drLabel=_stockMode==='archive'?drCount+' поз.':drCount+' шт.';
    sumEl.innerHTML='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px">'+
      '<div style="background:#1a2e1e;border:1px solid #2e4e2e;border-radius:10px;padding:8px 12px;flex:1;min-width:70px">'+
        '<div class="u-fs10-gray">🌳 Дерево</div>'+
        '<div style="font-size:16px;font-weight:700;color:#c8f060">'+woodLabel+'</div>'+
      '</div>'+
      '<div style="background:#1e1a2e;border:1px solid #3e2e4e;border-radius:10px;padding:8px 12px;flex:1;min-width:70px">'+
        '<div class="u-fs10-gray">🛍 ДР</div>'+
        '<div style="font-size:16px;font-weight:700;color:#a060f0">'+drLabel+'</div>'+
      '</div>'+
      '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:10px;padding:8px 12px;flex:1;min-width:70px">'+
        '<div class="u-fs10-gray">'+(_stockMode==='archive'?'💰 Стоимость':'💰 Сумма')+'</div>'+
        '<div style="font-size:13px;font-weight:700;color:#f0f0f8">'+Math.round(totalAmt).toLocaleString('ru-RU')+'₽</div>'+
      '</div>'+
    '</div>'+
    '<div class="u-fs10-gray">'+filtered.length+' позиций '+modeLabel+'</div>';
  }
  var countEl=document.getElementById('stockFilterCount');
  if(countEl) countEl.textContent=filtered.length?filtered.length+' поз.':'';
  var listEl=document.getElementById('stockList');
  if(!listEl) return;
  if(!filtered.length){
    var isEmpty=Object.keys(f).every(function(k){ return !f[k]; });
    listEl.innerHTML='<div class="empty"><div class="ei">'+(_stockMode==='avail'?'📦':'🗂')+'</div>'+
      (_stockMode==='avail'?'Нет товаров в наличии':'Нет товаров в архиве')+
      (isEmpty?'<br><small>Нажмите 🔄 Пересчитать</small>':'<br>по выбранным фильтрам')+'</div>';
    return;
  }
  listEl.innerHTML=filtered.map(function(it){
    var gtColor=it.goodsType==='dr'?'#a060f0':'#c8f060';
    var gtLabel=it.goodsType==='dr'?'ДР':'🌳';
    var qtyColor=_stockMode==='avail'?(it.qty>5?'#c8f060':it.qty>0?'#f0c060':'#f06060'):'#8888aa';
    var dateStr=it.lastReceived?'приход: '+it.lastReceived:'';
    return '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:12px;padding:11px 12px;margin-bottom:7px">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div style="flex:1">'+
          '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">'+
            '<span style="font-size:10px;font-weight:700;color:'+gtColor+';background:'+gtColor+'18;padding:2px 6px;border-radius:6px">'+gtLabel+'</span>'+
            (it.num?'<span style="font-size:11px;font-weight:700;color:#8888aa">№'+it.num+'</span>':'')+
            (isAdmin?'<span style="font-size:10px;color:#606080">· '+it._shop+'</span>':'')+
          '</div>'+
          '<div style="font-size:14px;font-weight:700;margin-bottom:1px">'+it.name+'</div>'+
          (it.species?'<div class="u-fs11-gray">'+it.species+(it.size?' · '+it.size:'')+'</div>':'')+
          (dateStr?'<div style="font-size:10px;color:#606080;margin-top:2px">'+dateStr+'</div>':'')+
        '</div>'+
        '<div style="text-align:right;flex-shrink:0;padding-left:10px">'+
          (it.qty===0 && _stockMode==='archive'
            ? '<div style="font-size:11px;font-weight:700;color:#60f090;background:#1a2e1e;border-radius:8px;padding:4px 8px;margin-bottom:2px">✓ Продано</div>'+
              (it.lastSold?'<div class="u-fs10-gray">'+it.lastSold+'</div>':'')
            : '<div style="font-size:22px;font-weight:700;color:'+qtyColor+'">'+it.qty+'</div>'+
              '<div style="font-size:9px;color:#8888aa">шт.</div>'
          )+
          '<div style="font-size:11px;font-weight:600;color:#c8a060;margin-top:3px">'+(it.qty>0?Math.round(it.qty*(it.price||0)).toLocaleString('ru-RU')+'₽':Math.round(it.price||0).toLocaleString('ru-RU')+'₽/шт')+'</div>'+
        '</div>'+
      '</div>'+
    '</div>';
  }).join('');
}
function clearStockFilters(){
  _stockFilters={};
  var sel=document.getElementById('stockFilterBy'); if(sel) sel.selectedIndex=0;
  var inp=document.getElementById('stockFilterInput'); if(inp){ inp.style.display='none'; inp.innerHTML=''; }
  var chips=document.getElementById('stockActiveFilters'); if(chips) chips.innerHTML='';
  renderStockPage();
}
function startStockSync(){
  var shops=getShopNames();
  shops.forEach(function(sn){
    var docId='stock_'+sn.replace(/\s+/g,'_');
    try{
      db.collection('iz_settings').doc(docId).onSnapshot(function(snap){
        if(!snap.exists) return;
        var data=snap.data();
        if(!data||!data.items) return;
        var stock=getStock();
        stock[sn]=data.items;
        localStorage.setItem('iz_stock',JSON.stringify(stock));
        try{ renderStockPage(); }catch(e){}
      });
    }catch(e){}
  });
}

/* ===== Управление свайпами ===== */
(function(){
  var mTouch = {active:false, startY:0, startX:0, md:null, mo:null};
  document.addEventListener('touchstart', function(e){
    var md = e.target.closest('.mo.open .md');
    if(!md){ mTouch.active=false; return; }
    if(md.scrollTop > 4) { mTouch.active=false; return; } // не мешаем обычному скроллу, если не у самого верха
    mTouch.active = true;
    mTouch.startY = e.touches[0].clientY;
    mTouch.startX = e.touches[0].clientX;
    mTouch.md = md;
    mTouch.mo = md.closest('.mo');
  }, {passive:true});
  document.addEventListener('touchmove', function(e){
    if(!mTouch.active || !mTouch.md) return;
    var dy = e.touches[0].clientY - mTouch.startY;
    var dx = e.touches[0].clientX - mTouch.startX;
    if(dy>0 && dy>Math.abs(dx)){
      mTouch.md.style.transition='none';
      mTouch.md.style.transform='translateY('+dy+'px)';
      mTouch.md.style.opacity=Math.max(0.4, 1-dy/500);
    }
  }, {passive:true});
  document.addEventListener('touchend', function(e){
    if(!mTouch.active || !mTouch.md) return;
    var md = mTouch.md, moEl = mTouch.mo;
    var dy = (e.changedTouches[0].clientY - mTouch.startY);
    md.style.transition='transform 0.2s ease, opacity 0.2s ease';
    if(dy > 110){
      md.style.transform='translateY(100%)'; md.style.opacity='0';
      var moId = moEl && moEl.id;
      setTimeout(function(){
        md.style.transition=''; md.style.transform=''; md.style.opacity='';
        if(moId) closeMo(moId);
      }, 180);
    } else {
      md.style.transform='translateY(0)'; md.style.opacity='1';
      setTimeout(function(){ md.style.transition=''; }, 200);
    }
    mTouch.active=false; mTouch.md=null; mTouch.mo=null;
  }, {passive:true});

  var tTouch = {tracking:false, startX:0, startY:0};
  document.addEventListener('touchstart', function(e){
    if(document.querySelector('.mo.open')){ tTouch.tracking=false; return; }
    if(e.target.closest('#mainTabs')){ tTouch.tracking=false; return; }
    var hScroll = e.target.closest('[style*="overflow-x"]');
    if(hScroll && hScroll.scrollWidth > hScroll.clientWidth + 2){ tTouch.tracking=false; return; }
    tTouch.tracking = true;
    tTouch.startX = e.touches[0].clientX;
    tTouch.startY = e.touches[0].clientY;
  }, {passive:true});
  document.addEventListener('touchend', function(e){
    if(!tTouch.tracking) return;
    tTouch.tracking = false;
    var dx = e.changedTouches[0].clientX - tTouch.startX;
    var dy = e.changedTouches[0].clientY - tTouch.startY;
    if(Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy)*1.4) return;
    var bar = document.getElementById('mainTabs');
    if(!bar || bar.style.display==='none') return;
    var tabs = Array.prototype.slice.call(bar.querySelectorAll('.tab'));
    if(!tabs.length) return;
    var activeIdx = tabs.findIndex(function(t){return t.classList.contains('active');});
    if(activeIdx<0) return;
    var nextIdx = dx<0 ? activeIdx+1 : activeIdx-1;
    if(nextIdx<0 || nextIdx>=tabs.length) return;
    tabs[nextIdx].click();
  }, {passive:true});
})();

// ════ Отгрузка в другой магазин (массовое списание) ════
// Админ вставляет список «№;Название;Порода;Цена;Кол-во». На сохранении: 1) в магазин-получатель
// уходит входящая накладная (status:'pending', как от мастерской) — там её принимают обычной
// «Принять накладную»; 2) в смену магазина-отправителя за выбранную дату пишется одно списание
// «Отгрузка → <магазин>» со всеми позициями (через svPersist — тот же путь, что правка архивной
// смены: пересчёт остатков дальше по цепочке, слияние с облаком, повтор при сбое); 3) склад
// отправителя уменьшается. Накладная пишется первой: если она не ушла — ничего не меняем.
// Списание попадает и в iz_journal_backup — по нему приёмка у получателя пропускает номера,
// уже принятые раньше в магазине-отправителе (см. _findArtDupInItems).
var _trRows = [];
var _TR_DRAFT_KEY = 'iz_transfer_draft';
// Продавец на смене: «Откуда» — только свой магазин, дата — сегодня, списание пишется в его живой
// журнал. Админ: любые магазины и дата, списание — в смену за эту дату (см. trSave).
function _trIsAdmin(){ return !!(session && session.role==='shopadmin'); }
function _trDraftKey(){ return _trIsAdmin() ? _TR_DRAFT_KEY : _TR_DRAFT_KEY+'_'+((session&&session.shopName)||''); }
// Мастерская — одно из мест назначения наравне с магазинами (её склад принимает накладную в
// приложении мастерской). Если точка с таким названием уже заведена в списке магазинов — берём её.
function _trWorkshopName(){
  var w = getShopNames().find(function(sn){ return /мастерск/i.test(sn); });
  return w || 'Мастерская';
}
function _trSaveDraft(){
  try{
    localStorage.setItem(_trDraftKey(), JSON.stringify({rows:_trRows, kind:_trKind,
      from:gv('trFrom'), to:gv('trTo'), date:gv('trDate'), type:gv('trType'), num:gv('trNum'), reason:gv('trReason')}));
  }catch(e){}
}
// Вид накладной: «Перемещение» — в свой магазин/мастерскую, там принимают по накладной;
// «Списание» — брак, бой и т.п., без получателя и без накладной на приёмку.
var _trKind = 'move';
function trSetKind(kind){
  _trKind = kind==='wo' ? 'wo' : 'move';
  var isWo = _trKind==='wo';
  var style = function(id, on, color){ var b=document.getElementById(id); if(!b) return;
    b.style.border = on ? '2px solid '+color : '1px solid #2e2e3e'; b.style.background = on ? '#22222e' : 'none'; b.style.color = on ? color : '#8888aa'; };
  style('trKindMove', !isWo, '#60c8f0'); style('trKindWo', isWo, '#f06060');
  var show = function(id, on){ var el=document.getElementById(id); if(el) el.style.display = on ? '' : 'none'; };
  show('trToWrap', !isWo); show('trReasonWrap', isWo);
  var lbl = document.getElementById('trFromLbl'); if(lbl) lbl.textContent = isWo ? 'Магазин' : 'Откуда';
  var hint = document.getElementById('trKindHint');
  if(hint) hint.textContent = isWo ? 'Товар списывается со склада магазина без получателя (брак, бой, недостача). Причина обязательна.'
    : 'Товар списывается со склада отправителя и уходит входящей накладной туда, куда перемещаете (магазин или мастерская) — там его сверяют и принимают.';
  var t = document.getElementById('trTitle'); if(t) t.textContent = isWo ? '🗑 Списание списком' : '🚚 Перемещение товара';
  var sb = document.getElementById('trSaveBtn'); if(sb) sb.textContent = isWo ? '🗑 Списать' : '🚚 Списать и отправить накладную';
  _trSaveDraft(); _trRender();
}
function _trTodayIso(){ var n=new Date(); return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0'); }
function _trSuggestNum(dateIso){ return 'ПЕР-'+String(dateIso||_trTodayIso()).replace(/-/g,'').slice(2)+'-'+uid().slice(0,3).toUpperCase(); }
function openTransferMo(){
  var isAdmin = _trIsAdmin();
  if(!isAdmin && !(session && session.shopName && !session.isPreview)){ showToast('Перемещение доступно на открытой смене'); return; }
  var esc = function(v){ return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); };
  var shops = getShopNames();
  var ws = _trWorkshopName();
  var f=document.getElementById('trFrom'), t=document.getElementById('trTo'), d=document.getElementById('trDate');
  if(f){
    var fromList = isAdmin ? shops : [session.shopName];
    f.innerHTML = fromList.map(function(sn){ return '<option value="'+esc(sn)+'">'+esc(sn)+'</option>'; }).join('');
    f.disabled = !isAdmin;
  }
  if(t){
    var toList = shops.filter(function(sn){ return sn!==ws && (isAdmin || sn!==session.shopName); });
    t.innerHTML = toList.map(function(sn){ return '<option value="'+esc(sn)+'">'+esc(sn)+'</option>'; }).join('')+
      '<option value="'+esc(ws)+'">🏭 '+esc(ws)+' (склад)</option>';
  }
  var draft = null; try{ draft = JSON.parse(localStorage.getItem(_trDraftKey())||'null'); }catch(e){}
  _trRows = (draft && draft.rows) || [];
  if(d){ d.max=_trTodayIso(); d.value = isAdmin ? ((draft&&draft.date)||_trTodayIso()) : _trTodayIso(); d.disabled = !isAdmin; }
  if(f && isAdmin && draft && draft.from) f.value = draft.from;
  if(t){
    var fromNow = f ? f.value : '';
    t.value = (draft && draft.to && draft.to!==fromNow) ? draft.to : (shops.find(function(sn){ return sn!==fromNow && sn!==ws; })||ws);
  }
  var ty=document.getElementById('trType'); if(ty) ty.value=(draft&&draft.type)||'derevo';
  var nm=document.getElementById('trNum'); if(nm) nm.value=(draft&&draft.num)||_trSuggestNum(d&&d.value);
  var rs=document.getElementById('trReason'); if(rs) rs.value=(draft&&draft.reason)||'';
  trSetKind((draft&&draft.kind)||'move');
  openMo('transferMo');
  // приёмки и списания по номерам — для пояснений «где сейчас этот номер» в строках
  try{ _buildUsedArticleIndex().then(function(){ _trRender(); }, function(){}); }catch(e){}
  if(_trRows.length) showToast('📝 Продолжаем начатый список: '+_trRows.length+' поз.');
}
function trFieldChanged(){ _trSaveDraft(); _trRender(); }
function _trStockOf(shop){ return (getStock()[shop]) || {}; }
// Где эта позиция лежит на складе отправителя: по номеру, а без номера — по названию+цене(+порода).
function _trStockFind(stockShop, r, gt){
  var num = String(r.num||'').trim();
  if(num) return stockShop[num] ? {key:num, it:stockShop[num]} : null;
  var key = _noArticleStockKey(r.name, r.price, r.species, gt);
  if(key && stockShop[key]) return {key:key, it:stockShop[key]};
  var alt = _findStockKeyByNamePrice(stockShop, r.name, r.price, gt, key);
  return alt ? {key:alt, it:stockShop[alt]} : null;
}
function _trKey(r){
  var n = String(r.num||'').trim();
  return n ? 'n:'+n : 's:'+String(r.name||'').trim().toLowerCase()+'|'+(r.price||0)+'|'+String(r.species||'').trim().toLowerCase();
}
function trParse(){
  var raw = gv('trText')||'';
  var gt = gv('trType')||'derevo';
  var stockShop = _trStockOf(gv('trFrom'));
  var added=0, merged=0;
  raw.split(/\r?\n/).forEach(function(line){
    line = line.trim(); if(!line) return;
    var delim = line.indexOf('\t')>=0 ? '\t' : (line.indexOf(';')>=0 ? ';' : (line.indexOf('|')>=0 ? '|' : null));
    var cells = delim ? line.split(delim).map(function(c){ return c.trim(); }) : [line];
    if(/^(№|номер|арт)/i.test(cells[0]) && /назв/i.test(cells[1]||'')) return; // строка-заголовок
    var r = {num:cells[0]||'', name:cells[1]||'', species:cells[2]||'', price:_invImpNum(cells[3]), qty:_invImpNum(cells[4])};
    if(cells.length===1){ r.num = /^\d+$/.test(cells[0]) ? cells[0] : ''; if(!r.num) r.name = cells[0]; }
    var st = r.num ? stockShop[String(r.num).trim()] : null;
    if(st){ if(!r.name) r.name = st.name||''; if(!r.species) r.species = st.species||''; if(r.price==null) r.price = st.price||0; }
    if(r.price==null) r.price = 0;
    if(r.qty==null || r.qty<=0) r.qty = 1;
    var k = _trKey(r);
    var ex = _trRows.find(function(x){ return _trKey(x)===k; });
    if(ex){ ex.qty = (ex.qty||0)+r.qty; merged++; } else { _trRows.push(r); added++; }
  });
  if(!added && !merged){ showToast('Строк не найдено во вставленном тексте'); return; }
  var ta=document.getElementById('trText'); if(ta) ta.value='';
  _trSaveDraft(); _trRender();
  showToast('✅ Добавлено '+added+(merged?', объединено с уже внесёнными: '+merged:'')+' — вставьте следующую страницу или отправляйте');
}
// Сумма строки: «10 × 100 ₽ = 1 000 ₽» (при 1 шт. — просто сумма).
function _rowSumTxt(r){
  var q = r.qty||0, p = r.price||0;
  return (q>1 ? q+' × '+fmt(p)+' = ' : '')+fmt(q*p);
}
function trEdit(i, f, v){
  var r=_trRows[i]; if(!r) return;
  r[f] = (f==='price'||f==='qty') ? (_invImpNum(v)||0) : v;
  var el = document.getElementById('trRowSum_'+i); if(el) el.textContent = _rowSumTxt(r);
  _trSaveDraft(); _trRenderTotals();
}
function trDel(i){ _trRows.splice(i,1); _trSaveDraft(); _trRender(); }
function trClearAll(){
  if(!_trRows.length) return;
  if(!confirm('Очистить весь список ('+_trRows.length+' поз.)?')) return;
  _trRows=[]; _trSaveDraft(); _trRender();
}
// Проблемы строки: нет названия / кол-во больше, чем на складе отправителя / нет на складе вовсе.
// Почему позиции нет на складе отправителя — конкретно, а не общим «нет на складе»: номер был, но
// ушёл (списан/продан, с датой), числится в другом магазине или где его принимали последний раз.
function _trDateRu(d){ return String(d||'').slice(0,10).split('-').reverse().join('.'); }
function _trRowIssues(r, stockShop, gt, fromShop){
  var iss = [];
  if(!String(r.name||'').trim()) iss.push('нет названия');
  if(!(r.qty>0)) iss.push('нет кол-ва');
  var f = _trStockFind(stockShop, r, gt);
  if(f && (f.it.qty||0)>0){
    if((f.it.qty||0) < r.qty) iss.push('на складе «'+(fromShop||'отправителя')+'» только '+f.it.qty+' шт.');
    return iss;
  }
  var num = String(r.num||'').trim();
  if(f){
    var wo = num && _woArtIndex && (_woArtIndex[num]||[]).filter(function(w){ return w.shop===fromShop; }).sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); })[0];
    iss.push('на складе «'+(fromShop||'отправителя')+'» 0 шт.'+(wo?' — списан '+_trDateRu(wo.date):(f.it.lastSold?' — продан/списан '+_trDateRu(f.it.lastSold):'')));
    return iss;
  }
  if(num){
    var all = getStock(), elsewhere = [];
    Object.keys(all).forEach(function(sn){ if(sn!==fromShop && all[sn] && all[sn][num] && (all[sn][num].qty||0)>0) elsewhere.push('«'+sn+'» ('+all[sn][num].qty+' шт.)'); });
    if(elsewhere.length){ iss.push('нет на «'+(fromShop||'отправителе')+'» — числится на '+elsewhere.join(', ')); return iss; }
    var occ = (typeof _usedArtIndex!=='undefined' && _usedArtIndex && _usedArtIndex[num]) || [];
    var last = occ.slice().sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); })[0];
    if(last){ iss.push('нет на складе «'+(fromShop||'отправителя')+'» — последняя приёмка: «'+last.shop+'», '+_trDateRu(last.date)); return iss; }
    iss.push('номера нет ни на одном складе и ни в одной приёмке');
    return iss;
  }
  iss.push('нет на складе «'+(fromShop||'отправителя')+'»');
  return iss;
}
function _trRenderTotals(){
  var el=document.getElementById('trTotals'); if(!el) return;
  var q=0, s=0; _trRows.forEach(function(r){ q+=r.qty||0; s+=(r.qty||0)*(r.price||0); });
  el.textContent = _trRows.length+' поз. · '+q+' шт. · '+fmt(s);
}
function _trRender(){
  var host=document.getElementById('trPreview'); if(!host) return;
  if(!_trRows.length){ host.innerHTML='<button type="button" onclick="trAddRow()" style="width:100%;margin-top:8px;padding:8px;background:none;border:1px dashed #60c8f0;border-radius:8px;color:#60c8f0;font-size:11.5px;font-weight:700;cursor:pointer">➕ Добавить строку вручную</button>'; return; }
  var gt = gv('trType')||'derevo', from = gv('trFrom'), to = gv('trTo');
  var stockShop = _trStockOf(from);
  var esc = function(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); };
  // № / Название / Порода — с подсказками из склада отправителя и каталога (как в продаже)
  var inp = function(i,f,v,w,mode){
    var sugg = (f==='num'||f==='name'||f==='species');
    return '<input value="'+esc(v)+'" onchange="trEdit('+i+',\''+f+'\',this.value)"'+
      (sugg?' oninput="_trSugg('+i+',\''+f+'\',this.value)" onfocus="_trSugg('+i+',\''+f+'\',this.value)" onblur="_trHideSugg('+i+')" autocomplete="off"':'')+
      (mode?' inputmode="'+mode+'"':'')+' style="width:'+w+';min-width:0;background:#22222e;border:1px solid #2e2e3e;border-radius:6px;color:#f0f0f8;font-size:11px;padding:5px">';
  };
  var bad = 0;
  var rows = _trRows.map(function(r,i){
    var iss = _trRowIssues(r, stockShop, gt, from); if(iss.length) bad++;
    return '<div style="padding:6px 0;border-bottom:1px solid #22222e">'+
      '<div style="display:flex;gap:4px;align-items:center">'+
        inp(i,'num',r.num,'70px')+inp(i,'name',r.name,'auto;flex:1')+inp(i,'species',r.species,'70px')+
        inp(i,'price',r.price,'52px','numeric')+inp(i,'qty',r.qty,'36px','numeric')+
        '<button type="button" onclick="trDel('+i+')" style="background:none;border:none;color:#f06060;font-size:13px;cursor:pointer;padding:2px">✕</button>'+
      '</div>'+
      '<div id="trSugg_'+i+'" style="display:none;background:#1a1a22;border:1px solid #60c8f0;border-radius:8px;max-height:220px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:4px"></div>'+
      '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:2px">'+
        '<div style="font-size:10px;color:#f0c060">'+(iss.length?'⚠️ '+iss.join(' · '):'')+'</div>'+
        '<div id="trRowSum_'+i+'" style="font-size:11px;font-weight:700;color:#c8f060;flex-shrink:0">'+_rowSumTxt(r)+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
  host.innerHTML = '<div style="background:#13131a;border:1px solid #2e2e3e;border-radius:10px;padding:8px 10px;margin-top:10px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div style="font-size:12px;font-weight:700">'+esc(from)+(_trKind==='wo'?' · списание':' → '+esc(to))+' · <span id="trTotals"></span></div>'+
      '<button type="button" onclick="trClearAll()" style="background:none;border:1px solid #f0606055;border-radius:6px;color:#f06060;font-size:10px;padding:3px 7px;cursor:pointer">Очистить</button></div>'+
    '<div style="font-size:9.5px;color:#555568;margin-bottom:2px">№ · Название · Порода · Цена · Кол-во</div>'+
    (_trKind!=='wo'&&from===to?'<div style="font-size:11px;color:#f06060;font-weight:700;margin:4px 0">⛔ Откуда и Куда — один и тот же магазин</div>':'')+
    (bad?'<div style="font-size:11px;color:#f0c060;margin:4px 0">⚠️ Строк с замечаниями: '+bad+'</div>':'')+
    rows+
    '<button type="button" onclick="trAddRow()" style="width:100%;margin-top:8px;padding:8px;background:none;border:1px dashed #60c8f0;border-radius:8px;color:#60c8f0;font-size:11.5px;font-weight:700;cursor:pointer">➕ Строка</button>'+
    '</div>';
  _trRenderTotals();
}
function trAddRow(){
  _trRows.push({num:'', name:'', species:'', price:0, qty:1});
  _trSaveDraft(); _trRender();
  var i = _trRows.length-1;
  setTimeout(function(){ var el=document.querySelector('#trPreview input[onchange^="trEdit('+i+',\'name\'"]'); if(el) el.focus(); }, 0);
}
// Подсказки для строки: склад отправителя (что реально можно отгрузить — с остатком) + каталог
// «База товаров» по виду товара; для породы — справочник пород. Выбор позиции заполняет строку.
var _trSuggMatches = {};
var _trSuggHideT = {};
// Подбор вариантов «что это за товар» по введённому тексту: сначала наличие на складе магазина
// (📦, с остатком), потом каталог «База товаров» (📚). gt=null — оба вида товара (форма списания
// продавца сама переключает Дерево/ДР по выбранной позиции). field: 'num' — ищем только по номеру.
function _stockCatalogMatches(shop, gt, field, val){
  var words = String(val||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if(!words.length) return [];
  var hit = function(text){ var low = String(text||'').toLowerCase(); return words.every(function(w){ return low.indexOf(w)>=0; }); };
  // Без лимитов — список прокручивается. Раньше общий лимит 15 съедали товары со склада (по слову
  // «доска» их десятки с разными номерами), и простые названия из базы («Доска д/подачи») в список
  // не попадали. Порядок: названия из базы, наличие на складе, позиции каталога с артикулом.
  var stockM = [], namesM = [], catArtM = [], seen = {}, seenName = {};
  var stockShop = _trStockOf(shop);
  Object.keys(stockShop).forEach(function(k){
    var it = stockShop[k]||{}, g = it.goodsType||'derevo';
    if((gt && g!==gt) || (it.qty||0)<=0) return;
    var num = /^(DR_|WD_)/.test(k) ? '' : (it.num&&!/^(DR_|WD_)/.test(it.num) ? it.num : k);
    if(!hit(field==='num' ? num : (num+' '+it.name+' '+(it.species||'')))) return;
    var sig = g+'|'+num+'|'+(it.name||'')+'|'+(it.species||'')+'|'+(it.price||0); if(seen[sig]) return; seen[sig]=true;
    stockM.push({src:'stock', gt:g, num:num, name:it.name||'', species:it.species||'', price:it.price||0, qty:it.qty||0});
  });
  (gt ? [gt] : ['derevo','dr']).forEach(function(g){
    (getRefBook(g==='dr'?'iz_goods_dr':'iz_goods_derevo')||[]).forEach(function(c){
      if(!c) return;
      var name = (c.name||c); if(!name || typeof name!=='string') return;
      var num = c.article||'';
      if(!num){
        if(field==='num' || !hit(name)) return;
        var nk = g+'|'+name.trim().toLowerCase(); if(seenName[nk]) return; seenName[nk]=true;
        namesM.push({src:'cat', gt:g, num:'', name:name, species:c.species||'', price:c.price||0});
        return;
      }
      if(!hit(field==='num' ? num : (num+' '+name+' '+(c.species||'')))) return;
      var sig = g+'|'+num+'|'+name+'|'+(c.species||'')+'|'+(c.price||0); if(seen[sig]) return; seen[sig]=true;
      catArtM.push({src:'cat', gt:g, num:num, name:name, species:c.species||'', price:c.price||0});
    });
  });
  namesM.sort(function(a,b){ return a.name.localeCompare(b.name,'ru'); });
  return namesM.concat(stockM).concat(catArtM);
}
function _stockMatchLabel(m){
  var esc = function(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;'); };
  return (m.src==='stock'?'📦 ':'📚 ')+(m.num?'<b>№'+esc(m.num)+'</b> ':'')+esc(m.name)+
    (m.species?' <span style="color:#f0c060">· '+esc(m.species)+'</span>':'')+
    (m.price?' · '+fmt(m.price):'')+
    (m.src==='stock'?' <span style="color:#60f090">· в наличии '+m.qty+'</span>':'');
}
function _trSugg(i, field, val){
  if(_trSuggHideT[i]){ clearTimeout(_trSuggHideT[i]); delete _trSuggHideT[i]; }
  var box = document.getElementById('trSugg_'+i); if(!box) return;
  var matches;
  if(field==='species'){
    var words = String(val||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
    matches = !words.length ? [] : getSpecies().filter(function(sp){ var low=String(sp).toLowerCase(); return words.every(function(w){ return low.indexOf(w)>=0; }); }).map(function(sp){ return {species:sp, label:sp}; });
  } else {
    matches = _stockCatalogMatches(gv('trFrom'), gv('trType')||'derevo', field, val);
  }
  _trSuggMatches[i] = {field:field, list:matches};
  if(!matches.length){ box.style.display='none'; box.innerHTML=''; return; }
  box.innerHTML = matches.map(function(m, k){
    var label = field==='species' ? String(m.label).replace(/</g,'&lt;') : _stockMatchLabel(m);
    return '<div onclick="_trPick('+i+','+k+')" style="padding:8px 10px;font-size:11.5px;color:#f0f0f8;border-bottom:1px solid #2e2e3e;cursor:pointer">'+label+'</div>';
  }).join('');
  box.style.display='block';
}
function _trHideSugg(i){
  _trSuggHideT[i] = setTimeout(function(){ var b=document.getElementById('trSugg_'+i); if(b) b.style.display='none'; delete _trSuggHideT[i]; }, 200);
}
function _trPick(i, k){
  var r = _trRows[i], sm = _trSuggMatches[i]; if(!r || !sm || !sm.list[k]) return;
  var m = sm.list[k];
  if(sm.field==='species'){ r.species = m.species; }
  else {
    r.name = m.name;
    if(m.num) r.num = m.num;
    if(m.species) r.species = m.species;
    if(m.price) r.price = m.price;
  }
  _trSaveDraft(); _trRender();
}
// Смена отправителя за дату: если их несколько — открытая, иначе последняя по времени открытия.
function _trFindShift(shop, dateIso){
  var tombs = (typeof getShiftTombstones==='function') ? getShiftTombstones() : [];
  return db.collection('iz_shifts').where('shopName','==',shop).get({source:'server'}).then(function(snap){
    var list = snap.docs.map(function(d){ var x=d.data(); x.id=d.id; return x; }).filter(function(x){
      return x.date===dateIso && !x._deleted && !x.isRestoreShift && tombs.indexOf(x.id)===-1;
    });
    if(!list.length) return null;
    var open = list.find(function(x){ return x.status==='open' || !x.closedAt; });
    if(open) return open;
    list.sort(function(a,b){ return String(b.openedAt||'').localeCompare(String(a.openedAt||'')); });
    return list[0];
  });
}
function trSave(){
  var isAdmin = _trIsAdmin();
  var from=gv('trFrom'), to=gv('trTo'), dateIso=gv('trDate'), gt=gv('trType')||'derevo', num=(gv('trNum')||'').trim();
  if(!isAdmin){ from = session && session.shopName; dateIso = _trTodayIso(); }
  var isWo = _trKind==='wo';
  var woReason = (gv('trReason')||'').trim();
  if(isWo){ to = ''; if(!woReason){ showToast('Укажите причину списания'); return; } }
  if(!from || (!isWo && !to)){ showToast('Выберите, куда перемещаете'); return; }
  if(!isWo && from===to){ showToast('⛔ Откуда и Куда — одно и то же место'); return; }
  if(!dateIso){ showToast('Укажите дату'); return; }
  if(!num){ showToast('Укажите № накладной'); return; }
  if(!_trRows.length){ showToast('Список пуст — добавьте позиции'); return; }
  var noName = _trRows.findIndex(function(r){ return !String(r.name||'').trim() || !(r.qty>0); });
  if(noName>=0){ showToast('⛔ Строка '+(noName+1)+': нужно название и кол-во'); return; }
  var stockShop = _trStockOf(from);
  var bad = _trRows.filter(function(r){ return _trRowIssues(r, stockShop, gt, from).length; }).length;
  var totalQty = _trRows.reduce(function(s,r){ return s+(r.qty||0); },0);
  var totalAmt = _trRows.reduce(function(s,r){ return s+(r.qty||0)*(r.price||0); },0);
  var head = (isWo ? 'Списание '+num+' («'+woReason+'»): '+from : 'Перемещение '+num+': '+from+' → '+to)+'\n'+_trRows.length+' поз. · '+totalQty+' шт. · '+fmt(totalAmt)+'\n\n';
  var tail = isWo ? '.' : ', в «'+to+'» уйдёт накладная на приёмку.';
  var badTxt = bad ? '\n\n⚠️ Строк с замечаниями по складу «'+from+'»: '+bad+' — всё равно отправить?' : '';
  if(!isAdmin){
    // Продавец: списание — в свою открытую смену (живой журнал на этом устройстве).
    if(!session || session.isPreview || !Array.isArray(journal)){ showToast('Перемещение доступно на открытой смене'); return; }
    if(!confirm(head+'Списание попадёт в вашу текущую смену'+tail+badTxt)) return;
    _trCommit({kind:_trKind, reason:woReason, from:from, to:to, dateIso:dateIso, gt:gt, num:num, totalQty:totalQty, totalAmt:totalAmt, shift:null});
    return;
  }
  showToast('⏳ Ищу смену «'+from+'» за '+dateIso.split('-').reverse().join('.')+'...');
  _trFindShift(from, dateIso).then(function(sh){
    if(!sh){ showToast('⛔ У магазина «'+from+'» нет смены за '+dateIso.split('-').reverse().join('.')+' — списывать некуда. Выберите дату, когда магазин работал.'); return; }
    if(!confirm(head+'Списание попадёт в смену «'+from+' · '+dateIso.split('-').reverse().join('.')+'» ('+(sh.sellerName||'—')+(sh.status==='open'||!sh.closedAt?', открыта':', закрыта')+')'+tail+badTxt)) return;
    _trCommit({kind:_trKind, reason:woReason, from:from, to:to, dateIso:dateIso, gt:gt, num:num, totalQty:totalQty, totalAmt:totalAmt, shift:sh});
  }).catch(function(err){ showToast('❌ Не удалось найти смену: '+(err&&err.message||err)); });
}
// Накладная пишется первой: если она не ушла — ничего не списываем.
function _trCommit(o){
  var isWo = o.kind==='wo';
  var reason = isWo ? o.reason : 'Перемещение в «'+o.to+'» · накл. '+o.num;
  var invId = isWo ? null : uid();
  var items = _trRows.map(function(r){
    var n = String(r.num||'').trim();
    return {num:n, article:n, name:String(r.name).trim(), species:String(r.species||'').trim(), price:r.price||0, qty:r.qty, amt:(r.price||0)*r.qty, goodsType:o.gt, reason:reason};
  });
  var who = (session&&(session.name||session.sellerName))||'admin';
  var toWorkshop = o.to===_trWorkshopName();
  var inv = {id:invId, num:o.num, date:o.dateIso, sourceName:o.from, destName:o.to, status:'pending', goodsType:o.gt,
    items:items.map(function(it){ return {num:it.num, article:it.article, name:it.name, species:it.species, price:it.price, qty:it.qty, goodsType:o.gt}; }),
    total:o.totalAmt, isTransfer:true, transferFrom:o.from, toWorkshop:toWorkshop, createdBy:who, createdAt:new Date().toISOString()};
  (isWo ? Promise.resolve() : db.collection('iz_invoices').doc(invId).set(inv)).then(function(){
    var ts = (o.shift===null || o.dateIso===_trTodayIso()) ? _workingNowISO() : new Date(o.dateIso+'T12:00:00').toISOString();
    var isDr = o.gt==='dr';
    var entry = {id:uid(), type:'writeoff', ts:ts, icon:isWo?'🗑️':'🚚', label:isWo?'Списание':'Перемещение → '+o.to,
      sub:items.length+' поз. ('+o.totalQty+' шт.) · накл. '+o.num+(isWo?' · '+reason:''), goodsType:o.gt, items:items, reason:reason,
      amount:o.totalAmt, amtCls:'exp', amtSign:'−', cashEffect:0, cardEffect:0, staffEffect:0,
      goodsEffect:isDr?0:-o.totalAmt, goodsDrEffect:isDr?-o.totalAmt:0,
      addedBy:who, addedAt:new Date().toISOString()};
    if(isWo){ entry.woInvNum = o.num; }
    else { entry.transferTo = o.to; entry.transferInvId = invId; entry.transferInvNum = o.num; }
    if(o.shift===null){
      journal.push(entry);
      saveJ();
      _backupCheckPassed = false;
      try{ syncLiveShift(); }catch(e){}
    } else {
      // Админ: тот же путь, что правка архивной смены, — временно подменяем открытую в интерфейсе
      // смену и сразу возвращаем (асинхронная часть svPersist держит свою копию).
      var sh = o.shift, prevView = _currentShiftView;
      try{
        if(sh.status==='closed' && typeof _ensureGoodsEveningAnchor==='function') _ensureGoodsEveningAnchor(sh);
        sh.journal = (sh.journal||[]).concat([entry]).sort(function(a,b){ return String(a.ts||'').localeCompare(String(b.ts||'')); });
        _currentShiftView = sh;
        // у открытой смены вечернего остатка ещё нет — пересчитывать нечего, его посчитают при закрытии
        svPersist(sh.status==='open' || !sh.closedAt);
      } finally { _currentShiftView = prevView; }
    }
    try{ _recordJournalEntryIndependently(entry, o.from, 'writeoff'); }catch(e){}
    try{ stockApplyWriteoff(o.from, items); }catch(e){}
    try{ logAction(isWo?'WRITEOFF_LIST':'TRANSFER_OUT', {reason:reason, from:o.from, to:o.to, invNum:o.num, invId:invId, shiftId:o.shift?o.shift.id:(session&&session.shiftId), date:o.dateIso, itemCount:items.length, qty:o.totalQty, amount:o.totalAmt, bySeller:o.shift===null}); }catch(e){}
    _trRows = []; try{ localStorage.removeItem(_trDraftKey()); }catch(e){}
    closeMo('transferMo');
    try{ if(o.shift===null) renderAll(); else renderStockPage(); }catch(e){}
    showToast(isWo ? '✅ Списано из «'+o.from+'»: '+items.length+' поз.' : '✅ Списано из «'+o.from+'» и отправлено в «'+o.to+'»: '+items.length+' поз. — ждёт приёмки');
  }).catch(function(err){ showToast('❌ Накладная не отправилась — ничего не списано: '+(err&&err.message||err)); });
}


// ════ Правка накладной списания (админ) ════
// Номер, причина и позиции списания-накладной (перемещение, списание списком). Склад магазина
// пересчитывается: старые позиции возвращаются, новые списываются. У перемещения правится и
// накладная получателя — пока её не приняли; после приёмки менять позиции нельзя (у получателя
// товар уже на балансе), только номер. Открытая смена продавца подхватит правку по editedAt
// (см. mergeRemoteJournal).
var _woEd = null;
function adminEditWo(entryId, shiftId){
  showToast('⏳ Загружаю...');
  db.collection('iz_shifts').doc(shiftId).get({source:'server'}).then(function(snap){
    if(!snap.exists){ showToast('⚠️ Смена не найдена'); return; }
    var sh = snap.data(); sh.id = shiftId;
    var entry = (sh.journal||[]).find(function(e){ return e.id===entryId; });
    if(!entry || !(entry.items||[]).length){ showToast('⚠️ У записи нет позиций — правьте её в карточке смены'); return; }
    var kind = entry.transferInvId ? 'move' : 'wo';
    var st = {sh:sh, entryId:entryId, shop:sh.shopName, gt:entry.goodsType||'derevo',
      kind:kind, origKind:kind, to:entry.transferTo||'', origTo:entry.transferTo||'',
      num:entry.transferInvNum||entry.woInvNum||'', reason:entry.reason||((entry.items[0]||{}).reason)||'',
      rows:JSON.parse(JSON.stringify(entry.items)).map(function(it){ return {num:it.num||it.article||'', name:it.name||'', species:it.species||'', price:it.price||0, qty:it.qty||1}; }),
      isTransfer:!!entry.transferInvId, invLocked:false};
    var go = function(){ _woEd = st; _woEdRender(); openMo('woEditInvMo'); };
    if(!entry.transferInvId) return go();
    return db.collection('iz_invoices').doc(entry.transferInvId).get({source:'server'}).then(function(isnap){
      var inv = isnap.exists ? isnap.data() : null;
      st.invStatus = inv ? inv.status : null;
      st.invLocked = !!(inv && inv.status==='accepted');
      go();
    });
  }).catch(function(err){ showToast('❌ '+(err&&err.message||err)); });
}
function _woEdRender(){
  var st = _woEd, host = document.getElementById('woEdBody'); if(!st||!host) return;
  var esc = function(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); };
  var lock = st.invLocked;
  var inp = function(i,f,v,w,mode){
    var sugg = (f==='num'||f==='name'||f==='species');
    return '<input value="'+esc(v)+'"'+(lock?' disabled':'')+' onchange="_woEdEdit('+i+',\'' +f+'\',this.value)"'+
      (sugg&&!lock?' oninput="_woEdSugg('+i+',\''+f+'\',this.value)" onblur="_woEdHide('+i+')" autocomplete="off"':'')+
      (mode?' inputmode="'+mode+'"':'')+' style="width:'+w+';min-width:0;background:#22222e;border:1px solid #2e2e3e;border-radius:6px;color:#f0f0f8;font-size:11px;padding:5px">';
  };
  var q=0, sum=0; st.rows.forEach(function(r){ q+=r.qty||0; sum+=(r.qty||0)*(r.price||0); });
  var t = document.getElementById('woEdTitle'); if(t) t.textContent = '✏️ Накладная · '+st.shop;
  var isMove = st.kind==='move';
  var kbtn = function(k, label, color){ var on = st.kind===k;
    return '<button type="button"'+(lock?' disabled':'')+' onclick="_woEdSetKind(\''+k+'\')" style="flex:1;padding:8px;border-radius:9px;font-size:12px;font-weight:700;cursor:'+(lock?'default':'pointer')+';border:'+(on?'2px solid '+color:'1px solid #2e2e3e')+';background:'+(on?'#22222e':'none')+';color:'+(on?color:'#8888aa')+'">'+label+'</button>'; };
  var ws = _trWorkshopName();
  var dests = getShopNames().filter(function(sn){ return sn!==st.shop && sn!==ws; }).concat([ws]);
  host.innerHTML =
    '<div style="display:flex;gap:6px;margin-bottom:8px">'+kbtn('move','🚚 Перемещение','#60c8f0')+kbtn('wo','🗑 Списание','#f06060')+'</div>'+
    (isMove?'<div class="fg"><label class="fl">Куда</label><select class="fi" id="woEdTo"'+(lock?' disabled':'')+' onchange="_woEd.to=this.value">'+
      '<option value="">— выберите —</option>'+dests.map(function(sn){ return '<option value="'+esc(sn)+'"'+(sn===st.to?' selected':'')+'>'+(sn===ws?'🏭 ':'')+esc(sn)+'</option>'; }).join('')+'</select></div>':'')+
    (lock?'<div style="font-size:11px;color:#f0c060;background:#2e2414;border:1px solid #f0c06055;border-radius:8px;padding:8px;margin-bottom:8px">⚠️ Получатель уже принял эту накладную — вид, получателя и позиции менять нельзя (у него товар на балансе). Можно поправить номер и причину.</div>':'')+
    (st.origKind==='move'&&!isMove&&!lock?'<div style="font-size:11px;color:#f0c060;margin-bottom:8px">Накладная у получателя «'+esc(st.origTo)+'» будет отменена, товар останется списанным.</div>':'')+
    (st.origKind==='wo'&&isMove?'<div style="font-size:11px;color:#60c8f0;margin-bottom:8px">Получателю уйдёт накладная на приёмку.</div>':'')+
    '<div class="row2">'+
      '<div class="fg" style="flex:1"><label class="fl">№ накладной</label><input class="fi" id="woEdNum" value="'+esc(st.num)+'" oninput="_woEd.num=this.value"></div>'+
      '<div class="fg" style="flex:1'+(isMove?';display:none':'')+'"><label class="fl">Причина списания</label><input class="fi" id="woEdReason" placeholder="брак, бой, недостача" value="'+esc(st.reason)+'" oninput="_woEd.reason=this.value"></div>'+
    '</div>'+
    '<div id="woEdTotals" style="font-size:11.5px;font-weight:700;margin:4px 0">'+st.rows.length+' поз. · '+q+' шт. · '+fmt(sum)+'</div>'+
    '<div style="font-size:9.5px;color:#555568;margin-bottom:2px">№ · Название · Порода · Цена · Кол-во</div>'+
    st.rows.map(function(r,i){
      return '<div style="padding:5px 0;border-bottom:1px solid #22222e">'+
        '<div style="display:flex;gap:4px;align-items:center">'+
          inp(i,'num',r.num,'70px')+inp(i,'name',r.name,'auto;flex:1')+inp(i,'species',r.species,'70px')+
          inp(i,'price',r.price,'52px','numeric')+inp(i,'qty',r.qty,'36px','numeric')+
          (lock?'':'<button type="button" onclick="_woEd.rows.splice('+i+',1);_woEdRender()" style="background:none;border:none;color:#f06060;font-size:13px;cursor:pointer;padding:2px">✕</button>')+
        '</div>'+
        '<div id="woEdSugg_'+i+'" style="display:none;background:#1a1a22;border:1px solid #60c8f0;border-radius:8px;max-height:220px;overflow-y:auto;margin-top:4px"></div>'+
        '<div id="woEdRowSum_'+i+'" style="text-align:right;font-size:11px;font-weight:700;color:#c8f060;margin-top:2px">'+_rowSumTxt(r)+'</div>'+
      '</div>';
    }).join('')+
    (lock?'':'<button type="button" onclick="_woEd.rows.push({num:\'\',name:\'\',species:\'\',price:0,qty:1});_woEdRender()" style="width:100%;margin-top:8px;padding:8px;background:none;border:1px dashed #60c8f0;border-radius:8px;color:#60c8f0;font-size:11.5px;font-weight:700;cursor:pointer">➕ Строка</button>')+
    '<button class="btn" style="margin-top:10px" onclick="_woEdSave()">💾 Сохранить накладную</button>'+
    '<button class="btn sec" style="margin-top:8px" onclick="closeMo(\'woEditInvMo\')">Отмена</button>';
}
function _woEdSetKind(k){
  if(!_woEd || _woEd.invLocked) return;
  _woEd.num = (gv('woEdNum')||_woEd.num); _woEd.reason = (gv('woEdReason')||_woEd.reason);
  _woEd.kind = k==='wo' ? 'wo' : 'move';
  if(_woEd.kind==='wo' && /^(Перемещение в|Отгрузка на) «/.test(_woEd.reason||'')) _woEd.reason = '';
  if(_woEd.kind==='move' && !_woEd.to) _woEd.to = _woEd.origTo || '';
  _woEdRender();
}
function _woEdEdit(i, f, v){
  var r = _woEd && _woEd.rows[i]; if(!r) return;
  r[f] = (f==='price'||f==='qty') ? (_invImpNum(v)||0) : v;
  var el = document.getElementById('woEdRowSum_'+i); if(el) el.textContent = _rowSumTxt(r);
  var q=0, sum=0; _woEd.rows.forEach(function(x){ q+=x.qty||0; sum+=(x.qty||0)*(x.price||0); });
  var t = document.getElementById('woEdTotals'); if(t) t.textContent = _woEd.rows.length+' поз. · '+q+' шт. · '+fmt(sum);
}
var _woEdMatches = {}, _woEdHideT = {};
function _woEdSugg(i, field, val){
  if(_woEdHideT[i]){ clearTimeout(_woEdHideT[i]); delete _woEdHideT[i]; }
  var box = document.getElementById('woEdSugg_'+i); if(!box||!_woEd) return;
  var list;
  if(field==='species'){
    var words = String(val||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
    list = !words.length ? [] : getSpecies().filter(function(sp){ var l=String(sp).toLowerCase(); return words.every(function(w){ return l.indexOf(w)>=0; }); }).map(function(sp){ return {species:sp}; });
  } else list = _stockCatalogMatches(_woEd.shop, _woEd.gt, field, val);
  _woEdMatches[i] = {field:field, list:list};
  if(!list.length){ box.style.display='none'; return; }
  box.innerHTML = list.map(function(m,k){
    return '<div onclick="_woEdPick('+i+','+k+')" style="padding:8px 10px;font-size:11.5px;color:#f0f0f8;border-bottom:1px solid #2e2e3e;cursor:pointer">'+(field==='species'?String(m.species).replace(/</g,'&lt;'):_stockMatchLabel(m))+'</div>';
  }).join('');
  box.style.display='block';
}
function _woEdHide(i){ _woEdHideT[i] = setTimeout(function(){ var b=document.getElementById('woEdSugg_'+i); if(b) b.style.display='none'; }, 200); }
function _woEdPick(i, k){
  var r = _woEd && _woEd.rows[i], sm = _woEdMatches[i]; if(!r||!sm||!sm.list[k]) return;
  var m = sm.list[k];
  if(sm.field==='species') r.species = m.species;
  else { r.name = m.name; if(m.num) r.num = m.num; if(m.species) r.species = m.species; if(m.price) r.price = m.price; }
  _woEdRender();
}
function _woEdSave(){
  var st = _woEd; if(!st) return;
  st.num = (gv('woEdNum')||'').trim(); st.reason = (gv('woEdReason')||'').trim();
  if(st.kind==='move'){ st.to = gv('woEdTo') || st.to; }
  if(!st.rows.length){ showToast('⛔ Нет позиций — удалить накладную целиком можно в карточке смены'); return; }
  var bad = st.rows.findIndex(function(r){ return !String(r.name||'').trim() || !(r.qty>0); });
  if(bad>=0){ showToast('⛔ Строка '+(bad+1)+': нужно название и кол-во'); return; }
  if(st.kind==='move' && !st.to){ showToast('Выберите, куда перемещаете'); return; }
  if(st.kind==='move' && st.to===st.shop){ showToast('⛔ Получатель — тот же магазин'); return; }
  if(st.kind==='wo' && (!st.reason || /^(Перемещение в|Отгрузка на) «/.test(st.reason))){ showToast('Укажите причину списания (брак, бой и т.п.)'); return; }
  var sh = st.sh;
  var entry = (sh.journal||[]).find(function(e){ return e.id===st.entryId; }); if(!entry) return;
  var oldItems = entry.items||[];
  var reasonFor = function(){ return st.kind==='move' ? 'Перемещение в «'+st.to+'» · накл. '+st.num : st.reason; };
  var newItems = st.rows.map(function(r){
    var n = String(r.num||'').trim();
    return {num:n, article:n, name:String(r.name).trim(), species:String(r.species||'').trim(), price:r.price||0, qty:r.qty, amt:(r.price||0)*r.qty, goodsType:st.gt, reason:reasonFor(), isRevaluation:!!entry.isRevaluation};
  });
  var itemsChanged = JSON.stringify(oldItems.map(function(it){ return [it.num||it.article||'', it.name, it.species||'', it.price||0, it.qty||1]; })) !==
                     JSON.stringify(newItems.map(function(it){ return [it.num, it.name, it.species, it.price, it.qty]; }));
  var kindChanged = st.kind!==st.origKind;
  var destChanged = st.kind==='move' && st.origKind==='move' && st.to!==st.origTo;
  if(st.invLocked && (itemsChanged || kindChanged || destChanged)){ showToast('⛔ Накладная уже принята получателем — менять вид, получателя и позиции нельзя'); return; }
  var msg = 'Сохранить накладную'+(st.num?' '+st.num:'')+'?';
  if(itemsChanged) msg += '\nСклад «'+st.shop+'» пересчитается по новым позициям.';
  if(kindChanged && st.kind==='wo') msg += '\nНакладная у «'+st.origTo+'» будет отменена, товар останется списанным.';
  if(kindChanged && st.kind==='move') msg += '\nВ «'+st.to+'» уйдёт накладная на приёмку.';
  if(destChanged) msg += '\nПолучатель: «'+st.origTo+'» → «'+st.to+'».';
  if(!confirm(msg)) return;
  var total = newItems.reduce(function(s,it){ return s+it.amt; },0);
  var totalQty = newItems.reduce(function(s,it){ return s+it.qty; },0);
  var who = (session&&(session.name||session.sellerName))||'admin';
  var invItems = newItems.map(function(it){ return {num:it.num, article:it.article, name:it.name, species:it.species, price:it.price, qty:it.qty, goodsType:st.gt}; });
  // Перед записью смены — накладная получателя (как при внесении): новая при «списание → перемещение».
  var newInvId = (kindChanged && st.kind==='move') ? uid() : null;
  var pre = newInvId ? db.collection('iz_invoices').doc(newInvId).set({id:newInvId, num:st.num, date:sh.date, sourceName:st.shop, destName:st.to,
      status:'pending', goodsType:st.gt, items:invItems, total:total, isTransfer:true, transferFrom:st.shop, toWorkshop:st.to===_trWorkshopName(),
      createdBy:who, createdAt:new Date().toISOString()}) : Promise.resolve();
  pre.then(function(){
    var oldInvId = entry.transferInvId;
    var prevView = _currentShiftView;
    try{
      if(sh.status==='closed' && typeof _ensureGoodsEveningAnchor==='function') _ensureGoodsEveningAnchor(sh);
      entry.items = newItems;
      entry.amount = total;
      entry.goodsEffect = st.gt==='dr' ? 0 : -total;
      entry.goodsDrEffect = st.gt==='dr' ? -total : 0;
      entry.reason = reasonFor();
      if(st.kind==='move'){
        entry.icon = '🚚'; entry.label = 'Перемещение → '+st.to;
        entry.transferTo = st.to; entry.transferInvNum = st.num;
        if(newInvId) entry.transferInvId = newInvId;
        delete entry.woInvNum;
        entry.sub = newItems.length+' поз. ('+totalQty+' шт.) · накл. '+st.num;
      } else {
        entry.icon = '🗑️'; entry.label = 'Списание'; entry.woInvNum = st.num;
        if(kindChanged){ entry.cancelledTransferInvId = oldInvId; }
        delete entry.transferTo; delete entry.transferInvId; delete entry.transferInvNum;
        entry.sub = newItems.length+' поз. ('+totalQty+' шт.) · накл. '+st.num+' · '+st.reason;
      }
      entry.editedAt = new Date().toISOString(); entry.editedBy = who;
      _currentShiftView = sh;
      svPersist(sh.status==='open' || !sh.closedAt);
    } finally { _currentShiftView = prevView; }
    try{ _recordJournalEntryIndependently(entry, st.shop, 'writeoff'); }catch(e){}
    if(itemsChanged && !entry.isRevaluation){
      try{ stockApplyReceive(st.shop, oldItems.filter(function(it){ return !it.isRevaluation; }), null, st.gt, false); }catch(e){}
      try{ stockApplyWriteoff(st.shop, newItems); }catch(e){}
    }
    if(oldInvId && kindChanged && st.kind==='wo'){
      db.collection('iz_invoices').doc(oldInvId).set({status:'cancelled', cancelledAt:new Date().toISOString(), cancelledBy:who, cancelReason:'переделано в списание'}, {merge:true})
        .catch(function(err){ showToast('⚠️ Накладная у получателя не отменилась: '+(err&&err.message||err)); });
    } else if(oldInvId && st.kind==='move'){
      var patch = {num:st.num};
      if(!st.invLocked){ patch.items = invItems; patch.total = total; patch.destName = st.to; patch.toWorkshop = st.to===_trWorkshopName(); }
      db.collection('iz_invoices').doc(oldInvId).set(patch, {merge:true}).catch(function(err){ showToast('⚠️ Накладная получателя не обновилась: '+(err&&err.message||err)); });
    }
    try{ logAction('WRITEOFF_INVOICE_EDIT', {shop:st.shop, shiftId:sh.id, entryId:st.entryId, invNum:st.num, kind:st.kind, kindChanged:kindChanged, to:st.to, itemsChanged:itemsChanged, itemCount:newItems.length, amount:total}); }catch(e){}
    _woEd = null;
    closeMo('woEditInvMo');
    try{ renderAdminRcvWo(); }catch(e){}
    showToast('✅ Накладная сохранена');
  }).catch(function(err){ showToast('❌ Накладная получателя не создалась — ничего не изменено: '+(err&&err.message||err)); });
}


// ════ Одобрение заявки продавца на исправление входящей накладной ════
// Применяет предложенные номер/дату/позиции к накладной. У перемещения то же исправление
// уходит в списание у отправителя (позиции, сумма, № накладной) и пересчитывает его склад —
// иначе у отправителя списано одно, а у получателя принято другое.
function _applyInvoiceEditRequest(invId){
  var ref = db.collection('iz_invoices').doc(invId);
  return ref.get({source:'server'}).then(function(snap){
    if(!snap.exists) throw new Error('накладная не найдена');
    var inv = snap.data();
    var req = inv.editRequest;
    if(!req){ var e1 = new Error('заявка уже рассмотрена'); e1.alreadyResolved = true; throw e1; }
    if(inv.status==='accepted') throw new Error('накладная уже принята — правьте её через «✏️ Исправить»');
    var items = (req.items||[]).map(function(it){ return Object.assign({}, it, {goodsType:it.goodsType||inv.goodsType||'derevo'}); });
    var total = items.reduce(function(s,it){ return s+(it.price||0)*(it.qty||1); },0);
    var who = (session&&(session.name||session.sellerName))||'admin';
    return ref.update({num:req.num||inv.num, date:req.date||inv.date, items:items, total:total, editRequest:null,
      editApprovedAt:new Date().toISOString(), editApprovedBy:who, editRequestedBy:req.by||''}).then(function(){
      // Накладная уже исправлена — сбой при правке списания у отправителя не должен оставлять
      // заявку «висеть»: о нём отдельное сообщение, а результат одобрения — успех.
      if(inv.isTransfer && inv.sourceName){
        try{
          var p = _syncTransferWriteoff(invId, inv.sourceName, items, req.num||inv.num);
          if(p && p.catch) p.catch(function(err){ showToast('⚠️ Накладная исправлена, но списание у «'+inv.sourceName+'» не обновилось: '+(err&&err.message||err)); });
        }catch(err){ showToast('⚠️ Накладная исправлена, но списание у «'+inv.sourceName+'» не обновилось: '+(err&&err.message||err)); }
      }
    });
  });
}
function _syncTransferWriteoff(invId, fromShop, items, num){
  return db.collection('iz_shifts').where('shopName','==',fromShop).get({source:'server'}).then(function(snap){
    var sh = null, entry = null;
    snap.forEach(function(d){
      if(entry) return;
      var x = d.data(); var e = (x.journal||[]).find(function(j){ return j.transferInvId===invId; });
      if(e){ sh = x; sh.id = d.id; entry = e; }
    });
    if(!entry){ showToast('⚠️ Списание у «'+fromShop+'» по этой накладной не найдено — проверьте отправителя вручную'); return; }
    var oldItems = entry.items||[];
    var gt = entry.goodsType||'derevo';
    var newItems = items.map(function(it){ var n=String(it.num||it.article||'').trim();
      return {num:n, article:n, name:it.name, species:it.species||'', price:it.price||0, qty:it.qty||1, amt:(it.price||0)*(it.qty||1), goodsType:gt, reason:entry.reason||''}; });
    var total = newItems.reduce(function(s,it){ return s+it.amt; },0);
    var totalQty = newItems.reduce(function(s,it){ return s+it.qty; },0);
    var prevView = _currentShiftView;
    try{
      if(sh.status==='closed' && typeof _ensureGoodsEveningAnchor==='function') _ensureGoodsEveningAnchor(sh);
      entry.items = newItems; entry.amount = total;
      entry.goodsEffect = gt==='dr' ? 0 : -total; entry.goodsDrEffect = gt==='dr' ? -total : 0;
      entry.transferInvNum = num;
      entry.sub = newItems.length+' поз. ('+totalQty+' шт.) · накл. '+num;
      entry.editedAt = new Date().toISOString(); entry.editedBy = (session&&(session.name||session.sellerName))||'admin';
      _currentShiftView = sh;
      svPersist(sh.status==='open' || !sh.closedAt);
    } finally { _currentShiftView = prevView; }
    try{ _recordJournalEntryIndependently(entry, fromShop, 'writeoff'); }catch(e){}
    try{ stockApplyReceive(fromShop, oldItems, null, gt, false); }catch(e){}
    try{ stockApplyWriteoff(fromShop, newItems); }catch(e){}
  });
}
