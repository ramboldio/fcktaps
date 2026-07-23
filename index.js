#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const FIGURE_OVERRIDE_PATTERN =
  /^figure([1-9]\d*)((?:-[hu])*)--[a-z0-9]+(?:[-+][a-z0-9]+)*(\.[A-Za-z0-9]+)$/;

const FIGURE_PLACEMENT_ATTRIBUTE = "fcktaps-latex-placement";

const TITLE_CASE_MINOR_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "if", "in",
  "into", "is", "nor", "of", "off", "on", "onto", "or", "per", "so", "the",
  "to", "up", "via", "vs", "w", "with", "yet",
]);
const TITLE_CASE_ACRONYMS = new Set([
  "2D", "3D", "5DOF", "ACM", "AI", "API", "AR", "CAD", "CAM", "CHI", "CNC",
  "CSS", "DOF", "FDM", "GPU", "GUI", "HCI", "HTML", "IEEE", "NIR", "PDF",
  "SIGCHI", "SLA", "SLS", "SVG", "TAPS", "UI", "UIST", "URL", "UV", "UX",
  "VIS", "VR", "XR",
]);
const STRUCTURAL_HEADINGS = new Set([
  "abstract", "acknowledgments", "acknowledgements", "author keywords", "ccs concepts", "references",
]);
const COURIER_NEW_INLINE_CODE_STYLES = new Set([
  "code", "in-text code", "inline code",
]);

const readStdin = () => new Promise((resolve) => {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => data += chunk);
  process.stdin.on("end", () => resolve(data));
});

const warn = (message) => {
  const warningsFile = process.env.FCKTAPS_WARNINGS_FILE;
  if (warningsFile) {
    fs.appendFileSync(warningsFile, `${message}\n`, "utf8");
  } else {
    process.stderr.write(`WARNING -- ${message}\n`);
  }
};

const debug = (message) => {
  const warningsFile = process.env.FCKTAPS_WARNINGS_FILE;
  if (warningsFile) {
    fs.appendFileSync(warningsFile, `DEBUG -- ${message}\n`, "utf8");
  } else {
    const cyan = process.stderr.isTTY ? "\x1b[1;96m" : "";
    const reset = process.stderr.isTTY ? "\x1b[0m" : "";
    process.stderr.write(`${cyan}DEBUG${reset} -- ${message}\n`);
  }
};

const stringify_inlines = (inline_blocks) => inline_blocks.map(b => {
  if (b.t === "Str") return b.c;
  if (b.t === "Space") return " ";
  if (b.t === "Emph" || b.t === "Strong") return stringify_inlines(b.c);
  if (b.t === "Span") return stringify_inlines(b.c[1]);
  return "";
}).join("");

const metadata_text = meta => {
  if (!meta) return "";
  if (meta.t === "MetaString") return meta.c;
  if (meta.t === "MetaInlines") return stringify_inlines(meta.c);
  return "";
};

const is_references_heading = text => text.trim().toLocaleLowerCase() === "references";

const normalized_inline_text = inlines => stringify_inlines(inlines)
  .replace(/\s+/g, " ")
  .trim();

const visit_ast = (value, fn) => {
  if (Array.isArray(value)) {
    value.forEach(child => visit_ast(child, fn));
    return;
  }
  if (!value || typeof value !== "object") return;
  fn(value);
  Object.values(value).forEach(child => visit_ast(child, fn));
};

