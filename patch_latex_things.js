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
		const bib = JSON.parse(fs.readFileSync("zotero.json"));
		const doc = JSON.parse(stdin_content);
		
		let blocks = doc.blocks;

		// special characters
		// TODO find correct code for unicode
		const mapping = ({
			">>": "\\>\\>",
			"<<": "\\<\\<",
			"σ": "\\sigma",
			"π": "\\pi",
			"⌀": "\\unichar\{\"20AC\}"
		});

		blocks = blocks.map(b => mapTree(b, b => {
			if (b.t === "Str" && Object.keys(mapping).filter(key => b.c.includes(key)).length > 0) {
				let string = b.c;
				Object.entries(mapping).forEach((k, v) => string.replace(k, v));
				return RawLatex(string);
			}
			return b;
		}));

		const figure_one_index = blocks.findIndex(b => b.t === "Figure");
		const figure_one = blocks[figure_one_index];
		blocks = blocks.filter((_, i) => i !== figure_one_index);

		const render_figure = (figure) => Para([
			RawLatex(`\\begin{figure}[h]\n\\centering\n\\includegraphics[width=\\columnwidth]{${figure.c[2][0].c[0].c[2][0]}}`),
			RawLatex(`\\label{${figure.c[0][0]}}`),
			RawLatex("\\caption{"),
			...figure.c[1][1][0].c,
			RawLatex("}\n\\end{figure}"),
		]);

		blocks = blocks.map(b => {
			if (b.t === "Figure") {
				return render_figure(b);
			} else return b;
		});

		const render_figure_one = (figure) => Para([
			RawLatex(`\\begin{teaserfigure}\n\\centering\n\\includegraphics[width=\\columnwidth]{${figure.c[2][0].c[0].c[2][0]}}`),
			RawLatex(`\\label{${figure.c[0][0]}}`),
			RawLatex("\\caption{"),
			...figure.c[1][1][0].c,
			RawLatex("}\n\\end{teaserfigure}"),
		]);

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

		const render_author = (author) => RawLatexPara(`
			 \\author{${author}}
				\\affiliation{
					\\institution{Hasso-Plattner-Institute}
					\\city{Potsdam}
					\\country{Germany}
				}`
		);

		const render_author_short_handle = (author_short_handle) => RawLatexPara(`\\renewcommand{\\shortauthors}{${author_short_handle}}`);

		const render_ccs = () => RawLatexPara(`
			\\begin{CCSXML}
			<ccs2012>
			<concept>
			<concept_id>10003120.10003121.10003129</concept_id>
			<concept_desc>Human-centered computing~Interactive systems and tools</concept_desc>
			<concept_significance>500</concept_significance>
			</concept>
			</ccs2012>
			\\end{CCSXML}
			\\ccsdesc[500]{Human-centered computing~Interactive systems and tools}
		`);

		// TODO move these to document metadata
		const authors = ["Lukas Rambold", "Robert Kovacs", "Min Deng", "Antonius Naumann", "Konrad Gerlach", "Horatio Hamkins", "Helena Lendowski", "Chiao Fang", "Shohei Katakura", "Conrad Lempert", "Muhammad Abdullah", "Patrick Baudisch"];
		const author_short_handle = "Rambold et al."

		blocks = [
			RawLatexPara(`
\\documentclass[sigconf,screen]{acmart}
\\usepackage{graphicx}
\\usepackage[utf8x]{inputenc}
\\usepackage{float}      % for h option if needed
			`),
			render_title(doc.meta.title),
			render_abstract(doc.meta.abstract),
			render_ccs(),
			// TODO parse proper keywords from document put them into meta block
			render_keywords(doc.meta.keywords.c.map(item => item.c)),
			render_figure_one(figure_one),
			...authors.map(render_author),
			render_author_short_handle(author_short_handle),
			RawLatexPara(`
\\begin{document}
\\maketitle`),
			...blocks,
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