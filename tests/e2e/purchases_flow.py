# Purchases page: every figure and control, checked against the database.
import json, re, os, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'billing_staff': '0c000000-0000-0000-0000-000000000002', 'inventory_staff': '0c000000-0000-0000-0000-000000000003', 'pharmacist': '0c000000-0000-0000-0000-000000000004'}
IST = zoneinfo.ZoneInfo('Asia/Kolkata')
TODAY = datetime.datetime.now(IST).strftime('%Y-%m-%d')
def api(kind, body, user='super_admin'):
    r = urllib.request.Request(BASE + '/api/' + kind, data=json.dumps({'user': U[user], **body}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
def R(name, args=None, user='super_admin'): return api('rpc', {'name': name, 'args': args or {}}, user)
def Q(t, cols, user='super_admin', **k): return api('query', {'q': dict({'table': t, 'op': 'select', 'cols': cols, 'filters': [], 'order': [], 'single': None, 'count': None, 'limit': None, 'offset': None, 'values': None, 'returning': None}, **k)}, user)['data']
P = F = 0
def ok(n, c, x=''):
    global P, F
    P += bool(c); F += not c
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else '  → ' + str(x)[:400]))
num = lambda s: float(re.sub(r'[^0-9.\-]', '', s) or 0)
def bills(user='super_admin'): return R('purchase_list_v2', {'p_from': None, 'p_to': None, 'p_limit': 5000}, user)['data']
def orders(): return R('purchase_order_list', {'p_limit': 500})['data']
def bill(no): return next((b for b in bills() if b['supplier_invoice_no'] == no), None)

def ctx(b, who, w=1536, h=1000, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    c.add_init_script(f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));")
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return c, pg, errs
def open_page(pg, q=''):
    pg.goto(BASE + '/purchases.html' + q); pg.wait_for_selector('#purchaseRows tr[data-kind]'); pg.wait_for_timeout(1000)
def fill_row(pg, n, med, batch, exp, qty, mrp, rate, pack=None):
    r = f'#itemRows tr:nth-child({n}) '
    if med is not None:
        pg.fill(r + '.med-name', med); pg.dispatch_event(r + '.med-name', 'change'); pg.wait_for_timeout(1000)
    if pack is not None: pg.fill(r + '.pack', str(pack))
    pg.fill(r + '.batch', batch); pg.fill(r + '.expiry', exp); pg.fill(r + '.qty', str(qty)); pg.fill(r + '.mrp', str(mrp)); pg.fill(r + '.rate', str(rate))
