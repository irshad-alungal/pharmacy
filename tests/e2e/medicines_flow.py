# Medicines page: every figure and control, checked against the database.
import json, re, os, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'billing_staff': '0c000000-0000-0000-0000-000000000002', 'inventory_staff': '0c000000-0000-0000-0000-000000000003', 'pharmacist': '0c000000-0000-0000-0000-000000000004'}
TODAY = datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Kolkata')).strftime('%Y-%m-%d')
def api(kind, body, user='super_admin'):
    r = urllib.request.Request(BASE + '/api/' + kind, data=json.dumps({'user': U[user], **body}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
def Q(t, cols, user='super_admin', **k): return api('query', {'q': dict({'table': t, 'op': 'select', 'cols': cols, 'filters': [], 'order': [], 'single': None, 'count': None, 'limit': None, 'offset': None, 'values': None, 'returning': None}, **k)}, user)['data']
P = F = 0
def ok(n, c, x=''):
    global P, F
    P += bool(c); F += not c
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else '  → ' + str(x)[:400]))
num = lambda s: float(re.sub(r'[^0-9.\-]', '', s) or 0)
def med(name): return (Q('medicines', 'id,name,active,category_id,manufacturer_id,barcode,reorder_level,tax_rate,dosage_form,discount_percentage,rack', filters=[['eq', 'name', name]]) or [None])[0]

def ctx(b, who, w=1536, h=1000, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    c.add_init_script(f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));")
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return c, pg, errs

# expected figures from the database (same rules as billing: unexpired, not quarantined, active batches)
meds = Q('medicines', 'id,name,reorder_level,active')
bats = Q('medicine_batches', 'medicine_id,qty,expiry,quarantined,stock_status', filters=[['gt', 'qty', 0]])
sell = {}
for x in bats:
    if x['expiry'] > TODAY and not x['quarantined'] and x['stock_status'] == 'active': sell[x['medicine_id']] = sell.get(x['medicine_id'], 0) + float(x['qty'])
act = [m for m in meds if m['active']]
def st(m):
    q = sell.get(m['id'], 0); lvl = float(m['reorder_level'] or 0)
    return 'out' if q <= 0 else 'low' if lvl > 0 and q <= lvl else 'in'
