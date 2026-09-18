#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { bibliography_anchors } = require("./bibliography_anchors");

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
  // Trim so CRLF line endings do not leak a carriage return into the key,
  // which would make bibtex skip the citation.
  return content.split("\n").map(str => str.trim()).filter(str => str.length != 0);
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

const is_cite = (inline) => inline && inline.t === "Cite";
const is_collapsible_citation_space = (inline) =>
	inline && ["Space", "SoftBreak"].includes(inline.t);

const citation_display = (citations) => {
	const inlines = [Str("[")];
	citations.forEach((citation, index) => {
		if (index > 0) inlines.push(Str(","), Space());
		inlines.push(Str(citation.citationId));
	});
	inlines.push(Str("]"));
	return inlines;
};

const merge_cites = (left, right) => {
	const citations = [...left.c[0], ...right.c[0]];
	return {
		t: "Cite",
		c: [citations, citation_display(citations)]
	};
};

// Word exports a multi-reference citation as neighboring citation links. Once
// those links have become Cite nodes, combine the whole run into one Pandoc
// citation. Pandoc's natbib writer then emits one \citep{key1, key2, ...}.
// Also replace the ordinary space immediately before each citation group with
// LaTeX's non-breaking space so the rendered reference stays with its text.
const normalize_citation_inlines = (inlines) => {
	const normalized = [];

	inlines.forEach((inline, index) => {
		const previous = normalized[normalized.length - 1];
		const next = inlines[index + 1];

		if (
			is_collapsible_citation_space(inline) &&
			is_cite(previous) &&
			is_cite(next)
		) {
			return;
		}

		if (is_cite(inline) && is_cite(previous)) {
			normalized[normalized.length - 1] = merge_cites(previous, inline);
			return;
		}

		if (is_collapsible_citation_space(inline) && is_cite(next)) {
			normalized.push(RawLatex("~"));
			return;
		}

		normalized.push(inline);
	});

	return normalized;
};

const mapTree = (node, fn) => {
	if (node.t === undefined) throw new Error("not a block");
	if (node.t === "Para" || node.t === "Plain") {
		return fn({
			...node,
			c: normalize_citation_inlines(node.c.map(b => mapTree(b, fn)))
		});
	} else if (node.t === "Figure") {
			const figure = ({ ...node });
			figure.c[1] = figure.c[1].map(list => list ? list.map(b => mapTree(b, fn)) : list);
			figure.c[2] = figure.c[2].map(b => mapTree(b, fn));
			return fn(figure);
	} else if (["Strong", "Emph"].includes(node.t)) {
		const block = ({ ...node });
		block.c = normalize_citation_inlines(block.c.map(b => mapTree(b, fn)));
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
const Space = () => ({t: "Space"});
const RawLatex = (text) => ({t: "RawInline", c: ["latex", text]});

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

		// Extract the Word anchors of every bibliography entry from the ordered
		// list, including the boundary bookmarks Pandoc reports one entry early.
		const olist = blocks.find(b => b.t === "OrderedList");
		const word_entries = olist ? bibliography_anchors(olist.c[1]) : [];

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
