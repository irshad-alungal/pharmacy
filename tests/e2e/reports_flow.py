# Reports & Analytics page: every figure and control, checked against the database.
import json, re, os, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'admin': '0c000000-0000-0000-0000-000000000006', 'pharmacist': '0c000000-0000-0000-0000-000000000004', 'billing_staff': '0c000000-0000-0000-0000-000000000002'}
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
num = lambda s: float(re.sub(r'[^0-9.\-]', '', s.replace('−', '-')) or 0)
def inr0(v):
    neg = float(v) < 0 and round(abs(float(v))) > 0
    v = round(abs(float(v))); s = str(v)
    if len(s) > 3: h, t = s[:-3], s[-3:]; h = re.sub(r'(\d)(?=(\d\d)+$)', r'\1,', h); s = h + ',' + t
    return ('−' if neg else '') + '₹' + s

# --- activity today: cash sale, credit sale, return, posted expense
ravi = SQL("select id from customers where name='Ravi Kumar'")[0]
def sell(med, qty, pays, customer=None, cart='77777777-0000-0000-0000-0000000000a1'):
    mid = Q('medicines', 'id,name', filters=[['eq', 'name', med]])[0]['id']
    a = R('billing_allocate', {'p_cart': cart, 'p_medicine': mid, 'p_qty': qty})
    tot = round(sum(R('billing_calc_line', {'p_mrp': r['mrp'], 'p_qty': r['qty'], 'p_discount_pct': r['default_discount_pct'], 'p_gst_pct': r['tax_rate'], 'p_price_includes_tax': r['price_includes_tax']})[0]['total_amount'] for r in a['rows']), 2)
    return R('finalize_sale_v3', {'p_customer': customer, 'p_items': [{'batch_id': r['batch_id'], 'qty': r['qty']} for r in a['rows']], 'p_payments': pays(tot), 'p_discount': 0, 'p_cart': cart, 'p_expected_total': None, 'p_patient': {}}), tot
s1, t1 = sell('Cetirizine', 4, lambda t: [{'method': 'cash', 'amount': t}])
s2, t2 = sell('Dolo', 3, lambda t: [], ravi['id'], '77777777-0000-0000-0000-0000000000a2')
ri = R('returnable_items', {'p_invoice': s1})[0]
R('process_sales_return', {'p_invoice': s1, 'p_items': [{'sales_item_id': ri['sales_item_id'], 'qty': 1, 'disposition': 'restock'}], 'p_method': 'cash', 'p_reason': 'Reports test'})
cat = R('expense_category_get_list', {'p_include_inactive': False})[0]['category_id']
e1 = R('expense_save_draft', {'p_expense_id': None, 'p_expense_date': TODAY, 'p_category_id': cat, 'p_description': 'Reports test bill', 'p_amount': 250, 'p_payment_method': 'cash', 'p_reference': None, 'p_notes': None}); R('expense_post', {'p_expense_id': e1})
SQL("update medicines set category_id=(select id from categories where name='Tablets') where name='Cetirizine'")
OV = R('reports_overview', {'p_from': MS, 'p_to': TODAY})

def ctx(b, who, w=1536, h=1000, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    c.add_init_script(f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));")
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    return c, pg, errs
def open_page(pg, q=''):
    pg.goto(BASE + '/reports.html' + q); pg.wait_for_selector('#kSales:not(:has(.dz-skel))'); pg.wait_for_timeout(1200)
def run_in_dialog(pg):
    pg.click('#run'); pg.wait_for_function("!document.getElementById('run').disabled && document.getElementById('msg').textContent !== 'Running report…'"); pg.wait_for_timeout(200)
