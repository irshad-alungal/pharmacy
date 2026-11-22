# Documents Management page: every figure and control, checked against the database.
import json, re, os, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'admin': '0c000000-0000-0000-0000-000000000006', 'pharmacist': '0c000000-0000-0000-0000-000000000004',
     'billing_staff': '0c000000-0000-0000-0000-000000000002', 'inventory_staff': '0c000000-0000-0000-0000-000000000003', 'delivery': '0c000000-0000-0000-0000-000000000005'}
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
PDF = b'%PDF-1.4 test document'
def ctx(b, who, w=1536, h=1000, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    c.add_init_script(f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));window.__opened=[];window.open=(u)=>{{window.__opened.push(String(u));return {{}};}};")
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: 'data:' not in str(e) and errs.append(str(e)))  # test-only: mock signed links are data: URLs
    pg.on('dialog', lambda d: d.accept())
    return c, pg, errs
def open_page(pg, q=''):
    pg.goto(BASE + '/documents.html' + q); pg.wait_for_selector('#kTotal:not(:has(.dz-skel))'); pg.wait_for_timeout(1200)
def close_dlg(pg):
    if pg.evaluate("document.getElementById('puDlg').open"): pg.click('#puDlg [data-close]'); pg.wait_for_timeout(250)
def upload(pg, name, cat, ref='', issue='', exp='', remind='', fname='doc.pdf'):
    pg.click('#uploadBtn'); pg.wait_for_selector('#docForm')
    pg.set_input_files('#file', files=[{'name': fname, 'mimeType': 'application/pdf', 'buffer': PDF}])
    pg.select_option('#dCat', cat); pg.fill('#dName', name)
    if ref: pg.fill('#dRef', ref)
    if issue: pg.fill('#dIssue', issue)
    if exp: pg.fill('#dExp', exp)
    if remind: pg.fill('#dRemind', remind)
    pg.click('#dSave'); pg.wait_for_timeout(1500)
