#!/usr/bin/env node

const fs = require("fs");

// Read all stdin
const readStdin = () => {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", chunk => data += chunk);
    process.stdin.on("end", () => resolve(data));
  });
}

// Helper: normalize text for matching
function normalize(str) {
  return str
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[.,;:()\[\]"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// TODO make all citations match
function matchEntryToBib(bib, entry) {
  const text = normalize(stringify_inlines(entry.c));

  for (const item of bib) {
    const title = normalize(item.title || "");
    const authors = (item.author || []).map(a => normalize(a.family || ""));
    const year = item.issued?.["date-parts"]?.[0]?.[0] || "";

    // Match first author OR any author if multiple words
    const authorMatch = authors.some(a => text.includes(a));

    // Match year with word boundary
    const yearMatch = year ? new RegExp(`\\b${year}\\b`).test(text) : true;

    // Title match optional
    const titleMatch = title.length > 0 ? text.includes(title) : true;

    if (authorMatch && yearMatch && titleMatch) {
      return item.id || item.key;
    }
  }
  return null;
}

const stringify_inlines = (inline_blocks) => inline_blocks.map(b => {
	if (b.t === "Str"){
		return b.c;
	} else if (b.t === "Space") {
		return " ";
	} else if (b.t === "Emph" || b.t === "Strong") {
		return stringify_inlines(b.c);
	} else if (b.t === "Span") {
		return stringify_inlines(b.c[1]);
	} else return "";
}).join("");

const mapTree = (node, fn) => {
	if (node.t === undefined) throw new Error("not a block");
	if (node.t === "Para") {
		return fn({ ...node, c: node.c.map(b => mapTree(b, fn)) });
	} else if (node.t === "Figure") {
			const figure = ({ ...node });
			figure.c[1] = figure.c[1].map(list => list.map(b => mapTree(b, fn)));
			figure.c[2] = figure.c[2].map(b => mapTree(b, fn));
			return fn(figure);
	} else if (["Strong", "Emph"].includes(node.t)) {
		const block = ({ ...node });
		block.c = block.c.map(b => mapTree(b, fn));
		return fn(block);
	} else if (["Div", "Image", "Span", "Caption"].includes(node.t)) {
		const div = ({ ...node });
		div.c[1] = div.c[1].map(b => mapTree(b, fn));
		return fn(div);
	} else return fn({ ...node });
};

const get_anchor_ref = (block) => {
	if (block.t === "Span" && block.c[0][1][0] === "anchor") {
		return block.c[0][0];
	} else return undefined;
};

const trim_figure_prefix = (para) => {
	// TODO make this work for real by using a regex
	return Para([...para.c.slice(4)]);
};

const get_children = (block) => block.c[1];
const get_first_child = (block) => get_children(block)[0];

const get_image_path = (image) => image.c[2][0];

// Pandoc Type Constructors
const Image = (path, ref_id = "", caption_inlines = []) => ({
	t: "Image",
	c: [
		[ref_id, [], [["width", "100%"]]],
		[...caption_inlines],
		[path, ""]
	]
});
const Para = (blocks) => ({t : "Para", c: blocks});
const Span = (blocks) => ({t : "Span", c: [["", [], []], [...blocks]]});
const Str = (text) => ({t: "Str", c: text});
const Space = () => ({t: "Space"});
const NonBreakingSpace = () => Str(" ");
const RawLatex = (text) => ({t: "RawInline", c: ["latex", text]});

const Figure = (caption, image, ref_id) => ({
	t: "Figure",
	c: [
		[ref_id, [], []],
		[[], [caption]],
		[Para([image])]
	]});

const Cite = (ref_id) => ({
	t: "Cite",
	c: [
		[
			{
				citationId: ref_id,
				citationMode: { t: "NormalCitation" },
      	citationPrefix: [],
      	citationSuffix: [],
      	citationNoteNum: 0,
      	citationHash: 1234
			}
		],
		[ Str("["), Str(ref_id), Str("]") ]
	]
});

const FigureLink = (ref_id) => ({
	t: "Link",
	c: [
		["", [], []],
		[Str(ref_id)],
		[ref_id, ""]
	]
});

const MetaInlines = (inline_blocks) => ({
	t: "MetaInlines",
	c: [...inline_blocks]
});

const MetaList = (items) => ({
	t: "MetaList",
	c: items.map(string => ({t: "MetaString", c: string}))
});

const styles = {title: "Title_document", figure: "Image", bibliography_entry: "Bib_entry", abstract: "Abstract", acknoledgement_heading: "AckHead"};

const is_boilerplate = (block) => {
	if (block.t !== "Para") return false;
	const text = stringify_inlines(block.c);
	return text.startsWith("First Author's Name, Initials,") || 
		text.startsWith("First author's affiliation") ||
		text.startsWith("ACM Reference Format") ||
		text.startsWith("References") ||
		text.startsWith("CCS CONCEPTS")
};

const parse_keywords = (block) => {
	if (block.t === "Para" && stringify_inlines(block.c).startsWith("Additional Keywords and Phrases: ")) {
		return stringify_inlines(block.c).replace("Additional Keywords and Phrases: ", "").replace(".", "").split(", ");
	} else return [];
}

const convert_link_to_cite = (inline_block, mapping) => {
	if (inline_block.t === "Link" && /\[\d+\]/.test(inline_block.c[1][0].c)) {
		let ref_id = inline_block.c[2][0].replace("#", "");
		if (ref_id in mapping && mapping[ref_id]) {
			ref_id = mapping[ref_id];
		}
		return Cite(ref_id);
	} else return inline_block;
};

const convert_figure_links = (inline_block) => {
	if (inline_block.t === "Link") {
		const text = stringify_inlines(inline_block.c[1])	;
		const figure_number_match = text.match(/Figure (\d+)/);
		
		if (figure_number_match === undefined) return inline_block;

		const ref_id = inline_block.c[2][0];
		return Span([Str("Figure"), NonBreakingSpace(), FigureLink(ref_id)]);
	} else return inline_block;
}

const convert_div_to_para = (block) => {
	if (block.t == "Div" && block.c[1].length === 1 && block.c[1][0].t == "Para")
		return block.c[1][0];
	else return block;
};

const convert_to_pdf_image_path = (image_path) => {
	// TODO fix figure mapping
	const image_id = Number(image_path.match(/media\/image(\d+)\.png/)[1]);
	return `./figures/figure_artboard_${image_id}.pdf`;
} 
const get_inline_block_children = (block) => block.t === "Para" ? block.c : [];


(async () => {
	readStdin().then(async (stdin_content) => {
		const bib = JSON.parse(fs.readFileSync("zotero.json"));
		const doc = JSON.parse(stdin_content);
		
		let blocks = doc.blocks;

		// Bibliography
		const bib_entries = blocks
			.filter(b => b.t === "OrderedList")
			.map(b => b.c[1])
			.filter(b => get_custom_style(b) !== styles.bibliography_entry)
			.flat(2)
			.map(get_first_child);
		const word_keys = bib_entries.map(b => get_anchor_ref(b.c[0]));
		const zotero_keys = bib_entries.map(b => matchEntryToBib(bib, b));
		const mapping = Object.fromEntries(word_keys.map((k, i) => [k, zotero_keys[i]]));
		// FIXME check for styles before removing list
		blocks = blocks.filter(b => b.t !== "OrderedList");

		// citations
		blocks = blocks.map(b => mapTree(b, b => convert_link_to_cite(b, mapping)));


		doc.blocks = blocks;
		return doc;
	})
	.then(async (data) => process.stdout.write(JSON.stringify(data)));

})();