// Resolve Word bookmarks referenced by the exact text of a unique heading to
// that heading's native Pandoc identifier. This also repairs malformed Word
// bookmarks that begin before the heading and expand across several paragraphs.
const normalize_word_section_cross_references = blocks => {
  const headings_by_text = new Map();
  blocks.filter(block => block.t === "Header").forEach(header => {
    const text = normalized_inline_text(header.c[2]);
    if (!text || !header.c[1][0]) return;
    const matches = headings_by_text.get(text) || [];
    matches.push(header);
    headings_by_text.set(text, matches);
  });

  const word_anchor_ids = new Set();
  visit_ast(blocks, node => {
    if (node.t === "Span" && node.c[0][1].includes("anchor") && node.c[1].length === 0) {
      word_anchor_ids.add(node.c[0][0]);
    }
  });

  const repairs = new Map();
  const link_texts_by_target = new Map();
  visit_ast(blocks, node => {
    if (node.t !== "Link") return;
    const target = node.c[2][0];
    if (!target.startsWith("#") || !word_anchor_ids.has(target.slice(1))) return;
    const link_text = normalized_inline_text(node.c[1]);
    const link_texts = link_texts_by_target.get(target) || [];
    link_texts.push(link_text);
    link_texts_by_target.set(target, link_texts);
    const matching_headings = headings_by_text.get(link_text) || [];
    if (matching_headings.length === 1) repairs.set(target, matching_headings[0]);
  });
  const expanded_targets = new Set();
  repairs.forEach((header, target) => {
    const heading_text = normalized_inline_text(header.c[2]);
    if ((link_texts_by_target.get(target) || []).some(text => text !== heading_text)) {
      expanded_targets.add(target);
    }
  });
  if (repairs.size === 0) return blocks;

  // Pandoc represents a Word hyperlink that crosses paragraph boundaries as
  // one Link per paragraph. Merge only directly contiguous fragments back into
  // the paragraph where the field began, preserving text after the field.
  const continuation_blocks = new Set();
  blocks.forEach((block, block_index) => {
    if (block.t !== "Para" && block.t !== "Plain") return;
    const last = block.c[block.c.length - 1];
    if (block.c.length < 2 || last?.t !== "Link" ||
        !expanded_targets.has(last.c[2][0])) return;

    const target = last.c[2][0];
    for (let i = block_index + 1; i < blocks.length; i += 1) {
      const continuation = blocks[i];
      if (continuation.t !== "Para" && continuation.t !== "Plain") break;
      const first = continuation.c[0];
      if (first?.t !== "Link" || first.c[2][0] !== target) break;

      continuation_blocks.add(continuation);
      if (continuation.c.length > 1) {
        block.c = [...block.c, ...continuation.c.slice(1)];
        break;
      }
    }
  });
  blocks = blocks.filter(block => !continuation_blocks.has(block));

  const rewrite = value => {
    // Pandoc uses meaningful null array elements (for example in captions), so
    // reserve undefined specifically for AST nodes removed by this repair.
    if (Array.isArray(value)) return value.map(rewrite).filter(child => child !== undefined);
    if (!value || typeof value !== "object") return value;

    if (value.t === "Span" && value.c[0][1].includes("anchor") &&
        value.c[1].length === 0 && repairs.has(`#${value.c[0][0]}`)) {
      return undefined;
    }

    if (value.t === "Link" && repairs.has(value.c[2][0])) {
      const header = repairs.get(value.c[2][0]);
      return {
        ...value,
        c: [
          rewrite(value.c[0]),
          rewrite(header.c[2]),
          [`#${header.c[1][0]}`, value.c[2][1]],
        ],
      };
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, rewrite(child)])
    );
  };

  repairs.forEach((header, target) => {
    debug(
      `Normalized Word section cross-reference ${target}: ` +
      `${JSON.stringify(normalized_inline_text(header.c[2]))}`
    );
  });
  return rewrite(blocks).filter(block =>
    !((block.t === "Para" || block.t === "Plain") && block.c.length === 0)
  );
};

