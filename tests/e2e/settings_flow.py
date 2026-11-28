# Settings page: every section and control, checked against the database and the pages that use them.
import json, re, os, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'admin': '0c000000-0000-0000-0000-000000000006', 'pharmacist': '0c000000-0000-0000-0000-000000000004',
     'billing_staff': '0c000000-0000-0000-0000-000000000002', 'inventory_staff': '0c000000-0000-0000-0000-000000000003'}
TODAY = datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Kolkata')).strftime('%Y-%m-%d')
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
PNG = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d\x00\x00\x00\x00IEND\xaeB`\x82'
def ctx(b, who, w=1536, h=1000, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    c.add_init_script(f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));window.__opened=[];window.open=(u)=>{{window.__opened.push(String(u));return {{}};}};")
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept(answers.pop(0) if answers else d.default_value) if d.type == 'prompt' else d.accept())
    return c, pg, errs
answers = []
def open_page(pg, sec='general'):
    pg.goto(BASE + '/settings.html#' + sec); pg.wait_for_function("document.getElementById('pTitle')?.textContent"); pg.wait_for_timeout(1200)
def save(pg):
    pg.click('.sg-panel-acts [data-act="save"]'); pg.wait_for_timeout(1300)
def sval(key):
    r = SQL("select value from pharmacy_settings where key=$1", [key])
    return r[0]['value'] if r else None
toast = lambda pg: pg.inner_text('#toast')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    c, pg, errs = ctx(b, 'super_admin')
    open_page(pg)
    ok('Header, 13 sections in the left menu, Reset + Save', pg.inner_text('.pos-title h1') == 'Settings' and pg.locator('.sg-nav [data-sec]').count() == 13 and pg.is_visible('.sg-panel-acts [data-act="save"]') and pg.is_visible('.sg-panel-acts [data-act="reset"]'))
    ok('General: preferences, 4 toggles, quick configuration, system info, support', pg.locator('.sg-prefs select').count() == 4 and pg.locator('.sg-prefs .sg-sw').count() == 4 and pg.locator('.sg-quick button').count() == 5 and 'System Information' in pg.inner_text('#below') and 'Support' in pg.inner_text('#below'))
    ok('System info: version, licence, database size, last backup never', 'v80.0' in pg.inner_text('.sg-dl') and 'Professional' in pg.inner_text('.sg-dl') and 'MB' in pg.inner_text('.sg-dl') and 'Never' in pg.inner_text('#lastBk'))
    ok('Search box placeholder', pg.get_attribute('#ppSearch', 'placeholder') == 'Search settings, features or configuration...')

    # --- general save ---
    pg.select_option('#gDate', 'DD/MM/YYYY'); pg.select_option('#gTime', '24h'); pg.click('#gBak'); pg.click('#gLow')
    ok('Unsaved change marks Save', 'pulse' in (pg.get_attribute('.sg-panel-acts [data-act="save"]', 'class') or ''))
    save(pg)
    g = sval('general')
    ok('General saved to the database', g and g['date_format'] == 'DD/MM/YYYY' and g['time_format'] == '24h' and g['auto_backup'] is True and g['low_stock_alerts'] is False, g)
    ok('Local settings copy updated (used by invoices)', json.loads(pg.evaluate("localStorage.getItem('pp.settings.v1')"))['general']['date_format'] == 'DD/MM/YYYY')
    ok('Language: only English selectable', pg.eval_on_selector_all('#gLang option:not([disabled])', 'o=>o.map(x=>x.value)') == ['en'])
    pg.click('.sg-panel-acts [data-act="reset"]'); pg.wait_for_timeout(1300)
    ok('Reset to Default', sval('general') is None and pg.input_value('#gDate') == 'DD MMM YYYY')
    pg.select_option('#gDate', 'DD/MM/YYYY'); pg.click('#gBak'); pg.click('#gLow'); save(pg)

    # --- search finds sections ---
    pg.fill('#ppSearch', 'upi'); pg.wait_for_timeout(900)
    ok('Global search lists Settings sections', 'Payment Methods' in pg.inner_text('.pp-search-results'))
    pg.click('.pp-search-results .pp-sr-item:has-text("Payment Methods")'); pg.wait_for_timeout(700)
    ok('Search result opens the section', pg.inner_text('#pTitle') == 'Payment Methods')

    # --- quick config / support ---
    pg.click('.sg-nav [data-sec="general"]'); pg.wait_for_timeout(500)
    pg.click('.sg-quick [data-go="invoice"]'); pg.wait_for_timeout(700)
    ok('Quick configuration opens Invoice Settings', pg.inner_text('#pTitle') == 'Print & Invoice' and '#invoice' in pg.url)
    pg.click('.sg-nav [data-sec="general"]'); pg.wait_for_timeout(500)
    pg.click('#hGuide'); pg.wait_for_timeout(300)
    ok('User guide', pg.locator('#puPanel details').count() >= 8); pg.click('#puDlg [data-close]')
    pg.click('#upBtn'); pg.wait_for_timeout(900)
    ok('Check for updates reads version.json', 'latest version' in pg.inner_text('#upMsg'), pg.inner_text('#upMsg'))
    pg.click('#hSupport'); pg.wait_for_timeout(700)
    ok('Contact Support without contact → About & License', pg.inner_text('#pTitle') == 'About & License')

    # --- about & license ---
    pg.fill('#sName', 'IT Desk'); pg.fill('#sPhone', '+91 98470 11122'); pg.fill('#sEmail', 'help@example.com'); pg.fill('#lValid', '2027-03-31'); save(pg)
    ok('Support + licence saved (super admin)', sval('support')['phone'] == '+91 98470 11122' and sval('license')['valid_to'] == '2027-03-31')
    pg.fill('#sEmail', 'bad'); save(pg)
    ok('Support email validated', 'valid support email' in toast(pg), toast(pg))
    pg.click('.sg-nav [data-sec="general"]'); pg.wait_for_timeout(600)
    ok('Leaving with unsaved changes asks first (accepted)', pg.inner_text('#pTitle') == 'General Settings')
    ok('Valid up to shown in system info', '31/03/2027' in pg.inner_text('.sg-dl'), pg.inner_text('.sg-dl'))
    pg.click('#hSupport'); pg.wait_for_timeout(300)
    ok('Contact Support: WhatsApp, call, email', pg.locator('#puPanel a[href*="wa.me/919847011122"]').count() == 1 and pg.locator('#puPanel a[href^="mailto:"]').count() == 1)
    pg.click('#puDlg [data-close]')

    # --- business information (existing pharmacy details) ---
    pg.click('.sg-nav [data-sec="business"]'); pg.wait_for_selector('#branch-profile')
    ok('Business: existing details loaded', pg.input_value('#bName') == 'PALLIKKAL MEDICALS' and pg.input_value('#bGst') == '32ABCDE1234F1Z5', pg.input_value('#bName'))
    pg.fill('#bPhone', '9847099999'); pg.fill('#bDl', 'KL-TVM-20B-1234\nKL-TVM-21B-5678'); pg.fill('#bTag', 'Your health, our care')
    pg.set_input_files('#logoFile', files=[{'name': 'logo.png', 'mimeType': 'image/png', 'buffer': PNG}])
    save(pg)
    br = SQL("select phone, drug_licence_nos from branches where id='0b000000-0000-0000-0000-000000000001'")[0]
    ph = SQL("select tagline, logo_path from pharmacies")[0]
    ok('Business: details saved through save_branch_profile', br['phone'] == '9847099999' and br['drug_licence_nos'] == ['KL-TVM-20B-1234', 'KL-TVM-21B-5678'], br)
    ok('Business: tagline and logo saved', ph['tagline'] == 'Your health, our care' and (ph['logo_path'] or '').startswith('0b000000-0000-0000-0000-000000000001/logo-'), ph)
    ok('Logo file in pharmacy-branding bucket', SQL("select count(*)::int n from storage.objects where bucket_id='pharmacy-branding'")[0]['n'] == 1)
    pg.fill('#bGst', '12345'); save(pg)
    ok('GSTIN validated', 'GSTIN looks wrong' in toast(pg))
    pg.fill('#bGst', '32ABCDE1234F1Z5'); pg.fill('#bName', ''); save(pg)
    ok('Name required', 'name is required' in toast(pg).lower())
    pg.click('.sg-panel-acts [data-act="reset"]'); pg.wait_for_timeout(900)
    ok('Undo Changes reloads saved details', pg.input_value('#bName') == 'PALLIKKAL MEDICALS' and pg.inner_text('#resetLbl') == 'Undo Changes')

    # --- print & invoice ---
    pg.click('.sg-nav [data-sec="invoice"]'); pg.wait_for_selector('#iPrev')
    ok('Invoice: live preview with saved date format and logo', '/' in pg.inner_text('#iPrev') and pg.locator('#iPrev img').count() == 1 and 'GSTIN' in pg.inner_text('#iPrev'), pg.inner_text('#iPrev')[:300])
    pg.click('#iGst'); pg.wait_for_timeout(200)
    ok('Preview updates before saving (GSTIN hidden)', 'GSTIN' not in pg.inner_text('#iPrev'))
    pg.fill('#iTerms', 'Medicines once sold are not taken back.'); pg.wait_for_timeout(200)
    ok('Preview shows terms', 'not taken back' in pg.inner_text('#iPrev'))
    pg.select_option('#iFmt', 'a4'); pg.fill('#iPrefix', 'PKM'); pg.fill('#iFooter', 'Get well soon!')
    pg.click('#iUpi'); save(pg)
    ok('UPI line needs a UPI ID first', 'UPI ID' in toast(pg), toast(pg))
    pg.click('#iUpi'); save(pg)
    iv = sval('invoice'); br = SQL("select invoice_prefix, invoice_footer from branches where id='0b000000-0000-0000-0000-000000000001'")[0]
    ok('Invoice settings saved (paper, GSTIN off, terms)', iv['default_format'] == 'a4' and iv['show_gstin'] is False and 'not taken back' in iv['terms'], iv)
    ok('Prefix and footer saved on the branch', br['invoice_prefix'] == 'PKM' and br['invoice_footer'] == 'Get well soon!', br)
    pg.fill('#iPrefix', 'P K'); save(pg)
    ok('Prefix validated', 'Invoice prefix' in toast(pg))
    open_page(pg, 'invoice')

    # --- payment methods ---
    pg.click('.sg-nav [data-sec="payments"]'); pg.wait_for_selector('.sg-pm-row')
    ok('Payments: 6 methods, all on by default, Cash default', pg.locator('.sg-pm-row input[type=checkbox]:checked').count() == 6 and pg.is_checked('input[name=pmDef][value=cash]'))
    pg.click('#pm_wallet'); pg.click('#pm_card'); pg.check('input[name=pmDef][value=upi]')
    pg.fill('#pUpi', 'bad upi'); save(pg)
    ok('UPI ID validated', 'valid UPI' in toast(pg), toast(pg))
    pg.fill('#pUpi', 'pallikkal@okaxis'); pg.fill('#pUpiName', 'Pallikkal Pharmacy'); save(pg)
    pm = sval('payments')
    ok('Payments saved', pm['enabled'] == ['cash', 'upi', 'credit', 'split'] and pm['default_method'] == 'upi' and pm['upi_id'] == 'pallikkal@okaxis', pm)
    pg.click('#pm_upi'); save(pg)
    ok('Default method must stay on', 'default method' in toast(pg).lower())
    open_page(pg, 'payments')
    # billing screen follows
    pg.goto(BASE + '/billing.html'); pg.wait_for_selector('.pos-methods'); pg.wait_for_timeout(1500)
    vis = pg.eval_on_selector_all('.pos-method', 'b=>b.filter(x=>!x.hidden).map(x=>x.dataset.method)')
    ok('Billing shows only switched-on methods', vis == ['upi', 'credit', 'split'] or vis == ['cash', 'upi', 'credit', 'split'], vis)
    ok('Billing starts with the default method (UPI)', pg.get_attribute('.pos-method[data-method="upi"]', 'aria-checked') == 'true')

    # --- invoice uses settings ---
    pg.evaluate("localStorage.removeItem('x')")
    html = pg.evaluate("""async () => { const m = await import('./assets/js/invoice.js'); return m.invoiceHTML({ shop: { name: 'X', gstin: '32ABCDE1234F1Z5' }, invoice: { invoice_no: 'PKM-1', created_at: '2026-01-05T06:30:00Z', subtotal: 10, discount: 0, line_discount: 0, tax: 1, total: 10 }, customer: null, items: [], payments: [], tax_summary: [] }); }""")
    ok('Invoice uses date format, hides GSTIN, prints terms, A4 default', '05/01/2026' in html and 'GSTIN' not in html and 'not taken back' in html and '190mm' in html, html[:400])

    # --- notifications ---
    open_page(pg, 'notifications'); pg.wait_for_timeout(800)
    ok('Notifications: low stock toggle follows General (off)', not pg.is_checked('#nLow'))
    pg.select_option('#nDays', '60'); pg.click('#nDel'); save(pg)
    n = sval('notifications')
    ok('Notifications saved', n['expiry_days'] == 60 and n['deliveries'] is False, n)
    ok('Document reminder shown when 0032 is installed', pg.is_visible('#nDoc'))
    pg.fill('#nDoc', '45'); save(pg)
    ok('Document reminder saved (0032)', SQL("select default_remind_days d from pharmacy_doc_settings")[0]['d'] == 45)

    # --- billing rules ---
    pg.click('.sg-nav [data-sec="billing"]'); pg.wait_for_selector('#blDisc')
    pg.fill('#blDisc', '15'); pg.fill('#blNear', '120'); save(pg)
    bs = SQL("select max_discount_pct::float d, near_expiry_days n from billing_settings")[0]
    ok('Billing rules saved', bs['d'] == 15 and bs['n'] == 120, bs)
    pg.fill('#blDisc', '150'); save(pg); ok('Discount validated', 'between 0 and 100' in toast(pg))
    open_page(pg, 'billing')
    ok('Licence shown with days left', 'days left' in pg.inner_text('.sg-plan'))

    # --- users ---
    pg.click('.sg-nav [data-sec="users"]'); pg.wait_for_timeout(1500)
    ok('Users: counts, roles, permission matrix, staff list', '6' in pg.inner_text('.sg-stats') and pg.locator('.sg-role').count() == 6 and pg.locator('.sg-perm tbody tr').count() > 0 and pg.locator('.sg-staff tbody tr').count() == 6)
    ok('Users: links to staff, roles, password, audit logs', pg.locator('#body a[href="staff.html?show=add"]').count() == 1 and pg.locator('#body a[href="change-password.html"]').count() == 1)

    # --- whatsapp ---
    pg.click('.sg-nav [data-sec="whatsapp"]'); pg.wait_for_selector('#wAuto')
    pg.click('#wOpen'); pg.fill('#wSign', '— Pallikkal Pharmacy'); save(pg)
    w = R('whatsapp_settings_get')
    ok('WhatsApp settings saved', w['open_after_bill'] is False and w['signature'] == '— Pallikkal Pharmacy', w)

    # --- integrations ---
    pg.click('.sg-nav [data-sec="integrations"]'); pg.wait_for_timeout(1500)
    st = pg.locator('.sg-int-st').all_inner_texts()
    ok('Integrations: live status', 'Connected' in st[0] and st[1] == 'Working' and st[2] == 'Ready', st)
    ok('Integrations has no Save button', not pg.is_visible('.sg-panel-acts [data-act="save"]'))

    # --- system preferences: master lists (kept) ---
    pg.click('.sg-nav [data-sec="system"]'); pg.wait_for_selector('section[data-t="categories"] .list li')
    cat = pg.locator('section[data-t="categories"]')
    cat.locator('.n').fill('Ointments'); cat.locator('.add').click(); pg.wait_for_timeout(900)
    ok('Add category', SQL("select count(*)::int n from categories where name='Ointments'")[0]['n'] == 1 and 'Ointments' in cat.inner_text())
    cat.locator('.n').fill('ointments'); cat.locator('.add').click(); pg.wait_for_timeout(500)
    ok('Duplicate refused', 'already in the list' in cat.locator('.err').inner_text())
    oid = SQL("select id from categories where name='Ointments'")[0]['id']
    answers[:] = ['Creams & Ointments']
    cat.locator(f'[data-ren="{oid}"]').click(); pg.wait_for_timeout(900)
    ok('Rename category', SQL("select name from categories where id=$1", [oid])[0]['name'] == 'Creams & Ointments')
    cat.locator(f'[data-id="{oid}"]').click(); pg.wait_for_timeout(900)
    ok('Deactivate category', SQL("select active from categories where id=$1", [oid])[0]['active'] is False and 'Activate' in cat.locator(f'[data-id="{oid}"]').inner_text())
    un = pg.locator('section[data-t="units"]')
    un.locator('.n').fill('Box'); un.locator('.add').click(); pg.wait_for_timeout(500)
    ok('Unit needs a code', 'name and code' in un.locator('.err').inner_text())
    un.locator('.c').fill('BOX'); un.locator('.add').click(); pg.wait_for_timeout(1000)
    ok('Add unit with code', SQL("select count(*)::int n from units where code='BOX'")[0]['n'] == 1)
    pg.select_option('#cf', label='Box'); pg.select_option('#ct', label='Tablet'); pg.fill('#cn', '100'); pg.click('#ca'); pg.wait_for_timeout(900)
    ok('Add unit conversion', SQL("select count(*)::int n from unit_conversions where factor=100")[0]['n'] == 1 and '1 Box = 100 Tablet' in pg.inner_text('#cl'))
    pg.locator('#cl [data-d]').last.click(); pg.wait_for_timeout(900)
    ok('Remove unit conversion', SQL("select count(*)::int n from unit_conversions where factor=100")[0]['n'] == 0)
    cat.locator('.sg-mq').fill('tab'); pg.wait_for_timeout(200)
    ok('Search a list', cat.locator('li').count() == 1)

    # --- backup & restore ---
    pg.click('.sg-nav [data-sec="backup"]'); pg.wait_for_selector('#bkGo')
    with pg.expect_download() as dl: pg.click('#bkGo')
    path = dl.value.path(); data = json.load(open(path))
    ok('Backup downloaded (branch tables + lists)', data['format'] == 'pallikkal-pharmacy-backup' and 'sales_invoices' in data['tables'] and 'categories' in data['tables'] and 'audit_logs' not in data['tables'] and dl.value.suggested_filename.startswith('pallikkal-pharmacy-backup-'), dl.value.suggested_filename)
    pg.wait_for_timeout(1200)
    ok('Backup history and last backup', pg.locator('#bkHist tbody tr').count() == 1 and SQL("select count(*)::int n from settings_backups")[0]['n'] == 1)
    SQL("delete from categories where name='Creams & Ointments'"); SQL("delete from pharmacy_settings where key='payments'")
    pg.set_input_files('#rsFile', files=[{'name': 'backup.json', 'mimeType': 'application/json', 'buffer': open(path, 'rb').read()}]); pg.wait_for_selector('#rsGo')
    ok('Restore dialog shows file details and choices', 'Taken' in pg.inner_text('#puPanel') and pg.locator('#puPanel [data-part]').count() == 4)
    pg.click('#rsGo'); pg.wait_for_timeout(1800)
    ok('Restore brings back settings and list entries', sval('payments')['upi_id'] == 'pallikkal@okaxis' and SQL("select count(*)::int n from categories where name='Creams & Ointments'")[0]['n'] == 1, toast(pg))
    pg.set_input_files('#rsFile', files=[{'name': 'x.json', 'mimeType': 'application/json', 'buffer': b'{"a":1}'}]); pg.wait_for_timeout(400)
    ok('Wrong file refused', 'not a Pallikkal' in toast(pg))
    pg.click('#kRem'); save(pg)
    ok('Backup reminder setting saved', sval('notifications')['backup_reminder'] is False)
    ok('Admin: no page errors', not errs, errs)
    c.close()

    # --- dashboard follows notifications + auto backup ---
    c, pg, errs = ctx(b, 'super_admin')
    pg.goto(BASE + '/dashboard.html'); pg.wait_for_selector('#kLow', timeout=15000); pg.wait_for_timeout(2500)
    ok('Dashboard: no auto backup when a backup was already taken today', SQL("select count(*)::int n from settings_backups where kind='auto'")[0]['n'] == 0)
    SQL("delete from settings_backups"); pg.evaluate("localStorage.removeItem('pp.autobackup.day')")
    pg.goto(BASE + '/dashboard.html')
    with pg.expect_download(timeout=15000) as dl: pg.wait_for_selector('#kLow', timeout=15000)
    ok('Dashboard: daily auto backup downloaded', dl.value.suggested_filename.endswith('-auto.json'))
    pg.wait_for_timeout(2500)
    notes = pg.inner_text('#ppNotifyList')
    ok('Dashboard bell: auto backup note, no low-stock note (switched off)', 'Daily backup downloaded' in notes and 'low stock' not in notes, notes)
    ok('Auto backup logged once', SQL("select count(*)::int n from settings_backups where kind='auto'")[0]['n'] == 1)
    pg.reload(); pg.wait_for_timeout(3500)
    ok('Auto backup not repeated the same day', SQL("select count(*)::int n from settings_backups where kind='auto'")[0]['n'] == 1)
    c.close()

    # --- roles ---
    c, pg, errs = ctx(b, 'admin'); open_page(pg, 'about')
    ok('Admin: licence fields read-only', pg.is_disabled('#lType') and pg.is_disabled('#lValid'))
    pg.fill('#sName', 'Help'); save(pg)
    ok('Admin saves support contact, licence unchanged', sval('support')['name'] == 'Help' and sval('license')['valid_to'] == '2027-03-31')
    ok('Admin: no page errors', not errs, errs); c.close()
    c, pg, errs = ctx(b, 'pharmacist'); pg.goto(BASE + '/settings.html'); pg.wait_for_timeout(2500)
    ok('Pharmacist cannot open Settings', pg.query_selector('#pTitle') is None); c.close()

    # --- mobile ---
    c, pg, errs = ctx(b, 'super_admin', 390, 844, True); open_page(pg)
    ok('Mobile: no horizontal scroll', pg.evaluate('document.documentElement.scrollWidth') <= 390)
    tops = pg.eval_on_selector_all('.sg-mbar > *', 'e=>e.map(x=>Math.round(x.getBoundingClientRect().top))')
    ok('Mobile: section menu + Reset + Save in one row', len(tops) == 3 and max(tops) - min(tops) <= 2 and not pg.is_visible('.sg-nav'), tops)
    pg.select_option('#mSec', 'payments'); pg.wait_for_timeout(700)
    ok('Mobile: section dropdown switches', pg.inner_text('#mLbl') == 'Payment Methods' and pg.locator('.sg-pm-row').count() == 6)
    pg.select_option('#mSec', 'general'); pg.wait_for_timeout(700)
    q = pg.eval_on_selector_all('.sg-quick button', 'e=>[...new Set(e.map(x=>Math.round(x.getBoundingClientRect().top)))].length')
    s = pg.eval_on_selector_all('.sg-below > section', 'e=>e.map(x=>Math.round(x.getBoundingClientRect().top))')
    ok('Mobile: quick tiles 3 + 2, System info and Support side by side', q == 2 and len(s) == 2 and abs(s[0] - s[1]) <= 2, [q, s])
    ok('Mobile: no page errors', not errs, errs); c.close()

    # --- without 0033 ---
    fns = ['settings_get', 'settings_system_info']
    for f in fns: SQL(f'alter function {f} rename to {f}_off')
    c, pg, errs = ctx(b, 'super_admin'); open_page(pg, 'business')
    ok('Without 0033: message, pharmacy details still editable', '0033' in pg.inner_text('#msg') and pg.input_value('#bName') == 'PALLIKKAL MEDICALS')
    pg.fill('#bCity', 'Pallikkal'); save(pg)
    ok('Without 0033: pharmacy details save', SQL("select city from branches where id='0b000000-0000-0000-0000-000000000001'")[0]['city'] == 'Pallikkal')
    ok('Without 0033: no page errors', not errs, errs); c.close()
    for f in fns: SQL(f'alter function {f}_off rename to {f}')
    b.close()
print(f'\n{P} passed, {F} failed')
