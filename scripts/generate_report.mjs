#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const API_BASE = process.env.ZHIPU_API_BASE || 'https://open.bigmodel.cn/api/coding/paas/v4';
const MODELS = ['GLM-5-Turbo', 'GLM-4.7', 'GLM-4.7-Flash'];
const MAX_TOKENS = 50000;
const REQUEST_TIMEOUT = 480000;
const SUMMARIZED_PATH = 'data/summarized.json';

const SYSTEM_PROMPT = `你是舞蹈治療（Dance/Movement Therapy, DMT）領域的資深研究員與科學傳播者。你的任務是：
1. 從提供的醫學文獻中，篩選出與舞蹈治療、舞蹈介入、身體取向心理治療最相關的論文
2. 對每篇論文進行繁體中文摘要、分類
3. 評估其臨床實用性（高/中/低）
4. 生成適合醫療專業人員與治療師閱讀的日報

輸出格式要求：
- 語言：繁體中文（台灣用語）
- 專業但易懂
- 每篇論文需包含：中文標題、一句話總結、臨床實用性、分類標籤
- 最後提供今日精選 TOP 3
- 回傳格式必須是純 JSON，不要用 markdown code block 包裹。`;

const CLINIC_LINKS = `
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
</div>`;

function loadPapers(inputPath) {
  const raw = readFileSync(inputPath, 'utf-8');
  return JSON.parse(raw);
}

function loadSummarized() {
  if (!existsSync(SUMMARIZED_PATH)) return { pmids: [], lastUpdated: '' };
  try {
    return JSON.parse(readFileSync(SUMMARIZED_PATH, 'utf-8'));
  } catch {
    return { pmids: [], lastUpdated: '' };
  }
}

