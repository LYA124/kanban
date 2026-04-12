const http = require('http');
const https = require('https');

const APP_ID     = process.env.FEISHU_APP_ID     || 'cli_a950b6f99fb95bc8';
const APP_SECRET = process.env.FEISHU_APP_SECRET || 'E0q21M4FHBqZDNYZCN73mdFNktoxhTOy';
const APP_TOKEN  = process.env.FEISHU_APP_TOKEN  || 'PPSkb00lkaxMnusHZAJcFBainAg';
const PORT       = process.env.PORT || 3000;

const TABLES = {
  nurse:  'tblJELs9hSwO9lAD',
  beauty: 'tbl1Vnt0bTEQQo2J',
  doctor: 'tbl3sb339H2H0mRS',
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
        catch(e) { reject(new Error('JSON error: ' + data.slice(0,100))); }
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

// 飞书字段值提取：
// 文本字段返回 [{type:"text", text:"xxx"}] 或直接 "xxx"
// 选项字段返回 [{text:"早", color:0}] 或 [{text:"护士长", color:1}]
// 空字段返回 null 或 undefined
function tv(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    // 取第一项的text（选项字段只有一个值）
    var first = v[0];
    if (first && typeof first === 'object') {
      var t = first.text || first.name || first.value || null;
      if (t) return String(t).trim() || null;
    }
    return String(v[0]).trim() || null;
  }
  if (typeof v === 'object' && v.text) return String(v.text).trim() || null;
  return null;
}

function parseYM(raw) {
  if (!raw) return null;
  var s = String(raw).replace(/[^\d]/g, '-').replace(/--+/g, '-');
  // 直接用正则匹配四位年和两位月
  var m = String(raw).match(/(\d{4})[^\d]+(\d{1,2})/);
  if (!m) return null;
  return { year: parseInt(m[1]), month: parseInt(m[2]) };
}

function p2(n) { return String(n).padStart(2, '0'); }

