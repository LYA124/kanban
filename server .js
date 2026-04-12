const http = require('http');
const https = require('https');

const APP_ID     = process.env.FEISHU_APP_ID     || 'cli_a950b6f99fb95bc8';
const APP_SECRET = process.env.FEISHU_APP_SECRET || 'E0q21M4FHBqZDNYZCN73mdFNktoxhTOy';
const APP_TOKEN  = process.env.FEISHU_APP_TOKEN  || 'PPSkb00lkaxMnusHZAJcFBainAg';
const PORT       = process.env.PORT || 3000;

// Table IDs
const TABLES = {
  nurse:  'tbl5TJfpAgRxJ1W6',
  beauty: 'tblnHRQVvEvU9L9U',
  doctor: 'tbl4eYxLA06rpNf0',
};

let tokenCache = { token: null, exp: 0 };

function fetchJSON(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + data.slice(0,200))); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const d = await fetchJSON('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  if (d.code !== 0) throw new Error('Token失败: ' + d.msg);
  tokenCache = { token: d.tenant_access_token, exp: Date.now() + (d.expire - 60) * 1000 };
  return tokenCache.token;
}

async function fetchAllRecords(tableId) {
  const token = await getToken();
  let all = [], pt = null;
  do {
    let url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records?page_size=500`;
    if (pt) url += `&page_token=${pt}`;
    const d = await fetchJSON(url, { headers: { Authorization: 'Bearer ' + token } });
    if (d.code !== 0) throw new Error(`读取表 ${tableId} 失败: ` + d.msg);
    all = all.concat(d.data.items || []);
    pt = d.data.has_more ? d.data.page_token : null;
  } while (pt);
  return all;
}

// ── HTML 看板（浅色主题）
const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>杭州中瑞 · 排班看板</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#f5f6f8;--surface:#fff;--surface2:#f0f2f6;--surface3:#e8ebf0;
  --border:#e2e6ed;--border2:#d0d6e0;
  --accent:#3b72d4;--accent2:#0d9f6e;--accent3:#e0344f;--accent4:#c07a00;
  --nurse-c:#3b72d4;--beauty-c:#0d9f6e;--doc-c:#e0344f;--head-c:#c07a00;
  --text:#1a2035;--text2:#5a6380;--text3:#9aa3b8;
  --early:#2d64c8;--late:#6d28d9;--mid:#0369a1;--midlate:#0d766e;
  --shadow:0 1px 4px rgba(0,0,0,.07),0 4px 16px rgba(0,0,0,.05);
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Sans SC',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}

.topbar{position:sticky;top:0;z-index:100;background:rgba(255,255,255,.95);backdrop-filter:blur(12px);
  border-bottom:1px solid var(--border);height:56px;display:flex;align-items:center;padding:0 20px;gap:16px;
  box-shadow:0 1px 8px rgba(0,0,0,.06)}
.logo{font-size:14px;font-weight:700;letter-spacing:.04em;color:var(--accent);white-space:nowrap}
.sep{width:1px;height:20px;background:var(--border)}
.month-nav{display:flex;align-items:center;gap:6px}
.month-nav button{width:28px;height:28px;border-radius:6px;border:1px solid var(--border);
  background:var(--surface2);color:var(--text2);cursor:pointer;font-size:13px;
  display:flex;align-items:center;justify-content:center;transition:all .15s}
.month-nav button:hover{border-color:var(--accent);color:var(--accent);background:#eef3fc}
.month-label{font-family:'DM Mono',monospace;font-size:14px;font-weight:500;min-width:72px;text-align:center;color:var(--text)}
.topbar-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.legend{display:flex;align-items:center;gap:14px}
.leg{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2)}
.leg-dot{width:7px;height:7px;border-radius:50%}
.conn-badge{font-size:11px;padding:3px 8px;border-radius:4px;font-weight:500}
.conn-ok{background:#dcfce7;color:#166534;border:1px solid #bbf7d0}
.conn-err{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}
.icon-btn{width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);
  color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;transition:all .2s}
.icon-btn:hover{border-color:var(--accent);color:var(--accent)}
.refresh-spin{animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

.page{display:none;padding:20px}
.page.active{display:block}

/* CALENDAR */
.cal-wrap{max-width:1100px;margin:0 auto}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.cal-head{text-align:center;font-size:10px;font-weight:700;letter-spacing:.12em;
  color:var(--text3);padding:10px 0;text-transform:uppercase}
.cal-cell{background:var(--surface);border:1px solid var(--border);border-radius:10px;
  padding:10px 10px;min-height:110px;cursor:pointer;transition:all .18s;position:relative;overflow:hidden;
  box-shadow:var(--shadow)}
.cal-cell:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:0 6px 24px rgba(59,114,212,.12)}
.cal-cell.empty{background:transparent;border-color:transparent;cursor:default;pointer-events:none;box-shadow:none}
.cal-cell.today{border-color:var(--accent);background:#f0f5ff}
.cal-cell.no-shift{opacity:.4}
.cal-date{font-family:'DM Mono',monospace;font-size:17px;font-weight:600;color:var(--text);margin-bottom:7px;line-height:1}
.today-dot{position:absolute;top:9px;right:9px;width:6px;height:6px;border-radius:50%;background:var(--accent)}
.cal-row{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:3px}
.cal-pill{font-size:9px;padding:2px 5px;border-radius:3px;font-weight:700;white-space:nowrap;line-height:1.5}
.cp-nurse{background:#dbeafe;color:#1d4ed8}
.cp-beauty{background:#d1fae5;color:#065f46}
.cp-doc{background:#fee2e2;color:#991b1b}
.cp-head{background:#fef9c3;color:#854d0e}
.cal-lbl{font-size:9px;color:var(--text3);margin-bottom:2px;font-weight:500}

/* DAY VIEW */
.day-wrap{max-width:1100px;margin:0 auto}
.day-hdr{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.back-btn{display:flex;align-items:center;gap:5px;padding:7px 14px;border-radius:7px;
  border:1px solid var(--border);background:var(--surface);color:var(--text2);
  cursor:pointer;font-size:12px;transition:all .15s;font-family:'Noto Sans SC',sans-serif;box-shadow:var(--shadow)}
.back-btn:hover{border-color:var(--accent);color:var(--accent)}
.day-title{font-size:20px;font-weight:700;color:var(--text)}
.day-sub{font-size:12px;color:var(--text2);margin-top:2px}

.summary-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px}
.scard{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;box-shadow:var(--shadow)}
.scard-title{font-size:10px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px;font-weight:600}
.scard-count{font-family:'DM Mono',monospace;font-size:28px;font-weight:700;line-height:1;margin-bottom:3px}
.scard-count.n{color:var(--nurse-c)} .scard-count.b{color:var(--beauty-c)} .scard-count.d{color:var(--doc-c)}
.scard-note{font-size:10px;color:var(--text3);margin-bottom:12px}
.shift-block{margin-bottom:8px}
.shift-tag{display:inline-block;font-size:9px;padding:2px 8px;border-radius:3px;font-weight:700;margin-bottom:5px;line-height:1.5}
.st-early{background:#dbeafe;color:#1e40af}
.st-late{background:#ede9fe;color:#5b21b6}
.st-mid{background:#e0f2fe;color:#075985}
.st-midlate{background:#d1fae5;color:#064e3b}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{font-size:11px;padding:3px 8px;border-radius:5px;background:var(--surface2);border:1px solid var(--border);color:var(--text);font-weight:500}
.chip.head{border-color:#fbbf24;color:#92400e;background:#fef9c3}
.chip.head::after{content:' 👑';font-size:9px}

.slot-box{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px;box-shadow:var(--shadow)}
.slot-box-hdr{padding:13px 18px;border-bottom:1px solid var(--border);background:var(--surface2)}
.slot-box-hdr-title{font-size:11px;color:var(--text2);letter-spacing:.08em;text-transform:uppercase;font-weight:700}
.slot-hint{font-size:10px;color:var(--text3);padding:8px 18px;border-bottom:1px solid var(--border);background:#fffbeb;line-height:1.6}
.slot-thead{display:grid;grid-template-columns:92px 1fr 70px 90px;
  padding:7px 18px;border-bottom:1px solid var(--border);background:var(--surface2);gap:12px}
.slot-th{font-size:9px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase;font-weight:700}
.slot-th:nth-child(3){text-align:right} .slot-th:nth-child(4){text-align:right}
.slot-row{display:grid;grid-template-columns:92px 1fr 70px 90px;
  padding:10px 18px;border-bottom:1px solid var(--border);gap:12px;align-items:center;transition:background .12s}
.slot-row:last-child{border-bottom:none}
.slot-row:hover{background:var(--surface2)}
.slot-row.zero-cap{opacity:.45;background:#fafafa}
.slot-time{font-family:'DM Mono',monospace;font-size:12px;color:var(--text2);display:flex;align-items:center;gap:5px}
.lunch-tag{font-size:8px;color:#92400e;background:#fef3c7;padding:1px 5px;border-radius:3px;font-weight:600;border:1px solid #fde68a}
.bar-wrap{position:relative;height:7px;background:var(--surface3);border-radius:4px;overflow:hidden}
.bar-fill{height:100%;border-radius:4px;transition:width .4s ease}
.bar-avail{background:linear-gradient(90deg,#34d399,#10b981)}
.bar-limited{background:linear-gradient(90deg,#fbbf24,#f59e0b)}
.bar-empty{background:#d1d5db}
.slot-cap{font-family:'DM Mono',monospace;font-size:13px;text-align:right;color:var(--text);font-weight:600}
.slot-badge{font-size:9px;padding:3px 8px;border-radius:4px;text-align:right;display:block;white-space:nowrap;font-weight:600}
.sb-avail{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}
.sb-limited{background:#fef3c7;color:#92400e;border:1px solid #fde68a}
.sb-none{background:#f3f4f6;color:#6b7280;border:1px solid #e5e7eb}

.doc-box{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:24px;box-shadow:var(--shadow)}
.doc-box-hdr{padding:13px 18px;border-bottom:1px solid var(--border);background:var(--surface2);font-size:11px;color:var(--text2);letter-spacing:.08em;text-transform:uppercase;font-weight:700}
.doc-row{display:flex;align-items:center;gap:14px;padding:13px 18px;border-bottom:1px solid var(--border)}
.doc-row:last-child{border-bottom:none}
.doc-avatar{width:36px;height:36px;border-radius:50%;background:#fee2e2;
  border:1px solid #fecaca;display:flex;align-items:center;justify-content:center;
  font-size:13px;font-weight:700;color:var(--doc-c);flex-shrink:0}
.doc-name{font-size:13px;font-weight:600;color:var(--text)}
.doc-onduty{display:inline-block;font-size:10px;padding:2px 8px;border-radius:4px;margin-top:3px;
  background:#fee2e2;color:#991b1b;border:1px solid #fecaca;font-weight:600}
.no-data{padding:20px;text-align:center;color:var(--text3);font-size:12px}

.overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:500}
.cfg-panel{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px;width:460px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.15)}
.cfg-title{font-size:16px;font-weight:700;margin-bottom:4px;color:var(--text)}
.cfg-sub{font-size:11px;color:var(--text3);margin-bottom:22px}
.cfg-lbl{font-size:10px;color:var(--text2);margin-bottom:5px;letter-spacing:.05em;font-weight:600}
.cfg-field{margin-bottom:14px}
.cfg-input{width:100%;padding:10px 12px;background:var(--bg);border:1px solid var(--border);
  border-radius:7px;color:var(--text);font-size:12px;font-family:'DM Mono',monospace;outline:none;transition:border-color .15s}
.cfg-input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(59,114,212,.1)}
.cfg-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}
.btn-pri{padding:9px 20px;border-radius:7px;background:var(--accent);color:#fff;border:none;
  cursor:pointer;font-size:12px;font-weight:700;font-family:'Noto Sans SC',sans-serif;transition:all .15s}
.btn-pri:hover{background:#2c5bbf}
.btn-ghost{padding:9px 16px;border-radius:7px;background:transparent;color:var(--text2);
  border:1px solid var(--border);cursor:pointer;font-size:12px;font-family:'Noto Sans SC',sans-serif;transition:all .15s}
.btn-ghost:hover{border-color:var(--accent);color:var(--accent)}

.loading{position:fixed;inset:0;background:rgba(245,246,248,.9);display:flex;flex-direction:column;
  align-items:center;justify-content:center;z-index:999}
.spinner{width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--accent);
  border-radius:50%;animation:spin .7s linear infinite}
.loading-txt{color:var(--text2);font-size:13px;margin-top:14px;font-weight:500}
.toast{position:fixed;bottom:20px;right:20px;background:var(--surface);border:1px solid var(--border);
  border-radius:9px;padding:12px 16px;font-size:12px;color:var(--text);z-index:999;
  max-width:320px;display:none;box-shadow:0 8px 32px rgba(0,0,0,.12);font-weight:500}

@media(max-width:700px){
  .summary-grid{grid-template-columns:1fr}
  .slot-thead,.slot-row{grid-template-columns:72px 1fr 50px 60px}
  .cal-cell{min-height:76px;padding:7px 6px}
  .cal-date{font-size:14px}
  .cal-pill{display:none}
  .legend{display:none}
}
</style>
</head>
<body>

<div class="loading" id="loading">
  <div class="spinner"></div>
  <div class="loading-txt" id="loadingTxt">正在连接服务器…</div>
</div>

<div class="overlay" id="cfgOverlay" style="display:none">
  <div class="cfg-panel">
    <div class="cfg-title">⚙ 服务器配置</div>
    <div class="cfg-sub">如果看板部署在自定义域名，请修改此处</div>
    <div class="cfg-field">
      <div class="cfg-lbl">API 服务器地址（留空使用当前域名）</div>
      <input class="cfg-input" id="cServer" placeholder="https://your-app.railway.app">
    </div>
    <div class="cfg-actions">
      <button class="btn-ghost" onclick="closeConfig()">取消</button>
      <button class="btn-pri" onclick="saveConfig()">保存并刷新</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<div class="topbar">
  <div class="logo">🏥 杭州中瑞 · 排班看板</div>
  <div class="sep"></div>
  <div class="month-nav">
    <button onclick="prevMonth()">‹</button>
    <div class="month-label" id="monthLabel"></div>
    <button onclick="nextMonth()">›</button>
  </div>
  <div class="topbar-right">
    <div class="legend">
      <div class="leg"><div class="leg-dot" style="background:var(--nurse-c)"></div>护士</div>
      <div class="leg"><div class="leg-dot" style="background:var(--beauty-c)"></div>美疗师</div>
      <div class="leg"><div class="leg-dot" style="background:var(--doc-c)"></div>医生</div>
    </div>
    <div class="sep"></div>
    <span class="conn-badge conn-err" id="connBadge">未连接</span>
    <button class="icon-btn" id="refreshBtn" onclick="doRefresh()" title="刷新">↻</button>
    <button class="icon-btn" onclick="openConfig()" title="设置">⚙</button>
  </div>
</div>

<div class="page active" id="pg-cal">
  <div class="cal-wrap">
    <div class="cal-grid" id="calGrid"></div>
  </div>
</div>

<div class="page" id="pg-day">
  <div class="day-wrap">
    <div class="day-hdr">
      <button class="back-btn" onclick="goBack()">← 返回日历</button>
      <div>
        <div class="day-title" id="dayTitle"></div>
        <div class="day-sub" id="daySub"></div>
      </div>
    </div>
    <div class="summary-grid" id="summaryGrid"></div>
    <div class="slot-box" id="slotBox"></div>
    <div class="doc-box" id="docBox"></div>
  </div>
</div>

<script>
const WD=['日','一','二','三','四','五','六'];
const NURSE_SHIFT={'早':{s:9.5,e:18.5},'晚':{s:11.5,e:20.5}};
const BOOK_S=10,BOOK_E=20,LUNCH_S=12,LUNCH_E=14,SLOT_MIN=30;

let SERVER=''; // 空=同域
let CY=new Date().getFullYear(), CM=new Date().getMonth();
let CACHE={};

window.addEventListener('DOMContentLoaded',()=>{
  SERVER=localStorage.getItem('zr_server')||'';
  renderMonthLabel();
  doRefresh();
});

function openConfig(){
  document.getElementById('cServer').value=SERVER;
  document.getElementById('cfgOverlay').style.display='flex';
}
function closeConfig(){ document.getElementById('cfgOverlay').style.display='none'; }
function saveConfig(){
  SERVER=document.getElementById('cServer').value.trim().replace(/\\/+$/,'');
  localStorage.setItem('zr_server',SERVER);
  closeConfig(); CACHE={}; doRefresh();
}

async function apiFetch(path){
  const base=SERVER||'';
  const r=await fetch(base+path);
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}

function tv(v){
  if(v===null||v===undefined) return null;
  if(typeof v==='string') return v.trim()||null;
  if(Array.isArray(v)) return v.map(x=>x.text||x.name||String(x)).join('').trim()||null;
  if(typeof v==='object'&&v.text) return String(v.text).trim()||null;
  return String(v).trim()||null;
}
function parseYM(raw){
  if(!raw) return null;
  const s=String(raw).replace(/[\\u2014\\u2013\\u2012—–]/g,'-');
  const m=s.match(/(\\d{4})[\\-\\/](\\d{1,2})/);
  if(!m) return null;
  return {year:parseInt(m[1]),month:parseInt(m[2])-1};
}
function p2(n){return String(n).padStart(2,'0')}
function fmtD(y,m,d){return \`\${y}-\${p2(m)}-\${p2(d)}\`}

async function loadMonth(year,month){
  const key=\`\${year}-\${month}\`;
  if(CACHE[key]) return CACHE[key];
  setLoading(true,'正在加载排班数据…');
  const data=await apiFetch(\`/api/month?year=\${year}&month=\${month+1}\`);
  CACHE[key]=data;
  return data;
}

function buildSlots(ns){
  const slots=[];
  for(let h=BOOK_S;h<BOOK_E;h++){
    for(let m=0;m<60;m+=SLOT_MIN){
      const eH=m+SLOT_MIN>=60?h+1:h, eM=(m+SLOT_MIN)%60;
      const tStr=\`\${p2(h)}:\${p2(m)}–\${p2(eH)}:\${p2(eM)}\`;
      const t=h+m/60;
      const earlyN=(ns.early||[]).filter(n=>!n.isHead&&t>=9.5&&t<18.5);
      const lateN=(ns.late||[]).filter(n=>!n.isHead&&t>=11.5&&t<20.5);
      let cap=earlyN.length+lateN.length;
      const isLunch=(t>=LUNCH_S&&t<LUNCH_E);
      if(isLunch) cap=Math.max(0,cap-1);
      slots.push({h,m,tStr,cap,isLunch});
    }
  }
  return slots;
}

async function renderCalendar(){
  const data=await loadMonth(CY,CM);
  const {nurseByDate,beautyByDate,doctorByDate,daysInMon}=data;
  const grid=document.getElementById('calGrid');
  grid.innerHTML='';
  ['日','一','二','三','四','五','六'].forEach(d=>{
    const el=document.createElement('div');
    el.className='cal-head';el.textContent=d;grid.appendChild(el);
  });
  const firstDay=new Date(CY,CM,1).getDay();
  const today=new Date();
  const todayStr=fmtD(today.getFullYear(),today.getMonth()+1,today.getDate());
  for(let i=0;i<firstDay;i++){
    const el=document.createElement('div');el.className='cal-cell empty';grid.appendChild(el);
  }
  for(let day=1;day<=daysInMon;day++){
    const ds=fmtD(CY,CM+1,day);
    const ns=nurseByDate[ds], bs=beautyByDate[ds], docs=doctorByDate[ds]||[];
    const isToday=ds===todayStr;
    const cell=document.createElement('div');
    cell.className='cal-cell'+(isToday?' today':'')+((!ns&&!bs)?' no-shift':'');
    cell.onclick=()=>openDay(ds);
    let html=\`<div class="cal-date">\${day}</div>\`;
    if(isToday) html+=\`<div class="today-dot"></div>\`;
    if(ns){
      const ec=(ns.early||[]).filter(n=>!n.isHead).length;
      const lc=(ns.late||[]).filter(n=>!n.isHead).length;
      const hc=(ns.early||[]).filter(n=>n.isHead).length+(ns.late||[]).filter(n=>n.isHead).length;
      html+=\`<div class="cal-lbl">护士</div><div class="cal-row">\`;
      if(ec) html+=\`<span class="cal-pill cp-nurse">早 \${ec}</span>\`;
      if(lc) html+=\`<span class="cal-pill cp-nurse">晚 \${lc}</span>\`;
      if(hc) html+=\`<span class="cal-pill cp-head">长 \${hc}</span>\`;
      html+=\`</div>\`;
    }
    if(bs){
      const total=Object.values(bs).flat().length;
      if(total){
        html+=\`<div class="cal-lbl">美疗</div><div class="cal-row">\`;
        [['早班','早'],['早中班','早中'],['中班','中'],['晚班','晚']].forEach(([k,s])=>{
          if(bs[k]&&bs[k].length) html+=\`<span class="cal-pill cp-beauty">\${s} \${bs[k].length}</span>\`;
        });
        html+=\`</div>\`;
      }
    }
    if(docs.length) html+=\`<div class="cal-row"><span class="cal-pill cp-doc">医 \${docs.length}</span></div>\`;
    cell.innerHTML=html;
    grid.appendChild(cell);
  }
  setLoading(false);
}

async function openDay(ds){
  const data=await loadMonth(CY,CM);
  const {nurseByDate,beautyByDate,doctorByDate}=data;
  const d=new Date(ds+'T00:00:00');
  const ns=nurseByDate[ds]||{early:[],late:[]};
  const bs=beautyByDate[ds]||{'早班':[],'早中班':[],'中班':[],'晚班':[]};
  const docs=doctorByDate[ds]||[];
  document.getElementById('dayTitle').textContent=\`\${d.getMonth()+1}月\${d.getDate()}日 星期\${WD[d.getDay()]}\`;
  document.getElementById('daySub').textContent='营业时段 10:00 — 20:00 · 每 30 分钟一档';
  const allN=[...(ns.early||[]),...(ns.late||[])];
  const bookN=allN.filter(n=>!n.isHead), headN=allN.filter(n=>n.isHead);
  const allB=Object.values(bs).flat();
  document.getElementById('summaryGrid').innerHTML=\`
    <div class="scard">
      <div class="scard-title">🩺 护士在岗</div>
      <div class="scard-count n">\${allN.length}<span style="font-size:14px;color:var(--text2);font-family:'Noto Sans SC'"> 人</span></div>
      <div class="scard-note">参与预约 \${bookN.length} 人 · 护士长 \${headN.length} 人（仅展示）</div>
      \${shiftBlock(ns.early,'早班','st-early')}\${shiftBlock(ns.late,'晚班','st-late')}
    </div>
    <div class="scard">
      <div class="scard-title">✨ 美疗师在岗</div>
      <div class="scard-count b">\${allB.length}<span style="font-size:14px;color:var(--text2);font-family:'Noto Sans SC'"> 人</span></div>
      <div class="scard-note">全员参与项目预约排班</div>
      \${beautyBlocks(bs)}
    </div>
    <div class="scard">
      <div class="scard-title">👨‍⚕️ 医生出诊</div>
      <div class="scard-count d">\${docs.length}<span style="font-size:14px;color:var(--text2);font-family:'Noto Sans SC'"> 位</span></div>
      <div class="scard-note">仅供展示，不参与预约占位</div>
      \${docs.length?docs.map(n=>\`<div style="font-size:12px;color:var(--text);margin-top:5px;font-weight:500">· \${n}</div>\`).join(''):'<div style="color:var(--text3);font-size:12px;margin-top:8px">今日无医生出诊</div>'}
    </div>\`;
  const slots=buildSlots(ns);
  const maxCap=Math.max(...slots.map(s=>s.cap),1);
  let slH=\`<div class="slot-box-hdr"><span class="slot-box-hdr-title">⏱ 每日预约时段 · 30 分钟档</span></div>
    <div class="slot-hint">护士早班 09:30–18:30，晚班 11:30–20:30。名额 = 当前时段在岗护士数（护士长不占名额）。午休 12:00–14:00 自动 −1。</div>
    <div class="slot-thead"><div class="slot-th">时间段</div><div class="slot-th">容量比例</div>
      <div class="slot-th" style="text-align:right">名额</div><div class="slot-th" style="text-align:right">状态</div></div>\`;
  slots.forEach(s=>{
    const pct=maxCap>0?Math.round(s.cap/maxCap*100):0;
    const bCls=s.cap===0?'bar-empty':pct>=60?'bar-avail':'bar-limited';
    const sCls=s.cap===0?'sb-none':pct>=60?'sb-avail':'sb-limited';
    const sLbl=s.cap===0?'暂停预约':pct>=60?'可预约':'名额紧张';
    slH+=\`<div class="slot-row\${s.cap===0?' zero-cap':''}">
      <div class="slot-time">\${s.tStr}\${s.isLunch?'<span class="lunch-tag">午休</span>':''}</div>
      <div class="bar-wrap"><div class="bar-fill \${bCls}" style="width:\${pct}%"></div></div>
      <div class="slot-cap">\${s.cap}</div>
      <div><span class="slot-badge \${sCls}">\${sLbl}</span></div></div>\`;
  });
  document.getElementById('slotBox').innerHTML=slH;
  let docH=\`<div class="doc-box-hdr">👨‍⚕️ 医生出诊 <span style="font-size:9px;font-weight:400;color:var(--text3)">（仅展示，不占预约名额）</span></div>\`;
  if(!docs.length) docH+=\`<div class="no-data">今日暂无医生出诊安排</div>\`;
  else docs.forEach(name=>{ docH+=\`<div class="doc-row"><div class="doc-avatar">\${name.slice(-1)}</div><div><div class="doc-name">\${name}</div><span class="doc-onduty">今日出诊</span></div></div>\`; });
  document.getElementById('docBox').innerHTML=docH;
  document.getElementById('pg-cal').classList.remove('active');
  document.getElementById('pg-day').classList.add('active');
  window.scrollTo(0,0);
}

function shiftBlock(list,label,cls){
  if(!list||!list.length) return '';
  return \`<div class="shift-block"><span class="shift-tag \${cls}">\${label}</span>
    <div class="chips">\${list.map(n=>\`<span class="chip\${n.isHead?' head':''}">\${n.name}</span>\`).join('')}</div></div>\`;
}
function beautyBlocks(bs){
  const cm={'早班':'st-early','早中班':'st-mid','中班':'st-midlate','晚班':'st-late'};
  return Object.entries(bs).map(([k,arr])=>{
    if(!arr.length) return '';
    return \`<div class="shift-block"><span class="shift-tag \${cm[k]||'st-early'}">\${k}</span>
      <div class="chips">\${arr.map(n=>\`<span class="chip">\${n.name}</span>\`).join('')}</div></div>\`;
  }).join('');
}
function goBack(){
  document.getElementById('pg-day').classList.remove('active');
  document.getElementById('pg-cal').classList.add('active');
}
function renderMonthLabel(){ document.getElementById('monthLabel').textContent=\`\${CY}.\${p2(CM+1)}\`; }
function prevMonth(){ CM--;if(CM<0){CM=11;CY--;}renderMonthLabel();doRefresh(); }
function nextMonth(){ CM++;if(CM>11){CM=0;CY++;}renderMonthLabel();doRefresh(); }
async function doRefresh(){
  document.getElementById('pg-day').classList.remove('active');
  document.getElementById('pg-cal').classList.add('active');
  const btn=document.getElementById('refreshBtn');
  btn.classList.add('refresh-spin');
  delete CACHE[\`\${CY}-\${CM}\`];
  try{ await renderCalendar(); setBadge(true); }
  catch(e){ setBadge(false); toast('⚠ '+(e.message||'加载失败')); setLoading(false); }
  btn.classList.remove('refresh-spin');
}
function setLoading(show,txt){ document.getElementById('loading').style.display=show?'flex':'none'; if(txt) document.getElementById('loadingTxt').textContent=txt; }
function setBadge(ok){ const el=document.getElementById('connBadge'); el.textContent=ok?'已连接':'连接失败'; el.className='conn-badge '+(ok?'conn-ok':'conn-err'); }
function toast(msg,ms=5000){ const el=document.getElementById('toast'); el.textContent=msg; el.style.display='block'; clearTimeout(el._t); el._t=setTimeout(()=>el.style.display='none',ms); }
<\/script>
</body>
</html>`;

// ── HTTP Server
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseRecords(recs, year, month) {
  const daysInMon = new Date(year, month, 0).getDate();

  function tv(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v.trim() || null;
    if (Array.isArray(v)) return v.map(x => x.text || x.name || String(x)).join('').trim() || null;
    if (typeof v === 'object' && v.text) return String(v.text).trim() || null;
    return String(v).trim() || null;
  }

  function parseYM(raw) {
    if (!raw) return null;
    const s = String(raw).replace(/[—–\u2014\u2013]/g, '-');
    const m = s.match(/(\d{4})[-\/](\d{1,2})/);
    if (!m) return null;
    return { year: parseInt(m[1]), month: parseInt(m[2]) };
  }

  function p2(n) { return String(n).padStart(2, '0'); }

  const nurseByDate = {}, beautyByDate = {}, doctorByDate = {};
  const bKeys = ['早班','早中班','中班','晚班'];

  // Nurse records
  (recs.nurse || []).forEach(rec => {
    const f = rec.fields;
    const ym = parseYM(tv(f['年月']));
    if (!ym || ym.year !== year || ym.month !== month) return;
    const name = tv(f['姓名']); if (!name || name === '/') return;
    const isHead = (tv(f['角色']) || '').includes('护士长');

    for (let day = 1; day <= daysInMon; day++) {
      const val = tv(f[`${day}号`]);
      if (!val || val === '休') continue;
      const ds = `${year}-${p2(month)}-${p2(day)}`;
      if (!nurseByDate[ds]) nurseByDate[ds] = { early: [], late: [] };
      const entry = { name, isHead };
      if (val === '早') nurseByDate[ds].early.push(entry);
      else if (val === '晚') nurseByDate[ds].late.push(entry);
    }
  });

  // Beauty records
  (recs.beauty || []).forEach(rec => {
    const f = rec.fields;
    const ym = parseYM(tv(f['年月']));
    if (!ym || ym.year !== year || ym.month !== month) return;
    const name = tv(f['姓名']); if (!name || name === '/') return;

    for (let day = 1; day <= daysInMon; day++) {
      const val = tv(f[`${day}号`]);
      if (!val || val === '休') continue;
      const ds = `${year}-${p2(month)}-${p2(day)}`;
      if (!beautyByDate[ds]) { beautyByDate[ds] = {}; bKeys.forEach(k => beautyByDate[ds][k] = []); }
      const sk = bKeys.includes(val) ? val : '早班';
      beautyByDate[ds][sk].push({ name });
    }
  });

  // Doctor records
  (recs.doctor || []).forEach(rec => {
    const f = rec.fields;
    const ym = parseYM(tv(f['年月']));
    if (!ym || ym.year !== year || ym.month !== month) return;
    const name = tv(f['姓名']); if (!name || name === '/') return;

    for (let day = 1; day <= daysInMon; day++) {
      const val = tv(f[`${day}号`]);
      if (val !== '出诊') continue;
      const ds = `${year}-${p2(month)}-${p2(day)}`;
      if (!doctorByDate[ds]) doctorByDate[ds] = [];
      doctorByDate[ds].push(name);
    }
  });

  return { nurseByDate, beautyByDate, doctorByDate, daysInMon };
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Serve dashboard HTML
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  // API: /api/month?year=2026&month=4
  if (url.pathname === '/api/month') {
    const year  = parseInt(url.searchParams.get('year'))  || new Date().getFullYear();
    const month = parseInt(url.searchParams.get('month')) || (new Date().getMonth() + 1);
    try {
      const [nurseRecs, beautyRecs, doctorRecs] = await Promise.all([
        fetchAllRecords(TABLES.nurse),
        fetchAllRecords(TABLES.beauty),
        fetchAllRecords(TABLES.doctor),
      ]);
      const result = parseRecords({ nurse: nurseRecs, beauty: beautyRecs, doctor: doctorRecs }, year, month);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`✅ 排班看板运行在 http://localhost:${PORT}`));
