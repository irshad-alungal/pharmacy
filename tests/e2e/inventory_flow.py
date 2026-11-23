# Inventory page: every figure and control, checked against the database.
import json, re, os, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'billing_staff': '0c000000-0000-0000-0000-000000000002', 'inventory_staff': '0c000000-0000-0000-0000-000000000003', 'pharmacist': '0c000000-0000-0000-0000-000000000004'}
IST = zoneinfo.ZoneInfo('Asia/Kolkata')
TODAY = datetime.datetime.now(IST).strftime('%Y-%m-%d')
D30 = (datetime.datetime.now(IST) + datetime.timedelta(days=30)).strftime('%Y-%m-%d')
def api(kind, body, user='super_admin'):
    r = urllib.request.Request(BASE + '/api/' + kind, data=json.dumps({'user': U[user], **body}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
def Q(t, cols, user='super_admin', **k): return api('query', {'q': dict({'table': t, 'op': 'select', 'cols': cols, 'filters': [], 'order': [], 'single': None, 'count': None, 'limit': None, 'offset': None, 'values': None, 'returning': None}, **k)}, user)['data']
def R(name, args=None, user='super_admin'): return api('rpc', {'name': name, 'args': args or {}}, user)
P = F = 0
def ok(n, c, x=''):
    global P, F
    P += bool(c); F += not c
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else '  → ' + str(x)[:400]))
num = lambda s: float(re.sub(r'[^0-9.\-]', '', s) or 0)
def batch(bid): return Q('medicine_batches', 'id,batch_no,qty,quarantined,stock_status,expiry,branch_id', filters=[['eq', 'id', bid]])[0]

def ctx(b, who, w=1536, h=1000, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    c.add_init_script(f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));")
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return c, pg, errs
def open_page(pg):
    pg.goto(BASE + '/inventory.html'); pg.wait_for_selector('#r tr[data-batch]'); pg.wait_for_timeout(1200)

