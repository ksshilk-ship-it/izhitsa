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
    var closedShifts = allShifts.filter(function(s){ return s.status==='closed' && s.id!==session.shiftId; });
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
function saveWriteoff(){
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
  groups.forEach(function(g, idx){
    var total = g.items.reduce(function(s,it){ return s+(it.amt||0); },0);
    var totalQty = g.items.reduce(function(s,it){ return s+(it.qty||1); },0);
    var ts = new Date(baseTs+idx).toISOString();
    var namesPreview = g.items.map(function(it){ return it.name; }).join(', ');
    var sub = g.items.length===1
      ? ((g.items[0].num?'№'+g.items[0].num+' ':'')+g.items[0].name+(g.items[0].species?' · '+g.items[0].species:'')+(g.items[0].qty&&g.items[0].qty!==1?' × '+g.items[0].qty:'')+' · '+g.reason)
      : (g.items.length+' позиций ('+totalQty+' шт.): '+namesPreview+' · '+g.reason);
    var entry = {id:uid(),type:'writeoff',ts:ts,icon:'🗑️',label:'Списание',
      sub:sub,
      goodsType: g.isDr?'dr':'derevo', items: g.items,
      amount:total,amtCls:'exp',amtSign:'−',cashEffect:0,cardEffect:0,staffEffect:0,
      goodsEffect: g.isDr?0:-total, goodsDrEffect: g.isDr?-total:0};
    journal.push(entry);
    _recordJournalEntryIndependently(entry, session&&session.shopName, 'writeoff');
    _backupCheckPassed = false;
    g.items.forEach(function(it){ logWriteoff(it.reason, it.amt, session.shopName); });
  });
  var total = woItems.reduce(function(s,it){ return s+(it.amt||0); },0);
  var count = woItems.length;
  try{ var _woSh=session&&session.shopName; woItems.forEach(function(it){ if(it.num&&_woSh) stockUpdateQty(_woSh,it.num,it.name,it.price,it.species,it.goodsType,it.size,-(it.qty||1),null); }); }catch(e){}
  saveJ(); clearWoDraft(); resetWoForm();
  closeMo('woMo'); renderAll();
  showToast('🗑️ Списано '+count+(count===1?' позиция':' позиций')+' на '+fmt(total));
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
function saveReceive(){
  var name=gv('rcvName'),price=parseFloat(gv('rcvPrice'))||0;
  if(!name){showToast('Введите наименование');return;} if(!price){showToast('Введите цену');return;}
  var article=gv('rcvArticle');
  var rcvQtyNum=parseFloat(gv('rcvQty'))||1;
  var isDr = _rcvGoodsType === 'dr';
  var entry = {id:uid(),type:'receive',ts:_workingNowISO(),icon:'📥',
    label:'Приход '+(isDr?'ДР Товар':'товара'),
    sub:(article?'№'+article+' ':'')+name+(gv('rcvQty')?' · '+gv('rcvQty'):'')+' · '+gv('rcvFrom')+' · '+gv('rcvDate'),
    amount:price,amtCls:'neu',cashEffect:0,cardEffect:0,staffEffect:0,
    goodsEffect: isDr?0:price, goodsDrEffect: isDr?price:0,
    goodsType: _rcvGoodsType,
    article:article};
  journal.push(entry);
  _recordJournalEntryIndependently(entry, session&&session.shopName, 'receive');
  _backupCheckPassed = false;
  if(article){ try{ stockApplyReceive(session&&session.shopName,[{num:article,name:name,price:price,qty:rcvQtyNum,goodsType:_rcvGoodsType}],gv('rcvDate')||new Date().toISOString().split('T')[0]); }catch(e){} }
  saveJ(); ['rcvArticle','rcvName','rcvQty','rcvPrice','rcvFrom'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  logReceive(gv('rcvFrom'), price, session.shopName);
  var hint=document.getElementById('rcvLookupHint'); if(hint) hint.style.display='none';
  setRcvGoodsType('derevo'); // reset to Дерево
  closeMo('receiveMo'); renderAll(); showToast('📥 '+(isDr?'🛍 ДР Товар':'🌳 Дерево')+' принят: '+fmt(price));
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
          ${progress?`<div style="font-size:11px;color:#c8f060;margin-top:2px">⏸ Приёмка начата: отмечено ${checkedCount}/${inv.items.length}</div>`:''}</div>
        </div>
        <button class="btn" style="margin:0;margin-bottom:6px" onclick="openInvoice('${iid}')">📋 ${progress?'Продолжить приёмку':'Открыть и принять'}</button>
        <div class="u-flex-g6">
          <button onclick="editShopInvoice('${iid}')" style="flex:1;padding:7px;border-radius:8px;border:1px solid #2e2e3e;background:#22222e;color:#c8f060;font-size:11px;cursor:pointer">✏️ Исправить</button>
          <button onclick="deleteShopInvoice('${iid}')" style="padding:7px 12px;border-radius:8px;border:1px solid #3e2020;background:#2a1010;color:#f06060;font-size:11px;cursor:pointer">🗑 Удалить</button>
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
  var inv = getInvoices().find(function(i){ return String(i._id!=null?i._id:i.id)===id; });
  if(!inv) return;
  var card = document.getElementById('shinv_'+id); if(!card) return;
  window._shInvEdit[id] = JSON.parse(JSON.stringify(inv));
  window._shInvExpandedMap[id] = -1; // all collapsed by default
  card.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:#c8f060;margin-bottom:8px">✏️ Исправление: '+(inv.num||'')+'</div>'+
    '<div class="fg" style="margin-bottom:6px"><label class="fl">Номер</label><input class="fi" id="shinv_num_'+id+'" value="'+(inv.num||'')+'" style="margin:0;padding:7px"></div>'+
    '<div class="fg" style="margin-bottom:6px"><label class="fl">Дата</label><input class="fi" type="date" id="shinv_date_'+id+'" value="'+(inv.date||'')+'" style="margin:0;padding:7px;-webkit-appearance:none;color-scheme:dark"></div>'+
    '<div style="font-size:10px;color:#8888aa;margin-bottom:4px">ПОЗИЦИИ (арт. · наим. · кол-во · цена)</div>'+
    '<div id="shinv_items_'+id+'"></div>'+
    '<div style="display:flex;gap:6px;margin-top:8px">'+
      '<button onclick="saveShopInvoice(\''+id+'\')" style="flex:1;padding:8px;border-radius:8px;border:none;background:#c8f060;color:#0f0f13;font-size:12px;font-weight:700;cursor:pointer">💾 Сохранить</button>'+
      (inv.status==='accepted'
        ? '<button onclick="openRcvArchiveDate(\''+(inv.acceptedDate||inv.date||'—')+'\')" style="padding:8px 12px;border-radius:8px;border:1px solid #2e2e3e;background:none;color:#8888aa;font-size:12px;cursor:pointer">Отмена</button>'
        : '<button onclick="renderInvoices()" style="padding:8px 12px;border-radius:8px;border:1px solid #2e2e3e;background:none;color:#8888aa;font-size:12px;cursor:pointer">Отмена</button>')+
    '</div>';
  renderShInvItems(id);
}
function _shInvNum(id,i,v){ if(window._shInvEdit[id]&&window._shInvEdit[id].items[i]) window._shInvEdit[id].items[i].num=v; }
function _shInvName(id,i,v){ if(window._shInvEdit[id]&&window._shInvEdit[id].items[i]) window._shInvEdit[id].items[i].name=v; }
function _shInvQty(id,i,v){ if(window._shInvEdit[id]&&window._shInvEdit[id].items[i]) window._shInvEdit[id].items[i].qty=parseFloat(v)||1; }
function _shInvPrice(id,i,v){ if(window._shInvEdit[id]&&window._shInvEdit[id].items[i]) window._shInvEdit[id].items[i].price=parseFloat(v)||0; }
function saveShopInvoice(id){
  var data = window._shInvEdit[id]; if(!data) return;
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
      invCheckState: invCheckState, who: gv('invWho')||''
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
function openInvoice(invId){
  currentInvId=invId; const inv=getInvoices().find(i=>(i.id||i._id)===invId); if(!inv)return;
  _currentInvItems = inv.items;
  var saved = loadInvProgress(invId);
  invCheckState=inv.items.map(function(it,i){
    if(saved && saved.invCheckState && saved.invCheckState[i]){
      return {ok: !!saved.invCheckState[i].ok, factPrice: saved.invCheckState[i].factPrice!=null?saved.invCheckState[i].factPrice:it.price};
    }
    return {ok:false, factPrice:it.price};
  });
  document.getElementById('invMoTitle').textContent=inv.num;
  document.getElementById('invMoSub').textContent='Отгружено '+inv.date+' · '+inv.items.length+' изд.'+(saved?' · ⏸ продолжение приёмки':'');
  document.getElementById('invWho').value=(saved && saved.who) || (session&&session.sellerName)||'';
  document.getElementById('invMoItems').innerHTML=inv.items.map((item,i)=>`
    <div class="inv-row" id="invrow${i}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="flex:1"><div class="u-fs13-bold">№${item.num||'—'} ${item.name}${item.qty&&item.qty!==1?' × '+item.qty:''}</div>
        <div class="u-fs11-gray">По накладной: ${fmt(item.price)}</div></div>
        <div class="check-circle${invCheckState[i].ok?' checked':''}" id="invok${i}" onclick="toggleInvItem(${i})">${invCheckState[i].ok?'✓':''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="u-fs11-gray">Факт:</span>
        <input id="invfact${i}" type="text" value="${invCheckState[i].factPrice}" inputmode="numeric" oninput="checkInvDiff(${i},${item.price})"
          style="flex:1;padding:7px 10px;background:#0f0f13;border:1px solid ${Math.abs(invCheckState[i].factPrice-item.price)>0?'#f06060':'#2e2e3e'};border-radius:8px;color:${Math.abs(invCheckState[i].factPrice-item.price)>0?'#f06060':'#f0f0f8'};font-size:13px;outline:none;text-align:right"> ₽
      </div>
    </div>`).join('');
  updateInvMoTotal();
  openMo('invMo');
}
function updateInvMoTotal(){
  var totalAmt=0, totalQty=0, allQty=0;
  _currentInvItems.forEach(function(it,i){
    var q = it.qty||1;
    allQty += q;
    if(invCheckState[i] && invCheckState[i].ok){
      totalQty += q;
      totalAmt += (invCheckState[i].factPrice!=null?invCheckState[i].factPrice:it.price);
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
  const goodsTotal=accepted.reduce((s,a)=>s+a.factPrice,0);
  var _rcvEntry = {id:uid(),type:'receive',ts:_workingNowISO(),icon:'📥',label:'Приёмка '+inv2.num,
    sub:inv2.items.length+' изд. · принял: '+who,amount:goodsTotal,amtCls:'neu',cashEffect:0,cardEffect:0,staffEffect:0,goodsEffect:goodsTotal,
    invId:inv2.id||inv2._id};
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
  if(type!=='zp'&&type!=='travel'){
    _expPayMethod='cash';
    document.querySelectorAll('#expPayMethodChips .pc').forEach(function(p,i){ p.classList.toggle('active', i===0); });
  }
}
function saveExpense(){
  var amt = parseFloat((document.getElementById('expAmt')||{}).value)||0;
  if(!amt){showToast('Введите сумму');return;}
  var comment = (document.getElementById('expComment')||{}).value||'';
  var supplier = (document.getElementById('expSupplierName')||{}).value||'';
  var labels = {zp:'💰 ЗП',travel:'🚌 Проезд',inkass:'🏦 Инкассация',other:'📝 Прочее',supplier:'🏭 Поставщику'};
  var isStaff = expGoodsType==='staff';
  var label = labels[expType] + (expGoodsType==='dr'?' (ДР)':(isStaff?' (Покупки сотр.)':''));
  var isDr = expGoodsType==='dr';
  var isZpOrTravel = (expType==='zp'||expType==='travel');
  var payMethod = isZpOrTravel ? _expPayMethod : 'cash';
  var payMethodLabels = {cash:'💵 наличными',transfer:'🏦 переводом',other:'📝 иначе'};
  var _expEntry = {
    id:uid(), type:'expense', ts:_workingNowISO(),
    icon:'💸', label:'Расход: '+label,
    sub:fmt(amt)+(isZpOrTravel?' · '+payMethodLabels[payMethod]:'')+(supplier?' · '+supplier:'')+(comment?' · '+comment:''),
    expType, goodsType:expGoodsType, amount:amt, comment, supplier, payMethod,
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
  closeMo('expMo');
  renderAll();
  showToast('💸 Расход '+fmt(amt)+' записан');
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
              'onblur="psjHideSugg(\'manInvName_'+i+'\')" style="margin:0;padding:8px;flex:1">'+
            '<div id="manInvName_'+i+'_sugg" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:25;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;max-height:180px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:2px"></div>'+
            '<button type="button" onclick="openAddItemModal(\'manInvName_'+i+'\',\'\',\'\')" '+
              'style="background:#c8f060;border:none;border-radius:8px;padding:6px 9px;font-weight:700;color:#0f0f13;cursor:pointer;font-size:14px;flex-shrink:0">＋</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div class="fg" style="margin-bottom:6px;position:relative">'+
        '<div class="u-fs10-gray-mb3">ПОРОДА ДЕРЕВА</div>'+
        '<div class="u-flex-g6">'+
          '<input class="fi" id="manInvSpecies_'+i+'" value="'+(item.species||'')+'" placeholder="Порода" autocomplete="off" '+
            'oninput="_manInvSpeciesActive='+i+';_manInvSpecies('+i+',this.value);psjSuggest(\'manInvSpecies_'+i+'\',getSpecies(),\'_manInvPickSpeciesIdx\')" '+
            'onfocus="_manInvSpeciesActive='+i+';psjSuggest(\'manInvSpecies_'+i+'\',getSpecies(),\'_manInvPickSpeciesIdx\')" '+
            'onblur="psjHideSugg(\'manInvSpecies_'+i+'\')" style="margin:0;padding:8px;flex:1">'+
          '<button type="button" onclick="_manInvAddSpecies('+i+')" style="background:#22222e;border:1px solid #f0c060;border-radius:10px;padding:0 14px;color:#f0c060;font-weight:700;cursor:pointer;flex-shrink:0">＋</button>'+
        '</div>'+
        '<div id="manInvSpecies_'+i+'_sugg" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:20;background:#1a1a22;border:1px solid #2e2e3e;border-radius:8px;max-height:160px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:2px"></div>'+
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
}
function _manInvAddSpecies(i){
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
  window._manInvEdit[invId] = window._manInvEdit[invId]||{};
  window._manInvEdit[invId].goodsType = type;
  var btnD = document.getElementById('adminInvTypeDerevo_'+invId);
  var btnDr = document.getElementById('adminInvTypeDr_'+invId);
  if(btnD){ btnD.style.borderColor = type==='derevo'?'#c8f060':'#2e2e3e'; btnD.style.background = type==='derevo'?'#1e2a14':'#22222e'; btnD.style.color = type==='derevo'?'#c8f060':'#8888aa'; }
  if(btnDr){ btnDr.style.borderColor = type==='dr'?'#a060f0':'#2e2e3e'; btnDr.style.background = type==='dr'?'#1e1a2e':'#22222e'; btnDr.style.color = type==='dr'?'#a060f0':'#8888aa'; }
}
function setManInvType(type){
  _manInvGoodsType = type;
  var btnD = document.getElementById('manInvTypeDerevo');
  var btnDr = document.getElementById('manInvTypeDr');
  if(btnD){ btnD.style.borderColor = type==='derevo'?'#c8f060':'#2e2e3e'; btnD.style.background = type==='derevo'?'#1e2a14':'#22222e'; btnD.style.color = type==='derevo'?'#c8f060':'#8888aa'; }
  if(btnDr){ btnDr.style.borderColor = type==='dr'?'#a060f0':'#2e2e3e'; btnDr.style.background = type==='dr'?'#1e1a2e':'#22222e'; btnDr.style.color = type==='dr'?'#a060f0':'#8888aa'; }
}
function saveManualInvoice() {
  if(!_manInvItems.length) { showToast('Добавьте позиции'); return; }
  var num = (document.getElementById('manInvNum')||{}).value || 'НАК-???';
  var docDate = (document.getElementById('manInvDate')||{}).value || new Date().toISOString().split('T')[0];
  var from = (document.getElementById('manInvFrom')||{}).value || '';
  var totalAmt = _manInvItems.reduce(function(s,it){ return s+(it.qty||1)*(it.price||0); }, 0);
  if(from) saveSupplier(from);
  var now = new Date();
  var acceptedDateStr = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  var inv = {
    id: uid(), num: num, date: acceptedDateStr, docDate: docDate, from: from,
    destName: session.shopName,
    goodsType: _manInvGoodsType,
    items: _manInvItems.map(function(it){ return Object.assign({},it); }),
    totalAmt: totalAmt,
    status: 'accepted',
    acceptedAt: now.toISOString(),
    acceptedDate: now.toLocaleDateString('ru-RU'),
    createdBy: session.sellerName || session.name || '',
    manual: true
  };
  var existing = JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  existing.unshift(inv);
  localStorage.setItem('iz_manual_invoices', JSON.stringify(existing));
  db.collection('iz_manual_invoices').doc(inv.id).set(inv).catch(function(e){
    console.log('[saveManualInvoice] ошибка сохранения в облако:', e);
    _queuePendingInvoice('iz_manual_invoices', inv);
    showToast('⚠️ Накладная сохранена только на телефоне — досошлётся автоматически, когда появится связь');
  });
  var _gt4save = _manInvGoodsType || 'derevo';
  _manInvItems.forEach(function(item){
    autoSaveToItemBase(item.name, item.article, item.price, _gt4save);
  });
  var _isDrInv = _manInvGoodsType === 'dr';
  journal.push({
    id:uid(), type:'receive', ts:_workingNowISO(), icon:'📥',
    label:'Приёмка '+num+(_isDrInv?' (ДР)':''),
    sub:_manInvItems.length+' изд.'+(from?' · от '+from:''),
    amount:totalAmt,
    amtCls:'neu', cashEffect:0, cardEffect:0, staffEffect:0,
    goodsEffect: _isDrInv ? 0 : totalAmt,
    goodsDrEffect: _isDrInv ? totalAmt : 0,
    goodsType: _manInvGoodsType,
    invId:inv.id
  });
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
  showToast('✅ Накладная '+num+' принята на баланс');
}
window._manInvEdit = window._manInvEdit || {};
function editManualInvoice(id){
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
  if(!window._manInvEdit[id]) return;
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
function _manInvNameOptions(){ return getItemsBase().map(function(it){ return it.name; }).filter(Boolean); }
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
            'oninput="_manInvEditActive={id:\''+id+'\',i:'+i+'};_manInvEditName(\''+id+'\','+i+',this.value);psjSuggest(\''+nameId+'\',_manInvNameOptions(),\'_manInvEditPickNameIdx\')" '+
            'onfocus="_manInvEditActive={id:\''+id+'\',i:'+i+'};psjSuggest(\''+nameId+'\',_manInvNameOptions(),\'_manInvEditPickNameIdx\')" '+
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
          '<button type="button" onclick="_manInvEditAddSpecies(\''+id+'\','+i+')" style="background:#22222e;border:1px solid #f0c060;border-radius:8px;padding:0 12px;color:#f0c060;font-weight:700;cursor:pointer;flex-shrink:0">＋</button>'+
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
function _manInvEditPickNameIdx(val){
  var id=_manInvEditActive.id, i=_manInvEditActive.i;
  if(id==null||i==null) return;
  var el = document.getElementById('maninv_name_'+id+'_'+i);
  if(el) el.value = val;
  if(window._manInvEdit[id] && window._manInvEdit[id].items[i]) window._manInvEdit[id].items[i].name = val;
  var box = document.getElementById('maninv_name_'+id+'_'+i+'_sugg');
  if(box) box.style.display='none';
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
  var el = document.getElementById('maninv_species_'+id+'_'+i);
  var val = (el && el.value || '').trim();
  if(!val){ showToast('Введите породу'); return; }
  var before = getSpecies().length;
  saveSpecies(val);
  if(getSpecies().length>before) showToast('✅ Добавлено в породы дерева: '+val);
  else showToast('Уже есть в породах дерева');
}
function saveManualInvoiceEdit(id){
  var data = window._manInvEdit[id]; if(!data) return;
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
  journal.push({
    id:uid(), type:'receive', ts:preservedTs, icon:'📥',
    label:'Приёмка '+data.num+(_isDrSeller?' (ДР)':''),
    sub:(data.items||[]).length+' изд.'+(data.from?' · от '+data.from:''),
    amount:data.totalAmt,
    amtCls:'neu', cashEffect:0, cardEffect:0, staffEffect:0,
    goodsType:_sellerGt,
    goodsEffect:_isDrSeller?0:data.totalAmt,
    goodsDrEffect:_isDrSeller?data.totalAmt:0,
    invId:id, editedAt:new Date().toISOString()
  });
  saveJ();
  delete window._manInvEdit[id];
  renderAll(); renderReceiveArchive();
  showToast('✅ Накладная исправлена');
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
  renderAdminRcvWo();
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
function adminOpenInvoiceFromList(invId, shiftId){
  if(shiftId){
    var shifts = getShifts();
    var sh = shifts.find(function(s){ return (s.id||s._id)===shiftId; });
    if(sh) _currentShiftView = sh;
    else { showToast('⚠️ Смена этой накладной не найдена локально — нажми ☁️ Синх и попробуй снова'); return; }
  }
  svOpenInvoiceFromReceive(invId);
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
  var allShifts = JSON.parse(localStorage.getItem('iz_shifts')||'[]');
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
      var amt = type==='receive' ? (e.goodsDrEffect && e.goodsType==='dr' ? e.goodsDrEffect : (e.goodsEffect||e.amount||0)) : (e.amount||0);
      var invNum = '';
      if(e.invId){
        var found = allInvCache.find(function(i){ return (i.id||i._id)===e.invId; });
        if(found&&found.num) invNum = found.num;
      }
      rows.push({shop:sn, date:shDate, ts:e.ts||shDate, label:invNum?'Приёмка '+invNum:(e.label||e.sub||''), sub:e.sub||'', amount:amt, goodsType:e.goodsType||'derevo', invId:e.invId||null, entryId:e.id||null, shiftId:sh.id||sh._id||null, items:e.items||[], reason:e.reason||''});
    });
    if(type==='receive'){
      (sh.goodsReceives||[]).forEach(function(r){ rows.push({shop:sn,date:shDate,ts:shDate,label:'Приход Дерево',sub:r.name||'',amount:r.amt||r.amount||0,goodsType:'derevo',items:[]}); });
      (sh.drGoodsReceives||[]).forEach(function(r){ rows.push({shop:sn,date:shDate,ts:shDate,label:'Приход ДР',sub:r.name||'',amount:r.amt||r.amount||0,goodsType:'dr',items:[]}); });
    }
  });
  rows.sort(function(a,b){ return (b.ts||b.date).localeCompare(a.ts||a.date); });
  window._adminRcvRowsByInv = {};
  rows.forEach(function(r){ if(r.invId) window._adminRcvRowsByInv[r.invId] = r; });
  var totalWood=0, totalDr=0;
  rows.forEach(function(r){ if(r.goodsType==='dr') totalDr+=r.amount; else totalWood+=r.amount; });
  var sumEl=document.getElementById('adminRcvSummary');
  if(sumEl){
    sumEl.innerHTML='<div style="display:flex;gap:8px;margin-bottom:4px">'+
      '<div style="background:#1a2e1e;border:1px solid #2e4e2e;border-radius:10px;padding:8px 12px;flex:1"><div class="u-fs10-gray">🌳 Дерево</div><div style="font-size:15px;font-weight:700;color:#c8f060">'+Math.round(totalWood).toLocaleString('ru-RU')+'₽</div></div>'+
      '<div style="background:#1e1a2e;border:1px solid #3e2e4e;border-radius:10px;padding:8px 12px;flex:1"><div class="u-fs10-gray">🛍 ДР Товар</div><div style="font-size:15px;font-weight:700;color:#a060f0">'+Math.round(totalDr).toLocaleString('ru-RU')+'₽</div></div>'+
      '<div style="background:#1a1a22;border:1px solid #2e2e3e;border-radius:10px;padding:8px 12px;flex:1"><div class="u-fs10-gray">Итого</div><div style="font-size:15px;font-weight:700;color:#f0f0f8">'+Math.round(totalWood+totalDr).toLocaleString('ru-RU')+'₽</div></div>'+
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
    return '<div style="background:#13131a;border:1px solid #2a2a3a;border-radius:10px;padding:10px 12px;margin-bottom:6px">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div style="flex:1">'+
          '<div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">'+
            '<span style="font-size:10px;font-weight:700;color:'+gtColor+'">'+gtLabel+'</span>'+
            '<span class="u-fs10-gray">'+r.shop+'</span>'+
            (timeStr?'<span style="font-size:10px;color:#606080">· '+timeStr+'</span>':'')+
          '</div>'+
          '<div class="u-fs13-bold">'+r.label+'</div>'+
          (r.sub&&r.sub!==r.label?'<div class="u-fs11-gray">'+r.sub+'</div>':'')+
          (r.reason?'<div style="font-size:11px;color:#a060f0">'+r.reason+'</div>':'')+
        '</div>'+
        '<div style="text-align:right;padding-left:10px;flex-shrink:0">'+
          '<div style="font-size:15px;font-weight:700;color:'+gtColor+'">'+Math.round(r.amount).toLocaleString('ru-RU')+'₽</div>'+
        '</div>'+
      '</div>'+
      (r.invId?'<button type="button" onclick="adminOpenInvoiceFromList(\''+r.invId+'\',\''+(r.shiftId||'')+'\')" style="font-size:11px;padding:3px 9px;background:#22222e;border:1px solid #2e2e3e;border-radius:6px;color:#60c8f0;cursor:pointer;margin-top:5px;margin-right:6px">📋 Открыть накладную</button>':'')+
      (r.entryId&&r.shiftId?'<button type="button" onclick="adminToggleMoveDate(this,\''+r.entryId+'\',\''+r.shiftId+'\',\''+r.shop.replace(/'/g,"\\'")+'\')" style="font-size:11px;padding:3px 9px;background:#22222e;border:1px solid #2e2e3e;border-radius:6px;color:#f0a060;cursor:pointer;margin-top:5px">📅 Изменить дату прихода</button>':'')+
    '</div>';
  }
  function groupHeader(key, label, count, total, isOpen){
    var totalStr = Math.round(total).toLocaleString('ru-RU')+'₽';
    return '<div onpointerdown="event.preventDefault();adminRcvToggle(\''+key+'\')" '+
      'style="background:#1a1a22;border:1px solid #3e3e4e;border-radius:12px;padding:10px 14px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;cursor:pointer">'+
      '<div>'+
        '<div class="u-fs13-bold">'+label+'</div>'+
        '<div class="u-fs11-gray">'+count+' накладных · '+totalStr+'</div>'+
      '</div>'+
      '<div style="font-size:16px;color:#c8f060">'+(isOpen?'▲':'▼')+'</div>'+
    '</div>';
  }
  var html = '';
  if(groupByMonth){
    var byMonth = {};
    rows.forEach(function(r){
      var mm = r.date.slice(0,7); // yyyy-mm
      if(!byMonth[mm]) byMonth[mm]={rows:[],total:0,count:0};
      byMonth[mm].rows.push(r); byMonth[mm].total+=r.amount; byMonth[mm].count++;
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
      html+=groupHeader('m_'+mm,mLabel,mData.count,mData.total,mOpen);
      if(mOpen){
        var byDay={};
        mData.rows.forEach(function(r){ var d=r.date; if(!byDay[d]) byDay[d]={rows:[],total:0,count:0}; byDay[d].rows.push(r); byDay[d].total+=r.amount; byDay[d].count++; });
        var days=Object.keys(byDay).sort().reverse();
        days.forEach(function(d){
          var dData=byDay[d]; var parts=d.split('-');
          var dLabel=parts[2]+'.'+parts[1]+'.'+parts[0];
          var dKey='d_'+d; var dOpen=!!_adminRcvOpen[dKey];
          html+='<div style="margin-left:12px">';
          html+=groupHeader(dKey,dLabel,dData.count,dData.total,dOpen);
          if(dOpen){ html+='<div style="margin-left:12px">'; dData.rows.forEach(function(r){ html+=rowCard(r); }); html+='</div>'; }
          html+='</div>';
        });
      }
    });
  } else {
    var byDay2={};
    rows.forEach(function(r){ var d=r.date; if(!byDay2[d]) byDay2[d]={rows:[],total:0,count:0}; byDay2[d].rows.push(r); byDay2[d].total+=r.amount; byDay2[d].count++; });
    var days2=Object.keys(byDay2).sort().reverse();
    days2.forEach(function(d){
      var dData=byDay2[d]; var parts=d.split('-');
      var dLabel=parts[2]+'.'+parts[1]+'.'+parts[0];
      var dKey='d2_'+d; var dOpen=!!_adminRcvOpen[dKey];
      if(days2.length===1 && _adminRcvPeriod==='today'){
        dData.rows.forEach(function(r){ html+=rowCard(r); });
      } else {
        html+=groupHeader(dKey,dLabel,dData.count,dData.total,dOpen);
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
  localStorage.setItem('iz_stock',JSON.stringify(stock));
  var shops=Object.keys(stock);
  shops.forEach(function(sn){
    try{ db.collection('iz_settings').doc('stock_'+sn.replace(/\s+/g,'_')).set({items:stock[sn],updatedAt:new Date().toISOString()},{merge:true}); }catch(e){}
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
function stockApplyReceive(shopName,items,date,invGoodsType){
  if(!shopName) return;
  items.forEach(function(it){
    var gt=it.goodsType||(it.category==='dr'?'dr':(invGoodsType||'derevo'));
    var artNum=it.article||it.num||it.artNum;
    var pr=it.price||it.factPrice||0;
    if(!artNum) artNum=_noArticleStockKey(it.name,pr,it.species,gt);
    if(!artNum) return;
    stockUpdateQty(shopName,artNum,it.name,pr,it.species,gt,it.size||'',(it.qty||1),date);
  });
}
function rebuildStock(showMsg){
  var stock={};
  var shops=getShopNames();
  shops.forEach(function(sn){ stock[sn]={}; });
  var manInvs=JSON.parse(localStorage.getItem('iz_manual_invoices')||'[]');
  manInvs.forEach(function(inv){
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
      var qty=it.qty||1;
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
        var rcvArt = e.article||(e.items&&e.items[0]&&(e.items[0].article||e.items[0].num));
        var rcvGt = e.goodsType||'derevo';
        if(!rcvArt && e.items && e.items[0]){
          rcvArt = _noArticleStockKey(e.items[0].name||e.name, e.items[0].price||e.amount, e.items[0].species, rcvGt);
        }
        if(rcvArt){
          var key=String(rcvArt);
          if(!stock[sn][key]) stock[sn][key]={num:key,name:e.name||'',price:e.amount||0,species:'',goodsType:rcvGt,size:'',qty:0,lastReceived:''};
          stock[sn][key].qty+=1;
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
      return '<div style="border:1px solid #2e2e3e;border-radius:12px;margin-bottom:8px;overflow:hidden">'+
        '<div onclick="_toggleStockGroup(\''+ikey+'\')" style="display:flex;justify-content:space-between;align-items:center;padding:12px;cursor:pointer;background:#1a1a22">'+
          '<div><div class="u-fs13-bold">'+(inv.num?'№'+inv.num+' · ':'')+(inv.date||'')+'</div>'+
            '<div class="u-fs10-gray">'+shopName+(inv.from?' · от '+inv.from:'')+' · '+items.length+' поз.</div></div>'+
          '<div style="display:flex;align-items:center;gap:8px">'+
            '<div class="u-fs11-gray">🟢'+stillHave+' 🔴'+soldOut+'</div>'+
            '<span id="'+ikey+'_arr" style="color:#8888aa">▶</span>'+
          '</div>'+
        '</div>'+
        '<div id="'+ikey+'" style="display:none;padding:0 12px 12px">'+rows+'</div>'+
      '</div>';
    }).join('');
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
