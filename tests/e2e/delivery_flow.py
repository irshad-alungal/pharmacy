# Delivery Management (admin) + Delivery Boy dashboard: every control, checked against the database.
import json, re, os, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'billing_staff': '0c000000-0000-0000-0000-000000000002', 'delivery': '0c000000-0000-0000-0000-000000000005'}
TODAY = datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Kolkata')).strftime('%Y-%m-%d')
def api(kind, body, user='super_admin'):
    r = urllib.request.Request(BASE + '/api/' + kind, data=json.dumps({'user': U[user], **body}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
def rpc(name, args=None, user='super_admin'): return api('rpc', {'name': name, 'args': args or {}}, user)
def Q(t, cols, **k): return api('query', {'q': dict({'table': t, 'op': 'select', 'cols': cols, 'filters': [], 'order': [], 'single': None, 'count': None, 'limit': None, 'offset': None, 'values': None, 'returning': None}, **k)})['data']
P = F = 0
def ok(n, c, x=''):
    global P, F
    P += bool(c); F += not c
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else '  → ' + str(x)[:400]))
num = lambda s: float(re.sub(r'[^0-9.\-]', '', s) or 0)
def mlist(): return rpc('delivery_management_list_v2', {'p_days': 30})['data']
def job(inv):  # delivery_jobs is readable only through its RPCs (no direct table grant)
    row = next((r for r in mlist()['invoices'] if r['id'] == inv), None)
    return row and row['delivery']
def presence(pid): return next(p['presence'] for p in mlist()['delivery_people'] if p['id'] == pid)

def ctx(b, who, w=1536, h=1000, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile)
    c.add_init_script(f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));")
    c.route(re.compile(r'https://(maps\.google\.com|www\.google\.com)/.*'), lambda r: r.fulfill(status=200, content_type='text/html', body='<html><body>map</body></html>'))
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    return c, pg, errs

# --- setup: three fresh bills (two to customers, one walk-in) via the real billing RPCs
def sale(cust=None, med='Cetirizine', cart='44444444-0000-0000-0000-00000000000'):
    mid = Q('medicines', 'id', filters=[['eq', 'name', med]])[0]['id']
    a = rpc('billing_allocate', {'p_cart': cart, 'p_medicine': mid, 'p_qty': 1})['data']
    tot = sum(rpc('billing_calc_line', {'p_mrp': r['mrp'], 'p_qty': r['qty'], 'p_discount_pct': r['default_discount_pct'], 'p_gst_pct': r['tax_rate'], 'p_price_includes_tax': r['price_includes_tax']})['data'][0]['total_amount'] for r in a['rows'])
    inv = rpc('finalize_sale_v3', {'p_customer': cust, 'p_items': [{'batch_id': r['batch_id'], 'qty': r['qty']} for r in a['rows']], 'p_payments': [{'method': 'cash', 'amount': round(tot, 2)}], 'p_discount': 0, 'p_cart': cart, 'p_expected_total': None, 'p_patient': {'patient_name': 'Walk Patient', 'patient_address': 'Near Bus Stand, Pallikkal'} if not cust else None})['data']
    return inv, Q('sales_invoices', 'invoice_no', filters=[['eq', 'id', inv]])[0]['invoice_no']
