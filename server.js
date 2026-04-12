const http = require('http');
const https = require('https');

const APP_ID     = process.env.FEISHU_APP_ID     || 'cli_a950b6f99fb95bc8';
const APP_SECRET = process.env.FEISHU_APP_SECRET || 'E0q21M4FHBqZDNYZCN73mdFNktoxhTOy';
const APP_TOKEN  = process.env.FEISHU_APP_TOKEN  || 'PPSkb00lkaxMnusHZAJcFBainAg';
const PORT       = process.env.PORT || 3000;

const TABLES = {
  nurse:  'tbl5TJfpAgRxJ1W6',
  beauty: 'tblnHRQVvEvU9L9U',
  doctor: 'tbl4eYxLA06rpNf0',
};

let tokenCache = { token: null, exp: 0 };

function fetchJSON(url, opts) {
  opts = opts || {};
  return new Promise(function(resolve, reject) {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    };
    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON error: ' + data.slice(0,200))); }
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

async function fetchAll(tableId) {
  const token = await getToken();
  let all = [], pt = null;
  do {
    let url = 'https://open.feishu.cn/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + tableId + '/records?page_size=500';
    if (pt) url += '&page_token=' + pt;
    const d = await fetchJSON(url, { headers: { Authorization: 'Bearer ' + token } });
    if (d.code !== 0) throw new Error('读取失败: ' + d.msg);
    all = all.concat(d.data.items || []);
    pt = d.data.has_more ? d.data.page_token : null;
  } while (pt);
  return all;
}

function tv(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (Array.isArray(v)) return v.map(function(x) { return x.text || x.name || String(x); }).join('').trim() || null;
  if (typeof v === 'object' && v.text) return String(v.text).trim() || null;
  return String(v).trim() || null;
}

function parseYM(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/[\u2014\u2013\u2012\-]/g, '-');
  const m = s.match(/(\d{4})-(\d{1,2})/);
  if (!m) return null;
  return { year: parseInt(m[1]), month: parseInt(m[2]) };
}

function p2(n) { return String(n).padStart(2, '0'); }

function parseMonthData(nurseRecs, beautyRecs, docRecs, year, month) {
  const daysInMon = new Date(year, month, 0).getDate();
  const nurseByDate = {}, beautyByDate = {}, doctorByDate = {};
  const bKeys = ['早班','早中班','中班','晚班'];

  nurseRecs.forEach(function(rec) {
    const f = rec.fields;
    const ym = parseYM(tv(f['年月']));
    if (!ym || ym.year !== year || ym.month !== month) return;
    const name = tv(f['姓名']);
    if (!name || name === '/') return;
    const isHead = (tv(f['角色']) || '').includes('护士长');
    for (let day = 1; day <= daysInMon; day++) {
      const val = tv(f[day + '号']);
      if (!val || val === '休') continue;
      const ds = year + '-' + p2(month) + '-' + p2(day);
      if (!nurseByDate[ds]) nurseByDate[ds] = { early: [], late: [] };
      if (val === '早') nurseByDate[ds].early.push({ name: name, isHead: isHead });
      else if (val === '晚') nurseByDate[ds].late.push({ name: name, isHead: isHead });
    }
  });

  beautyRecs.forEach(function(rec) {
    const f = rec.fields;
    const ym = parseYM(tv(f['年月']));
    if (!ym || ym.year !== year || ym.month !== month) return;
    const name = tv(f['姓名']);
    if (!name || name === '/') return;
    for (let day = 1; day <= daysInMon; day++) {
      const val = tv(f[day + '号']);
      if (!val || val === '休') continue;
      const ds = year + '-' + p2(month) + '-' + p2(day);
      if (!beautyByDate[ds]) { beautyByDate[ds] = {}; bKeys.forEach(function(k) { beautyByDate[ds][k] = []; }); }
      const sk = bKeys.indexOf(val) >= 0 ? val : '早班';
      beautyByDate[ds][sk].push({ name: name });
    }
  });

  docRecs.forEach(function(rec) {
    const f = rec.fields;
    const ym = parseYM(tv(f['年月']));
    if (!ym || ym.year !== year || ym.month !== month) return;
    const name = tv(f['姓名']);
    if (!name || name === '/') return;
    for (let day = 1; day <= daysInMon; day++) {
      const val = tv(f[day + '号']);
      if (val !== '出诊') continue;
      const ds = year + '-' + p2(month) + '-' + p2(day);
      if (!doctorByDate[ds]) doctorByDate[ds] = [];
      doctorByDate[ds].push(name);
    }
  });

  return { nurseByDate: nurseByDate, beautyByDate: beautyByDate, doctorByDate: doctorByDate, daysInMon: daysInMon };
}

// ── HTML（浅色主题，内嵌）
const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>杭州中瑞 · 排班看板</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#f4f6f9;--surface:#fff;--s2:#f0f2f6;--s3:#e8ebf2;--bd:#e2e6ed;
  --accent:#3b72d4;--g:#0d9f6e;--r:#e0344f;--y:#c07a00;
  --nc:#3b72d4;--bc:#0d9f6e;--dc:#e0344f;--hc:#c07a00;
  --t:#1a2035;--t2:#5a6380;--t3:#9aa3b8;
  --sh:0 1px 3px rgba(0,0,0,.06),0 4px 12px rgba(0,0,0,.04)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Sans SC',sans-serif;background:var(--bg);color:var(--t);min-height:100vh}
/* topbar */
.tb{position:sticky;top:0;z-index:100;background:rgba(255,255,255,.96);backdrop-filter:blur(12px);
  border-bottom:1px solid var(--bd);height:54px;display:flex;align-items:center;padding:0 20px;gap:14px;
  box-shadow:0 1px 6px rgba(0,0,0,.06)}
.logo{font-size:14px;font-weight:700;color:var(--accent);white-space:nowrap}
.sep{width:1px;height:18px;background:var(--bd)}
.mnav{display:flex;align-items:center;gap:5px}
.mnav button{width:26px;height:26px;border-radius:6px;border:1px solid var(--bd);background:var(--s2);
  color:var(--t2);cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;transition:all .15s}
.mnav button:hover{border-color:var(--accent);color:var(--accent)}
.mlbl{font-family:'DM Mono',monospace;font-size:13px;font-weight:500;min-width:68px;text-align:center}
.tr{margin-left:auto;display:flex;align-items:center;gap:8px}
.leg{display:flex;align-items:center;gap:12px}
.li{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--t2)}
.ld{width:6px;height:6px;border-radius:50%}
.cb{font-size:10px;padding:3px 7px;border-radius:4px;font-weight:600}
.ok{background:#dcfce7;color:#166534;border:1px solid #bbf7d0}
.er{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}
.ib{width:26px;height:26px;border-radius:6px;border:1px solid var(--bd);background:var(--s2);
  color:var(--t2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;transition:all .2s}
.ib:hover{border-color:var(--accent);color:var(--accent)}
.spin{animation:sp .6s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
/* pages */
.pg{display:none;padding:18px}.pg.on{display:block}
/* calendar */
.cw{max-width:1080px;margin:0 auto}
.cg{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
.ch{text-align:center;font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--t3);padding:8px 0}
.cc{background:var(--surface);border:1px solid var(--bd);border-radius:9px;padding:9px 8px;
  min-height:104px;cursor:pointer;transition:all .18s;position:relative;overflow:hidden;box-shadow:var(--sh)}
.cc:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:0 6px 20px rgba(59,114,212,.1)}
.cc.em{background:transparent;border-color:transparent;cursor:default;pointer-events:none;box-shadow:none}
.cc.td{border-color:var(--accent);background:#eff5ff}
.cc.ns{opacity:.38}
.cd{font-family:'DM Mono',monospace;font-size:15px;font-weight:600;color:var(--t);margin-bottom:6px}
.tdot{position:absolute;top:8px;right:8px;width:5px;height:5px;border-radius:50%;background:var(--accent)}
.cr{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:3px}
.cp{font-size:9px;padding:2px 4px;border-radius:3px;font-weight:700;white-space:nowrap;line-height:1.4}
.pn{background:#dbeafe;color:#1d4ed8}.pb{background:#d1fae5;color:#065f46}
.pd{background:#fee2e2;color:#991b1b}.ph{background:#fef9c3;color:#854d0e}
.cl{font-size:9px;color:var(--t3);margin-bottom:2px;font-weight:500}
/* day view */
.dw{max-width:1080px;margin:0 auto}
.dhdr{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.bb{display:flex;align-items:center;gap:4px;padding:6px 12px;border-radius:7px;
  border:1px solid var(--bd);background:var(--surface);color:var(--t2);cursor:pointer;
  font-size:12px;transition:all .15s;font-family:'Noto Sans SC',sans-serif;box-shadow:var(--sh)}
.bb:hover{border-color:var(--accent);color:var(--accent)}
.dtitle{font-size:19px;font-weight:700}.dsub{font-size:11px;color:var(--t2);margin-top:2px}
/* summary */
.sg{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px}
.sc{background:var(--surface);border:1px solid var(--bd);border-radius:11px;padding:15px;box-shadow:var(--sh)}
.st{font-size:10px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;font-weight:700}
.sn{font-family:'DM Mono',monospace;font-size:26px;font-weight:700;line-height:1;margin-bottom:3px}
.sn.n{color:var(--nc)}.sn.b{color:var(--bc)}.sn.d{color:var(--dc)}
.snote{font-size:10px;color:var(--t3);margin-bottom:10px}
.sb2{margin-bottom:7px}
.stag{display:inline-block;font-size:9px;padding:2px 7px;border-radius:3px;font-weight:700;margin-bottom:4px;line-height:1.4}
.se{background:#dbeafe;color:#1e40af}.sl{background:#ede9fe;color:#5b21b6}
.sm{background:#e0f2fe;color:#075985}.sml{background:#d1fae5;color:#064e3b}
.chips{display:flex;flex-wrap:wrap;gap:3px}
.chip{font-size:11px;padding:3px 7px;border-radius:5px;background:var(--s2);border:1px solid var(--bd);color:var(--t);font-weight:500}
.chip.hd{border-color:#fbbf24;color:#92400e;background:#fef9c3}
.chip.hd::after{content:' 👑';font-size:9px}
/* slots */
.slbox{background:var(--surface);border:1px solid var(--bd);border-radius:11px;overflow:hidden;margin-bottom:14px;box-shadow:var(--sh)}
.slhdr{padding:11px 16px;border-bottom:1px solid var(--bd);background:var(--s2);
  font-size:11px;color:var(--t2);letter-spacing:.08em;text-transform:uppercase;font-weight:700}
.slhint{font-size:10px;color:var(--t3);padding:7px 16px;border-bottom:1px solid var(--bd);background:#fffbeb;line-height:1.5}
.slth{display:grid;grid-template-columns:90px 1fr 60px 80px;padding:6px 16px;
  border-bottom:1px solid var(--bd);background:var(--s2);gap:10px}
.slth div{font-size:9px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase;font-weight:700}
.slth div:nth-child(3),.slth div:nth-child(4){text-align:right}
.slrow{display:grid;grid-template-columns:90px 1fr 60px 80px;padding:9px 16px;
  border-bottom:1px solid var(--bd);gap:10px;align-items:center;transition:background .1s}
.slrow:last-child{border-bottom:none}
.slrow:hover{background:var(--s2)}
.slrow.zc{opacity:.4}
.slt{font-family:'DM Mono',monospace;font-size:11px;color:var(--t2);display:flex;align-items:center;gap:4px}
.ltag{font-size:8px;color:#92400e;background:#fef3c7;padding:1px 4px;border-radius:3px;font-weight:600;border:1px solid #fde68a}
.bw{height:6px;background:var(--s3);border-radius:3px;overflow:hidden}
.bf{height:100%;border-radius:3px;transition:width .3s}
.ba{background:linear-gradient(90deg,#34d399,#10b981)}
.bm{background:linear-gradient(90deg,#fbbf24,#f59e0b)}
.bn{background:#d1d5db}
.slcap{font-family:'DM Mono',monospace;font-size:12px;text-align:right;font-weight:700}
.slbdg{font-size:9px;padding:2px 7px;border-radius:3px;display:block;text-align:right;white-space:nowrap;font-weight:600}
.bav{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}
.bli{background:#fef3c7;color:#92400e;border:1px solid #fde68a}
.bno{background:#f3f4f6;color:#6b7280;border:1px solid #e5e7eb}
/* doctors */
.docbox{background:var(--surface);border:1px solid var(--bd);border-radius:11px;overflow:hidden;margin-bottom:20px;box-shadow:var(--sh)}
.dochdr{padding:11px 16px;border-bottom:1px solid var(--bd);background:var(--s2);
  font-size:11px;color:var(--t2);letter-spacing:.08em;text-transform:uppercase;font-weight:700}
.docrow{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--bd)}
.docrow:last-child{border-bottom:none}
.dav{width:34px;height:34px;border-radius:50%;background:#fee2e2;border:1px solid #fecaca;
  display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--dc);flex-shrink:0}
.dname{font-size:13px;font-weight:600}
.donduty{display:inline-block;font-size:10px;padding:2px 7px;border-radius:4px;margin-top:2px;
  background:#fee2e2;color:#991b1b;border:1px solid #fecaca;font-weight:600}
.nodata{padding:16px;text-align:center;color:var(--t3);font-size:12px}
/* loading */
.ld-overlay{position:fixed;inset:0;background:rgba(244,246,249,.9);display:flex;flex-direction:column;
  align-items:center;justify-content:center;z-index:999}
.ld-spinner{width:34px;height:34px;border:3px solid var(--bd);border-top-color:var(--accent);
  border-radius:50%;animation:sp .7s linear infinite}
.ld-txt{color:var(--t2);font-size:12px;margin-top:12px;font-weight:500}
.toast{position:fixed;bottom:18px;right:18px;background:var(--surface);border:1px solid var(--bd);
  border-radius:8px;padding:10px 14px;font-size:12px;color:var(--t);z-index:999;
  max-width:300px;display:none;box-shadow:0 6px 24px rgba(0,0,0,.1);font-weight:500}
@media(max-width:680px){
  .sg{grid-template-columns:1fr}
  .slth,.slrow{grid-template-columns:70px 1fr 44px 56px}
  .cc{min-height:70px;padding:6px 5px}.cd{font-size:13px}.cp{display:none}.leg{display:none}
}
</style>
</head>
<body>
<div class="ld-overlay" id="LD"><div class="ld-spinner"></div><div class="ld-txt" id="LT">正在加载…</div></div>
<div class="toast" id="toast"></div>

<div class="tb">
  <div class="logo">🏥 杭州中瑞 · 排班看板</div>
  <div class="sep"></div>
  <div class="mnav">
    <button onclick="prevM()">‹</button>
    <div class="mlbl" id="ML"></div>
    <button onclick="nextM()">›</button>
  </div>
  <div class="tr">
    <div class="leg">
      <div class="li"><div class="ld" style="background:var(--nc)"></div>护士</div>
      <div class="li"><div class="ld" style="background:var(--bc)"></div>美疗师</div>
      <div class="li"><div class="ld" style="background:var(--dc)"></div>医生</div>
    </div>
    <div class="sep"></div>
    <span class="cb er" id="CB">未连接</span>
    <button class="ib spin" id="RB" onclick="doRefresh()" title="刷新">↻</button>
  </div>
</div>

<div class="pg on" id="pg-cal"><div class="cw"><div class="cg" id="CG"></div></div></div>
<div class="pg" id="pg-day">
  <div class="dw">
    <div class="dhdr">
      <button class="bb" onclick="goBack()">← 返回日历</button>
      <div><div class="dtitle" id="DT"></div><div class="dsub" id="DS"></div></div>
    </div>
    <div class="sg" id="SG"></div>
    <div class="slbox" id="SL"></div>
    <div class="docbox" id="DB"></div>
  </div>
</div>

<script>
const WD=['日','一','二','三','四','五','六'];
let CY=new Date().getFullYear(), CM=new Date().getMonth(), CACHE={};

function p2(n){return String(n).padStart(2,'0')}
function fmtD(y,m,d){return y+'-'+p2(m)+'-'+p2(d)}

window.addEventListener('DOMContentLoaded',function(){
  setML(); doRefresh();
});

async function loadMonth(y,m){
  const k=y+'-'+m;
  if(CACHE[k]) return CACHE[k];
  setLD(true,'正在加载排班数据…');
  const r=await fetch('/api/month?year='+y+'&month='+(m+1));
  if(!r.ok) throw new Error('HTTP '+r.status);
  const d=await r.json();
  if(d.error) throw new Error(d.error);
  CACHE[k]=d; return d;
}

function buildSlots(ns){
  const slots=[];
  for(let h=10;h<20;h++){
    for(let m=0;m<60;m+=30){
      const eH=m+30>=60?h+1:h, eM=(m+30)%60;
      const t=h+m/60;
      const en=(ns.early||[]).filter(function(n){return !n.isHead&&t>=9.5&&t<18.5;});
      const ln=(ns.late||[]).filter(function(n){return !n.isHead&&t>=11.5&&t<20.5;});
      let cap=en.length+ln.length;
      const il=(t>=12&&t<14); if(il) cap=Math.max(0,cap-1);
      slots.push({tStr:p2(h)+':'+p2(m)+'–'+p2(eH)+':'+p2(eM),cap:cap,isLunch:il});
    }
  }
  return slots;
}

async function renderCal(){
  const data=await loadMonth(CY,CM);
  const {nurseByDate,beautyByDate,doctorByDate,daysInMon}=data;
  const g=document.getElementById('CG'); g.innerHTML='';
  ['日','一','二','三','四','五','六'].forEach(function(d){
    const e=document.createElement('div');e.className='ch';e.textContent=d;g.appendChild(e);
  });
  const fd=new Date(CY,CM,1).getDay();
  const td=new Date(); const ts=fmtD(td.getFullYear(),td.getMonth()+1,td.getDate());
  for(let i=0;i<fd;i++){const e=document.createElement('div');e.className='cc em';g.appendChild(e);}
  for(let day=1;day<=daysInMon;day++){
    const ds=fmtD(CY,CM+1,day);
    const ns=nurseByDate[ds],bs=beautyByDate[ds],docs=doctorByDate[ds]||[];
    const c=document.createElement('div');
    c.className='cc'+(ds===ts?' td':'')+((!ns&&!bs)?' ns':'');
    c.onclick=function(){openDay(ds);};
    let h='<div class="cd">'+day+'</div>';
    if(ds===ts) h+='<div class="tdot"></div>';
    if(ns){
      const ec=(ns.early||[]).filter(function(n){return !n.isHead;}).length;
      const lc=(ns.late||[]).filter(function(n){return !n.isHead;}).length;
      const hc=(ns.early||[]).filter(function(n){return n.isHead;}).length+(ns.late||[]).filter(function(n){return n.isHead;}).length;
      h+='<div class="cl">护士</div><div class="cr">';
      if(ec) h+='<span class="cp pn">早 '+ec+'</span>';
      if(lc) h+='<span class="cp pn">晚 '+lc+'</span>';
      if(hc) h+='<span class="cp ph">长 '+hc+'</span>';
      h+='</div>';
    }
    if(bs){
      const tot=Object.values(bs).reduce(function(a,b){return a+b.length;},0);
      if(tot){
        h+='<div class="cl">美疗</div><div class="cr">';
        [['早班','早'],['早中班','早中'],['中班','中'],['晚班','晚']].forEach(function(x){
          if(bs[x[0]]&&bs[x[0]].length) h+='<span class="cp pb">'+x[1]+' '+bs[x[0]].length+'</span>';
        });
        h+='</div>';
      }
    }
    if(docs.length) h+='<div class="cr"><span class="cp pd">医 '+docs.length+'</span></div>';
    c.innerHTML=h; g.appendChild(c);
  }
  setLD(false);
}

async function openDay(ds){
  const data=await loadMonth(CY,CM);
  const {nurseByDate,beautyByDate,doctorByDate}=data;
  const d=new Date(ds+'T00:00:00');
  const ns=nurseByDate[ds]||{early:[],late:[]};
  const bs=beautyByDate[ds]||{'早班':[],'早中班':[],'中班':[],'晚班':[]};
  const docs=doctorByDate[ds]||[];
  document.getElementById('DT').textContent=(d.getMonth()+1)+'月'+d.getDate()+'日 星期'+WD[d.getDay()];
  document.getElementById('DS').textContent='营业时段 10:00 — 20:00 · 每 30 分钟一档';
  const allN=[].concat(ns.early||[]).concat(ns.late||[]);
  const bookN=allN.filter(function(n){return !n.isHead;});
  const headN=allN.filter(function(n){return n.isHead;});
  const allB=Object.values(bs).reduce(function(a,b){return a.concat(b);},[]);
  document.getElementById('SG').innerHTML=
    '<div class="sc"><div class="st">🩺 护士在岗</div>'+
    '<div class="sn n">'+allN.length+'<span style="font-size:13px;color:var(--t2);font-family:\'Noto Sans SC\'"> 人</span></div>'+
    '<div class="snote">参与预约 '+bookN.length+' 人 · 护士长 '+headN.length+' 人（仅展示）</div>'+
    shiftB(ns.early,'早班','se')+shiftB(ns.late,'晚班','sl')+'</div>'+
    '<div class="sc"><div class="st">✨ 美疗师在岗</div>'+
    '<div class="sn b">'+allB.length+'<span style="font-size:13px;color:var(--t2);font-family:\'Noto Sans SC\'"> 人</span></div>'+
    '<div class="snote">全员参与项目预约排班</div>'+beautyB(bs)+'</div>'+
    '<div class="sc"><div class="st">👨‍⚕️ 医生出诊</div>'+
    '<div class="sn d">'+docs.length+'<span style="font-size:13px;color:var(--t2);font-family:\'Noto Sans SC\'"> 位</span></div>'+
    '<div class="snote">仅供展示，不参与预约</div>'+
    (docs.length?docs.map(function(n){return '<div style="font-size:12px;color:var(--t);margin-top:4px;font-weight:500">· '+n+'</div>';}).join(''):'<div style="color:var(--t3);font-size:12px;margin-top:6px">今日无医生出诊</div>')+
    '</div>';
  const slots=buildSlots(ns);
  const mc=Math.max.apply(null,slots.map(function(s){return s.cap;}).concat([1]));
  let sl='<div class="slhdr">⏱ 预约时段容量（每 30 分钟）</div>'+
    '<div class="slhint">护士早班 09:30–18:30，晚班 11:30–20:30。容量 = 当前时段在岗护士数（护士长不占名额）。午休 12:00–14:00 自动 −1。</div>'+
    '<div class="slth"><div>时间段</div><div>容量比例</div><div>名额</div><div>状态</div></div>';
  slots.forEach(function(s){
    const pct=mc>0?Math.round(s.cap/mc*100):0;
    const bc=s.cap===0?'bn':pct>=60?'ba':'bm';
    const sc=s.cap===0?'bno':pct>=60?'bav':'bli';
    const sl2=s.cap===0?'暂停预约':pct>=60?'可预约':'名额紧张';
    sl+='<div class="slrow'+(s.cap===0?' zc':'')+'">'+
      '<div class="slt">'+s.tStr+(s.isLunch?'<span class="ltag">午休</span>':'')+'</div>'+
      '<div class="bw"><div class="bf '+bc+'" style="width:'+pct+'%"></div></div>'+
      '<div class="slcap">'+s.cap+'</div>'+
      '<div><span class="slbdg '+sc+'">'+sl2+'</span></div></div>';
  });
  document.getElementById('SL').innerHTML=sl;
  let db='<div class="dochdr">👨‍⚕️ 医生出诊 <span style="font-size:9px;font-weight:400;color:var(--t3)">（仅展示，不占预约名额）</span></div>';
  if(!docs.length) db+='<div class="nodata">今日暂无医生出诊安排</div>';
  else docs.forEach(function(n){db+='<div class="docrow"><div class="dav">'+n.slice(-1)+'</div><div><div class="dname">'+n+'</div><span class="donduty">今日出诊</span></div></div>';});
  document.getElementById('DB').innerHTML=db;
  document.getElementById('pg-cal').classList.remove('on');
  document.getElementById('pg-day').classList.add('on');
  window.scrollTo(0,0);
}

function shiftB(list,label,cls){
  if(!list||!list.length) return '';
  return '<div class="sb2"><span class="stag '+cls+'">'+label+'</span>'+
    '<div class="chips">'+list.map(function(n){return '<span class="chip'+(n.isHead?' hd':'')+'">'+ n.name+'</span>';}).join('')+'</div></div>';
}
function beautyB(bs){
  const cm={'早班':'se','早中班':'sm','中班':'sml','晚班':'sl'};
  return Object.entries(bs).map(function(e){
    if(!e[1].length) return '';
    return '<div class="sb2"><span class="stag '+(cm[e[0]]||'se')+'">'+e[0]+'</span>'+
      '<div class="chips">'+e[1].map(function(n){return '<span class="chip">'+n.name+'</span>';}).join('')+'</div></div>';
  }).join('');
}
function goBack(){
  document.getElementById('pg-day').classList.remove('on');
  document.getElementById('pg-cal').classList.add('on');
}
function setML(){ document.getElementById('ML').textContent=CY+'.'+p2(CM+1); }
function prevM(){ CM--;if(CM<0){CM=11;CY--;}setML();doRefresh(); }
function nextM(){ CM++;if(CM>11){CM=0;CY++;}setML();doRefresh(); }
async function doRefresh(){
  document.getElementById('pg-day').classList.remove('on');
  document.getElementById('pg-cal').classList.add('on');
  const rb=document.getElementById('RB'); rb.classList.add('spin');
  delete CACHE[CY+'-'+CM];
  try{ await renderCal(); setBadge(true); }
  catch(e){ setBadge(false); showToast('⚠ '+(e.message||'加载失败')); setLD(false); }
  rb.classList.remove('spin');
}
function setLD(s,t){ document.getElementById('LD').style.display=s?'flex':'none'; if(t) document.getElementById('LT').textContent=t; }
function setBadge(ok){ const e=document.getElementById('CB'); e.textContent=ok?'已连接':'连接失败'; e.className='cb '+(ok?'ok':'er'); }
function showToast(msg){ const e=document.getElementById('toast'); e.textContent=msg; e.style.display='block'; clearTimeout(e._t); e._t=setTimeout(function(){e.style.display='none';},5000); }
<\/script>
</body>
</html>`;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
}

const server = http.createServer(async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://localhost:' + PORT);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (url.pathname === '/api/month') {
    const year  = parseInt(url.searchParams.get('year'))  || new Date().getFullYear();
    const month = parseInt(url.searchParams.get('month')) || (new Date().getMonth() + 1);
    try {
      const results = await Promise.all([
        fetchAll(TABLES.nurse),
        fetchAll(TABLES.beauty),
        fetchAll(TABLES.doctor),
      ]);
      const result = parseMonthData(results[0], results[1], results[2], year, month);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, function() {
  console.log('排班看板已启动 port=' + PORT);
});
