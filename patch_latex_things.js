#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const load_frontmatter = () => {
	const directory = process.env.FCKTAPS_FRONTMATTER_DIR;
	if (!directory) {
		throw new Error("FCKTAPS_FRONTMATTER_DIR is not set");
	}

	return Object.fromEntries(["authors", "ccs", "rights"].map(name => [
		name,
		fs.readFileSync(path.join(directory, `${name}.tex`), "utf8").trim(),
	]));
};

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

(async () => {
	readStdin().then(async (stdin_content) => {
		const doc = JSON.parse(stdin_content);
		const frontmatter = load_frontmatter();
		
		let blocks = doc.blocks;

		// special characters
		// TODO find correct code for unicode
		// The following is not matching to the right things
		// const mapping = ({
		// 	">>": "\\>\\>",
		// 	"<<": "\\<\\<",
		// 	"σ": "\\sigma",
		// 	"π": "\\pi",
		// 	"⌀": "\\unichar\{\"20AC\}"
		// });

		// blocks = blocks.map(b => mapTree(b, b => {
		// 	if (b.t === "Str" && Object.keys(mapping).filter(key => b.c.includes(key)).length > 0) {
		// 		let string = b.c;
		// 		Object.entries(mapping).forEach((k, v) => string.replace(k, v));
		// 		return RawLatex(string);
		// 	}
		// 	return b;
		// }));

		const figure_one_index = blocks.findIndex(b => b.t === "Figure");
		const figure_one = blocks[figure_one_index];
		blocks = blocks.filter((_, i) => i !== figure_one_index);

		const get_figure_image = (figure) => {
			if (!figure) return null;
			const block = figure.c[2][0];
			if (block.t === "Para" || block.t === "Plain") {
				return block.c.find(b => b.t === "Image") || null;
			}
			return block.t === "Image" ? block : null;
		};

		const get_alt_text = (figure) => {
			const image = get_figure_image(figure);
			if (!image) return "";
			const alt_inlines = image.c[1] || [];
			// TODO make sure that this is not handled here, but in pandoc, so e.g. \% etc gets exited
			return stringify_inlines(alt_inlines);
		};

		const get_caption_inlines = (figure) => {
			const caption_block = figure.c[1][1][0];
			if (!caption_block) return [];

			let inlines = [];
			if (caption_block.t === "Para" || caption_block.t === "Plain") {
				inlines = caption_block.c;
			} else if (caption_block.t === "Div") {
				const inner = caption_block.c[1][0];
				if (inner && (inner.t === "Para" || inner.t === "Plain")) inlines = inner.c;
			}

			while (inlines.length > 0 &&
				((inlines[0].t === "Str" && inlines[0].c === ":") || inlines[0].t === "Space")) {
				inlines = inlines.slice(1);
			}
			return inlines;
		};

		const render_figure = (figure) => {
			const alt = get_alt_text(figure);
			const image = get_figure_image(figure);
			const force_here = figure.c[0][2].some(([key, value]) =>
				key === "fcktaps-latex-placement" && value === "H"
			);
			const placement = force_here ? "H" : "h";
			const parts = [
				RawLatex(`\\begin{figure}[${placement}]\n\\centering\n\\includegraphics[width=\\columnwidth]{${image.c[2][0]}}`),
				RawLatex(`\\label{${figure.c[0][0]}}`),
			];
			if (alt) parts.push(RawLatex(`\\Description{${alt}}`));
			parts.push(
				RawLatex("\\caption{"),
				...get_caption_inlines(figure),
				RawLatex("}\n\\end{figure}"),
			);
			return Para(parts);
		};

		blocks = blocks.map(b => {
			if (b.t === "Figure") {
				return render_figure(b);
			} else return b;
		});

		const render_figure_one = (figure) => {
			const alt = get_alt_text(figure);
			const image = get_figure_image(figure);
			const parts = [
				RawLatex(`\\begin{teaserfigure}\n\\centering\n\\includegraphics[width=\\textwidth,height=0.25\\textheight,keepaspectratio]{${image.c[2][0]}}`),
				RawLatex(`\\label{${figure.c[0][0]}}`),
			];
			if (alt) parts.push(RawLatex(`\\Description{${alt}}`));
			parts.push(
				RawLatex("\\caption{"),
				...get_caption_inlines(figure),
				RawLatex("}\n\\end{teaserfigure}"),
			);
			return Para(parts);
		};

		const render_title = (title_para) => Para([
			RawLatex("\\title{"),
			...title_para.c,
			RawLatex("}")
		]);

		const render_abstract = (abstract_para) => Para([
			RawLatex("\\begin{abstract}\n"),
			...abstract_para.c,
			RawLatex("\\end{abstract}\n")
		]);

		const render_acknoledgements = (acks_para) => Para([
			RawLatex("\n\\begin{acks}\n"),
			...acks_para.c,
			RawLatex("\n\\end{acks}\n")
		]);

		const render_keywords = (keywords) => RawLatexPara(`\\keywords{${keywords.join(", ")}}`);

		const RawLatexPara = (text) => Para([RawLatex(text)]);

		// Keep queued figures inside the section or subsection where they occur.
		// A barrier before each new boundary closes the preceding one; the final
		// barrier below closes the last subsection in the manuscript.
		blocks = blocks.flatMap(block =>
			block.t === "Header" && block.c[0] <= 2
				? [RawLatexPara("\\FloatBarrier"), block]
				: [block]
		);

		blocks = [
			RawLatexPara(`
\\documentclass[sigconf,screen]{acmart}
\\usepackage{graphicx}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{float}
\\usepackage{placeins}
\\usepackage{algorithm}
\\usepackage{algpseudocode}
\\usepackage{dblfloatfix}
\\usepackage{wasysym}
\\usepackage{url}
\\usepackage{newunicodechar}
\\newunicodechar{₂}{\\ensuremath{_2}}
\\newunicodechar{μ}{\\ensuremath{\\mu}}
\\newunicodechar{′}{\\ensuremath{^\\prime}}
\\newunicodechar{−}{--}
\\newunicodechar{×}{\\texttimes}
\\newunicodechar{°}{\\textdegree}
\\begin{document}
\\hypersetup{allcolors=black}
			`),
			render_title(doc.meta.title),
			render_abstract(doc.meta.abstract),
			RawLatexPara(frontmatter.ccs),
			RawLatexPara(frontmatter.rights),
			render_keywords(doc.meta.keywords.c.map(item => item.c)),
			...(figure_one ? [render_figure_one(figure_one)] : []),
			RawLatexPara(frontmatter.authors),
			RawLatexPara(`
\\maketitle`),
			...blocks,
			RawLatexPara("\\FloatBarrier"),
			render_acknoledgements(doc.meta.acknoledgements),
			RawLatexPara(`
\\bibliographystyle{ACM-Reference-Format}
\\bibliography{zotero}
\\end{document}`)
		];

		doc.blocks = blocks;
		return doc;
	})
	.then(async (data) => process.stdout.write(JSON.stringify(data)));

})();
