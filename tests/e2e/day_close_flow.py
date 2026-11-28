# Version 80: bold 80 mm bills with logo / GSTIN / drug licence / thank-you / QR from Settings,
# "All Bills for Today", daily closing balance (one per day), return bills, automatic purchase order numbers.
import json, re, os, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'billing_staff': '0c000000-0000-0000-0000-000000000002',
     'inventory_staff': '0c000000-0000-0000-0000-000000000003', 'pharmacist': '0c000000-0000-0000-0000-000000000004'}
TODAY = datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Kolkata')).strftime('%Y-%m-%d')
JSPDF = '/tmp/jspdf.esm.js'
def api(kind, body, user='super_admin'):
    r = urllib.request.Request(BASE + '/api/' + kind, data=json.dumps({'user': U[user], **body}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
def RR(name, args=None, user='super_admin'): return api('rpc', {'name': name, 'args': args or {}}, user)
def R(name, args=None, user='super_admin'): return RR(name, args, user).get('data')
def Q(t, cols, user='super_admin', **k): return api('query', {'q': dict({'table': t, 'op': 'select', 'cols': cols, 'filters': [], 'order': [], 'single': None, 'count': None, 'limit': None, 'offset': None, 'values': None, 'returning': None}, **k)}, user)['data']
def SQL(sql, params=None): return api('ownersql', {'sql': sql, 'params': params or []}).get('data')
P = F = 0
def ok(n, c, x=''):
    global P, F
    P += bool(c); F += not c
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else '  → ' + str(x)[:400]))

def sell(med, qty, cart, method='cash', user='super_admin'):
    mid = Q('medicines', 'id,name', filters=[['eq', 'name', med]])[0]['id']
    a = R('billing_allocate', {'p_cart': cart, 'p_medicine': mid, 'p_qty': qty}, user)
    tot = round(sum(R('billing_calc_line', {'p_mrp': r['mrp'], 'p_qty': r['qty'], 'p_discount_pct': r['default_discount_pct'], 'p_gst_pct': r['tax_rate'], 'p_price_includes_tax': r['price_includes_tax']}, user)[0]['total_amount'] for r in a['rows']), 2)
    return R('finalize_sale_v3', {'p_customer': None, 'p_items': [{'batch_id': r['batch_id'], 'qty': r['qty']} for r in a['rows']], 'p_payments': [{'method': method, 'amount': tot}], 'p_discount': 0, 'p_cart': cart, 'p_expected_total': None, 'p_patient': {}}, user)

