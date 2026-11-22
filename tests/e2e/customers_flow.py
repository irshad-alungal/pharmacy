# Customers page: every figure and control, checked against the database.
import json, re, os, datetime, zoneinfo, urllib.request, tempfile
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'billing_staff': '0c000000-0000-0000-0000-000000000002', 'inventory_staff': '0c000000-0000-0000-0000-000000000003', 'pharmacist': '0c000000-0000-0000-0000-000000000004'}
IST = zoneinfo.ZoneInfo('Asia/Kolkata')
NOW = datetime.datetime.now(IST)
TODAY = NOW.strftime('%Y-%m-%d')
def api(kind, body, user='super_admin'):
    r = urllib.request.Request(BASE + '/api/' + kind, data=json.dumps({'user': U[user], **body}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
def R(name, args=None, user='super_admin'): return api('rpc', {'name': name, 'args': args or {}}, user)
def Q(t, cols, user='super_admin', **k): return api('query', {'q': dict({'table': t, 'op': 'select', 'cols': cols, 'filters': [], 'order': [], 'single': None, 'count': None, 'limit': None, 'offset': None, 'values': None, 'returning': None}, **k)}, user)['data']
def SQL(sql, params=None): return api('ownersql', {'sql': sql, 'params': params or []})
P = F = 0
def ok(n, c, x=''):
    global P, F
    P += bool(c); F += not c
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else '  → ' + str(x)[:400]))
num = lambda s: float(re.sub(r'[^0-9.\-]', '', s) or 0)
COLS = 'id,name,phone,email,customer_no,loyalty_member,loyalty_joined_at,dob,notes,active,credit_limit,consent,age'
def cust(name): return next((c for c in Q('customers', COLS) if c['name'] == name), None)
def outstanding(cid): return float(R('customer_outstanding', {'p_customer': cid})['data'] or 0)
def ctx(b, who, w=1536, h=1000, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    c.add_init_script(f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));")
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return c, pg, errs
def open_page(pg, q=''):
    pg.goto(BASE + '/customers.html' + q); pg.wait_for_selector('#rows tr[data-id]'); pg.wait_for_timeout(1000)
def row(pg, name): return pg.locator('#rows tr[data-id]', has_text=name)
def menu(pg, name, act):
    row(pg, name).locator('[data-menu]').click(); pg.click(f'.pur-row-menu {act}')