def post(pg):
    pg.click('#confirmPurchase'); pg.wait_for_selector('#confirmDialog[open]', timeout=4000); pg.click('#postNow'); pg.wait_for_timeout(2500)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    c, pg, errs = ctx(b, 'super_admin')
    answers = []
    pg.on('dialog', lambda d: d.accept(answers.pop(0) if answers else 'Test reason') if d.type == 'prompt' else d.accept())
    open_page(pg)
    ok('Layout: branded sidebar with Purchases active, no footer block', 'active' in pg.get_attribute('.pp-nav-link[href="purchases.html"]', 'class') and 'Trusted' not in pg.inner_text('#ppSidebar'))
    ok('Header: title and New Purchase / Purchase Return / Import / Export', 'Purchases Management' in pg.inner_text('.pos-head') and all(pg.is_visible(x) for x in ('#newPurchase', '#returnBtn', '#importBtn', '#exportBtn')))
    B = bills(); month = TODAY[:8] + '01'
    cur = [x for x in B if x['status'] != 'cancelled' and x['invoice_date'] >= month]
    ok(f"Total Purchases KPI = this month's bills ₹{sum(float(x['total']) for x in cur):.0f}", abs(num(pg.inner_text('#kTotal')) - round(sum(float(x['total']) for x in cur))) <= 1, pg.inner_text('#kTotal'))
    ok(f'Purchase Orders KPI = {len(cur)} bills this month', num(pg.inner_text('#kOrders')) == len(cur))
    ok('Items Purchased KPI = packs received this month', num(pg.inner_text('#kItems')) == sum(float(x['pack_qty']) for x in cur), pg.inner_text('#kItems'))
    act = [d for d in Q('distributors', 'id,active') if d['active']]
    ok(f'Active Distributors KPI = {len(act)}', num(pg.inner_text('#kDists')) == len(act))
    ok('List shows the posted bill with amount, items and Received status', 'KPD-1001' in pg.inner_text('#purchaseRows') and 'Received' in pg.inner_text('#purchaseRows') and '6' in pg.inner_text('#purchaseRows tr[data-kind="bill"] .c-items'))
    ok('Trend chart and top distributors render', pg.locator('#chart svg').count() == 1 and pg.locator('#topRows tr[data-dist]').count() >= 1)
    ok('Purchase Summary tiles', pg.locator('#sumTiles > div').count() == 4 and 'Avg. Order Value' in pg.inner_text('#sumTiles'))

    # --- new bill with part payment (admin)
    pg.click('#newPurchase'); pg.wait_for_selector('#purchaseDialog[open]')
    pg.fill('#supplierName', 'Mala'); pg.wait_for_timeout(300)
    ok('Typing the distributor name shows suggestions (not a drop-down)', pg.locator('.sg-box button', has_text='Malabar Medicals').count() == 1 and pg.locator('select#supplier').count() == 0)
    pg.locator('.sg-box button', has_text='Malabar Medicals').click(); pg.wait_for_timeout(200)
    ok('Picking a suggestion selects the distributor', pg.input_value('#supplier') != '' and 'Malabar' in pg.inner_text('#supCard'))
    pg.fill('#invoiceNo', 'MM-501')
    ok('HSN column removed from bill lines', pg.locator('#itemRows .hsn').count() == 0 and 'HSN' not in pg.inner_text('#itemTable thead'))
    ok('GST is a typed number box', pg.locator('#itemRows tr:nth-child(1) input.gst[type=number]').count() == 1)
    pg.fill('#itemRows tr:nth-child(1) .med-name', 'Pan'); pg.wait_for_timeout(700)
    ok('Medicine name shows type-ahead suggestions', pg.locator('.sg-box:not([hidden]) button', has_text='Pan 40').count() >= 1)
    fill_row(pg, 1, 'Pan 40 mg', 'PN-77', '2028-03-31', 4, 2250, 1200, pack=15)
    pg.fill('#amountPaid', '1000')
    post(pg)
    mm = bill('MM-501')
    ok('New Purchase: posted with ₹1,000 paid', mm and float(mm['paid']) == 1000 and float(mm['total']) > 1000, mm)
    ok('New Purchase: detail opens after posting', pg.is_visible('#viewDialog') and 'PN-77' in pg.inner_text('#viewContent'))
    pg.click('#closeView'); pg.wait_for_timeout(300)
    row = pg.locator('#purchaseRows tr[data-kind="bill"]', has_text='MM-501')
    ok('List: new bill shows Due balance', 'Due' in row.inner_text(), row.inner_text())

    # --- multi-item bill exactly like a printed supplier invoice
    pg.click('#newPurchase'); pg.wait_for_selector('#purchaseDialog[open]')
    pg.click('#newDistBtn'); pg.wait_for_selector('#ndName')
    pg.fill('#ndName', 'Bismik Medical Agencies'); pg.fill('#ndPhone', '04837181000'); pg.fill('#ndGst', '32AACFB8381R1ZZ'); pg.fill('#ndDl', 'WLF20B2023KL001290'); pg.fill('#ndAddr', 'Thoppil Hamzath Road, Kottakkal')
    pg.click('#ndSave'); pg.wait_for_timeout(1200)
    bis = next((d for d in Q('distributors', 'id,name,gstin,drug_licence') if d['name'] == 'Bismik Medical Agencies'), None)
    ok('New distributor added from the bill form and selected', bis and bis['gstin'] == '32AACFB8381R1ZZ' and pg.input_value('#supplier') == bis['id'], bis)
    ok('Supplier card shows GSTIN and drug licence', '32AACFB8381R1ZZ' in pg.inner_text('#supCard') and 'WLF20B2023KL001290' in pg.inner_text('#supCard'))
    pg.fill('#invoiceNo', '26000730094079'); pg.click('#creditDays [data-days="30"]')
    import datetime as _d
    ok('Due-date chip: invoice date + 30 days', pg.input_value('#dueDate') == (_d.date.fromisoformat(pg.input_value('#invoiceDate')) + _d.timedelta(days=30)).isoformat())
    def line(n, med, pack, batch, exp, qty, free, mrp, rate, pct, gst):
        r = f'#itemRows tr:nth-child({n}) '
        pg.fill(r + '.med-name', med); pg.dispatch_event(r + '.med-name', 'change'); pg.wait_for_timeout(900)
        pg.fill(r + '.pack', str(pack)); pg.fill(r + '.batch', batch); pg.fill(r + '.expiry', exp); pg.dispatch_event(r + '.expiry', 'change')
        pg.fill(r + '.qty', str(qty)); pg.fill(r + '.free', str(free)); pg.fill(r + '.mrp', str(mrp)); pg.fill(r + '.rate', str(rate)); pg.fill(r + '.disc', f'{pct}%'); pg.fill(r + '.gst', str(gst))
    line(1, 'Dolo 650 mg', 120, 'TMD26267', '06/28', 2, 0, 132.87, 101.23, 3, 5)
    ok('Line math as on the bill: 2 × 101.23 less 3% = 196.39 taxable, 206.21 with 5% GST', pg.inner_text('#itemRows tr:nth-child(1) .line-taxable') == '₹196.39' and pg.inner_text('#itemRows tr:nth-child(1) .line-total') == '₹206.21', [pg.inner_text('#itemRows tr:nth-child(1) .line-taxable'), pg.inner_text('#itemRows tr:nth-child(1) .line-total')])
    ok('Expiry 06/28 read as 30 Jun 2028', '30 Jun 2028' in pg.inner_text('#itemRows tr:nth-child(1) .pb-exp'))
    pg.focus('#itemRows tr:nth-child(1) .gst'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
    ok('Enter on the last box adds a new line and focuses it', pg.locator('#itemRows tr').count() == 2 and pg.evaluate("document.activeElement.classList.contains('med-name')"))
    line(2, 'Azithral 500 mg', 15, 'SPH261247', '01/29', 4, 0, 174.45, 132.91, 3, 5)
    pg.click('#addItem2'); line(3, 'Cetirizine 10 mg', 15, 'LST2607', '05/28', 6, 1, 58.12, 44.28, 3, 12)
    pg.click('#itemRows tr:nth-child(3) .dup-line'); pg.wait_for_timeout(300)
    ok('Duplicate line copies medicine, pack, MRP and rate for another batch', pg.locator('#itemRows tr').count() == 4 and pg.input_value('#itemRows tr:nth-child(4) .med-name') == 'Cetirizine 10 mg' and pg.input_value('#itemRows tr:nth-child(4) .rate') == '44.28' and pg.input_value('#itemRows tr:nth-child(4) .batch') == '')
    pg.fill('#itemRows tr:nth-child(4) .batch', 'LST2608'); pg.fill('#itemRows tr:nth-child(4) .expiry', '12/2027'); pg.fill('#itemRows tr:nth-child(4) .qty', '2'); pg.fill('#itemRows tr:nth-child(4) .disc', '5'); pg.wait_for_timeout(200)
    ok('Discount "5" (no %) is a fixed ₹5 on the line', '₹5.00' in pg.inner_text('#itemRows tr:nth-child(4) .pb-disc-hint'), pg.inner_text('#itemRows tr:nth-child(4) .pb-disc-hint'))
    pg.fill('#itemRows tr:nth-child(4) .disc', 'abc'); pg.wait_for_timeout(100)
    ok('Invalid discount text is flagged', 'Use 3% or 10' in pg.inner_text('#itemRows tr:nth-child(4) .pb-disc-hint'))
    pg.fill('#itemRows tr:nth-child(4) .disc', '5'); pg.fill('#itemRows tr:nth-child(4) .gst', '0'); pg.wait_for_timeout(200)
    gst = pg.inner_text('#gstSummary')
    ok('GST summary groups 0%, 5% and 12% lines', '0%' in gst and '5%' in gst and '12%' in gst, gst)
    ok('Item counter and footer show 4 items', '4 items' in pg.inner_text('#itemCount') and '4 items' in pg.inner_text('#pbSumItems'))
    pg.click('#autoRound'); pg.wait_for_timeout(200)
    net = num(pg.inner_text('#sumTotal'))
    ok('Auto round-off makes a whole-rupee net amount', abs(net - round(net)) < 0.001, net)
    pg.fill('#printedTotal', str(int(round(net)))); pg.wait_for_timeout(200)
    ok('Net amount on the bill cross-check matches', 'Matches' in pg.inner_text('#totalCompare'))
    pg.click('#saveDraft'); pg.wait_for_timeout(1200)
    dr = R('purchase_draft_list')['data']
    d0 = next((d for d in dr if d['supplier_invoice_no'] == '26000730094079'), None)
    ok('Draft keeps all 4 lines with cash-discount % and ISO expiry', d0 and len(d0['payload']['items']) == 4 and d0['payload']['items'][0]['disc_text'] == '3%' and d0['payload']['items'][0]['expiry'] == '2028-06-30', d0 and d0['payload']['items'][0])
    post(pg)
    bb = bill('26000730094079')
    ok('Posted: one purchase with 4 lines from the same supplier', bb and bb['line_count'] == 4 and bb['distributor'] == 'Bismik Medical Agencies', bb)
    ok('Posted total = net amount shown in the form', bb and abs(float(bb['total']) - round(net)) < 0.01, [bb and bb['total'], net])
    det = R('purchase_detail', {'p_invoice': bb['id']})['data']
    it = next(x for x in det['items'] if x['batch_no'] == 'TMD26267')
    ok('Line stored with 3% discount (net 196.39 ex GST) and month-end expiry', abs(float(it['line_net']) - 196.39) < 0.01 and it['expiry'] == '2028-06-30', it)
    ok('Expiry 12/2027 stored as 31 Dec 2027', next(x for x in det['items'] if x['batch_no'] == 'LST2608')['expiry'] == '2027-12-31')
    l4 = next(x for x in det['items'] if x['batch_no'] == 'LST2608')
    ok('Fixed ₹5 discount and 0% GST stored on the line', abs(float(l4['line_net']) - (2 * 44.28 - 5)) < 0.01 and float(l4['tax_rate']) == 0, l4)
    pg.click('#closeView'); pg.wait_for_timeout(300)
    # typed distributor that does not exist yet → created on posting
    pg.click('#newPurchase'); pg.wait_for_selector('#purchaseDialog[open]')
    pg.fill('#supplierName', 'Royal Distributor'); pg.wait_for_timeout(200)
    ok('Unknown typed distributor explained on the card', 'new distributor' in pg.inner_text('#supCard'))
    pg.fill('#invoiceNo', 'RD-1')
    fill_row(pg, 1, 'Pan 40 mg', 'PN-RD1', '2028-05-31', 1, 150, 100, pack=10)
    post(pg)
    rd = next((d for d in Q('distributors', 'id,name') if d['name'] == 'Royal Distributor'), None)
    ok('Typed new distributor auto-created and bill posted', rd is not None and bill('RD-1') and bill('RD-1')['distributor'] == 'Royal Distributor')
    pg.click('#closeView'); pg.wait_for_timeout(300)

    # --- purchase order via the New Purchase menu
    pg.click('#newMenuBtn'); pg.click('#newMenu [data-new="order"]'); pg.wait_for_selector('#ofDist')
    pg.select_option('#ofDist', label='Malabar Medicals'); pg.fill('#ofExp', TODAY)
    pg.fill('#ofRows tr:nth-child(1) .ol-med', 'Dolo 650 mg'); pg.dispatch_event('#ofRows tr:nth-child(1) .ol-med', 'change'); pg.wait_for_timeout(900)
    pg.fill('#ofRows tr:nth-child(1) .ol-pack', '10'); pg.fill('#ofRows tr:nth-child(1) .ol-qty', '5'); pg.fill('#ofRows tr:nth-child(1) .ol-rate', '20')
    pg.click('#ofAdd'); pg.fill('#ofRows tr:nth-child(2) .ol-med', 'Cetirizine 10 mg'); pg.dispatch_event('#ofRows tr:nth-child(2) .ol-med', 'change'); pg.wait_for_timeout(900)
    pg.fill('#ofRows tr:nth-child(2) .ol-qty', '3'); pg.wait_for_timeout(100)
    ok('Order form: estimated value', '₹100.00' in pg.inner_text('#ofTotal'), pg.inner_text('#ofTotal'))
    pg.click('#ofSave'); pg.wait_for_timeout(1500)
    O = orders(); o = O[0] if O else None
    ok('Purchase order saved: PO number, 2 lines, status ordered', o and o['po_no'].startswith('PO-') and o['line_count'] == 2 and o['status'] == 'ordered', o)
    ok('Order view opens after placing', pg.is_visible('#puDlg') and o['po_no'] in pg.inner_text('#puPanel'))
    pg.click('#puDlg [data-close]')
    pg.click('.pur-chips [data-tab="ordered"]'); pg.wait_for_timeout(300)
    ok('Ordered tab lists the order', pg.locator('#purchaseRows tr[data-kind="order"]').count() == 1 and num(pg.inner_text('#t_ordered')) == 1)
    pg.click('#purchaseRows tr[data-kind="order"] [data-menu]')
    ok('Order menu: receive, edit, print, WhatsApp, cancel', all(pg.locator(f'.pur-row-menu [data-act="{a}"]').count() for a in ('receive', 'editorder', 'printorder', 'shareorder', 'cancelorder')))
    pg.click('.pur-row-menu [data-act="printorder"]'); pg.wait_for_timeout(500)
    ok('Print order uses a hidden print frame', pg.locator('iframe').count() >= 1)

    # --- receive part of the order
    pg.click('#purchaseRows tr[data-kind="order"] [data-menu]'); pg.click('.pur-row-menu [data-act="receive"]'); pg.wait_for_selector('#purchaseDialog[open]')
    ok('Receive: bill form pre-filled from the order (supplier, 2 lines, qty, order banner)', pg.locator('#itemRows tr').count() == 2 and pg.input_value('#itemRows tr:nth-child(1) .qty') in ('5', '3') and pg.is_visible('#orderBanner') and pg.input_value('#orderNo') == o['po_no'])
    first = pg.input_value('#itemRows tr:nth-child(1) .med-name')
    keep = 1 if 'Dolo' in first else 2
    pg.locator('#itemRows tr').nth(2 - keep).locator('.remove-line').click()
    pg.fill('#invoiceNo', 'MM-502')
    fill_row(pg, 1, None, 'DO-9', '2028-01-31', 5, 300, 20)
    post(pg)
    O = orders(); o2 = next(x for x in O if x['id'] == o['id'])
    ok('Receive: order now partially received (5 of 8 packs)', o2['status'] == 'partial' and float(o2['received_qty']) == 5, o2)
    ok('Receive: bill linked to the order', (bill('MM-502') or {}).get('order_no') == o['po_no'])
    pg.click('#closeView'); pg.wait_for_timeout(200)
    pg.click('.pur-chips [data-tab="partial"]'); pg.wait_for_timeout(300)
    ok('Partial tab shows the order with received/ordered', pg.locator('#purchaseRows tr[data-kind="order"]').count() == 1 and '5/8' in pg.inner_text('#purchaseRows'))
    answers[:] = ['Rest not available']
    pg.click('#purchaseRows tr[data-kind="order"] [data-menu]'); pg.click('.pur-row-menu [data-act="cancelorder"]'); pg.wait_for_timeout(1200)
    ok('Close the partly received order', next(x for x in orders() if x['id'] == o['id'])['status'] == 'closed')
    pg.click('.pur-chips [data-tab="all"]'); pg.wait_for_timeout(300)

    # --- payment, return, attach, view
    row = pg.locator('#purchaseRows tr[data-kind="bill"]', has_text='MM-501')
    row.locator('[data-menu]').click(); pg.click('.pur-row-menu [data-act="pay"]'); pg.wait_for_selector('#payAmt')
    bal = float(mm['total']) - 1000
    ok('Payment dialog defaults to the balance', abs(float(pg.input_value('#payAmt')) - bal) < .01, pg.input_value('#payAmt'))
    pg.select_option('#payMode', 'upi'); pg.fill('#payRef', 'UTR123'); pg.click('#paySave'); pg.wait_for_timeout(1500)
    ok('Record payment: bill fully paid', abs(float(bill('MM-501')['paid']) - float(mm['total'])) < .01, bill('MM-501'))
    ok('List shows Paid', 'Paid' in pg.locator('#purchaseRows tr[data-kind="bill"]', has_text='MM-501').inner_text())
    pg.click('#returnBtn'); pg.fill('#rtQ', 'MM-501'); pg.wait_for_timeout(300); pg.click('#rtList [data-pick]'); pg.wait_for_selector('.rt-qty')
    pg.fill('.rt-qty', '1'); pg.fill('#rtWhy', 'Damaged strip'); pg.click('#rtSave'); pg.wait_for_timeout(1500)
    ok('Purchase Return: recorded and shown on the bill', float(bill('MM-501')['returned']) > 0, bill('MM-501'))
    row = pg.locator('#purchaseRows tr[data-kind="bill"]', has_text='MM-501')
    row.locator('[data-menu]').click()
    with pg.expect_file_chooser() as fc: pg.click('.pur-row-menu [data-act="attach"]')
    fc.value.set_files(files=[{'name': 'mm501.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-1.4 test'}]); pg.wait_for_timeout(2000)
    ok('Attach bill file to a posted purchase', bill('MM-501')['doc_count'] == 1)
    pg.locator('#purchaseRows tr[data-kind="bill"]', has_text='MM-501').locator('[data-view-row]').click(); pg.wait_for_timeout(1200)
    vt = pg.inner_text('#viewContent')
    ok('View: lines, payments, return, documents, balance', 'PN-77' in vt and 'UTR123' in vt and 'Returned to supplier' in vt and 'mm501.pdf' in vt, vt[:400])
    pg.click('#viewContent [data-vact="print"]'); pg.wait_for_timeout(500)
    pg.click('#closeView')

    # --- filters, search, export, import
    pg.fill('#searchPurchase', 'MM-50'); pg.wait_for_timeout(600)
    ok('Search by invoice number', pg.locator('#purchaseRows tr[data-kind]').count() == 2)
    pg.fill('#searchPurchase', ''); pg.wait_for_timeout(500)
    kp = next(d for d in Q('distributors', 'id,name') if d['name'] == 'Kerala Pharma Distributors')
    pg.select_option('#fDist', kp['id']); pg.wait_for_timeout(300)
    ok('Distributor filter', all('Kerala' in t for t in pg.locator('#purchaseRows .c-dist').all_inner_texts()))
    pg.select_option('#fDist', ''); pg.select_option('#fStatus', 'closed'); pg.wait_for_timeout(300)
    ok('Status filter: closed orders', pg.locator('#purchaseRows tr[data-kind="order"]').count() == 1 and 'Closed' in pg.inner_text('#purchaseRows'))
    pg.select_option('#fStatus', ''); pg.wait_for_timeout(300)
    pg.click('#filterBtn'); pg.check('#fUnpaid'); pg.click('#applyFilters'); pg.wait_for_timeout(300)
    unpaid = [x for x in bills() if float(x['total']) - float(x['paid']) - float(x['returned']) > .005]
    ok(f'Filter: only bills with balance ({len(unpaid)})', pg.locator('#purchaseRows tr[data-kind]').count() == len(unpaid) and pg.is_visible('#filterDot'))
    pg.click('#filterBtn'); pg.click('#clearFilters'); pg.wait_for_timeout(300)
    pg.select_option('#period', 'today'); pg.wait_for_timeout(300)
    tday = datetime.datetime.now(IST).strftime('%d %b %Y')
    ok('Period: Today shows only today\'s entries', pg.locator('#purchaseRows tr[data-kind]').count() >= 3 and all(t.strip() == tday for t in pg.locator('#purchaseRows .c-date').all_inner_texts()), pg.locator('#purchaseRows .c-date').all_inner_texts())
    pg.select_option('#period', '30')
    with pg.expect_download() as d: pg.click('#exportBtn')
    txt = open(d.value.path(), encoding='utf-8-sig').read()
    ok('Export: CSV of every listed purchase with balances', d.value.suggested_filename.endswith('.csv') and 'Balance' in txt and 'MM-501' in txt and txt.count('\n') == num(pg.inner_text('#listTotal')), [d.value.suggested_filename, txt.count('\n'), pg.inner_text('#listTotal')])
    pg.click('#importBtn'); pg.wait_for_selector('[data-imp="bill"]')
    with pg.expect_file_chooser() as fc: pg.click('[data-imp="bill"]')
    ok('Import: opens a new purchase and the Excel file picker', pg.is_visible('#purchaseDialog') and fc.value is not None)
    pg.click('#closePurchase')
    pg.click('#trendRange'); pg.select_option('#trendRange', '12m'); pg.wait_for_timeout(300)
    ok('Trend: last 12 months', pg.locator('#chart .dz-pt').count() == 12)
    pg.click('[data-kpi="kTotal"]'); pg.wait_for_timeout(300)
    ok('KPI click shows this month\'s received bills', pg.input_value('#period') == 'month' and pg.input_value('#fStatus') == 'received')
    ok('No page errors (admin)', not errs, errs); c.close()

    # --- staff: Purchases is an admin page (MORE section)
    c, pg, errs = ctx(b, 'inventory_staff'); pg.goto(BASE + '/purchases.html'); pg.wait_for_timeout(2500)
    ok('Staff opening purchases.html see "no access" (admin-only page)', 'do not have access' in pg.inner_text('body'), pg.inner_text('body')[:200]); c.close()

    # --- mobile
    c, pg, errs = ctx(b, 'super_admin', 390, 844, True); open_page(pg)
    ok('Mobile: no sideways scroll', pg.evaluate('document.documentElement.scrollWidth') <= 390, pg.evaluate('document.documentElement.scrollWidth'))
    tops = [pg.locator(x).bounding_box()['y'] for x in ('#newPurchase', '#returnBtn', '#importBtn', '#exportBtn')]
    ok('Mobile: 4 header buttons in one row', max(tops) - min(tops) < 2, tops)
    k = [pg.locator(f'[data-kpi="{x}"]').bounding_box() for x in ('kTotal', 'kOrders', 'kItems', 'kDists')]
    ok('Mobile: KPIs in a 2 × 2 grid', abs(k[0]['y'] - k[1]['y']) < 2 and k[2]['y'] > k[0]['y'] + 20)
    ok('Mobile: status chips visible', pg.is_visible('.pur-chips [data-tab="received"]'))
    ok('No page errors (mobile)', not errs, errs); c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
