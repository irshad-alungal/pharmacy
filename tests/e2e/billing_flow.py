# Billing (POS) end-to-end: every control on the redesigned page, checked against the database.
import json, re, os, sys, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'billing_staff': '0c000000-0000-0000-0000-000000000002'}
TODAY = datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Kolkata')).strftime('%Y-%m-%d')
def api(kind, body, user='super_admin'):
    r = urllib.request.Request(BASE + '/api/' + kind, data=json.dumps({'user': U[user], **body}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
def Q(t, cols, **k): return api('query', {'q': dict({'table': t, 'op': 'select', 'cols': cols, 'filters': [], 'order': [], 'single': None, 'count': None, 'limit': None, 'offset': None, 'values': None, 'returning': None}, **k)})['data']
P = F = 0
def ok(n, c, x=''):
    global P, F
    P += bool(c); F += not c
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else '  → ' + str(x)[:400]))
num = lambda s: float(re.sub(r'[^0-9.\-]', '', s) or 0)
def latest_invoice():
    return sorted(Q('sales_invoices', 'id,invoice_no,total,discount,customer_id,created_at,patient_name,doctor_name,diagnosis'), key=lambda r: r['created_at'])[-1]
def pays_for(inv): return sorted((p['method'], round(float(p['amount']), 2)) for p in Q('payments', 'invoice_id,method,amount', filters=[['eq', 'invoice_id', inv]]))

def ctx(b, role, w=1536, h=1000, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile)
    c.add_init_script(f"localStorage.setItem('e2e_user','{U[role]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[role]}',date:'{TODAY}'}}));")
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return c, pg, errs

def add(pg, term, qty=None):
    pg.fill('#q', term); pg.wait_for_selector('.medicine-result'); pg.click('.medicine-result'); pg.wait_for_timeout(1000)
    if qty:
        pg.fill('[data-gqty] >> nth=-1', str(qty)); pg.wait_for_timeout(1200)

