#!/usr/bin/env node
// Fetches BibTeX for all references using:
//   1. CrossRef transform endpoint (for entries with DOIs)
//   2. DBLP search (for ACM/IEEE papers without DOI)
//   Falls back to @misc with the full reference text.

const https = require('https');
const fs = require('fs');

const refs = JSON.parse(fs.readFileSync('./refs_raw.json', 'utf8'));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const httpsGet = (url, headers = {}) => new Promise((resolve, reject) => {
  const opts = new URL(url);
  https.get({
    hostname: opts.hostname,
    path: opts.pathname + opts.search,
    headers: { 'User-Agent': 'fcktaps/1.0 mailto:lukas@rambold.de', ...headers }
  }, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => resolve({ status: res.statusCode, body: data }));
  }).on('error', reject);
});

// Extract DOI from text
const extractDoi = (text) => {
  const m = text.match(/(?:https?:\/\/doi\.org\/|doi:\s*)(10\.\d{4,}\/[^\s\]>,"]+)/i)
    || text.match(/\b(10\.\d{4,}\/[^\s\]>,"]+)/);
  return m ? m[1].replace(/[.)]+$/, '') : null;
};

// Fetch BibTeX from CrossRef transform (no redirects needed)
const fetchBibtexFromCrossRef = async (doi) => {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}/transform/application/x-bibtex`;
  try {
    const res = await httpsGet(url);
    if (res.status === 200 && res.body.includes('@')) return res.body.trim();
    return null;
  } catch { return null; }
};

// Search DBLP and return first BibTeX hit
const fetchBibtexFromDblp = async (query) => {
  const q = encodeURIComponent(query.slice(0, 150));
  const url = `https://dblp.org/search/publ/api?q=${q}&h=1&format=bib`;
  try {
    const res = await httpsGet(url);
    if (res.status === 200 && res.body.includes('@')) return res.body.trim();
    return null;
  } catch { return null; }
};

// Create @misc fallback
const makeMiscEntry = (key, text) => {
  const clean = text.replace(/[{}\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  return `@misc{${key},\n  note = {${clean}}\n}`;
};

// Build a stable BibTeX key from sort-key prefix + year
const makeKey = (text) => {
  const sortMatch = text.match(/^([A-Za-z]+)/);
  const base = sortMatch ? sortMatch[1] : 'ref';
  const yearMatch = text.match(/\b(20\d{2}|19\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : '';
  const titleMatch = text.match(/\.\s+([A-Z][a-z]{3,})/);
  const titleWord = titleMatch ? titleMatch[1].toLowerCase() : '';
  return (base + (year ? '_' + year : '') + (titleWord ? '_' + titleWord : '')).toLowerCase();
};

// Strip sort-key prefix (first CamelCase word before the real author name)
const stripSortKey = (text) => text.replace(/^[A-Za-z]+\s+/, '');

(async () => {
  const results = [];

  for (const ref of refs) {
    const key = makeKey(ref.text);
    const cleanText = stripSortKey(ref.text);
    const doi = extractDoi(ref.text);

    process.stderr.write(`[${ref.i}/77] key=${key} doi=${doi || 'none'}\n`);

    let bibtex = null;

    // 1. Try CrossRef with DOI
    if (doi) {
      bibtex = await fetchBibtexFromCrossRef(doi);
      if (bibtex) {
        bibtex = bibtex.replace(/^(@\w+\{)[^,]+,/, `$1${key},`);
      }
    }

    // 2. Try DBLP title search (good for ACM/IEEE CS papers)
    if (!bibtex) {
      // Extract title from the reference text (after the year)
      const titleMatch = cleanText.match(/\d{4}\.\s+(.+?)\.\s+In\s/);
      const title = titleMatch ? titleMatch[1] : cleanText.slice(0, 80);
      bibtex = await fetchBibtexFromDblp(title);
      if (bibtex) {
        bibtex = bibtex.replace(/^(@\w+\{)[^,]+,/, `$1${key},`);
      }
    }

    // 3. Fallback @misc
    if (!bibtex) {
      bibtex = makeMiscEntry(key, cleanText);
    }

    results.push({ i: ref.i, anchors: ref.anchors, key, bibtex });
    await sleep(150);
  }

  // Write zotero.bib
  fs.writeFileSync('./zotero.bib', results.map(r => r.bibtex).join('\n\n'), 'utf8');

  // Write reference_keys.csv — one unique key per bibliography entry. An
  // entry may have several Word anchors, which all map to this one key.
  const csvLines = results.map(r => r.key);
  fs.writeFileSync('./reference_keys.csv', csvLines.join('\n') + '\n', 'utf8');

  // Debug index
  fs.writeFileSync('./refs_keys.json',
    JSON.stringify(results.map(r => ({ i: r.i, anchors: r.anchors, key: r.key })), null, 2), 'utf8');

  process.stderr.write(`\nDone. ${results.length} refs, ${csvLines.length} CSV lines\n`);
})();
