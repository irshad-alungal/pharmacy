# Distributors page: every figure and control, checked against the database.
import json, re, os, datetime, zoneinfo, urllib.request, tempfile
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
def dist(name): return next((d for d in Q('distributors', 'id,name,phone,gstin,contact_person,email,drug_licence,address,active') if d['name'] == name), None)
def payable(did): return next((float(r['balance']) for r in R('payable_balances')['data'] if r['distributor_id'] == did), 0.0)
def ctx(b, who, w=1536, h=1000, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    c.add_init_script(f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));")
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return c, pg, errs
def open_page(pg, q=''):
    pg.goto(BASE + '/distributors.html' + q); pg.wait_for_selector('#rows tr[data-id]'); pg.wait_for_timeout(1000)
def row(pg, name): return pg.locator('#rows tr[data-id]', has_text=name)
def menu(pg, name, act):
    row(pg, name).locator('[data-menu]').click(); pg.click(f'.pur-row-menu {act}')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    c, pg, errs = ctx(b, 'super_admin')
    pg.on('dialog', lambda d: d.accept())
    open_page(pg)
    ok('Layout: branded sidebar with Distributors active, no footer block', 'active' in pg.get_attribute('.pp-nav-link[href="distributors.html"]', 'class') and 'Trusted' not in pg.inner_text('#ppSidebar'))
    ok('Header: Add Distributor, Import, Export, ⋯', all(pg.is_visible(x) for x in ('#new', '#importBtn', '#exportBtn', '#moreBtn')))
    D = Q('distributors', 'id,name,active')
    ok(f'Total Distributors = {len(D)}', num(pg.inner_text('#kTotal')) == len(D))
    ok(f"Active Distributors = {sum(d['active'] for d in D)}", num(pg.inner_text('#kActive')) == sum(d['active'] for d in D) and '%' in pg.inner_text('#kActiveNote'))
    bills = [x for x in R('purchase_list_v2', {'p_from': None, 'p_to': None, 'p_limit': 5000})['data'] if x['status'] != 'cancelled' and x['invoice_date'] >= TODAY[:8] + '01']
    ok('Total Purchase Value = this month\'s bills', abs(num(pg.inner_text('#kValue')) - round(sum(float(x['total']) for x in bills))) <= 1, pg.inner_text('#kValue'))
    pb = [r for r in R('payable_balances')['data'] if float(r['balance']) > 0]
    ok('Outstanding = payable balances', abs(num(pg.inner_text('#kOut')) - round(sum(float(r['balance']) for r in pb))) <= 1 and f'{len(pb)} distributor' in pg.inner_text('#kOutNote'), [pg.inner_text('#kOut'), pb])
    ok('List shows every distributor with contact columns', pg.locator('#rows tr[data-id]').count() == len(D) and 'Kerala Pharma Distributors' in pg.inner_text('#rows'))
    ok('Phone has call and WhatsApp links', row(pg, 'Kerala Pharma').locator('a[href^="tel:"]').count() >= 1 and row(pg, 'Kerala Pharma').locator('a[href*="wa.me/91"]').count() >= 1)
    ok('Chart, top distributors and summary render', pg.locator('#chart svg').count() == 1 and pg.locator('#topRows tr[data-dist]').count() >= 1 and pg.locator('#sumTiles > button').count() == 4)

    # add with GSTIN check and duplicate warning
    pg.click('#new'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#f [name=name]', 'Kerala Pharma Distributors'); pg.wait_for_timeout(100)
    ok('Duplicate name warning while typing', pg.is_visible('#dupHint') and 'already exists' in pg.inner_text('#dupHint'))
    pg.fill('#f [name=name]', 'Bismik Medical Agencies'); pg.fill('#f [name=contact_person]', 'Faisal'); pg.fill('#f [name=phone]', '+91 9747616905\n0483 2741000')
    pg.fill('#f [name=email]', 'kimsktkl@gmail.com'); pg.fill('#f [name=gstin]', '32aacfb8381r1zz'); pg.dispatch_event('#fGst', 'input')
    ok('GSTIN hint shows the state', 'Kerala' in pg.inner_text('#gstHint'), pg.inner_text('#gstHint'))
    pg.fill('#f [name=drug_licence]', 'WLF20B2023KL001290'); pg.fill('#f [name=address]', 'Thoppil Hamzath Road, Kottakkal')
    pg.click('#f button[type=submit]'); pg.wait_for_timeout(1800)
    bm = dist('Bismik Medical Agencies')
    ok('Add: saved with uppercase GSTIN and both phones', bm and bm['gstin'] == '32AACFB8381R1ZZ' and bm['phone'] == '+91 9747616905, 0483 2741000' and bm['contact_person'] == 'Faisal', bm)
    ok('Add: KPI and list update', num(pg.inner_text('#kTotal')) == len(D) + 1 and 'Bismik' in pg.inner_text('#rows'))
    menu(pg, 'Bismik', '[data-act="edit"]'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#f [name=contact_person]', 'Faisal K'); pg.click('#f button[type=submit]'); pg.wait_for_timeout(1500)
    ok('Edit: contact person saved', dist('Bismik Medical Agencies')['contact_person'] == 'Faisal K')

    # search / filters
    pg.fill('#q', '97476'); pg.wait_for_timeout(400)
    ok('Search by phone digits', pg.locator('#rows tr[data-id]').count() == 1 and 'Bismik' in pg.inner_text('#rows'))
    pg.fill('#q', 'faisal'); pg.wait_for_timeout(400)
    ok('Search by contact person', 'Bismik' in pg.inner_text('#rows') and pg.locator('#rows tr[data-id]').count() == 1)
    pg.fill('#q', ''); pg.wait_for_timeout(300)
    pg.click('#filterBtn'); pg.check('#fNoGst'); pg.click('#fApply'); pg.wait_for_timeout(300)
    ok('Filter: GSTIN missing', all(not d.get('gstin') for d in [dist(n) for n in [t.split('\n')[0] for t in pg.locator('#rows .ds-name b').all_inner_texts()]]) and pg.locator('#rows tr[data-id]').count() >= 1)
    pg.click('#filterBtn'); pg.click('#fReset'); pg.wait_for_timeout(300)
    pg.click('#filterBtn'); pg.select_option('#sortBy', 'value'); pg.click('#fApply'); pg.wait_for_timeout(300)
    ok('Sort by purchase value puts the supplier with bills first', 'Kerala Pharma' in pg.locator('#rows .ds-name b').first.inner_text())
    pg.click('#filterBtn'); pg.click('#fReset'); pg.wait_for_timeout(300)

    # details, invoice, payment
    row(pg, 'Kerala Pharma').locator('[data-v]').click(); pg.wait_for_timeout(1500)
    vt = pg.inner_text('#viewBody')
    ok('Details: GSTIN, bills, payable, purchase history', 'KPD-1001' in vt and 'Purchase bills' in vt and 'Payable now' in vt and '32AAACK1234L1Z2' in vt, vt[:300])
    pg.click('#viewBody [data-invoice]'); pg.wait_for_timeout(1200)
    ok('Details: invoice lines open inside the dialog', 'D-A' in pg.inner_text('#viewBody') and pg.is_visible('#backHistory'))
    pg.click('#backHistory'); pg.wait_for_timeout(1200)
    pg.click('#viewClose')
    kp = dist('Kerala Pharma Distributors'); before = payable(kp['id'])
    menu(pg, 'Kerala Pharma', '[data-act="pay"]'); pg.wait_for_selector('#payAmt')
    ok('Payment defaults to the payable', abs(float(pg.input_value('#payAmt')) - before) < .01, [pg.input_value('#payAmt'), before])
    pg.fill('#payAmt', '1000'); pg.select_option('#payMode', 'upi'); pg.fill('#payRef', 'UTR77'); pg.click('#paySave'); pg.wait_for_timeout(1500)
    ok('Record payment reduces the payable by ₹1,000', abs(payable(kp['id']) - (before - 1000)) < .01, [before, payable(kp['id'])])

    # deactivate / activate
    menu(pg, 'Bismik', '[data-act="toggle"]'); pg.wait_for_timeout(1500)
    ok('Deactivate from the row menu', dist('Bismik Medical Agencies')['active'] is False)
    pg.select_option('#fStatus', 'inactive'); pg.wait_for_timeout(300)
    ok('Status filter: inactive', pg.locator('#rows tr[data-id]').count() == 1 and 'Inactive' in pg.inner_text('#rows'))
    menu(pg, 'Bismik', '[data-act="toggle"]'); pg.wait_for_timeout(1500)
    ok('Activate again', dist('Bismik Medical Agencies')['active'] is True)
    pg.select_option('#fStatus', ''); pg.wait_for_timeout(300)

    # row menu links into Purchases
    row(pg, 'Bismik').locator('[data-menu]').click()
    hrefs = pg.eval_on_selector_all('.pur-row-menu a', 'els => els.map(e => e.getAttribute("href"))')
    ok('Row menu: new bill / order for this distributor, view purchases, call, WhatsApp, email', any(f'new=1&dist={bm["id"]}' in h for h in hrefs) and any(f'order=1&dist={bm["id"]}' in h for h in hrefs) and any(h.startswith('tel:') for h in hrefs) and any('wa.me' in h for h in hrefs) and any(h.startswith('mailto:') for h in hrefs), hrefs)
    pg.keyboard.press('Escape'); pg.mouse.click(5, 5)

    # import / export / duplicates
    csv = 'Name,Contact person,Phone,Email,GSTIN,Drug licence,Address,Active\nCrown Pharma,Girish,+91 7034534682,,32AAIFC7928F1ZI,RLF20B2023KL000404,"Emerald Tower, Wandoor",Yes\nMalabar Medicals,Shibu,,,,DL-998,,Yes\nBad Row,,,,32ABC,,,\n'
    path = os.path.join(tempfile.gettempdir(), 'dist_import.csv'); open(path, 'w').write(csv)
    pg.click('#importBtn'); pg.wait_for_selector('[data-imp="file"]')
    pg.set_input_files('#importFile', path); pg.wait_for_timeout(2500)
    res = pg.inner_text('#impResult')
    ok('Import CSV: 1 added, 1 updated, 1 skipped with reason', '1 added' in res and '1 updated' in res and '1 skipped' in res and 'GSTIN' in res, res)
    ok('Import: new distributor saved', (dist('Crown Pharma') or {}).get('drug_licence') == 'RLF20B2023KL000404')
    ok('Import: existing distributor updated (blank cells keep old values)', dist('Malabar Medicals')['contact_person'] == 'Shibu' and dist('Malabar Medicals')['phone'] == '9847022222')
    pg.click('#puDlg [data-close]')
    with pg.expect_download() as d: pg.click('#exportBtn')
    txt = open(d.value.path(), encoding='utf-8-sig').read()
    ok('Export: CSV with every listed distributor and payable', d.value.suggested_filename.endswith('.csv') and txt.count('\n') == len(Q('distributors', 'id')) and 'Payable' in txt, [txt.count('\n')])
    pg.click('#moreBtn'); pg.click('[data-more="dupes"]'); pg.wait_for_timeout(300)
    ok('Find duplicates dialog opens', 'Possible duplicates' in pg.inner_text('#puPanel'))
    pg.click('#puDlg [data-close]')
    pg.click('[data-kpi="kOut"]'); pg.wait_for_timeout(300)
    ok('Outstanding KPI lists distributors with dues', pg.input_value('#fStatus') == 'dues' and pg.locator('#rows tr[data-id]').count() == len([r for r in R('payable_balances')['data'] if float(r['balance']) > 0.005]))
    ok('No page errors (admin)', not errs, errs)

    # Purchases deep link preselects the supplier
    pg.goto(BASE + f'/purchases.html?new=1&dist={bm["id"]}'); pg.wait_for_selector('#purchaseDialog[open]'); pg.wait_for_timeout(800)
    ok('Purchases ?new=1&dist= opens the bill with this supplier', pg.input_value('#supplier') == bm['id'] and 'Bismik' in pg.inner_text('#supCard'))
    c.close()

    # inventory staff: no money
    c, pg, errs = ctx(b, 'inventory_staff'); open_page(pg)
    ok('Inventory staff: open orders KPI instead of outstanding, bills instead of ₹', 'Open Purchase Orders' in pg.inner_text('[data-kpi="kOut"]') and 'bills' in pg.inner_text('#kValue'))
    row(pg, 'Kerala Pharma').locator('[data-menu]').click()
    ok('Inventory staff: no payment action, can edit', pg.locator('.pur-row-menu [data-act="pay"]').count() == 0 and pg.locator('.pur-row-menu [data-act="edit"]').count() == 1)
    ok('No page errors (inventory staff)', not errs, errs); c.close()

    # mobile
    c, pg, errs = ctx(b, 'super_admin', 390, 844, True); open_page(pg)
    ok('Mobile: no sideways scroll', pg.evaluate('document.documentElement.scrollWidth') <= 390)
    tops = [pg.locator(x).bounding_box()['y'] for x in ('#new', '#importBtn', '#exportBtn', '#moreBtn')]
    ok('Mobile: header buttons in one row', max(tops) - min(tops) < 2, tops)
    k = [pg.locator(f'[data-kpi="{x}"]').bounding_box() for x in ('kTotal', 'kActive', 'kValue', 'kOut')]
    ok('Mobile: KPIs in a 2 × 2 grid', abs(k[0]['y'] - k[1]['y']) < 2 and k[2]['y'] > k[0]['y'] + 20)
    ok('Mobile: rows show contact person and phone', 'Faisal K' in pg.inner_text('#rows'))
    ok('No page errors (mobile)', not errs, errs); c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