n = lambda pg, sel: int(re.sub(r'\D', '', pg.inner_text(sel)) or 0)
docs = lambda: SQL("select * from pharmacy_documents order by created_at")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    c, pg, errs = ctx(b, 'super_admin')
    open_page(pg)
    ok('Header, buttons, KPIs, categories, quick actions', pg.inner_text('.pos-title h1') == 'Documents Management' and pg.query_selector('#uploadBtn') and pg.query_selector('#folderBtn') and pg.locator('.dc-kpis .dz-kpi').count() == 4 and pg.locator('#quick button').count() == 5)
    tiles = pg.locator('#cats [data-cat]').all_inner_texts()
    ok('Category tiles: 7 pharmacy categories + supplier', len(tiles) == 8 and 'Licenses' in tiles[0] and 'Supplier' in tiles[-1], tiles)
    ok('Empty state', n(pg, '#kTotal') == 0 and 'No documents yet' in pg.inner_text('#rows'), pg.inner_text('#rows'))

    # --- upload pharmacy documents ---
    upload(pg, 'Drug License (Retail)', 'licenses', 'DL-KL-1', '2024-05-01', day(300))
    d = docs()
    ok('Upload: licence stored and registered', len(d) == 1 and d[0]['name'] == 'Drug License (Retail)' and d[0]['reference_no'] == 'DL-KL-1' and d[0]['expiry_date'][:10] == day(300) and d[0]['path'].startswith('0b000000-0000-0000-0000-000000000001/'), d)
    ok('Upload: storage object exists', SQL("select count(*)::int n from storage.objects where bucket_id='pharmacy-documents' and name=$1", [d[0]['path']])[0]['n'] == 1)
    ok('Upload: dialog closed and row listed', not pg.evaluate("document.getElementById('puDlg').open") and 'Drug License (Retail)' in pg.inner_text('#rows'))
    upload(pg, 'Shop Insurance Policy', 'insurance', 'INS-1', day(-300), day(20))
    upload(pg, 'Trade License', 'registrations', 'TL-1', day(-400), day(-3))
    upload(pg, 'GST Registration Certificate', 'tax', '32ABCDE1234F1Z5', '2021-04-10')
    upload(pg, 'Rent Agreement', 'agreements', 'RA-1', '2024-01-01', day(60), '90')
    ok('Upload: per-document reminder saved', [x for x in docs() if x['name'] == 'Rent Agreement'][0]['remind_days'] == 90)
    # validation
    pg.click('#uploadBtn'); pg.wait_for_selector('#docForm'); pg.click('#dSave'); pg.wait_for_timeout(300)
    ok('Upload: file required', 'Choose a file' in pg.inner_text('#uploadMsg'))
    pg.set_input_files('#file', files=[{'name': 'x.txt', 'mimeType': 'text/plain', 'buffer': b'x'}]); pg.click('#dSave'); pg.wait_for_timeout(300)
    ok('Upload: type checked', 'Invalid file type' in pg.inner_text('#uploadMsg'))
    pg.set_input_files('#file', files=[{'name': 'Fire_NOC_2025.pdf', 'mimeType': 'application/pdf', 'buffer': PDF}])
    ok('Upload: name suggested from the file name', pg.input_value('#dName') == 'Fire NOC 2025', pg.input_value('#dName'))
    pg.fill('#dIssue', '2025-06-01'); pg.fill('#dExp', '2025-01-01'); pg.click('#dSave'); pg.wait_for_timeout(300)
    ok('Upload: expiry before issue refused', 'before the issue date' in pg.inner_text('#uploadMsg'))
    pg.check('#dNoExp'); ok('Upload: No expiry disables the date', pg.is_disabled('#dExp'))
    close_dlg(pg)

    # --- supplier document (kept from the old page) ---
    pg.click('#uploadBtn'); pg.wait_for_selector('#docForm'); pg.select_option('#dCat', 'supplier')
    ok('Supplier: distributor / invoice / type fields shown', pg.is_visible('#distributor') and pg.is_visible('#purchase') and pg.is_visible('#type') and not pg.is_visible('#dName'))
    pg.set_input_files('#file', files=[{'name': 'challan.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF ch'}])
    pg.select_option('#distributor', index=1); pg.select_option('#type', 'delivery_challan'); pg.fill('#notes', 'Challan 778')
    pg.click('#dSave'); pg.wait_for_timeout(1500)
    sd = SQL("select * from purchase_documents")
    ok('Supplier: registered through register_purchase_document', len(sd) == 1 and sd[0]['doc_type'] == 'delivery_challan' and sd[0]['notes'] == 'Challan 778', sd)

    # --- KPIs vs database ---
    open_page(pg)
    ov = R('documents_overview')
    ok('KPIs match the database', n(pg, '#kTotal') == ov['total'] == 6 and n(pg, '#kValid') == ov['valid'] and n(pg, '#kExpiring') == ov['expiring'] == 2 and n(pg, '#kExpired') == ov['expired'] == 1, [pg.inner_text('#kTotal'), ov['valid'], ov['expiring'], ov['expired']])
    ok('Valid % of total', f"{ov['valid'] / ov['total'] * 100:.1f}%" in pg.inner_text('#kValidNote'), pg.inner_text('#kValidNote'))
    ok('Expiring note uses the reminder window', 'Within next 30 days' in pg.inner_text('#kExpiringNote'))
    ok('Category tile counts', '1' in pg.inner_text('#cats [data-cat="licenses"]') and '1' in pg.inner_text('#cats [data-cat="supplier"]'))
    ex = pg.locator('#exp [data-id]').all_inner_texts()
    ok('Expiring list: expiring first, then expired', len(ex) == 3 and 'Shop Insurance' in ex[0] and '20 days' in ex[0] and 'Trade License' in ex[-1] and '3 days ago' in ex[-1], ex)
    ok('Quick action badge = expiring + expired', pg.inner_text('#qExp') == '3')
    ok('Bell shows expiry alerts', pg.evaluate("document.body.innerText").count('expir') >= 1)

    # --- list, filters, pager ---
    ok('List: 6 rows with category chips and status', pg.locator('#rows tr[data-id]').count() == 6 and 'Expired' in pg.inner_text('#rows') and 'Expiring Soon' in pg.inner_text('#rows'))
    ok('Pager text', pg.inner_text('#pageInfo') == 'Showing 1 to 6 of 6 documents', pg.inner_text('#pageInfo'))
    pg.click('[data-kpi="kExpired"]'); pg.wait_for_timeout(800)
    ok('KPI click filters (expired)', pg.locator('#rows tr[data-id]').count() == 1 and 'Trade License' in pg.inner_text('#rows'))
    pg.click('#chips [data-clear="fStatus"]'); pg.wait_for_timeout(800)
    pg.click('#cats [data-cat="licenses"]'); pg.wait_for_timeout(800)
    ok('Category tile filters', pg.locator('#rows tr[data-id]').count() == 1 and pg.input_value('#fCat') == 'licenses' and 'Licenses' in pg.inner_text('#chips'))
    pg.click('#cats [data-cat="licenses"]'); pg.wait_for_timeout(800)
    pg.fill('#q', '32ABCDE'); pg.wait_for_timeout(1000)
    ok('Search by reference no.', pg.locator('#rows tr[data-id]').count() == 1 and 'GST Registration' in pg.inner_text('#rows'))
    pg.fill('#q', ''); pg.select_option('#fCat', 'supplier'); pg.wait_for_timeout(800)
    ok('Supplier filter shows distributor filter', pg.is_visible('#fDist') and pg.locator('#rows tr[data-id]').count() == 1)
    pg.select_option('#fDist', index=2); pg.wait_for_timeout(800)
    ok('Distributor filter narrows (other distributor → none)', pg.locator('#rows tr[data-id]').count() == 0)
    pg.select_option('#fDist', ''); pg.select_option('#fCat', ''); pg.select_option('#fStatus', 'attention'); pg.wait_for_timeout(800)
    ok('Status filter: expiring + expired', pg.locator('#rows tr[data-id]').count() == 3)
    pg.select_option('#fStatus', ''); pg.click('.dc-table thead [data-sort="expiry"]'); pg.wait_for_timeout(800)
    ok('Sort by expiry', 'Trade License' in pg.inner_text('#rows tr[data-id]:first-child'))
    pg.click('.dc-table thead [data-sort="expiry"]'); pg.wait_for_timeout(500)
    ok('Sort toggles back', pg.input_value('#fSort') == 'recent')
    for i in range(4): R('document_folder_save', {'p_id': None, 'p_name': f'tmp{i}'})
    # pager: add 5 more docs via API to get 11
    for i in range(5):
        path = f"0b000000-0000-0000-0000-000000000001/{SQL('select gen_random_uuid()::text u')[0]['u']}.pdf"
        api('storage', {'op': 'upload', 'bucket': 'pharmacy-documents', 'path': path, 'size': 10, 'type': 'application/pdf'})
        R('document_register', {'p': {'path': path, 'mime': 'application/pdf', 'size_bytes': 10, 'file_name': f'o{i}.pdf', 'name': f'Other doc {i}', 'category': 'others'}})
    open_page(pg)
    ok('Pager: 8 per page', pg.locator('#rows tr[data-id]').count() == 8 and pg.inner_text('#pageInfo') == 'Showing 1 to 8 of 11 documents', pg.inner_text('#pageInfo'))
    pg.click('#pager [data-page="2"]'); pg.wait_for_timeout(800)
    ok('Pager: page 2', pg.locator('#rows tr[data-id]').count() == 3 and pg.inner_text('#rows tr[data-id]:first-child td.c-no') == '9')
    pg.select_option('#fView', 'grid'); pg.wait_for_timeout(800)
    ok('Grid view', pg.is_visible('#gridWrap') and not pg.is_visible('#tableWrap') and pg.locator('#gridWrap .dc-card').count() == 11)
    pg.select_option('#fView', 'list'); pg.wait_for_timeout(800)

    # --- details, open, download ---
    lic = [x for x in docs() if x['name'] == 'Drug License (Retail)'][0]
    pg.fill('#q', 'Drug License'); pg.wait_for_timeout(900)
    pg.click(f'#rows tr[data-id="{lic["id"]}"] [data-a="view"]'); pg.wait_for_selector('.dc-det-head'); pg.wait_for_timeout(600)
    t = pg.inner_text('#puPanel')
    ok('Details: reference, dates, reminder, file', 'DL-KL-1' in t and 'days left' in t and '30 days before expiry (default)' in t and 'doc.pdf' in t, t[:400])
    ok('Details: PDF preview through a signed link', pg.query_selector('#prev iframe') is not None)
    pg.click('#puPanel [data-d="download"]'); pg.wait_for_timeout(600)
    ok('Download is logged', SQL("select count(*)::int n from audit_logs where action='document_downloaded' and entity_id=$1", [lic['id']])[0]['n'] == 1)
    pg.click('#puPanel [data-d="share"]'); pg.wait_for_timeout(200)
    ok('Share on WhatsApp builds the message', any('wa.me' in u and 'DL-KL-1' in u for u in pg.evaluate('window.__opened')))
    # edit
    pg.click('#puPanel [data-d="edit"]'); pg.wait_for_selector('#editForm')
    pg.fill('#dAuth', 'Drugs Control Department'); pg.fill('#dNotes', 'Renew at Attingal office'); pg.click('#eSave'); pg.wait_for_timeout(1200)
    x = [y for y in docs() if y['id'] == lic['id']][0]
    ok('Edit saves details', x['authority'] == 'Drugs Control Department' and x['notes'] == 'Renew at Attingal office', x)
    # renew
    pg.click(f'#rows tr[data-id="{lic["id"]}"] [data-rowmenu]'); pg.click('#rowMenu [data-rm="renew"]'); pg.wait_for_selector('#renewForm')
    pg.set_input_files('#file', files=[{'name': 'dl-2026.pdf', 'mimeType': 'application/pdf', 'buffer': PDF + b'2'}])
    pg.fill('#rRef', 'DL-KL-2'); pg.fill('#rExp', day(1800)); pg.click('#rSave'); pg.wait_for_timeout(1500)
    v = SQL("select version, status, reference_no from pharmacy_documents where root_id=$1 order by version", [lic['id']])
    ok('Renew: new version active, old archived', len(v) == 2 and v[0]['status'] == 'archived' and v[1]['status'] == 'active' and v[1]['reference_no'] == 'DL-KL-2', v)
    pg.wait_for_timeout(500)
    ok('Renew: list shows v2', 'v2' in pg.inner_text('#rows'))
    new_id = SQL("select id from pharmacy_documents where root_id=$1 and status='active'", [lic['id']])[0]['id']
    pg.click(f'#rows tr[data-id="{new_id}"]'); pg.wait_for_selector('.dc-det-head'); pg.click('#puPanel [data-tab="versions"]'); pg.wait_for_timeout(900)
    ok('Versions tab', 'v2' in pg.inner_text('#detBody') and 'v1' in pg.inner_text('#detBody') and 'Old version' in pg.inner_text('#detBody'))
    pg.click('#puPanel [data-tab="activity"]'); pg.wait_for_timeout(900)
    ok('Activity tab (uploaded, updated, renewed, downloaded)', all(k in pg.inner_text('#detBody') for k in ['Uploaded', 'Details updated', 'Renewed', 'Downloaded']), pg.inner_text('#detBody'))
    close_dlg(pg)

    # --- folders ---
    pg.click('#folderBtn'); pg.wait_for_selector('#fForm'); pg.fill('#fName', 'Licences & Registrations'); pg.click('#fForm button[type=submit]'); pg.wait_for_timeout(1200)
    fid = SQL("select id from pharmacy_doc_folders where name='Licences & Registrations'")
    ok('New folder created', len(fid) == 1)
    close_dlg(pg)
    pg.click(f'#rows tr[data-id="{new_id}"] [data-rowmenu]'); pg.click('#rowMenu [data-rm="move"]'); pg.wait_for_selector('#mFolder')
    pg.select_option('#mFolder', fid[0]['id']); pg.click('#mSave'); pg.wait_for_timeout(1200)
    ok('Move to folder', SQL("select folder_id from pharmacy_documents where id=$1", [new_id])[0]['folder_id'] == fid[0]['id'])
    pg.fill('#q', ''); pg.select_option('#fFolder', fid[0]['id']); pg.wait_for_timeout(900)
    ok('Folder filter', pg.locator('#rows tr[data-id]').count() == 1)
    pg.select_option('#fFolder', '')

    # --- categories ---
    pg.click('#quick [data-q="cats"]'); pg.wait_for_selector('#cForm')
    pg.fill('#cName', 'Fire Safety'); pg.click('#cForm button[type=submit]'); pg.wait_for_timeout(1200)
    ok('Add own category', SQL("select count(*)::int n from pharmacy_doc_categories where code='c_fire_safety'")[0]['n'] == 1 and 'Fire Safety' in pg.inner_text('#cats'))
    pg.fill('#puPanel tr[data-code="licenses"] input:not([type])', 'Licences'); pg.click('#puPanel tr[data-code="licenses"] [data-csave]'); pg.wait_for_timeout(1200)
    ok('Rename built-in category', 'Licences' in pg.inner_text('#cats'))
    pg.uncheck('#puPanel tr[data-code="insurance"] [data-cact]'); pg.click('#puPanel tr[data-code="insurance"] [data-csave]'); pg.wait_for_timeout(900)
    ok('Cannot hide a category with documents', 'Move or remove' in pg.inner_text('#cErr'))
    close_dlg(pg)

    # --- reminders ---
    pg.click('#quick [data-q="reminders"]'); pg.wait_for_selector('#remDef')
    ok('Reminders list only documents with expiry', pg.locator('#puPanel tr[data-rid]').count() == 4, pg.locator('#puPanel tr[data-rid]').count())
    pg.click('#puPanel [data-pre="60"]')
    pg.fill(f'#puPanel tr[data-rid="{new_id}"] input', '')
    ins = [x for x in docs() if x['name'] == 'Shop Insurance Policy'][0]['id']
    pg.fill(f'#puPanel tr[data-rid="{ins}"] input', '10'); pg.click('#remSave'); pg.wait_for_timeout(1500)
    ok('Reminders saved (default 60, insurance 10)', SQL("select default_remind_days d from pharmacy_doc_settings")[0]['d'] == 60 and SQL("select remind_days r from pharmacy_documents where id=$1", [ins])[0]['r'] == 10)
    ok('Expiring recalculated (insurance 20 days > 10 → valid, rent 60 days ≤ 90 → expiring)', n(pg, '#kExpiring') == R('documents_overview')['expiring'] == 1 and 'Within next 60 days' in pg.inner_text('#kExpiringNote'), pg.inner_text('#kExpiring'))

    # --- remove / restore ---
    gst = [x for x in docs() if x['name'] == 'GST Registration Certificate'][0]['id']
    pg.fill('#q', 'GST'); pg.wait_for_timeout(900)
    pg.click(f'#rows tr[data-id="{gst}"] [data-rowmenu]'); pg.click('#rowMenu [data-rm="remove"]'); pg.wait_for_selector('#rmReason')
    pg.click('#rmSave'); pg.wait_for_timeout(300); ok('Remove: reason required', 'Enter a reason' in pg.inner_text('#rmErr'))
    pg.fill('#rmReason', 'Uploaded twice'); pg.click('#rmSave'); pg.wait_for_timeout(1200)
    ok('Remove: soft-removed with reason', SQL("select status, removed_reason from pharmacy_documents where id=$1", [gst])[0] == {'status': 'removed', 'removed_reason': 'Uploaded twice'} and pg.locator('#rows tr[data-id]').count() == 0)
    pg.click('#moreBtn'); pg.click('#moreMenu [data-more="removed"]'); pg.wait_for_timeout(900)
    ok('Show removed', pg.locator(f'#rows tr[data-id="{gst}"]').count() == 1)
    pg.click(f'#rows tr[data-id="{gst}"] [data-rowmenu]'); pg.click('#rowMenu [data-rm="restore"]'); pg.wait_for_timeout(1200)
    ok('Restore', SQL("select status from pharmacy_documents where id=$1", [gst])[0]['status'] == 'active')
    sup = SQL("select id from purchase_documents")[0]['id']
    pg.fill('#q', 'challan'); pg.wait_for_timeout(900)
    pg.click(f'#rows tr[data-id="{sup}"] [data-rowmenu]'); pg.click('#rowMenu [data-rm="remove"]'); pg.wait_for_selector('#rmReason')
    pg.fill('#rmReason', 'Wrong supplier'); pg.click('#rmSave'); pg.wait_for_timeout(1200)
    ok('Supplier document removed via remove_purchase_document (file kept)', SQL("select status, removed_reason from purchase_documents where id=$1", [sup])[0]['status'] == 'removed' and SQL("select count(*)::int n from storage.objects where bucket_id='purchase-documents'")[0]['n'] == 1)
    pg.click('#moreBtn'); pg.click('#moreMenu [data-more="removed"]'); pg.fill('#q', ''); pg.wait_for_timeout(900)

    # --- report ---
    pg.click('#quick [data-q="report"]'); pg.wait_for_selector('#repScope')
    with pg.expect_download() as dl: pg.click('#puPanel [data-rep="csv"]')
    path = dl.value.path(); csv = open(path, encoding='utf-8-sig').read()
    ok('CSV report: header + all active documents', csv.startswith('#,Document,Category') and csv.count('\n') == R('documents_overview')['total'], csv[:300])
    pg.select_option('#repScope', 'attention')
    with pg.expect_download() as dl: pg.click('#puPanel [data-rep="csv"]')
    csv2 = open(dl.value.path(), encoding='utf-8-sig').read()
    ok('CSV report: expiring and expired only', 'Trade License' in csv2 and 'GST' not in csv2)
    pg.click('#puPanel [data-rep="share"]'); pg.wait_for_timeout(200)
    ok('WhatsApp expiry list', any('wa.me' in u and 'Trade%20License' in u for u in pg.evaluate('window.__opened')))
    close_dlg(pg)
    pg.click('#moreBtn'); pg.click('#moreMenu [data-more="acts"]'); pg.wait_for_timeout(1000)
    ok('Activity log (admin)', 'Removed' in pg.inner_text('#actsAll') and 'Restored' in pg.inner_text('#actsAll'))
    close_dlg(pg)
    pg.click('#catsAll'); pg.wait_for_timeout(300)
    ok('View All Categories', pg.locator('#puPanel [data-cat]').count() >= 9)
    pg.click('#puPanel [data-cat="registrations"]'); pg.wait_for_timeout(900)
    ok('All Categories → filter', pg.input_value('#fCat') == 'registrations' and pg.locator('#rows tr[data-id]').count() == 1)
    ok('Admin: no page errors', not errs, errs)
    c.close()

    # --- roles ---
    c, pg, errs = ctx(b, 'pharmacist'); open_page(pg)
    ok('Pharmacist: upload, no folders / management, no staff & supplier docs', pg.query_selector('#uploadBtn') and not pg.query_selector('#folderBtn') and not pg.query_selector('#cats [data-cat="supplier"]') and not pg.query_selector('#cats [data-cat="staff"]'))
    pg.click('#uploadBtn'); pg.wait_for_selector('#docForm')
    ok('Pharmacist: no Staff / Supplier category in upload', 'staff' not in pg.eval_on_selector_all('#dCat option', 'o=>o.map(x=>x.value)') and 'supplier' not in pg.eval_on_selector_all('#dCat option', 'o=>o.map(x=>x.value)'))
    close_dlg(pg)
    upload(pg, 'Pharmacist licence copy', 'licenses', 'PH-9')
    ok('Pharmacist uploads a pharmacy document', SQL("select count(*)::int n from pharmacy_documents where name='Pharmacist licence copy'")[0]['n'] == 1)
    r = pg.locator('#rows tr[data-id]').first; r.locator('[data-rowmenu]').click()
    ok('Pharmacist row menu: no edit / remove', 'Edit' not in pg.inner_text('#rowMenu') and 'Remove' not in pg.inner_text('#rowMenu'))
    ok('Pharmacist: no page errors', not errs, errs); c.close()

    c, pg, errs = ctx(b, 'inventory_staff'); open_page(pg)
    ok('Inventory staff sees supplier documents (download disabled)', pg.query_selector('#cats [data-cat="supplier"]') is not None)
    pg.click('#uploadBtn'); pg.wait_for_selector('#docForm'); pg.select_option('#dCat', 'supplier')
    pg.set_input_files('#file', files=[{'name': 'challan.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF ch'}])
    pg.select_option('#distributor', index=1); pg.wait_for_timeout(300)
    pg.click('#dSave'); pg.wait_for_timeout(1800)
    ok('Inventory staff uploads a supplier document', SQL("select count(*)::int n from purchase_documents where status='active'")[0]['n'] == 1, pg.inner_text('#uploadMsg') if pg.query_selector('#uploadMsg') else '')
    pg.fill('#q', 'delivery'); pg.wait_for_timeout(300); pg.fill('#q', ''); pg.select_option('#fCat', 'supplier'); pg.wait_for_timeout(900)
    ok('Inventory staff: supplier open/download is Admin only', pg.locator('#rows tr[data-id] [data-a="download"][disabled]').count() >= 1)
    ok('Inventory: no page errors', not errs, errs); c.close()

    c, pg, errs = ctx(b, 'billing_staff'); pg.goto(BASE + '/documents.html'); pg.wait_for_timeout(2500)
    ok('Billing staff cannot open Documents', pg.query_selector('#kTotal') is None); c.close()

    # --- mobile ---
    c, pg, errs = ctx(b, 'super_admin', 390, 844, True); open_page(pg)
    ok('Mobile: no horizontal scroll', pg.evaluate('document.documentElement.scrollWidth') <= 390)
    hb = pg.eval_on_selector_all('.dc-head-actions > *', 'e=>e.map(x=>Math.round(x.getBoundingClientRect().top))')
    ok('Mobile: 3 header buttons in one row', len(hb) == 3 and max(hb) - min(hb) <= 2, hb)
    k = pg.eval_on_selector_all('.dc-kpis .dz-kpi', 'e=>e.map(x=>[Math.round(x.getBoundingClientRect().left),Math.round(x.getBoundingClientRect().top)])')
    ok('Mobile: KPIs 2×2', len(set(x[0] for x in k)) == 2 and len(set(x[1] for x in k)) == 2, k)
    vis = pg.eval_on_selector_all('#cats .dc-tile', 'e=>e.filter(x=>{const r=x.getBoundingClientRect();return r.left>=0&&r.right<=392}).length')
    ok('Mobile: 5 category tiles in view', vis == 5, vis)
    s = pg.eval_on_selector_all('.dc-side > section', 'e=>e.map(x=>Math.round(x.getBoundingClientRect().top))')
    ok('Mobile: Expiring + Quick Actions side by side', len(s) == 2 and abs(s[0] - s[1]) <= 2, s)
    pg.click('#uploadBtn'); pg.wait_for_selector('#docForm')
    ok('Mobile: upload dialog fits', pg.evaluate("document.querySelector('#puDlg').getBoundingClientRect().width") <= 391)
    close_dlg(pg)
    ok('Mobile: no page errors', not errs, errs); c.close()

    # --- without 0032 ---
    fns = ['documents_overview', 'documents_list']
    for f in fns: SQL(f'alter function {f} rename to {f}_off')
    c, pg, errs = ctx(b, 'super_admin'); open_page(pg)
    ok('Without 0032: message, supplier archive still listed', '0032' in pg.inner_text('#msg') and pg.locator('#rows tr[data-id]').count() >= 1 and 'Supplier' in pg.inner_text('#rows'), pg.inner_text('#msg'))
    ok('Without 0032: no page errors', not errs, errs); c.close()
    for f in fns: SQL(f'alter function {f}_off rename to {f}')
    b.close()
print(f'\n{P} passed, {F} failed')
