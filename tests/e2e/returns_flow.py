# Returns page: sales and purchase returns, every figure and control checked against the database.
import json, re, os, csv, io, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'billing_staff': '0c000000-0000-0000-0000-000000000002', 'inventory_staff': '0c000000-0000-0000-0000-000000000003', 'pharmacist': '0c000000-0000-0000-0000-000000000004'}
IST = zoneinfo.ZoneInfo('Asia/Kolkata')
TODAY = datetime.datetime.now(IST).strftime('%Y-%m-%d')
MS = TODAY[:8] + '01'
def api(kind, body, user='super_admin'):
    r = urllib.request.Request(BASE + '/api/' + kind, data=json.dumps({'user': U[user], **body}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
def R(name, args=None, user='super_admin'):
    r = api('rpc', {'name': name, 'args': args or {}}, user)
    if r.get('error'): print('rpc', name, r['error'])
    return r.get('data')
def Q(t, cols, user='super_admin', **k): return api('query', {'q': dict({'table': t, 'op': 'select', 'cols': cols, 'filters': [], 'order': [], 'single': None, 'count': None, 'limit': None, 'offset': None, 'values': None, 'returning': None}, **k)}, user)['data']
def SQL(sql, params=None):
    r = api('ownersql', {'sql': sql, 'params': params or []})
    if r.get('error'): print('sql', r['error'])
    return r.get('data')
P = F = 0
def ok(n, c, x=''):
    global P, F
    P += bool(c); F += not c
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else '  → ' + str(x)[:400]))
num = lambda s: float(re.sub(r'[^0-9.\-]', '', s) or 0)
D = "(created_at at time zone 'Asia/Kolkata')::date"

ravi = SQL("select id, phone from customers where name='Ravi Kumar'")[0]
def sell(med, qty, customer=None, cart='55555555-0000-0000-0000-0000000000a1'):
    mid = Q('medicines', 'id,name', filters=[['eq', 'name', med]])[0]['id']
    a = R('billing_allocate', {'p_cart': cart, 'p_medicine': mid, 'p_qty': qty})
    tot = round(sum(R('billing_calc_line', {'p_mrp': r['mrp'], 'p_qty': r['qty'], 'p_discount_pct': r['default_discount_pct'], 'p_gst_pct': r['tax_rate'], 'p_price_includes_tax': r['price_includes_tax']})[0]['total_amount'] for r in a['rows']), 2)
    return R('finalize_sale_v3', {'p_customer': customer, 'p_items': [{'batch_id': r['batch_id'], 'qty': r['qty']} for r in a['rows']], 'p_payments': [{'method': 'cash', 'amount': tot}], 'p_discount': 0, 'p_cart': cart, 'p_expected_total': None, 'p_patient': {}})
s1 = sell('Cetirizine', 4, ravi['id'])
s2 = sell('Pan', 2, None, '55555555-0000-0000-0000-0000000000a2')
s3 = sell('Cetirizine', 3, None, '55555555-0000-0000-0000-0000000000a3')
no1 = SQL('select invoice_no from sales_invoices where id=$1', [s1])[0]['invoice_no']
# one return through the API (damaged, cash refund)
it2 = R('returnable_items', {'p_invoice': s2})[0]
api_ret = R('process_sales_return_v2', {'p_invoice': s2, 'p_items': [{'sales_item_id': it2['sales_item_id'], 'qty': 1, 'disposition': 'damaged'}], 'p_method': 'cash', 'p_reason': 'Blister torn', 'p_reason_code': 'damaged', 'p_refund_type': 'refund'}, 'billing_staff')
ok('setup: API return (damaged, cash) created', bool(api_ret))

def ctx(b, who, w=1536, h=1000, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    c.add_init_script(f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));")
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    return c, pg, errs
def open_page(pg, q=''):
    pg.goto(BASE + '/returns.html' + q); pg.wait_for_selector('#rows tr[data-id], #rows .dl-empty:not(:has-text("Loading"))'); pg.wait_for_timeout(1200)
