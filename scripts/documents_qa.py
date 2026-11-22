#!/usr/bin/env python3
"""Document QA: proves the generated agreements keep the source License Terms + EULA unchanged.
Usage: documents_qa.py SOURCE.docx GENERATED.docx [GENERATED.pdf]"""
import sys, re, zipfile, subprocess, json
from lxml import etree
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
def body_after_license_terms(path):
    x = etree.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    kids = list(x.find(W + "body"))
    idx = next(i for i, el in enumerate(kids) if el.tag == W + "p" and "".join(t.text or "" for t in el.iter(W + "t")).strip() == "LICENSE TERMS")
    return [etree.tostring(el, method="c14n") for el in kids[idx:] if el.tag != W + "sectPr"]
def numbering(pdf):
    txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
    i = txt.index("LICENSE TERMS")
    # clause numbers only ("2.", "13.6.1.") in reading order; page numbers carry no trailing dot
    return re.findall(r"(?:^|\s)(\d{1,2}(?:\.\d{1,2}){0,3}\.)\s+[“A-Z(a-z]", txt[i:], flags=re.M)
src, gen = sys.argv[1], sys.argv[2]
a, b = body_after_license_terms(src), body_after_license_terms(gen)
res = {"elements_source": len(a), "elements_generated": len(b), "identical_xml": a == b,
       "first_difference": next((i for i, (x, y) in enumerate(zip(a, b)) if x != y), None)}
if len(sys.argv) > 3:
    src_pdf = sys.argv[4] if len(sys.argv) > 4 else None
    res["numbering_items"] = len(numbering(sys.argv[3]))
    if src_pdf: res["numbering_identical"] = numbering(sys.argv[3]) == numbering(src_pdf)
print(json.dumps(res))
sys.exit(0 if res["identical_xml"] and res.get("numbering_identical", True) else 1)