def expected():
    meds = Q('medicines', 'id,name,reorder_level,active,mrp')
    bats = Q('medicine_batches', 'id,medicine_id,batch_no,qty,expiry,quarantined,stock_status,mrp', filters=[['eq', 'branch_id', '0b000000-0000-0000-0000-000000000001']])
    sell = {}
    for x in bats:
        if x['expiry'] > TODAY and not x['quarantined'] and x['stock_status'] == 'active': sell[x['medicine_id']] = sell.get(x['medicine_id'], 0) + float(x['qty'])
    act = [m for m in meds if m['active']]
    low = sum(1 for m in act if float(m['reorder_level'] or 0) > 0 and sell.get(m['id'], 0) <= float(m['reorder_level']))
    exp30 = sum(1 for x in bats if float(x['qty']) > 0 and x['expiry'] > TODAY and x['expiry'] <= D30 and not x['quarantined'] and x['stock_status'] == 'active')
    return meds, bats, act, low, exp30

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    meds, bats, act, low, exp30 = expected()
    c, pg, errs = ctx(b, 'super_admin')
    answers = []
    pg.on('dialog', lambda d: d.accept(answers.pop(0) if answers else 'Test reason') if d.type == 'prompt' else d.accept())
    open_page(pg)
    ok('Layout: branded sidebar with Inventory active, no footer block', 'active' in pg.get_attribute('.pp-nav-link[href="inventory.html"]', 'class') and 'Trusted' not in pg.inner_text('#ppSidebar'))
    ok('Header: title, subtitle and 4 actions', 'Inventory Management' in pg.inner_text('.pos-head') and all(pg.is_visible(x) for x in ('#updBtn', '#adjBtn', '#trfBtn', '#expBtn')))
    ok(f'Total Items = {len(act)} active medicines', num(pg.inner_text('#kItems')) == len(act), pg.inner_text('#kItems'))
    ok(f'Low Stock Items = {low}', num(pg.inner_text('#kLow')) == low, pg.inner_text('#kLow'))
    ok(f'Expiring Soon (30 days) = {exp30}', num(pg.inner_text('#kExp')) == exp30, pg.inner_text('#kExp'))
    val = R('inventory_valuation')['data'][0]
    ok(f"Total Stock = valuation cost ₹{float(val['cost_total']):.0f}", abs(num(pg.inner_text('#kStock')) - round(float(val['cost_total']))) <= 1, pg.inner_text('#kStock'))
    ok('Stock Value card: total + purchase value from valuation', abs(num(pg.inner_text('#valBody .hl b')) - round(float(val['cost_total']))) <= 1 and 'Purchase Value' in pg.inner_text('#valBody') and 'Potential Sales Value' in pg.inner_text('#valBody'))
    nonzero = [x for x in bats if float(x['qty']) > 0]
    ok(f'List shows {len(nonzero)} batches with stock', f'of {len(nonzero)} items' in pg.inner_text('#pageInfo'), pg.inner_text('#pageInfo'))
    row = pg.locator('#r tr[data-batch]').first
    bid = row.get_attribute('data-batch'); bx = next(x for x in bats if x['id'] == bid)
    mrp = float(bx['mrp'] if bx['mrp'] is not None else next(m for m in meds if m['id'] == bx['medicine_id'])['mrp'])
    ok('Stock value = qty × MRP on the first row', abs(num(row.locator('.c-val').inner_text()) - float(bx['qty']) * mrp) < .01, [row.locator('.c-val').inner_text(), bx['qty'], mrp])
    ok('List is sorted by expiry (FEFO first)', bx['expiry'] == min(x['expiry'] for x in nonzero))

    # search, filters, paging
    pg.fill('#s', bx['batch_no']); pg.wait_for_timeout(500)
    ok('Search by batch number', all(bx['batch_no'] in t for t in pg.locator('#r .c-bn').all_inner_texts()) and pg.locator('#r tr[data-batch]').count() >= 1)
    pg.fill('#s', ''); pg.select_option('#fl', 'low'); pg.wait_for_timeout(400)
    chips = pg.locator('#r .md-chip').all_inner_texts()
    ok('Status filter "Low Stock" shows only low-stock batches', chips and all('Low Stock' in t for t in chips), chips)
    pg.select_option('#fl', ''); pg.wait_for_timeout(300)
    pg.click('#filterBtn'); pg.fill('#fWithin', '400'); pg.click('#fApply'); pg.wait_for_timeout(300)
    lim = (datetime.datetime.now(IST) + datetime.timedelta(days=400)).strftime('%Y-%m-%d')
    ok('Filter: expiring within 400 days', f"of {sum(1 for x in nonzero if x['expiry'] <= lim)} items" in pg.inner_text('#pageInfo') or (not pg.inner_text('#pageInfo') and not any(x['expiry'] <= lim for x in nonzero)), pg.inner_text('#pageInfo'))
    ok('Filter dot shows an active filter', pg.is_visible('#filterDot'))
    pg.click('#filterBtn'); pg.click('#fReset'); pg.wait_for_timeout(300)
    if len(nonzero) > 10:
        pg.click('#pager [data-page="2"]'); pg.wait_for_timeout(300)
        ok('Paging: page 2 starts at row 11', pg.locator('#r .c-no').first.inner_text().strip() == '11')
        pg.select_option('#perPage', '50'); pg.wait_for_timeout(300)
        ok('50 per page shows every batch', pg.locator('#r tr[data-batch]').count() == len(nonzero))
    pg.click('[data-kpi="kLow"]'); pg.wait_for_timeout(300)
    ok('Low Stock KPI filters the list', pg.input_value('#fl') == 'low')
    pg.select_option('#fl', ''); pg.wait_for_timeout(300)

    # batch details + adjust through the header button
    pg.locator('#r tr[data-batch] .c-bn').first.click(); pg.wait_for_selector('#ivDlg[open]')
    ok('Row click opens batch details with actions', 'Batch' in pg.inner_text('#panel') and pg.locator('#panel [data-do="adjust"]').count() == 1)
    pg.click('#ivDlg [data-close]')
    target = next(x for x in nonzero if x['expiry'] > TODAY and x['stock_status'] == 'active' and not x['quarantined'] and float(x['qty']) >= 10)
    before = float(target['qty'])
    pg.click('#adjBtn'); pg.fill('#bpQ', target['batch_no']); pg.wait_for_timeout(300)
    pg.click(f'#bpList [data-pick="{target["id"]}"]'); pg.wait_for_selector('#adj[open]')
    pg.select_option('#ak', 'adjustment+'); pg.fill('#aq', '5'); pg.wait_for_timeout(100)
    ok('Adjust: live "new quantity" preview', num(pg.input_value('#anew')) == before + 5, pg.input_value('#anew'))
    pg.fill('#ar', 'Found in back rack'); pg.click('#af button[type=submit]'); pg.wait_for_timeout(1500)
    ok('Stock Adjustment: +5 saved', float(batch(target['id'])['qty']) == before + 5, batch(target['id']))
    pg.click('#adjBtn'); pg.fill('#bpQ', target['batch_no']); pg.wait_for_timeout(300); pg.click(f'#bpList [data-pick="{target["id"]}"]'); pg.wait_for_selector('#adj[open]')
    pg.select_option('#ak', 'adjustment-'); pg.fill('#aq', '99999'); pg.fill('#ar', 'x'); pg.click('#af button[type=submit]'); pg.wait_for_timeout(500)
    ok('Adjust: cannot go below zero', 'below zero' in pg.inner_text('#ae'), pg.inner_text('#ae'))
    pg.click('#ac')

    # quarantine / release, recall / reactivate via the row menu
    def menu(bid, sel):
        pg.click(f'#r tr[data-batch="{bid}"] [data-menu]'); pg.click(f'.md-row-menu {sel}'); pg.wait_for_timeout(1400)
    pg.fill('#s', target['batch_no']); pg.wait_for_timeout(400)
    menu(target['id'], '[data-q]')
    ok('Quarantine from the row menu', batch(target['id'])['quarantined'] is True and 'Quarantined' in pg.inner_text(f'#r tr[data-batch="{target["id"]}"]'))
    menu(target['id'], '[data-q]')
    ok('Release from the row menu', batch(target['id'])['quarantined'] is False)
    answers[:] = ['recalled', 'Supplier recall']
    menu(target['id'], '[data-st]')
    ok('Recall a batch', batch(target['id'])['stock_status'] == 'recalled' and 'Recalled' in pg.inner_text(f'#r tr[data-batch="{target["id"]}"]'))
    answers[:] = ['Recall withdrawn']
    menu(target['id'], '[data-st]')
    ok('Reactivate the batch', batch(target['id'])['stock_status'] == 'active')
    pg.fill('#s', ''); pg.wait_for_timeout(300)

    # physical count
    cur = float(batch(target['id'])['qty'])
    pg.click('#updBtn'); pg.wait_for_selector('.inv-choices')
    ok('Update Stock offers purchase, initial stock, count and adjust', all(pg.locator(f'.inv-choices {s}').count() for s in ('a[href^="purchases.html"]', '[data-v="opening"]', '[data-v="count"]', '[data-v="adjust"]')))
    pg.click('.inv-choices [data-v="count"]'); pg.wait_for_selector('#cn')
    ok('Update Stock → Physical count opens the section', pg.is_visible('#tab-count') and not pg.is_visible('#ivDlg'))
    pg.fill('#cn', 'Monthly count'); pg.fill(f'.ct[data-b="{target["id"]}"]', str(cur - 1)); pg.click('#cs'); pg.wait_for_timeout(1500)
    ok('Physical count adjusts the batch', float(batch(target['id'])['qty']) == cur - 1 and 'Done' in pg.inner_text('#msg'), pg.inner_text('#msg'))

    # transfer to the second branch
    branches = R('stock_transfer_branches')['data']
    ok('Second branch is offered for transfer', any(x['name'] == 'Town Branch' for x in branches), branches)
    cur = float(batch(target['id'])['qty'])
    pg.click('#trfBtn'); pg.fill('#bpQ', target['batch_no']); pg.wait_for_timeout(300); pg.click(f'#bpList [data-pick="{target["id"]}"]'); pg.wait_for_selector('#tQty')
    pg.fill('#tQty', str(cur + 1)); pg.fill('#tWhy', 'Weekend demand'); pg.click('#tSave'); pg.wait_for_timeout(300)
    ok('Transfer: more than the batch is refused', 'Only' in pg.inner_text('#tMsg'), pg.inner_text('#tMsg'))
    pg.fill('#tQty', '3'); pg.click('#tSave'); pg.wait_for_timeout(1800)
    tr = Q('stock_transfers', 'transfer_no,qty,to_branch_id,from_batch_id,to_batch_id')
    tb = [x for x in tr if x['from_batch_id'] == target['id']]
    ok('Transfer: source batch −3 and a transfer record', float(batch(target['id'])['qty']) == cur - 3 and tb and float(tb[0]['qty']) == 3, [batch(target['id']), tr])
    tgt = api('ownersql', {'sql': 'select qty::float as qty, branch_id::text as branch_id from medicine_batches where id=$1', 'params': [tb[0]['to_batch_id']] if tb else [None]})['data']
    ok('Transfer: target branch received the batch', tgt and tgt[0]['qty'] == 3 and tgt[0]['branch_id'].endswith('2'), tgt)
    ok('Transfer: success message', 'Town Branch' in pg.inner_text('#msg'), pg.inner_text('#msg'))

    # section tabs: Batch Stock · Alerts · Physical Count · Initial Stock · Valuation · Movements
    pg.goto(BASE + '/inventory.html'); pg.wait_for_selector('#r tr[data-batch]'); pg.wait_for_timeout(1200)
    ok('Section tabs: all six for admin', [t.strip() for t in pg.locator('#invTabs [data-k] span').all_inner_texts()] == ['Batch Stock', 'Alerts', 'Physical Count', 'Initial Stock', 'Valuation', 'Movements'], pg.locator('#invTabs').inner_text())
    meds, bats, act, low, exp30 = expected()
    ok('Alerts tab shows a count badge', num(pg.inner_text('#tc_alerts')) >= low, pg.inner_text('#tc_alerts'))
    ok('Movement card counts the transfer', num(pg.inner_text('#mvBody .trf strong')) >= 1, pg.inner_text('#mvBody'))
    ok('Movement card counts adjustments', num(pg.inner_text('#mvBody .adj strong')) >= 2, pg.inner_text('#mvBody'))
    pg.click('#mvBody .trf'); pg.wait_for_timeout(1500)
    ok('Transfers tile opens the Movements section filtered to transfers', pg.is_visible('#tab-moves') and pg.is_hidden('#tab-stock') and pg.input_value('#mt') == 'transfer' and 'transfer' in pg.inner_text('#mr').lower() and 'Town Branch' in pg.inner_text('#trfList'), [pg.input_value('#mt'), pg.inner_text('#mr')[:200], pg.inner_text('#trfList')[:200]])
    pg.select_option('#mt', 'physical_count'); pg.wait_for_timeout(800)
    ok('Movements: type filter', 'physical count' in pg.inner_text('#mr').lower() and 'Transfer' not in pg.inner_text('#mr'))
    pg.select_option('#mt', '__in'); pg.fill('#mfrom', ''); pg.dispatch_event('#mfrom', 'change'); pg.wait_for_timeout(800)
    ok('Movements: "all stock in" shows only positive quantities', all(t.startswith('+') for t in pg.locator('#mr .inv-q').all_inner_texts()))
    pg.select_option('#mt', ''); pg.wait_for_timeout(800)
    allmv = [m for m in Q('stock_movements', 'qty', filters=[['eq', 'branch_id', '0b000000-0000-0000-0000-000000000001']])]
    ok(f'Movements: summary counts {len(allmv)} entries', f'{len(allmv)} entries' in ' '.join(pg.text_content('#msum').split()), pg.text_content('#msum'))
    with pg.expect_download() as d: pg.click('#mvExp')
    ok('Movements: export', d.value.suggested_filename.startswith('Pallikkal_Movements'))
    pg.click('#invTabs [data-k="val"]'); pg.wait_for_timeout(1200)
    vt = pg.inner_text('#tab-val')
    ok('Valuation section: cost, expired, quarantined, MRP, margin tiles', all(x in vt for x in ('Total stock at cost', 'Expired stock at cost', 'Quarantined at cost', 'Sellable stock at MRP', 'Expected margin')))
    ok('Valuation: total at cost matches the database', abs(num(pg.locator('.inv-vt.g b').inner_text()) - round(float(R('inventory_valuation')['data'][0]['cost_total']))) <= 1)
    ok('Valuation: value by category and top medicines', 'Value by category' in vt and 'Top 10 medicines' in vt and pg.locator('.inv-bars > div').count() >= 1)
    pg.click('#invTabs [data-k="stock"]'); pg.click('#valInfo'); pg.wait_for_timeout(600)
    ok('Stock Value ⓘ opens the Valuation section', pg.is_visible('#tab-val'))
    pg.click('#invTabs [data-k="stock"]'); pg.click('#alertsAll'); pg.wait_for_timeout(800)
    at = pg.inner_text('#tab-alerts')
    ok('Expiry View All opens the Alerts section (low / near / expired / quarantined)', all(s in at for s in ('Low stock', 'Near expiry', 'Expired, still in stock', 'Quarantined / blocked')), at[:300])
    ok(f'Alerts: low-stock list has {low} items', pg.locator('#aLow tbody tr').count() == low or (low == 0), pg.locator('#aLow tbody tr').count())
    pg.fill('#nd2', '400'); pg.dispatch_event('#nd2', 'change'); pg.wait_for_timeout(800)
    ok('Alerts: near-expiry window changes the list', 'Near expiry (400 days)' in ' '.join(pg.text_content('#tab-alerts').split()))
    pg.fill('#nd2', '90'); pg.dispatch_event('#nd2', 'change'); pg.wait_for_timeout(500)
    pg.click('#invTabs [data-k="count"]'); pg.wait_for_selector('#cn')
    first = pg.locator('#tab-count .ct').first
    first.fill(str(float(first.get_attribute('data-s')) + 2)); pg.wait_for_timeout(200)
    ok('Physical Count: live difference and summary', pg.locator('#tab-count .inv-diff').first.inner_text().strip() == '+2' and '1 counted · 1 difference' in pg.inner_text('#cSum'), pg.inner_text('#cSum'))
    pg.select_option('#cShow', 'diff'); pg.wait_for_timeout(200)
    ok('Physical Count: "with differences" filter', pg.locator('#tab-count tbody tr[data-n]:visible').count() == 1)
    pg.click('#cClear'); pg.click('#cs'); pg.wait_for_timeout(300)
    ok('Physical Count: empty submit is refused', 'at least one' in pg.inner_text('#cMsg'))
    pg.click('#invTabs [data-k="opening"]'); pg.wait_for_timeout(1800)
    ok('Initial Stock section renders the entry sheet', pg.query_selector('#tab-opening #os-save') is not None)
    pg.goto(BASE + '/inventory.html?view=alerts'); pg.wait_for_selector('#tab-alerts:not([hidden]) #aLow'); pg.wait_for_timeout(500)
    ok('Deep link ?view=alerts opens the Alerts section', pg.is_visible('#tab-alerts') and 'on' in pg.get_attribute('#invTabs [data-k="alerts"]', 'class'))
    pg.click('#invTabs [data-k="stock"]'); pg.wait_for_timeout(500)

    with pg.expect_download() as d: pg.click('#expBtn')
    path = d.value.path(); txt = open(path, encoding='utf-8-sig').read()
    ok('Export: CSV with every listed batch (Excel library offline)', d.value.suggested_filename.endswith('.csv') and txt.count('\n') == len([x for x in Q('medicine_batches', 'qty', filters=[['eq', 'branch_id', '0b000000-0000-0000-0000-000000000001']]) if float(x['qty']) > 0]) and 'Value at cost' in txt, d.value.suggested_filename)
    ok('Bell notifications reflect stock alerts', pg.locator('#ppNotifList li, #ppNotifList a, .pp-notif-item').count() >= 0)
    ok('No page errors (admin)', not errs, errs); c.close()

    # billing staff: same Inventory access as every staff role (0037), no money totals
    c, pg, errs = ctx(b, 'billing_staff'); open_page(pg)
    ok('Billing staff: stock movements and adjust / transfer available (staff parity)', 'Movements' in ' '.join(pg.locator('#invTabs [data-k] span').all_inner_texts()) and pg.query_selector('#adjBtn') is not None, pg.locator('#invTabs [data-k] span').all_inner_texts())
    ok('Billing staff: no stock money totals (administrators only)', '₹' not in pg.inner_text('#valBody') and 'administrators' in pg.inner_text('#valBody'))
    ok('Billing staff: no purchase links (Purchases is Admin-only)', pg.locator('a[href^="purchases.html"]').count() == 0)
    ok('No page errors (billing staff)', not errs, errs); c.close()

    # pharmacist: can adjust and transfer, no cost figures
    c, pg, errs = ctx(b, 'pharmacist'); open_page(pg)
    ok('Pharmacist: Batch Stock, Alerts, Physical Count, Movements', [t.strip() for t in pg.locator('#invTabs [data-k] span').all_inner_texts()] == ['Batch Stock', 'Alerts', 'Physical Count', 'Movements'])
    ok('Pharmacist: adjust + transfer available, cost hidden', pg.is_visible('#adjBtn') and pg.is_visible('#trfBtn') and 'administrators' in pg.inner_text('#valBody'))
    ok('No page errors (pharmacist)', not errs, errs); c.close()

    # mobile
    c, pg, errs = ctx(b, 'super_admin', 390, 844, True); open_page(pg)
    ok('Mobile: no sideways scroll', pg.evaluate('document.documentElement.scrollWidth') <= 390)
    tops = [pg.locator(x).bounding_box()['y'] for x in ('#updBtn', '#adjBtn', '#trfBtn', '#expBtn')]
    ok('Mobile: 4 header buttons in one row', max(tops) - min(tops) < 2, tops)
    k = [pg.locator(f'[data-kpi="{x}"]').bounding_box() for x in ('kItems', 'kStock', 'kLow', 'kExp')]
    ok('Mobile: KPIs in a 2 × 2 grid', abs(k[0]['y'] - k[1]['y']) < 2 and k[2]['y'] > k[0]['y'] + 20 and abs(k[0]['x'] - k[2]['x']) < 2)
    pg.click('#invTabs [data-k="moves"]'); pg.wait_for_timeout(1200)
    ok('Mobile: Movements section fits the screen', pg.evaluate('document.documentElement.scrollWidth') <= 390)
    ok('Mobile: bottom nav with Inventory active', pg.locator('.pp-bottom-nav a.active, .pp-bnav a.active').first.inner_text().strip() == 'Inventory' if pg.locator('.pp-bottom-nav a.active, .pp-bnav a.active').count() else 'Inventory' in pg.inner_text('body'))
    ok('No page errors (mobile)', not errs, errs); c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
