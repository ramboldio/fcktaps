#!/usr/bin/env node

const readStdin = () => new Promise((resolve) => {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => data += chunk);
  process.stdin.on("end", () => resolve(data));
});

const stringify_inlines = (inline_blocks) => inline_blocks.map(b => {
  if (b.t === "Str") return b.c;
  if (b.t === "Space") return " ";
  if (b.t === "Emph" || b.t === "Strong") return stringify_inlines(b.c);
  if (b.t === "Span") return stringify_inlines(b.c[1]);
  return "";
}).join("");

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

const get_anchor_ref = (block) => {
  if (block.t === "Span" && block.c[0][1][0] === "anchor") return block.c[0][0];
  return undefined;
};

// Pandoc constructors
const Para = (blocks) => ({ t: "Para", c: blocks });
const Span = (blocks) => ({ t: "Span", c: [["", [], []], [...blocks]] });
const Str = (text) => ({ t: "Str", c: text });
const Space = () => ({ t: "Space" });
const NonBreakingSpace = () => Str(" ");
const RawLatex = (text) => ({ t: "RawInline", c: ["latex", text] });

const Image = (path, ref_id = "", caption_inlines = []) => ({
  t: "Image",
  c: [[ref_id, [], [["width", "100%"]]], [...caption_inlines], [path, ""]]
});

const Figure = (caption, image, ref_id) => ({
  t: "Figure",
  c: [[ref_id, [], []], [[], [caption]], [Para([image])]]
});

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
      const image_block = get_first_child(block).c[0];
      if (image_block.t !== "Image" || get_children(block).length !== 1)
        throw new Error("Image style should only be applied to a single image");

      const next_block = arr[i + 1];
      const next_text = next_block ? stringify_inlines(get_first_child(next_block).c) : "";
      if (/^Figure \d+: /.test(next_text)) {
        skip = true;
        const caption_para = get_first_child(next_block);
        const caption = Para([...caption_para.c.slice(4)]); // strip "Figure N: "
        const image = Image(image_block.c[2][0], "", image_block.c[1]);
        const ref_id = caption_para.c.map(get_anchor_ref).find(r => r !== undefined);
        return Figure(caption, image, ref_id);
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
    if (b.t !== "Para") return true;
    const text = stringify_inlines(b.c);
    return !(
      text.startsWith("First Author's Name, Initials,") ||
      text.startsWith("First author's affiliation") ||
      text.startsWith("ACM Reference Format") ||
      text.startsWith("References") ||
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
  blocks = blocks.filter(b => b !== abstract_block);

  // Keywords: Para immediately after "Author Keywords" header
  const kw_block = blocks[kw_header_idx + 1];
  doc.meta.keywords = MetaList(
    kw_block && kw_block.t === "Para"
      ? stringify_inlines(kw_block.c).replace(/\.$/, "").split(", ")
      : []
  );

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
      const image_block = get_first_child(block).c[0];
      if (image_block.t !== "Image") return block;

      const next_block = arr[i + 1];
      if (next_block && get_custom_style(next_block) === "caption") {
        skip = true;
        let inlines = get_first_child(next_block).c;
        // Strip leading ": " prefix
        while (inlines.length > 0 &&
               ((inlines[0].t === "Str" && inlines[0].c === ":") || inlines[0].t === "Space"))
          inlines = inlines.slice(1);
        const caption = Para(inlines);
        const image = Image(image_block.c[2][0], "", image_block.c[1]);
        const ref_id = get_first_child(next_block).c
          .map(get_anchor_ref).find(r => r !== undefined) || "";
        return Figure(caption, image, ref_id);
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
      text === "CSS Concepts"
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

  // Flatten single-child Divs
  blocks = blocks.map(convert_div_to_para);

  doc.blocks = blocks;
  process.stdout.write(JSON.stringify(doc));
})();
