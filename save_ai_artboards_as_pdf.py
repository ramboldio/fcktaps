#!/usr/bin/env python3
import sys
import io
from PyPDF2 import PdfReader, PdfWriter

def save_ai_artboards_as_pdfs(ai_file_path, output_prefix):
    """
    Extracts PDF portion from a PDF-compatible AI file and
    saves each artboard as a separate PDF file.
    """
    # Step 1: Read the AI file and find the PDF portion
    with open(ai_file_path, 'rb') as f:
        content = f.read()
    
    pdf_start = content.find(b'%PDF-')
    if pdf_start == -1:
        raise ValueError("This AI file is not PDF-compatible.")
    
    pdf_content = content[pdf_start:]
    
    # Step 2: Load the PDF using PyPDF2
    reader = PdfReader(io.BytesIO(pdf_content))
    
    # Step 3: Save each page as a separate PDF
    for i, page in enumerate(reader.pages, start=1):
        writer = PdfWriter()
        writer.add_page(page)
        
        output_file = f"{output_prefix}_artboard_{i}.pdf"
        with open(output_file, 'wb') as out_f:
            writer.write(out_f)
        
        print(f"Saved artboard {i} as {output_file}")

def main():
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.ai> <output_prefix>")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_prefix = sys.argv[2]
    
    try:
        save_ai_artboards_as_pdfs(input_file, output_prefix)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()