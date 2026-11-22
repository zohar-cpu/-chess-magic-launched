#!/usr/bin/env python3
"""
Builds the two agreement templates from the company's source agreement ("License Agreement - usa.docx").

  templates/annual-license-order-form.docx   = Annual License Order Form (tagged) + License Terms + EULA
  templates/pilot-order-form.docx            = Pilot Order Form (tagged) + Pilot Addendum + License Terms + EULA

Rules (enforced by tests/documents.test.js):
  * Everything from "LICENSE TERMS" to the end of the source (License Terms + EULA, incl. their
    signature blocks, typos and numbering) is copied BYTE-FOR-BYTE (XML elements deep-copied, unmodified).
  * Only the Order Form part (source page 1–2) is re-authored. Source wording is reused verbatim where it
    exists; every new or changed sentence is listed in templates/CHANGELOG-order-forms.md and, in DRAFT
    mode, prefixed with "[Proposed]".
  * New headings reuse the source "Heading 3" style (as the source Order Form does), so the License Terms
    keep their original numbering (Definitions = 2 … General = 13). The Pilot Addendum uses unnumbered
    paragraphs for the same reason.
Tags use docxtemplater syntax: {field}, {#cond}…{/cond}, {#rows}…{/rows}.
"""
import copy, hashlib, json, sys, pathlib, datetime
import docx
from docx.oxml.ns import qn
from lxml import etree

SRC = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/home/claude/agreement/source.docx")
OUT = pathlib.Path(__file__).resolve().parent.parent / "templates"
OUT.mkdir(exist_ok=True)
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
TEMPLATE_VERSION = "2026-11-19-DRAFT-1"

def load():
    d = docx.Document(str(SRC))
    body = d.element.body
    kids = list(body.iterchildren())
    lt = next(i for i, el in enumerate(kids) if el.tag == qn("w:p") and "".join(t.text or "" for t in el.iter(qn("w:t"))).strip() == "LICENSE TERMS")
    return d, body, kids, lt

def run(rpr_src, text, bold=None, size=None, color=None, italic=None):
    r = etree.SubElement(etree.Element(qn("w:dummy")), qn("w:r"))
    rpr = copy.deepcopy(rpr_src) if rpr_src is not None else etree.Element(qn("w:rPr"))
    for tag, val in (("w:b", bold), ("w:i", italic)):
        for e in rpr.findall(qn(tag)): rpr.remove(e)
        if val: etree.SubElement(rpr, qn(tag))
    if size:
        for e in rpr.findall(qn("w:sz")) + rpr.findall(qn("w:szCs")): rpr.remove(e)
        etree.SubElement(rpr, qn("w:sz")).set(qn("w:val"), str(size * 2)); etree.SubElement(rpr, qn("w:szCs")).set(qn("w:val"), str(size * 2))
    if color:
        for e in rpr.findall(qn("w:color")): rpr.remove(e)
        etree.SubElement(rpr, qn("w:color")).set(qn("w:val"), color)
    r.append(rpr)
    t = etree.SubElement(r, qn("w:t")); t.text = text; t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return r

def par(template_el, runs, align=None):
    """Clone a source paragraph's paragraph-properties and first-run formatting, replace its text."""
    p = copy.deepcopy(template_el)
    rpr_src = None
    first = p.find(qn("w:r"))
    if first is not None: rpr_src = first.find(qn("w:rPr"))
    rpr_src = copy.deepcopy(rpr_src) if rpr_src is not None else None
    for child in list(p):
        if child.tag != qn("w:pPr"): p.remove(child)
    if align:
        ppr = p.find(qn("w:pPr"))
        if ppr is None: ppr = etree.SubElement(p, qn("w:pPr")); p.insert(0, ppr)
        for e in ppr.findall(qn("w:jc")): ppr.remove(e)
        etree.SubElement(ppr, qn("w:jc")).set(qn("w:val"), align)
    for spec in runs:
        if isinstance(spec, str): spec = (spec, {})
        text, fmt = spec
        p.append(run(rpr_src, text, **fmt))
    return p

