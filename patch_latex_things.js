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

// CHI and UIST cite numerically; SIGGRAPH cites author-year. Both use
// ACM-Reference-Format.bst, which follows whichever \citestyle acmart is given.
const CITE_STYLES = new Set(["acmnumeric", "acmauthoryear"]);

const cite_style = () => {
	const style = (process.env.FCKTAPS_CITE_STYLE || "acmnumeric").trim();
	if (!CITE_STYLES.has(style)) {
		throw new Error(
			`FCKTAPS_CITE_STYLE must be one of ${[...CITE_STYLES].join(", ")}, got "${style}"`
		);
	}
	return style;
};

// Figure 1 either rides along with the ACM frontmatter as a full-width float
// ("float"), or fills acmart's teaser slot directly below the author block on
// the first page ("teaser").
const FIGURE_ONE_PLACEMENTS = new Set(["float", "teaser"]);

const figure_one_placement = () => {
	const placement = (process.env.FCKTAPS_FIGURE_ONE_PLACEMENT || "float").trim();
	if (!FIGURE_ONE_PLACEMENTS.has(placement)) {
		throw new Error(
			"FCKTAPS_FIGURE_ONE_PLACEMENT must be one of "
			+ `${[...FIGURE_ONE_PLACEMENTS].join(", ")}, got "${placement}"`
		);
	}
	return placement;
};

// acmart prints the full title in the frontmatter and a short title in the
// running head of every page after the first. Left empty, acmart truncates the
// full title itself and warns while doing so.
const short_title = () => (process.env.FCKTAPS_SHORT_TITLE || "").trim();

// Publication figure numbers that span both columns instead of one. Figure 1 is
// always full width, so it needs no entry.
const wide_figures = () => new Set(
	(process.env.FCKTAPS_WIDE_FIGURES || "")
		.split(/[\s,]+/)
		.filter(Boolean)
		.map(value => {
			const figure_number = Number(value);
			if (!Number.isInteger(figure_number) || figure_number < 1) {
				throw new Error(
					`FCKTAPS_WIDE_FIGURES must list figure numbers, got "${value}"`
				);
			}
			return figure_number;
		})
);

const load_alt_text = () => {
	const filename = process.env.FCKTAPS_ALT_TEXT_FILE;
	if (!filename || !fs.existsSync(filename)) return new Map();

	const descriptions = new Map();
	let currentFigure = null;
	for (const [index, sourceLine] of fs.readFileSync(filename, "utf8").split(/\r?\n/).entries()) {
		const line = sourceLine.trim();
		if (!line || line.startsWith("#")) continue;

		const entry = line.match(/^Figure\s+([1-9]\d*):\s*(.*)$/i);
		if (entry) {
			const figureNumber = Number(entry[1]);
			if (descriptions.has(figureNumber)) {
				throw new Error(`${filename}:${index + 1}: duplicate Figure ${figureNumber} entry`);
			}
			descriptions.set(figureNumber, entry[2]);
			currentFigure = figureNumber;
			continue;
		}

		if (currentFigure === null) {
			throw new Error(
				`${filename}:${index + 1}: expected "Figure N: description"`
			);
		}
		const previous = descriptions.get(currentFigure);
		descriptions.set(currentFigure, previous ? `${previous} ${line}` : line);
	}
	return descriptions;
};

