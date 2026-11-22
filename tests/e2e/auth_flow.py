# Sign-in pages (admin, staff, delivery) and change password: layout and every flow.
# The staff-login / delivery-login Edge Functions are stood in by request routes that check the
# Staff ID against the database (wrong password = "bad-pass").
import json, re, os, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'admin': '0c000000-0000-0000-0000-000000000006', 'pharmacist': '0c000000-0000-0000-0000-000000000004',
     'billing_staff': '0c000000-0000-0000-0000-000000000002', 'inventory_staff': '0c000000-0000-0000-0000-000000000003', 'delivery': '0c000000-0000-0000-0000-000000000005'}
TODAY = datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Kolkata')).strftime('%Y-%m-%d')
def SQL(sql, params=None):
    r = urllib.request.Request(BASE + '/api/ownersql', data=json.dumps({'sql': sql, 'params': params or []}).encode(), headers={'content-type': 'application/json'})
    r = json.loads(urllib.request.urlopen(r).read())
    if r.get('error'): print('sql', r['error'])
    return r.get('data')
P = F = 0
def ok(n, c, x=''):
    global P, F
    P += bool(c); F += not c
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else '  → ' + str(x)[:400]))
calls = []
def fn_route(route):
    body = json.loads(route.request.post_data or '{}')
    sid = body.get('staff_id') or body.get('delivery_id'); calls.append((route.request.url.rsplit('/', 1)[-1], sid))
    row = SQL("select id, is_active from profiles where lower(staff_id::text) = lower($1)", [sid or ''])
    if not row or not row[0]['is_active'] or body.get('password') == 'bad-pass':
        return route.fulfill(status=401, content_type='application/json', body=json.dumps({'error': 'Invalid Staff ID or password.'}))
    uid = row[0]['id']
    route.fulfill(status=200, content_type='application/json', body=json.dumps({'session': {'access_token': uid, 'refresh_token': 'r', 'user': {'id': uid}}}))
def ctx(b, who=None, w=1440, h=950, mobile=False, extra=''):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile)
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    c.route(re.compile(r'.*/functions/v1/(staff|delivery)-login$'), fn_route)
    init = f"localStorage.setItem('e2e_user','{U[who]}');" if who else "localStorage.removeItem('e2e_user');"
    c.add_init_script("if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init','1');" + init + extra + "}")
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    return c, pg, errs
def opening(pg):
    # today's branch opening balance (asked once per day)
    try:
        pg.wait_for_selector('#alza-opening-amount', timeout=2500); pg.fill('#alza-opening-amount', '500'); pg.click('#alza-opening-overlay button[type=submit]')
    except Exception: pass
