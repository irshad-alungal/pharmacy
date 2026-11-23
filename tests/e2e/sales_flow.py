# Sales page: every figure and control, checked against the database.
import json, re, os, csv, io, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'billing_staff': '0c000000-0000-0000-0000-000000000002', 'inventory_staff': '0c000000-0000-0000-0000-000000000003', 'pharmacist': '0c000000-0000-0000-0000-000000000004'}
BR = '0b000000-0000-0000-0000-000000000001'
IST = zoneinfo.ZoneInfo('Asia/Kolkata')
TODAY = datetime.datetime.now(IST).strftime('%Y-%m-%d')
YEST = (datetime.datetime.now(IST) - datetime.timedelta(days=1)).strftime('%Y-%m-%d')
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

# --- sales today: cash (walk-in), UPI + card split for Ravi, credit for Ravi, plus a return; one bill yesterday
ravi = SQL("select id, phone from customers where name='Ravi Kumar'")[0]
def sell(med, qty, pays, customer=None, cart='44444444-0000-0000-0000-0000000000a1'):
    mid = Q('medicines', 'id,name', filters=[['eq', 'name', med]])[0]['id']
    a = R('billing_allocate', {'p_cart': cart, 'p_medicine': mid, 'p_qty': qty})
    tot = round(sum(R('billing_calc_line', {'p_mrp': r['mrp'], 'p_qty': r['qty'], 'p_discount_pct': r['default_discount_pct'], 'p_gst_pct': r['tax_rate'], 'p_price_includes_tax': r['price_includes_tax']})[0]['total_amount'] for r in a['rows']), 2)
    p = [{'method': m, 'amount': round(tot * f, 2)} for m, f in pays]
    if p: p[-1]['amount'] = round(tot - sum(x['amount'] for x in p[:-1]), 2)
    return R('finalize_sale_v3', {'p_customer': customer, 'p_items': [{'batch_id': r['batch_id'], 'qty': r['qty']} for r in a['rows']], 'p_payments': p, 'p_discount': 0, 'p_cart': cart, 'p_expected_total': None, 'p_patient': {}}), tot
s_cash, t_cash = sell('Cetirizine', 3, [('cash', 1)])
s_split, t_split = sell('Dolo', 2, [('upi', .5), ('card', .5)], ravi['id'], '44444444-0000-0000-0000-0000000000a2')
s_credit, t_credit = sell('Pan', 1, [], ravi['id'], '44444444-0000-0000-0000-0000000000a3')
ri = R('returnable_items', {'p_invoice': s_cash})
R('process_sales_return', {'p_invoice': s_cash, 'p_items': [{'sales_item_id': ri[0]['sales_item_id'], 'qty': 1, 'disposition': 'restock'}], 'p_method': 'cash', 'p_reason': 'Sales page test'})
yid = SQL(f"insert into sales_invoices(branch_id,invoice_no,total,subtotal,status,created_by,created_at) values ($1,'YST-1',432.5,432.5,'final',$2,(($3::date + time '23:55') at time zone 'Asia/Kolkata')) returning id, invoice_no", [BR, U['super_admin'], YEST])[0]
yid = SQL("select id, invoice_no from sales_invoices where id=$1", [yid['id']])[0]
INV = {r['id']: r for r in SQL("select id, invoice_no, total::float total from sales_invoices")}
no_cash, no_split, no_credit = INV[s_cash]['invoice_no'], INV[s_split]['invoice_no'], INV[s_credit]['invoice_no']
truth = SQL(f"select count(*)::int n, coalesce(sum(total),0)::float s, count(distinct customer_id)::int c, count(*) filter (where customer_id is null)::int w from sales_invoices where status='final' and {D} = $1::date", [TODAY])[0]
month = SQL(f"select count(*)::int n, coalesce(sum(total),0)::float s, count(distinct customer_id)::int c, count(*) filter (where customer_id is null)::int w from sales_invoices where status='final' and {D} between $1::date and $2::date", [MS, TODAY])[0]
mpay = {r['method']: r['a'] for r in SQL(f"select p.method, sum(p.amount)::float a from payments p join sales_invoices i on i.id=p.invoice_id where i.status='final' and (i.created_at at time zone 'Asia/Kolkata')::date between $1::date and $2::date group by 1", [MS, TODAY])}
today_bills = SQL(f"select count(*)::int n from sales_invoices where {D} = $1::date", [TODAY])[0]['n']

