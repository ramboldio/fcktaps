#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const readStdin = () => new Promise(resolve => {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => data += chunk);
  process.stdin.on("end", () => resolve(data));
});

const stringify = node => {
  if (node === null || node === undefined) return "";
  if (Array.isArray(node)) return node.map(stringify).join("");
  if (typeof node !== "object") return "";
  if (node.t === "Str") return node.c;
  if (["Space", "SoftBreak", "LineBreak"].includes(node.t)) return " ";
  return stringify(node.c);
};

const anchors = node => {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(anchors);
  if (node.t === "Span" && node.c[0][1]?.includes("anchor")) return [node.c[0][0]];
  return anchors(node.c);
};

const normalize = value => value
  .replace(/<\/?[^>]+>/g, "")
  .replace(/&(?:amp|#38);/gi, " and ")
  .replace(/([A-ZÀ-ÖØ-Þ]+)([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ])/g, "$1 $2")
  .replace(/([a-zà-öø-ÿ])([A-ZÀ-ÖØ-Þ])/g, "$1 $2")
  .replace(/\\(?:url|emph|textit|textbf)\s*\{([^{}]*)\}/g, "$1")
  .replace(/\\["'`^~=.uvHckbdtr]\s*\{?([A-Za-z])\}?/g, "$1")
  .replace(/\\&/g, " and ")
  .replace(/[{}]/g, "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^A-Za-z0-9]+/g, " ")
  .trim()
  .toLowerCase();

const displayBibtex = value => value
  .replace(/<\/?[^>]+>/g, "")
  .replace(/&(?:amp|#38);/gi, "&")
  .replace(/\\(?:url|emph|textit|textbf)\s*\{([^{}]*)\}/g, "$1")
  .replace(/\\["'`^~=.uvHckbdtr]\s*\{?([A-Za-z])\}?/g, "$1")
  .replace(/\\&/g, "&")
  .replace(/[{}]/g, "")
  .replace(/\s+/g, " ")
  .trim();

const doiFrom = value => {
  const match = displayBibtex(value).match(
    /(?:https?:\/\/(?:dx\.)?doi\.org\/|\bdoi\s*[:=]\s*)?(10\.\d{4,9}\/[\w.()/:;+-]+)/i
  );
  return match ? match[1].replace(/[.,;)]+$/, "").toLowerCase() : null;
};

const urlsFrom = value => {
  const cleaned = displayBibtex(value);
  return [...cleaned.matchAll(/https?:\/\/[^\s<>{}]+/gi)]
    .map(match => match[0].replace(/[.,;)]+$/, ""));
};

const normalizedUrl = value => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = decodeURIComponent(url.pathname).replace(/\/$/, "");
    const query = [...url.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${key}=${item}`)
      .join("&");
    return `${host}${path}${query ? `?${query}` : ""}`;
  } catch {
    return value.toLowerCase().replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/$/, "");
  }
};

const checkDestinations = (index, key, wordText, entry, warning) => {
  const bibDestinationText = [
    entry.fields.doi || "",
    entry.fields.url || "",
    entry.fields.howpublished || "",
  ].join(" ");

  const wordDoi = doiFrom(wordText);
  const bibDoi = doiFrom(bibDestinationText);
  if (wordDoi && !bibDoi) {
    warning(`reference ${index} [${key}] is missing DOI ${wordDoi} from the Word entry`);
  } else if (!wordDoi && bibDoi) {
    warning(`reference ${index} [${key}] has BibTeX DOI ${bibDoi}, but the Word entry has no DOI`);
  } else if (wordDoi && bibDoi && wordDoi !== bibDoi) {
    warning(`reference ${index} [${key}] DOI mismatch; Word says ${wordDoi}, BibTeX says ${bibDoi}`);
  }

  const nonDoiUrls = value => urlsFrom(value).filter(url => !doiFrom(url));
  const wordUrls = nonDoiUrls(wordText);
  const bibUrls = nonDoiUrls(bibDestinationText);
  const wordNormalized = new Set(wordUrls.map(normalizedUrl));
  const bibNormalized = new Set(bibUrls.map(normalizedUrl));
  const missingFromBib = wordUrls.filter(url => !bibNormalized.has(normalizedUrl(url)));
  const missingFromWord = bibUrls.filter(url => !wordNormalized.has(normalizedUrl(url)));

  if (missingFromBib.length || missingFromWord.length) {
    const wordDisplay = wordUrls.length ? wordUrls.join(", ") : "none";
    const bibDisplay = bibUrls.length ? bibUrls.join(", ") : "none";
    warning(`reference ${index} [${key}] link mismatch; Word says ${wordDisplay}, BibTeX says ${bibDisplay}`);
  }
};

const readBraced = (text, start) => {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
};

const parseFields = body => {
  const fields = {};
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i])) i++;
    const nameStart = i;
    while (i < body.length && /[A-Za-z]/.test(body[i])) i++;
    const name = body.slice(nameStart, i).toLowerCase();
    while (i < body.length && /\s/.test(body[i])) i++;
    if (!name || body[i] !== "=") { while (i < body.length && body[i] !== ",") i++; continue; }
    i++;
    while (i < body.length && /\s/.test(body[i])) i++;

    let value = "";
    if (body[i] === "{") {
      const end = readBraced(body, i);
      if (end === -1) break;
      value = body.slice(i + 1, end);
      i = end + 1;
    } else if (body[i] === '"') {
      const start = ++i;
      while (i < body.length && (body[i] !== '"' || body[i - 1] === "\\")) i++;
      value = body.slice(start, i++);
    } else {
      const start = i;
      while (i < body.length && body[i] !== ",") i++;
      value = body.slice(start, i).trim();
    }
    fields[name] = value;
  }
  return fields;
};

const parseBibtex = text => {
  const entries = new Map();
  const header = /@([A-Za-z]+)\s*\{\s*([^,\s]+)\s*,/g;
  let match;
  while ((match = header.exec(text)) !== null) {
    const open = text.indexOf("{", match.index);
    const close = readBraced(text, open);
    if (close === -1) break;
    const comma = text.indexOf(",", open);
    entries.set(match[2], {
      type: match[1].toLowerCase(),
      fields: parseFields(text.slice(comma + 1, close)),
    });
    header.lastIndex = close + 1;
  }
  return entries;
};

const authorNames = field => field.split(/\s+and\s+/i).map(raw => {
  const corporate = /^\s*\{\{/.test(raw);
  const clean = displayBibtex(raw);
  if (corporate || !clean.includes(",")) return clean;
  const [family, ...given] = clean.split(",").map(part => part.trim()).filter(Boolean);
  return [...given, family].join(" ");
}).filter(Boolean);

const initialsOnlyAuthors = field => field.split(/\s+and\s+/i).flatMap(raw => {
  if (/^\s*\{\{/.test(raw)) return [];

  const clean = displayBibtex(raw);
  const commaParts = clean.split(",").map(part => part.trim()).filter(Boolean);
  const words = clean.split(/\s+/).filter(Boolean);
  const givenNames = commaParts.length > 1
    ? commaParts[commaParts.length - 1]
    : words.slice(0, -1).join(" ");
  const initial = part => /^\p{L}$/u.test(part) || /^(?:\p{L}\.)+$/u.test(part);
  const givenNameParts = givenNames
    .split(/[\s~]+/)
    .flatMap(part => part.split(/[-‐‑‒–—]/u))
    .filter(Boolean);
  const initialsOnly = givenNameParts.length > 0 && givenNameParts.every(initial);

  if (!initialsOnly) return [];
  if (commaParts.length <= 1) return [clean];
  return [`${givenNames} ${commaParts[0]}`];
});

const significantTokens = value => normalize(value).split(" ").filter(token => token.length > 1);

const levenshtein = (a, b) => {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
};

const closestTitle = (expected, wordText) => {
  const expectedTokens = normalize(expected).split(" ").filter(Boolean);
  const wordTokens = normalize(wordText).split(" ").filter(Boolean);
  if (!expectedTokens.length) return { similarity: 0, text: "" };
  let best = { similarity: 0, text: "" };
  for (let length = Math.max(1, expectedTokens.length - 2); length <= expectedTokens.length + 2; length++) {
    for (let start = 0; start + length <= wordTokens.length; start++) {
      const candidate = wordTokens.slice(start, start + length).join(" ");
      const target = expectedTokens.join(" ");
      const similarity = 1 - levenshtein(target, candidate) / Math.max(target.length, candidate.length, 1);
      if (similarity > best.similarity) best = { similarity, text: candidate };
    }
  }
  return best;
};

const warningMessages = new Set();
const warning = message => {
  if (warningMessages.has(message)) return;
  warningMessages.add(message);
  const warningsFile = process.env.FCKTAPS_WARNINGS_FILE;
  if (warningsFile) fs.appendFileSync(warningsFile, `${message}\n`, "utf8");
  else process.stderr.write(`WARNING -- ${message}\n\n`);
};

const validate = doc => {
  const cwd = process.cwd();
  const keyPath = path.join(cwd, "reference_keys.csv");
  const bibPath = path.join(cwd, "zotero.bib");
  if (!fs.existsSync(keyPath)) { warning("missing reference_keys.csv"); return; }
  if (!fs.existsSync(bibPath)) { warning("missing zotero.bib"); return; }

  const keys = fs.readFileSync(keyPath, "utf8").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const duplicateKeys = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  if (duplicateKeys.length) {
    warning(`reference_keys.csv contains duplicate keys: ${duplicateKeys.join(", ")}`);
  }
  const bibEntries = parseBibtex(fs.readFileSync(bibPath, "utf8"));
  const bibliography = doc.blocks.find(block => block.t === "OrderedList");
  if (!bibliography) { warning("Word bibliography list is missing"); return; }

  const anchorToKey = new Map();
  bibliography.c[1].forEach((item, index) => {
    const itemAnchors = anchors(item);
    const key = keys[index];
    itemAnchors.forEach(anchor => anchorToKey.set(anchor, key));

    if (!itemAnchors.length || !key) {
      warning(`Word reference ${index + 1} has no reference_keys.csv mapping`);
      return;
    }

    const entry = bibEntries.get(key);
    if (!entry) {
      warning(`Word reference ${index + 1} maps to missing BibTeX entry "${key}"`);
      return;
    }

    const wordText = stringify(item).replace(/\s+/g, " ").trim();
    const wordTokens = new Set(significantTokens(wordText));
    const authors = entry.fields.author ? authorNames(entry.fields.author) : [];
    if (!authors.length) {
      warning(`reference ${index + 1} [${key}] has no BibTeX author`);
    } else {
      const missingAuthors = authors.filter(author =>
        significantTokens(author).some(token => !wordTokens.has(token))
      );
      if (missingAuthors.length) {
        warning(`reference ${index + 1} [${key}] is missing author(s) from the Word entry: ${missingAuthors.join("; ")}`);
      }

      const initialsOnly = initialsOnlyAuthors(entry.fields.author);
      if (initialsOnly.length) {
        warning(
          `reference ${index + 1} [${key}] has BibTeX author name(s) containing only initials; ` +
          `ACM style requires at least one given name to be spelled out: ${initialsOnly.join("; ")}`
        );
      }
    }

    const title = displayBibtex(entry.fields.title || "");
    if (!title) {
      warning(`reference ${index + 1} [${key}] has no BibTeX title`);
    } else if (!normalize(wordText).includes(normalize(title))) {
      const closest = closestTitle(title, wordText);
      if (closest.similarity < 0.88) {
        warning(
          `reference ${index + 1} [${key}] title mismatch; BibTeX says "${title}"` +
          (closest.text ? `, closest Word text is "${closest.text}"` : "")
        );
      }
    }

    const year = displayBibtex(entry.fields.year || "");
    if (year && entry.type !== "misc" && !new RegExp(`\\b${year}\\b`).test(wordText)) {
      warning(`reference ${index + 1} [${key}] year mismatch; BibTeX says ${year}`);
    }

    checkDestinations(index + 1, key, wordText, entry, warning);
  });

  if (bibliography.c[1].length !== keys.length) {
    warning(`reference_keys.csv has ${keys.length} lines but the Word bibliography has ${bibliography.c[1].length} entries`);
  }

  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node.t === "Link" && /^\[\d+\]$/.test(stringify(node.c[1]).trim())) {
      const anchor = node.c[2][0].replace(/^#/, "");
      const key = anchorToKey.get(anchor);
      if (!key) warning(`citation ${stringify(node.c[1]).trim()} points to unmapped Word anchor "${anchor}"`);
    }
    if (node.c) visit(node.c);
  };
  visit(doc.blocks);

  const usedKeys = new Set(keys);
  for (const key of bibEntries.keys()) {
    if (!usedKeys.has(key)) warning(`unused BibTeX entry "${key}" is not present in reference_keys.csv`);
  }
};

(async () => {
  const doc = JSON.parse(await readStdin());
  validate(doc);
  process.stdout.write(JSON.stringify(doc));
})();