const is_title_case = text => {
  const wordPattern = /[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*(?:[-‐‑‒–—][\p{L}\p{N}]+)*/gu;
  const matches = [...text.matchAll(wordPattern)];
  const words = matches.map(match => match[0]);
  if (!words.length) return true;

  const alphabeticWords = words.filter(word => /\p{L}/u.test(word));
  const allCapsHeading = alphabeticWords.length > 1 && alphabeticWords.every(word => {
    const letters = word.replace(/[^\p{L}]/gu, "");
    return letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase();
  });
  if (allCapsHeading && !alphabeticWords.every(word => TITLE_CASE_ACRONYMS.has(word))) return false;

  return words.every((word, wordIndex) => word.split(/[-‐‑‒–—]/u).every((part, partIndex) => {
    if (!/\p{L}/u.test(part) || TITLE_CASE_ACRONYMS.has(part)) return true;

    const letters = part.replace(/[^\p{L}]/gu, "");
    const allCaps = letters.length > 3 &&
      letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase();
    if (allCaps) return false;

    const firstLetter = part.match(/\p{L}/u)?.[0] || "";
    const startsLowercase = firstLetter === firstLetter.toLocaleLowerCase() &&
      firstLetter !== firstLetter.toLocaleUpperCase();
    if (!startsLowercase) return true;
    if (/\p{Ll}.*\p{Lu}/u.test(part)) return true;

    const separator = wordIndex === 0 ? "" : text.slice(
      matches[wordIndex - 1].index + matches[wordIndex - 1][0].length,
      matches[wordIndex].index,
    );
    const isFirst = partIndex === 0 && (wordIndex === 0 || /[:.!?]\s*$/.test(separator));
    const isLast = wordIndex === words.length - 1 && partIndex === word.split(/[-‐‑‒–—]/u).length - 1;
    return !isFirst && !isLast && TITLE_CASE_MINOR_WORDS.has(part.toLocaleLowerCase());
  }));
};

const warn_about_title_case = (doc, blocks) => {
  const title = metadata_text(doc.meta.title).replace(/\s+/g, " ").trim();
  if (title && !is_title_case(title)) {
    warn(`paper title is not in title case: "${title}"`);
  }

  blocks.forEach(block => {
    if (block.t !== "Header") return;
    const heading = stringify_inlines(block.c[2]).replace(/\s+/g, " ").trim();
    if (!heading || STRUCTURAL_HEADINGS.has(heading.toLocaleLowerCase())) return;
    if (!is_title_case(heading)) warn(`heading is not in title case: "${heading}"`);
  });
};

const mapTree = (node, fn) => {
  if (node.t === undefined) throw new Error("not a block");
  if (node.t === "Para" || node.t === "Plain") {
    return fn({ ...node, c: node.c.map(b => mapTree(b, fn)) });
  } else if (node.t === "Figure") {
    const figure = { ...node };
    figure.c[1] = figure.c[1].map(list => list ? list.map(b => mapTree(b, fn)) : list);
    figure.c[2] = figure.c[2].map(b => mapTree(b, fn));
    return fn(figure);
  } else if (["Strong", "Emph"].includes(node.t)) {
    const block = { ...node };
    block.c = block.c.map(b => mapTree(b, fn));
    return fn(block);
  } else if (["Div", "Image", "Span", "Caption"].includes(node.t)) {
    const div = { ...node };
    div.c[1] = div.c[1].map(b => mapTree(b, fn));
    return fn(div);
  } else return fn({ ...node });
};

const get_custom_style = (block) => {
  if (block.t !== "Div") return null;
  const elem = block.c[0][2][0];
  if (!elem) return null;
  return elem[0] === "custom-style" ? elem[1] : null;
};

const get_children = (block) => block.c[1];
const get_first_child = (block) => get_children(block)[0];

const get_images = (node, images = []) => {
  if (Array.isArray(node)) {
    node.forEach(child => get_images(child, images));
    return images;
  }
  if (!node || typeof node !== "object") return images;
  if (node.t === "Image") images.push(node);
  Object.values(node).forEach(child => get_images(child, images));
  return images;
};

const find_figure_override = (figure_number, image_path) => {
  const override_dir = process.env.FCKTAPS_FIGURE_OVERRIDES;
  if (!override_dir) return null;

  let entries;
  try {
    entries = fs.readdirSync(override_dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  const matches = entries.flatMap(entry => {
    if (!entry.isFile() || entry.name === "README.md" || entry.name.startsWith(".")) return [];
    const match = entry.name.match(FIGURE_OVERRIDE_PATTERN);
    if (!match || Number(match[1]) !== figure_number) return [];
    const flags = match[2].split("-").filter(Boolean);
    if (flags.length !== new Set(flags).size) return [];
    return [{ flags: new Set(flags), extension: match[3] }];
  });
  if (matches.length !== 1) return null;

  const extension = matches[0].extension;
  if (extension.toLowerCase() === ".pdf") return matches[0];

  // Non-PDF overrides are accepted only when their extension matches an
  // extracted asset, as enforced later by apply_figure_overrides.py.
  const parsed_image_path = path.parse(image_path);
  const target = path.join(parsed_image_path.dir, `${parsed_image_path.name}${extension}`);
  try {
    return fs.statSync(target).isFile() ? matches[0] : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

const get_anchor_ref = (block) => {
  if (block.t === "Span" && block.c[0][1][0] === "anchor") return block.c[0][0];
  return undefined;
};

const remove_matching_empty_anchor = (value, reference_id) => {
  if (Array.isArray(value)) {
    return value
      .map(child => remove_matching_empty_anchor(child, reference_id))
      .filter(child => child !== undefined);
  }
  if (!value || typeof value !== "object") return value;
  if (
    value.t === "Span" &&
    value.c[0][0] === reference_id &&
    value.c[0][1].includes("anchor") &&
    value.c[1].length === 0
  ) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      remove_matching_empty_anchor(child, reference_id),
    ])
  );
};

const assign_figure_reference_ids = (blocks) => {
  const targets_by_figure = new Map();
  visit_ast(blocks, node => {
    if (node.t !== "Link") return;
    const target = node.c[2][0];
    const match = normalized_inline_text(node.c[1]).match(/^Figure\s+([1-9]\d*)$/i);
    if (!match || !target.startsWith("#")) return;

    const figure_number = Number(match[1]);
    const targets = targets_by_figure.get(figure_number) || new Set();
    targets.add(target.slice(1));
    targets_by_figure.set(figure_number, targets);
  });

  let figure_number = 0;
  return blocks.map(block => {
    if (block.t !== "Figure") return block;

    figure_number += 1;
    const targets = [...(targets_by_figure.get(figure_number) || [])];
    if (targets.length > 1) {
      warn(
        `Figure ${figure_number} has conflicting Word bookmark targets: ` +
        targets.join(", ")
      );
    }

    const existing_id = block.c[0][0];
    const reference_id = targets[0];
    if (existing_id && reference_id && existing_id !== reference_id) {
      warn(
        `Figure ${figure_number} uses label "${existing_id}", but Word references ` +
        `"${reference_id}"`
      );
    }
    const final_id = existing_id || reference_id;
    if (!final_id) return block;

    return {
      ...block,
      c: [
        [final_id, block.c[0][1], block.c[0][2]],
        remove_matching_empty_anchor(block.c[1], final_id),
        block.c[2],
      ],
    };
  });
};

// Pandoc constructors
const Para = (blocks) => ({ t: "Para", c: blocks });
const Span = (blocks) => ({ t: "Span", c: [["", [], []], [...blocks]] });
const Str = (text) => ({ t: "Str", c: text });
const Space = () => ({ t: "Space" });
const NonBreakingSpace = () => Str(" ");
const RawLatex = (text) => ({ t: "RawInline", c: ["latex", text] });
const Code = (text) => ({ t: "Code", c: [["", [], []], text] });

const Image = (path, ref_id = "", caption_inlines = []) => ({
  t: "Image",
  c: [[ref_id, [], [["width", "100%"]]], [...caption_inlines], [path, ""]]
});

const Figure = (caption, images, ref_id) => ({
  t: "Figure",
  c: [[ref_id, [], []], [[], [caption]], [Para(images)]]
});

const normalize_figures = (blocks) => {
  let figureNumber = 0;
  return blocks.map(block => {
    if (block.t !== "Figure") return block;

    figureNumber += 1;
    const images = get_images(block);
    if (images.length === 0) {
      warn(`Figure ${figureNumber} contains no image.`);
      return block;
    }
    const override = find_figure_override(figureNumber, images[0].c[2][0]);
    if (images.length > 1 && !override) {
      warn(
        `Figure ${figureNumber} contains ${images.length} images; ` +
        `using only the first image (${images[0].c[2][0]}) for LaTeX.`
      );
    }

    const attributes = block.c[0];
    const keyValues = attributes[2].filter(([key]) => key !== FIGURE_PLACEMENT_ATTRIBUTE);
    if (override?.flags.has("h")) keyValues.push([FIGURE_PLACEMENT_ATTRIBUTE, "H"]);

    return {
      ...block,
      c: [[attributes[0], attributes[1], keyValues], block.c[1], [Para([images[0]])]],
    };
  });
};

const Cite = (ref_id) => ({
  t: "Cite",
  c: [[{
    citationId: ref_id,
    citationMode: { t: "NormalCitation" },
    citationPrefix: [], citationSuffix: [],
    citationNoteNum: 0, citationHash: 1234
  }], [Str("["), Str(ref_id), Str("]")]]
});

const FigureLink = (ref_id) => ({
  t: "Link",
  c: [["", [], []], [Str(ref_id)], [ref_id, ""]]
});

const MetaInlines = (inlines) => ({ t: "MetaInlines", c: [...inlines] });
const MetaList = (items) => ({ t: "MetaList", c: items.map(s => ({ t: "MetaString", c: s })) });

const convert_div_to_para = (block) => {
  if (block.t === "Div" && block.c[1].length === 1 && block.c[1][0].t === "Para")
    return block.c[1][0];
  return block;
};

const inline_code_text = (inlines) => inlines.map(inline => {
  if (inline.t === "Str") return inline.c;
  if (["Space", "SoftBreak", "LineBreak"].includes(inline.t)) return " ";
  if (inline.t === "Code" || inline.t === "Math" || inline.t === "RawInline") return inline.c[1];
  if (inline.t === "Span" || inline.t === "Link") return inline_code_text(inline.c[1]);
  if (inline.t === "Quoted") return inline_code_text(inline.c[1]);
  if ([
    "Emph", "Strong", "Strikeout", "Superscript", "Subscript", "SmallCaps", "Underline",
  ].includes(inline.t)) return inline_code_text(inline.c);
  return "";
}).join("");

const is_courier_new_inline_code_span = (node) => {
  if (node.t !== "Span") return false;
  const customStyle = node.c[0][2]
    .find(attribute => attribute[0] === "custom-style")?.[1]
    ?.trim().toLocaleLowerCase();
  return COURIER_NEW_INLINE_CODE_STYLES.has(customStyle);
};

const convert_courier_new_to_inline_code = (value) => {
  if (Array.isArray(value)) return value.map(convert_courier_new_to_inline_code);
  if (!value || typeof value !== "object") return value;

  const converted = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, convert_courier_new_to_inline_code(child)])
  );
  if (!is_courier_new_inline_code_span(converted)) return converted;

  const text = inline_code_text(converted.c[1]);
  debug(`Courier New → ACM SIGCHI inline code: ${JSON.stringify(text)}`);
  return Code(text);
};

