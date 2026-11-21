# Staging end-to-end QA (Playwright + headless Chrome) against scripts/e2e-server.mjs:
#   A  http://localhost:4318  pilot gate OPEN (simulated counsel approval), offer ACTIVE
#   C  http://localhost:4317  pilot gate CLOSED (as in production today), offer ACTIVE
#   E  http://localhost:4319  offer window ENDED
# Notion is an in-memory stand-in that ENFORCES the proposed schema; emails are CAPTURED (never sent).
import json, sys, re, urllib.request, pathlib, random
_dumps = json.dumps
json.dumps = lambda o, **k: _dumps(o, ensure_ascii=False, **k)
from playwright.sync_api import sync_playwright

A, C, E = "http://localhost:4318", "http://localhost:4317", "http://localhost:4319"
SHOTS = pathlib.Path("/home/claude/showcase-preview/e2e-shots"); SHOTS.mkdir(exist_ok=True)
AXE = open("/tmp/axe/node_modules/axe-core/axe.min.js").read()
results = []
AREA = ["?"]
def area(a): AREA[0] = a; print(f"\n== {a}")
def check(name, cond, detail=""):
    results.append({"area": AREA[0], "test": name, "pass": bool(cond), "detail": "" if cond else str(detail)[:300]})
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))
def state(base): return json.load(urllib.request.urlopen(base + "/__e2e/state"))
def money(c): return "${:,.2f}".format(c / 100)
def shot(pg, name):
    pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(150); pg.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)