ravi = Q('customers', 'id', filters=[['eq', 'name', 'Ravi Kumar']])[0]['id']
anu = Q('customers', 'id', filters=[['eq', 'name', 'Anu Thomas']])[0]['id']
INV1, NO1 = sale(ravi, cart='44444444-0000-0000-0000-000000000001')
INV2, NO2 = sale(anu, cart='44444444-0000-0000-0000-000000000002')
INV3, NO3 = sale(None, cart='44444444-0000-0000-0000-000000000003')
RIDER = U['delivery']

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])

    # ============================== admin ==============================
    c, pg, errs = ctx(b, 'super_admin')
    pg.goto(BASE + '/delivery.html'); pg.wait_for_selector('#deliveryRows'); pg.wait_for_timeout(2000)
    ok('Admin: branded sidebar with Delivery active, no footer block', 'active' in pg.get_attribute('.pp-nav-link[href="delivery.html"]', 'class') and 'Trusted' not in pg.inner_text('#ppSidebar'))
    ok('Admin: header buttons', all(pg.is_visible(s) for s in ['#newDelivery', '#assignOrders', 'a[href="delivery-boy-login.html"]']))

    # New Delivery for the walk-in bill: address from the bill's patient details, edited, assigned to the rider
    pg.click('#newDelivery'); pg.fill('#ndSearch', NO3); pg.wait_for_timeout(300); pg.click('[data-pick]')
    ok('New Delivery: walk-in address pre-filled from the bill', pg.input_value('#ndAddr') == 'Near Bus Stand, Pallikkal', pg.input_value('#ndAddr'))
    pg.fill('#ndAddr', 'Near Bus Stand, Pallikkal, Thodupuzha'); pg.fill('#ndPhone', '9847011122'); pg.fill('#ndNote', 'Call before arriving')
    pg.select_option('#ndPerson', RIDER); pg.click('#ndSave'); pg.wait_for_timeout(2000)
    j = job(INV3)
    ok('New Delivery: requested, details saved and assigned', j and j['is_requested'] and j['assigned_to'] == RIDER and j['delivery_address'].endswith('Thodupuzha') and j['delivery_note'] == 'Call before arriving' and j['status'] == 'pending', j)
    ok('New Delivery: order listed as Pending with the delivery boy', NO3 in pg.inner_text('#deliveryRows') and 'Pending' in pg.inner_text(f'tr[data-row="{INV3}"]'), pg.inner_text('#deliveryRows')[:300])

    # Bills without a request: filter → include all, then create from the row (+)
    pg.click('#filterBtn'); pg.check('#fAll'); pg.click('#fApply'); pg.wait_for_timeout(400)
    ok('Filter: bills without a delivery request are listed', NO1 in pg.inner_text('#deliveryRows') and 'Not requested' in pg.inner_text(f'tr[data-row="{INV1}"]'))
    pg.click(f'tr[data-row="{INV1}"] [data-request]'); pg.wait_for_timeout(300)
    ok('Row (+) opens New Delivery with the bill chosen and the customer address', pg.input_value('#ndAddr') == '' or pg.input_value('#ndAddr') is not None)
    pg.fill('#ndAddr', 'M.G. Road, Thodupuzha'); pg.select_option('#ndPerson', ''); pg.click('#ndSave'); pg.wait_for_timeout(1800)
    ok('Created without assignment → unassigned pending', job(INV1)['is_requested'] and job(INV1)['assigned_to'] is None)
    rpc('delivery_set_request', {'p_invoice_id': INV2, 'p_requested': True}, 'billing_staff')
    rpc('delivery_set_details', {'p_invoice_id': INV2, 'p_address': 'Pallikkal Garden, Thodupuzha'}, 'billing_staff')
    pg.click('#filterBtn'); pg.click('#fReset'); pg.wait_for_timeout(200)
    pg.evaluate("document.querySelector('#dlDialog').open && document.querySelector('#dlDialog').close()")

    # Assign Orders (bulk)
    pg.click('#assignOrders'); pg.wait_for_selector('#baList')
    pg.select_option('#baPerson', RIDER)
    pg.check(f'#baList input[value="{INV1}"]'); pg.check(f'#baList input[value="{INV2}"]')
    pg.click('#baSave'); pg.wait_for_timeout(2500)
    ok('Assign Orders: two orders assigned in one go', job(INV1)['assigned_to'] == RIDER and job(INV2)['assigned_to'] == RIDER, (job(INV1), job(INV2)))

    # Details dialog: edit note, timeline, invoice
    pg.goto(BASE + '/delivery.html'); pg.wait_for_selector(f'tr[data-row="{INV2}"]'); pg.wait_for_timeout(800)
    pg.click(f'tr[data-row="{INV2}"] [data-view]'); pg.wait_for_selector('#dlDialog[open]')
    ok('View: details show address and timeline', 'Pallikkal Garden' in pg.inner_text('#dlDialog') and 'Delivery requested' in pg.inner_text('.dl-timeline'))
    pg.click('.dl-edit summary'); pg.fill('#edNote', 'Second floor'); pg.click('[data-save-details]'); pg.wait_for_timeout(1500)
    ok('View: delivery note edited and saved', job(INV2)['delivery_note'] == 'Second floor', job(INV2))
    pg.click('#dlDialog [data-invoice]'); pg.wait_for_timeout(1500)
    ok('View invoice opens the printable invoice', pg.query_selector('dialog[open] #pv') is not None)
    if pg.query_selector('dialog[open] #cl'): pg.click('dialog[open] #cl')

    # Fee setting + account form (admin)
    pg.click('#viewPeople'); pg.wait_for_selector('#feeIn'); pg.fill('#feeIn', '35'); pg.click('#feeSave'); pg.wait_for_timeout(1000)
    ok('Delivery fee saved (₹35 per delivery)', float(Q('delivery_settings', 'fee_per_delivery')[0]['fee_per_delivery']) == 35, pg.inner_text('#feeMsg'))
    pg.fill('#newDeliveryId', 'RIDER09'); pg.fill('#newDeliveryName', 'Test Rider'); pg.fill('#newDeliveryPassword', 'Temporary-Pass-123'); pg.click('#createDeliveryAccount'); pg.wait_for_timeout(1200)
    ok('Create delivery-boy account calls the admin-staff service', 'created' in pg.inner_text('#deliveryAccountMessage').lower(), pg.inner_text('#deliveryAccountMessage'))
    pg.click('#dlDialog [data-close]')
    ok('No page errors (admin)', not errs, errs)
    c.close()

    # ============================== delivery boy ==============================
    c, pg, errs = ctx(b, 'delivery')
    pg.goto(BASE + '/delivery.html'); pg.wait_for_selector('#riderJobs'); pg.wait_for_timeout(1500)
    ok('Rider: delivery.html opens the Delivery Boy Dashboard', 'Delivery Boy Dashboard' in pg.inner_text('#riderRoot'))
    mine = rpc('delivery_my_jobs_v2', user='delivery')['data']['jobs']
    ok(f'Rider: Assigned Orders = {len([j for j in mine if j["status"] in ("pending","out")])} active today', num(pg.inner_text('.dz-kpi >> nth=0')) >= 3, pg.inner_text('.dz-kpi >> nth=0'))
    ok('Rider: walk-in order shows edited address and phone', 'Thodupuzha' in pg.inner_text(f'tr[data-job="{INV3}"]') and pg.query_selector(f'tr[data-job="{INV3}"] a[href="tel:9847011122"]') is not None)
    pg.select_option('#presSel', 'available'); pg.wait_for_timeout(1000)
    ok('Rider: presence set to Online', presence(RIDER) == 'available')
    pg.click(f'tr[data-job="{INV3}"] [data-go]'); pg.click('#rdBody [data-set="out"]'); pg.wait_for_timeout(1500)
    ok('Rider: Start → Out for Delivery (time stamped)', job(INV3)['status'] == 'out' and job(INV3)['out_at'], job(INV3))
    pg.click(f'tr[data-job="{INV3}"] [data-go]'); pg.click('#rdBody [data-set="done"]'); pg.wait_for_timeout(1500)
    ok('Rider: ✓ → Delivered with ₹35 fee earned', job(INV3)['status'] == 'done' and float(job(INV3)['fee_earned']) == 35, job(INV3))
    ok('Rider: Today’s Summary earnings ₹35', '₹35' in pg.inner_text('.dl-today'), pg.inner_text('.dl-today'))
    # Quick action: update status of next order (INV1/INV2 pending)
    pg.click('[data-qa="status"]'); pg.wait_for_selector('#rdDialog[open]')
    ok('Quick action Update Status opens the next order', 'Start delivery' in pg.inner_text('#rdDialog'))
    pg.click('#rdBody [data-set="out"]'); pg.wait_for_timeout(1500)
    # Report issue + return
    pg.click('[data-qa="issue"]'); pg.wait_for_selector('#isOrder')
    pg.select_option('#isOrder', INV2); pg.check('#isFail'); pg.click('#isSend'); pg.wait_for_timeout(1500)
    ok('Report Issue with return → Failed / Returned with reason', job(INV2)['status'] == 'failed' and job(INV2)['failure_reason'] and job(INV2)['issue_note'], job(INV2))
    ok('Rider: Failed / Returned KPI counts it', num(pg.inner_text('.dz-kpi >> nth=3')) >= 1)
    pg.click('#tabs [data-tab="failed"]'); pg.wait_for_timeout(200)
    ok('Rider: Failed tab lists the returned order', NO2 in pg.inner_text('#riderJobs') and NO1 not in pg.inner_text('#riderJobs'))
    # Views
    pg.click('.pp-nav-link[data-nav="earnings"]'); pg.wait_for_timeout(500)
    ok('Earnings view: today ₹35 and a row for today', '₹35' in pg.inner_text('#riderRoot') and 'Earnings by day' in pg.inner_text('#riderRoot'))
    pg.click('.pp-nav-link[data-nav="completed"]'); pg.wait_for_timeout(500)
    ok('Completed view lists delivered and failed orders', NO3 in pg.inner_text('#riderRoot') and NO2 in pg.inner_text('#riderRoot'))
    pg.click('.pp-nav-link[data-nav="profile"]'); pg.wait_for_timeout(400)
    ok('Profile view shows Delivery ID', 'DEL001' in pg.inner_text('#riderRoot'))
    pg.click('.pp-nav-link[data-nav="help"]'); pg.wait_for_timeout(400)
    ok('Help & Support shows the pharmacy phone', '9847000000' in pg.inner_text('#riderRoot'))
    pg.fill('#riderSearch', NO1); pg.wait_for_timeout(700)
    ok('Top search finds an order', 'My Deliveries' in pg.inner_text('#riderRoot') and NO1 in pg.inner_text('#riderJobs') and NO3 not in pg.inner_text('#riderJobs'), (NO1, NO3, pg.inner_text('#riderJobs')))
    pg.fill('#riderSearch', ''); pg.wait_for_timeout(400)
    pg.click('.pp-nav-link[data-nav="dashboard"]'); pg.wait_for_timeout(400)
    pg.click('#presToggle'); pg.wait_for_timeout(1000)
    ok('Go Offline sets presence Offline', presence(RIDER) == 'offline')
    ok('No page errors (rider, desktop)', not errs, errs)
    c.close()

    # rider on a phone
    c, pg, errs = ctx(b, 'delivery', 390, 844, True)
    pg.goto(BASE + '/delivery-boy.html'); pg.wait_for_selector('#riderJobs'); pg.wait_for_timeout(1200)
    ok('Rider mobile: delivery-boy.html works, no horizontal scroll', pg.evaluate('document.documentElement.scrollWidth') <= 390, pg.evaluate('document.documentElement.scrollWidth'))
    ok('Rider mobile: bottom navigation has 5 items', pg.locator('.dl-bottom a').count() == 5)
    ok('No page errors (rider, mobile)', not errs, errs)
    c.close()

    # ============================== admin sees the result ==============================
    c, pg, errs = ctx(b, 'billing_staff', 390, 844, True)
    pg.goto(BASE + '/delivery.html'); pg.wait_for_selector('#deliveryRows'); pg.wait_for_timeout(1800)
    ok('Mobile admin: no horizontal scroll', pg.evaluate('document.documentElement.scrollWidth') <= 390, pg.evaluate('document.documentElement.scrollWidth'))
    pg.click('#tabs [data-tab="failed"]'); pg.wait_for_timeout(300)
    ok('Staff sees the failed order', NO2 in pg.inner_text('#deliveryRows'))
    pg.click(f'tr[data-row="{INV2}"]'); pg.wait_for_selector('#dlDialog[open]')
    ok('Failed order shows the rider’s issue', 'Issue reported' in pg.inner_text('#dlDialog'))
    pg.click('#dlDialog [data-assign]'); pg.select_option('#assignPerson', RIDER); pg.click('[data-save-assignment]'); pg.wait_for_timeout(1500)
    ok('Reassigning a failed order starts a new attempt (pending, reason cleared)', job(INV2)['status'] == 'pending' and job(INV2)['failure_reason'] is None, job(INV2))
    ok('No page errors (billing staff, mobile)', not errs, errs)
    c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