# a credit sale for Ravi Kumar so the page has credit to show
ravi = cust('Ravi Kumar')
inv = SQL("insert into sales_invoices(branch_id,invoice_no,customer_id,total,subtotal,status,created_by) values ('0b000000-0000-0000-0000-000000000001','TCR-1',$1,300,300,'final','0c000000-0000-0000-0000-000000000001') returning id", [ravi['id']])['data'][0]['id']
SQL("insert into payments(branch_id,invoice_id,method,amount) values ('0b000000-0000-0000-0000-000000000001',$1,'credit',300)", [inv])
SQL("insert into sales_invoices(branch_id,invoice_no,customer_id,total,subtotal,status,created_by) values ('0b000000-0000-0000-0000-000000000001','TCR-2',$1,150,150,'final','0c000000-0000-0000-0000-000000000001')", [ravi['id']])

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    c, pg, errs = ctx(b, 'super_admin')
    answers = []
    pg.on('dialog', lambda d: d.accept(answers.pop(0) if answers else '') if d.type == 'prompt' else d.accept())
    open_page(pg)
    ok('Layout: branded sidebar with Customers active, no footer block', 'active' in pg.get_attribute('.pp-nav-link[href="customers.html"]', 'class') and 'Trusted' not in pg.inner_text('#ppSidebar'))
    ok('Header: Add Customer, Import, Export, ⋯', all(pg.is_visible(x) for x in ('#new', '#importBtn', '#exportBtn', '#moreBtn')))
    C = Q('customers', COLS); S = {s['customer_id']: s for s in R('customer_stats')['data']}
    ok(f'Total Customers = {len(C)}', num(pg.inner_text('#kTotal')) == len(C))
    ok('Active Customers and % of total', num(pg.inner_text('#kActive')) == sum(x['active'] for x in C) and '%' in pg.inner_text('#kActiveNote'))
    rep = sum(1 for x in C if S.get(x['id'], {}).get('bills', 0) >= 2)
    ok(f'Repeat Customers (2+ bills) = {rep}', num(pg.inner_text('#kRepeat')) == rep, pg.inner_text('#kRepeat'))
    ok('Loyalty Members = DB', num(pg.inner_text('#kLoyal')) == sum(x['loyalty_member'] for x in C))
    ok('Customer IDs assigned and shown', all(x['customer_no'] and x['customer_no'].startswith('CUS-') for x in C) and ravi['customer_no'] in pg.inner_text('#rows'))
    rv = row(pg, 'Ravi Kumar')
    ok('Total purchases and due shown for Ravi (₹450, due ₹300)', '₹450.00' in rv.inner_text() and 'Due ₹300' in rv.inner_text(), rv.inner_text())
    ok('Growth chart, top customers and summary render', pg.locator('#chart svg').count() == 1 and 'Ravi Kumar' in pg.inner_text('#topRows') and pg.locator('#sumTiles > button').count() == 4)

    # add with dob, loyalty, notes
    pg.click('#new'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#f [name=phone]', ravi['phone'][-10:]); pg.dispatch_event('#cPhone', 'input')
    ok('Duplicate phone warning while typing', pg.is_visible('#dupHint') and 'Ravi Kumar' in pg.inner_text('#dupHint'))
    dob = f'1990-{TODAY[5:7]}-15'
    pg.fill('#f [name=name]', 'Ajay Kumar'); pg.fill('#f [name=phone]', '9876543210'); pg.fill('#f [name=email]', 'ajay.kumar@email.com')
    pg.fill('#cDob', dob); pg.dispatch_event('#cDob', 'change')
    ok('Age filled from date of birth', pg.input_value('#cAge') == str(NOW.year - 1990 - (1 if int(TODAY[8:]) < 15 else 0)), pg.input_value('#cAge'))
    pg.fill('#f [name=notes]', 'BP patient'); pg.check('#f [name=consent]'); pg.check('#f [name=loyalty_member]')
    pg.click('#f button[type=submit]'); pg.wait_for_timeout(1500)
    aj = cust('Ajay Kumar')
    ok('Add: saved with customer ID, dob, notes, loyalty date, +91 phone', aj and aj['customer_no'] == f"CUS-{len(C) + 1:05d}" and aj['dob'] == dob and aj['notes'] == 'BP patient' and aj['loyalty_joined_at'] and aj['phone'] == '+919876543210', aj)
    ok('Add: KPIs update', num(pg.inner_text('#kTotal')) == len(C) + 1 and num(pg.inner_text('#kLoyal')) == sum(x['loyalty_member'] for x in C) + 1)
    menu(pg, 'Ajay Kumar', '[data-act="edit"]'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#f [name=address]', 'Pallikkal Bazar'); pg.click('#f button[type=submit]'); pg.wait_for_timeout(1300)
    ok('Edit: address saved, ID unchanged', Q('customers', 'address,customer_no', filters=[['eq', 'id', aj['id']]])[0] == {'address': 'Pallikkal Bazar', 'customer_no': aj['customer_no']})

    # search and filters
    for term, label in [(aj['customer_no'], 'customer ID'), ('98765', 'phone digits'), ('ajay.kumar@', 'email')]:
        pg.fill('#q', term); pg.wait_for_timeout(350)
        ok(f'Search by {label}', pg.locator('#rows tr[data-id]').count() == 1 and 'Ajay Kumar' in pg.inner_text('#rows'))
    pg.fill('#q', ''); pg.wait_for_timeout(300)
    pg.select_option('#fStatus', 'loyal'); pg.wait_for_timeout(300)
    ok('Filter: loyalty members', pg.locator('#rows tr[data-id]').count() == num(pg.inner_text('#kLoyal')) and 'Ajay' in pg.inner_text('#rows'))
    pg.select_option('#fStatus', 'bday'); pg.wait_for_timeout(300)
    ok('Filter: birthdays this month', 'Ajay Kumar' in pg.inner_text('#rows'))
    pg.select_option('#fStatus', 'due'); pg.wait_for_timeout(300)
    ok('Filter: with credit due', pg.locator('#rows tr[data-id]').count() == 1 and 'Ravi' in pg.inner_text('#rows'))
    pg.select_option('#fStatus', 'repeat'); pg.wait_for_timeout(300)
    ok('Filter: repeat customers', pg.locator('#rows tr[data-id]').count() == rep and 'Ravi' in pg.inner_text('#rows'))
    pg.select_option('#fStatus', ''); pg.wait_for_timeout(300)
    pg.click('#filterBtn'); pg.select_option('#sortBy', 'spent'); pg.click('#fApply'); pg.wait_for_timeout(300)
    ok('Sort by total purchases puts Ravi first', 'Ravi Kumar' in pg.locator('#rows tr[data-id]').first.inner_text())
    pg.click('#filterBtn'); pg.click('#fReset'); pg.wait_for_timeout(300)

    # details, receive payment, credit limit, loyalty
    row(pg, 'Ravi Kumar').locator('[data-view]').click(); pg.wait_for_timeout(1500)
    vt = pg.inner_text('#customer-view-body')
    ok('Details: ID, total, bills, credit outstanding, available credit', ravi['customer_no'] in vt and '₹450' in vt and 'Credit outstanding' in vt and '₹300' in vt and 'Available credit' in vt, vt[:400])
    ok('Details: bills listed with doctor-sheet upload', pg.locator('#customer-view-body [data-cust-invoice]').count() == 2 and pg.locator(f'[data-sheet-input="{inv}"]').count() == 1)
    pg.click('#customer-view-body [data-cact="receive"]'); pg.wait_for_selector('#rcAmt')
    ok('Receive payment defaults to the outstanding', float(pg.input_value('#rcAmt')) == 300)
    pg.fill('#rcAmt', '100'); pg.select_option('#rcMode', 'upi'); pg.fill('#rcNote', 'UPI 4411'); pg.click('#rcSave'); pg.wait_for_timeout(1800)
    ok('Receive payment: outstanding 300 → 200', abs(outstanding(ravi['id']) - 200) < .01, outstanding(ravi['id']))
    ok('Details refresh with the receipt listed', 'UPI 4411' in pg.inner_text('#customer-view-body'))
    pg.click('#customer-view-body [data-cact="loyal"]'); pg.wait_for_timeout(1500)
    ok('Add to loyalty from details', cust('Ravi Kumar')['loyalty_member'] is True and 'member' in pg.inner_text('#customer-view-body'))
    pg.click('#customer-view-close')
    answers[:] = ['4500']
    menu(pg, 'Ravi Kumar', '[data-act="limit"]'); pg.wait_for_timeout(1300)
    ok('Edit credit limit (admin)', float(cust('Ravi Kumar')['credit_limit']) == 4500)
    menu(pg, 'Ravi Kumar', '[data-act="balance"]'); pg.wait_for_timeout(800)
    ok('Credit status message', 'Outstanding ₹200.00' in pg.inner_text('#msg') and 'Available ₹4300.00' in pg.inner_text('#msg'), pg.inner_text('#msg'))
    menu(pg, 'Joseph', '[data-act="toggle"]'); pg.wait_for_timeout(1300)
    ok('Deactivate from the row menu', cust('Joseph')['active'] is False and 'Inactive' in row(pg, 'Joseph').inner_text())
    menu(pg, 'Joseph', '[data-act="toggle"]'); pg.wait_for_timeout(1300)
    ok('Activate again', cust('Joseph')['active'] is True)
    row(pg, 'Ravi Kumar').locator('[data-menu]').click()
    hrefs = pg.eval_on_selector_all('.pur-row-menu a', 'els => els.map(e => e.getAttribute("href"))')
    ok('Row menu: new bill for this customer, sales, call, WhatsApp', any(f'billing.html?customer={ravi["id"]}' == h for h in hrefs) and any(h.startswith('sales.html?q=') for h in hrefs) and any(h.startswith('tel:') for h in hrefs) and any('wa.me/91' in h for h in hrefs), hrefs)
    pg.mouse.click(5, 5)

    # import / export / more
    csv = 'Name,Phone,Email,Address,Age,Gender,Date of birth,WhatsApp consent,Loyalty member,Notes\nRevathi Nair,9765432109,revathi@email.com,Kondotty,35,female,1991-02-03,Yes,Yes,\nAnu Thomas,9847000002,anu@email.com,,,,,,,Allergic to penicillin\nNo Phone,,,,,,,,,\n'
    path = os.path.join(tempfile.gettempdir(), 'cust_import.csv'); open(path, 'w').write(csv)
    pg.click('#importBtn'); pg.wait_for_selector('[data-imp="file"]'); pg.set_input_files('#importFile', path); pg.wait_for_timeout(2500)
    res = pg.inner_text('#impResult')
    ok('Import CSV: 1 added, 1 updated, 1 skipped', '1 added' in res and '1 updated' in res and '1 skipped' in res, res)
    rn, an = cust('Revathi Nair'), cust('Anu Thomas')
    ok('Import: new customer with loyalty, dob and ID', rn and rn['loyalty_member'] and rn['dob'] == '1991-02-03' and rn['customer_no'].startswith('CUS-'), rn)
    ok('Import: existing customer updated by phone (email, notes)', an['email'] == 'anu@email.com' and an['notes'] == 'Allergic to penicillin', an)
    pg.click('#puDlg [data-close]')
    with pg.expect_download() as d: pg.click('#exportBtn')
    txt = open(d.value.path(), encoding='utf-8-sig').read()
    ok('Export: CSV with ID, purchases, credit due', d.value.suggested_filename.endswith('.csv') and 'Customer ID' in txt and 'Credit due' in txt and txt.count('\n') == len(Q('customers', 'id')), txt.count('\n'))
    pg.click('#moreBtn'); pg.click('[data-more="birthdays"]'); pg.wait_for_timeout(300)
    ok('Birthdays this month with WhatsApp wish', 'Ajay Kumar' in pg.inner_text('#puPanel') and pg.locator('#puPanel a[href*="Happy%20birthday"]').count() >= 1)
    pg.click('#puDlg [data-close]')
    pg.click('#moreBtn'); pg.click('[data-more="dupes"]'); pg.wait_for_timeout(300)
    ok('Find duplicates dialog', 'Possible duplicates' in pg.inner_text('#puPanel'))
    pg.click('#puDlg [data-close]')
    pg.click('[data-kpi="kRepeat"]'); pg.wait_for_timeout(300)
    ok('Repeat KPI filters the list', pg.input_value('#fStatus') == 'repeat')
    ok('No page errors (admin)', not errs, errs)
    pg.goto(BASE + f'/billing.html?customer={ravi["id"]}'); pg.wait_for_timeout(2500)
    ok('Billing ?customer= starts the bill for that customer', 'Ravi Kumar' in pg.input_value('#custInput'), pg.input_value('#custInput'))
    c.close()

    # billing staff
    c, pg, errs = ctx(b, 'billing_staff'); open_page(pg)
    row(pg, 'Ravi Kumar').locator('[data-menu]').click()
    ok('Billing staff: can receive payment, cannot edit credit limit', pg.locator('.pur-row-menu [data-act="receive"]').count() == 1 and pg.locator('.pur-row-menu [data-act="limit"]').count() == 0)
    ok('Billing staff: purchase totals visible', '₹450.00' in row(pg, 'Ravi Kumar').inner_text())
    ok('No page errors (billing staff)', not errs, errs); c.close()

    # mobile
    c, pg, errs = ctx(b, 'super_admin', 390, 844, True); open_page(pg)
    ok('Mobile: no sideways scroll', pg.evaluate('document.documentElement.scrollWidth') <= 390, pg.evaluate('document.documentElement.scrollWidth'))
    tops = [pg.locator(x).bounding_box()['y'] for x in ('#new', '#importBtn', '#exportBtn', '#moreBtn')]
    ok('Mobile: header buttons in one row', max(tops) - min(tops) < 2, tops)
    k = [pg.locator(f'[data-kpi="{x}"]').bounding_box() for x in ('kTotal', 'kActive', 'kRepeat', 'kLoyal')]
    ok('Mobile: KPIs in a 2 × 2 grid', abs(k[0]['y'] - k[1]['y']) < 2 and k[2]['y'] > k[0]['y'] + 20)
    ok('Mobile: rows show name, ID, amount and status', 'CUS-' in pg.inner_text('#rows') and '₹' in pg.inner_text('#rows'))
    ok('No page errors (mobile)', not errs, errs); c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