function saveSummarized(pmids) {
  const data = { pmids, lastUpdated: new Date().toISOString() };
  writeFileSync(SUMMARIZED_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function filterNewPapers(papersData, summarizedPmids) {
  const set = new Set(summarizedPmids);
  return papersData.papers.filter(p => !set.has(p.pmid));
}

function buildPrompt(papersData, newPapers, dateStr) {
  const papersText = JSON.stringify(newPapers, null, 2);
  return `以下是 ${dateStr} 從 PubMed 抓取的最新舞蹈治療/動態治療相關文獻（共 ${newPapers.length} 篇新文獻）。

請進行以下分析，並以 JSON 格式回傳（不要用 markdown code block）：

{
  "date": "${dateStr}",
  "market_summary": "1-2句話總結今天文獻的整體趨勢與亮點",
  "top_picks": [
    {
      "rank": 1,
      "title_zh": "中文標題",
      "title_en": "English Title",
      "journal": "期刊名",
      "summary": "一句話總結（繁體中文，點出核心發現與臨床意義）",
      "clinical_utility": "高/中/低",
      "utility_reason": "為什麼實用的一句話說明",
      "tags": ["標籤1", "標籤2"],
      "url": "原文連結",
      "emoji": "相關emoji"
    }
  ],
  "all_papers": [
    {
      "title_zh": "中文標題",
      "title_en": "English Title",
      "journal": "期刊名",
      "summary": "一句話總結",
      "clinical_utility": "高/中/低",
      "tags": ["標籤1"],
      "url": "連結",
      "emoji": "emoji"
    }
  ],
  "keywords": ["關鍵字1", "關鍵字2"],
  "topic_distribution": {
    "憂鬱症": 3,
    "舞蹈治療機制": 2
  }
}

原始文獻資料：
${papersText}

請篩選出最重要的 TOP 5-8 篇論文放入 top_picks（按重要性排序），其餘放入 all_papers。
每篇 paper 的 tags 請從以下選擇：舞蹈治療、憂鬱症、焦慮症、創傷/PTSD、身體意象、失智症、帕金森氏症、自閉症、兒童青少年、神經科學、復健醫學、社會連結、社區健康、安寧緩和、癌症照護、老年人、運動科學、體現認知、動作觀察、團體治療、身心醫學、創意藝術治療、焦點族群。
記住：回傳純 JSON，不要用 \`\`\`json\`\`\` 包裹。`;
}

function cleanJsonResponse(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  cleaned = cleaned.trim();
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
  }
  return cleaned;
}

async function callAI(apiKey, prompt) {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  for (const model of MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.error(`[INFO] Trying ${model} (attempt ${attempt + 1})...`);
        const resp = await fetch(`${API_BASE}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: prompt },
            ],
            temperature: 0.3,
            top_p: 0.9,
            max_tokens: MAX_TOKENS,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        });

        if (resp.status === 429) {
          const wait = 60000 * (attempt + 1);
          console.error(`[WARN] Rate limited, waiting ${wait / 1000}s...`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }

        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          console.error(`[ERROR] HTTP ${resp.status}: ${body.slice(0, 200)}`);
          if (resp.status >= 500) continue;
          break;
        }

        const data = await resp.json();
        const rawContent = data.choices?.[0]?.message?.content || '';
        const cleaned = cleanJsonResponse(rawContent);

        try {
          const result = JSON.parse(cleaned);
          console.error(`[INFO] Analysis complete with ${model}: ${result.top_picks?.length || 0} top picks`);
          return result;
        } catch (parseErr) {
          console.error(`[WARN] JSON parse failed (attempt ${attempt + 1}): ${parseErr.message}`);
          console.error(`[DEBUG] First 500 chars: ${cleaned.slice(0, 500)}`);
          if (attempt < 2) await new Promise(r => setTimeout(r, 5000));
          continue;
        }
      } catch (err) {
        if (err.name === 'TimeoutError') {
          console.error(`[WARN] ${model} timed out (attempt ${attempt + 1})`);
        } else {
          console.error(`[ERROR] ${model} failed: ${err.message}`);
        }
        if (attempt < 2) await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  console.error('[ERROR] All models and attempts failed');
  return null;
}

function generateHtml(analysis, dateStr) {
  const dateParts = dateStr.split('-');
  const dateDisplay = dateParts.length === 3
    ? `${dateParts[0]}年${parseInt(dateParts[1])}月${parseInt(dateParts[2])}日`
    : dateStr;

  const summary = analysis.market_summary || '';
  const topPicks = analysis.top_picks || [];
  const allPapers = analysis.all_papers || [];
  const keywords = analysis.keywords || [];
  const topicDist = analysis.topic_distribution || {};
  const totalCount = topPicks.length + allPapers.length;

  let topPicksHtml = '';
  for (const pick of topPicks) {
    const tags = (pick.tags || []).map(t => `<span class="tag">${t}</span>`).join('');
    const util = pick.clinical_utility || '中';
    const utilClass = util === '高' ? 'utility-high' : (util === '中' ? 'utility-mid' : 'utility-low');
    topPicksHtml += `
        <div class="news-card featured">
          <div class="card-header">
            <span class="rank-badge">#${pick.rank || ''}</span>
            <span class="emoji-icon">${pick.emoji || '📄'}</span>
            <span class="${utilClass}">${util}實用性</span>
          </div>
          <h3>${escHtml(pick.title_zh || pick.title_en || '')}</h3>
          <p class="journal-source">${escHtml(pick.journal || '')} · ${escHtml(pick.title_en || '')}</p>
          <p>${escHtml(pick.summary || '')}</p>
          ${pick.utility_reason ? `<p class="utility-reason">💡 ${escHtml(pick.utility_reason)}</p>` : ''}
          <div class="card-footer">
            ${tags}
            <a href="${escAttr(pick.url || '#')}" target="_blank" rel="noopener noreferrer">閱讀原文 →</a>
          </div>
        </div>`;
  }

  let allPapersHtml = '';
  for (const paper of allPapers) {
    const tags = (paper.tags || []).map(t => `<span class="tag">${t}</span>`).join('');
    const util = paper.clinical_utility || '中';
    const utilClass = util === '高' ? 'utility-high' : (util === '中' ? 'utility-mid' : 'utility-low');
    allPapersHtml += `
        <div class="news-card">
          <div class="card-header-row">
            <span class="emoji-sm">${paper.emoji || '📄'}</span>
            <span class="${utilClass} utility-sm">${util}</span>
          </div>
          <h3>${escHtml(paper.title_zh || paper.title_en || '')}</h3>
          <p class="journal-source">${escHtml(paper.journal || '')}</p>
          <p>${escHtml(paper.summary || '')}</p>
          <div class="card-footer">
            ${tags}
            <a href="${escAttr(paper.url || '#')}" target="_blank" rel="noopener noreferrer">PubMed →</a>
          </div>
        </div>`;
  }

  const keywordsHtml = keywords.map(k => `<span class="keyword">${escHtml(k)}</span>`).join('');

  let topicBarsHtml = '';
  if (Object.keys(topicDist).length) {
    const maxCount = Math.max(...Object.values(topicDist), 1);
    for (const [topic, count] of Object.entries(topicDist)) {
      const widthPct = Math.round((count / maxCount) * 100);
      topicBarsHtml += `
            <div class="topic-row">
              <span class="topic-name">${escHtml(topic)}</span>
              <div class="topic-bar-bg"><div class="topic-bar" style="width:${widthPct}%"></div></div>
              <span class="topic-count">${count}</span>
            </div>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>DMT Research · 舞蹈治療文獻日報 · ${dateDisplay}</title>
<meta name="description" content="${dateDisplay} 舞蹈治療/動態治療文獻日報，由 AI 自動彙整 PubMed 最新論文"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&family=Crimson+Pro:wght@400;600;700&display=swap" rel="stylesheet"/>
<style>
:root{--bg:#f6f1e8;--surface:#fffaf2;--line:#d8c5ab;--text:#2b2118;--muted:#766453;--accent:#8c4f2b;--accent-soft:#ead2bf;--card-bg:#fffdf8;--shadow:0 2px 12px rgba(139,79,43,.07)}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:radial-gradient(circle at top,#fff6ea 0,var(--bg) 55%,#ead8c6 100%);color:var(--text);font-family:'Noto Sans TC','PingFang TC','Helvetica Neue',Arial,sans-serif;min-height:100vh;overflow-x:hidden;line-height:1.7}
.container{max-width:860px;margin:0 auto;padding:32px 20px 64px}
header{text-align:center;margin-bottom:40px;padding:36px 24px 28px;background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}
.logo{font-size:52px;margin-bottom:8px}
h1{font-family:'Crimson Pro','Noto Sans TC',serif;font-size:28px;font-weight:700;color:var(--accent);letter-spacing:.5px;margin-bottom:4px}
.subtitle{font-size:15px;color:var(--muted);font-weight:400}
.date-badge{display:inline-block;margin-top:10px;padding:4px 16px;background:var(--accent);color:#fff;border-radius:20px;font-size:13px;font-weight:500}
.summary-card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:22px 26px;margin-bottom:36px;box-shadow:var(--shadow)}
.summary-card h2{font-size:16px;color:var(--accent);margin-bottom:8px;font-weight:600}
.summary-card p{font-size:15px;color:var(--text);line-height:1.8}
.section-title{font-size:18px;font-weight:700;color:var(--accent);margin:36px 0 16px;display:flex;align-items:center;gap:8px}
.section-title::before{content:'';display:inline-block;width:4px;height:20px;background:var(--accent);border-radius:2px}
.news-card{background:var(--card-bg);border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin-bottom:16px;box-shadow:var(--shadow);transition:transform .15s,box-shadow .15s}
.news-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(139,79,43,.12)}
.news-card.featured{border-left:4px solid var(--accent)}
.card-header{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.rank-badge{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;background:var(--accent);color:#fff;border-radius:50%;font-size:13px;font-weight:700}
.emoji-icon{font-size:22px}
.utility-high{color:#1a7a3a;font-weight:600;font-size:13px;background:#e8f5e9;padding:2px 10px;border-radius:10px}
.utility-mid{color:#8c6d1f;font-weight:600;font-size:13px;background:#fff8e1;padding:2px 10px;border-radius:10px}
.utility-low{color:#999;font-weight:600;font-size:13px;background:#f5f5f5;padding:2px 10px;border-radius:10px}
.card-header-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.emoji-sm{font-size:18px}
.utility-sm{font-size:12px}
h3{font-size:16px;font-weight:600;color:var(--text);margin-bottom:6px;line-height:1.5}
.journal-source{font-size:13px;color:var(--muted);margin-bottom:8px}
.utility-reason{font-size:13px;color:var(--muted);font-style:italic;margin-top:6px}
.card-footer{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line)}
.tag{display:inline-block;padding:2px 10px;background:var(--accent-soft);color:var(--accent);border-radius:10px;font-size:12px;font-weight:500}
.card-footer a{margin-left:auto;font-size:13px;color:var(--accent);text-decoration:none;font-weight:500}
.card-footer a:hover{text-decoration:underline}
.keywords-section{margin:32px 0;padding:20px 24px;background:var(--surface);border:1px solid var(--line);border-radius:14px}
.keywords-section h2{font-size:16px;color:var(--accent);margin-bottom:12px}
.keyword{display:inline-block;padding:4px 14px;margin:3px;border:1px solid var(--line);border-radius:16px;font-size:13px;color:var(--muted);background:var(--bg)}
.topic-section{margin:32px 0;padding:20px 24px;background:var(--surface);border:1px solid var(--line);border-radius:14px}
.topic-section h2{font-size:16px;color:var(--accent);margin-bottom:14px}
.topic-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.topic-name{min-width:100px;font-size:13px;color:var(--text);text-align:right}
.topic-bar-bg{flex:1;height:16px;background:var(--bg);border-radius:8px;overflow:hidden}
.topic-bar{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-soft));border-radius:8px;transition:width .3s}
.topic-count{min-width:24px;font-size:13px;color:var(--muted);font-weight:600}
.clinic-banner{margin:40px 0 20px;padding:24px;background:var(--surface);border:1px solid var(--line);border-radius:14px;text-align:center}
.clinic-links{display:flex;flex-wrap:wrap;justify-content:center;gap:16px}
.clinic-link{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;background:var(--accent);color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:500;transition:background .2s,transform .15s}
.clinic-link:hover{background:#a3613a;transform:translateY(-1px)}
.coffee-link{background:#ff813f}
.coffee-link:hover{background:#e0703a}
.clinic-icon{font-size:18px}
footer{text-align:center;padding:32px 0 0;border-top:1px solid var(--line);margin-top:40px;color:var(--muted);font-size:13px}
footer a{color:var(--accent);text-decoration:none}
.empty-msg{text-align:center;padding:48px 24px;color:var(--muted);font-size:15px}
@media(max-width:640px){
  .container{padding:16px 12px 40px}
  header{padding:24px 16px 20px}
  h1{font-size:22px}
  .news-card{padding:16px}
  .clinic-links{flex-direction:column;align-items:center}
}
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="logo">💃</div>
    <h1>DMT Research Daily</h1>
    <p class="subtitle">舞蹈治療 / 動態治療文獻日報 · 每日自動更新</p>
    <span class="date-badge">📅 ${dateDisplay}</span>
  </header>

  ${summary ? `<div class="summary-card"><h2>📊 今日趨勢摘要</h2><p>${escHtml(summary)}</p></div>` : ''}

  ${topPicks.length ? `<div class="section-title">🏆 今日精選 TOP ${topPicks.length}</div>${topPicksHtml}` : ''}

  ${allPapers.length ? `<div class="section-title">📋 所有文獻（共 ${totalCount} 篇）</div>${allPapersHtml}` : ''}

  ${!topPicks.length && !allPapers.length ? '<div class="empty-msg">📭 今日尚無新的舞蹈治療相關文獻，明天見！</div>' : ''}

  ${topicBarsHtml ? `<div class="topic-section"><h2>📈 主題分佈</h2>${topicBarsHtml}</div>` : ''}

  ${keywordsHtml ? `<div class="keywords-section"><h2>🏷️ 關鍵字</h2>${keywordsHtml}</div>` : ''}

  ${CLINIC_LINKS}

  <footer>
    <p>由 <a href="https://open.bigmodel.cn/" target="_blank" rel="noopener noreferrer">Zhipu AI</a> 分析生成 · 資料來源：<a href="https://pubmed.ncbi.nlm.nih.gov/" target="_blank" rel="noopener noreferrer">PubMed</a></p>
    <p style="margin-top:4px">© ${dateStr.split('-')[0]} 舞蹈治療文獻日報 · <a href="index.html">返回首頁</a></p>
  </footer>
</div>
</body>
</html>`;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
  return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', default: 'papers.json' },
      output: { type: 'string', required: true },
    },
  });

  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    console.error('[FATAL] ZHIPU_API_KEY not set');
    process.exit(1);
  }

  const targetDate = process.env.TARGET_DATE || values.output.match(/dmt-(\d{4}-\d{2}-\d{2})/)?.[1] || new Date().toISOString().slice(0, 10);

  const papersData = loadPapers(values.input);
  const summarized = loadSummarized();
  const newPapers = filterNewPapers(papersData, summarized.pmids);

  console.error(`[INFO] Total papers: ${papersData.count}, Already summarized: ${summarized.pmids.length}, New: ${newPapers.length}`);

  if (newPapers.length === 0) {
    console.error('[INFO] No new papers to summarize');
    const emptyAnalysis = {
      date: targetDate,
      market_summary: '今日沒有新的舞蹈治療相關文獻。',
      top_picks: [],
      all_papers: [],
      keywords: [],
      topic_distribution: {},
    };
    const html = generateHtml(emptyAnalysis, targetDate);
    writeFileSync(values.output, html, 'utf-8');
    console.error(`[INFO] Empty report saved to ${values.output}`);
    return;
  }

  const prompt = buildPrompt(papersData, newPapers, targetDate);
  const analysis = await callAI(apiKey, prompt);

  if (!analysis) {
    const fallbackAnalysis = {
      date: targetDate,
      market_summary: `今日共 ${newPapers.length} 篇新的舞蹈治療相關文獻（AI 分析暫時不可用）.`,
      top_picks: [],
      all_papers: newPapers.slice(0, 20).map(p => ({
        title_zh: p.title,
        title_en: p.title,
        journal: p.journal,
        summary: p.abstract?.slice(0, 200) || '暫無摘要',
        clinical_utility: '中',
        tags: p.keywords?.slice(0, 3) || [],
        url: p.url,
        emoji: '📄',
      })),
      keywords: [],
      topic_distribution: {},
    };
    const html = generateHtml(fallbackAnalysis, targetDate);
    writeFileSync(values.output, html, 'utf-8');
    const newPmids = newPapers.map(p => p.pmid).filter(Boolean);
    saveSummarized([...new Set([...summarized.pmids, ...newPmids])]);
    console.error(`[WARN] Used fallback. Saved ${newPmids.length} PMIDs to summarized.json`);
    return;
  }

  if (!analysis.date) analysis.date = targetDate;

  const html = generateHtml(analysis, targetDate);
  writeFileSync(values.output, html, 'utf-8');

  const newPmids = newPapers.map(p => p.pmid).filter(Boolean);
  const updatedPmids = [...new Set([...summarized.pmids, ...newPmids])];
  saveSummarized(updatedPmids);

  console.error(`[INFO] Report saved to ${values.output}`);
  console.error(`[INFO] Updated summarized.json with ${newPmids.length} new PMIDs (total: ${updatedPmids.length})`);
}

main().catch(err => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
