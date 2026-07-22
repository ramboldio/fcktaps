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

const Figure = (caption, image, ref_id) => ({
	t: "Figure",
	c: [
		[ref_id, [], []],
		[[], [caption]],
		[Para([image])]
	]});

// Map source extensions to the converted extension produced by convert_figures.py
const convertedExt = { ".svg": ".pdf", ".emf": ".png", ".EMF": ".png" };

(async () => {
	readStdin()
	  .then(async (stdin_content) => {
	  	const doc = JSON.parse(stdin_content);
 			doc.blocks = doc.blocks.map(b => mapTree(b, b => {
				if (b.t === "Image") {
					const p = b.c[2][0];
					const ext = p.match(/(\.[^.]+)$/)?.[1] ?? "";
					const pdfPath = p.slice(0, -ext.length) + ".pdf";
					const replacement = fs.existsSync(pdfPath)
						? pdfPath
						: convertedExt[ext]
							? p.slice(0, -ext.length) + convertedExt[ext]
							: null;
					if (replacement) {
						b = { ...b };
						b.c = [...b.c];
						b.c[2] = [replacement, b.c[2][1]];
					}
 				}
 				return b;
 			}));
		return doc;
	})
	.then(async (data) => process.stdout.write(JSON.stringify(data)));

})();
