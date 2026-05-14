#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';

const PUBMED_SEARCH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
const PUBMED_FETCH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi';
const HEADERS = { 'User-Agent': 'DanceTherapyBot/1.0 (research aggregator)' };

const SEARCH_QUERIES = [
  '("Dance Therapy"[Mesh] OR "dance therapy"[tiab] OR "dance movement therapy"[tiab] OR "dance/movement therapy"[tiab] OR "dance movement psychotherapy"[tiab] OR "dance/movement psychotherapy"[tiab] OR "therapeutic dance"[tiab] OR "dance-based intervention"[tiab] OR "dance movement intervention"[tiab])',
  '("dance intervention"[tiab] OR "dance-based"[tiab]) AND ("quality of life"[tiab] OR "mental health"[tiab] OR wellbeing[tiab] OR depression[tiab] OR anxiety[tiab] OR cognition[tiab] OR "body image"[tiab] OR trauma[tiab])',
  '("body-oriented psychotherapy"[tiab] OR "body psychotherapy"[tiab] OR "embodied psychotherapy"[tiab] OR "creative arts therapy"[tiab] OR "expressive therapies"[tiab] OR "arts therapies"[tiab]) AND (dance[tiab] OR movement[tiab])',
  '("movement synchrony"[tiab] OR "kinesthetic empathy"[tiab] OR "mirroring"[tiab] OR "authentic movement"[tiab] OR "Laban Movement Analysis"[tiab]) AND (therapy[tiab] OR intervention[tiab] OR clinical[tiab])',
];

function getDateFilter(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `"${y}/${m}/${dd}"[Date - Publication] : "3000"[Date - Publication]`;
}

function getDateStr() {
  const d = new Date();
  const offset = 8 * 60;
  const taipei = new Date(d.getTime() + (offset + d.getTimezoneOffset()) * 60000);
  return `${taipei.getFullYear()}-${String(taipei.getMonth() + 1).padStart(2, '0')}-${String(taipei.getDate()).padStart(2, '0')}`;
}