def table(col_widths, header, rows, font_pt=9):
    """Simple bordered table. rows: list of lists of cell text (may contain tags)."""
    tbl = etree.Element(qn("w:tbl"))
    tblPr = etree.SubElement(tbl, qn("w:tblPr"))
    etree.SubElement(tblPr, qn("w:tblW")).attrib.update({qn("w:w"): str(sum(col_widths)), qn("w:type"): "dxa"})
    b = etree.SubElement(tblPr, qn("w:tblBorders"))
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        etree.SubElement(b, qn(f"w:{side}")).attrib.update({qn("w:val"): "single", qn("w:sz"): "4", qn("w:space"): "0", qn("w:color"): "808080"})
    etree.SubElement(tblPr, qn("w:tblLayout")).set(qn("w:type"), "fixed")
    grid = etree.SubElement(tbl, qn("w:tblGrid"))
    for w in col_widths: etree.SubElement(grid, qn("w:gridCol")).set(qn("w:w"), str(w))
    def row(cells, head=False):
        tr = etree.SubElement(tbl, qn("w:tr"))
        if head:
            trPr = etree.SubElement(tr, qn("w:trPr")); etree.SubElement(trPr, qn("w:tblHeader"))
        for w, txt in zip(col_widths, cells):
            tc = etree.SubElement(tr, qn("w:tc")); tcPr = etree.SubElement(tc, qn("w:tcPr"))
            etree.SubElement(tcPr, qn("w:tcW")).attrib.update({qn("w:w"): str(w), qn("w:type"): "dxa"})
            if head: etree.SubElement(tcPr, qn("w:shd")).attrib.update({qn("w:val"): "clear", qn("w:color"): "auto", qn("w:fill"): "E7ECF5"})
            p = etree.SubElement(tc, qn("w:p")); ppr = etree.SubElement(p, qn("w:pPr"))
            etree.SubElement(ppr, qn("w:spacing")).attrib.update({qn("w:before"): "40", qn("w:after"): "40"})
            etree.SubElement(ppr, qn("w:jc")).set(qn("w:val"), "left")
            rpr = etree.Element(qn("w:rPr")); f = etree.SubElement(rpr, qn("w:rFonts"))
            f.attrib.update({qn("w:ascii"): "Times New Roman", qn("w:hAnsi"): "Times New Roman", qn("w:cs"): "Times New Roman"})
            p.append(run(rpr, txt, bold=head, size=font_pt))
    row(header, head=True)
    for r in rows: row(r)
    return tbl