// ── Format detection ──────────────────────────────────────────────────────────
// CHI templates use named custom-style divs for abstract/acks/title.
// UIST templates use an "Author Keywords" header and custom-style="caption" divs.

const detect_format = (blocks) => {
  if (blocks.some(b => get_custom_style(b) === "Abstract" || get_custom_style(b) === "AckHead"))
    return "chi";
  if (blocks.some(b => b.t === "Header" && stringify_inlines(b.c[2]).trim() === "Author Keywords"))
    return "uist";
  return "chi";
};

// ── CHI extraction ────────────────────────────────────────────────────────────

const extract_chi = (doc, blocks) => {
  // Title
  const title_inlines = get_first_child(blocks.find(b => get_custom_style(b) === "Title_document")).c;
  doc.meta.title = MetaInlines(title_inlines);
  blocks = blocks.filter(b => get_custom_style(b) !== "Title_document");

  // Abstract
  const abstract_inlines = get_first_child(blocks.find(b => get_custom_style(b) === "Abstract")).c;
  doc.meta.abstract = MetaInlines(abstract_inlines);
  blocks = blocks.filter(b => get_custom_style(b) !== "Abstract");

  // Acknowledgements
  const ack_idx = blocks.findIndex(b => get_custom_style(b) === "AckHead");
  doc.meta.acknoledgements = MetaInlines(blocks[ack_idx + 1].c);
  blocks = blocks.filter((_, i) => i !== ack_idx && i !== ack_idx + 1);

  // Keywords
  const kw_block = blocks.find(b =>
    b.t === "Para" && stringify_inlines(b.c).startsWith("Additional Keywords and Phrases: ")
  );
  doc.meta.keywords = MetaList(
    stringify_inlines(kw_block.c)
      .replace("Additional Keywords and Phrases: ", "")
      .replace(/\.$/, "")
      .split(", ")
  );
  blocks = blocks.filter(b => b !== kw_block);

  // Figures: custom-style="Image" div followed by a Para matching "Figure N: ..."
  let skip = false;
  blocks = blocks.map((block, i, arr) => {
    if (get_custom_style(block) === "Image") {
      const image_blocks = get_images(block);
      if (image_blocks.length === 0) return block;

      const next_block = arr[i + 1];
      const next_text = next_block ? stringify_inlines(get_first_child(next_block).c) : "";
      if (/^Figure \d+: /.test(next_text)) {
        skip = true;
        const caption_para = get_first_child(next_block);
        const caption = Para([...caption_para.c.slice(4)]); // strip "Figure N: "
        const images = image_blocks.map(image_block =>
          Image(image_block.c[2][0], "", image_block.c[1])
        );
        const ref_id = caption_para.c.map(get_anchor_ref).find(r => r !== undefined);
        return Figure(caption, images, ref_id);
      }
      return block;
    } else if (skip) {
      skip = false;
      return undefined;
    }
    return block;
  }).filter(Boolean);

  // Boilerplate
  blocks = blocks.filter(b => {
    if (b.t !== "Para" && b.t !== "Header") return true;
    const text = b.t === "Para" ? stringify_inlines(b.c) : stringify_inlines(b.c[2]);
    return !(
      text.startsWith("First Author's Name, Initials,") ||
      text.startsWith("First author's affiliation") ||
      text.startsWith("ACM Reference Format") ||
      is_references_heading(text) ||
      text.startsWith("CCS CONCEPTS")
    );
  });

  return blocks;
};

