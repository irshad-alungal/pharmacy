# Audit Logs page: every figure and control, checked against the database.
import json, re, os, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'admin': '0c000000-0000-0000-0000-000000000006', 'pharmacist': '0c000000-0000-0000-0000-000000000004',
     'billing_staff': '0c000000-0000-0000-0000-000000000002', 'inventory_staff': '0c000000-0000-0000-0000-000000000003'}
TODAY = datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Kolkata')).strftime('%Y-%m-%d')
def day(n): return (datetime.date.fromisoformat(TODAY) + datetime.timedelta(days=n)).isoformat()
def api(kind, body, user='super_admin'):
    r = urllib.request.Request(BASE + '/api/' + kind, data=json.dumps({'user': U[user], **body}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
def R(name, args=None, user='super_admin'):
    r = api('rpc', {'name': name, 'args': args or {}}, user)
    if r.get('error'): print('rpc', name, r['error'])
    return r.get('data')
def SQL(sql, params=None):
    r = api('ownersql', {'sql': sql, 'params': params or []})
    if r.get('error'): print('sql', r['error'])
    return r.get('data')
P = F = 0
def ok(n, c, x=''):
    global P, F
    P += bool(c); F += not c
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else '  → ' + str(x)[:400]))
def ctx(b, who, w=1536, h=1000, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    c.add_init_script(f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));")
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    return c, pg, errs
def open_page(pg, qs=''):
    pg.goto(BASE + '/audit-logs.html' + qs); pg.wait_for_selector('#kTotal:not(:has(.dz-skel))'); pg.wait_for_timeout(1300)
n = lambda pg, sel: int(re.sub(r'\D', '', pg.inner_text(sel)) or 0)
uid = lambda sid: SQL("select id from profiles where staff_id=$1", [sid])[0]['id']

# seed: a known set of entries today (minutes ago), an older one, logins / logouts, failed sign-ins
B = '0b000000-0000-0000-0000-000000000001'
def ins(user, action, ent, after=None, before=None, reason=None, mins=5, ip=None):
    SQL("set session_replication_role = origin")
    SQL("insert into audit_logs(branch_id,user_id,action,entity_type,after_data,before_data,reason,ip,at) values ($1,$2,$3,$4,$5,$6,$7,$8::inet, now() - make_interval(mins => $9::int))",
        [B, user, action, ent, json.dumps(after) if after else None, json.dumps(before) if before else None, reason, ip, mins])