# Approved schedule (CEO, 2026-11-19), progressive/marginal — written independently of the site code.
BANDS = [(1, 500, 7500), (501, 5000, 3000), (5001, 25000, 2500), (25001, 100000, 1500)]
def expected(n, disc=True):
    std = fy = 0
    for lo, hi, r in BANDS:
        if n < lo: break
        c = min(n, hi) - lo + 1; std += c * r; fy += c * (r * 7 // 10 if disc else r)
    return std, fy, std - fy

PILOT = dict(pOrgName="Lincoln Elementary School", pFullName="Dana Rivera", pEmail="dana@lincoln.k12.tx.us", pJobTitle="Principal", pStudents="120")
QUOTE = dict(qOrg="Riverside Unified School District", qName="Sam Patel", qEmail="spatel@riverside.k12.ca.us", qRole="Director of Curriculum")
def fill_pilot(pg, data=PILOT, st="Texas"):
    for k, v in data.items(): pg.fill("#" + k, v)
    pg.select_option("#pState", st)
def fill_quote(pg, data=QUOTE, t="School District", st="California"):
    for k, v in data.items(): pg.fill("#" + k, v)
    pg.select_option("#qType", t); pg.select_option("#qState", st); pg.check("#qConsent")
def axe(pg):
    pg.add_script_tag(content=AXE)
    return pg.evaluate("axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}).then(r=>r.violations.map(v=>v.id+': '+v.nodes.length))")

IP = [10]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    def np(**kw):  # each simulated visitor gets its own client address (the server rate-limits per address)
        x = b.new_page(**kw); IP[0] += 1; x.set_extra_http_headers({"x-forwarded-for": f"10.0.0.{IP[0]}"}); return x
    pg = np(viewport={"width": 1440, "height": 900})
    errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and "502" not in m.text else None)
    pg.goto(A + "/"); pg.wait_for_load_state("networkidle")

    # ------------------------------------------------------------------ 1
    area("1. Pilot registration")
    check("Pilot is the default (primary) tab", pg.get_attribute("#tab-pilot", "aria-selected") == "true" and pg.is_visible("#panel-pilot"))
    box = pg.locator("#tab-offer").bounding_box()
    check("30% offer tab visible as second option without scrolling", box and box["y"] + box["height"] <= 900)
    check("Hero artwork loads", all(pg.evaluate("[...document.querySelectorAll('.art img')].map(i=>i.naturalWidth>0)")))
    fill_pilot(pg); pg.click("#pNext")
    check("Step 1 → step 2 with recap", pg.is_visible("#pStep2") and "Lincoln Elementary School" in pg.inner_text("#pRecap"))

    # ------------------------------------------------------------------ 2
    area("2. Legal acknowledgments")
    check("All acknowledgment boxes start unticked", pg.evaluate("['cTerms','cPrivacy','cAuth','cMarketing'].every(i=>!document.getElementById(i).checked)"))
    check("Terms and Privacy links point to the legal pages", pg.evaluate("[...document.querySelectorAll('#pStep2 .acks a')].map(a=>a.getAttribute('href'))") == ["legal/pilot-terms.html", "legal/privacy-notice.html"])
    pg.click("#pSubmit")
    check("Blocked with 0 of 3 required acknowledgments", pg.is_visible("#pError") and pg.evaluate("document.querySelectorAll('#pStep2 .check.invalid').length") == 3)
    pg.check("#cTerms"); pg.check("#cPrivacy"); pg.click("#pSubmit")
    check("Blocked with 2 of 3 (authority missing)", pg.is_visible("#pError") and not pg.is_visible("#pDone"))
    check("Nothing stored or emailed before acknowledgments", not state(A)["notion"]["main"] and not state(A)["audit"] and not state(A)["outbox"])
    page_text = pg.inner_text("[data-consent='authority']")
    pg.check("#cAuth"); pg.click("#pSubmit"); pg.wait_for_selector("#pDone:not([hidden])")
    ref = pg.inner_text("#pRef"); st = state(A)
    check("Pilot confirmation screen with reference", bool(re.fullmatch(r"PILOT-[0-9A-F]{8}", ref)), ref)
    check("Consent record: one row, document versions, exact authority wording shown on the page",
          len(st["audit"]) == 1 and st["audit"][0]["terms_version"] == "PILOT-TERMS-E2E-APPROVED" and st["audit"][0]["authority_text"] == page_text)
    check("Optional marketing consent recorded as not given", st["audit"][0]["marketing"] is False)
    org = st["notion"]["main"][0]["properties"]
    check("CRM: no consent wording stored in Notion (reference only)", "authorized by my school" not in json.dumps(st["notion"]) and org["Consent Reference"]["rich_text"][0]["text"]["content"] == ref)

    # ------------------------------------------------------------------ 9 (pilot side) + activation gates
    area("9a. Pilot status, activation and privacy gates")
    sel = lambda k: org[k]["select"]["name"]
    check("Pilot Status = Pilot Requested", sel("Pilot Status") == "Pilot Requested")
    check("School Approval = Not received; DPA Status = To be determined", sel("School Approval") == "Not received" and sel("DPA Status") == "To be determined")
    check("No Pilot Start Date at submission (30 days start only on activation)", "Pilot Start Date" not in org)
    check("No licensing fields on a pilot (no price, licenses, agreement, path)", not any(k in org for k in ["Student Licenses", "Annual Contract Value", "Agreement Status", "LaunchEd Path"]))
    check("Activation instructions note on the record", "must NOT be activated" in json.dumps(st["notion"]["blocks"]))
    check("No student information in any stored record or email", not re.search(r"student ?(name|email|id|dob)", json.dumps(st), re.I))

    # ------------------------------------------------------------------ 7 (pilot email)
    area("7. Confirmation emails")
    mails = [m for m in st["outbox"] if m["kind"] == "pilot_confirmation"]
    check("Pilot confirmation email captured (not sent externally), to the requester", len(mails) == 1 and mails[0]["to"] == PILOT["pEmail"])
    if mails:
        t = mails[0]["text"]
        check("Pilot email: reference, next steps, 30 days start on activation, no commitment",
              ref in mails[0]["subject"] and "30 days begin on that day" in t and "no annual license commitment" in t and "No student accounts have been created" in t)
    check("Internal sales notification captured (not sent)", any(m["kind"] == "internal_notification" for m in st["outbox"]))
    shot(pg, "desktop-pilot-confirm")

    # ------------------------------------------------------------------ 10 duplicates
    area("10. Duplicate prevention")
    d = np(viewport={"width": 1440, "height": 900}); d.goto(A + "/")
    fill_pilot(d); d.click("#pNext"); d.check("#cTerms"); d.check("#cPrivacy"); d.check("#cAuth"); d.click("#pSubmit"); d.wait_for_selector("#pDone:not([hidden])")
    st2 = state(A)
    check("Same person + school again: no new CRM record, original reference shown", len(st2["notion"]["main"]) == 1 and d.inner_text("#pRef") == ref and "already" in d.inner_text("#pDoneT"))
    check("Duplicate: no second confirmation email", len([m for m in st2["outbox"] if m["kind"] == "pilot_confirmation"]) == 1)
    check("Duplicate: dated note appended, fields unchanged", "Repeat pilot request" in json.dumps(st2["notion"]["blocks"]))
    c2 = np(viewport={"width": 1440, "height": 900}); c2.goto(A + "/")
    fill_pilot(c2, {**PILOT, "pFullName": "Chris Lee", "pEmail": "clee@lincoln.k12.tx.us"}); c2.click("#pNext"); c2.check("#cTerms"); c2.check("#cPrivacy"); c2.check("#cAuth"); c2.click("#pSubmit"); c2.wait_for_selector("#pDone:not([hidden])")
    st3 = state(A)
    check("Colleague from the same school: new record, flagged for review", len(st3["notion"]["main"]) == 2 and "Another contact from the same organization" in json.dumps(st3["notion"]["blocks"]))

    # ------------------------------------------------------------------ 3 validation
    area("3. Form validation")
    v = np(viewport={"width": 1440, "height": 900}); v.goto(A + "/")
    v.click("#pNext")
    check("Pilot: 6 empty fields flagged, focus on first", v.evaluate("document.querySelectorAll('#pStep1 .f.invalid').length") == 6 and v.evaluate("document.activeElement.id") == "pOrgName")
    fill_pilot(v, {**PILOT, "pEmail": "dana@gmail.com"}); v.click("#pNext")
    check("Pilot: personal email domain refused", v.is_visible("#pEmailErr") and "work" in v.inner_text("#pEmailErr"))
    v.fill("#pEmail", "not-an-email"); v.click("#pNext"); check("Pilot: malformed email refused", v.is_visible("#pEmailErr"))
    v.fill("#pEmail", PILOT["pEmail"])
    for bad in ["0", "250000", "12.5", "abc"]:
        v.fill("#pStudents", bad); v.click("#pNext")
        check(f"Pilot: student count '{bad}' refused", v.is_visible("#pStudentsErr"))
    v.click("#tab-offer"); v.click("#qSubmit")
    check("Quote: empty form flagged (6 fields + consent)", v.evaluate("document.querySelectorAll('#quoteForm .f.invalid').length") == 6 and v.evaluate("document.getElementById('qConsentChk').classList.contains('invalid')"))
    v.fill("#lic", "abc"); check("Calculator: non-numeric quantity flagged", v.is_visible("#licErr"))
    r = urllib.request.Request(A + "/api/pilot-register", data=json.dumps({"submissionId": "x"}).encode(), headers={"Content-Type": "application/json"})
    try: urllib.request.urlopen(r); code = 200
    except urllib.error.HTTPError as e: code = e.code
    check("Server rejects an invalid pilot payload sent directly (422)", code == 422, code)
    bad = {"submissionId": "abcdefgh-1234", "orgName": "X School", "fullName": "A B", "email": "a@x.org", "jobTitle": "T", "state": "Texas", "pilotStudents": 10,
           "studentNames": ["Kid One"], "consents": {"terms": True, "privacy": True, "authority": True, "termsVersion": "PILOT-TERMS-E2E-APPROVED", "privacyVersion": "PRIVACY-NOTICE-E2E-APPROVED"}}
    try: urllib.request.urlopen(urllib.request.Request(A + "/api/pilot-register", data=json.dumps(bad).encode(), headers={"Content-Type": "application/json"})); code = 200
    except urllib.error.HTTPError as e: code = e.code
    check("Server refuses any student-data field (422)", code == 422, code)

    # ------------------------------------------------------------------ 4 offer selection + tab switching
    area("4. Offer selection and tab switching")
    t = np(viewport={"width": 1440, "height": 900}); t.goto(A + "/")
    fill_pilot(t); t.click("#pNext"); t.check("#cTerms")
    t.click("#tab-offer"); fill_quote(t)
    t.click("#tab-pilot")
    check("Pilot step 2 and ticks preserved after switching tabs", t.is_visible("#pStep2") and t.is_checked("#cTerms") and not t.is_checked("#cPrivacy"))
    t.click("#tab-offer")
    check("Quote entries preserved after switching back", all(t.input_value("#" + k) == val for k, val in QUOTE.items()))
    check("Pilot answers never copied into the quote form", t.input_value("#qOrg") != PILOT["pOrgName"])
    t.focus("#tab-offer"); t.keyboard.press("ArrowLeft")
    check("Keyboard arrows switch tabs", t.get_attribute("#tab-pilot", "aria-selected") == "true")
    for url, want in [("/#offer", "offer"), ("/?option=offer&utm_source=email", "offer"), ("/?utm_source=email", "pilot")]:
        x = np(); x.goto(A + url)
        check(f"Email link {url} opens the {want} tab", x.get_attribute(f"#tab-{want}", "aria-selected") == "true")
    check("Annual signing button is disabled", t.is_disabled("#panel-offer .btn-off"))

    # ------------------------------------------------------------------ 6 pricing
    area("6. Pricing calculations and tier boundaries")
    t.click("#tab-offer")
    bad = []
    for n in [50, 499, 500, 501, 502, 1000, 4999, 5000, 5001, 5002, 24999, 25000, 25001, 25002, 60000, 99999, 100000]:
        t.fill("#lic", f"{n:,}")
        got = (t.inner_text("#stdTotal"), t.inner_text("#evtTotal"), t.inner_text("#saveTotal"))
        if got != tuple(money(x) for x in expected(n)): bad.append((n, got, expected(n)))
    check("Page totals match the approved marginal schedule at all boundaries (17 sizes)", not bad, bad)
    t.fill("#lic", "1000")
    check("CEO example: 1,000 students → $36,750 first year ($52,500 standard, save $15,750)",
          (t.inner_text("#stdTotal"), t.inner_text("#evtTotal"), t.inner_text("#saveTotal")) == ("$52,500.00", "$36,750.00", "$15,750.00"))
    t.click("details.tiers-d summary")
    rows = t.evaluate("[...document.querySelectorAll('#tierRows tr')].map(r=>r.innerText.replace(/\\s+/g,' ').trim())")
    check("Breakdown shows 500 × $52.50 and 500 × $21.00", rows[0].endswith("500 × $52.50 = $26,250.00") and rows[1].endswith("500 × $21.00 = $10,500.00") and rows[2].endswith("—"), rows)
    check("Renewal (year two) shown at standard price: $52,500.00", "From year two: $52,500.00 per year" in t.inner_text("#unitLine"))
    check("Offer window end date shown", "available until" in t.inner_text("#windowTxt"))
    prev = None; mono = True
    for n in list(range(495, 507)) + list(range(4995, 5007)) + list(range(24995, 25007)):
        t.fill("#lic", str(n)); v_ = float(t.inner_text("#evtTotal").replace("$", "").replace(",", ""))
        if prev is not None and v_ <= prev: mono = False
        prev = v_
    check("Total never decreases when licenses are added (UI, ±6 around each boundary)", mono)
    srv_bad = []
    random.seed(7)
    for n in random.sample(range(50, 100001), 40) + [500, 501, 5000, 5001, 25000, 25001]:
        q = json.load(urllib.request.urlopen(f"{A}/__e2e/quote?n={n}"))
        t.fill("#lic", str(n))
        if t.inner_text("#evtTotal") != money(q["firstYearTotalCents"]) or t.inner_text("#stdTotal") != money(q["standardTotalCents"]): srv_bad.append(n)
    check("Page and server agree on 46 quantities (incl. 40 random)", not srv_bad, srv_bad)
    for n in [49, 100001]:
        t.fill("#lic", str(n))
        check(f"{n:,} students → custom-quote policy (no automatic price)", t.inner_text("#evtTotal") == "Custom" and t.is_visible("#customNote"))
    t.click(".chip[data-n='1000']")
    shot(t, "desktop-offer")
    ax = axe(t); check("Accessibility (axe, WCAG 2.2 AA): offer tab, no violations", not ax, ax)

    # ------------------------------------------------------------------ 5 quote requests (+ 7, 8)
    area("5. Quote requests")
    t.select_option("#qType", "School District"); t.select_option("#qState", "California")
    t.click("#qSubmit"); t.wait_for_selector("#qDone:not([hidden])")
    qref = t.inner_text("#qRef"); sumtxt = t.inner_text("#qDoneSum")
    check("Quote confirmation: reference + $36,750 first year + $52,500 from year two", qref.startswith("LE26-") and "$36,750.00" in sumtxt and "$52,500.00" in sumtxt and "$15,750.00" in sumtxt, sumtxt)
    shot(t, "desktop-offer-confirm")

    area("8. Notion CRM synchronization (schema-enforcing stand-in)")
    st = state(A); rec = next(x for x in st["notion"]["main"] if x["properties"].get("Campaign Option", {}).get("select", {}).get("name") == "30% Launch Offer")["properties"]
    g = lambda k: rec[k][next(iter(set(rec[k]) - {"type"}))]
    check("Quote record: Lead Source / Campaign Option / path / agreement / sales status",
          rec["Lead Source"]["select"]["name"] == "ChessMagic Academy Launch" and rec["LaunchEd Path"]["select"]["name"] == "Request a Quote"
          and rec["Agreement Status"]["select"]["name"] == "Not sent" and rec["Sales Status"]["status"]["name"] == "Not started")
    check("Quote record: first-year $36,750, savings $15,750, renewal $52,500, discount 30%",
          (rec["Annual Contract Value"]["number"], rec["Annual Savings"]["number"], rec["Renewal Annual Price"]["number"], rec["LaunchEd Discount"]["number"]) == (36750, 15750, 52500, 0.3))
    check("Quote record: Offer Valid Until set (30-day window)", bool(rec.get("Offer Valid Until", {}).get("date", {}).get("start")))
    blk = json.dumps(st["notion"]["blocks"])
    check("Quote record body lists both tiers", re.search(r"Students 1–500: 500 × \$52\.50 \(standard \$75\.00\) = \$26,250\.00", blk) and re.search(r"Students 501–1,000: 500 × \$21\.00 \(standard \$30\.00\) = \$10,500\.00", blk))
    check("Every CRM write matched the proposed schema (no rejected writes)", "validation_error" not in json.dumps(st))
    check("No pilot fields on the quote record", not any(k in rec for k in ["Pilot Status", "Pilot Students", "Consent Reference"]))

    area("7. Confirmation emails")
    qm = [m for m in st["outbox"] if m["kind"] == "quote_confirmation"]
    check("Quote confirmation email captured, to the requester", len(qm) == 1 and qm[0]["to"] == QUOTE["qEmail"])
    if qm:
        qt = qm[0]["text"]
        check("Quote email: tier breakdown, totals, first-year-only, renewal at standard, non-binding",
              "Students 1–500: 500 × $52.50 = $26,250.00" in qt and "First-year total: $36,750.00" in qt and "first year only" in qt and "standard annual price ($52,500.00" in qt and "not a binding offer" in qt)
    area("10. Duplicate prevention")
    t2 = np(viewport={"width": 1440, "height": 900}); t2.goto(A + "/#offer"); fill_quote(t2); t2.click("#qSubmit"); t2.wait_for_selector("#qDone:not([hidden])")
    st = state(A)
    check("Repeat quote from same person + org: no new record, no second email", len([x for x in st["notion"]["main"] if x["properties"].get("Campaign Option", {}).get("select", {}).get("name") == "30% Launch Offer"]) == 1
          and len([m for m in st["outbox"] if m["kind"] == "quote_confirmation"]) == 1 and "already" in t2.inner_text("#qDoneT"))

    # ------------------------------------------------------------------ 11 errors
    area("11. Error handling")
    o = np(viewport={"width": 1440, "height": 900}); o.goto(A + "/#offer"); fill_quote(o, {**QUOTE, "qOrg": "Oak Valley Charter Network", "qEmail": "jo@oakvalley.org"}, "Charter School Network", "Ohio")
    n_mail = len(state(A)["outbox"])
    urllib.request.urlopen(A + "/__e2e/fail-next?what=notion"); o.click("#qSubmit"); o.wait_for_selector("#qError.show")
    check("CRM outage (quote): clear error, entries kept, no confirmation, no email",
          "not sent" in o.inner_text("#qError") and not o.is_visible("#qDone") and o.input_value("#qOrg") == "Oak Valley Charter Network" and len(state(A)["outbox"]) == n_mail)
    o.click("#qSubmit"); o.wait_for_selector("#qDone:not([hidden])")
    check("Retry after outage succeeds", o.is_visible("#qDone"))
    pe = np(viewport={"width": 1440, "height": 900}); pe.goto(A + "/")
    fill_pilot(pe, {**PILOT, "pOrgName": "Maple Grove Academy", "pEmail": "kim@maplegrove.org"}, "Georgia"); pe.click("#pNext"); pe.check("#cTerms"); pe.check("#cPrivacy"); pe.check("#cAuth")
    n_mail = len([m for m in state(A)["outbox"] if m["kind"] == "pilot_confirmation"])
    urllib.request.urlopen(A + "/__e2e/fail-next?what=notion"); pe.click("#pSubmit"); pe.wait_for_selector("#pError.show")
    check("CRM outage (pilot): error shown, answers and ticks kept, no email", "not submitted" in pe.inner_text("#pError") and pe.is_checked("#cAuth") and len([m for m in state(A)["outbox"] if m["kind"] == "pilot_confirmation"]) == n_mail)
    pe.click("#pSubmit"); pe.wait_for_selector("#pDone:not([hidden])")
    check("Pilot retry after outage: one record, one consent row for that submission", len([x for x in state(A)["audit"] if x["org_name"] == "Maple Grove Academy"]) == 1)
    pc = np(viewport={"width": 1440, "height": 900}); pc.goto(C + "/")
    check("Locked state (production today): 'not yet open' note shown", pc.is_visible("#pDraftNote"))
    fill_pilot(pc); pc.click("#pNext"); pc.check("#cTerms"); pc.check("#cPrivacy"); pc.check("#cAuth"); pc.click("#pSubmit"); pc.wait_for_selector("#pError.show")
    sc = state(C)
    check("Locked state: request refused; nothing stored or emailed; answers kept", "open soon" in pc.inner_text("#pError") and not sc["notion"]["main"] and not sc["audit"] and not sc["outbox"] and pc.is_checked("#cAuth"))
    en = np(viewport={"width": 1440, "height": 900}); en.goto(E + "/#offer"); en.wait_for_timeout(500)
    check("Offer ended: standard prices only (1,000 → $52,500, save $0)", (en.inner_text("#stdTotal"), en.inner_text("#evtTotal"), en.inner_text("#saveTotal")) == ("$52,500.00", "$52,500.00", "$0.00"))
    check("Offer ended: notice shown, 'Save 30%' badge hidden", "has ended" in en.inner_text("#offerNote") and not en.is_visible("#tab-offer .badge"))
    fill_quote(en, {**QUOTE, "qEmail": "late@riverside.k12.ca.us", "qName": "Late Requester"}); en.click("#qSubmit"); en.wait_for_selector("#qDone:not([hidden])")
    er = state(E)["notion"]["main"][-1]["properties"]
    check("Offer ended: server records standard price, no discount, no offer date", er["Annual Contract Value"]["number"] == 52500 and "LaunchEd Discount" not in er and "Offer Valid Until" not in er)
    codes = []
    for i in range(8):
        rq = urllib.request.Request(A + "/api/pilot-register", data=b"{}", headers={"Content-Type": "application/json", "x-forwarded-for": "10.9.9.9"})
        try: urllib.request.urlopen(rq); codes.append(200)
        except urllib.error.HTTPError as e_: codes.append(e_.code)
    check("Abuse protection: 7th+ pilot request from one address within 10 minutes is refused (429)", codes[:6] == [422] * 6 and codes[6:] == [429, 429], codes)
    check("No JavaScript errors on any page", not errors, errors[:3])

    # ------------------------------------------------------------------ 9 UX
    area("9. Mobile and desktop UX")
    dp = np(viewport={"width": 1440, "height": 900}); dp.goto(A + "/"); dp.wait_for_load_state("networkidle")
    ax = axe(dp); check("Accessibility (axe, WCAG 2.2 AA): pilot tab, no violations", not ax, ax)
    shot(dp, "desktop-pilot")
    for w, h, name in [(390, 844, "iPhone 14"), (360, 740, "small Android"), (768, 1024, "tablet")]:
        m = np(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=w < 700, has_touch=True)
        m.goto(A + "/"); m.wait_for_load_state("networkidle")
        check(f"{name} {w}px: no horizontal scrolling", m.evaluate("document.documentElement.scrollWidth - window.innerWidth") <= 0)
        tb = m.locator("#tab-offer").bounding_box(); check(f"{name}: both tabs on the first screen", tb["y"] + tb["height"] <= h, tb)
        small = m.evaluate("""[...document.querySelectorAll('button:not(.link):not([hidden]), input:not(.sr):not([type=checkbox]), select, .tab')].filter(e=>e.offsetParent).map(e=>[e.id||e.className, Math.round(e.getBoundingClientRect().height)]).filter(x=>x[1]<44)""")
        check(f"{name}: tap targets ≥ 44px", not small, small)
        check(f"{name}: form text ≥ 16px", m.evaluate("[...document.querySelectorAll('input:not(.sr):not([type=checkbox]), select')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=16)"))
        if w == 390:
            shot(m, "mobile-pilot-1")
            fill_pilot(m, {**PILOT, "pOrgName": "Cedar Ridge Charter", "pEmail": "pat@cedarridge.org"}, "Florida"); m.click("#pNext"); shot(m, "mobile-pilot-2")
            m.check("#cTerms"); m.check("#cPrivacy"); m.check("#cAuth"); m.click("#pSubmit"); m.wait_for_selector("#pDone:not([hidden])"); shot(m, "mobile-pilot-3")
            check("iPhone: pilot completes end to end", m.is_visible("#pDone"))
            m.click("#tab-offer"); m.click(".chip[data-n='1000']"); m.click("details.tiers-d summary")
            check("iPhone: offer totals correct ($36,750)", m.inner_text("#evtTotal") == "$36,750.00")
            check("iPhone: breakdown table fits (no horizontal scrolling)", m.evaluate("document.documentElement.scrollWidth - window.innerWidth") <= 0)
            shot(m, "mobile-offer")
    b.close()

fails = [r for r in results if not r["pass"]]
print(f"\n{len(results) - len(fails)} passed, {len(fails)} failed")
json.dump(results, open(SHOTS / "results.json", "w"), indent=1)
sys.exit(1 if fails else 0)
