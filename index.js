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

const get_custom_style = (block) => {
	if (block.t != "Div") {
		return null;
	}
	const elem = block.c[0][2][0];
	if (elem[0] == "custom-style") {
		return elem[1];
	} else return null;
};

const is_caption = (block) => {
	const para = get_first_child(block);
	const para_content = para.c;

	return /^Figure \d+\: .*/.test(stringify_inlines(para_content));
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

const get_inline_block_children = (block) => block.t === "Para" ? block.c : [];

(async () => {
	readStdin().then(async (stdin_content) => {
		const doc = JSON.parse(stdin_content);
		
		let blocks = doc.blocks;

		// title
		const title_inlines = get_first_child(blocks.find(b => get_custom_style(b) === styles.title)).c;
		doc.meta.title = MetaInlines(title_inlines);
		blocks = blocks.filter(b => get_custom_style(b) !== styles.title);

		// abstract
		const abstract_inlines = get_first_child(blocks.find(b => get_custom_style(b) === styles.abstract)).c;
		doc.meta.abstract = MetaInlines(abstract_inlines);
		blocks = blocks.filter(b => get_custom_style(b) !== styles.abstract);

		// acknoldgements
		const acknoledgement_heading_index = blocks.findIndex(b => get_custom_style(b) === styles.acknoledgement_heading);
		doc.meta.acknoledgements = MetaInlines(blocks[acknoledgement_heading_index + 1].c);
		blocks = blocks.filter((_, i) => i !== acknoledgement_heading_index && i !== acknoledgement_heading_index + 1);

		// Figures and Captions
		let skip = false;
		blocks = blocks.map((block, i, arr) => {
			if (get_custom_style(block) === styles.figure) {
				const image_block = get_first_child(block).c[0];
				
				if (image_block.t !== "Image" || get_children(block).length !== 1) {
					throw new Error("Wrong application of Image Style: Image Style should only be used for images");
				}

				const next_block = arr[i+1];

				if (is_caption(next_block)) {
					skip = true;

					const caption = trim_figure_prefix(get_first_child(next_block));
					// const image = Image(convert_to_pdf_image_path(get_image_path(image_block)) );
					const image = Image(get_image_path(image_block));
					const ref_id = get_first_child(next_block).c.map(get_anchor_ref).find(res => res !== undefined);
					
					return Figure(caption, image, ref_id);
					// TODO verify that figure numbers and refs actually do match up (e.g. user might not have refreshed them in Word..)
					// return Para([Image(get_image_path(image_block), ref_id, caption.c)]);
				}
				return block;
			} else if (skip){
				skip = false;
				return undefined;
			} else {
				return block;
			}
		}).filter(block => block !== undefined);

		// flatten document to remove unnessecary divs
		blocks = blocks.map(convert_div_to_para);

		// keywords
		const keywords_block = blocks.find(b => parse_keywords(b).length > 0);
		blocks = blocks.filter(b => b !== keywords_block);
		doc.meta.keywords = MetaList(parse_keywords(keywords_block));

		// remove boilerplate
		blocks = blocks.filter(b => !is_boilerplate(b));
		
		// TODO Algorithm support

		// TODO math syntax support

		doc.blocks = blocks;
		return doc;
	})
	.then(async (data) => process.stdout.write(JSON.stringify(data)));

})();