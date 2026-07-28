#!/usr/bin/env node

import { readdirSync, writeFileSync } from 'node:fs';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function generateIndex() {
  const files = readdirSync('docs')
    .filter(f => f.startsWith('dmt-') && f.endsWith('.html') && f !== 'index.html')
    .sort()
    .reverse();

  let links = '';
  for (const name of files.slice(0, 60)) {
    const dateStr = name.replace('dmt-', '').replace('.html', '');
    let dateDisplay = dateStr;
    let weekday = '';
    try {
      const d = new Date(dateStr);
      dateDisplay = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
      weekday = WEEKDAYS[d.getDay()];
    } catch { /* keep raw */ }
    links += `    <li><a href="${name}">📅 ${dateDisplay}（週${weekday}）</a></li>\n`;
  }

  const total = files.length;

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>DMT Research · 舞蹈治療文獻日報</title>
<meta name="description" content="舞蹈治療/動態治療文獻日報，每日自動彙整 PubMed 最新論文"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&family=Crimson+Pro:wght@400;600;700&display=swap" rel="stylesheet"/>
<style>
:root{--bg:#f6f1e8;--surface:#fffaf2;--line:#d8c5ab;--text:#2b2118;--muted:#766453;--accent:#8c4f2b;--accent-soft:#ead2bf;--shadow:0 2px 12px rgba(139,79,43,.07)}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:radial-gradient(circle at top,#fff6ea 0,var(--bg) 55%,#ead8c6 100%);color:var(--text);font-family:'Noto Sans TC','PingFang TC','Helvetica Neue',Arial,sans-serif;min-height:100vh;line-height:1.7}
.container{max-width:680px;margin:0 auto;padding:40px 20px 64px}
header{text-align:center;margin-bottom:36px;padding:40px 24px 32px;background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}
.logo{font-size:56px;margin-bottom:10px}
h1{font-family:'Crimson Pro','Noto Sans TC',serif;font-size:30px;font-weight:700;color:var(--accent);letter-spacing:.5px;margin-bottom:6px}
.subtitle{font-size:15px;color:var(--muted);margin-bottom:6px}
.count{font-size:13px;color:var(--accent-soft);background:var(--accent);display:inline-block;padding:4px 16px;border-radius:16px;color:#fff}
ul{list-style:none;margin-top:24px}
li{margin-bottom:10px}
li a{display:block;padding:14px 20px;background:var(--surface);border:1px solid var(--line);border-radius:12px;text-decoration:none;color:var(--text);font-size:15px;transition:transform .15s,box-shadow .15s,border-color .15s;box-shadow:var(--shadow)}
li a:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(139,79,43,.12);border-color:var(--accent)}
.clinic-banner{margin:40px 0 20px;padding:24px;background:var(--surface);border:1px solid var(--line);border-radius:14px;text-align:center}
.clinic-links{display:flex;flex-wrap:wrap;justify-content:center;gap:16px}
.clinic-link{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;background:var(--accent);color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:500;transition:background .2s,transform .15s}
.clinic-link:hover{background:#a3613a;transform:translateY(-1px)}
.coffee-link{background:#ff813f}
.coffee-link:hover{background:#e0703a}
.clinic-icon{font-size:18px}
footer{text-align:center;padding:32px 0 0;border-top:1px solid var(--line);margin-top:36px;color:var(--muted);font-size:13px}
footer a{color:var(--accent);text-decoration:none}
@media(max-width:640px){
  .container{padding:16px 12px 40px}
  header{padding:24px 16px 20px}
  h1{font-size:24px}
  li a{padding:12px 16px;font-size:14px}
}
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="logo">💃</div>
    <h1>DMT Research Daily</h1>
    <p class="subtitle">舞蹈治療 / 動態治療文獻日報 · 每日自動更新</p>
    <span class="count">共 ${total} 期日報</span>
  </header>
  <ul>
${links}  </ul>
  <div class="clinic-banner">
    <div class="clinic-links">
      <a href="https://www.leepsyclinic.com/" target="_blank" rel="noopener noreferrer" class="clinic-link">
        <span class="clinic-icon">🏥</span> 李政洋身心診所首頁
      </a>
      <a href="https://blog.leepsyclinic.com/" target="_blank" rel="noopener noreferrer" class="clinic-link">
        <span class="clinic-icon">📬</span> 訂閱電子報
      </a>
      <a href="https://buymeacoffee.com/CYlee" target="_blank" rel="noopener noreferrer" class="clinic-link coffee-link">
        <span class="clinic-icon">☕</span> Buy Me a Coffee
      </a>
    </div>
  </div>
  <footer>
    <p>由 NVIDIA AI 分析生成 · 資料來源：<a href="https://pubmed.ncbi.nlm.nih.gov/" target="_blank" rel="noopener noreferrer">PubMed</a></p>
    <p style="margin-top:4px">© ${new Date().getFullYear()} 舞蹈治療文獻日報</p>
  </footer>
</div>
</body>
</html>`;

  writeFileSync('docs/index.html', html, 'utf-8');
  console.error(`[INFO] Index page generated with ${total} reports`);
}

generateIndex();