def rows_text(pg): return pg.inner_text('#rows')
def sret(where='true', params=None): return SQL(f"select count(*)::int n, coalesce(sum(total),0)::float v, coalesce(sum(total) filter (where refund_type='refund'),0)::float rf from sales_returns where {where}", params or [])[0]

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    c, pg, errs = ctx(b, 'super_admin')
    open_page(pg)
    ok('Layout: branded sidebar with Returns active, no footer block', 'active' in pg.get_attribute('.pp-nav-link[href="returns.html"]', 'class') and 'Trusted' not in pg.inner_text('#ppSidebar'))
    ok('Header: New Return, Export, ⋯ and Sales / Purchase tabs', all(pg.is_visible(x) for x in ('#newReturn', '#exportBtn', '#moreBtn', '#customer-tab', '#purchase-tab')) and 'on' in pg.get_attribute('#customer-tab', 'class'))
    # --- create a sales return in the UI: exchange, UPI, adverse reaction, whole quantity
    pg.click('#newReturn'); pg.wait_for_selector('#q'); pg.fill('#q', no1); pg.wait_for_timeout(1200)
    ok('New Return: bill found by invoice number', pg.locator('#list [data-invoice]').count() == 1 and no1 in pg.inner_text('#list'))
    pg.click('#list [data-invoice]'); pg.wait_for_selector('.return-qty')
    pg.click('#form [data-all]'); pg.select_option('#reasonCode', 'adverse_reaction'); pg.fill('#return-reason', 'Rash after first dose'); pg.click('#rtype [data-v="exchange"]'); pg.select_option('#refund-method', 'upi'); pg.wait_for_timeout(300)
    unit = float(R('returnable_items', {'p_invoice': s1})[0]['unit_refund'])
    ok(f'Live total = qty × refund/unit (₹{unit * 4:.2f}) labelled Exchange value', abs(num(pg.inner_text('#rtTotal')) - round(unit * 4, 2)) < 0.02 and 'Exchange value' in pg.inner_text('.rt-total'), pg.inner_text('.rt-total'))
    pg.click('#submit-return'); pg.wait_for_selector('.rt-done', timeout=15000)
    r1 = SQL("select id, return_no, reason_code, refund_type, refund_method, total::float, reason from sales_returns where invoice_id=$1", [s1])[0]
    ok('Credit note saved: adverse_reaction, exchange, UPI, note kept', r1['reason_code'] == 'adverse_reaction' and r1['refund_type'] == 'exchange' and r1['refund_method'] == 'upi' and r1['reason'] == 'Rash after first dose', r1)
    ok('Success panel: credit note no., exchange bill link with the customer', r1['return_no'] in pg.inner_text('.rt-done') and pg.locator(f'.rt-done a[href="billing.html?customer={ravi["id"]}"]').count() == 1)
    ok('Stock back: 4 Cetirizine restocked', SQL("select coalesce(sum(qty),0)::float q from stock_movements where ref_id=$1 and movement_type='return_in'", [r1['id']])[0]['q'] == 4)
    pg.click('#donePrint'); pg.wait_for_timeout(800)
    ok('Print credit note opens the credit note', 'CREDIT NOTE' in pg.inner_text('body') and r1['return_no'] in pg.inner_text('body'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    open_page(pg)
    # --- KPIs
    m = sret(f"{D} >= $1::date", [MS])
    sales_m = SQL(f"select coalesce(sum(total),0)::float s from sales_invoices where status='final' and {D} >= $1::date", [MS])[0]['s']
    ok(f"Total Returns (this month) = {m['n']}", num(pg.inner_text('#kCount')) == m['n'], pg.inner_text('#kCount'))
    ok(f"Return Value = ₹{round(m['v']):,}", abs(num(pg.inner_text('#kValue')) - round(m['v'])) < 1, pg.inner_text('#kValue'))
    ok('Return Rate = returns ÷ sales this month', abs(num(pg.inner_text('#kRate')) - round(m['v'] / sales_m * 100, 1)) < 0.05 and 'of total sales' in pg.inner_text('#kRateNote'), (pg.inner_text('#kRate'), m['v'], sales_m))
    ok('Refunded Amount = refunds only (exchange excluded) with % of returns', abs(num(pg.inner_text('#kFourth')) - round(m['rf'])) < 1 and '% of returns' in pg.inner_text('#kFourthNote'), (pg.inner_text('#kFourth'), m))
    # --- list
    ok(f"List: this month's {m['n']} returns", f"({m['n']})" in pg.inner_text('#listTotal') and r1['return_no'] in rows_text(pg))
    row1 = pg.locator('#rows tr[data-id]', has_text=r1['return_no']).inner_text()
    ok('Row: return no., invoice, customer, value, Exchange, Completed', no1 in row1 and 'Ravi Kumar' in row1 and 'Exchange' in row1 and 'Completed' in row1 and f"{r1['total']:,.2f}" in row1, row1)
    pg.fill('#rq', 'Pan'); pg.wait_for_timeout(500)
    ok('Search by medicine', pg.locator('#rows tr[data-id]').count() == 1 and 'Refund' in rows_text(pg))
    pg.fill('#rq', ravi['phone'][-7:]); pg.wait_for_timeout(500)
    ok('Search by customer phone', r1['return_no'] in rows_text(pg) and pg.locator('#rows tr[data-id]').count() == SQL("select count(*)::int n from sales_returns r join customers c on c.id=r.customer_id where c.phone=$1", [ravi['phone']])[0]['n'])
    pg.fill('#rq', no1); pg.wait_for_timeout(500)
    ok('Search by invoice no.', pg.locator('#rows tr[data-id]').count() == 1)
    pg.fill('#rq', ''); pg.wait_for_timeout(300)
    def apply(**f):
        pg.click('#filterBtn')
        for k, v in f.items(): pg.select_option('#' + k, v)
        pg.click('#fApply'); pg.wait_for_timeout(700)
    apply(fReason='damaged')
    ok('Filter reason Damaged', pg.locator('#rows tr[data-id]').count() == sret("reason_code='damaged'")['n'] and not pg.is_hidden('#filterDot'))
    apply(fReason='', fType='exchange')
    ok('Filter refund type Exchange', pg.locator('#rows tr[data-id]').count() == sret("refund_type='exchange'")['n'] and r1['return_no'] in rows_text(pg))
    apply(fType='', fMethod='upi')
    ok('Filter refund by UPI', pg.locator('#rows tr[data-id]').count() == sret("refund_method='upi'")['n'])
    apply(fMethod='', fCond='damaged')
    ok('Filter condition Damaged', pg.locator('#rows tr[data-id]').count() == SQL("select count(distinct return_id)::int n from sales_return_items where disposition='damaged'")[0]['n'])
    pg.click('#filterBtn'); pg.click('#fReset'); pg.wait_for_timeout(800)
    pg.select_option('#fPeriod', 'today'); pg.wait_for_timeout(800)
    ok('Period Today', f"({sret(f'{D} = $1::date', [TODAY])['n']})" in pg.inner_text('#listTotal'))
    pg.select_option('#fPeriod', 'month'); pg.wait_for_timeout(800)
    # --- reasons, tiles, trend, top
    leg = {x.get_attribute('data-reason'): x.inner_text() for x in pg.locator('#reasonLegend [data-reason]').all()}
    byr = {r['reason_code']: r['n'] for r in SQL(f"select reason_code, count(*)::int n from sales_returns where {D} >= $1::date group by 1", [MS])}
    ok('Returns by Reason: legend counts match the database', all(f'({n})' in leg.get(k, '') for k, n in byr.items()) and num(pg.inner_text('#donutN')) == m['n'], (leg, byr))
    tiles = pg.inner_text('#moneyTiles')
    ok('Refunded Amount and Exchanged Value tiles', f"₹{round(m['rf']):,}" in tiles and f"₹{round(m['v'] - m['rf']):,}" in tiles, tiles)
    pg.click('#reasonLegend [data-reason="adverse_reaction"]'); pg.wait_for_timeout(800)
    ok('Clicking a reason lists those returns', r1['return_no'] in rows_text(pg) and pg.locator('#rows tr[data-id]').count() == byr['adverse_reaction'])
    pg.click('#filterBtn'); pg.click('#fReset'); pg.wait_for_timeout(800)
    w7 = SQL(f"select coalesce(sum(total),0)::float v, count(*)::int n from sales_returns where {D} between $1::date - 6 and $1::date", [TODAY])[0]
    ok('Return Trend (7 days) total and count', pg.locator('#chart svg circle.dz-pt').count() == 7 and f"₹{round(w7['v']):,}" in pg.inner_text('#chartSub') and f"{w7['n']} return" in pg.inner_text('#chartSub'), pg.inner_text('#chartSub'))
    top = R('returns_top_medicines', {'p_kind': 'sales', 'p_from': (datetime.date.fromisoformat(TODAY) - datetime.timedelta(days=6)).isoformat(), 'p_to': TODAY, 'p_limit': 5})
    trs = pg.locator('#topRows tr[data-med]')
    ok('Top Returned Medicines match the database', trs.count() == len(top) and all(t['name'] in trs.nth(i).inner_text() and f"{float(t['value']):,.2f}" in trs.nth(i).inner_text() for i, t in enumerate(top)), [trs.nth(i).inner_text() for i in range(trs.count())])
    pg.select_option('#trendRange', '12m'); pg.wait_for_timeout(800)
    ok('Trend Last 12 Months: 12 points', pg.locator('#chart svg circle.dz-pt').count() == 12)
    pg.select_option('#trendRange', '7'); pg.wait_for_timeout(800)
    # --- details and row menu
    pg.locator('#rows tr[data-id]', has_text=r1['return_no']).locator('[data-view]').click(); pg.wait_for_selector('#viewDlg[open] .sl-items')
    vt = pg.inner_text('#viewBody')
    ok('Details: customer, bill, reason + note, refund, items with condition', 'Ravi Kumar' in vt and no1 in vt and 'Adverse Reaction' in vt and 'Rash after first dose' in vt and 'UPI' in vt and 'Cetirizine' in vt and 'Back to stock' in vt, vt[:500])
    ok('Details: open bill, exchange bill, WhatsApp', f'sales.html?invoice={s1}' in pg.inner_html('#viewBody') and 'Exchange bill' in vt and 'wa.me/91' in pg.inner_html('#viewBody'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.locator('#rows tr[data-id]', has_text=r1['return_no']).locator('[data-menu]').click()
    mt = pg.inner_text('.pur-row-menu')
    ok('Row menu: view, print, open bill, return more, WhatsApp, copy', all(x in mt for x in ('View details', 'Print credit note', 'Open bill', 'Return more', 'WhatsApp', 'Copy')), mt)
    pg.click('.pur-row-menu [data-act="again"]'); pg.wait_for_selector('#newDlg[open]'); pg.wait_for_timeout(1500)
    ok('Return more opens the same bill (nothing left to return)', no1 in pg.inner_text('#newBody') and pg.locator('#form .return-qty:disabled').count() >= 1)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # --- export
    pg.click('#moreBtn')
    with pg.expect_download() as d: pg.click('#moreMenu [data-more="csv"]')
    data = list(csv.DictReader(io.StringIO(open(d.value.path(), encoding='utf-8-sig').read())))
    ok(f"Export: {m['n']} returns with reason, type and medicines", len(data) == m['n'] and any(x['Return No.'] == r1['return_no'] and x['Refund type'] == 'Exchange' and x['Reason'] == 'Adverse Reaction' and 'Cetirizine' in x['Medicines'] for x in data), data[:1])
    # --- purchase returns
    pg.click('#purchase-tab'); pg.wait_for_timeout(1500)
    ok('Purchase tab: purchase list, distributor columns, expiry KPI', 'Purchase Returns' in pg.inner_text('#listTitle') and 'Distributor' in pg.inner_text('#thead') and 'Expiry Stock' in pg.inner_text('.md-kpis'))
    cands = R('expiry_return_candidates', {'p_days': 90})
    ok(f"Expiry KPI = {sum(1 for x in cands if float(x['returnable']) > 0)} returnable batch(es)", num(pg.inner_text('#kFourth')) == sum(1 for x in cands if float(x['returnable']) > 0), (pg.inner_text('#kFourth'), cands))
    pg.click('[data-kpi="kFourth"]'); pg.wait_for_selector('#expRows tr'); pg.wait_for_timeout(800)
    ok('Expiry dialog lists the batches with distributor and invoice', all(x['batch_no'] in pg.inner_text('#expRows') for x in cands) and 'KPD-1001' in pg.inner_text('#expRows'))
    pg.click('#expRows [data-exp] >> nth=0'); pg.wait_for_selector('.purchase-return-qty'); pg.wait_for_timeout(600)
    first = next(x for x in cands if float(x['returnable']) > 0)
    ok('Return from the expiry list pre-fills the batch and reason Expired', pg.input_value('#preasonCode') == 'expired' and pg.locator(f'.purchase-return-qty[data-id="{first["purchase_item_id"]}"]').input_value() == str(int(float(first['returnable']))))
    pg.click('#submit-purchase-return'); pg.wait_for_selector('.rt-done', timeout=15000)
    pr = SQL("select id, return_no, reason_code, total_value::float v from purchase_returns order by created_at desc limit 1")[0]
    ok('Purchase return saved with reason Expired and a value', pr['reason_code'] == 'expired' and pr['v'] > 0, pr)
    ok('Stock of that batch reduced', SQL("select coalesce(sum(qty),0)::float q from stock_movements where ref_id=$1", [pr['id']])[0]['q'] != 0 or SQL("select qty::float from medicine_batches where id=$1", [first['batch_id']])[0]['qty'] < float(first['stock']))
    pg.keyboard.press('Escape'); open_page(pg, '?tab=purchase')
    ok('?tab=purchase opens purchase returns with the new return listed', 'on' in pg.get_attribute('#purchase-tab', 'class') and pr['return_no'] in rows_text(pg))
    pm = SQL(f"select count(*)::int n, coalesce(sum(total_value),0)::float v from purchase_returns where {D} >= $1::date", [MS])[0]
    ok('Purchase KPIs: count and value this month', num(pg.inner_text('#kCount')) == pm['n'] and abs(num(pg.inner_text('#kValue')) - round(pm['v'])) < 1)
    pg.locator('#rows tr[data-id]', has_text=pr['return_no']).click(); pg.wait_for_selector('#viewDlg[open] .sl-items')
    ok('Purchase return details: distributor, supplier invoice, reason, debit note', 'KPD-1001' in pg.inner_text('#viewBody') and 'Expired' in pg.inner_text('#viewBody') and 'debit note' in pg.inner_text('#viewBody').lower())
    pg.keyboard.press('Escape')
    ok('No page errors (admin)', not errs, errs)
    c.close()

    # deep links
    c, pg, errs = ctx(b, 'billing_staff')
    open_page(pg, f'?invoice={s3}')
    pg.wait_for_selector('#newDlg[open] .return-qty')
    ok('?invoice=<id> (Sales page) opens that bill for return', pg.locator('#form .return-qty').count() >= 1)
    pg.fill('#form .return-qty >> nth=0', '1'); pg.select_option('#reasonCode', 'not_needed'); pg.click('#submit-return'); pg.wait_for_selector('.rt-done', timeout=15000)
    ok('Billing staff: refund return created (no customer → walk-in)', SQL("select count(*)::int n from sales_returns where invoice_id=$1 and reason_code='not_needed' and refund_type='refund'", [s3])[0]['n'] == 1)
    pg.keyboard.press('Escape')
    ok('Billing staff: no purchase tab', pg.locator('#purchase-tab').count() == 0 and not errs, errs)
    c.close()
    c, pg, errs = ctx(b, 'pharmacist', 390, 844, True)
    open_page(pg)
    n = num(pg.inner_text('#listTotal'))
    ok('Mobile: 3 returns and View All Returns', pg.locator('#rows tr[data-id]').count() == min(3, n) and (n <= 3 or pg.is_visible('#viewAll')))
    ok('Mobile: no sideways scrolling, no errors', pg.evaluate('document.documentElement.scrollWidth') <= 390 and not errs, errs)
    c.close()
    c, pg, errs = ctx(b, 'inventory_staff')
    pg.goto(BASE + '/returns.html'); pg.wait_for_timeout(2500)
    ok('Inventory staff: Returns opens (every staff role, 0037), no errors', re.search('Not authorised|do not have access', pg.inner_text('body')) is None and not errs, errs)
    c.close()

    # older database without 0027: list works, a return can still be created
    fns = ['sales_returns_list', 'purchase_returns_list', 'returns_top_medicines', 'returns_base_total', 'return_detail', 'expiry_return_candidates', 'process_sales_return_v2', 'process_purchase_return_v2']
    for f in fns: SQL(f'alter function {f} rename to {f}_off')
    c, pg, errs = ctx(b, 'super_admin')
    open_page(pg)
    ok('Without 0027: returns listed and message to run 0027', r1['return_no'] in rows_text(pg) and '0027' in pg.inner_text('#msg'), pg.inner_text('#msg'))
    s4 = sell('Cetirizine', 2, None, '55555555-0000-0000-0000-0000000000a4')
    pg.click('#newReturn'); pg.wait_for_selector('#q'); pg.fill('#q', SQL('select invoice_no from sales_invoices where id=$1', [s4])[0]['invoice_no']); pg.wait_for_timeout(1200)
    pg.click('#list [data-invoice]'); pg.wait_for_selector('.return-qty'); pg.fill('.return-qty', '1'); pg.select_option('#reasonCode', 'wrong_medicine'); pg.click('#submit-return'); pg.wait_for_selector('.rt-done', timeout=15000)
    ok('Without 0027: credit note still created with the old function', SQL("select count(*)::int n from sales_returns where invoice_id=$1", [s4])[0]['n'] == 1 and not errs, errs)
    for f in fns: SQL(f'alter function {f}_off rename to {f}')
    c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