cur_user = lambda pg: pg.evaluate("localStorage.getItem('e2e_user')")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])

    # ---------------- admin
    c, pg, errs = ctx(b)
    pg.goto(BASE + '/admin-login.html'); pg.wait_for_selector('#f')
    ok('Admin: layout (hero, 5 features, card, title, footer)', pg.locator('.au-feats li').count() == 5 and pg.inner_text('.au-title') == 'Admin Login' and 'Administrator Access Only' in pg.inner_text('.au-foot') and pg.get_attribute('#e', 'placeholder') == 'Enter username or email')
    pg.fill('#p', 'secret'); pg.click('#f .au-eye')
    ok('Show / hide password', pg.get_attribute('#p', 'type') == 'text' and pg.get_attribute('#f .au-eye', 'aria-pressed') == 'true')
    pg.click('#f .au-eye'); pg.fill('#p', '')
    pg.click('#loginBtn'); pg.wait_for_timeout(200)
    ok('Validation: username required', 'Enter your username or email' in pg.inner_text('#m') and 'bad' in pg.eval_on_selector('#e', 'e=>e.parentElement.className'))
    pg.evaluate("localStorage.setItem('e2e_email_map', JSON.stringify({'admin@pallikkal.test':'%s','bill@pallikkal.test':'%s'})); localStorage.setItem('e2e_bad_password','bad-pass')" % (U['admin'], U['billing_staff']))
    pg.fill('#e', 'admin@pallikkal.test'); pg.fill('#p', 'bad-pass'); pg.click('#loginBtn'); pg.wait_for_timeout(800)
    ok('Wrong password message', 'Wrong email or password' in pg.inner_text('#m'), pg.inner_text('#m'))
    pg.fill('#p', 'Correct#Pass123'); pg.click('#loginBtn'); opening(pg)
    pg.wait_for_url(re.compile(r'dashboard\.html'), timeout=15000); pg.wait_for_timeout(1500)
    ok('Admin email login → Dashboard (work session + opening balance)', 'dashboard.html' in pg.url and cur_user(pg) == U['admin'] and pg.query_selector('#kLow') is not None, pg.url)
    ok('Daily login marked', pg.evaluate("!!localStorage.getItem('alza_daily_login_v1')"))
    ok('Admin: no page errors', not errs, errs); c.close()

    c, pg, errs = ctx(b)
    pg.goto(BASE + '/admin-login.html?next=reports.html'); pg.wait_for_selector('#f')
    pg.fill('#e', 'SA001'); pg.fill('#p', 'Correct#Pass123'); pg.click('#loginBtn'); opening(pg)
    pg.wait_for_url(re.compile(r'reports\.html'), timeout=15000)
    ok('Admin Staff ID login (SA001) through staff-login, returns to ?next=reports.html', 'reports.html' in pg.url and ('staff-login', 'SA001') in calls and cur_user(pg) == U['super_admin'], pg.url)
    ok('Remembers the last username', pg.evaluate("localStorage.getItem('pp.login.admin')") == 'SA001')
    c.close()

    c, pg, errs = ctx(b)
    pg.goto(BASE + '/admin-login.html'); pg.wait_for_selector('#f')
    pg.fill('#e', 'PHA001'); pg.fill('#p', 'Correct#Pass123'); pg.click('#loginBtn'); pg.wait_for_timeout(1500)
    ok('Non-admin refused on admin page and signed out', 'does not have administrator access' in pg.inner_text('#m') and cur_user(pg) is None, pg.inner_text('#m'))
    pg.goto(BASE + '/admin-login.html?next=https://evil.example/x.html'); pg.wait_for_selector('#f')
    ok('Foreign ?next= ignored', pg.evaluate("import('./assets/js/auth-ui.js').then(m=>m.nextPage('admin','dashboard.html'))") == 'dashboard.html')
    pg.fill('#e', 'admin@pallikkal.test'); pg.click('#forgot'); pg.wait_for_selector('#fpEmail')
    ok('Forgot password: email prefilled', pg.input_value('#fpEmail') == 'admin@pallikkal.test')
    pg.click('#fpBtn'); pg.wait_for_timeout(500)
    rs = json.loads(pg.evaluate("localStorage.getItem('e2e_reset')") or '{}')
    ok('Forgot password: reset link to change-password.html?mode=reset', rs.get('email') == 'admin@pallikkal.test' and rs['o']['redirectTo'].endswith('change-password.html?mode=reset') and 'on its way' in pg.inner_text('#fpMsg'), rs)
    ok('Admin page: no page errors', not errs, errs); c.close()

    # ---------------- staff
    c, pg, errs = ctx(b)
    pg.goto(BASE + '/staff-login.html'); pg.wait_for_selector('#f')
    ok('Staff: layout', pg.inner_text('.au-title') == 'Staff Login' and 'Staff Access Only' in pg.inner_text('.au-foot') and pg.get_attribute('#staffId', 'placeholder') == 'Enter staff ID or username')
    pg.fill('#staffId', 'PHA001'); pg.fill('#password', 'bad-pass'); pg.click('#loginBtn'); pg.wait_for_timeout(800)
    ok('Staff: wrong password', 'Invalid Staff ID or password' in pg.inner_text('#m'))
    pg.fill('#password', 'Correct#Pass123'); pg.click('#loginBtn'); opening(pg)
    pg.wait_for_url(re.compile(r'billing\.html'), timeout=15000)
    ok('Pharmacist → Billing (first page for the role)', 'billing.html' in pg.url and cur_user(pg) == U['pharmacist'])
    c.close()
    c, pg, errs = ctx(b)
    pg.goto(BASE + '/staff-login.html'); pg.wait_for_selector('#f')
    pg.fill('#staffId', 'DEL001'); pg.fill('#password', 'Correct#Pass123'); pg.click('#loginBtn'); pg.wait_for_timeout(1500)
    ok('Delivery account sent to Delivery login', 'Delivery login' in pg.inner_text('#m') and cur_user(pg) is None, pg.inner_text('#m'))
    pg.click('#forgot'); pg.wait_for_timeout(300)
    ok('Staff forgot password: ask the administrator', 'Reset password' in pg.inner_text('#auDlg'))
    pg.click('#auDlg [data-close]')
    SQL("update profiles set must_change_password = true where id = $1", [U['billing_staff']])
    pg.fill('#staffId', 'BIL001'); pg.fill('#password', 'Temp#Pass1234'); pg.click('#loginBtn')
    pg.wait_for_url(re.compile(r'change-password\.html'), timeout=10000)
    ok('First login → Change password', 'change-password.html' in pg.url)
    pg.wait_for_selector('#passwordForm'); pg.wait_for_timeout(800)
    ok('Forced: welcome text, current password shown, Back to Login', 'Welcome' in pg.inner_text('#cpSub') and pg.is_visible('#current') and pg.inner_text('#backLbl') == 'Back to Login')
    pg.fill('#current', 'Temp#Pass1234'); pg.fill('#password', 'short'); pg.fill('#confirm', 'short'); pg.click('#cpBtn'); pg.wait_for_timeout(300)
    ok('Requirements checked (live list)', 'does not meet' in pg.inner_text('#message') and pg.locator('#rules li.no').count() >= 3)
    pg.fill('#password', 'NewPass#2026x'); pg.fill('#confirm', 'NewPass#2026y'); pg.click('#cpBtn'); pg.wait_for_timeout(300)
    ok('Confirm must match', 'do not match' in pg.inner_text('#message') and pg.locator('#rules li.ok').count() == 5)
    pg.fill('#confirm', 'NewPass#2026x'); pg.fill('#current', 'NewPass#2026x'); pg.click('#cpBtn'); pg.wait_for_timeout(300)
    ok('New must differ from current', 'different' in pg.inner_text('#message'))
    pg.fill('#current', 'Temp#Pass1234'); pg.click('#cpBtn'); opening(pg)
    pg.wait_for_url(re.compile(r'billing\.html'), timeout=15000)
    ok('Forced change: password updated, flag cleared, work session → Billing', SQL("select must_change_password m from profiles where id=$1", [U['billing_staff']])[0]['m'] is False and json.loads(pg.evaluate("localStorage.getItem('e2e_last_update')"))['password'] == 'NewPass#2026x')
    ok('Staff pages: no page errors', not errs, errs); c.close()

    # ---------------- delivery
    c, pg, errs = ctx(b)
    pg.goto(BASE + '/delivery-boy-login.html'); pg.wait_for_selector('#loginForm')
    ok('Delivery: layout', pg.inner_text('.au-title') == 'Delivery Boy Login' and 'Delivery Staff Access Only' in pg.inner_text('.au-foot') and pg.get_attribute('#deliveryId', 'placeholder') == 'Enter delivery boy ID or username')
    pg.fill('#deliveryId', 'PHA001'); pg.fill('#deliveryPassword', 'Correct#Pass123'); pg.click('#loginButton'); pg.wait_for_timeout(1200)
    ok('Non-delivery account refused', 'not authorized for the delivery portal' in pg.inner_text('#loginStatus') and cur_user(pg) is None)
    pg.fill('#deliveryId', 'DEL001'); pg.fill('#deliveryPassword', 'Correct#Pass123'); pg.click('#loginButton')
    pg.wait_for_url(re.compile(r'delivery\.html'), timeout=15000)
    ok('Delivery login → delivery.html', ('delivery-login', 'DEL001') in calls and cur_user(pg) == U['delivery'])
    ok('Delivery: no page errors', not errs, errs); c.close()

    # ---------------- change password while signed in (voluntary), reset link, no session
    c, pg, errs = ctx(b, 'admin', extra=f"localStorage.setItem('alza_daily_login_v1', JSON.stringify({{userId:'{U['admin']}',date:'{TODAY}'}}));localStorage.setItem('e2e_bad_password','bad-pass');")
    pg.goto(BASE + '/change-password.html?next=settings.html'); pg.wait_for_selector('#passwordForm'); pg.wait_for_timeout(800)
    ok('Signed in: Back returns to the page', pg.inner_text('#backLbl') == 'Back' and pg.get_attribute('#backLink', 'href') == 'settings.html')
    pg.fill('#current', 'bad-pass'); pg.fill('#password', 'Another#Pass99'); pg.fill('#confirm', 'Another#Pass99'); pg.click('#cpBtn'); pg.wait_for_timeout(800)
    ok('Wrong current password refused', 'not correct' in pg.inner_text('#message'))
    pg.fill('#current', 'Old#Pass12345'); pg.click('#cpBtn'); pg.wait_for_url(re.compile(r'settings\.html'), timeout=10000)
    ok('Voluntary change → back to Settings, still signed in', 'settings.html' in pg.url and cur_user(pg) == U['admin'])
    c.close()
    c, pg, errs = ctx(b, 'admin')
    pg.goto(BASE + '/change-password.html?mode=reset'); pg.wait_for_selector('#passwordForm'); pg.wait_for_timeout(800)
    ok('Reset link: no current password needed', not pg.is_visible('#current'))
    pg.click('#backLink'); pg.wait_for_url(re.compile(r'admin-login\.html'), timeout=8000)
    ok('Back to Login signs out', cur_user(pg) is None)
    c.close()
    c, pg, errs = ctx(b)
    pg.goto(BASE + '/change-password.html'); pg.wait_for_url(re.compile(r'admin-login\.html'), timeout=8000)
    ok('Change password without a session → Admin login', 'admin-login.html' in pg.url); c.close()

    # ---------------- mobile
    for pgname in ['admin-login', 'staff-login', 'delivery-boy-login']:
        c, pg, errs = ctx(b, None, 390, 844, True)
        pg.goto(f'{BASE}/{pgname}.html'); pg.wait_for_selector('.au-card'); pg.wait_for_timeout(500)
        tops = pg.eval_on_selector_all('.au-feats li', 'e=>[...new Set(e.map(x=>Math.round(x.getBoundingClientRect().top)))].length')
        card = pg.eval_on_selector('.au-card', 'e=>{const r=e.getBoundingClientRect();return [r.left,r.right]}')
        ok(f'Mobile {pgname}: no horizontal scroll, 5 features in a row, card inside', pg.evaluate('document.documentElement.scrollWidth') <= 390 and tops == 1 and card[0] >= 0 and card[1] <= 390, [tops, card])
        ok(f'Mobile {pgname}: no page errors', not errs, errs); c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