async function searchPapers(query, retmax) {
  const url = `${PUBMED_SEARCH}?db=pubmed&term=${encodeURIComponent(query)}&retmax=${retmax}&sort=date&retmode=json`;
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
    if (!resp.ok) {
      console.error(`[WARN] PubMed search returned ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    return data.esearchresult?.idlist || [];
  } catch (err) {
    console.error(`[WARN] PubMed search failed: ${err.message}`);
    return [];
  }
}

async function fetchDetails(pmids) {
  if (!pmids.length) return [];
  const batches = [];
  for (let i = 0; i < pmids.length; i += 100) {
    batches.push(pmids.slice(i, i + 100));
  }
  const allPapers = [];
  for (const batch of batches) {
    const url = `${PUBMED_FETCH}?db=pubmed&id=${batch.join(',')}&retmode=xml`;
    try {
      const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60000) });
      if (!resp.ok) {
        console.error(`[WARN] PubMed fetch returned ${resp.status}`);
        continue;
      }
      const xml = await resp.text();
      const papers = parsePapersXML(xml);
      allPapers.push(...papers);
    } catch (err) {
      console.error(`[WARN] PubMed fetch failed: ${err.message}`);
    }
  }
  return allPapers;
}

function parsePapersXML(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    isArray: (name) => ['PubmedArticle', 'AbstractText', 'Keyword'].includes(name),
  });
  const parsed = parser.parse(xml);
  const articles = parsed?.PubmedArticleSet?.PubmedArticle || [];
  const papers = [];

  for (const article of articles) {
    try {
      const medline = article.MedlineCitation;
      const art = medline?.Article;
      if (!art) continue;

      const titleEl = art.ArticleTitle;
      const title = typeof titleEl === 'string' ? titleEl.trim() : (titleEl?.['#text'] || titleEl?.toString() || '').trim();

      const abstractParts = [];
      const abstractTexts = art.Abstract?.AbstractText || [];
      for (const abs of (Array.isArray(abstractTexts) ? abstractTexts : [abstractTexts])) {
        if (!abs) continue;
        const label = abs['@_Label'] || '';
        const text = typeof abs === 'string' ? abs : (abs['#text'] || '');
        if (label && text) abstractParts.push(`${label}: ${text}`);
        else if (text) abstractParts.push(text);
      }
      const abstract = abstractParts.join(' ').slice(0, 2000);

      const journalEl = art.Journal?.Title;
      const journal = typeof journalEl === 'string' ? journalEl.trim() : (journalEl?.['#text'] || '').trim();

      const pubDate = art.Journal?.JournalIssue?.PubDate;
      let dateStr = '';
      if (pubDate) {
        const parts = [pubDate.Year, pubDate.Month, pubDate.Day].filter(Boolean);
        dateStr = parts.join(' ');
      }

      const pmid = String(medline?.PMID?.['#text'] || medline?.PMID || '');
      const url = pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '';

      const keywords = [];
      const kwList = medline?.KeywordList?.Keyword || [];
      for (const kw of (Array.isArray(kwList) ? kwList : [kwList])) {
        if (kw) keywords.push(typeof kw === 'string' ? kw.trim() : (kw['#text'] || '').trim());
      }

      const authors = [];
      const authorList = art.AuthorList?.Author || [];
      for (const a of (Array.isArray(authorList) ? authorList : [authorList])) {
        if (!a) continue;
        const ln = a.LastName || '';
        const ini = a.Initials || '';
        if (ln) authors.push(`${ln} ${ini}`.trim());
      }

      papers.push({
        pmid,
        title,
        journal,
        date: dateStr,
        abstract,
        url,
        keywords: keywords.slice(0, 10),
        authors: authors.slice(0, 5),
      });
    } catch (err) {
      console.error(`[WARN] Failed to parse article: ${err.message}`);
    }
  }
  return papers;
}

async function main() {
  const { values } = parseArgs({
    options: {
      days: { type: 'string', default: '7' },
      'max-papers': { type: 'string', default: '50' },
      output: { type: 'string', default: 'papers.json' },
    },
  });

  const days = parseInt(values.days, 10);
  const maxPapers = parseInt(values['max-papers'], 10);
  const dateFilter = getDateFilter(days);

  console.error(`[INFO] Searching PubMed for DMT papers from last ${days} days...`);

  const allPmids = new Set();
  for (let i = 0; i < SEARCH_QUERIES.length; i++) {
    const query = `${SEARCH_QUERIES[i]} AND ${dateFilter}`;
    console.error(`[INFO] Running search query ${i + 1}/${SEARCH_QUERIES.length}...`);
    const pmids = await searchPapers(query, maxPapers);
    console.error(`[INFO] Query ${i + 1}: found ${pmids.length} PMIDs`);
    for (const id of pmids) allPmids.add(id);
  }

  const uniquePmids = [...allPmids];
  console.error(`[INFO] Total unique PMIDs: ${uniquePmids.length}`);

  if (!uniquePmids.length) {
    const output = {
      date: getDateStr(),
      count: 0,
      papers: [],
    };
    const jsonStr = JSON.stringify(output, null, 2);
    if (values.output === '-') {
      console.log(jsonStr);
    } else {
      writeFileSync(values.output, jsonStr, 'utf-8');
      console.error(`[INFO] Saved empty results to ${values.output}`);
    }
    return;
  }

  const papers = await fetchDetails(uniquePmids);
  console.error(`[INFO] Fetched details for ${papers.length} papers`);

  const output = {
    date: getDateStr(),
    count: papers.length,
    papers,
  };

  const jsonStr = JSON.stringify(output, null, 2);
  if (values.output === '-') {
    console.log(jsonStr);
  } else {
    writeFileSync(values.output, jsonStr, 'utf-8');
    console.error(`[INFO] Saved to ${values.output}`);
  }
}

main().catch(err => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
