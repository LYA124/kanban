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
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, function(res) {
      let data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON error')); }
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
  if (d.code !== 0) throw new Error('Token failed: ' + d.msg);
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
    if (d.code !== 0) throw new Error('Read failed: ' + d.msg);
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
  const s = String(raw).replace(/[—–]/g, '-');
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
      if (!beautyByDate[ds]) {
        beautyByDate[ds] = {};
        bKeys.forEach(function(k) { beautyByDate[ds][k] = []; });
      }
      const sk = bKeys.indexOf(val) >= 0 ? val : bKeys[0];
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

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
}

// HTML完全用双引号，不含任何单引号转义
const HTML = "<!DOCTYPE html>\n" +
"<html lang=\"zh-CN\">\n" +
"<head>\n" +
"<meta charset=\"UTF-8\">\n" +
"<meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\">\n" +
"<title>杭州中瑞 · 排班看板</title>\n" +
"<link href=\"https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap\" rel=\"stylesheet\">\n" +
"<style>\n" +
":root{--bg:#f4f6f9;--sf:#fff;--s2:#f0f2f6;--s3:#e8ebf2;--bd:#e2e6ed;\n" +
"--ac:#3b72d4;--nc:#3b72d4;--bc:#0d9f6e;--dc:#e0344f;--hc:#c07a00;\n" +
"--t:#1a2035;--t2:#5a6380;--t3:#9aa3b8;\n" +
"--sh:0 1px 3px rgba(0,0,0,.06),0 4px 12px rgba(0,0,0,.04)}\n" +
"*{margin:0;padding:0;box-sizing:border-box}\n" +
"body{font-family:\"Noto Sans SC\",sans-serif;background:var(--bg);color:var(--t);min-height:100vh}\n" +
".tb{position:sticky;top:0;z-index:100;background:rgba(255,255,255,.96);backdrop-filter:blur(12px);border-bottom:1px solid var(--bd);height:54px;display:flex;align-items:center;padding:0 20px;gap:14px;box-shadow:0 1px 6px rgba(0,0,0,.06)}\n" +
".logo{font-size:14px;font-weight:700;color:var(--ac);white-space:nowrap}\n" +
".sep{width:1px;height:18px;background:var(--bd)}\n" +
".mnav{display:flex;align-items:center;gap:5px}\n" +
".mnav button{width:28px;height:28px;border-radius:6px;border:1px solid var(--bd);background:var(--s2);color:var(--t2);cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;transition:all .15s}\n" +
".mnav button:hover{border-color:var(--ac);color:var(--ac)}\n" +
".mlbl{font-family:\"DM Mono\",monospace;font-size:13px;font-weight:500;min-width:68px;text-align:center}\n" +
".tr{margin-left:auto;display:flex;align-items:center;gap:8px}\n" +
".leg{display:flex;align-items:center;gap:12px}\n" +
".li{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--t2)}\n" +
".ld{width:6px;height:6px;border-radius:50%}\n" +
".cb{font-size:10px;padding:3px 7px;border-radius:4px;font-weight:600}\n" +
".ok{background:#dcfce7;color:#166534;border:1px solid #bbf7d0}\n" +
".er{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}\n" +
".ib{width:26px;height:26px;border-radius:6px;border:1px solid var(--bd);background:var(--s2);color:var(--t2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;transition:all .2s}\n" +
".ib:hover{border-color:var(--ac);color:var(--ac)}\n" +
".spin{animation:sp .6s linear infinite}\n" +
"@keyframes sp{to{transform:rotate(360deg)}}\n" +
".pg{display:none;padding:18px}.pg.on{display:block}\n" +
".cw{max-width:1080px;margin:0 auto}\n" +
".cg{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}\n" +
".ch{text-align:center;font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--t3);padding:8px 0}\n" +
".cc{background:var(--sf);border:1px solid var(--bd);border-radius:9px;padding:9px 8px;min-height:104px;cursor:pointer;transition:all .18s;position:relative;overflow:hidden;box-shadow:var(--sh)}\n" +
".cc:hover{border-color:var(--ac);transform:translateY(-2px);box-shadow:0 6px 20px rgba(59,114,212,.1)}\n" +
".cc.em{background:transparent;border-color:transparent;cursor:default;pointer-events:none;box-shadow:none}\n" +
".cc.td{border-color:var(--ac);background:#eff5ff}\n" +
".cc.ns{opacity:.38}\n" +
".cd{font-family:\"DM Mono\",monospace;font-size:15px;font-weight:600;color:var(--t);margin-bottom:6px}\n" +
".tdot{position:absolute;top:8px;right:8px;width:5px;height:5px;border-radius:50%;background:var(--ac)}\n" +
".cr{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:3px}\n" +
".cp{font-size:9px;padding:2px 4px;border-radius:3px;font-weight:700;white-space:nowrap;line-height:1.4}\n" +
".pn{background:#dbeafe;color:#1d4ed8}.pb{background:#d1fae5;color:#065f46}.pd{background:#fee2e2;color:#991b1b}.ph{background:#fef9c3;color:#854d0e}\n" +
".cl{font-size:9px;color:var(--t3);margin-bottom:2px;font-weight:500}\n" +
".dw{max-width:1080px;margin:0 auto}\n" +
".dhdr{display:flex;align-items:center;gap:12px;margin-bottom:16px}\n" +
".bb{display:flex;align-items:center;gap:4px;padding:6px 12px;border-radius:7px;border:1px solid var(--bd);background:var(--sf);color:var(--t2);cursor:pointer;font-size:12px;transition:all .15s;font-family:\"Noto Sans SC\",sans-serif;box-shadow:var(--sh)}\n" +
".bb:hover{border-color:var(--ac);color:var(--ac)}\n" +
".dtitle{font-size:19px;font-weight:700}.dsub{font-size:11px;color:var(--t2);margin-top:2px}\n" +
".sg{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}\n" +
".sg-doc{margin-bottom:14px}\n" +
".sc{background:var(--sf);border:1px solid var(--bd);border-radius:11px;padding:15px;box-shadow:var(--sh)}\n" +
".st{font-size:10px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;font-weight:700}\n" +
".sn{font-family:\"DM Mono\",monospace;font-size:26px;font-weight:700;line-height:1;margin-bottom:3px}\n" +
".sn.n{color:var(--nc)}.sn.b{color:var(--bc)}.sn.d{color:var(--dc)}\n" +
".snote{font-size:10px;color:var(--t3);margin-bottom:10px}\n" +
".su{font-size:13px;color:var(--t2)}\n" +
".sb2{margin-bottom:7px}\n" +
".stag{display:inline-block;font-size:9px;padding:2px 7px;border-radius:3px;font-weight:700;margin-bottom:4px;line-height:1.4}\n" +
".se{background:#dbeafe;color:#1e40af}.sl{background:#ede9fe;color:#5b21b6}.sm{background:#e0f2fe;color:#075985}.sml{background:#d1fae5;color:#064e3b}\n" +
".chips{display:flex;flex-wrap:wrap;gap:3px}\n" +
".chip{font-size:11px;padding:3px 7px;border-radius:5px;background:var(--s2);border:1px solid var(--bd);color:var(--t);font-weight:500}\n" +
".chip.hd{border-color:#fbbf24;color:#92400e;background:#fef9c3}\n" +
".slbox{background:var(--sf);border:1px solid var(--bd);border-radius:11px;overflow:hidden;margin-bottom:14px;box-shadow:var(--sh)}\n" +
".slhdr{padding:11px 16px;border-bottom:1px solid var(--bd);background:var(--s2);font-size:11px;color:var(--t2);letter-spacing:.08em;text-transform:uppercase;font-weight:700}\n" +
".slhint{font-size:10px;color:var(--t3);padding:7px 16px;border-bottom:1px solid var(--bd);background:#fffbeb;line-height:1.5}\n" +
".slth{display:grid;grid-template-columns:90px 1fr 60px 80px;padding:6px 16px;border-bottom:1px solid var(--bd);background:var(--s2);gap:10px}\n" +
".slth div{font-size:9px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase;font-weight:700}\n" +
".slrow{display:grid;grid-template-columns:90px 1fr 60px 80px;padding:9px 16px;border-bottom:1px solid var(--bd);gap:10px;align-items:center;transition:background .1s}\n" +
".slrow:last-child{border-bottom:none}\n" +
".slrow:hover{background:var(--s2)}\n" +
".slrow.zc{opacity:.4}\n" +
".slt{font-family:\"DM Mono\",monospace;font-size:11px;color:var(--t2);display:flex;align-items:center;gap:4px}\n" +
".ltag{font-size:8px;color:#92400e;background:#fef3c7;padding:1px 4px;border-radius:3px;font-weight:600;border:1px solid #fde68a}\n" +
".bw{height:6px;background:var(--s3);border-radius:3px;overflow:hidden}\n" +
".bf{height:100%;border-radius:3px;transition:width .3s}\n" +
".ba{background:linear-gradient(90deg,#34d399,#10b981)}\n" +
".bm{background:linear-gradient(90deg,#fbbf24,#f59e0b)}\n" +
".bn{background:#d1d5db}\n" +
".slcap{font-family:\"DM Mono\",monospace;font-size:12px;text-align:right;font-weight:700}\n" +
".slbdg{font-size:9px;padding:2px 7px;border-radius:3px;display:block;text-align:right;white-space:nowrap;font-weight:600}\n" +
".bav{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}\n" +
".bli{background:#fef3c7;color:#92400e;border:1px solid #fde68a}\n" +
".bno{background:#f3f4f6;color:#6b7280;border:1px solid #e5e7eb}\n" +
".docbox{background:var(--sf);border:1px solid var(--bd);border-radius:11px;overflow:hidden;margin-bottom:20px;box-shadow:var(--sh)}\n" +
".dochdr{padding:11px 16px;border-bottom:1px solid var(--bd);background:var(--s2);font-size:11px;color:var(--t2);letter-spacing:.08em;text-transform:uppercase;font-weight:700}\n" +
".docrow{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--bd)}\n" +
".docrow:last-child{border-bottom:none}\n" +
".dav{width:34px;height:34px;border-radius:50%;background:#fee2e2;border:1px solid #fecaca;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--dc);flex-shrink:0}\n" +
".dname{font-size:13px;font-weight:600}\n" +
".donduty{display:inline-block;font-size:10px;padding:2px 7px;border-radius:4px;margin-top:2px;background:#fee2e2;color:#991b1b;border:1px solid #fecaca;font-weight:600}\n" +
".nodata{padding:16px;text-align:center;color:var(--t3);font-size:12px}\n" +
".lo{position:fixed;inset:0;background:rgba(244,246,249,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:999}\n" +
".lsp{width:34px;height:34px;border:3px solid var(--bd);border-top-color:var(--ac);border-radius:50%;animation:sp .7s linear infinite}\n" +
".ltxt{color:var(--t2);font-size:12px;margin-top:12px;font-weight:500}\n" +
".toast{position:fixed;bottom:18px;right:18px;background:var(--sf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--t);z-index:999;max-width:300px;display:none;box-shadow:0 6px 24px rgba(0,0,0,.1);font-weight:500}\n" +
"@media(max-width:680px){.sg{grid-template-columns:1fr}.slth,.slrow{grid-template-columns:70px 1fr 44px 56px}.cc{min-height:70px;padding:6px 5px}.cd{font-size:13px}.cp{display:none}.leg{display:none}}\n" +
"</style>\n" +
"</head>\n" +
"<body>\n" +
"<div class=\"lo\" id=\"LO\"><div class=\"lsp\"></div><div class=\"ltxt\" id=\"LT\">正在加载...</div></div>\n" +
"<div class=\"toast\" id=\"toast\"></div>\n" +
"<div class=\"tb\">\n" +
"  <div class=\"logo\">杭州中瑞 · 排班看板</div>\n" +
"  <div class=\"sep\"></div>\n" +
"  <div class=\"mnav\">\n" +
"    <button onclick=\"prevM()\">‹</button>\n" +
"    <div class=\"mlbl\" id=\"ML\"></div>\n" +
"    <button onclick=\"nextM()\">›</button>\n" +
"  </div>\n" +
"  <div class=\"tr\">\n" +
"    <div class=\"leg\">\n" +
"      <div class=\"li\"><div class=\"ld\" style=\"background:var(--nc)\"></div>护士</div>\n" +
"      <div class=\"li\"><div class=\"ld\" style=\"background:var(--bc)\"></div>美疗师</div>\n" +
"      <div class=\"li\"><div class=\"ld\" style=\"background:var(--dc)\"></div>医生</div>\n" +
"    </div>\n" +
"    <div class=\"sep\"></div>\n" +
"    <span class=\"cb er\" id=\"CB\">未连接</span>\n" +
"    <button class=\"ib spin\" id=\"RB\" onclick=\"doRefresh()\">↻</button>\n" +
"  </div>\n" +
"</div>\n" +
"<div class=\"pg on\" id=\"pg-cal\"><div class=\"cw\"><div class=\"cg\" id=\"CG\"></div></div></div>\n" +
"<div class=\"pg\" id=\"pg-day\">\n" +
"  <div class=\"dw\">\n" +
"    <div class=\"dhdr\">\n" +
"      <button class=\"bb\" onclick=\"goBack()\">← 返回日历</button>\n" +
"      <div><div class=\"dtitle\" id=\"DT\"></div><div class=\"dsub\" id=\"DS\"></div></div>\n" +
"    </div>\n" +
"    <div class=\"sg\" id=\"SG\"></div>\n" +
"    <div class=\"slbox\" id=\"SL\"></div>\n" +
"    <div class=\"docbox\" id=\"DB\"></div>\n" +
"  </div>\n" +
"</div>\n" +
"<script>\n" +
"var WD = [\"日\",\"一\",\"二\",\"三\",\"四\",\"五\",\"六\"];\n" +
"var CY = new Date().getFullYear();\n" +
"var CM = new Date().getMonth();\n" +
"var CACHE = {};\n" +
"function p2(n){return String(n).padStart(2,\"0\");}\n" +
"function fmtD(y,m,d){return y+\"-\"+p2(m)+\"-\"+p2(d);}\n" +
"function el(id){return document.getElementById(id);}\n" +
"function mk(tag,cls,txt){\n" +
"  var e=document.createElement(tag);\n" +
"  if(cls) e.className=cls;\n" +
"  if(txt!==undefined) e.textContent=txt;\n" +
"  return e;\n" +
"}\n" +
"function ap(parent,child){parent.appendChild(child);return parent;}\n" +
"\n" +
"window.addEventListener(\"DOMContentLoaded\",function(){setML();doRefresh();});\n" +
"\n" +
"async function loadMonth(y,m){\n" +
"  var k=y+\"-\"+m;\n" +
"  if(CACHE[k]) return CACHE[k];\n" +
"  setLD(true);\n" +
"  var r=await fetch(\"/api/month?year=\"+y+\"&month=\"+(m+1));\n" +
"  if(!r.ok) throw new Error(\"HTTP \"+r.status);\n" +
"  var d=await r.json();\n" +
"  if(d.error) throw new Error(d.error);\n" +
"  CACHE[k]=d;\n" +
"  return d;\n" +
"}\n" +
"\n" +
"function buildSlots(ns){\n" +
"  var slots=[];\n" +
"  for(var h=10;h<20;h++){\n" +
"    for(var m=0;m<60;m+=30){\n" +
"      var eH=m+30>=60?h+1:h;\n" +
"      var eM=(m+30)%60;\n" +
"      var t=h+m/60;\n" +
"      var en=(ns.early||[]).filter(function(n){return !n.isHead&&t>=9.5&&t<18.5;});\n" +
"      var ln=(ns.late||[]).filter(function(n){return !n.isHead&&t>=11.5&&t<20.5;});\n" +
"      var cap=en.length+ln.length;\n" +
"      var il=(t>=12&&t<14);\n" +
"      if(il) cap=Math.max(0,cap-1);\n" +
"      slots.push({tStr:p2(h)+\":\"+p2(m)+\"-\"+p2(eH)+\":\"+p2(eM),cap:cap,isLunch:il});\n" +
"    }\n" +
"  }\n" +
"  return slots;\n" +
"}\n" +
"\n" +
"async function renderCal(){\n" +
"  var data=await loadMonth(CY,CM);\n" +
"  var nbd=data.nurseByDate,bbd=data.beautyByDate,dbd=data.doctorByDate,dim=data.daysInMon;\n" +
"  var g=el(\"CG\"); g.innerHTML=\"\";\n" +
"  [\"日\",\"一\",\"二\",\"三\",\"四\",\"五\",\"六\"].forEach(function(d){ap(g,mk(\"div\",\"ch\",d));});\n" +
"  var fd=new Date(CY,CM,1).getDay();\n" +
"  var today=new Date();\n" +
"  var ts=fmtD(today.getFullYear(),today.getMonth()+1,today.getDate());\n" +
"  for(var i=0;i<fd;i++){ap(g,mk(\"div\",\"cc em\"));}\n" +
"  for(var day=1;day<=dim;day++){\n" +
"    var ds=fmtD(CY,CM+1,day);\n" +
"    var ns=nbd[ds],bs=bbd[ds],docs=dbd[ds]||[];\n" +
"    var cls=\"cc\"+(ds===ts?\" td\":\"\")+((!ns&&!bs)?\" ns\":\"\");\n" +
"    var c=mk(\"div\",cls);\n" +
"    (function(d){c.onclick=function(){openDay(d);};})(ds);\n" +
"    ap(c,mk(\"div\",\"cd\",String(day)));\n" +
"    if(ds===ts) ap(c,mk(\"div\",\"tdot\"));\n" +
"    if(ns){\n" +
"      var ec=(ns.early||[]).filter(function(n){return !n.isHead;}).length;\n" +
"      var lc=(ns.late||[]).filter(function(n){return !n.isHead;}).length;\n" +
"      var hc=(ns.early||[]).filter(function(n){return n.isHead;}).length+(ns.late||[]).filter(function(n){return n.isHead;}).length;\n" +
"      ap(c,mk(\"div\",\"cl\",\"护士\"));\n" +
"      var rn=mk(\"div\",\"cr\");\n" +
"      if(ec){var px=mk(\"span\",\"cp pn\",\"早 \"+ec);ap(rn,px);}\n" +
"      if(lc){var px=mk(\"span\",\"cp pn\",\"晚 \"+lc);ap(rn,px);}\n" +
"      if(hc){var px=mk(\"span\",\"cp ph\",\"长 \"+hc);ap(rn,px);}\n" +
"      ap(c,rn);\n" +
"    }\n" +
"    if(bs){\n" +
"      var tot=Object.values(bs).reduce(function(a,b){return a+b.length;},0);\n" +
"      if(tot){\n" +
"        ap(c,mk(\"div\",\"cl\",\"美疗\"));\n" +
"        var rb=mk(\"div\",\"cr\");\n" +
"        [[\"早班\",\"早\"],[\"早中班\",\"早中\"],[\"中班\",\"中\"],[\"晚班\",\"晚\"]].forEach(function(x){\n" +
"          if(bs[x[0]]&&bs[x[0]].length) ap(rb,mk(\"span\",\"cp pb\",x[1]+\" \"+bs[x[0]].length));\n" +
"        });\n" +
"        ap(c,rb);\n" +
"      }\n" +
"    }\n" +
"    if(docs.length){var rd=mk(\"div\",\"cr\");ap(rd,mk(\"span\",\"cp pd\",\"医 \"+docs.length));ap(c,rd);}\n" +
"    ap(g,c);\n" +
"  }\n" +
"  setLD(false);\n" +
"}\n" +
"\n" +
"async function openDay(ds){\n" +
"  var data=await loadMonth(CY,CM);\n" +
"  var nbd=data.nurseByDate,bbd=data.beautyByDate,dbd=data.doctorByDate;\n" +
"  var d=new Date(ds+\"T00:00:00\");\n" +
"  var ns=nbd[ds]||{early:[],late:[]};\n" +
"  var bs=bbd[ds]||{\"早班\":[],\"早中班\":[],\"中班\":[],\"晚班\":[]};\n" +
"  var docs=dbd[ds]||[];\n" +
"  el(\"DT\").textContent=(d.getMonth()+1)+\"月\"+d.getDate()+\"日 星期\"+WD[d.getDay()];\n" +
"  el(\"DS\").textContent=\"营业时段 10:00 - 20:00 · 每30分钟一档\";\n" +
"  var allN=(ns.early||[]).concat(ns.late||[]);\n" +
"  var bookN=allN.filter(function(n){return !n.isHead;});\n" +
"  var headN=allN.filter(function(n){return n.isHead;});\n" +
"  var allB=Object.values(bs).reduce(function(a,b){return a.concat(b);},[]);\n" +
"  var sg=el(\"SG\"); sg.innerHTML=\"\";\n" +
"  ap(sg,makeNurseCard(ns,allN,bookN,headN));\n" +
"  ap(sg,makeBeautyCard(bs,allB));\n" +
"  renderSlots(ns);\n" +
"  renderDoctorSection(docs);\n" +
"  el(\"pg-cal\").classList.remove(\"on\");\n" +
"  el(\"pg-day\").classList.add(\"on\");\n" +
"  window.scrollTo(0,0);\n" +
"}\n" +
"\n" +
"function makeNurseCard(ns,allN,bookN,headN){\n" +
"  var c=mk(\"div\",\"sc\");\n" +
"  ap(c,mk(\"div\",\"st\",\"护士在岗\"));\n" +
"  var sn=mk(\"div\",\"sn n\",String(allN.length));\n" +
"  ap(sn,mk(\"span\",\"su\",\" 人\"));\n" +
"  ap(c,sn);\n" +
"  ap(c,mk(\"div\",\"snote\",\"参与预约 \"+bookN.length+\" 人 · 护士长 \"+headN.length+\" 人（仅展示）\"));\n" +
"  ap(c,makeShiftBlock(ns.early,\"早班\",\"se\"));\n" +
"  ap(c,makeShiftBlock(ns.late,\"晚班\",\"sl\"));\n" +
"  return c;\n" +
"}\n" +
"\n" +
"function makeBeautyCard(bs,allB){\n" +
"  var c=mk(\"div\",\"sc\");\n" +
"  ap(c,mk(\"div\",\"st\",\"美疗师在岗\"));\n" +
"  var sn=mk(\"div\",\"sn b\",String(allB.length));\n" +
"  ap(sn,mk(\"span\",\"su\",\" 人\"));\n" +
"  ap(c,sn);\n" +
"  ap(c,mk(\"div\",\"snote\",\"全员参与项目预约排班\"));\n" +
"  var cm={\"早班\":\"se\",\"早中班\":\"sm\",\"中班\":\"sml\",\"晚班\":\"sl\"};\n" +
"  Object.entries(bs).forEach(function(e){\n" +
"    if(e[1].length) ap(c,makeShiftBlock(e[1],e[0],cm[e[0]]||\"se\"));\n" +
"  });\n" +
"  return c;\n" +
"}\n" +
"\n" +
"function makeDoctorCard(docs){\n" +
"  var c=mk(\"div\",\"sc\");\n" +
"  ap(c,mk(\"div\",\"st\",\"医生出诊\"));\n" +
"  var sn=mk(\"div\",\"sn d\",String(docs.length));\n" +
"  ap(sn,mk(\"span\",\"su\",\" 位\"));\n" +
"  ap(c,sn);\n" +
"  ap(c,mk(\"div\",\"snote\",\"仅供展示，不参与预约占位\"));\n" +
"  if(docs.length){\n" +
"    docs.forEach(function(n){ap(c,mk(\"div\",\"snote\",\"· \"+n));});\n" +
"  } else {\n" +
"    ap(c,mk(\"div\",\"snote\",\"今日无医生出诊\"));\n" +
"  }\n" +
"  return c;\n" +
"}\n" +
"\n" +
"function makeShiftBlock(list,label,cls){\n" +
"  var b=mk(\"div\",\"sb2\");\n" +
"  if(!list||!list.length) return b;\n" +
"  ap(b,mk(\"span\",\"stag \"+cls,label));\n" +
"  var chips=mk(\"div\",\"chips\");\n" +
"  list.forEach(function(n){\n" +
"    ap(chips,mk(\"span\",\"chip\"+(n.isHead?\" hd\":\"\"),n.name));\n" +
"  });\n" +
"  ap(b,chips);\n" +
"  return b;\n" +
"}\n" +
"\n" +
"function renderSlots(ns){\n" +
"  var slots=buildSlots(ns);\n" +
"  var mc=Math.max.apply(null,slots.map(function(s){return s.cap;}).concat([1]));\n" +
"  var box=el(\"SL\"); box.innerHTML=\"\";\n" +
"  ap(box,mk(\"div\",\"slhdr\",\"预约时段容量（30分钟/档）\"));\n" +
"  ap(box,mk(\"div\",\"slhint\",\"护士早班 09:30-18:30，晚班 11:30-20:30。容量=当前时段在岗护士数（护士长不占名额）。午休 12:00-14:00 自动-1。\"));\n" +
"  var hdr=mk(\"div\",\"slth\");\n" +
"  [\"时间段\",\"容量比例\",\"名额\",\"状态\"].forEach(function(t){ap(hdr,mk(\"div\",\"\",t));});\n" +
"  ap(box,hdr);\n" +
"  slots.forEach(function(s){\n" +
"    var pct=mc>0?Math.round(s.cap/mc*100):0;\n" +
"    var bc=s.cap===0?\"bn\":pct>=60?\"ba\":\"bm\";\n" +
"    var sc=s.cap===0?\"bno\":pct>=60?\"bav\":\"bli\";\n" +
"    var sl2=s.cap===0?\"暂停预约\":pct>=60?\"可预约\":\"名额紧张\";\n" +
"    var row=mk(\"div\",\"slrow\"+(s.cap===0?\" zc\":\"\"));\n" +
"    var timeDiv=mk(\"div\",\"slt\",s.tStr);\n" +
"    if(s.isLunch) ap(timeDiv,mk(\"span\",\"ltag\",\"午休\"));\n" +
"    ap(row,timeDiv);\n" +
"    var bw=mk(\"div\",\"bw\"); var bf=mk(\"div\",\"bf \"+bc); bf.style.width=pct+\"%\"; ap(bw,bf); ap(row,bw);\n" +
"    ap(row,mk(\"div\",\"slcap\",String(s.cap)));\n" +
"    var bdg=mk(\"div\",\"\"); ap(bdg,mk(\"span\",\"slbdg \"+sc,sl2)); ap(row,bdg);\n" +
"    ap(box,row);\n" +
"  });\n" +
"}\n" +
"\n" +
"function renderDoctorSection(docs){\n" +
"  var box=el(\"DB\"); box.innerHTML=\"\";\n" +
"  ap(box,mk(\"div\",\"dochdr\",\"医生出诊（仅展示，不占预约名额）\"));\n" +
"  if(!docs.length){ap(box,mk(\"div\",\"nodata\",\"今日暂无医生出诊安排\"));return;}\n" +
"  docs.forEach(function(name){\n" +
"    var row=mk(\"div\",\"docrow\");\n" +
"    ap(row,mk(\"div\",\"dav\",name.slice(-1)));\n" +
"    var info=mk(\"div\",\"\");\n" +
"    ap(info,mk(\"div\",\"dname\",name));\n" +
"    ap(info,mk(\"span\",\"donduty\",\"今日出诊\"));\n" +
"    ap(row,info);\n" +
"    ap(box,row);\n" +
"  });\n" +
"}\n" +
"\n" +
"function goBack(){el(\"pg-day\").classList.remove(\"on\");el(\"pg-cal\").classList.add(\"on\");}\n" +
"function setML(){el(\"ML\").textContent=CY+\".\"+p2(CM+1);}\n" +
"function prevM(){CM--;if(CM<0){CM=11;CY--;}setML();doRefresh();}\n" +
"function nextM(){CM++;if(CM>11){CM=0;CY++;}setML();doRefresh();}\n" +
"async function doRefresh(){\n" +
"  el(\"pg-day\").classList.remove(\"on\");\n" +
"  el(\"pg-cal\").classList.add(\"on\");\n" +
"  var rb=el(\"RB\"); rb.classList.add(\"spin\");\n" +
"  delete CACHE[CY+\"-\"+CM];\n" +
"  try{await renderCal();setBadge(true);}\n" +
"  catch(e){setBadge(false);showToast(\"加载失败: \"+(e.message||\"未知错误\"));setLD(false);}\n" +
"  rb.classList.remove(\"spin\");\n" +
"}\n" +
"function setLD(s){el(\"LO\").style.display=s?\"flex\":\"none\";}\n" +
"function setBadge(ok){var e=el(\"CB\");e.textContent=ok?\"已连接\":\"连接失败\";e.className=\"cb \"+(ok?\"ok\":\"er\");}\n" +
"function showToast(msg){var e=el(\"toast\");e.textContent=msg;e.style.display=\"block\";clearTimeout(e._t);e._t=setTimeout(function(){e.style.display=\"none\";},5000);}\n" +
"</script>\n" +
"</body>\n" +
"</html>";

const server = http.createServer(async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://localhost');

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

server.listen(PORT, '0.0.0.0', function() {
  console.log('排班看板已启动 port=' + PORT);
});
