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

const Figure = (caption, image, ref_id) => ({
	t: "Figure",
	c: [
		[ref_id, [], []],
		[[], [caption]],
		[Para([image])]
	]});

(async () => {
	readStdin()
	  .then(async (stdin_content) => {
	  	const doc = JSON.parse(stdin_content);
	  	let image_index = 1;
 			doc.block = doc.blocks.map(b => mapTree(b, b => {
 				if (b.t === "Image") {
 					const image_path = b.c[2][0];
					const new_path = `./figures_pdf/Artboard ${image_index}.pdf`;
					image_index = image_index + 1;
					b.c[2][0] = new_path;
 				}
 				return b;
 			}));
		return doc;
	})
	.then(async (data) => process.stdout.write(JSON.stringify(data)));

})();