E = {s: sum(1 for m in act if st(m) == s) for s in ('in', 'low', 'out')}

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    c, pg, errs = ctx(b, 'super_admin')
    pg.on('dialog', lambda d: d.accept('Test reason') if d.type == 'prompt' else d.accept())
    pg.goto(BASE + '/medicines.html'); pg.wait_for_selector('#rows tr[data-id]'); pg.wait_for_timeout(1200)
    ok('Layout: branded sidebar with Medicines active, no footer block', 'active' in pg.get_attribute('.pp-nav-link[href="medicines.html"]', 'class') and 'Trusted' not in pg.inner_text('#ppSidebar'))
    ok(f'Total Medicines = {len(act)}', num(pg.inner_text('#kTotal')) == len(act), pg.inner_text('#kTotal'))
    ok(f"In / Low / Out = {E['in']}/{E['low']}/{E['out']}", [num(pg.inner_text(x)) for x in ('#kIn', '#kLow', '#kOut')] == [E['in'], E['low'], E['out']], [pg.inner_text(x) for x in ('#kIn', '#kLow', '#kOut')])
    dolo = next(m for m in meds if m['name'] == 'Dolo')
    pg.fill('#q', 'Dolo'); pg.wait_for_timeout(500)
    ok('Search filters the list', pg.locator('#rows tr[data-id]').count() == 1 and 'Dolo' in pg.inner_text('#rows'))
    ok(f"Dolo stock = {sell.get(dolo['id'], 0):.0f} (sellable batches)", num(pg.inner_text('#rows .c-stock')) == sell.get(dolo['id'], 0), pg.inner_text('#rows .c-stock'))
    pg.click('#rows tr[data-id]'); pg.wait_for_timeout(300)
    det = pg.inner_text('#details')
    ok('Details panel: FEFO batch D-A, Jan 2027, MRP ₹30.00', 'D-A' in det and 'Jan 2027' in det and '₹30.00' in det, det)
    pg.click('#resetBtn'); pg.wait_for_timeout(300)
    pg.click('[data-kpi="kLow"]'); pg.wait_for_timeout(300)
    ok('Clicking Low Stock KPI filters low-stock medicines', pg.locator('#rows tr[data-id]').count() == min(E['low'], 10) and 'Out of Stock' not in pg.inner_text('#rows'))
    pg.click('#resetBtn'); pg.wait_for_timeout(300)

    # Add medicine with the new fields (new category via prompt)
    pg.click('#new'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#f [name=name]', 'Levocetirizine'); pg.fill('#f [name=strength]', '5 mg'); pg.fill('#f [name=dosage_form]', 'Tablet')
    pg.select_option('#fCatSel', '__new'); pg.wait_for_timeout(800)   # prompt answers "Test reason" → new category
    pg.select_option('#fMan', label='Cipla'); pg.fill('#f [name=barcode]', '8909990001112'); pg.fill('#f [name=reorder_level]', '30'); pg.fill('#f [name=tax_rate]', '5')
    pg.click('#f button[type=submit]'); pg.wait_for_timeout(1800)
    m = med('Levocetirizine')
    cats = {c['id']: c['name'] for c in Q('categories', 'id,name')}
    ok('Add: saved with category, manufacturer, barcode, minimum stock, GST, form', m and cats.get(m['category_id']) == 'Test reason' and m['manufacturer_id'] and m['barcode'] == '8909990001112' and float(m['reorder_level']) == 30 and float(m['tax_rate']) == 5 and m['dosage_form'] == 'Tablet', m)
    ok('Add: new medicine selected in the details panel', 'Levocetirizine' in pg.inner_text('#details'))
    # Duplicate barcode is refused
    pg.click('[data-qa="duplicate"]'); pg.wait_for_selector('#dlg[open]')
    ok('Duplicate: form pre-filled as a copy without barcode', pg.input_value('#f [name=name]') == 'Levocetirizine (copy)' and pg.input_value('#f [name=barcode]') == '')
    pg.fill('#f [name=barcode]', '8909990001112'); pg.click('#f button[type=submit]'); pg.wait_for_timeout(500)
    ok('Duplicate barcode is refused', 'already used' in pg.inner_text('#err'), pg.inner_text('#err'))
    pg.fill('#f [name=barcode]', ''); pg.click('#f button[type=submit]'); pg.wait_for_timeout(1500)
    ok('Duplicate: copy saved', med('Levocetirizine (copy)') is not None)
    # Edit
    pg.fill('#q', 'Levocetirizine (copy)'); pg.wait_for_timeout(400); pg.click('#rows tr[data-id]')
    pg.click('[data-qa="edit"]'); pg.wait_for_selector('#dlg[open]'); pg.fill('#f [name=rack]', 'C-09'); pg.click('#f button[type=submit]'); pg.wait_for_timeout(1500)
    ok('Edit: rack saved', med('Levocetirizine (copy)')['rack'] == 'C-09')
    pg.click('#resetBtn'); pg.wait_for_timeout(300)

    # Bulk update selected
    pg.fill('#q', 'Levocetirizine'); pg.wait_for_timeout(400)
    for el in pg.query_selector_all('#rows [data-pick]'): el.check(force=True)
    pg.wait_for_timeout(200)
    ok('Selection bar shows 2 selected', '2 medicine' in pg.inner_text('#selText'))
    pg.click('#bulkBtn'); pg.wait_for_selector('#bDisc'); pg.fill('#bDisc', '7.5%'); pg.fill('#bMin', '12'); pg.click('#bSave'); pg.wait_for_timeout(1800)
    a, bb = med('Levocetirizine'), med('Levocetirizine (copy)')
    ok('Bulk update: discount and minimum stock changed on both', float(a['discount_percentage']) == 7.5 and float(bb['discount_percentage']) == 7.5 and float(a['reorder_level']) == 12, (a, bb))
    pg.click('#resetBtn'); pg.wait_for_timeout(300)

    # Update stock (adjust a batch), history, cost history, label
    pg.fill('#q', 'Cetirizine 10'); pg.wait_for_timeout(400); pg.click('#rows tr[data-id]')
    before = num(pg.inner_text('#rows .c-stock'))
    pg.click('[data-qa="stock"]'); pg.wait_for_selector('[data-adj]'); pg.click('[data-adj] >> nth=0')
    pg.select_option('#adjKind', 'adjustment+'); pg.fill('#adjQty', '5'); pg.fill('#adjReason', 'Count correction'); pg.click('#adjForm button[type=submit]'); pg.wait_for_timeout(1800)
    pg.click('#mdDlg [data-close]')
    ok('Update stock: +5 adjustment raises the stock', num(pg.inner_text('#rows .c-stock')) == before + 5, (before, pg.inner_text('#rows .c-stock')))
    pg.click('[data-qa="history"]'); pg.wait_for_timeout(1200)
    ok('View history: the adjustment is listed', 'Count correction' in pg.inner_text('#hBody'), pg.inner_text('#hBody')[:200])
    pg.click('#hTabs [data-h="cost"]'); pg.wait_for_timeout(1000)
    ok('View history: purchase cost tab (admin)', 'KPD-1001' in pg.inner_text('#hBody') or 'cost' in pg.inner_text('#hBody').lower())
    pg.click('#mdDlg [data-close]')
    cid = Q('medicines', 'id', filters=[['eq', 'name', 'Cetirizine']])[0]['id']
    api('query', {'q': {'table': 'medicines', 'op': 'update', 'cols': None, 'filters': [['eq', 'id', cid]], 'order': [], 'single': None, 'count': None, 'limit': None, 'offset': None, 'values': {'barcode': '8901234500012'}, 'returning': None}})
    pg.reload(); pg.wait_for_selector('#rows tr[data-id]'); pg.fill('#q', 'Cetirizine 10'); pg.wait_for_timeout(400); pg.click('#rows tr[data-id]')
    with pg.expect_popup() as pop:
        pg.click('[data-qa="label"]'); pg.wait_for_selector('#lbPrint'); pg.click('#lbPrint')
    lw = pop.value; lw.wait_for_load_state()
    ok('Print label opens a printable label with the barcode', 'Cetirizine' in lw.content() and '<svg' in lw.content(), lw.content()[:200])
    lw.close()

    # Row menu → photos / view details
    pg.click('#rows [data-menu]'); pg.click('.md-row-menu [data-photos]'); pg.wait_for_timeout(800)
    ok('Row menu: Photos opens the photo manager', pg.query_selector('#medicinePhotosDialog[open]') is not None)
    pg.click('#mpClose')
    pg.click('#rows [data-menu]'); pg.click('.md-row-menu [data-act="view"]'); pg.wait_for_timeout(1000)
    ok('Row menu: View details opens the full profile with batches', 'Current batch stock' in pg.inner_text('#viewContent'))
    pg.click('#viewClose')

    # Deactivation request → super admin approves → shows as inactive → activate
    pg.fill('#q', 'Levocetirizine (copy)'); pg.wait_for_timeout(400); pg.click('#rows tr[data-id]')
    pg.click('[data-qa="delete"]'); pg.wait_for_timeout(1500)
    ok('Delete → deactivation request appears for Super Admin', not pg.is_hidden('#reqCard') and 'Levocetirizine (copy)' in pg.inner_text('#deactivationRequests'))
    pg.click('#deactivationRequests [data-approve]'); pg.wait_for_timeout(2000)
    ok('Approve deactivates the medicine', med('Levocetirizine (copy)')['active'] is False)
    pg.select_option('#fStock', 'inactive'); pg.wait_for_timeout(300)
    ok('Inactive filter shows it', 'Levocetirizine (copy)' in pg.inner_text('#rows'))
    pg.click('#rows tr[data-id]'); pg.click('[data-qa="delete"]'); pg.wait_for_timeout(1500)
    ok('Super Admin re-activates it (button becomes Activate)', med('Levocetirizine (copy)')['active'] is True)

    # Export (CSV fallback when the Excel library is offline)
    pg.click('#resetBtn'); pg.wait_for_timeout(200)
    with pg.expect_download() as dl:
        pg.click('#exportBtn')
    path = dl.value.path(); text = open(path, encoding='utf-8-sig').read()
    ok('Export downloads the filtered list', text.count('\n') == len([m for m in Q('medicines', 'id,active') if m['active']]) and 'Medicine name' in text, text[:200])
    # Paging
    pg.select_option('#perPage', '10'); pg.wait_for_timeout(200)
    ok('Pagination shows 10 per page', pg.locator('#rows tr[data-id]').count() == min(10, len([m for m in Q('medicines', 'id,active') if m['active']])))
    ok('No page errors (super admin)', not errs, errs)
    c.close()

    # billing staff: can add, cannot bulk update
    c, pg, errs = ctx(b, 'billing_staff', 390, 844, True)
    pg.goto(BASE + '/medicines.html'); pg.wait_for_selector('#rows tr[data-id]'); pg.wait_for_timeout(1000)
    ok('Mobile: no horizontal scroll', pg.evaluate('document.documentElement.scrollWidth') <= 390, pg.evaluate('document.documentElement.scrollWidth'))
    ok('Billing staff: can add and bulk-update medicines (same staff pages, 0037)', pg.query_selector('#bulkBtn') is not None)
    pg.click('#mSearch'); pg.fill('#q', 'Pan'); pg.wait_for_timeout(400)
    ok('Mobile search works', 'Pan' in pg.inner_text('#rows') and 'Dolo' not in pg.inner_text('#rows'))
    ok('No page errors (billing staff, mobile)', not errs, errs)
    c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