function parseMonthData(nurseRecs, beautyRecs, docRecs, year, month) {
  var daysInMon = new Date(year, month, 0).getDate();
  var nurseByDate = {}, beautyByDate = {}, doctorByDate = {};
  var bKeys = ['早班', '早中班', '中班', '晚班'];

  nurseRecs.forEach(function(rec) {
    var f = rec.fields;
    var ymRaw = tv(f['年月']);
    var ym = parseYM(ymRaw);
    if (!ym || ym.year !== year || ym.month !== month) return;
    var name = tv(f['姓名']);
    if (!name || name === '/') return;
    var roleRaw = tv(f['角色']);
    var isHead = roleRaw ? roleRaw.indexOf('护士长') >= 0 : false;
    for (var day = 1; day <= daysInMon; day++) {
      var val = tv(f[day + '号']);
      if (!val || val === '休' || val.indexOf('星期') >= 0) continue;
      var ds = year + '-' + p2(month) + '-' + p2(day);
      if (!nurseByDate[ds]) nurseByDate[ds] = { early: [], late: [] };
      if (val === '早') nurseByDate[ds].early.push({ name: name, isHead: isHead });
      else if (val === '晚') nurseByDate[ds].late.push({ name: name, isHead: isHead });
    }
  });

  beautyRecs.forEach(function(rec) {
    var f = rec.fields;
    var ymRaw = tv(f['年月']);
    var ym = parseYM(ymRaw);
    if (!ym || ym.year !== year || ym.month !== month) return;
    var name = tv(f['姓名']);
    if (!name || name === '/') return;
    for (var day = 1; day <= daysInMon; day++) {
      var val = tv(f[day + '号']);
      if (!val || val === '休' || val.indexOf('星期') >= 0) continue;
      var ds = year + '-' + p2(month) + '-' + p2(day);
      if (!beautyByDate[ds]) {
        beautyByDate[ds] = {};
        bKeys.forEach(function(k) { beautyByDate[ds][k] = []; });
      }
      var sk = bKeys.indexOf(val) >= 0 ? val : '早班';
      beautyByDate[ds][sk].push({ name: name });
    }
  });

  docRecs.forEach(function(rec) {
    var f = rec.fields;
    var ymRaw = tv(f['年月']);
    var ym = parseYM(ymRaw);
    if (!ym || ym.year !== year || ym.month !== month) return;
    var name = tv(f['姓名']);
    if (!name || name === '/') return;
    for (var day = 1; day <= daysInMon; day++) {
      var val = tv(f[day + '号']);
      if (val !== '出诊') continue;
      var ds = year + '-' + p2(month) + '-' + p2(day);
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

// 前端HTML
var HTML = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1.0">\n<title>\u676d\u5dde\u4e2d\u745e \u00b7 \u6392\u73ed\u770b\u677f</title>\n<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">\n<style>\n:root{--bg:#f4f6f9;--sf:#fff;--s2:#f0f2f6;--s3:#e8ebf2;--bd:#e2e6ed;--ac:#3b72d4;--nc:#3b72d4;--bc:#0d9f6e;--dc:#e0344f;--hc:#c07a00;--t:#1a2035;--t2:#5a6380;--t3:#9aa3b8;--sh:0 1px 3px rgba(0,0,0,.06),0 4px 12px rgba(0,0,0,.04)}\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:"Noto Sans SC",sans-serif;background:var(--bg);color:var(--t);min-height:100vh}\n.tb{position:sticky;top:0;z-index:100;background:rgba(255,255,255,.96);backdrop-filter:blur(12px);border-bottom:1px solid var(--bd);height:54px;display:flex;align-items:center;padding:0 20px;gap:14px;box-shadow:0 1px 6px rgba(0,0,0,.06)}\n.logo{font-size:14px;font-weight:700;color:var(--ac);white-space:nowrap}\n.sep{width:1px;height:18px;background:var(--bd)}\n.mnav{display:flex;align-items:center;gap:5px}\n.mnav button{width:28px;height:28px;border-radius:6px;border:1px solid var(--bd);background:var(--s2);color:var(--t2);cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;transition:all .15s}\n.mnav button:hover{border-color:var(--ac);color:var(--ac)}\n.mlbl{font-family:"DM Mono",monospace;font-size:13px;font-weight:500;min-width:68px;text-align:center}\n.tr{margin-left:auto;display:flex;align-items:center;gap:8px}\n.leg{display:flex;align-items:center;gap:12px}\n.li{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--t2)}\n.ld{width:6px;height:6px;border-radius:50%}\n.cb{font-size:10px;padding:3px 7px;border-radius:4px;font-weight:600}\n.ok{background:#dcfce7;color:#166534;border:1px solid #bbf7d0}\n.er{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}\n.ib{width:26px;height:26px;border-radius:6px;border:1px solid var(--bd);background:var(--s2);color:var(--t2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;transition:all .2s}\n.ib:hover{border-color:var(--ac);color:var(--ac)}\n.spin{animation:sp .6s linear infinite}\n@keyframes sp{to{transform:rotate(360deg)}}\n.pg{display:none;padding:18px}.pg.on{display:block}\n.cw{max-width:1100px;margin:0 auto}\n.cg{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}\n.ch{text-align:center;font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--t3);padding:8px 0}\n.cc{background:var(--sf);border:1px solid var(--bd);border-radius:9px;padding:9px 8px;min-height:108px;cursor:pointer;transition:all .18s;position:relative;overflow:hidden;box-shadow:var(--sh)}\n.cc:hover{border-color:var(--ac);transform:translateY(-2px);box-shadow:0 6px 20px rgba(59,114,212,.1)}\n.cc.em{background:transparent;border-color:transparent;cursor:default;pointer-events:none;box-shadow:none}\n.cc.td{border-color:var(--ac);background:#eff5ff}\n.cc.ns{opacity:.35}\n.cd{font-family:"DM Mono",monospace;font-size:16px;font-weight:600;color:var(--t);margin-bottom:7px}\n.tdot{position:absolute;top:8px;right:8px;width:5px;height:5px;border-radius:50%;background:var(--ac)}\n.cr{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:3px}\n.cp{font-size:9px;padding:2px 5px;border-radius:3px;font-weight:700;white-space:nowrap;line-height:1.4}\n.pn{background:#dbeafe;color:#1d4ed8}.pb{background:#d1fae5;color:#065f46}.pd{background:#fee2e2;color:#991b1b}.ph{background:#fef9c3;color:#854d0e}\n.cl{font-size:9px;color:var(--t3);margin-bottom:2px;font-weight:500}\n.dw{max-width:1100px;margin:0 auto}\n.dhdr{display:flex;align-items:center;gap:12px;margin-bottom:16px}\n.bb{display:flex;align-items:center;gap:4px;padding:6px 14px;border-radius:7px;border:1px solid var(--bd);background:var(--sf);color:var(--t2);cursor:pointer;font-size:12px;transition:all .15s;font-family:"Noto Sans SC",sans-serif;box-shadow:var(--sh)}\n.bb:hover{border-color:var(--ac);color:var(--ac)}\n.dtitle{font-size:20px;font-weight:700}.dsub{font-size:11px;color:var(--t2);margin-top:2px}\n/* \u4e0a\u65b9\u62a4\u58eb+\u7f8e\u7597\u5e08\u5e76\u6392 */\n.staff-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}\n.sc{background:var(--sf);border:1px solid var(--bd);border-radius:11px;padding:16px;box-shadow:var(--sh)}\n.sc-title{font-size:10px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px;font-weight:700}\n.sc-count{font-family:"DM Mono",monospace;font-size:28px;font-weight:700;line-height:1;margin-bottom:2px}\n.sc-count.n{color:var(--nc)}.sc-count.b{color:var(--bc)}.sc-count.d{color:var(--dc)}\n.sc-sub{font-size:13px;color:var(--t2)}\n.sc-note{font-size:10px;color:var(--t3);margin-bottom:12px}\n/* \u73ed\u6b21\u5757 */\n.shift-section{margin-bottom:10px}\n.shift-hdr{display:flex;align-items:center;gap:8px;margin-bottom:6px}\n.shift-badge{font-size:10px;font-weight:700;padding:2px 10px;border-radius:4px}\n.sb-early{background:#dbeafe;color:#1e40af}\n.sb-late{background:#ede9fe;color:#5b21b6}\n.sb-mid{background:#e0f2fe;color:#075985}\n.sb-midlate{background:#d1fae5;color:#064e3b}\n.shift-count{font-family:"DM Mono",monospace;font-size:12px;color:var(--t2);font-weight:500}\n.chips{display:flex;flex-wrap:wrap;gap:4px}\n.chip{font-size:11px;padding:3px 8px;border-radius:5px;background:var(--s2);border:1px solid var(--bd);color:var(--t);font-weight:500}\n.chip.hd{border-color:#fbbf24;color:#92400e;background:#fef9c3}\n/* \u533b\u751f\u5361\u7247 */\n.doc-card{background:var(--sf);border:1px solid var(--bd);border-radius:11px;padding:16px;box-shadow:var(--sh);margin-bottom:12px}\n.doc-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}\n.doc-chip{display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:8px;background:#fff5f5;border:1px solid #fecaca}\n.doc-av{width:28px;height:28px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--dc)}\n.doc-name{font-size:12px;font-weight:600;color:var(--t)}\n/* \u65f6\u6bb5\u8868 */\n.slbox{background:var(--sf);border:1px solid var(--bd);border-radius:11px;overflow:hidden;margin-bottom:12px;box-shadow:var(--sh)}\n.slhdr{padding:11px 16px;border-bottom:1px solid var(--bd);background:var(--s2);font-size:11px;color:var(--t2);letter-spacing:.08em;text-transform:uppercase;font-weight:700}\n.slhint{font-size:10px;color:var(--t3);padding:7px 16px;border-bottom:1px solid var(--bd);background:#fffbeb;line-height:1.5}\n.slth{display:grid;grid-template-columns:96px 1fr 60px 80px;padding:6px 16px;border-bottom:1px solid var(--bd);background:var(--s2);gap:10px}\n.slth div{font-size:9px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase;font-weight:700}\n.slrow{display:grid;grid-template-columns:96px 1fr 60px 80px;padding:9px 16px;border-bottom:1px solid var(--bd);gap:10px;align-items:center;transition:background .1s}\n.slrow:last-child{border-bottom:none}\n.slrow:hover{background:var(--s2)}\n.slrow.zc{opacity:.4}\n.slt{font-family:"DM Mono",monospace;font-size:12px;color:var(--t2);display:flex;align-items:center;gap:4px}\n.ltag{font-size:8px;color:#92400e;background:#fef3c7;padding:1px 4px;border-radius:3px;font-weight:600;border:1px solid #fde68a}\n.bw{height:7px;background:var(--s3);border-radius:4px;overflow:hidden}\n.bf{height:100%;border-radius:4px;transition:width .3s}\n.ba{background:linear-gradient(90deg,#34d399,#10b981)}.bm{background:linear-gradient(90deg,#fbbf24,#f59e0b)}.bn{background:#d1d5db}\n.slcap{font-family:"DM Mono",monospace;font-size:13px;text-align:right;font-weight:700}\n.slbdg{font-size:9px;padding:2px 7px;border-radius:3px;display:block;text-align:right;white-space:nowrap;font-weight:600}\n.bav{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}.bli{background:#fef3c7;color:#92400e;border:1px solid #fde68a}.bno{background:#f3f4f6;color:#6b7280;border:1px solid #e5e7eb}\n.lo{position:fixed;inset:0;background:rgba(244,246,249,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:999}\n.lsp{width:36px;height:36px;border:3px solid var(--bd);border-top-color:var(--ac);border-radius:50%;animation:sp .7s linear infinite}\n.ltxt{color:var(--t2);font-size:12px;margin-top:12px;font-weight:500}\n.toast{position:fixed;bottom:18px;right:18px;background:var(--sf);border:1px solid var(--bd);border-radius:9px;padding:11px 15px;font-size:12px;color:var(--t);z-index:999;max-width:300px;display:none;box-shadow:0 6px 24px rgba(0,0,0,.1)}\n@media(max-width:700px){.staff-row{grid-template-columns:1fr}.slth,.slrow{grid-template-columns:72px 1fr 44px 56px}.cc{min-height:76px;padding:6px 5px}.cd{font-size:13px}.cp{display:none}.leg{display:none}}\n</style>\n</head>\n<body>\n<div class="lo" id="LO"><div class="lsp"></div><div class="ltxt" id="LT">\u6b63\u5728\u52a0\u8f7d...</div></div>\n<div class="toast" id="toast"></div>\n<div class="tb">\n  <div class="logo">\u676d\u5dde\u4e2d\u745e \u00b7 \u6392\u73ed\u770b\u677f</div>\n  <div class="sep"></div>\n  <div class="mnav">\n    <button onclick="prevM()">\u2039</button>\n    <div class="mlbl" id="ML"></div>\n    <button onclick="nextM()">\u203a</button>\n  </div>\n  <div class="tr">\n    <div class="leg">\n      <div class="li"><div class="ld" style="background:var(--nc)"></div>\u62a4\u58eb</div>\n      <div class="li"><div class="ld" style="background:var(--bc)"></div>\u7f8e\u7597\u5e08</div>\n      <div class="li"><div class="ld" style="background:var(--dc)"></div>\u533b\u751f</div>\n    </div>\n    <div class="sep"></div>\n    <span class="cb er" id="CB">\u672a\u8fde\u63a5</span>\n    <button class="ib spin" id="RB" onclick="doRefresh()">\u21bb</button>\n  </div>\n</div>\n<div class="pg on" id="pg-cal"><div class="cw"><div class="cg" id="CG"></div></div></div>\n<div class="pg" id="pg-day">\n  <div class="dw">\n    <div class="dhdr">\n      <button class="bb" onclick="goBack()">\u2190 \u8fd4\u56de\u65e5\u5386</button>\n      <div><div class="dtitle" id="DT"></div><div class="dsub" id="DS"></div></div>\n    </div>\n    <div class="staff-row" id="SR"></div>\n    <div class="doc-card" id="DC"></div>\n    <div class="slbox" id="SL"></div>\n  </div>\n</div>\n<script>\nvar WD=["\u65e5","\u4e00","\u4e8c","\u4e09","\u56db","\u4e94","\u516d"];\nvar CY=new Date().getFullYear(),CM=new Date().getMonth(),CACHE={};\nfunction p2(n){return String(n).padStart(2,"0");}\nfunction fmtD(y,m,d){return y+"-"+p2(m)+"-"+p2(d);}\nfunction el(id){return document.getElementById(id);}\nfunction mk(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;}\nfunction ap(p,c){p.appendChild(c);return p;}\nwindow.addEventListener("DOMContentLoaded",function(){setML();doRefresh();});\nasync function loadMonth(y,m){\n  var k=y+"-"+m;\n  if(CACHE[k])return CACHE[k];\n  setLD(true);\n  var r=await fetch("/api/month?year="+y+"&month="+(m+1));\n  if(!r.ok)throw new Error("HTTP "+r.status);\n  var d=await r.json();\n  if(d.error)throw new Error(d.error);\n  CACHE[k]=d;return d;\n}\nfunction buildSlots(ns){\n  var slots=[];\n  for(var h=10;h<20;h++){\n    for(var m=0;m<60;m+=30){\n      var eH=m+30>=60?h+1:h,eM=(m+30)%60,t=h+m/60;\n      var en=(ns.early||[]).filter(function(n){return !n.isHead&&t>=9.5&&t<18.5;});\n      var ln=(ns.late||[]).filter(function(n){return !n.isHead&&t>=11.5&&t<20.5;});\n      var cap=en.length+ln.length;\n      var il=(t>=12&&t<14);if(il)cap=Math.max(0,cap-1);\n      slots.push({tStr:p2(h)+":"+p2(m)+"-"+p2(eH)+":"+p2(eM),cap:cap,isLunch:il});\n    }\n  }\n  return slots;\n}\nasync function renderCal(){\n  var data=await loadMonth(CY,CM);\n  var nbd=data.nurseByDate,bbd=data.beautyByDate,dbd=data.doctorByDate,dim=data.daysInMon;\n  var g=el("CG");g.innerHTML="";\n  ["\u65e5","\u4e00","\u4e8c","\u4e09","\u56db","\u4e94","\u516d"].forEach(function(d){ap(g,mk("div","ch",d));});\n  var fd=new Date(CY,CM,1).getDay();\n  var today=new Date(),ts=fmtD(today.getFullYear(),today.getMonth()+1,today.getDate());\n  for(var i=0;i<fd;i++)ap(g,mk("div","cc em"));\n  for(var day=1;day<=dim;day++){\n    var ds=fmtD(CY,CM+1,day);\n    var ns=nbd[ds],bs=bbd[ds],docs=dbd[ds]||[];\n    var c=mk("div","cc"+(ds===ts?" td":"")+((!ns&&!bs)?" ns":""));\n    (function(d){c.onclick=function(){openDay(d);};})(ds);\n    ap(c,mk("div","cd",String(day)));\n    if(ds===ts)ap(c,mk("div","tdot"));\n    if(ns){\n      var ec=(ns.early||[]).filter(function(n){return !n.isHead;}).length;\n      var lc=(ns.late||[]).filter(function(n){return !n.isHead;}).length;\n      var hc=(ns.early||[]).filter(function(n){return n.isHead;}).length+(ns.late||[]).filter(function(n){return n.isHead;}).length;\n      ap(c,mk("div","cl","\u62a4\u58eb"));\n      var rn=mk("div","cr");\n      if(ec)ap(rn,mk("span","cp pn","\u65e9 "+ec));\n      if(lc)ap(rn,mk("span","cp pn","\u665a "+lc));\n      if(hc)ap(rn,mk("span","cp ph","\u957f "+hc));\n      ap(c,rn);\n    }\n    if(bs){\n      var tot=Object.values(bs).reduce(function(a,b){return a+b.length;},0);\n      if(tot){\n        ap(c,mk("div","cl","\u7f8e\u7597"));\n        var rb=mk("div","cr");\n        [["\u65e9\u73ed","\u65e9"],["\u65e9\u4e2d\u73ed","\u65e9\u4e2d"],["\u4e2d\u73ed","\u4e2d"],["\u665a\u73ed","\u665a"]].forEach(function(x){\n          if(bs[x[0]]&&bs[x[0]].length)ap(rb,mk("span","cp pb",x[1]+" "+bs[x[0]].length));\n        });\n        ap(c,rb);\n      }\n    }\n    if(docs.length){var rd=mk("div","cr");ap(rd,mk("span","cp pd","\u533b "+docs.length));ap(c,rd);}\n    ap(g,c);\n  }\n  setLD(false);\n}\nasync function openDay(ds){\n  var data=await loadMonth(CY,CM);\n  var nbd=data.nurseByDate,bbd=data.beautyByDate,dbd=data.doctorByDate;\n  var d=new Date(ds+"T00:00:00");\n  var ns=nbd[ds]||{early:[],late:[]};\n  var bs=bbd[ds]||{"\u65e9\u73ed":[],"\u65e9\u4e2d\u73ed":[],"\u4e2d\u73ed":[],"\u665a\u73ed":[]};\n  var docs=dbd[ds]||[];\n  el("DT").textContent=(d.getMonth()+1)+"\u6708"+d.getDate()+"\u65e5 \u661f\u671f"+WD[d.getDay()];\n  el("DS").textContent="\u8425\u4e1a\u65f6\u6bb5 10:00 - 20:00 \u00b7 \u6bcf30\u5206\u949f\u4e00\u6863";\n  var allN=(ns.early||[]).concat(ns.late||[]);\n  var bookN=allN.filter(function(n){return !n.isHead;});\n  var headN=allN.filter(function(n){return n.isHead;});\n  var allB=Object.values(bs).reduce(function(a,b){return a.concat(b);},[]);\n  // \u62a4\u58eb\u5361\u7247\n  var sr=el("SR");sr.innerHTML="";\n  var nc=mk("div","sc");\n  ap(nc,mk("div","sc-title","\u62a4\u58eb\u5728\u5c97"));\n  var nn=mk("div","");\n  var ncnt=mk("span","sc-count n",String(allN.length));\n  ap(ncnt,mk("span","sc-sub"," \u4eba"));\n  ap(nn,ncnt);\n  ap(nc,nn);\n  ap(nc,mk("div","sc-note","\u53c2\u4e0e\u9884\u7ea6 "+bookN.length+" \u4eba \u00b7 \u62a4\u58eb\u957f "+headN.length+" \u4eba\uff08\u4e0d\u5360\u9884\u7ea6\u540d\u989d\uff09"));\n  // \u65e9\u73ed\u5757\n  if(ns.early&&ns.early.length){\n    var es=mk("div","shift-section");\n    var eh=mk("div","shift-hdr");\n    ap(eh,mk("span","shift-badge sb-early","\u65e9\u73ed 09:30-18:30"));\n    ap(eh,mk("span","shift-count",ns.early.length+"\u4eba"));\n    ap(es,eh);\n    var ec2=mk("div","chips");\n    ns.early.forEach(function(n){ap(ec2,mk("span","chip"+(n.isHead?" hd":""),n.name));});\n    ap(es,ec2);ap(nc,es);\n  }\n  // \u665a\u73ed\u5757\n  if(ns.late&&ns.late.length){\n    var ls=mk("div","shift-section");\n    var lh=mk("div","shift-hdr");\n    ap(lh,mk("span","shift-badge sb-late","\u665a\u73ed 11:30-20:30"));\n    ap(lh,mk("span","shift-count",ns.late.length+"\u4eba"));\n    ap(ls,lh);\n    var lc2=mk("div","chips");\n    ns.late.forEach(function(n){ap(lc2,mk("span","chip"+(n.isHead?" hd":""),n.name));});\n    ap(ls,lc2);ap(nc,ls);\n  }\n  if(!ns.early.length&&!ns.late.length)ap(nc,mk("div","sc-note","\u4eca\u65e5\u65e0\u62a4\u58eb\u5728\u5c97"));\n  ap(sr,nc);\n  // \u7f8e\u7597\u5e08\u5361\u7247\n  var bc2=mk("div","sc");\n  ap(bc2,mk("div","sc-title","\u7f8e\u7597\u5e08\u5728\u5c97"));\n  var bn=mk("div","");\n  var bcnt=mk("span","sc-count b",String(allB.length));\n  ap(bcnt,mk("span","sc-sub"," \u4eba"));\n  ap(bn,bcnt);\n  ap(bc2,bn);\n  ap(bc2,mk("div","sc-note","\u5168\u5458\u53c2\u4e0e\u9879\u76ee\u9884\u7ea6\u6392\u73ed"));\n  var bmap={"\u65e9\u73ed":["sb-early","\u65e9\u73ed 10:00-20:00"],"\u65e9\u4e2d\u73ed":["sb-mid","\u65e9\u4e2d\u73ed 11:00-21:00"],"\u4e2d\u73ed":["sb-midlate","\u4e2d\u73ed 12:00-22:00"],"\u665a\u73ed":["sb-late","\u665a\u73ed 13:00-23:00"]};\n  var hasBeauty=false;\n  ["\u65e9\u73ed","\u65e9\u4e2d\u73ed","\u4e2d\u73ed","\u665a\u73ed"].forEach(function(k){\n    if(!bs[k]||!bs[k].length)return;\n    hasBeauty=true;\n    var info=bmap[k];\n    var ss=mk("div","shift-section");\n    var sh=mk("div","shift-hdr");\n    ap(sh,mk("span","shift-badge "+info[0],info[1]));\n    ap(sh,mk("span","shift-count",bs[k].length+"\u4eba"));\n    ap(ss,sh);\n    var chips2=mk("div","chips");\n    bs[k].forEach(function(n){ap(chips2,mk("span","chip",n.name));});\n    ap(ss,chips2);ap(bc2,ss);\n  });\n  if(!hasBeauty)ap(bc2,mk("div","sc-note","\u4eca\u65e5\u65e0\u7f8e\u7597\u5e08\u5728\u5c97"));\n  ap(sr,bc2);\n  // \u533b\u751f\u5361\u7247\n  var dc=el("DC");dc.innerHTML="";\n  ap(dc,mk("div","sc-title","\u533b\u751f\u51fa\u8bca\uff08\u4ec5\u5c55\u793a\uff0c\u4e0d\u5360\u9884\u7ea6\u540d\u989d\uff09"));\n  if(!docs.length){\n    ap(dc,mk("div","sc-note","\u4eca\u65e5\u65e0\u533b\u751f\u51fa\u8bca"));\n  } else {\n    var dl=mk("div","doc-list");\n    docs.forEach(function(name){\n      var chip=mk("div","doc-chip");\n      ap(chip,mk("div","doc-av",name.slice(-1)));\n      ap(chip,mk("div","doc-name",name));\n      ap(dl,chip);\n    });\n    ap(dc,dl);\n  }\n  // \u65f6\u6bb5\u8868\n  var slots=buildSlots(ns);\n  var mc=Math.max.apply(null,slots.map(function(s){return s.cap;}).concat([1]));\n  var slbox=el("SL");slbox.innerHTML="";\n  ap(slbox,mk("div","slhdr","\u9884\u7ea6\u65f6\u6bb5\u5bb9\u91cf\uff0830\u5206\u949f/\u6863\uff09"));\n  ap(slbox,mk("div","slhint","\u62a4\u58eb\u65e9\u73ed 09:30-18:30\uff0c\u665a\u73ed 11:30-20:30\u3002\u5bb9\u91cf=\u5f53\u524d\u65f6\u6bb5\u5728\u5c97\u62a4\u58eb\u6570\uff08\u62a4\u58eb\u957f\u4e0d\u5360\u540d\u989d\uff09\u3002\u5348\u4f11 12:00-14:00 \u81ea\u52a8-1\u3002"));\n  var hdr=mk("div","slth");\n  ["\u65f6\u95f4\u6bb5","\u5bb9\u91cf\u6bd4\u4f8b","\u540d\u989d","\u72b6\u6001"].forEach(function(t){ap(hdr,mk("div","",t));});\n  ap(slbox,hdr);\n  slots.forEach(function(s){\n    var pct=mc>0?Math.round(s.cap/mc*100):0;\n    var bc=s.cap===0?"bn":pct>=60?"ba":"bm";\n    var sc=s.cap===0?"bno":pct>=60?"bav":"bli";\n    var sl2=s.cap===0?"\u6682\u505c\u9884\u7ea6":pct>=60?"\u53ef\u9884\u7ea6":"\u540d\u989d\u7d27\u5f20";\n    var row=mk("div","slrow"+(s.cap===0?" zc":""));\n    var td=mk("div","slt",s.tStr);\n    if(s.isLunch)ap(td,mk("span","ltag","\u5348\u4f11"));\n    ap(row,td);\n    var bw=mk("div","bw");var bf=mk("div","bf "+bc);bf.style.width=pct+"%";ap(bw,bf);ap(row,bw);\n    ap(row,mk("div","slcap",String(s.cap)));\n    var bdg=mk("div","");ap(bdg,mk("span","slbdg "+sc,sl2));ap(row,bdg);\n    ap(slbox,row);\n  });\n  el("pg-cal").classList.remove("on");\n  el("pg-day").classList.add("on");\n  window.scrollTo(0,0);\n}\nfunction goBack(){el("pg-day").classList.remove("on");el("pg-cal").classList.add("on");}\nfunction setML(){el("ML").textContent=CY+"."+p2(CM+1);}\nfunction prevM(){CM--;if(CM<0){CM=11;CY--;}setML();doRefresh();}\nfunction nextM(){CM++;if(CM>11){CM=0;CY++;}setML();doRefresh();}\nasync function doRefresh(){\n  el("pg-day").classList.remove("on");el("pg-cal").classList.add("on");\n  var rb=el("RB");rb.classList.add("spin");\n  delete CACHE[CY+"-"+CM];\n  try{await renderCal();setBadge(true);}\n  catch(e){setBadge(false);showToast("\u52a0\u8f7d\u5931\u8d25: "+(e.message||"\u672a\u77e5\u9519\u8bef"));setLD(false);}\n  rb.classList.remove("spin");\n}\nfunction setLD(s){el("LO").style.display=s?"flex":"none";}\nfunction setBadge(ok){var e=el("CB");e.textContent=ok?"\u5df2\u8fde\u63a5":"\u8fde\u63a5\u5931\u8d25";e.className="cb "+(ok?"ok":"er");}\nfunction showToast(msg){var e=el("toast");e.textContent=msg;e.style.display="block";clearTimeout(e._t);e._t=setTimeout(function(){e.style.display="none";},5000);}\n</script>\n</body>\n</html>';

const server = http.createServer(async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  // 调试接口：看原始数据
  if (url.pathname === '/api/debug') {
    try {
      const recs = await fetchAll(TABLES.nurse);
      const sample = recs.slice(0, 3).map(function(r) {
        var out = {};
        Object.keys(r.fields).forEach(function(k) { out[k] = r.fields[k]; });
        return out;
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(sample, null, 2));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
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