def ctx(b, who, w=1536, h=1000, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    c.add_init_script(f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));")
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return c, pg, errs
def open_page(pg, q=''):
    pg.goto(BASE + '/sales.html' + q); pg.wait_for_selector('#rows tr[data-id], #rows .dl-empty:not(:has-text("Loading"))'); pg.wait_for_timeout(1200)
def row(pg, inv): return pg.locator('#rows tr[data-id]', has_text=inv)
def rows_text(pg): return pg.inner_text('#rows')
def apply_filter(pg, **f):
    pg.click('#filterBtn')
    for k, v in f.items():
        if k in ('fMin', 'from', 'to'): pg.fill('#' + k, v)
        else: pg.select_option('#' + k, v)
    pg.click('#fApply'); pg.wait_for_timeout(1000)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    c, pg, errs = ctx(b, 'super_admin')
    open_page(pg)
    ok('Layout: branded sidebar with Sales active, no footer block', 'active' in pg.get_attribute('.pp-nav-link[href="sales.html"]', 'class') and 'Trusted' not in pg.inner_text('#ppSidebar'))
    ok('Header: New Sale → Billing, Sales Return → Returns, POS, Export', pg.get_attribute('#newSale', 'href') == 'billing.html' and pg.get_attribute('#returnBtn', 'href') == 'returns.html' and pg.is_visible('#posBtn') and pg.is_visible('#exportBtn'))
    ok(f"Today's Sales = ₹{truth['s']:.2f}", abs(num(pg.inner_text('#kSales')) - truth['s']) < 0.01, pg.inner_text('#kSales'))
    ok(f"Total Orders = {truth['n']}", num(pg.inner_text('#kOrders')) == truth['n'])
    ok(f"Unique Customers = registered {truth['c']} + walk-in bills {truth['w']}", num(pg.inner_text('#kCust')) == truth['c'] + truth['w'], pg.inner_text('#kCust'))
    ok('Average Order Value = sales / orders', abs(num(pg.inner_text('#kAov')) - round(truth['s'] / truth['n'], 2)) < 0.01, pg.inner_text('#kAov'))
    ok('KPIs compare with yesterday', all('yesterday' in pg.inner_text(f'#{k}Note') for k in ('kSales', 'kOrders', 'kCust', 'kAov')))
    ok("List shows today's bills (title Today)", '(Today)' in pg.inner_text('#rangeLabel') and f'of {today_bills} sales' in pg.inner_text('#pageInfo') and no_cash in rows_text(pg), pg.inner_text('#pageInfo'))
    rs = row(pg, no_split).inner_text()
    ok('Split bill row: customer, items, amount, Split payment, Completed', 'Ravi Kumar' in rs and 'Split' in rs and f'{t_split:,.2f}' in rs and 'Completed' in rs, rs)
    ok('Credit bill shows Credit payment', 'Credit' in row(pg, no_credit).inner_text())
    rc = row(pg, no_cash).inner_text()
    ok('Returned bill shows Part returned and the refund', 'Part returned' in rc and 'returned' in rc and 'Walk-in' in rc, rc)
    # status filter
    pg.select_option('#fStatus', 'credit'); pg.wait_for_timeout(300)
    ok('Show: Credit sales', no_credit in rows_text(pg) and no_cash not in rows_text(pg))
    pg.select_option('#fStatus', 'walkin'); pg.wait_for_timeout(300)
    ok('Show: Walk-in', no_cash in rows_text(pg) and no_split not in rows_text(pg))
    pg.select_option('#fStatus', 'returned'); pg.wait_for_timeout(300)
    ok('Show: With returns', pg.locator('#rows tr[data-id]').count() >= 1 and no_cash in rows_text(pg) and no_credit not in rows_text(pg))
    pg.select_option('#fStatus', ''); pg.wait_for_timeout(300)
    # search
    pg.fill('#sq', 'Dolo'); pg.wait_for_timeout(500)
    ok('Search by medicine name', no_split in rows_text(pg) and no_credit not in rows_text(pg), rows_text(pg)[:200])
    bc = '8907700112233'; SQL("update medicines set barcode=$1 where name='Pan'", [bc]); open_page(pg)
    pg.fill('#sq', bc); pg.wait_for_timeout(500)
    ok(f'Search by barcode {bc}', no_credit in rows_text(pg) and no_split not in rows_text(pg), rows_text(pg)[:200])
    pg.fill('#sq', no_credit); pg.wait_for_timeout(500)
    ok('Search by invoice number', pg.locator('#rows tr[data-id]').count() == 1)
    pg.fill('#sq', ravi['phone'][-6:]); pg.wait_for_timeout(500)
    ok('Search by customer phone', no_split in rows_text(pg) and no_cash not in rows_text(pg))
    pg.fill('#sq', ''); pg.wait_for_timeout(400)
    # filters
    apply_filter(pg, fPay='upi')
    ok('Filter payment UPI', no_split in rows_text(pg) and no_credit not in rows_text(pg) and not pg.is_hidden('#filterDot'))
    apply_filter(pg, fPay='split')
    ok('Filter split payment', pg.locator('#rows tr[data-id]').count() == 1 and no_split in rows_text(pg))
    apply_filter(pg, fPay='', fMin=str(int(max(t_cash, t_split, t_credit))), fSort='high')
    ok('Filter amount at least (biggest bill only)', all(num(x) >= int(max(t_cash, t_split, t_credit)) for x in pg.locator('#rows .c-amt b').all_inner_texts()))
    apply_filter(pg, fMin='', fSort='new', fRange='yesterday')
    ok('Period Yesterday loads yesterday\'s bills', '(Yesterday)' in pg.inner_text('#rangeLabel') and yid['invoice_no'] in rows_text(pg) and no_cash not in rows_text(pg), rows_text(pg)[:200])
    apply_filter(pg, fRange='custom', **{'from': YEST, 'to': TODAY})
    ok('Custom period covers both days', yid['invoice_no'] in rows_text(pg) or 'of ' in pg.inner_text('#pageInfo'))
    n2 = SQL(f"select count(*)::int n from sales_invoices where {D} between $1::date and $2::date", [YEST, TODAY])[0]['n']
    ok(f'Custom period count = {n2}', f'of {n2:,} sales' in pg.inner_text('#pageInfo'), pg.inner_text('#pageInfo'))
    pg.select_option('#perPage', '25'); pg.wait_for_timeout(300)
    ok('25 per page', pg.locator('#rows tr[data-id]').count() == min(25, n2))
    if n2 > 25:
        pg.click('#pager [data-page="2"]'); pg.wait_for_timeout(300)
        ok('Page 2', pg.locator('#rows tr[data-id]').count() == min(25, n2 - 25) and 'Showing 26' in pg.inner_text('#pageInfo'))
    pg.click('#filterBtn'); pg.click('#fReset'); pg.wait_for_timeout(1000)
    ok('Reset returns to today', '(Today)' in pg.inner_text('#rangeLabel') and pg.is_hidden('#filterDot'))
    # bill details
    row(pg, no_split).locator('[data-view]').click(); pg.wait_for_selector('#billDlg[open] .sl-items'); pg.wait_for_timeout(500)
    det = R('invoice_detail', {'p_invoice': s_split})
    bt = pg.inner_text('#billBody')
    ok('Details: items, total, customer and both payments', pg.locator('#billBody .sl-items tbody tr').count() == len(det['items']) and f'{t_split:,.2f}' in bt and 'Ravi Kumar' in bt and 'UPI' in bt and 'Card' in bt, bt[:400])
    ok('Details: Sales return and WhatsApp links', f'returns.html?invoice={s_split}' in pg.inner_html('#billBody') and 'wa.me/91' in pg.inner_html('#billBody'))
    pg.click('#billBody [data-bact="print"]'); pg.wait_for_timeout(1200)
    ok('Preview / Print opens the invoice', pg.query_selector('dialog[open] #pv') is not None)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    open_page(pg)
    row(pg, no_cash).click(); pg.wait_for_selector('#billDlg[open] .sl-items')
    ok('Details of returned bill list the credit note', 'Sales page test' in pg.inner_text('#billBody') and 'Returns' in pg.inner_text('#billBody'))
    pg.keyboard.press('Escape')
    # row menu
    row(pg, no_credit).locator('[data-menu]').click()
    mt = pg.inner_text('.pur-row-menu')
    ok('Row menu: details, print, return, WhatsApp, customer, new bill, copy', all(x in mt for x in ('View details', 'Preview / Print', 'Sales return', 'WhatsApp', 'Customer profile', 'New bill', 'Copy')), mt)
    ok('New bill link preselects the customer', pg.get_attribute('.pur-row-menu a[href^="billing.html"]', 'href') == f"billing.html?customer={ravi['id']}")
    pg.click('.pur-row-menu [data-act="print"]'); pg.wait_for_timeout(1200)
    ok('Menu Preview / Print opens the invoice', pg.query_selector('dialog[open] #pv') is not None)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    open_page(pg)
    row(pg, no_credit).locator('[data-menu]').click(); pg.click('.pur-row-menu a[href^="returns.html"]'); pg.wait_for_url('**/returns.html?invoice=*'); pg.wait_for_timeout(1800)
    ok('Sales return opens Returns with this bill\'s items', 'Items eligible for return' in pg.inner_text('#form'), pg.inner_text('#form')[:200])
    # trend, top, summary, payment
    open_page(pg)
    w7 = SQL(f"select coalesce(sum(total),0)::float s, count(*)::int n from sales_invoices where status='final' and {D} between $1::date - 6 and $1::date", [TODAY])[0]
    ok('Sales Trend (7 days) total and bills match', pg.locator('#chart svg circle.dz-pt').count() == 7 and f"₹{round(w7['s']):,}".replace(',', '') in pg.inner_text('#chartSub').replace(',', '') and f"{w7['n']} bill" in pg.inner_text('#chartSub'), pg.inner_text('#chartSub'))
    pg.select_option('#trendRange', '6m'); pg.wait_for_timeout(1200)
    ok('Trend Last 6 Months: 6 monthly points', pg.locator('#chart svg circle.dz-pt').count() == 6 and '6 Months' in pg.inner_text('#topLabel'))
    pg.select_option('#trendRange', '7'); pg.wait_for_timeout(1200)
    top = R('sales_top_medicines', {'p_from': (datetime.date.fromisoformat(TODAY) - datetime.timedelta(days=6)).isoformat(), 'p_to': TODAY, 'p_limit': 5})
    tr = pg.locator('#topRows tr[data-med]')
    ok('Top Selling Medicines match the database (name, qty, value)', tr.count() == len(top) and all(t['name'] in tr.nth(i).inner_text() and f"{float(t['sales']):,.2f}" in tr.nth(i).inner_text() for i, t in enumerate(top)), [tr.nth(i).inner_text() for i in range(tr.count())])
    tr.first.click(); pg.wait_for_timeout(1500)
    ok('Clicking a top medicine lists its bills', pg.input_value('#sq').startswith(top[0]['name']) and pg.locator('#rows tr[data-id]').count() >= 1)
    pg.click('#filterBtn'); pg.click('#fReset'); pg.wait_for_timeout(1000)
    pg.click('#topAll'); pg.wait_for_selector('#topAllRows tr'); pg.wait_for_timeout(600)
    ok('View All top medicines dialog', pg.locator('#topAllRows tr').count() >= len(top) and top[0]['name'] in pg.inner_text('#topAllRows'))
    pg.select_option('#topPeriod', 'today'); pg.wait_for_timeout(800)
    ok('Top medicines for today include Cetirizine, Dolo, Pan', all(m in pg.inner_text('#topAllRows') for m in ('Cetirizine', 'Dolo', 'Pan')))
    pg.keyboard.press('Escape')
    tiles = [t.split('\n')[0] for t in pg.locator('#sumTiles button').all_inner_texts()]
    ok(f"Summary (month): sales ₹{round(month['s']):,}, orders {month['n']}, customers, AOV", abs(num(tiles[0]) - round(month['s'])) < 1 and num(tiles[1]) == month['n'] and num(tiles[2]) == month['c'] + month['w'] and abs(num(tiles[3]) - round(month['s'] / month['n'], 2)) < 0.01, tiles)
    ok('Summary extras: returns and GST', 'Returns' in pg.inner_text('#sumMore') and 'GST collected' in pg.inner_text('#sumMore'))
    leg = {b.get_attribute('data-paygo'): b.inner_text() for b in pg.locator('#payLegend button').all()}
    ok('Payment Methods match payments this month', all(abs(num(leg[k].split('\n')[-1]) - round(mpay.get(k, 0))) < 1 for k in ('cash', 'upi', 'card')) and ('credit' in leg) == (mpay.get('credit', 0) > 0), (leg, mpay))
    ok('Payment donut drawn', pg.locator('#donut circle').count() >= 3)
    pg.click('#payLegend [data-paygo="card"]'); pg.wait_for_timeout(1500)
    ok('Clicking Card lists this month\'s card bills', '(This Month)' in pg.inner_text('#rangeLabel') and no_split in rows_text(pg) and no_cash not in rows_text(pg))
    pg.click('#filterBtn'); pg.click('#fReset'); pg.wait_for_timeout(1000)
    # export (Excel library blocked offline → CSV)
    pg.click('#exportBtn')
    with pg.expect_download() as d: pg.click('#exportMenu [data-exp="csv"]')
    data = list(csv.DictReader(io.StringIO(open(d.value.path(), encoding='utf-8-sig').read())))
    ok(f'Export: {today_bills} bills with payment split and medicines', len(data) == today_bills and any(r['Invoice No.'] == no_split and float(r['UPI (₹)']) > 0 and float(r['Card (₹)']) > 0 and 'Dolo' in r['Medicines'] for r in data), (len(data), data[:1]))
    ok('No page errors', not errs, errs)
    # URL params
    open_page(pg, '?q=' + no_credit)
    ok('?q=<invoice no.> (dashboard / customers) shows that bill', pg.locator('#rows tr[data-id]').count() == 1 and no_credit in rows_text(pg))
    open_page(pg, '?invoice=' + s_split)
    pg.wait_for_selector('#billDlg[open] .sl-items')
    ok('?invoice=<id> opens the bill', no_split in pg.inner_text('#billBody'))
    c.close()

    # mobile
    c, pg, errs = ctx(b, 'billing_staff', 390, 844, True)
    open_page(pg)
    ok('Mobile: 5 bills and View All Sales', pg.locator('#rows tr[data-id]').count() == min(5, today_bills) and (today_bills <= 5 or pg.is_visible('#viewAll')))
    if today_bills > 5:
        pg.click('#viewAll'); pg.wait_for_timeout(300)
        ok('Mobile: View All Sales shows the full page', pg.locator('#rows tr[data-id]').count() == min(10, today_bills))
    ok('Mobile: no sideways scrolling', pg.evaluate('document.documentElement.scrollWidth') <= 390)
    ok('Billing staff: Sales Return available, no errors', pg.is_visible('#returnBtn') and not errs, errs)
    c.close()
    c, pg, errs = ctx(b, 'inventory_staff')
    pg.goto(BASE + '/sales.html'); pg.wait_for_timeout(2500)
    ok('Inventory staff: Sales opens (every staff role, 0037), no errors', re.search('Not authorised|do not have access', pg.inner_text('body')) is None and not errs, errs)
    c.close()
    c, pg, errs = ctx(b, 'pharmacist')
    open_page(pg)
    ok('Pharmacist: page works', num(pg.inner_text('#kOrders')) == truth['n'] and not errs, errs)
    c.close()

    # older database without 0026: the list still works
    for f in ('sales_list', 'sales_summary', 'sales_daily', 'sales_top_medicines'): SQL(f'alter function {f} rename to {f}_off')
    c, pg, errs = ctx(b, 'super_admin')
    open_page(pg)
    ok('Without 0026: bills listed, KPIs computed, message to run 0026', no_cash in rows_text(pg) and num(pg.inner_text('#kOrders')) == truth['n'] and '0026' in pg.inner_text('#msg') and not errs, (pg.inner_text('#msg'), errs))
    for f in ('sales_list', 'sales_summary', 'sales_daily', 'sales_top_medicines'): SQL(f'alter function {f}_off rename to {f}')
    c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