const LATEX_TEXT_ESCAPES = {
	"\\": "\\textbackslash{}",
	"{": "\\{",
	"}": "\\}",
	"$": "\\$",
	"&": "\\&",
	"#": "\\#",
	"%": "\\%",
	"_": "\\_",
	"~": "\\textasciitilde{}",
	"^": "\\textasciicircum{}",
};
const escape_latex_text = text =>
	text.replace(/[\\{}$&#%_~^]/g, character => LATEX_TEXT_ESCAPES[character]);

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

const allow_breaks_after_equals_in_inline_code = value => {
	if (Array.isArray(value)) return value.map(allow_breaks_after_equals_in_inline_code);
	if (!value || typeof value !== "object") return value;

	if (value.t === "Code" && value.c[1].includes("=")) {
		const latex = value.c[1]
			.split("=")
			.map(escape_latex_text)
			.join("=\\allowbreak{}");
		return RawLatex(`\\texttt{${latex}}`);
	}

	return Object.fromEntries(
		Object.entries(value).map(([key, child]) => [
			key,
			allow_breaks_after_equals_in_inline_code(child),
		])
	);
};

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
		const altText = load_alt_text();
		const figureOnePlacement = figure_one_placement();
		const wideFigures = wide_figures();
		const shortTitle = short_title();
		
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

		const get_alt_text = (figure, figureNumber) => {
			const fileDescription = altText.get(figureNumber)?.trim();
			if (fileDescription) return fileDescription;
			const image = get_figure_image(figure);
			if (!image) return "";
			const alt_inlines = image.c[1] || [];
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

		const render_figure = (figure, figureNumber) => {
			const alt = get_alt_text(figure, figureNumber);
			const image = get_figure_image(figure);
			const force_here = figure.c[0][2].some(([key, value]) =>
				key === "fcktaps-latex-placement" && value === "H"
			);
			// A two-column float can only be set at the top of a page, so a wide
			// figure ignores the override's [H] placement.
			const wide = wideFigures.has(figureNumber);
			const environment = wide ? "figure*" : "figure";
			const placement = wide ? "t" : force_here ? "H" : "h";
			const width = wide ? "\\textwidth" : "\\columnwidth";
			const label = figure.c[0][0] ? `\\label{${figure.c[0][0]}}` : "";
			const parts = [
				RawLatex(`\\begin{${environment}}[${placement}]\n\\centering\n\\includegraphics[width=${width}]{${image.c[2][0]}}`),
			];
			if (alt) parts.push(RawLatex(`\\Description{${escape_latex_text(alt)}}`));
			parts.push(
				RawLatex("\\caption{"),
				...get_caption_inlines(figure),
				RawLatex(`}${label}\n\\end{${environment}}`),
			);
			return Para(parts);
		};

		let figureNumber = figure_one ? 1 : 0;
		blocks = blocks.map(b => {
			if (b.t === "Figure") {
				figureNumber += 1;
				return render_figure(b, figureNumber);
			} else return b;
		});

		const render_figure_one = (figure) => {
			const alt = get_alt_text(figure, 1);
			const image = get_figure_image(figure);
			const label = figure.c[0][0] ? `\\label{${figure.c[0][0]}}` : "";
			const teaser = figureOnePlacement === "teaser";
			const environment = teaser ? "teaserfigure" : "figure*";
			const open = teaser ? `\\begin{${environment}}` : `\\begin{${environment}}[t]`;
			const parts = [
				RawLatex(`${open}\n\\centering\n\\includegraphics[width=\\textwidth]{${image.c[2][0]}}`),
			];
			if (alt) parts.push(RawLatex(`\\Description{${escape_latex_text(alt)}}`));
			parts.push(
				RawLatex("\\caption{"),
				...get_caption_inlines(figure),
				RawLatex(`}${label}\n\\end{${environment}}`),
			);
			return Para(parts);
		};

		const render_title = (title_para) => Para([
			RawLatex(
				"\\title"
				+ (shortTitle ? `[{${escape_latex_text(shortTitle)}}]` : "")
				+ "{"
			),
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
\\citestyle{${cite_style()}}
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
\\hypersetup{colorlinks=true,allcolors=black}
			`),
			render_title(doc.meta.title),
			render_abstract(doc.meta.abstract),
			RawLatexPara(frontmatter.ccs),
			RawLatexPara(frontmatter.rights),
			render_keywords(doc.meta.keywords.c.map(item => item.c)),
			RawLatexPara(frontmatter.authors),
			// acmart sets the teaser between the author block and the abstract on
			// the first page, so it has to be declared before \maketitle.
			...(figure_one && figureOnePlacement === "teaser"
				? [render_figure_one(figure_one)]
				: []),
			RawLatexPara(`
\\maketitle`),
			...(figure_one && figureOnePlacement === "float"
				? [render_figure_one(figure_one)]
				: []),
			...blocks,
			RawLatexPara("\\FloatBarrier"),
			...(doc.meta.acknoledgements ? [render_acknoledgements(doc.meta.acknoledgements)] : []),
			RawLatexPara(`
\\bibliographystyle{ACM-Reference-Format}
\\bibliography{zotero}
\\end{document}`)
		];

		doc.blocks = allow_breaks_after_equals_in_inline_code(blocks);
		return doc;
	})
	.then(async (data) => process.stdout.write(JSON.stringify(data)));

})();