def ctx(b, who, w=1440, h=1000):
    c = b.new_context(viewport={'width': w, 'height': h}, accept_downloads=True)
    if os.path.exists(JSPDF): c.route(re.compile(r'https://cdn\.jsdelivr\.net/npm/jspdf.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body=open(JSPDF).read()))
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/npm/(?!jspdf).*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    init = "window.__printed=0;const _ap=Node.prototype.appendChild;Node.prototype.appendChild=function(n){const r=_ap.call(this,n);if(n&&n.tagName==='IFRAME'){try{n.contentWindow.print=()=>{window.__printed++;window.__printHTML=n.contentDocument.body.innerHTML;};}catch(e){}}return r;};"
    init += f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));"
    c.add_init_script(init)
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    return c, pg, errs
def printed(pg, n, t=4000):
    try: pg.wait_for_function(f'window.__printed >= {n}', timeout=t)
    except Exception: pass
    return pg.evaluate('window.__printHTML') or ''

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])

    # ------------------------------------------------ Settings → Print & Invoice
    c, pg, errs = ctx(b, 'super_admin')
    pg.goto(BASE + '/settings.html#invoice'); pg.wait_for_selector('#iPrev'); pg.wait_for_timeout(1200)
    ok('Settings: GSTIN, drug licence, thank-you note and QR fields', all(pg.is_visible(x) for x in ('#iGstin', '#iDlNos', '#iFooter', '#iQrMode')))
    ok('Preview: logo, bold 80 mm text, default thank-you note and WhatsApp QR', pg.locator('#iPrev img.lg').count() == 1 and 'logo-print.png' in pg.get_attribute('#iPrev img.lg', 'src') and pg.locator('#iPrev .qr svg').count() == 1 and 'Thank you' in pg.inner_text('#iPrev') and 'Scan to order on WhatsApp' in pg.inner_text('#iPrev'), pg.inner_text('#iPrev')[:300])
    pg.fill('#iGstin', ''); pg.fill('#iDlNos', 'KL-MPM-20B-1111\nKL-MPM-21B-2222'); pg.fill('#iFooter', 'Thank you! Visit again — Pallikkal Pharmacy'); pg.wait_for_timeout(300)
    pv = pg.inner_text('#iPrev')
    ok('Preview follows the form: no GSTIN, both licence numbers, new thank-you note', 'GSTIN' not in pv and 'KL-MPM-20B-1111, KL-MPM-21B-2222' in pv and 'Visit again' in pv, pv[:400])
    pg.fill('#iGstin', '32ABC'); pg.click('.sg-panel-acts [data-act="save"]'); pg.wait_for_timeout(1200)
    ok('Wrong GSTIN refused', 'GSTIN looks wrong' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    pg.fill('#iGstin', '')
    pg.select_option('#iQrMode', 'link'); pg.wait_for_timeout(200)
    ok('QR link box shown for "A link of my choice"', pg.is_visible('#iQrLink') and not pg.is_visible('#iQrPhone'))
    pg.fill('#iQrLink', 'https://g.page/r/pallikkal-review'); pg.fill('#iQrCap', 'Rate us on Google'); pg.wait_for_timeout(200)
    ok('Preview QR caption follows', 'Rate us on Google' in pg.inner_text('#iPrev'))
    pg.click('.sg-panel-acts [data-act="save"]'); pg.wait_for_timeout(1500)
    br = SQL("select gstin, drug_licence_nos, invoice_footer from branches where id='0b000000-0000-0000-0000-000000000001'")[0]
    iv = SQL("select value from pharmacy_settings where key='invoice'")[0]['value']
    ok('Saved: GSTIN empty, 2 licence numbers, thank-you note on the branch', br['gstin'] is None and br['drug_licence_nos'] == ['KL-MPM-20B-1111', 'KL-MPM-21B-2222'] and 'Visit again' in br['invoice_footer'], br)
    ok('Saved: QR link and caption', iv.get('qr_mode') == 'link' and iv.get('qr_link') == 'https://g.page/r/pallikkal-review' and iv.get('qr_caption') == 'Rate us on Google', iv)
    ok('No page errors (settings)', not errs, errs); c.close()

    # ------------------------------------------------ Billing: bill print uses the settings
    c, pg, errs = ctx(b, 'billing_staff')
    pg.goto(BASE + '/billing.html'); pg.wait_for_selector('#q'); pg.wait_for_timeout(1200)
    ok('Billing: All Bills for Today and Close Day buttons', pg.is_visible('#allBillsBtn') and pg.is_visible('#dayCloseBtn') and pg.locator('[data-qa="allbills"]').count() == 1)
    for t in ('Dolo', 'Pan'):
        pg.fill('#q', t); pg.wait_for_selector('.medicine-result'); pg.click('.medicine-result'); pg.wait_for_timeout(1300)
    pg.click('#pay'); pg.wait_for_selector('dialog[open] #pv .ppb'); pg.wait_for_timeout(600)
    pv = pg.inner_text('dialog[open] #pv'); css = pg.inner_html('dialog[open] #pv')
    ok('80 mm bill: logo image, bold (700) black text, dashed rules', pg.locator('dialog[open] #pv img.lg').count() == 1 and 'font:700 12.5px' in css and 'dashed #000' in css)
    ok('80 mm bill: drug licence numbers, no GSTIN line, INVOICE title', re.search(r'D\.L\. No: KL-MPM-20B-1111(, | / )KL-MPM-21B-2222', pv) and 'GSTIN' not in pv and 'INVOICE' in pv, pv[:300])
    ok('80 mm bill: thank-you note and QR with caption at the bottom', 'Visit again' in pv and pg.locator('dialog[open] #pv .qr svg path').count() == 1 and 'Rate us on Google' in pv)
    pg.click('dialog[open] #pr'); html = printed(pg, 1)
    ok('Print sends the 72 mm bold bill with the logo and QR', '72mm' in html and 'logo-print.png' in html and '<svg' in html, html[:200])
    if os.path.exists(JSPDF):
        with pg.expect_download() as dl: pg.click('dialog[open] #pd')
        ok('PDF download still works (bold thermal, logo, QR)', dl.value.suggested_filename.endswith('-thermal.pdf'))
    pg.click('dialog[open] #cl'); pg.wait_for_timeout(300)

    # more bills today (cash + UPI), one by another staff
    sell('Dolo', 2, '66666666-0000-0000-0000-0000000000b1', 'cash')
    sell('Pan', 1, '66666666-0000-0000-0000-0000000000b2', 'upi', 'pharmacist')
    day = R('invoices_for_day', {'p_date': TODAY}, 'billing_staff')
    allno = [x['invoice']['invoice_no'] for x in day]
    final = SQL("select count(*)::int n from sales_invoices where status='final' and (created_at at time zone 'Asia/Kolkata')::date = $1::date", [TODAY])[0]['n']
    ok(f'invoices_for_day returns every final bill of today ({final}), oldest first', len(day) == final and allno == sorted(allno), (len(day), final))
    ok('invoices_for_day refuses a future day', 'earlier day' in str(RR('invoices_for_day', {'p_date': '2099-01-01'}).get('error')))

    # ------------------------------------------------ All Bills for Today (staff)
    pg.click('#allBillsBtn'); pg.wait_for_selector('#abPv .ppb'); pg.wait_for_timeout(500)
    ok(f'All Bills: "{final} bills" and every bill number in the preview', f'{final} bill' in pg.inner_text('#abMsg') and all(n in pg.inner_text('#abPv') for n in allno), pg.inner_text('#abMsg'))
    ok('All Bills: logo once, "BILL 1 OF n" separators', pg.locator('#abPv img.lg').count() == 1 and f'BILL 1 OF {final}' in pg.inner_text('#abPv'))
    ok('Staff: no day-summary option (no income totals)', pg.locator('#abSum').count() == 0 and 'TOTAL SALES' not in pg.inner_text('#abPv'))
    pg.click('#abPrint'); html = printed(pg, 2)
    ok('Print all bills: one 72 mm document with all bills', '72mm' in html and all(n in html for n in allno), html[:200])
    pg.select_option('#abLayout', 'list'); pg.wait_for_timeout(300)
    ok('Short list: one row per bill', pg.locator('#abPv table tr').count() == final + 1)
    pg.click('.dc-dlg[open] [data-dc-close]'); pg.wait_for_timeout(300)

    # ------------------------------------------------ Close Day (staff) — one per day
    pg.click('#dayCloseBtn'); pg.wait_for_selector('#cbAmt')
    ok('Staff Close Day: no expected-cash figures shown', 'Expected in drawer' not in pg.inner_text('.dc-dlg[open]'))
    pg.click('#cbSave'); pg.wait_for_timeout(300)
    ok('Amount required', 'Enter the cash counted' in pg.inner_text('#cbMsg'))
    pg.fill('#cbAmt', '2450.50'); pg.fill('#cbNote', 'Rs 2000 kept in safe'); pg.click('#cbSave'); pg.wait_for_selector('.dc-done', timeout=5000)
    cl = SQL("select amount::float a, note, expected::float e from daily_cash_closings where closing_date=$1::date", [TODAY])
    ok('Closing balance saved once for today with note', len(cl) == 1 and cl[0]['a'] == 2450.5 and 'safe' in cl[0]['note'], cl)
    ok('Dialog shows it is recorded', '2,450.50' in pg.inner_text('.dc-done'))
    r2 = RR('record_daily_cash_closing', {'p_closing_date': TODAY, 'p_amount': 100, 'p_note': None}, 'pharmacist')
    ok('Second closing the same day refused (only one per day)', 'already recorded' in str(r2.get('error')), r2)
    ok('Staff cannot correct it', 'Only Admin' in str(RR('correct_daily_cash_closing', {'p_closing_date': TODAY, 'p_amount': 1, 'p_reason': 'test'}, 'billing_staff').get('error')))
    ok('Staff cannot read the closing history', RR('cash_closing_list', {'p_from': TODAY, 'p_to': TODAY}, 'billing_staff').get('error') is not None)
    ok('Future day refused', 'today or an earlier' in str(RR('record_daily_cash_closing', {'p_closing_date': '2099-01-01', 'p_amount': 1}, 'super_admin').get('error')))
    g = R('get_daily_cash_closing', {'p_closing_date': TODAY}, 'billing_staff')
    ok('Staff view has no expected / difference', g and g.get('expected') is None and g.get('difference') is None, g)
    pg.click('.dc-dlg[open] [data-dc-close]')
    ok('No page errors (billing staff)', not errs, errs); c.close()

    # ------------------------------------------------ Admin: day summary, closing in Finance
    c, pg, errs = ctx(b, 'super_admin')
    pg.goto(BASE + '/sales.html'); pg.wait_for_selector('#allBillsBtn'); pg.wait_for_timeout(1200)
    pg.click('#allBillsBtn'); pg.wait_for_selector('#abPv .ppb'); pg.wait_for_timeout(400)
    tot = SQL("select coalesce(sum(total),0)::float t from sales_invoices where status='final' and (created_at at time zone 'Asia/Kolkata')::date = $1::date", [TODAY])[0]['t']
    ok(f'Sales page: All Bills with admin day summary (total ₹{tot:,.2f})', 'DAY SUMMARY' in pg.inner_text('#abPv') and f'{tot:,.2f}' in pg.inner_text('#abPv'), pg.inner_text('#abPv')[-300:])
    pg.click('.dc-dlg[open] [data-dc-close]')
    a = R('get_daily_cash_closing', {'p_closing_date': TODAY})
    cb = R('cash_book', {'p_from': TODAY, 'p_to': TODAY})[0]
    ok('Admin sees expected cash = cash book expected closing, and the difference', a['expected'] is not None and abs(float(a['expected']) - float(cb['expected_close'])) < 0.01 and abs(float(a['difference']) - (2450.5 - float(cb['expected_close']))) < 0.01, (a, cb['expected_close']))
    pg.goto(BASE + '/finance.html'); pg.wait_for_selector('#tabs'); pg.wait_for_timeout(1200)
    pg.click('#tabs [data-k="ob"]'); pg.wait_for_selector('#clRows tr'); pg.wait_for_timeout(1200)
    ok('Finance tab is "Opening & closing" with the closing table', 'Opening & closing' in pg.inner_text('#tabs') and '2,450.50' in pg.inner_text('#clRows') and "Today's closing recorded" in pg.inner_text('#closeToday'), pg.inner_text('#clRows')[:300])
    pg.click(f'#clRows tr[data-cl="{TODAY}"]'); pg.wait_for_selector('#cbFix')
    pg.fill('#cbFix', '2500'); pg.fill('#cbWhy', 'Recounted the drawer'); pg.click('#cbFixGo'); pg.wait_for_timeout(1500)
    cl = SQL("select amount::float a, correction_reason r from daily_cash_closings where closing_date=$1::date", [TODAY])[0]
    ok('Admin corrects the closing with a reason (audited)', cl['a'] == 2500 and cl['r'] == 'Recounted the drawer' and SQL("select count(*)::int n from audit_logs where action='daily_cash_closing_corrected'")[0]['n'] == 1, cl)
    pg.click('.dc-dlg[open] [data-dc-close]'); pg.wait_for_timeout(800)
    ok('Finance table shows the corrected amount', '2,500.00' in pg.inner_text('#clRows') and 'corrected' in pg.inner_text('#clRows'))
    ok('No page errors (admin)', not errs, errs)

    # ------------------------------------------------ Purchases: automatic purchase order number
    before = SQL("select coalesce(max(purchase_no),0)::int m, count(*)::int n, count(purchase_no)::int k from purchase_invoices")[0]
    ok('Existing purchases numbered 1..n', before['m'] == before['n'] == before['k'], before)
    pg.goto(BASE + '/purchases.html'); pg.wait_for_selector('#purchaseRows tr[data-kind]'); pg.wait_for_timeout(1200)
    ok('Purchase list shows "PO No."', 'PO No. 1' in pg.inner_text('#purchaseRows'))
    pg.click('#newPurchase'); pg.wait_for_selector('#purchaseDialog[open]'); pg.wait_for_timeout(800)
    ok(f'New purchase form shows the next number ({before["m"] + 1}) automatically, read-only', pg.input_value('#poAuto') == f'{before["m"] + 1} (automatic)' and pg.get_attribute('#poAuto', 'readonly') is not None, pg.input_value('#poAuto'))
    pg.fill('#supplierName', 'Malabar Medicals'); pg.fill('#invoiceNo', 'MM-P80')
    r = '#itemRows tr:nth-child(1) '
    pg.fill(r + '.med-name', 'Pan 40 mg'); pg.dispatch_event(r + '.med-name', 'change'); pg.wait_for_timeout(1000)
    pg.fill(r + '.pack', '10'); pg.fill(r + '.batch', 'PN-80'); pg.fill(r + '.expiry', '2028-06-30'); pg.fill(r + '.qty', '2'); pg.fill(r + '.mrp', '150'); pg.fill(r + '.rate', '100')
    pg.click('#confirmPurchase'); pg.wait_for_selector('#confirmDialog[open]')
    ok('Confirm shows the purchase order no.', str(before['m'] + 1) in pg.inner_text('#confirmSummary'))
    pg.click('#postNow'); pg.wait_for_timeout(2500)
    pn = SQL("select purchase_no from purchase_invoices where supplier_invoice_no='MM-P80'")[0]['purchase_no']
    ok(f'Posted bill got purchase order no. {before["m"] + 1}', pn == before['m'] + 1, pn)
    ok('Message and detail show it', f'Purchase order no. {pn}' in pg.inner_text('#pageMsg') and f'PO No. {pn}' in pg.inner_text('#viewTitle'), pg.inner_text('#pageMsg'))
    SQL("update purchase_invoices set purchase_no = 999 where supplier_invoice_no='MM-P80'")
    ok('The number cannot be changed afterwards', SQL("select purchase_no from purchase_invoices where supplier_invoice_no='MM-P80'")[0]['purchase_no'] == pn)
    ok('No page errors (purchases)', not errs, errs); c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
