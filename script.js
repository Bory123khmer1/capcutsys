let accounts = JSON.parse(localStorage.getItem('acc_mgr_v2') || '[]');

// Migrate old accounts
accounts = accounts.map(a => ({
  sold: false, username: '', phone: '', twofa: '', url: '', ...a
}));

let editId = null;
let filter = 'all';
let currentMode = 'stock';
let modalIsSold = false;
const EXPIRING_DAYS = 10;
const IMPORTABLE_KEYS = ['accId','name','cat','tags','mail','username','phone','pw','twofa','url','buy','exp','note','saved','sold','buyer','salePrice','saleDate','saleNote'];

/* ===== Category Colors ===== */
const CAT_COLORS = [
  '#e05c5c','#e0875c','#d4a017','#6ab04c',
  '#1abc9c','#3498db','#8e44ad','#e91e8c',
  '#607d8b','#795548'
];
let catColors = JSON.parse(localStorage.getItem('acc_cat_colors') || '{}');
let selectedColor = CAT_COLORS[0];
let bulkMode = false;
let selectedIds = new Set();
let reminderDismissed = false;

function persistColors(){ localStorage.setItem('acc_cat_colors', JSON.stringify(catColors)); }
function getCatColor(cat){
  if(!cat) return '#888';
  if(catColors[cat]) return catColors[cat];
  let h = 0;
  for(let c of cat) h = (h * 31 + c.charCodeAt(0)) % CAT_COLORS.length;
  return CAT_COLORS[h];
}
function renderSwatches(activeCat){
  const wrap = document.getElementById('color-swatches');
  if(!wrap) return;
  const current = activeCat ? (catColors[activeCat] || getCatColor(activeCat)) : selectedColor;
  wrap.innerHTML = CAT_COLORS.map(c =>
    `<div class="swatch${c===current?' selected':''}" style="background:${c}" onclick="selectSwatch('${c}',this)" title="${c}"></div>`
  ).join('');
  selectedColor = current;
}
function selectSwatch(color, el){
  selectedColor = color;
  document.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
}
function syncSwatches(){ renderSwatches(document.getElementById('f-cat').value.trim()); }