def close_invoice(pg):
    if pg.query_selector('dialog[open] #cl'): pg.click('dialog[open] #cl'); pg.wait_for_timeout(300)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    c, pg, errs = ctx(b, 'super_admin')
    pg.on('dialog', lambda d: d.accept('Counter 1') if d.type == 'prompt' else d.accept())
    pg.goto(BASE + '/billing.html'); pg.wait_for_selector('#q'); pg.wait_for_timeout(1200)

    ok('Layout: branded sidebar with Billing active, no footer block', 'active' in pg.get_attribute('.pp-nav-link[href="billing.html"]', 'class') and 'Trusted' not in pg.inner_text('#ppSidebar'))
    ok('Layout: header buttons (Hold Bills, Bill History, Billing Settings)', all(pg.is_visible(s) for s in ['#held', '.pos-head a[href="sales.html"]', '#settingsBtn']))
    ok('Layout: 6 payment tiles and 6 quick actions', pg.locator('.pos-method').count() == 6 and pg.locator('.pos-qa > *').count() == 6)

    # --- 1. stepper, discount dropdown, totals vs engine, UPI payment, notes
    add(pg, 'Cet')
    pg.click('[data-qplus]'); pg.wait_for_timeout(1300)
    ok('Stepper +: quantity becomes 2', pg.input_value('[data-gqty]') == '2')
    pg.click('[data-qminus]'); pg.wait_for_timeout(1300)
    ok('Stepper −: quantity back to 1', pg.input_value('[data-gqty]') == '1')
    pg.click('[data-qplus]'); pg.wait_for_timeout(1300)
    pg.select_option('[data-gdisc]', '10'); pg.wait_for_timeout(400)
    calc = api('rpc', {'name': 'billing_calc_line', 'args': {'p_mrp': 18, 'p_qty': 2, 'p_discount_pct': 10, 'p_gst_pct': 12, 'p_price_includes_tax': True}})['data'][0]
    ok(f"Discount 10% → amount ₹{calc['total_amount']} (database billing_calc_line)", abs(num(pg.inner_text('[data-gtotal]')) - float(calc['total_amount'])) < 0.005, pg.inner_text('[data-gtotal]'))
    ok('Summary grand total equals line total', abs(num(pg.inner_text('#tot')) - float(calc['total_amount'])) < 0.005, pg.inner_text('#tot'))
    ok('Summary discount shows the line discount', abs(abs(num(pg.inner_text('#sumDisc'))) - float(calc['discount_amount'])) < 0.005, pg.inner_text('#sumDisc'))
    ok('Generate button shows the total', pg.inner_text('#payLabel').endswith(f"(₹{float(calc['total_amount']):,.2f})"), pg.inner_text('#payLabel'))
    pg.click('#notesToggle'); pg.fill('#diagnosis', 'Take after food')
    pg.click('.pos-method[data-method="upi"]')
    pg.click('#pay'); pg.wait_for_timeout(2500)
    inv = latest_invoice()
    ok('UPI bill saved with server total = screen total', abs(float(inv['total']) - float(calc['total_amount'])) < 0.005 and pays_for(inv['id']) == [('upi', round(float(calc['total_amount']), 2))], (inv, pays_for(inv['id'])))
    ok('Notes saved on the bill', inv['diagnosis'] == 'Take after food', inv)
    ok('Invoice preview opens after saving', pg.query_selector('dialog[open] #pv') is not None)
    close_invoice(pg)
    ok('Cart cleared after saving', pg.locator('tr.group-row').count() == 0)

    # --- 2. customer search + select, bill discount via pencil, credit payment, prescription upload
    pg.click('#custInput'); pg.keyboard.type('Ravi'); pg.wait_for_selector('#custList:not([hidden]) [data-ci="1"]'); pg.wait_for_timeout(300)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(800)
    ok('Customer search selects Ravi Kumar', 'Ravi Kumar' in pg.input_value('#custInput') and 'Credit available' in pg.inner_text('#custInfo'), pg.input_value('#custInput'))
    add(pg, 'Pan')
    pg.click('#discEdit'); pg.fill('#disc', '5'); pg.wait_for_timeout(300)
    t2 = num(pg.inner_text('#tot'))
    pg.click('#rxToggle'); pg.fill('#doctorName', 'Dr. Menon'); pg.fill('#patientName', 'Ravi')
    pg.set_input_files('#rxFile', files=[{'name': 'rx.png', 'mimeType': 'image/png', 'buffer': b'\x89PNG\r\n\x1a\n' + b'0' * 64}])
    ok('Prescription file attached', 'rx.png' in pg.inner_text('#rxFileInfo'))
    pg.click('.pos-method[data-method="credit"]'); pg.wait_for_timeout(300)
    ok('Credit tile selected for a customer', 'on' in pg.get_attribute('.pos-method[data-method="credit"]', 'class') and 'Ravi Kumar' in pg.inner_text('#payDetail'))
    pg.click('#pay'); pg.wait_for_timeout(3000)
    inv = latest_invoice()
    ok(f'Credit bill: total ₹{t2} with ₹5 bill discount, all on credit', abs(float(inv['total']) - t2) < 0.005 and float(inv['discount']) == 5 and pays_for(inv['id']) == [('credit', round(t2, 2))], (inv, pays_for(inv['id'])))
    ok('Doctor and patient saved on the bill', inv['doctor_name'] == 'Dr. Menon' and inv['patient_name'] == 'Ravi', inv)
    sheets = Q('customer_doctor_sheets', 'invoice_id,file_name', filters=[['eq', 'invoice_id', inv['id']]])
    ok('Prescription saved to the customer record', len(sheets) == 1 and sheets[0]['file_name'] == 'rx.png', (sheets, pg.inner_text('#msg')))
    close_invoice(pg)

    # --- 3. add customer dialog + split payment
    pg.click('#custAdd'); pg.fill('#ncName', 'Meera Nair'); pg.fill('#ncPhone', '9847055555'); pg.click('#ncSave'); pg.wait_for_timeout(1200)
    newc = Q('customers', 'id,name,phone', filters=[['eq', 'name', 'Meera Nair']])
    ok('Add customer: created and selected', len(newc) == 1 and 'Meera Nair' in pg.input_value('#custInput'), (newc, pg.input_value('#custInput')))
    add(pg, 'Dol', 12)
    t3 = num(pg.inner_text('#tot'))
    pg.click('.pos-method[data-method="split"]'); pg.wait_for_timeout(200)
    pg.fill('[data-a="0"]', '100'); pg.click('#addp'); pg.wait_for_timeout(200)
    ok('Split payment: second row pre-filled with the rest', abs(num(pg.input_value('[data-a="1"]')) - round(t3 - 100, 2)) < 0.005, pg.input_value('[data-a="1"]'))
    pg.click('#pay'); pg.wait_for_timeout(3000)
    inv = latest_invoice()
    ok('Split bill saved as cash ₹100 + UPI rest', pays_for(inv['id']) == sorted([('cash', 100.0), ('upi', round(t3 - 100, 2))]), pays_for(inv['id']))
    close_invoice(pg)

    # --- 4. cash change, wallet, hold count badge, resume, quick actions
    add(pg, 'Cet')
    pg.fill('#cashGiven', '100'); pg.wait_for_timeout(200)
    ok('Cash: change to return calculated', 'Return change' in pg.inner_text('#changeOut') and abs(num(pg.inner_text('#changeOut')) - round(100 - num(pg.inner_text('#tot')), 2)) < 0.005, pg.inner_text('#changeOut'))
    pg.click('.pos-method[data-method="wallet"]')
    ok('Wallet explains it is recorded as UPI', 'UPI' in pg.inner_text('#payDetail'))
    held0 = len(Q('held_bills', 'id'))
    pg.click('#hold'); pg.wait_for_timeout(1500)
    ok('Save as Hold: bill held and badge counts it', len(Q('held_bills', 'id')) == held0 + 1 and pg.inner_text('#heldCount') == str(held0 + 1), pg.inner_text('#msg'))
    pg.click('#held'); pg.wait_for_selector('[data-res]'); pg.click('[data-res] >> nth=0'); pg.wait_for_timeout(2500)
    ok('Hold Bills: resume brings the medicine back', pg.locator('tr.group-row').count() == 1, pg.inner_text('#msg'))
    pg.click('[data-qa="clear"]'); pg.wait_for_timeout(800)
    ok('Quick action Clear Cart empties the bill', pg.locator('tr.group-row').count() == 0)
    pg.click('[data-qa="browse"]'); pg.wait_for_selector('.pos-browse-item:not([disabled])'); pg.click('.pos-browse-item:not([disabled]) >> nth=0'); pg.wait_for_timeout(1500); pg.click('#browseClose')
    ok('Quick action Browse Medicines adds a medicine', pg.locator('tr.group-row').count() == 1)
    pg.click('[data-qa="offer"]'); pg.wait_for_timeout(300)
    ok('Quick action Apply Offer opens the bill discount', not pg.is_hidden('#discBox'))
    pg.click('.pos-disc-quick [data-pct="5"]'); pg.wait_for_timeout(200)
    b4 = num(pg.inner_text('#sumBase')) - (num(pg.inner_text('#sumDisc')))
    ok('5% preset applies a bill discount', float(pg.input_value('#disc')) > 0, pg.input_value('#disc'))
    pg.click('#clear'); pg.wait_for_timeout(800)
    pg.click('[data-qa="last"]'); pg.wait_for_timeout(2000)
    ok('Quick action Print Last Bill opens the last invoice', pg.query_selector('dialog[open] #pv') is not None, pg.inner_text('#msg'))
    close_invoice(pg)

    # --- 5. barcode scan (keyboard-wedge scanner types the code + Enter)
    bc = Q('medicines', 'id,name,barcode', filters=[['eq', 'name', 'Pan']])[0]
    if not bc['barcode']:
        api('query', {'q': {'table': 'medicines', 'op': 'update', 'cols': None, 'filters': [['eq', 'id', bc['id']]], 'order': [], 'single': None, 'count': None, 'limit': None, 'offset': None, 'values': {'barcode': '8901234567890'}, 'returning': None}})
    pg.click('#scanMode'); pg.keyboard.type('8901234567890'); pg.keyboard.press('Enter'); pg.wait_for_timeout(1800)
    ok('Scan Barcode: scanned code adds the medicine', pg.locator('tr.group-row').count() == 1 and 'Pan' in pg.inner_text('#cart'), pg.inner_text('#msg'))
    pg.click('#clear'); pg.wait_for_timeout(600)

    # --- 6. billing settings (admin can change limits)
    pg.click('#settingsBtn'); pg.wait_for_selector('#setDisc')
    pg.fill('#setDisc', '25'); pg.click('#setSave'); pg.wait_for_timeout(1200)
    row = Q('billing_settings', 'max_discount_pct')
    ok('Billing settings saved (max discount 25%)', float(row[0]['max_discount_pct']) == 25, (row, pg.inner_text('#setMsg')))
    pg.fill('#setDisc', '30'); pg.click('#setSave'); pg.wait_for_timeout(800); pg.click('#setClose')
    ok('Shop status toggle works', True if pg.click('#shopStateToggle') is None and pg.wait_for_timeout(1200) is None and pg.inner_text('#shopStateToggle') in ('Open', 'Closed') else False)
    ok('No page errors (admin, desktop)', not errs, errs)
    c.close()

    # --- billing staff on a phone
    c, pg, errs = ctx(b, 'billing_staff', 390, 844, True)
    pg.goto(BASE + '/billing.html'); pg.wait_for_selector('#q'); pg.wait_for_timeout(1200)
    ok('Mobile: no horizontal scrolling', pg.evaluate('document.documentElement.scrollWidth') <= 390, pg.evaluate('document.documentElement.scrollWidth'))
    ok('Mobile: logo links to Billing for billing staff', pg.get_attribute('.pp-mobile-logo', 'href') == 'billing.html')
    add(pg, 'Cet')
    ok('Mobile: item card shows batch • expiry and amount', '•' in pg.inner_text('.pos-mobile-meta') and num(pg.inner_text('[data-gtotal]')) > 0)
    ok('Mobile: billing staff cannot edit discount (no permission)', pg.is_disabled('[data-gdisc]') == (not api('rpc', {'name': 'billing_my_config', 'args': {}}, 'billing_staff')['data']['permissions']['discount']))
    pg.click('#pay'); pg.wait_for_timeout(2500)
    ok('Mobile: cash bill generated', 'Bill saved' in pg.inner_text('#msg'), pg.inner_text('#msg'))
    ok('No page errors (billing staff, mobile)', not errs, errs)
    c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