runs_n = lambda: SQL('select count(*)::int n from report_runs')[0]['n']

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    c, pg, errs = ctx(b, 'super_admin')
    open_page(pg)
    ok('Layout: branded sidebar with Reports active, no footer block', 'active' in pg.get_attribute('.pp-nav-link[href="reports.html"]', 'class') and 'Trusted' not in pg.inner_text('#ppSidebar'))
    ok('Header: title, subtitle, date range, Generate Report, Export', 'Reports & Analytics' in pg.inner_text('.pos-title') and 'Generate, view, and download' in pg.inner_text('.pos-title') and all(pg.is_visible(x) for x in ('#rangeBtn', '#gen', '#exportBtn')))
    ok('Date range defaults to this month', pg.inner_text('#rangeLabel').endswith(datetime.date.fromisoformat(TODAY).strftime('%d %b %Y')) and '(This Month)' in pg.inner_text('#ovLabel'), pg.inner_text('#rangeLabel'))
    tiles = pg.eval_on_selector_all('#types [data-type]', 'e=>e.map(x=>x.dataset.type).join()')
    ok('9 report types, Sales active', tiles == 'sales,purchase,inventory,customer,distributor,expense,finance,returns,custom' and 'on' in pg.get_attribute('[data-type="sales"]', 'class'), tiles)
    c_ = OV['current']
    ok(f"KPI Total Sales = {inr0(c_['sales'])} (reports_overview)", pg.inner_text('#kSales') == inr0(c_['sales']), (pg.inner_text('#kSales'), c_['sales']))
    ok('KPI Purchases, Expenses, Net Profit match', pg.inner_text('#kPur') == inr0(c_['purchases']) and pg.inner_text('#kExp') == inr0(c_['expenses']) and pg.inner_text('#kNet') == inr0(c_['net_profit']), (pg.inner_text('#kPur'), pg.inner_text('#kExp'), pg.inner_text('#kNet'), c_))
    ok('KPI Profit Margin', pg.inner_text('#kMargin') == ('—' if c_['margin'] is None else f"{float(c_['margin']):.1f}%"), (pg.inner_text('#kMargin'), c_['margin']))
    ok('KPIs compare with the previous period', 'previous period' in pg.inner_text('#kSalesNote') and 'Compared with' in pg.inner_text('#ovVs'))
    pnl = R('report_pnl', {'p_from': MS, 'p_to': TODAY})
    ok('Net profit equals the P&L report', abs(float(c_['net_profit']) - float([x for x in pnl if x['label'].startswith('Net profit')][0]['amount'])) < .01)
    # insights
    ins = pg.inner_text('#insights')
    ok('Insights: orders from customers', f"{c_['orders']} order" in ins and f"{int(c_['customers']) + int(c_['walkins'])} customer" in ins, ins)
    ok('Insights: returns count and value', f"{c_['returns']} return" in ins and inr0(c_['returns_value']) in ins, ins)
    st = OV['stock']
    ok('Insights: low stock', (f"{st['low_stock']} medicine" in ins) if st['low_stock'] else 'No medicines in low stock' in ins, (ins, st))
    # category
    catrows = R('reports_sales_by_category', {'p_from': MS, 'p_to': TODAY})
    tot = sum(float(x['sales']) for x in catrows)
    ok('Sales by category: total = sum of categories = total sales', pg.inner_text('#catTotal') == inr0(tot) and abs(tot - float(c_['sales'])) < 1, (pg.inner_text('#catTotal'), tot, c_['sales']))
    ok('Sales by category: Tablets listed', 'Tablets' in pg.inner_text('#catLegend'), pg.inner_text('#catLegend'))
    # trend
    ok('Sales trend chart drawn for the period', pg.query_selector('#chart svg .dz-line') is not None and inr0(c_['sales']) in pg.inner_text('#chartSub'), pg.inner_text('#chartSub'))
    pg.select_option('#trendRange', '7'); pg.wait_for_timeout(1000)
    d7 = R('report_period_summary', {'p_from': (datetime.date.fromisoformat(TODAY) - datetime.timedelta(days=6)).isoformat(), 'p_to': TODAY, 'p_bucket': 'day'})
    ok('Trend Last 7 Days: 7 points, total matches', len(pg.query_selector_all('#chart .dz-pt')) == 7 and inr0(sum(float(x['gross_sales']) for x in d7)) in pg.inner_text('#chartSub'), pg.inner_text('#chartSub'))
    pg.select_option('#trendRange', '12m'); pg.wait_for_timeout(1000)
    ok('Trend Last 12 Months: 12 monthly points', len(pg.query_selector_all('#chart .dz-pt')) == 12 and 'by month' in pg.inner_text('#chartSub'))
    pg.select_option('#trendRange', 'period'); pg.wait_for_timeout(800)
    # recent
    ok('Recent reports: empty state on a fresh install', 'No reports generated yet' in pg.inner_text('#recentRows'), pg.inner_text('#recentRows'))
    # quick reports
    pg.click('[data-quick="today"]'); pg.wait_for_selector('#genDlg[open]'); pg.wait_for_function("document.getElementById('msg').textContent.includes('Report')")
    nt = SQL("select count(*)::int n from sales_invoices where status='final' and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date")[0]['n']
    ok(f"Quick: Today's sales lists today's {nt} bill(s)", pg.inner_text('.rp-out-stat b') == str(nt) and pg.input_value('#rp') == 'sales' and pg.input_value('#df') == TODAY, (pg.inner_text('.rp-out-stat b'), nt))
    ok('Run is logged to Recent Reports', runs_n() == 1 and 'Sales report' in pg.inner_text('#recentRows'), pg.inner_text('#recentRows'))
    with pg.expect_download() as dl: pg.click('#csv')
    txt = open(dl.value.path(), encoding='utf-8-sig').read()
    ok('CSV download: header and TOTAL row', dl.value.suggested_filename == f'sales-{TODAY}.csv' and txt.startswith('Invoice,Date') and 'TOTAL' in txt.splitlines()[-1], txt[:200])
    pg.click('#prt'); pg.wait_for_timeout(400)
    ok('Print sends the report to the printer', 'printer' in pg.inner_text('#msg'), pg.inner_text('#msg'))
    pg.click('#genDlg [data-close]')
    pg.click('[data-quick="valuation"]'); pg.wait_for_function("document.getElementById('msg').textContent.includes('Report')")
    stock = R('report_stock')
    ok('Quick: stock valuation total at cost = report_stock', abs(num(pg.inner_text('.rp-res tfoot td:nth-child(6)')) - sum(float(x['cost_value']) for x in stock)) < .05 and 'As on' in pg.inner_text('.rp-out-head'), pg.inner_text('.rp-res tfoot'))
    pg.click('#genDlg [data-close]')
    pg.click('[data-quick="topmeds"]'); pg.wait_for_function("document.getElementById('msg').textContent.includes('Report')")
    q = [float(num(x)) for x in pg.eval_on_selector_all('.rp-res tbody tr td:nth-child(4)', 'e=>e.map(x=>x.textContent)')]
    ok('Quick: top selling medicines ranked by net qty', len(q) > 0 and q == sorted(q, reverse=True), q)
    pg.click('#genDlg [data-close]')
    pg.click('[data-quick="topcust"]'); pg.wait_for_function("document.getElementById('msg').textContent.includes('Report')")
    ok('Quick: top customers (Ravi Kumar first after the credit sale)', 'Ravi Kumar' in pg.inner_text('.rp-res tbody'), pg.inner_text('.rp-out')[:300])
    pg.click('#genDlg [data-close]')
    # tiles -> generator
    pg.click('[data-type="purchase"]'); pg.wait_for_selector('#genDlg[open]')
    ok('Purchase tile opens the generator with the purchase report', pg.eval_on_selector_all('#rp option', 'e=>e.map(x=>x.value).join()') == 'purchases' and 'on' in pg.get_attribute('[data-type="purchase"]', 'class'))
    run_in_dialog(pg)
    pr = R('report_purchases', {'p_from': MS, 'p_to': TODAY})
    ok('Purchase report rows = report_purchases', pg.inner_text('.rp-out-stat b') == str(len(pr)) and 'success' in pg.get_attribute('#msg', 'class'))
    pg.click('#genTypes [data-gt="inventory"]')
    ok('Inventory type: valuation, stock, expiry', pg.eval_on_selector_all('#rp option', 'e=>e.map(x=>x.value).join()') == 'valuation,stock,expiry')
    pg.select_option('#rp', 'expiry')
    ok('Expiry shows the days field, hides dates', pg.is_visible('#dd') and not pg.is_visible('#df'))
    pg.fill('#dd', '5000'); run_in_dialog(pg)
    ok('Expiry window over 3650 refused', 'error' in pg.get_attribute('#msg', 'class') and '3650' in pg.inner_text('#msg'))
    pg.click('#genTypes [data-gt="sales"]'); pg.select_option('#rp', 'period')
    ok('Period report shows Group by', pg.is_visible('#bk'))
    pg.fill('#df', TODAY); pg.fill('#dt', MS if MS < TODAY else '2000-01-01'); run_in_dialog(pg)
    ok('From after To refused', 'error' in pg.get_attribute('#msg', 'class'), pg.inner_text('#msg'))
    pg.click('#rg [data-r="month"]')
    ok('Preset This Month fills the dates', pg.input_value('#df') == MS and pg.input_value('#dt') == TODAY and 'active' in pg.get_attribute('#rg [data-r="month"]', 'class'))
    pg.select_option('#bk', 'week'); run_in_dialog(pg)
    ok('Period report grouped by week', 'Grouped by week' in pg.inner_text('.rp-out-head'))
    # all reports from Custom
    pg.click('#genTypes [data-gt="custom"]'); pg.click('#rg [data-r="all"]')
    opts = pg.eval_on_selector_all('#rp option', 'e=>e.map(x=>x.value)')
    ok('Custom lists all 17 reports', len(opts) == 17, opts)
    bad = []
    for o in opts:
        pg.select_option('#rp', o)
        if o == 'expiry': pg.fill('#dd', '90')
        run_in_dialog(pg)
        if 'error' in (pg.get_attribute('#msg', 'class') or ''): bad.append((o, pg.inner_text('#msg')))
    ok('Every report runs (all dates)', not bad, bad)
    pg.click('#genDlg [data-close]')
    n_before = runs_n()
    # recent: view does not log again; download csv from the row menu
    pg.wait_for_timeout(500)
    pg.click('#recentRows tr[data-run]:first-child [data-rview]'); pg.wait_for_function("document.getElementById('msg').textContent.includes('Report')")
    ok('Recent: view re-runs the report without logging again', pg.is_visible('#genDlg') and runs_n() == n_before)
    pg.click('#genDlg [data-close]')
    pg.click('#recentRows tr[data-run]:first-child [data-rowmenu="dl"]')
    with pg.expect_download() as dl: pg.click('#rowMenu [data-rm="csv"]')
    ok('Recent: download CSV again', dl.value.suggested_filename.endswith('.csv'))
    pg.select_option('#recentType', 'inventory'); pg.wait_for_timeout(800)
    ok('Recent: filter by type', all('Inventory' in t for t in pg.eval_on_selector_all('#recentRows tr[data-run] .c-type', 'e=>e.map(x=>x.textContent)')) and len(pg.query_selector_all('#recentRows tr[data-run]')) >= 1)
    pg.select_option('#recentType', ''); pg.wait_for_timeout(800)
    ok('Recent: 5 shown, View All available', len(pg.query_selector_all('#recentRows tr[data-run]')) == 5 and pg.is_visible('#recentAll'))
    pg.click('#recentAll'); pg.wait_for_selector('#allRows')
    ok('View All lists every report with the generator name', len(pg.query_selector_all('#allRows tr[data-run]')) == n_before and 'superAdmin' in pg.inner_text('#allRows'), len(pg.query_selector_all('#allRows tr[data-run]')))
    pg.click('#allRows tr[data-run]:first-child [data-rowmenu="more"]'); pg.click('#rowMenu [data-rm="del"]'); pg.wait_for_timeout(900)
    ok('Remove from history', runs_n() == n_before - 1 and len(pg.query_selector_all('#allRows tr[data-run]')) == n_before - 1)
    pg.click('#puDlg [data-close]')
    # KPI click, insight click
    pg.click('[data-kpi="kExp"]'); pg.wait_for_function("document.getElementById('msg').textContent.includes('Report')")
    ok('KPI Total Expenses opens the expense report (incl. today’s bill)', pg.input_value('#rp') == 'expenses' and 'Reports test bill' in pg.inner_text('.rp-res'))
    pg.click('#genDlg [data-close]')
    pg.click('#catAll'); pg.wait_for_function("document.getElementById('msg').textContent.includes('Report')")
    ok('Category view: report total = sales', abs(num(pg.inner_text('.rp-res tfoot td:nth-child(5)')) - float(c_['sales'])) < 1, pg.inner_text('.rp-res tfoot'))
    pg.click('#genDlg [data-close]')
    # date range
    pg.click('#rangeBtn'); pg.click('#presets [data-p="today"]'); pg.wait_for_function("!document.querySelector('#kSales .dz-skel')"); pg.wait_for_timeout(1200)
    ot = R('reports_overview', {'p_from': TODAY, 'p_to': TODAY})['current']
    ok('Range Today: KPIs recalculated', pg.inner_text('#kSales') == inr0(ot['sales']) and pg.inner_text('#kExp') == inr0(ot['expenses']) and '(Today)' in pg.inner_text('#ovLabel'), (pg.inner_text('#kSales'), ot))
    pg.click('#rangeBtn'); pg.fill('#hFrom', TODAY); pg.fill('#hTo', MS if MS < TODAY else '2000-01-01'); pg.click('#rangeApply')
    ok('Custom range: From after To refused', 'cannot be after' in pg.inner_text('#rangeErr'))
    pg.fill('#hFrom', '2000-01-01'); pg.fill('#hTo', TODAY); pg.click('#rangeApply')
    ok('Custom range over 5 years refused', '5 years' in pg.inner_text('#rangeErr'))
    pg.click('#rangeCancel')
    # export overview
    pg.click('#exportBtn'); pg.click('[data-exp="print"]'); pg.wait_for_timeout(400)
    ok('Export: print overview', not errs, errs)
    pg.click('#exportBtn'); pg.click('[data-exp="ovxls"]'); pg.wait_for_timeout(1200)
    ok('Export Excel offline shows a clear message (no crash)', 'dl-toast show' in pg.get_attribute('#toast', 'class'), pg.get_attribute('#toast', 'class'))
    ok('No page errors (desktop)', not errs, errs)
    c.close()

    # deep link
    c, pg, errs = ctx(b, 'admin')
    open_page(pg, '?report=expiry&run=1'); pg.wait_for_function("document.getElementById('msg').textContent.includes('Report')")
    ok('Deep link ?report=expiry&run opens and runs it (admin)', pg.input_value('#rp') == 'expiry' and pg.is_visible('.rp-out-head'))
    c.close()

    # mobile
    c, pg, errs = ctx(b, 'super_admin', 390, 844, True)
    open_page(pg)
    ok('Mobile: no horizontal overflow', pg.evaluate('document.documentElement.scrollWidth') <= 390)
    vis = [t for t in pg.eval_on_selector_all('#types button', 'e=>e.filter(x=>x.offsetParent).map(x=>x.textContent.trim())')]
    ok('Mobile: 4 report types + More', vis == ['Sales Report', 'Purchase Report', 'Inventory Report', 'Customer Report', 'More'], vis)
    ok('Mobile: KPIs 2 per row', pg.evaluate("(()=>{const k=[...document.querySelectorAll('.rp-kpis .dz-kpi')].map(x=>x.getBoundingClientRect().top);return k[0]===k[1]&&k[2]>k[1]})()"))
    pg.click('#typesMore'); pg.wait_for_selector('#puDlg[open] [data-sheet]')
    ok('Mobile: More shows all 9 report types', len(pg.query_selector_all('#puPanel [data-sheet]')) == 9)
    pg.click('#puPanel [data-sheet="returns"]'); pg.wait_for_selector('#genDlg[open]')
    ok('Mobile: Returns type opens the returns report', pg.input_value('#rp') == 'returns')
    run_in_dialog(pg)
    ok('Mobile: report table scrolls inside the dialog', pg.evaluate('document.documentElement.scrollWidth') <= 390 and 'success' in pg.get_attribute('#msg', 'class'))
    ok('No page errors (mobile)', not errs, errs)
    c.close()

    # roles
    c, pg, errs = ctx(b, 'pharmacist')
    pg.goto(BASE + '/reports.html'); pg.wait_for_timeout(2000)
    ok('Pharmacist cannot open reports', pg.query_selector('#kSales') is None)
    c.close()

    # without 0029
    fns = ['reports_overview', 'reports_sales_by_category', 'report_run_log', 'report_runs_list', 'report_run_delete']
    for f in fns: SQL(f'alter function {f} rename to {f}_off')
    c, pg, errs = ctx(b, 'super_admin')
    open_page(pg)
    ok('Without 0029: message to run it, KPIs from existing reports', '0029' in pg.inner_text('#pmsg') and pg.inner_text('#kSales') == inr0(c_['sales']) and pg.inner_text('#kNet') == inr0(c_['net_profit']), (pg.inner_text('#pmsg'), pg.inner_text('#kSales'), pg.inner_text('#kNet')))
    pg.click('[data-quick="today"]'); pg.wait_for_function("document.getElementById('msg').textContent.includes('Report')"); pg.click('#genDlg [data-close]'); pg.wait_for_timeout(500)
    ok('Without 0029: history kept in this browser', "Sales report" in pg.inner_text('#recentRows'), pg.inner_text('#recentRows'))
    ok('Without 0029: no page errors', not errs, errs)
    for f in fns: SQL(f'alter function {f}_off rename to {f}')
    c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