// ── UIST extraction ───────────────────────────────────────────────────────────

const extract_uist = (doc, blocks) => {
  // Remove author/affiliation table at top
  blocks = blocks.filter(b => b.t !== "Table");

  // Title is already in doc.meta.title from docx metadata

  // Abstract: last Para before the "Author Keywords" header
  const kw_header_idx = blocks.findIndex(
    b => b.t === "Header" && stringify_inlines(b.c[2]).trim() === "Author Keywords"
  );
  let abstract_block = null;
  for (let i = kw_header_idx - 1; i >= 0; i--) {
    if (blocks[i].t === "Para") { abstract_block = blocks[i]; break; }
  }
  if (!abstract_block) throw new Error("Could not find abstract paragraph");
  doc.meta.abstract = MetaInlines(abstract_block.c);

  // Keywords: Para immediately after "Author Keywords" header
  const kw_block = blocks[kw_header_idx + 1];
  doc.meta.keywords = MetaList(
    kw_block && kw_block.t === "Para"
      ? stringify_inlines(kw_block.c).replace(/\.$/, "").split(", ")
      : []
  );

  // These front-matter fields are emitted by patch_latex_things.js. Remove
  // their Word labels and source blocks so they do not reappear after
  // \maketitle as ordinary body content.
  const ccs_header_idx = blocks.findIndex(b =>
    b.t === "Header" && normalized_inline_text(b.c[2]).toLocaleLowerCase() === "ccs concepts"
  );
  const ccs_end_idx = ccs_header_idx === -1
    ? -1
    : blocks.findIndex((b, i) => i > ccs_header_idx && b.t === "Header");
  blocks = blocks.filter((b, i) => {
    if (b === abstract_block || b === kw_block) return false;
    if ((b.t === "Para" || b.t === "Header") &&
        normalized_inline_text(b.t === "Header" ? b.c[2] : b.c).toLocaleLowerCase() === "abstract")
      return false;
    if (i === kw_header_idx) return false;
    if (ccs_header_idx !== -1 && i >= ccs_header_idx &&
        (ccs_end_idx === -1 || i < ccs_end_idx)) return false;
    return true;
  });

  // Acknowledgements: Para after ACKNOWLEDGMENTS header
  const ack_idx = blocks.findIndex(
    b => b.t === "Header" && /acknowledgm/i.test(stringify_inlines(b.c[2]))
  );
  if (ack_idx === -1) throw new Error("Could not find ACKNOWLEDGMENTS header");
  doc.meta.acknoledgements = MetaInlines(blocks[ack_idx + 1].c);
  blocks = blocks.filter((_, i) => i !== ack_idx && i !== ack_idx + 1);

  // Figures: custom-style="image"/"Image" div followed by custom-style="caption" div
  // Caption text starts with ": " which is stripped.
  let skip = false;
  blocks = blocks.map((block, i, arr) => {
    const style = get_custom_style(block);
    if (style && (style === "Image" || style === "image")) {
      const image_blocks = get_images(block);
      if (image_blocks.length === 0) return block;

      const next_block = arr[i + 1];
      if (next_block && get_custom_style(next_block) === "caption") {
        skip = true;
        let inlines = get_first_child(next_block).c;
        // Strip leading ": " prefix
        while (inlines.length > 0 &&
               ((inlines[0].t === "Str" && inlines[0].c === ":") || inlines[0].t === "Space"))
          inlines = inlines.slice(1);
        const caption = Para(inlines);
        const images = image_blocks.map(image_block =>
          Image(image_block.c[2][0], "", image_block.c[1])
        );
        const ref_id = get_first_child(next_block).c
          .map(get_anchor_ref).find(r => r !== undefined) || "";
        return Figure(caption, images, ref_id);
      }
      if (next_block && next_block.t === "Figure") {
        skip = true;
        return {
          ...next_block,
          c: [
            next_block.c[0],
            next_block.c[1],
            [Para([...image_blocks, ...get_images(next_block)])],
          ],
        };
      }
      return block;
    } else if (skip) {
      skip = false;
      return undefined;
    }
    return block;
  }).filter(Boolean);

  // Boilerplate (Para and Header)
  blocks = blocks.filter(b => {
    if (b.t !== "Para" && b.t !== "Header") return true;
    const text = b.t === "Para" ? stringify_inlines(b.c) : stringify_inlines(b.c[2]);
    return !(
      text.startsWith("Submitted to") ||
      text.startsWith("First Author") ||
      text.startsWith("ACM Reference Format") ||
      text.startsWith("CCS CONCEPTS") ||
      text === "Author Keywords" ||
      text === "CSS Concepts" ||
      is_references_heading(text)
    );
  });

  return blocks;
};

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const doc = JSON.parse(await readStdin());
  let blocks = doc.blocks;

  const format = detect_format(blocks);
  process.stderr.write(`fcktaps/index.js: detected format "${format}"\n`);

  blocks = format === "uist"
    ? extract_uist(doc, blocks)
    : extract_chi(doc, blocks);

  blocks = normalize_word_section_cross_references(blocks);

  warn_about_title_case(doc, blocks);

  // Pandoc does not retain Word's figure bookmark anchors consistently, but
  // it does retain the targets on links whose visible text is "Figure N".
  // Reattach those targets to the corresponding top-level figures.
  blocks = assign_figure_reference_ids(blocks);

  // A Word figure may contain several embedded images. TAPS figures must use
  // one final artwork file, so retain only the first image and report it.
  blocks = normalize_figures(blocks);

  // Flatten single-child Divs
  blocks = blocks.map(convert_div_to_para);

  doc.blocks = blocks;
  process.stdout.write(JSON.stringify(convert_courier_new_to_inline_code(doc)));
})();