def build(kind):
    d, body, kids, lt = load()
    T = {k: kids[i] for k, i in dict(title=0, sub=1, date=2, intro=3, h3=5, field=6, text=14).items()}
    sig = kids[29]
    new = []
    P = lambda key, runs, **k: new.append(par(T[key], runs, **k))
    lab = lambda label, value: P("field", [(label + " ", {"bold": False}), (value, {"bold": True})])
    prop = ("{#draft}[Proposed] {/draft}", {"color": "6B4100", "bold": False})
    draft_banner = lambda: P("date", [("{#draft}DRAFT FOR U.S. COUNSEL REVIEW · NOT AN OFFER · NOT FOR SIGNATURE · Template {template_version}{/draft}", {"bold": True, "color": "B42318", "size": 9})])

    if kind == "annual":
        P("title", [("CHESS MAGIC Inc ", {"bold": True, "size": 20}), ("- ", {"bold": True, "size": 24}), ("LICENSE ORDER FORM", {"bold": True, "size": 18})])
        P("sub", [("Appendix to the License Agreement", {"bold": True})])
        draft_banner()
        P("date", [("Order Date:", {"bold": True}), (" {order_date}", {"bold": False})])
        P("date", [("Document {doc_id} · Version {doc_version} · Quote reference {quote_reference}", {"bold": False, "size": 8, "color": "5B6780"})])
        new.append(copy.deepcopy(kids[3])); new.append(copy.deepcopy(kids[4]))      # verbatim intro paragraphs
        P("h3", ["CUSTOMER INFORMATION"])
        lab("Customer / Organization Name:", "{customer_name}")
        P("field", [prop, ("Customer Type and State: ", {"bold": False}), ("{customer_type} · {customer_state}", {"bold": True})])
        lab("Registration / Company No.:", "{registration_no}")
        lab("Address:", "{customer_address}")
        lab("Authorized Contact:", "{contact_name}, {contact_title}")
        P("field", [("Email: ", {"bold": False}), ("{contact_email}", {"bold": True}), ("   Phone: ", {"bold": False}), ("{contact_phone}", {"bold": True})])
        P("text", [prop, ("Pricing schedule (progressive tiers). Each tier's price applies only to the student licenses that fall within that tier; licenses in a higher tier do not change the price of licenses in a lower tier. The Discount applies to the first License Term only.", {})])
        new.append(table([1900, 1500, 1500, 1700, 2760],
            ["Number of Student Licenses", "Standard Annual Price per Student", "Discount", "Customer Price per Student / Year", "Notes"],
            [["{#bands}{band_label}: {band_count} licenses", "{band_std_unit}", "{band_discount}", "{band_fy_unit}", "{band_note}{/bands}"],
             ["Total: {licenses} licenses", "{std_total} per year", "{discount_label}", "{fy_total} (first year)", "Renewal (standard rates): {renewal_total} per year"]]))
        P("text", [""])
        P("h3", ["INCORPORATION OF LICENSE AGREEMENT"])
        new.append(copy.deepcopy(kids[14])); new.append(copy.deepcopy(kids[15]))  # verbatim (incl. precedence clause → flagged for counsel)
        P("text", [prop, ("The License Agreement consists of the License Terms and the End User License Agreement attached to this Order Form{#dpa_listed}, and the Student Data Protection Addendum executed by the parties, which controls with respect to student personal data{/dpa_listed}.", {})])
        P("h3", ["CUSTOMER ACKNOWLEDGMENT AND ACCEPTANCE"])
        for i in (17, 18, 19): new.append(copy.deepcopy(kids[i]))               # verbatim
        P("h3", ["ORDER DETAILS"])
        lab("Number of Student Licenses Purchased:", "{licenses}")
        lab("Price per Student License:", "Progressive tiers as set out in the pricing schedule above (average first-year price {avg_fy_unit} per student; average standard price {avg_std_unit})")
        P("field", [prop, ("Standard Annual License Fees: ", {"bold": False}), ("{std_total}", {"bold": True})])
        P("field", [prop, ("First-Year Promotional Discount: ", {"bold": False}), ("{discount_line}", {"bold": True})])
        lab("Total License Fees Before VAT:", "{fy_total} (first License Term)")
        lab("VAT / Applicable Taxes:", "{taxes}")
        lab("Total Amount Payable:", "{total_payable}")
        lab("License Start Date:", "{license_start}")
        lab("License End Date:", "{license_end}")
        lab("Payment Terms:", "{payment_terms}")
        P("field", [prop, ("Renewal: ", {"bold": False}), ("{renewal_line}", {"bold": True})])
        P("field", [prop, ("Promotional Offer Eligibility: ", {"bold": False}), ("{offer_line}", {"bold": True})])
    else:
        P("title", [("CHESS MAGIC Inc ", {"bold": True, "size": 20}), ("- ", {"bold": True, "size": 24}), ("PILOT ORDER FORM", {"bold": True, "size": 18})])
        P("sub", [("Appendix to the License Agreement · Free 30-Day Pilot", {"bold": True})])
        draft_banner()
        P("date", [("Order Date:", {"bold": True}), (" {order_date}", {"bold": False})])
        P("date", [("Document {doc_id} · Version {doc_version} · Pilot reference {pilot_reference}", {"bold": False, "size": 8, "color": "5B6780"})])
        P("text", [prop, ("This Pilot Order Form (the ", {}), ("“Pilot Order Form”", {"bold": True}), (" or ", {}), ("“Order Form”", {"bold": True}), (") is entered into pursuant to and forms an integral part of the License Agreement between Chess Magic and the Customer identified below (the ", {}), ("“License Agreement”", {"bold": True}), ("). It sets forth the terms of a free, time-limited evaluation of the Chess Magic platform (the ", {}), ("“Pilot”", {"bold": True}), ("). The Pilot Addendum attached to this Pilot Order Form applies to the Pilot and, notwithstanding anything to the contrary in the License Agreement or in the paragraph headed “Incorporation of License Agreement” below, prevails over the License Agreement to the extent of any conflict.", {})])
        P("h3", ["CUSTOMER INFORMATION"])
        lab("Customer / Organization Name:", "{customer_name}")
        lab("Registration / Company No.:", "{registration_no}")
        lab("Address:", "{customer_address}")
        lab("Authorized Contact:", "{contact_name}, {contact_title}")
        P("field", [("Email: ", {"bold": False}), ("{contact_email}", {"bold": True}), ("   Phone: ", {"bold": False}), ("{contact_phone}", {"bold": True})])
        P("h3", ["PILOT DETAILS"])
        new.append(table([2700, 6660], ["Item", "Pilot terms"], [
            ["Pilot license quantity", "Up to {pilot_students} student accounts{#pilot_teachers}, {pilot_teachers} teacher accounts{/pilot_teachers} (as confirmed in the Activation Notice)"],
            ["Total cost", "$0.00. No fees are payable for the Pilot and no payment details are required."],
            ["Pilot duration", "30 consecutive days starting on the Activation Date stated in the Company's written activation notice (the “Activation Notice”). Submitting a pilot request or signing this Pilot Order Form does not start the Pilot."],
            ["Activation conditions", "(1) Customer's written confirmation that all approvals required by its policies and applicable law have been obtained; and (2) where student personal information will be processed, a Student Data Protection Addendum signed by both parties, or Customer's written confirmation that another student data agreement acceptable to the Company applies. No student account is created and no student information may be provided before activation."],
            ["Conversion", "No automatic conversion to paid licensing. The Pilot ends automatically at the end of the 30-day period."],
            ["Purchase obligation", "None. Any paid license requires a separate License Order Form signed by both parties."],
            ["Applicable terms", "Pilot Addendum (attached); License Terms and End User License Agreement (attached), as modified by the Pilot Addendum; Student Data Protection Addendum (required before any student data is provided); Privacy Notice."],
        ], font_pt=9))
        P("text", [""])
        P("h3", ["INCORPORATION OF LICENSE AGREEMENT"])
        new.append(copy.deepcopy(kids[14])); new.append(copy.deepcopy(kids[15]))
        P("h3", ["CUSTOMER ACKNOWLEDGMENT AND ACCEPTANCE"])
        for i in (17, 18, 19): new.append(copy.deepcopy(kids[i]))
        # ---- Pilot Addendum: unnumbered paragraphs so the License Terms keep their numbering ----
        add = [
            ("P1. Scope and precedence.", "This Pilot Addendum modifies the License Terms and the End User License Agreement solely for the Pilot. If this Pilot Addendum conflicts with the License Terms or the EULA, this Pilot Addendum prevails. The Student Data Protection Addendum, once executed, prevails with respect to student personal data."),
            ("P2. Pilot term.", "The License Term is the thirty (30) consecutive days beginning on the Activation Date stated in the Activation Notice (the “Pilot Period”). The Pilot Period may be extended only by written agreement of both parties [COUNSEL: confirm whether email from an authorized Company representative suffices]. Section 3.2 of the License Terms (renewal) does not apply to the Pilot."),
            ("P3. Activation only after approvals.", "The Company will activate the Pilot only after the activation conditions in the Pilot Details are met. Submitting a pilot request or signing this Pilot Order Form does not activate any account and does not authorize the Customer to provide student information to the Company."),
            ("P4. No fees.", "The Pilot is free of charge. Provisions of the License Terms that condition rights or support on the payment of fees, or that permit suspension for non-payment (including Sections 3.1, 8.2, 8.3 and 12.1(vii)), do not apply to the Pilot. [COUNSEL: confirm section references after the numbering issues in the source are corrected.]"),
            ("P5. No conversion; no purchase obligation.", "The Pilot does not convert into a paid license. The Customer has no obligation to purchase. Promotional pricing, including any first-year launch discount, is available only under a separate written offer and a License Order Form signed by both parties."),
            ("P6. Student data.", "Student personal information is processed only after activation and only under the Student Data Protection Addendum and the Privacy Notice. The Company will not sell student information, use it for targeted advertising, or build student profiles except to deliver the educational service. [COUNSEL: align with FERPA school-official requirements, the amended COPPA Rule and applicable state student-privacy laws.]"),
            ("P7. End of Pilot; data.", "At the end of the Pilot Period, unless the parties have signed a License Order Form, the Company will disable Pilot accounts and, within [30] days, delete or de-identify student personal information, unless the Customer asks in writing to export it first. This paragraph replaces Section 12.3 of the License Terms for the Pilot. The Company will confirm deletion in writing on request."),
            ("P8. Support.", "The Company will provide reasonable onboarding guidance for the Customer's teachers [BUSINESS: confirm scope]. Other support is provided on an as-available basis."),
            ("P9. Liability for the Pilot.", "Because no fees are paid for the Pilot, the cap in Section 10.6 of the License Terms is replaced for the Pilot by a cap of [US $____] [COUNSEL: set amount and any carve-outs, e.g. data protection obligations, gross negligence, willful misconduct]."),
            ("P10. Indemnification.", "[COUNSEL: decide whether the Customer indemnities in Section 11 of the License Terms and in the EULA apply to the Pilot. Many public schools cannot indemnify vendors under state law.]"),
            ("P11. Ending the Pilot early.", "Either party may end the Pilot at any time by written notice (email is sufficient). Paragraph P7 applies on any ending of the Pilot."),
            ("P12. Public records; immunity.", "Nothing in the License Agreement restricts the Customer's compliance with public records laws or waives any immunity available to the Customer as a public entity. [COUNSEL: confirm governing law approach for out-of-state public entities.]"),
        ]
        P("title", [("PILOT ADDENDUM", {"bold": True, "size": 12})])
        P("sub", [("{#draft}Pilot-specific terms proposed for U.S. counsel review{/draft}", {"bold": False, "size": 9})])
        for head, txt in add:
            P("text", [(head + " ", {"bold": True}), (txt, {})])

    # Signature block: source layout, with the "COSTUMER" typo corrected in the re-authored Order Form only.
    s = copy.deepcopy(sig)
    for t in s.iter(qn("w:t")):
        if t.text and "COSTUMER" in t.text: t.text = t.text.replace("COSTUMER", "CUSTOMER")
    new.append(par(T["date"], [("{#draft}Signature fields are disabled. This document is a draft for review only and is not an offer capable of acceptance.{/draft}", {"bold": True, "color": "B42318", "size": 9})]))
    new.append(s)
    pb = etree.Element(qn("w:p")); r = etree.SubElement(pb, qn("w:r")); etree.SubElement(r, qn("w:br")).set(qn("w:type"), "page"); new.append(pb)

    for el in kids[:lt]: body.remove(el)
    anchor = kids[lt]
    for el in new: anchor.addprevious(el)
    name = "annual-license-order-form" if kind == "annual" else "pilot-order-form"
    path = OUT / f"{name}.docx"
    d.save(str(path))
    return name, path

def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()

if __name__ == "__main__":
    manifest = {"source": {"file": SRC.name, "sha256": sha(SRC)}, "template_version": TEMPLATE_VERSION, "status": "DRAFT — pending U.S. counsel approval",
                "approved": False, "built_at": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(), "templates": {}}
    for kind in ("annual", "pilot"):
        name, path = build(kind)
        manifest["templates"][name] = {"file": path.name, "sha256": sha(path)}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(json.dumps(manifest, indent=1))
