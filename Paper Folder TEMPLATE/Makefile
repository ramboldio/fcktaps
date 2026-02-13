paper.json:
	pandoc "../144 2026-Rambold-CHI26-AirForce with R&R comments.docx" \
	--from=docx+styles --to=json --output paper.json \
	--extract-media=figures \

paper_filtered.json: paper.json zotero.bib reference_keys.csv
	pandoc -f json -t json -i paper.json -o paper_filtered.json \
		--filter=/Users/lukasrambold/Projects/fcktaps/link_refs_to_bibliography.js \
		--filter=/Users/lukasrambold/Projects/fcktaps/index.js \
		--filter=/Users/lukasrambold/Projects/fcktaps/rewrite_paths_as_pdf_images.js \
 		--filter=/Users/lukasrambold/Projects/fcktaps/patch_latex_things.js

paper_unpatched.tex: paper_filtered.json
	pandoc paper_filtered.json \
	--from=json --to=latex --natbib --output=paper_unpatched.tex

paper.tex: paper_unpatched.tex manual_changes.patch
	patch paper_unpatched.tex -o paper.tex < manual_changes.patch

alt_text.txt: figures_pdf
	./generate_alt_text.sh > alt_text.txt

paper.pdf: paper.tex figures_pdf zotero.bib
	-pdflatex -interaction=nonstopmode paper.tex
	-bibtex paper
	-pdflatex -interaction=nonstopmode paper.tex
	pdflatex -interaction=nonstopmode paper.tex

chi26-1416: paper.pdf paper.tex figures_pdf zotero.bib
	mkdir chi26-1416
	mkdir chi26-1416/pdf
	cp paper.pdf chi26-1416/pdf/paper.pdf
	mkdir chi26-1416/Source
	cp paper.tex chi26-1416/Source
	cp -r figures_pdf chi26-1416/Source
	cp zotero.bib chi26-1416/Source

clean:
	rm paper.json paper_filtered.json paper.tex paper_unpatched.tex paper.pdf paper.bbl paper.blg paper.aux paper.log paper.out comment.cut
	rm -rf chi26-1416
	rm -rf figures
