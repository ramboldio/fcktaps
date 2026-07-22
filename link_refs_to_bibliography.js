#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

// Read all stdin
const readStdin = () => {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", chunk => data += chunk);
    process.stdin.on("end", () => resolve(data));
  });
}

// Parse reference_keys.csv: one BibTeX key per Word bibliography entry.
function parseReferenceKeys(csvPath) {
  const content = fs.readFileSync(csvPath, "utf8");
  const mapping = {};
  return content.split("\n").filter(str => str.length != 0);
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
	if (node.t === "Para" || node.t === "Plain") {
		return fn({ ...node, c: node.c.map(b => mapTree(b, fn)) });
	} else if (node.t === "Figure") {
			const figure = ({ ...node });
			figure.c[1] = figure.c[1].map(list => list ? list.map(b => mapTree(b, fn)) : list);
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

const get_custom_style = (block) => {
	if (block.t != "Div") {
		return null;
	}
	const elem = block.c[0][2][0];
	if (elem[0] == "custom-style") {
		return elem[1];
	} else return null;
};

const get_children = (block) => block.c[1];
const get_first_child = (block) => get_children(block)[0];

// Pandoc Type Constructors
const Str = (text) => ({t: "Str", c: text});

const styles = {bibliography_entry: "Bib_entry"};

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

const convert_link_to_cite = (inline_block, mapping) => {
	if (inline_block.t === "Link" && /\[\d+\]/.test(inline_block.c[1][0].c)) {
		let ref_id = inline_block.c[2][0].replace("#", "");
		if (ref_id in mapping && mapping[ref_id]) {
			ref_id = mapping[ref_id];
		}
		return Cite(ref_id);
	} else return inline_block;
};

(async () => {
	readStdin().then(async (stdin_content) => {
		// Load reference keys from CSV
		const refKeysPath = path.join(process.cwd(), "reference_keys.csv");
		const refKeys = parseReferenceKeys(refKeysPath);

		const doc = JSON.parse(stdin_content);
		let blocks = doc.blocks;

		// Extract bibliography entries from ordered list.
		// Use a deep recursive search to find all anchor IDs, regardless of nesting.
		const deep_get_anchors = (node) => {
			if (!node || typeof node !== "object") return [];
			if (Array.isArray(node)) return node.flatMap(deep_get_anchors);
			if (node.t === "Span" && node.c[0][1] && node.c[0][1][0] === "anchor") return [node.c[0][0]];
			if (node.c) return deep_get_anchors(node.c);
			return [];
		};

		const olist = blocks.find(b => b.t === "OrderedList");
		const word_entries = olist
			? olist.c[1].map(item => deep_get_anchors(item))
			: [];

		// One bibliography entry can carry multiple Word anchor IDs when Word has
		// merged duplicate references. All of those anchors share one CSV key.
		if (word_entries.length !== refKeys.length) {
			console.error(`length mismatch: ${word_entries.length} bibliography entries in doc vs ${refKeys.length} keys in CSV`);
			process.exit(1);
		}

		const mapping = Object.fromEntries(
			word_entries.flatMap((anchors, i) => anchors.map(anchor => [anchor, refKeys[i]]))
		);

		// Remove bibliography ordered lists
		blocks = blocks.filter(b => b.t !== "OrderedList");

		// Convert citation links
		blocks = blocks.map(b => mapTree(b, b => convert_link_to_cite(b, mapping)));

		doc.blocks = blocks;
		return doc;
	})
	.then(async (data) => process.stdout.write(JSON.stringify(data)));

})();