function persist(){ localStorage.setItem('acc_mgr_v2', JSON.stringify(accounts)); }
function uid(){ return 'ACC-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,8).toUpperCase(); }
function daysLeft(exp){
  if(!exp) return null;
  return Math.ceil((new Date(exp) - new Date()) / 86400000);
}
function getStatus(exp){
  if(!exp) return 'ok';
  const d = daysLeft(exp);
  if(d < 0) return 'expired';
  if(d <= EXPIRING_DAYS) return 'soon';
  return 'ok';
}
function fmtDate(d){
  if(!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
}
function escHtml(s){
  return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function statusLabel(s){
  return {ok:'Active',soon:`Expiring ≤${EXPIRING_DAYS}d`,expired:'Expired'}[s];
}
function toast(msg, type=''){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type?' toast-'+type:'');
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(()=>el.classList.remove('show'), 2600);
}

/* ===== Search clear ===== */
function clearSearch(){
  document.getElementById('search').value = '';
  render();
}

/* ===== Mode toggle ===== */
function setMode(mode){
  currentMode = mode;
  document.getElementById('mode-stock').classList.toggle('active', mode==='stock');
  document.getElementById('mode-sold').classList.toggle('active', mode==='sold');
  document.getElementById('status-tabs').style.display = '';
  filter = 'all';
  if(bulkMode) exitBulkMode();
  syncActiveFilterUI();
  render();
}
function syncActiveFilterUI(){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  const activeTab = document.querySelector(`.tab[data-filter="${filter}"]`);
  if(activeTab) activeTab.classList.add('active');
  document.querySelectorAll('.stat.clickable').forEach(s=>s.classList.remove('active'));
  const activeStat = document.querySelector(`.stat.clickable[data-filter="${filter}"]`);
  if(activeStat) activeStat.classList.add('active');
}
function setFilter(btn, f){ filter = f; syncActiveFilterUI(); render(); }
function setFilterDirect(f){ filter = f; syncActiveFilterUI(); render(); }

/* ===== Modal sold toggle ===== */
function setModalSold(isSold){
  modalIsSold = isSold;
  document.getElementById('st-stock').classList.toggle('active', !isSold);
  document.getElementById('st-sold').classList.toggle('active', isSold);
  document.getElementById('sold-info').style.display = isSold ? '' : 'none';
}

/* ===== Export ===== */
function toggleExport(e){
  e.stopPropagation();
  document.getElementById('export-menu').classList.toggle('open');
}
document.addEventListener('click', ()=>{
  const menu = document.getElementById('export-menu');
  if(menu) menu.classList.remove('open');
});
function exportFile(type){
  document.getElementById('export-menu').classList.remove('open');
  if(!accounts.length){ toast('No accounts to export.'); return; }
  let content, mime, ext;
  if(type==='json'){
    content = JSON.stringify(accounts, null, 2);
    mime = 'application/json'; ext = 'json';
  } else {
    const cols = ['accId','name','cat','tags','mail','username','phone','buy','exp','note','saved','sold','buyer','salePrice','saleDate','saleNote'];
    const rows = accounts.map(a => cols.map(k => {
      let v = k==='tags' ? (a.tags||[]).join('; ') : (a[k]||'');
      v = String(v).replace(/"/g,'""');
      return `"${v}"`;
    }).join(','));
    content = [cols.join(','), ...rows].join('\n');
    mime = 'text/csv'; ext = 'csv';
  }
  const blob = new Blob([content],{type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `accounts-${Date.now()}.${ext}`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  toast(`Exported as ${ext.toUpperCase()}.`);
}

/* ===== Backup / Restore ===== */
function backupData(){
  document.getElementById('export-menu').classList.remove('open');
  const backup = {
    version: 2,
    createdAt: new Date().toISOString(),
    accounts,
    catColors
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0,10);
  a.href = url; a.download = `acc-backup-${dateStr}.json`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  localStorage.setItem('acc_last_backup', new Date().toISOString());
  toast('Backup saved!');
}
function triggerRestore(){
  document.getElementById('export-menu').classList.remove('open');
  document.getElementById('restore-file').click();
}
document.getElementById('restore-file').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      let restored = [];
      let colors = {};
      if(data.version && Array.isArray(data.accounts)){
        restored = data.accounts;
        colors = data.catColors || {};
      } else if(Array.isArray(data)){
        restored = data;
      } else {
        toast('Invalid backup file.'); return;
      }
      if(!confirm(`Restore ${restored.length} accounts? This will REPLACE all current data.`)) return;
      accounts = restored.map(a => ({sold:false, username:'', phone:'', twofa:'', url:'', ...a}));
      catColors = colors;
      persistColors(); persist(); render();
      toast(`Restored ${accounts.length} accounts.`);
    } catch(err){ toast('Restore failed. Invalid file.'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ===== Import ===== */
function triggerImport(){ triggerImportAs('stock'); }
function isRawCredentialFormat(headers){
  const h = headers.map(x=>x.toLowerCase().replace(/\s+/g,' ').trim());
  const hasEmail = h.some(x=>x.includes('user id') || x.includes('email address') || x.includes('email'));
  const hasId = h.some(x=>x==='id' || x.includes('uuid'));
  const hasPassword = h.some(x=>x.includes('password') || x==='pw');
  return hasEmail && hasPassword && (hasId || h[0]==='id');
}
function normalizeRawCredential(raw, forceSold){
  let mail='', pw='', accId='', price='';
  for(const [k, v] of Object.entries(raw)){
    const kl = k.toLowerCase().replace(/\s+/g,' ').trim();
    const val = String(v || '').trim();
    if(kl === 'id' || kl.includes('uuid')) accId = val;
    else if(kl.includes('user id / email address') || kl.includes('email address') || kl.includes('user id') || kl.includes('email')) mail = val.replace(/^'+/,'').replace(/^email:\s*/i,'').trim();
    else if(kl.includes('password') || kl === 'pw') pw = val;
    else if(kl.includes('sale price') || kl.includes('price')) price = val;
  }
  if(!mail) return null;
  const today = new Date().toISOString().slice(0,10);
  return {
    id: uid(), accId: accId || uid(),
    name: mail.split('@')[0] || 'Account',
    mail, pw, cat:'', tags:[], username:'', phone:'', twofa:'', url:'',
    buy:'', exp:'', note:'',
    saved: new Date().toISOString(),
    sold: forceSold === true,
    buyer:'', salePrice: price || '', saleDate: forceSold ? today : '', saleNote:''
  };
}
function normalizeImportedAccount(raw){
  const tags = Array.isArray(raw.tags) ? raw.tags : String(raw.tags||'').split(/[;,]/).map(t=>t.trim()).filter(Boolean);
  const cat = String(raw.cat||raw.category||'').trim();
  const saved = String(raw.saved||'').trim();
  const normalized = {
    id: String(raw.id||uid()).trim(),
    accId: String(raw.accId||raw.accountId||raw.accountID||'').trim()||uid(),
    name: String(raw.name||raw.account||'').trim(),
    mail: String(raw.mail||raw.email||'').trim(),
    pw: String(raw.pw||raw.password||''),
    username: String(raw.username||'').trim(),
    phone: String(raw.phone||'').trim(),
    twofa: String(raw.twofa||raw['2fa']||'').trim(),
    url: String(raw.url||raw.loginUrl||'').trim(),
    cat, tags,
    buy: String(raw.buy||raw.purchaseDate||raw.datePurchased||'').trim(),
    exp: String(raw.exp||raw.expiryDate||raw.expirationDate||'').trim(),
    note: String(raw.note||raw.notes||'').trim(),
    saved: saved||new Date().toISOString(),
    sold: raw.sold === true || raw.sold === 'true',
    buyer: String(raw.buyer||'').trim(),
    salePrice: String(raw.salePrice||'').trim(),
    saleDate: String(raw.saleDate||'').trim(),
    saleNote: String(raw.saleNote||'').trim()
  };
  if(!normalized.name||!normalized.mail) return null;
  if(cat&&!catColors[cat]) catColors[cat] = getCatColor(cat);
  return normalized;
}
function parseCsvRow(line){
  const out=[]; let cur=''; let quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i]; const next=line[i+1];
    if(ch==='"'){ if(quoted&&next==='"'){cur+='"';i++;} else { quoted=!quoted; } }
    else if(ch===','&&!quoted){out.push(cur);cur='';}
    else {cur+=ch;}
  }
  out.push(cur);
  return out.map(v=>v.trim());
}
function parseCsv(text){
  const lines = text.split(/\r?\n/).filter(l=>l.trim());
  if(lines.length<2) return [];
  const headers = parseCsvRow(lines[0]).map(h=>h.replace(/^"|"$/g,'').trim());
  return lines.slice(1).map(line=>{
    const cols = parseCsvRow(line).map(v=>v.replace(/^"|"$/g,''));
    const row={};
    headers.forEach((h,i)=>row[h]=cols[i]||'');
    return row;
  });
}
function mergeImportedAccounts(items){
  let created=0, updated=0;
  items.forEach(item=>{
    const idx=accounts.findIndex(a=>a.id===item.id||a.accId===item.accId);
    if(idx>=0){accounts[idx]={...accounts[idx],...item};updated++;}
    else{accounts.unshift(item);created++;}
  });
  persistColors(); persist(); render();
  toast(`Import complete: ${created} added, ${updated} updated.`);
}
let pendingImportMode = null;
function triggerImportAs(mode){
  document.getElementById('export-menu').classList.remove('open');
  pendingImportMode = mode;
  document.getElementById('import-file').click();
}
function importFileFromInput(file){
  if(!file) return;
  const forceSold = pendingImportMode === 'sold';
  pendingImportMode = null;
  const reader=new FileReader();
  reader.onload=()=>{
    try {
      const text=String(reader.result||'');
      let normalized;
      if(file.name.toLowerCase().endsWith('.json')){
        const parsed=JSON.parse(text);
        const rows=Array.isArray(parsed)?parsed:[parsed];
        normalized=rows.map(r=>{ const acc=normalizeImportedAccount(r); if(acc&&forceSold) acc.sold=true; return acc; }).filter(Boolean);
      } else {
        const rows=parseCsv(text);
        if(!rows.length){toast('No valid accounts found in file.');return;}
        const headers=Object.keys(rows[0]);
        if(isRawCredentialFormat(headers)){
          normalized=rows.map(r=>normalizeRawCredential(r,forceSold)).filter(Boolean);
        } else {
          normalized=rows.map(r=>{ const acc=normalizeImportedAccount(r); if(acc&&forceSold) acc.sold=true; return acc; }).filter(Boolean);
        }
      }
      if(!normalized||!normalized.length){toast('No valid accounts found in file.');return;}
      mergeImportedAccounts(normalized);
      if(forceSold) setMode('sold'); else setMode('stock');
    } catch(err){console.error(err);toast('Import failed. Check the file format.');}
  };
  reader.readAsText(file);
}

/* ===== Sort ===== */
function sortAccounts(list){
  const s=document.getElementById('sort-select').value;
  return [...list].sort((a,b)=>{
    if(s==='name-asc') return a.name.localeCompare(b.name);
    if(s==='name-desc') return b.name.localeCompare(a.name);
    if(s==='expiry-asc'){ if(!a.exp&&!b.exp) return 0; if(!a.exp) return 1; if(!b.exp) return -1; return a.exp.localeCompare(b.exp); }
    if(s==='expiry-desc'){ if(!a.exp&&!b.exp) return 0; if(!a.exp) return 1; if(!b.exp) return -1; return b.exp.localeCompare(a.exp); }
    if(s==='date-asc') return a.saved.localeCompare(b.saved);
    return b.saved.localeCompare(a.saved);
  });
}

/* ===== Bulk Select ===== */
function toggleBulkMode(){ bulkMode = !bulkMode; if(!bulkMode) selectedIds.clear(); render(); }
function exitBulkMode(){ bulkMode = false; selectedIds.clear(); render(); }
function toggleSelectCard(id){
  if(selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if(card){ card.classList.toggle('selected', selectedIds.has(id)); const cb = card.querySelector('.bulk-cb'); if(cb) cb.checked = selectedIds.has(id); }
  updateBulkBar();
}
function selectAllVisible(){
  const cards = document.querySelectorAll('.card[data-id]');
  const allSelected = cards.length > 0 && [...cards].every(c => selectedIds.has(c.dataset.id));
  cards.forEach(c => {
    if(allSelected) selectedIds.delete(c.dataset.id);
    else selectedIds.add(c.dataset.id);
    c.classList.toggle('selected', selectedIds.has(c.dataset.id));
    const cb = c.querySelector('.bulk-cb');
    if(cb) cb.checked = selectedIds.has(c.dataset.id);
  });
  updateBulkBar();
}
function updateBulkBar(){
  const bar = document.getElementById('bulk-bar');
  if(!bar) return;
  const count = selectedIds.size;
  bar.querySelector('.bulk-count').textContent = count === 0 ? 'Select accounts' : `${count} selected`;
  const delBtn = bar.querySelector('.bulk-delete-btn');
  if(delBtn) delBtn.disabled = count === 0;
  const sellBtn = bar.querySelector('.bulk-sell-btn');
  const restockBtn = bar.querySelector('.bulk-restock-btn');
  if(sellBtn) sellBtn.style.display = currentMode === 'stock' ? '' : 'none';
  if(restockBtn) restockBtn.style.display = currentMode === 'sold' ? '' : 'none';
}
function bulkDelete(){
  const count = selectedIds.size;
  if(!count) return;
  if(!confirm(`Delete ${count} account${count>1?'s':''}? This cannot be undone.`)) return;
  accounts = accounts.filter(a => !selectedIds.has(a.id));
  persist(); exitBulkMode();
  toast(`${count} account${count>1?'s':''} deleted.`);
}
function bulkMarkSold(){
  const count = selectedIds.size;
  if(!count) return;
  const today = new Date().toISOString().slice(0,10);
  accounts = accounts.map(a => selectedIds.has(a.id) ? {...a, sold:true, saleDate:a.saleDate||today} : a);
  persist(); exitBulkMode();
  toast(`${count} account${count>1?'s':''} marked as sold.`);
}
function bulkRestock(){
  const count = selectedIds.size;
  if(!count) return;
  accounts = accounts.map(a => selectedIds.has(a.id) ? {...a, sold:false} : a);
  persist(); exitBulkMode();
  toast(`${count} account${count>1?'s':''} moved to stock.`);
}
function enterBulkFrom(id){ bulkMode = true; selectedIds.add(id); render(); }

/* ===== Clone ===== */
function cloneAccount(id){
  const src = accounts.find(a=>a.id===id);
  if(!src) return;
  const clone = {...src, id:uid(), accId:uid(), name:src.name+' (Copy)', saved:new Date().toISOString()};
  const idx = accounts.findIndex(a=>a.id===id);
  accounts.splice(idx+1, 0, clone);
  persist(); render();
  toast(`"${src.name}" duplicated.`);
}

/* ===== Password Strength ===== */
function pwStrength(pw){
  if(!pw) return {score:0, label:''};
  let score = 0;
  if(pw.length >= 8) score++;
  if(pw.length >= 14) score++;
  if(/[A-Z]/.test(pw)) score++;
  if(/[0-9]/.test(pw)) score++;
  if(/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ['','Weak','Fair','Good','Strong','Very Strong'];
  const colors = ['','#d94040','#d48a0e','#d4a017','#1a9e72','#1a9e72'];
  return {score, label: labels[score]||'', color: colors[score]||''};
}
function updatePwStrength(){
  const pw = document.getElementById('f-pw').value;
  const bar = document.getElementById('pw-strength-bar');
  const lbl = document.getElementById('pw-strength-lbl');
  if(!bar||!lbl) return;
  const {score, label, color} = pwStrength(pw);
  bar.style.width = (score/5*100)+'%';
  bar.style.background = color;
  lbl.textContent = pw ? label : '';
  lbl.style.color = color;
}

/* ===== Revenue Chart ===== */
function showRevenueChart(){
  const sold = accounts.filter(a=>a.sold && a.saleDate && a.salePrice);
  if(!sold.length){ toast('No sold accounts with price & date data.'); return; }
  const monthly = {};
  sold.forEach(a=>{
    const month = a.saleDate.slice(0,7);
    const n = parseFloat(String(a.salePrice||'').replace(/[^0-9.]/g,''));
    if(!isNaN(n)) monthly[month] = (monthly[month]||0) + n;
  });
  const labels = Object.keys(monthly).sort();
  const values = labels.map(l=>monthly[l]);
  const overlay = document.getElementById('chart-overlay');
  const canvas = document.getElementById('revenue-chart');
  overlay.style.display='flex';
  requestAnimationFrame(()=>{
    const dpr = window.devicePixelRatio||1;
    const W = canvas.offsetWidth; const H = canvas.offsetHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr,dpr);
    const pad = {top:30, right:20, bottom:60, left:60};
    const cW = W - pad.left - pad.right; const cH = H - pad.top - pad.bottom;
    const max = Math.max(...values) * 1.15 || 1;
    const isDark = document.body.getAttribute('data-theme')==='dark';
    const textColor = isDark ? '#f0efe8' : '#181816';
    const mutedColor = isDark ? '#8a8a82' : '#7a7a74';
    const accentColor = isDark ? '#5b7ff5' : '#2d5be3';
    const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
    ctx.clearRect(0,0,W,H);
    const gridCount = 4;
    for(let i=0;i<=gridCount;i++){
      const y = pad.top + cH - (i/gridCount)*cH;
      ctx.beginPath(); ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
      ctx.moveTo(pad.left, y); ctx.lineTo(pad.left+cW, y); ctx.stroke();
      const val = (max/1.15) * (i/gridCount);
      ctx.fillStyle = mutedColor; ctx.font = `11px DM Mono, monospace`; ctx.textAlign='right';
      ctx.fillText('$'+val.toFixed(0), pad.left-6, y+4);
    }
    if(!labels.length) return;
    const step = cW / labels.length;
    const barW = Math.min(44, step * 0.55);
    labels.forEach((lbl,i)=>{
      const x = pad.left + step*i + step/2;
      const barH = (values[i]/max)*cH;
      const y = pad.top + cH - barH;
      const grad = ctx.createLinearGradient(0, y, 0, y+barH);
      grad.addColorStop(0, accentColor); grad.addColorStop(1, accentColor+'44');
      ctx.fillStyle = grad;
      const r = Math.min(5, barH/2);
      ctx.beginPath();
      ctx.moveTo(x - barW/2 + r, y); ctx.lineTo(x + barW/2 - r, y);
      ctx.quadraticCurveTo(x + barW/2, y, x + barW/2, y+r);
      ctx.lineTo(x + barW/2, y+barH); ctx.lineTo(x - barW/2, y+barH);
      ctx.lineTo(x - barW/2, y+r); ctx.quadraticCurveTo(x - barW/2, y, x - barW/2 + r, y);
      ctx.closePath(); ctx.fill();
      if(barH > 18){
        ctx.fillStyle = textColor; ctx.font = `bold 11px DM Mono, monospace`; ctx.textAlign='center';
        ctx.fillText('$'+values[i].toFixed(0), x, y-6);
      }
      const [yr, mo] = lbl.split('-');
      const moName = new Date(+yr,+mo-1,1).toLocaleString('en-US',{month:'short'});
      ctx.fillStyle = mutedColor; ctx.font = `11px DM Sans, sans-serif`; ctx.textAlign='center';
      ctx.fillText(moName, x, pad.top+cH+18);
      ctx.fillStyle = textColor+'77'; ctx.font = `10px DM Mono, monospace`;
      ctx.fillText(yr, x, pad.top+cH+32);
    });
  });
}
function closeRevenueChart(){ document.getElementById('chart-overlay').style.display='none'; }

/* ===== Dashboard ===== */
function openDashboard(){
  const overlay = document.getElementById('dash-overlay');
  overlay.style.display = 'flex';
  renderDashboard();
}
function closeDashboard(){ document.getElementById('dash-overlay').style.display = 'none'; }
function renderDashboard(){
  const el = document.getElementById('dash-content');
  const stock = accounts.filter(a=>!a.sold);
  const sold = accounts.filter(a=>a.sold);
  const total = accounts.length;
  const active = stock.filter(a=>getStatus(a.exp)==='ok').length;
  const expiring = stock.filter(a=>getStatus(a.exp)==='soon').length;
  const expired = stock.filter(a=>getStatus(a.exp)==='expired').length;
  const revenue = sold.reduce((s,a)=>{ const n=parseFloat(String(a.salePrice||'').replace(/[^0-9.]/g,'')); return s+(isNaN(n)?0:n); }, 0);

  // Top categories by count
  const catCount = {};
  accounts.forEach(a=>{ if(a.cat){ catCount[a.cat]=(catCount[a.cat]||0)+1; } });
  const topCats = Object.entries(catCount).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const maxCat = topCats.length ? topCats[0][1] : 1;

  // Expiring soon list
  const urgentList = stock.filter(a=>a.exp && daysLeft(a.exp) !== null && daysLeft(a.exp) <= EXPIRING_DAYS)
    .sort((a,b)=>a.exp.localeCompare(b.exp)).slice(0,6);

  // Monthly revenue trend (last 6 months)
  const monthly = {};
  sold.forEach(a=>{
    if(a.saleDate && a.salePrice){
      const month = a.saleDate.slice(0,7);
      const n = parseFloat(String(a.salePrice).replace(/[^0-9.]/g,''));
      if(!isNaN(n)) monthly[month] = (monthly[month]||0) + n;
    }
  });
  const months6 = [];
  for(let i=5;i>=0;i--){
    const d = new Date(); d.setMonth(d.getMonth()-i);
    const key = d.toISOString().slice(0,7);
    months6.push({key, label: d.toLocaleString('en-US',{month:'short'}), val: monthly[key]||0});
  }
  const maxRev = Math.max(...months6.map(m=>m.val), 1);

  // Sold this month
  const thisMonth = new Date().toISOString().slice(0,7);
  const soldThisMonth = sold.filter(a=>a.saleDate && a.saleDate.startsWith(thisMonth)).length;

  el.innerHTML = `
    <div class="dash-grid">
      <div class="dash-card">
        <div class="dash-kpi">${total}</div>
        <div class="dash-kpi-lbl">Total Accounts</div>
      </div>
      <div class="dash-card">
        <div class="dash-kpi green">${active}</div>
        <div class="dash-kpi-lbl">Active in Stock</div>
      </div>
      <div class="dash-card">
        <div class="dash-kpi amber">${expiring}</div>
        <div class="dash-kpi-lbl">Expiring Soon</div>
      </div>
      <div class="dash-card">
        <div class="dash-kpi red">${expired}</div>
        <div class="dash-kpi-lbl">Expired</div>
      </div>
      <div class="dash-card">
        <div class="dash-kpi purple">${sold.length}</div>
        <div class="dash-kpi-lbl">Total Sold</div>
      </div>
      <div class="dash-card">
        <div class="dash-kpi green">${revenue > 0 ? '$'+revenue.toFixed(2) : '—'}</div>
        <div class="dash-kpi-lbl">Total Revenue</div>
      </div>

      ${topCats.length ? `
      <div class="dash-card dash-card-full">
        <div class="dash-section-lbl">Top Categories</div>
        ${topCats.map(([cat,count])=>`
          <div class="dash-bar-row">
            <div class="dash-bar-label" title="${escHtml(cat)}">${escHtml(cat)}</div>
            <div class="dash-bar-track">
              <div class="dash-bar-fill" style="width:${(count/maxCat*100).toFixed(1)}%;background:${getCatColor(cat)}"></div>
            </div>
            <div class="dash-bar-val">${count}</div>
          </div>`).join('')}
      </div>` : ''}

      ${months6.some(m=>m.val>0) ? `
      <div class="dash-card dash-card-full">
        <div class="dash-section-lbl">Revenue — Last 6 Months</div>
        ${months6.map(m=>`
          <div class="dash-bar-row">
            <div class="dash-bar-label">${m.label}</div>
            <div class="dash-bar-track">
              <div class="dash-bar-fill" style="width:${(m.val/maxRev*100).toFixed(1)}%;background:var(--accent)"></div>
            </div>
            <div class="dash-bar-val">${m.val > 0 ? '$'+m.val.toFixed(0) : '—'}</div>
          </div>`).join('')}
      </div>` : ''}

      ${urgentList.length ? `
      <div class="dash-card dash-card-full">
        <div class="dash-section-lbl">Expiring Soon (Next ${EXPIRING_DAYS} Days)</div>
        <div class="dash-expiry-list">
          ${urgentList.map(a=>{
            const dl = daysLeft(a.exp);
            const st = getStatus(a.exp);
            const label = st==='expired' ? Math.abs(dl)+'d ago' : dl+'d left';
            return `<div class="dash-expiry-row">
              <span class="dash-expiry-name">${escHtml(a.name)}</span>
              <span style="font-size:11.5px;color:var(--text-muted);flex-shrink:0">${fmtDate(a.exp)}</span>
              <span class="dash-expiry-days ${st}">${label}</span>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}
    </div>`;
}

/* ===== Reminder Banner ===== */
function renderReminderBanner(){
  const wrap = document.getElementById('reminder-wrap');
  if(!wrap || reminderDismissed) return;
  const stockAccounts = accounts.filter(a=>!a.sold);
  const urgent = stockAccounts.filter(a=>a.exp && daysLeft(a.exp) !== null && daysLeft(a.exp) <= EXPIRING_DAYS)
    .sort((a,b)=>a.exp.localeCompare(b.exp)).slice(0,4);
  if(!urgent.length){ wrap.innerHTML=''; return; }
  const items = urgent.map(a=>{
    const dl = daysLeft(a.exp);
    const st = getStatus(a.exp);
    const badge = st==='expired' ? `<span class="reminder-item-badge expired">${Math.abs(dl)}d ago</span>` : `<span class="reminder-item-badge soon">${dl}d left</span>`;
    return `<div class="reminder-item"><span class="reminder-item-name">${escHtml(a.name)}</span>${badge}</div>`;
  }).join('');
  wrap.innerHTML = `
    <div class="reminder-banner">
      <span class="reminder-icon">⏰</span>
      <div class="reminder-body">
        <div class="reminder-title">${urgent.length} account${urgent.length>1?'s':''} expiring soon</div>
        <div class="reminder-list">${items}</div>
      </div>
      <button class="reminder-close" onclick="dismissReminder()" title="Dismiss">×</button>
    </div>`;
}
function dismissReminder(){
  reminderDismissed = true;
  document.getElementById('reminder-wrap').innerHTML = '';
}

/* ===== Render ===== */
function render(){
  const q = document.getElementById('search').value.toLowerCase();
  const cf = document.getElementById('cat-filter').value;
  const stockAccounts = accounts.filter(a=>!a.sold);
  const soldAccounts = accounts.filter(a=>a.sold);
  document.getElementById('cnt-stock').textContent = stockAccounts.length;
  document.getElementById('cnt-sold').textContent = soldAccounts.length;
  const cats = [...new Set(accounts.map(a=>a.cat).filter(Boolean))].sort();
  document.getElementById('cat-list').innerHTML = cats.map(c=>`<option value="${escHtml(c)}">`).join('');
  const catSel = document.getElementById('cat-filter');
  const prev = catSel.value;
  catSel.innerHTML = '<option value="">All categories</option>' +
    cats.map(c=>`<option value="${escHtml(c)}"${c===prev?' selected':''}>${escHtml(c)}</option>`).join('');
  renderBulkBar();
  renderReminderBanner();
  if(currentMode==='stock'){
    renderStockStats(stockAccounts);
    document.getElementById('status-tabs').style.display='';
    let list = stockAccounts.filter(a=>{
      const matchQ=!q||[a.name,a.mail,a.accId,a.cat,...(a.tags||[]),a.note,a.username,a.phone,a.url].join(' ').toLowerCase().includes(q);
      const matchF=filter==='all'||getStatus(a.exp)===filter;
      const matchC=!cf||a.cat===cf;
      return matchQ&&matchF&&matchC;
    });
    list = sortAccounts(list);
    renderStockList(list, stockAccounts, q);
  } else {
    renderSoldStats(soldAccounts);
    document.getElementById('status-tabs').style.display='';
    let list = soldAccounts.filter(a=>{
      const matchQ=!q||[a.name,a.mail,a.accId,a.cat,...(a.tags||[]),a.note,a.buyer,a.saleNote,a.username].join(' ').toLowerCase().includes(q);
      const matchF=filter==='all'||getStatus(a.exp)===filter;
      const matchC=!cf||a.cat===cf;
      return matchQ&&matchF&&matchC;
    });
    list = sortAccounts(list);
    renderSoldList(list, soldAccounts, q);
  }
  syncActiveFilterUI();
}

function renderBulkBar(){
  let bar = document.getElementById('bulk-bar');
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'bulk-bar'; bar.className = 'bulk-bar';
    bar.innerHTML = `
      <div class="bulk-bar-left">
        <button class="btn btn-sm bulk-selall-btn" onclick="selectAllVisible()">Select All</button>
        <span class="bulk-count">Select accounts</span>
      </div>
      <div class="bulk-bar-actions">
        <button class="btn btn-sm btn-sell bulk-sell-btn" onclick="bulkMarkSold()">✅ Sold</button>
        <button class="btn btn-sm btn-restock bulk-restock-btn" onclick="bulkRestock()">📦 Restock</button>
        <button class="btn btn-sm btn-danger bulk-delete-btn" onclick="bulkDelete()">🗑 Delete</button>
        <button class="btn btn-sm bulk-exit-btn" onclick="exitBulkMode()">✕</button>
      </div>`;
    const listEl = document.getElementById('list');
    listEl.parentNode.insertBefore(bar, listEl);
  }
  bar.style.display = bulkMode ? 'flex' : 'none';
  if(bulkMode) updateBulkBar();
}

function renderStockStats(stock){
  const total=stock.length, active=stock.filter(a=>getStatus(a.exp)==='ok').length;
  const soon=stock.filter(a=>getStatus(a.exp)==='soon').length, expired=stock.filter(a=>getStatus(a.exp)==='expired').length;
  document.getElementById('stats').innerHTML=`
    <div class="stat clickable ${filter==='all'?'active':''}" data-filter="all" onclick="setFilterDirect('all')">
      <div class="stat-num">${total}</div><div class="stat-lbl">Total</div>
    </div>
    <div class="stat clickable ${filter==='ok'?'active':''}" data-filter="ok" onclick="setFilterDirect('ok')">
      <div class="stat-num green">${active}</div><div class="stat-lbl">Active</div>
    </div>
    <div class="stat clickable ${filter==='soon'?'active':''}" data-filter="soon" onclick="setFilterDirect('soon')">
      <div class="stat-num amber">${soon}</div><div class="stat-lbl">Expiring</div>
    </div>
    <div class="stat clickable ${filter==='expired'?'active':''}" data-filter="expired" onclick="setFilterDirect('expired')">
      <div class="stat-num red">${expired}</div><div class="stat-lbl">Expired</div>
    </div>`;
}
function renderSoldStats(sold){
  const total=sold.length;
  const active=sold.filter(a=>getStatus(a.exp)==='ok').length;
  const soon=sold.filter(a=>getStatus(a.exp)==='soon').length;
  const expired=sold.filter(a=>getStatus(a.exp)==='expired').length;
  const revenue=sold.reduce((s,a)=>{ const n=parseFloat(String(a.salePrice||'').replace(/[^0-9.]/g,'')); return s+(isNaN(n)?0:n); }, 0);
  const revenueStr=revenue>0 ? '$'+revenue.toFixed(2) : '—';
  const hasChartData = sold.some(a=>a.saleDate&&a.salePrice);
  document.getElementById('stats').innerHTML=`
    <div class="stat clickable ${filter==='all'?'active':''}" data-filter="all" onclick="setFilterDirect('all')">
      <div class="stat-num">${total}</div><div class="stat-lbl">Total</div>
    </div>
    <div class="stat clickable ${filter==='ok'?'active':''}" data-filter="ok" onclick="setFilterDirect('ok')">
      <div class="stat-num green">${active}</div><div class="stat-lbl">Active</div>
    </div>
    <div class="stat clickable ${filter==='soon'?'active':''}" data-filter="soon" onclick="setFilterDirect('soon')">
      <div class="stat-num amber">${soon}</div><div class="stat-lbl">Expiring</div>
    </div>
    <div class="stat clickable ${filter==='expired'?'active':''}" data-filter="expired" onclick="setFilterDirect('expired')">
      <div class="stat-num red">${expired}</div><div class="stat-lbl">Expired</div>
    </div>
    <div class="stat${hasChartData?' clickable stat-chart-btn':''}" style="grid-column:span 4" ${hasChartData?'onclick="showRevenueChart()"':''}>
      <div class="stat-num" style="font-size:18px">${revenueStr}</div>
      <div class="stat-lbl">Total Revenue${hasChartData?' <span class="chart-hint">↗ chart</span>':''}</div>
    </div>`;
}
function highlightText(text, q){
  if(!q || !text) return escHtml(text);
  const safe = escHtml(text);
  const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(safeQ, 'gi'), m=>`<mark class="hl">${m}</mark>`);
}

function renderStockList(list, all, q=''){
  if(!all.length){
    document.getElementById('list').innerHTML=`<div class="empty"><div class="empty-icon">📭</div><h3>No accounts yet</h3><p>Tap <b>+ Add</b> to get started.</p></div>`;
    return;
  }
  if(!list.length){
    document.getElementById('list').innerHTML=`<div class="empty"><div class="empty-icon">🔍</div><h3>No results</h3><p>Try a different search or filter.</p></div>`;
    return;
  }
  document.getElementById('list').innerHTML=list.map(a=>buildStockCard(a,q)).join('');
}
function renderSoldList(list, all, q=''){
  if(!all.length){
    document.getElementById('list').innerHTML=`<div class="empty"><div class="empty-icon">🏪</div><h3>No sold accounts yet</h3><p>Mark an account as sold when editing.</p></div>`;
    return;
  }
  if(!list.length){
    document.getElementById('list').innerHTML=`<div class="empty"><div class="empty-icon">🔍</div><h3>No results</h3><p>Try a different search or filter.</p></div>`;
    return;
  }
  document.getElementById('list').innerHTML=list.map(a=>buildSoldCard(a,q)).join('');
}

function buildStockCard(a, q=''){
  const s=getStatus(a.exp);
  const dl=daysLeft(a.exp);
  const dlTag=a.exp?`<span class="days-tag">(${s==='expired'?Math.abs(dl)+'d ago':dl+'d left'})</span>`:'';
  const tagBadges=(a.tags||[]).filter(Boolean).map(t=>`<span class="badge tag">${escHtml(t)}</span>`).join('');
  const catColor=getCatColor(a.cat);
  const catBadge=a.cat?`<span class="badge cat"><span class="cat-dot" style="background:${catColor}"></span>${escHtml(a.cat)}</span>`:'';
  const isSelected = selectedIds.has(a.id);
  const pwRow=a.pw?`
    <span class="meta-lbl">Password</span>
    <span class="meta-val inline-actions">
      <span class="pw-wrap"><span class="pw-val" id="pw-${a.id}">••••••••</span>
        <button class="pw-toggle" data-id="${a.id}" data-pw="${escHtml(a.pw)}" onclick="revealPwBtn(this)" title="Show/hide">👁</button>
      </span>
      <button class="copy-btn" data-id="${a.id}" data-pw="${escHtml(a.pw)}" onclick="copyPasswordBtn(this)">Copy</button>
    </span>`:'';
  const urlRow=a.url?`<span class="meta-lbl">URL</span><span class="meta-val"><a href="${escHtml(a.url)}" target="_blank" rel="noopener" style="color:var(--accent)">${escHtml(a.url)}</a></span>`:'';
  return `
    <div class="card ${s}${isSelected?' selected':''}" data-id="${a.id}">
      ${bulkMode?`<label class="bulk-check"><input type="checkbox" class="bulk-cb"${isSelected?' checked':''} onchange="toggleSelectCard('${a.id}')"></label>`:''}
      <div class="card-top">
        <div>
          <div class="acc-name">${highlightText(a.name, q)}</div>
          <div class="acc-id">${escHtml(a.accId)}</div>
        </div>
        <div class="card-badges">${catBadge}<span class="badge ${s}">${statusLabel(s)}</span></div>
      </div>
      ${tagBadges?`<div class="tags-row">${tagBadges}</div>`:''}
      <div class="meta">
        <span class="meta-lbl">Email</span>
        <span class="meta-val inline-actions"><span>${highlightText(a.mail, q)}</span><button class="copy-btn" data-val="${escHtml(a.mail)}" data-msg="Email copied." onclick="copyValueBtn(this)">Copy</button></span>
        ${a.username?`<span class="meta-lbl">Username</span><span class="meta-val">${escHtml(a.username)}</span>`:''}
        ${a.phone?`<span class="meta-lbl">Phone</span><span class="meta-val inline-actions"><span>${escHtml(a.phone)}</span><button class="copy-btn" data-val="${escHtml(a.phone)}" data-msg="Phone copied." onclick="copyValueBtn(this)">Copy</button></span>`:''}
        ${pwRow}
        ${urlRow}
        <span class="meta-lbl">Purchased</span><span class="meta-val">${fmtDate(a.buy)}</span>
        <span class="meta-lbl">Expiry</span><span class="meta-val">${fmtDate(a.exp)}${dlTag}</span>
      </div>
      ${a.note?`<div class="note-box"><div class="note-lbl">Note</div><div class="note-val">${escHtml(a.note)}</div></div>`:''}
      <div class="card-actions">
        <button class="btn btn-sm" onclick="openModal('${a.id}')">✏️ Edit</button>
        <button class="btn btn-sm btn-clone" onclick="cloneAccount('${a.id}')">⧉ Clone</button>
        <button class="btn btn-sm btn-sell" onclick="quickSell('${a.id}')">✅ Mark Sold</button>
        <button class="btn btn-sm btn-danger" onclick="deleteAccount('${a.id}')">🗑</button>
        ${!bulkMode?`<button class="btn btn-sm bulk-toggle-btn" onclick="enterBulkFrom('${a.id}')">☑ Select</button>`:''}
      </div>
    </div>`;
}

function buildSoldCard(a, q=''){
  const catColor=getCatColor(a.cat);
  const catBadge=a.cat?`<span class="badge cat"><span class="cat-dot" style="background:${catColor}"></span>${escHtml(a.cat)}</span>`:'';
  const tagBadges=(a.tags||[]).filter(Boolean).map(t=>`<span class="badge tag">${escHtml(t)}</span>`).join('');
  const isSelected = selectedIds.has(a.id);
  const pwRow=a.pw?`
    <span class="meta-lbl">Password</span>
    <span class="meta-val inline-actions">
      <span class="pw-wrap"><span class="pw-val" id="pw-${a.id}">••••••••</span>
        <button class="pw-toggle" data-id="${a.id}" data-pw="${escHtml(a.pw)}" onclick="revealPwBtn(this)" title="Show/hide">👁</button>
      </span>
      <button class="copy-btn" data-id="${a.id}" data-pw="${escHtml(a.pw)}" onclick="copyPasswordBtn(this)">Copy</button>
    </span>`:'';
  return `
    <div class="card sold-card${isSelected?' selected':''}" data-id="${a.id}">
      ${bulkMode?`<label class="bulk-check"><input type="checkbox" class="bulk-cb"${isSelected?' checked':''} onchange="toggleSelectCard('${a.id}')"></label>`:''}
      <div class="sold-banner">✅ SOLD</div>
      <div class="card-top">
        <div>
          <div class="acc-name">${highlightText(a.name, q)}</div>
          <div class="acc-id">${escHtml(a.accId)}</div>
        </div>
        <div class="card-badges">${catBadge}</div>
      </div>
      ${tagBadges?`<div class="tags-row">${tagBadges}</div>`:''}
      <div class="meta">
        <span class="meta-lbl">Email</span>
        <span class="meta-val inline-actions"><span>${highlightText(a.mail, q)}</span><button class="copy-btn" data-val="${escHtml(a.mail)}" data-msg="Email copied." onclick="copyValueBtn(this)">Copy</button></span>
        ${a.username?`<span class="meta-lbl">Username</span><span class="meta-val">${escHtml(a.username)}</span>`:''}
        ${pwRow}
        ${a.buyer?`<span class="meta-lbl">Buyer</span><span class="meta-val">${escHtml(a.buyer)}</span>`:''}
        ${a.salePrice?`<span class="meta-lbl">Sale Price</span><span class="meta-val" style="color:var(--green);font-weight:600">${escHtml(a.salePrice)}</span>`:''}
        ${a.saleDate?`<span class="meta-lbl">Sale Date</span><span class="meta-val">${fmtDate(a.saleDate)}</span>`:''}
        <span class="meta-lbl">Purchased</span><span class="meta-val">${fmtDate(a.buy)}</span>
        <span class="meta-lbl">Expiry</span><span class="meta-val">${fmtDate(a.exp)}</span>
      </div>
      ${a.saleNote?`<div class="note-box"><div class="note-lbl">Sale Note</div><div class="note-val">${escHtml(a.saleNote)}</div></div>`:''}
      ${a.note?`<div class="note-box"><div class="note-lbl">Note</div><div class="note-val">${escHtml(a.note)}</div></div>`:''}
      <div class="card-actions">
        <button class="btn btn-sm" onclick="openModal('${a.id}')">✏️ Edit</button>
        <button class="btn btn-sm btn-clone" onclick="cloneAccount('${a.id}')">⧉ Clone</button>
        <button class="btn btn-sm btn-restock" onclick="quickRestock('${a.id}')">📦 Move to Stock</button>
        <button class="btn btn-sm btn-danger" onclick="deleteAccount('${a.id}')">🗑</button>
        ${!bulkMode?`<button class="btn btn-sm bulk-toggle-btn" onclick="enterBulkFrom('${a.id}')">☑ Select</button>`:''}
      </div>
    </div>`;
}

/* ===== Quick actions ===== */
function quickSell(id){
  const a = accounts.find(x=>x.id===id);
  if(!a) return;
  const today = new Date().toISOString().slice(0,10);
  accounts = accounts.map(x=>x.id===id?{...x,sold:true,saleDate:x.saleDate||today}:x);
  persist(); render();
  toast(`"${a.name}" marked as sold.`);
}
function quickRestock(id){
  const a = accounts.find(x=>x.id===id);
  if(!a) return;
  accounts = accounts.map(x=>x.id===id?{...x,sold:false}:x);
  persist(); render();
  toast(`"${a.name}" moved back to stock.`);
}

/* ===== Password reveal/copy ===== */
function revealPwBtn(btn){
  const id = btn.dataset.id; const pw = btn.dataset.pw;
  const el = document.getElementById('pw-'+id);
  if(!el) return;
  el.textContent = el.textContent === '••••••••' ? pw : '••••••••';
}
function copyPasswordBtn(btn){
  const pw = btn.dataset.pw; const id = btn.dataset.id;
  const pwVal = document.getElementById('pw-'+id);
  if(pwVal && pwVal.textContent==='••••••••') pwVal.textContent = pw;
  copyValue(pw, 'Password copied.');
}
function copyValueBtn(btn){ copyValue(btn.dataset.val, btn.dataset.msg || 'Copied.'); }
function togglePwInput(){
  const i=document.getElementById('f-pw');
  i.type=i.type==='password'?'text':'password';
}
function setupMobileModalInputs(){
  const modal=document.getElementById('modal');
  if(!modal||modal.dataset.mobileReady==='1') return;
  modal.dataset.mobileReady='1';
  modal.querySelectorAll('input,textarea,select').forEach(el=>{
    el.addEventListener('focus',()=>{ setTimeout(()=>el.scrollIntoView({block:'center',behavior:'smooth'}),250); });
  });
}
async function copyValue(value,msg='Copied.'){
  try{ await navigator.clipboard.writeText(String(value||'')); toast(msg); }
  catch(err){ console.error(err); toast('Copy failed.'); }
}
function generatePassword(len=18){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const bytes=new Uint32Array(len); crypto.getRandomValues(bytes);
  return Array.from(bytes,n=>chars[n%chars.length]).join('');
}
function fillGeneratedPassword(){
  const input=document.getElementById('f-pw');
  input.value=generatePassword(); input.type='text';
  updatePwStrength();
  toast('Strong password generated.');
}

document.getElementById('import-file').addEventListener('change',e=>{
  const file=e.target.files&&e.target.files[0];
  importFileFromInput(file); e.target.value='';
});

/* ===== Modal ===== */
function openModal(id){
  editId=id||null;
  const a=id?accounts.find(x=>x.id===id):null;
  setupMobileModalInputs();
  document.getElementById('modal-title').textContent=id?'Edit Account':'Add Account';
  document.getElementById('f-name').value=a?.name||'';
  document.getElementById('f-accid').value=a?.accId||'';
  document.getElementById('f-cat').value=a?.cat||'';
  document.getElementById('f-tags').value=(a?.tags||[]).join(', ');
  document.getElementById('f-mail').value=a?.mail||'';
  document.getElementById('f-username').value=a?.username||'';
  document.getElementById('f-phone').value=a?.phone||'';
  document.getElementById('f-pw').value=a?.pw||'';
  document.getElementById('f-pw').type='password';
  document.getElementById('f-2fa').value=a?.twofa||'';
  document.getElementById('f-url').value=a?.url||'';
  document.getElementById('f-buy').value=a?.buy||'';
  document.getElementById('f-exp').value=a?.exp||'';
  document.getElementById('f-note').value=a?.note||'';
  document.getElementById('f-buyer').value=a?.buyer||'';
  document.getElementById('f-price').value=a?.salePrice||'';
  document.getElementById('f-sold-date').value=a?.saleDate||'';
  document.getElementById('f-sold-note').value=a?.saleNote||'';
  updatePwStrength();
  const isSold = a ? !!a.sold : (currentMode==='sold');
  setModalSold(isSold);
  renderSwatches(a?.cat||'');
  document.getElementById('modal').classList.add('open');
  document.body.classList.add('modal-open');
  document.body.dataset.scrollY = String(window.scrollY);
  setTimeout(()=>{
    const firstInput=document.getElementById('f-name');
    firstInput.focus({preventScroll:true});
    firstInput.scrollIntoView({block:'center',behavior:'smooth'});
  },120);
}
function closeModal(){
  document.getElementById('modal').classList.remove('open');
  document.body.classList.remove('modal-open');
  const y = parseInt(document.body.dataset.scrollY||'0',10);
  window.scrollTo(0, y);
}
function bgClose(e){ if(e.target===e.currentTarget) closeModal(); }
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){ closeModal(); closeRevenueChart(); closeDashboard(); }
});

/* ===== Save ===== */
function saveAccount(){
  const name=document.getElementById('f-name').value.trim();
  const mail=document.getElementById('f-mail').value.trim();
  if(!name){document.getElementById('f-name').focus();toast('Account name is required.');return;}
  if(!mail){document.getElementById('f-mail').focus();toast('Email is required.');return;}
  const tags=document.getElementById('f-tags').value.split(',').map(t=>t.trim()).filter(Boolean);
  const catVal=document.getElementById('f-cat').value.trim();
  if(catVal){catColors[catVal]=selectedColor;persistColors();}
  const obj={
    id:editId||uid(),
    accId:document.getElementById('f-accid').value.trim()||uid(),
    name, mail,
    username:document.getElementById('f-username').value.trim(),
    phone:document.getElementById('f-phone').value.trim(),
    pw:document.getElementById('f-pw').value,
    twofa:document.getElementById('f-2fa').value.trim(),
    url:document.getElementById('f-url').value.trim(),
    cat:catVal, tags,
    buy:document.getElementById('f-buy').value,
    exp:document.getElementById('f-exp').value,
    note:document.getElementById('f-note').value.trim(),
    saved:editId?(accounts.find(a=>a.id===editId)?.saved||new Date().toISOString()):new Date().toISOString(),
    sold:modalIsSold,
    buyer:document.getElementById('f-buyer').value.trim(),
    salePrice:document.getElementById('f-price').value.trim(),
    saleDate:document.getElementById('f-sold-date').value,
    saleNote:document.getElementById('f-sold-note').value.trim()
  };
  if(editId){ accounts=accounts.map(a=>a.id===editId?obj:a); toast('Account updated.'); }
  else { accounts.unshift(obj); toast('Account saved.'); }
  persist(); closeModal(); render();
}

/* ===== Delete ===== */
function deleteAccount(id){
  if(!confirm('Delete this account? This cannot be undone.')) return;
  accounts=accounts.filter(a=>a.id!==id);
  persist(); render();
  toast('Account deleted.');
}

/* ===== Theme ===== */
const themeBtn=document.getElementById('theme-btn');
let dark=localStorage.getItem('acc_theme')==='dark';
function applyTheme(){
  document.body.setAttribute('data-theme',dark?'dark':'light');
  themeBtn.textContent=dark?'☀️':'🌙';
  localStorage.setItem('acc_theme',dark?'dark':'light');
}
themeBtn.addEventListener('click',()=>{dark=!dark;applyTheme();});
applyTheme();
render();

/* ===== PIN Lock ===== */
const PIN_KEY='acc_pin_hash';
const PIN_LEN=4;
let pinBuffer='';
let pinMode='unlock';
let pinFirst='';

async function hashPin(pin){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pin+'acc_mgr_salt'));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function storedHash(){ return localStorage.getItem(PIN_KEY); }
function pinDots(len,state){
  for(let i=0;i<PIN_LEN;i++){
    const d=document.getElementById('d'+i);
    d.className='pin-dot'+(i<len?' filled':'')+(state==='error'?' error':'');
  }
}
function pinErr(msg){
  const el=document.getElementById('pin-error');
  el.textContent=msg; el.classList.remove('hidden');
  const card=document.getElementById('pin-card');
  card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
  setTimeout(()=>el.classList.add('hidden'),2000);
}
function pinKey(k){
  if(pinBuffer.length>=PIN_LEN) return;
  pinBuffer+=k; pinDots(pinBuffer.length,'');
  if(pinBuffer.length===PIN_LEN) setTimeout(pinSubmit,120);
}
function pinDel(){ if(pinBuffer.length){pinBuffer=pinBuffer.slice(0,-1);pinDots(pinBuffer.length,'');} }
function pinClear(){ pinBuffer=''; pinDots(0,''); }

async function pinSubmit(){
  const h=await hashPin(pinBuffer);
  if(pinMode==='unlock'){
    if(h===storedHash()){unlockApp();}
    else{pinDots(PIN_LEN,'error');pinErr('Incorrect PIN. Try again.');setTimeout(pinClear,500);}
  } else if(pinMode==='setup'){
    pinFirst=pinBuffer; pinBuffer=''; pinMode='confirm';
    document.getElementById('pin-title').textContent='Confirm PIN';
    document.getElementById('pin-sub').textContent='Enter the same PIN again';
    pinDots(0,'');
  } else if(pinMode==='confirm'){
    if(pinBuffer===pinFirst){
      localStorage.setItem(PIN_KEY,h); toast('PIN set successfully.'); unlockApp();
    } else {
      pinDots(PIN_LEN,'error'); pinErr('PINs do not match. Start over.');
      setTimeout(()=>{
        pinBuffer='';pinFirst='';pinMode='setup';
        document.getElementById('pin-title').textContent='Set a PIN';
        document.getElementById('pin-sub').textContent='Choose a 4-digit PIN to lock the app';
        pinDots(0,'');
      },600);
    }
  }
}
function unlockApp(){
  const scr=document.getElementById('pin-screen');
  scr.classList.add('hidden');
  setTimeout(()=>scr.style.display='none',350);
  if(!document.getElementById('lock-btn')){
    const lb=document.createElement('button');
    lb.className='btn-icon'; lb.id='lock-btn'; lb.title='Lock app'; lb.textContent='🔒';
    lb.onclick=lockApp;
    document.querySelector('.header-actions').prepend(lb);
  }
  renderPinFooter();
}
function lockApp(){
  pinBuffer=''; pinFirst=''; pinMode='unlock';
  document.getElementById('pin-title').textContent='Account Manager';
  document.getElementById('pin-sub').textContent='Enter your PIN to continue';
  pinDots(0,''); document.getElementById('pin-error').classList.add('hidden');
  const scr=document.getElementById('pin-screen');
  scr.style.display='flex'; scr.classList.remove('hidden');
}
function renderPinFooter(){
  document.getElementById('pin-footer').innerHTML=`
    <button class="pin-change-btn" onclick="startChangePin()">Change PIN</button>
    <button class="pin-change-btn pin-reset-link" onclick="confirmResetPin()">Forgot / Reset PIN</button>`;
}
function startChangePin(){
  pinBuffer=''; pinFirst=''; pinMode='setup';
  document.getElementById('pin-title').textContent='Set a new PIN';
  document.getElementById('pin-sub').textContent='Choose a 4-digit PIN to lock the app';
  pinDots(0,''); document.getElementById('pin-error').classList.add('hidden');
  const scr=document.getElementById('pin-screen');
  scr.style.display='flex'; scr.classList.remove('hidden');
}
function confirmResetPin(){
  const scr=document.getElementById('pin-screen');
  scr.style.display='flex'; scr.classList.remove('hidden');
  document.getElementById('pin-title').textContent='Reset PIN';
  document.getElementById('pin-sub').textContent='⚠️ This will erase ALL accounts and reset the app.';
  document.getElementById('pin-dots').style.display='none';
  document.getElementById('pin-error').classList.add('hidden');
  document.querySelector('.pin-pad').style.display='none';
  document.getElementById('pin-footer').innerHTML=`
    <div class="pin-reset-confirm">
      <p class="pin-reset-warn">All your accounts will be permanently deleted.<br>This action <b>cannot be undone</b>.</p>
      <button class="btn btn-danger" style="width:100%;margin-bottom:8px" onclick="executeResetPin()">Yes, erase everything &amp; reset</button>
      <button class="pin-change-btn" onclick="cancelResetPin()">Cancel</button>
    </div>`;
}
function cancelResetPin(){
  document.getElementById('pin-dots').style.display='';
  document.querySelector('.pin-pad').style.display='';
  pinBuffer=''; pinFirst='';
  pinMode = storedHash() ? 'unlock' : 'setup';
  document.getElementById('pin-title').textContent = storedHash() ? 'Account Manager' : 'Set a PIN';
  document.getElementById('pin-sub').textContent = storedHash() ? 'Enter your PIN to continue' : 'Choose a 4-digit PIN to lock the app';
  pinDots(0,''); renderPinFooter();
}
function executeResetPin(){
  localStorage.removeItem(PIN_KEY);
  localStorage.removeItem('acc_mgr_v2');
  localStorage.removeItem('acc_cat_colors');
  accounts = []; catColors = {};
  document.getElementById('pin-dots').style.display='';
  document.querySelector('.pin-pad').style.display='';
  pinBuffer=''; pinFirst=''; pinMode='setup';
  document.getElementById('pin-title').textContent='Set a new PIN';
  document.getElementById('pin-sub').textContent='All data cleared. Choose a new PIN.';
  document.getElementById('pin-footer').innerHTML=
    `<p class="pin-setup-note">Data has been erased.<br><b>Set a new PIN to continue.</b></p>`;
  pinDots(0,''); render();
}

(function initPin(){
  const scr=document.getElementById('pin-screen');
  if(!storedHash()){
    pinMode='setup';
    document.getElementById('pin-title').textContent='Set a PIN';
    document.getElementById('pin-sub').textContent='Choose a 4-digit PIN to lock the app';
    document.getElementById('pin-footer').innerHTML=
      `<p class="pin-setup-note">You'll need this PIN every time you open the app.<br><b>Store it safely — it cannot be recovered.</b></p>`;
  } else {
    pinMode='unlock'; renderPinFooter();
  }
  scr.style.display='flex';
  document.addEventListener('keydown',e=>{
    if(scr.style.display==='none') return;
    if(e.key>='0'&&e.key<='9') pinKey(e.key);
    else if(e.key==='Backspace') pinDel();
    else if(e.key==='Escape') pinClear();
  });
})();