ins(U['admin'], 'sale_finalized', 'sales_invoice', {'invoice_no': 'INV-01456', 'total': 1280}, ip='192.168.1.10', mins=-1)
ins(U['inventory_staff'], 'stock_adjusted', 'medicine_batch', {'name': 'Paracetamol 500 mg', 'qty': 1182}, {'name': 'Paracetamol 500 mg', 'qty': 1200}, 'Damaged', ip='192.168.1.15', mins=6)
ins(U['admin'], 'sales_return_deleted', 'sales_return', None, {'return_no': 'RET-0067', 'total': 220}, 'Entered twice', ip='192.168.1.10', mins=9)
ins(U['pharmacist'], 'medicine_price_updated', 'medicine', {'name': 'Amoxicillin 500 mg', 'mrp': 98}, {'name': 'Amoxicillin 500 mg', 'mrp': 95}, mins=12)
ins(U['super_admin'], 'settings_saved', 'settings', {'low_stock_alerts': True}, {'low_stock_alerts': False}, mins=15, ip='192.168.1.25')
ins(U['admin'], 'sale_finalized', 'sales_invoice', {'invoice_no': 'INV-OLD', 'total': 50}, mins=60 * 24 * 12)
SQL("update work_sessions set logout_at = now() - interval '1 minute', logout_reason = 'manual' where user_id = $1", [U['billing_staff']])
SQL("insert into login_attempts(staff_id, portal, success, reason, ip) values ('BAD01','staff',false,'Invalid credentials','103.21.4.7'),('ADM001','admin',true,null,'192.168.1.10')")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    c, pg, errs = ctx(b, 'super_admin')
    open_page(pg)
    ok('Header and buttons', pg.inner_text('.pos-title h1') == 'Audit Logs' and pg.inner_text('#rangeLbl') == 'Last 7 Days' and pg.is_visible('#exportBtn') and pg.is_visible('#moreBtn'))
    ov = R('audit_overview', {'p_from': day(-6), 'p_to': TODAY})
    ok('KPIs match the database', n(pg, '#kTotal') == ov['total'] and n(pg, '#kUsers') == ov['active_users'] and n(pg, '#kCrit') == ov['critical'] and n(pg, '#kLogin') == ov['login_events'], [pg.inner_text('#kTotal'), ov['total'], ov['critical']])
    ok('Critical: 2 deletes/price + settings = 3, with %', ov['critical'] == 3 and f"{3 / ov['total'] * 100:.1f}%" in pg.inner_text('#kCritNote'), pg.inner_text('#kCritNote'))
    ok('Login events: 6 logins + 1 logout, failed attempts noted', ov['login_events'] == 7 and '1 failed' in pg.inner_text('#kLoginNote'), pg.inner_text('#kLoginNote'))
    ok('Previous period comparison', 'vs. previous 7 days' in pg.inner_text('#kTotalNote'), pg.inner_text('#kTotalNote'))

    # table
    first = pg.locator('#rows tr[data-i]').first.inner_text()
    ok('Newest first: sale INV-01456 with amount, user, Created, Sales, IP', 'INV-01456 (₹1,280.00)' in first and 'admin user' in first and 'Created' in first and 'Sales' in first and '192.168.1.10' in first, first)
    ok('Pager text', pg.inner_text('#pageInfo') == f"Showing 1 to 10 of {ov['total']} activities", pg.inner_text('#pageInfo'))
    ok('Module chart totals = activities', pg.inner_text('#donutTotal') == str(ov['total']) and pg.locator('#legend [data-mod]').count() >= 4)
    crit = pg.locator('#critList [data-ci]').all_inner_texts()
    ok('Recent critical actions newest first', len(crit) == 3 and 'Return Deleted' in crit[0] and 'Medicine Price Updated' in crit[1] and 'Settings Saved' in crit[2], crit)

    # filters
    pg.select_option('#fModule', 'Sales'); pg.wait_for_timeout(900)
    ok('Module filter', pg.locator('#rows tr[data-i]').count() == 1 and 'INV-01456' in pg.inner_text('#rows'))
    pg.select_option('#fModule', ''); pg.select_option('#fKind', 'deleted'); pg.wait_for_timeout(900)
    ok('Action filter (Deleted)', pg.locator('#rows tr[data-i]').count() == 1 and 'RET-0067' in pg.inner_text('#rows'))
    pg.select_option('#fKind', ''); pg.select_option('#fUser', U['admin']); pg.wait_for_timeout(900)
    ok('User filter', pg.locator('#rows tr[data-i]').count() == 3, pg.locator('#rows tr[data-i]').count())
    pg.select_option('#fUser', ''); pg.fill('#q', 'paracetamol'); pg.wait_for_timeout(1200)
    ok('Search', pg.locator('#rows tr[data-i]').count() == 1 and 'Inventory' in pg.inner_text('#rows'))
    pg.fill('#q', '192.168.1.25'); pg.wait_for_timeout(1200)
    ok('Search by IP', pg.locator('#rows tr[data-i]').count() == 1 and 'Settings' in pg.inner_text('#rows'))
    pg.click('#clear'); pg.wait_for_timeout(900)
    ok('Clear', pg.inner_text('#pageInfo').endswith(f"of {ov['total']} activities") and not pg.inner_text('#chips'))
    pg.click('[data-kpi="kCrit"]'); pg.wait_for_timeout(900)
    ok('Critical KPI filters to critical only', pg.locator('#rows tr[data-i]').count() == 3 and 'Critical only' in pg.inner_text('#chips'))
    pg.click('#chips [data-clear="crit"]'); pg.wait_for_timeout(800)
    pg.click('#legend [data-mod="System"]'); pg.wait_for_timeout(900)
    ok('Module chart click filters', pg.input_value('#fModule') == 'System' and 'Logout' in pg.inner_text('#rows') and 'Login' in pg.inner_text('#rows'))
    ok('Logout row shows the user', 'billing user' in pg.inner_text('#rows'))
    pg.select_option('#fModule', '')
    pg.wait_for_timeout(800)
    pg.click('#pager [data-page="2"]'); pg.wait_for_timeout(900)
    ok('Pager page 2', pg.inner_text('#rows tr[data-i] td.c-no >> nth=0') == '11' if ov['total'] > 10 else True)

    # periods
    pg.click('#rangeBtn'); pg.click('#rangeMenu [data-range="all"]'); pg.wait_for_timeout(1200)
    ok('All time includes older entries', n(pg, '#kTotal') == ov['total'] + 1 and pg.inner_text('#rangeLbl') == 'All Time', pg.inner_text('#kTotal'))
    pg.click('#rangeBtn'); pg.click('#rangeMenu [data-range="custom"]'); pg.wait_for_selector('#crFrom')
    pg.fill('#crFrom', day(-13)); pg.fill('#crTo', day(-11)); pg.click('#crGo'); pg.wait_for_timeout(1200)
    ok('Custom range', n(pg, '#kTotal') == 1 and 'INV-OLD' in pg.inner_text('#rows'), pg.inner_text('#kTotal'))
    pg.click('#rangeBtn'); pg.click('#rangeMenu [data-range="today"]'); pg.wait_for_timeout(1200)
    ok('Today', pg.inner_text('#rangeLbl') == 'Today' and 'vs. yesterday' in pg.inner_text('#kTotalNote'))

    # detail dialog
    pg.fill('#q', 'amoxicillin'); pg.wait_for_timeout(1200)
    pg.click('#rows tr[data-i]'); pg.wait_for_selector('.al-det-head')
    t = pg.inner_text('#puPanel')
    ok('Entry: before / after changes highlighted', pg.locator('.al-diff tr.al-changed').count() == 1 and '95' in pg.inner_text('.al-diff tr.al-changed') and '98' in pg.inner_text('.al-diff tr.al-changed'), t[:300])
    ok('Entry: critical, user, action code, link to the record', 'Critical' in t and 'pharmacist user' in t and 'medicine_price_updated' in t and pg.locator('#puPanel a[href^="medicines.html?q=Amoxicillin"]').count() == 1)
    pg.click('#byUser'); pg.wait_for_timeout(1000)
    ok('More from this user', pg.input_value('#fUser') == U['pharmacist'])
    pg.click('#clear'); pg.wait_for_timeout(800)

    # timeline view
    pg.select_option('#fView', 'timeline') if pg.is_visible('#fView') else pg.evaluate("document.getElementById('fView').value='timeline';document.getElementById('fView').dispatchEvent(new Event('change'))")
    pg.wait_for_timeout(500)
    ok('Timeline view grouped by day', pg.is_visible('#timeline') and 'Today' in pg.inner_text('#timeline'))
    pg.evaluate("document.getElementById('fView').value='list';document.getElementById('fView').dispatchEvent(new Event('change'))")

    # exports
    pg.click('#exportBtn')
    with pg.expect_download() as dl: pg.click('#exportMenu [data-exp="csv"]')
    csv = open(dl.value.path(), encoding='utf-8-sig').read()
    ok('CSV export: header + rows for the period', csv.startswith('#,Date & Time (IST),User') and 'INV-01456' in csv and '192.168.1.10' in csv, csv[:200])
    pg.wait_for_timeout(1000)
    ok('Export recorded in the audit log', SQL("select count(*)::int n from audit_logs where action='audit_log_exported' and entity_id='csv'")[0]['n'] == 1)
    pg.click('#quick [data-q="users"]'); pg.wait_for_selector('.al-ur')
    ur = pg.locator('.al-ur tr[data-u]').count()
    ok('User activity report', ur >= 5 and 'admin user' in pg.inner_text('.al-ur'))
    with pg.expect_download() as dl: pg.click('#urCsv')
    ok('User report CSV', dl.value.suggested_filename.startswith('user-activity-'))
    pg.click(f'.al-ur tr[data-u="{U["admin"]}"]'); pg.wait_for_timeout(1000)
    ok('Report row filters the list', pg.input_value('#fUser') == U['admin'])
    pg.click('#clear'); pg.wait_for_timeout(600)
    pg.click('#quick [data-q="logins"]'); pg.wait_for_selector('#lhBody table')
    ok('Login history: sessions with duration', pg.locator('#lhBody tbody tr').count() >= 6 and 'min' in pg.inner_text('#lhBody'))
    pg.click('#puPanel [data-tab="attempts"]'); pg.wait_for_timeout(300)
    ok('Sign-in attempts incl. failed, unknown ID flagged', 'BAD01' in pg.inner_text('#lhBody') and 'Failed' in pg.inner_text('#lhBody') and 'Unknown ID' in pg.inner_text('#lhBody'))
    with pg.expect_download() as dl: pg.click('#lhCsv')
    ok('Login history CSV', dl.value.suggested_filename.startswith('login-history-'))
    pg.click('#puDlg [data-close]')

    # settings
    pg.click('#quick [data-q="settings"]'); pg.wait_for_selector('#asSize')
    pg.select_option('#asSize', '25'); pg.select_option('#asRange', '30d'); pg.click('#asSave'); pg.wait_for_timeout(1500)
    s = SQL("select value from pharmacy_settings where key='audit'")[0]['value']
    ok('Settings saved', s['page_size'] == 25 and s['default_range'] == '30d', s)
    ok('Page uses the settings (30 days, 25 rows)', pg.inner_text('#rangeLbl') == 'Last 30 Days' and pg.locator('#rows tr[data-i]').count() == min(25, n(pg, '#kTotal')))
    ok('Bell: critical actions and failed sign-ins', 'critical action' in pg.inner_text('#ppNotifyList') and 'failed sign-in' in pg.inner_text('#ppNotifyList'), pg.inner_text('#ppNotifyList'))
    pg.fill('#ppSearch', 'RET-0067'); pg.wait_for_timeout(900)
    pg.click('.pp-search-results .pp-sr-item >> nth=0'); pg.wait_for_timeout(1200)
    ok('Top search filters the activity list', pg.input_value('#q') == 'RET-0067' and pg.locator('#rows tr[data-i]').count() == 1)
    ok('Admin: no page errors', not errs, errs)
    c.close()
    SQL("delete from pharmacy_settings where key='audit'")

    c, pg, errs = ctx(b, 'admin'); open_page(pg, '?critical=1')
    ok('Admin opens with ?critical=1', 'Critical only' in pg.inner_text('#chips') and pg.locator('#rows tr[data-i]').count() >= 3)
    ok('Admin: no page errors', not errs, errs); c.close()
    for who in ['pharmacist', 'billing_staff']:
        c, pg, errs = ctx(b, who); pg.goto(BASE + '/audit-logs.html'); pg.wait_for_timeout(2500)
        ok(f'{who} cannot open Audit Logs', pg.query_selector('#kTotal') is None); c.close()

    # mobile
    c, pg, errs = ctx(b, 'super_admin', 390, 844, True); open_page(pg)
    ok('Mobile: no horizontal scroll', pg.evaluate('document.documentElement.scrollWidth') <= 390)
    hb = pg.eval_on_selector_all('.al-head-actions > *', 'e=>e.map(x=>Math.round(x.getBoundingClientRect().top))')
    ok('Mobile: 3 header buttons in one row', len(hb) == 3 and max(hb) - min(hb) <= 2, hb)
    k = pg.eval_on_selector_all('.al-kpis .dz-kpi', 'e=>e.map(x=>[Math.round(x.getBoundingClientRect().left),Math.round(x.getBoundingClientRect().top)])')
    ok('Mobile: KPIs 2×2', len(set(x[0] for x in k)) == 2 and len(set(x[1] for x in k)) == 2, k)
    ok('Mobile: list rows (icon, title, user • module • time, chip)', pg.is_visible('#rows tr[data-i] .al-m-ic') and pg.is_visible('#rows tr[data-i] .al-m-line') and not pg.is_visible('#rows tr[data-i] .c-at') and pg.is_visible('#fView'))
    s = pg.eval_on_selector_all('.al-side > section', 'e=>e.map(x=>Math.round(x.getBoundingClientRect().top))')
    ok('Mobile: module chart and critical actions side by side, quick actions below', abs(s[0] - s[1]) <= 2 and s[2] > s[0], s)
    q = pg.eval_on_selector_all('#quick button', 'e=>[...new Set(e.map(x=>Math.round(x.getBoundingClientRect().top)))].length')
    ok('Mobile: 4 quick actions in a row', q == 1, q)
    ok('Mobile: no page errors', not errs, errs); c.close()

    # without 0034
    fns = ['audit_overview', 'audit_list', 'audit_settings_get']
    for f in fns: SQL(f'alter function {f} rename to {f}_off')
    c, pg, errs = ctx(b, 'super_admin'); pg.goto(BASE + '/audit-logs.html'); pg.wait_for_selector('#rows tr[data-i]'); pg.wait_for_timeout(1200)
    ok('Without 0034: message, activity still listed from audit_logs', '0034' in pg.inner_text('#msg') and pg.locator('#rows tr[data-i]').count() >= 1, [pg.inner_text('#msg'), pg.locator('#rows tr[data-i]').count()])
    pg.click('#exportBtn')
    with pg.expect_download() as dl: pg.click('#exportMenu [data-exp="csv"]')
    ok('Without 0034: CSV export still works', dl.value.suggested_filename.endswith('.csv'))
    pg.click('#quick [data-q="logins"]'); pg.wait_for_timeout(1200)
    ok('Without 0034: sign-in history still works', 'BAD01' in pg.inner_text('#lhBody'))
    ok('Without 0034: no page errors', not errs, errs); c.close()
    for f in fns: SQL(f'alter function {f}_off rename to {f}')
    b.close()
print(f'\n{P} passed, {F} failed')
