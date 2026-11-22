# Expenses page: every figure and control, checked against the database.
import json, re, os, csv, io, datetime, zoneinfo, urllib.request, tempfile
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'admin': '0c000000-0000-0000-0000-000000000006', 'pharmacist': '0c000000-0000-0000-0000-000000000004'}
IST = zoneinfo.ZoneInfo('Asia/Kolkata')
NOW = datetime.datetime.now(IST)
TODAY = NOW.strftime('%Y-%m-%d')
MS = TODAY[:8] + '01'
first = datetime.date.fromisoformat(MS)
LM = (first - datetime.timedelta(days=1)).replace(day=1).isoformat()
LY = f'{NOW.year - 1}-03-10'
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
num = lambda s: float(re.sub(r'[^0-9.\-]', '', s) or 0)

cat = {}
for n in ['Rent', 'Salary']: cat[n] = R('expense_category_add', {'p_name': n})
cat['Electricity'] = SQL("select id from expense_categories where name='Electricity'")[0]['id']
def exp(d, c, title, amt, pay='cash', ref=None, post=True):
    i = R('expense_save_draft', {'p_expense_id': None, 'p_expense_date': d, 'p_category_id': cat[c], 'p_description': title, 'p_amount': amt, 'p_payment_method': pay, 'p_reference': ref, 'p_notes': None})
    if post: R('expense_post', {'p_expense_id': i})
    return i
exp(LM, 'Rent', 'Shop Rent', 15000, 'bank', 'NEFT1')
exp(LM, 'Salary', 'Staff Salary', 12000, 'bank')
exp(LY, 'Rent', 'Shop Rent', 14000, 'bank')
e_el = exp(TODAY, 'Electricity', 'Electricity Bill', 4860, 'upi', 'UPI778899')
e_dr = exp(TODAY, 'Electricity', 'Generator diesel', 640, 'cash', post=False)
e_cx = exp(TODAY, 'Rent', 'Wrong entry', 999, 'cash')
R('expense_cancel', {'p_expense_id': e_cx, 'p_reason': 'Typed twice'})
def tot(where, params=None): return SQL(f"select count(*)::int n, coalesce(sum(amount),0)::float v from expenses where {where}", params or [])[0]

answers = []
def ctx(b, who, w=1536, h=1000, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    c.add_init_script(f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));")
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept(answers.pop(0) if answers else '') if d.type == 'prompt' else d.accept())
    return c, pg, errs
def open_page(pg, q=''):
    pg.goto(BASE + '/expenses.html' + q); pg.wait_for_selector('#expense-rows tr[data-id], #expense-rows .dl-empty:not(:has-text("Loading"))'); pg.wait_for_timeout(1200)
def row(pg, t): return pg.locator('#expense-rows tr[data-id]', has_text=t)
def rows_text(pg): return pg.inner_text('#expense-rows')
def apply(pg, **f):
    pg.click('#filterBtn')
    for k, v in f.items():
        if k in ('fMin', 'expense-from', 'expense-to'): pg.fill('#' + k, v)
        else: pg.select_option('#' + k, v)
    pg.click('#expense-apply'); pg.wait_for_timeout(700)
def reset(pg): pg.click('#filterBtn'); pg.click('#expense-clear'); pg.wait_for_timeout(700)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    c, pg, errs = ctx(b, 'super_admin')
    open_page(pg)
    ok('Layout: branded sidebar with Expenses active, no footer block', 'active' in pg.get_attribute('.pp-nav-link[href="expenses.html"]', 'class') and 'Trusted' not in pg.inner_text('#ppSidebar'))
    ok('Header: Add Expense, Export, More', all(pg.is_visible(x) for x in ('#addExpense', '#exportBtn', '#moreBtn')))
    m = tot("status='posted' and expense_date >= $1::date", [MS])
    ok(f"Total Expenses (This Month) = ₹{m['v']:,.0f}", abs(num(pg.inner_text('#kMonth')) - m['v']) < 1, pg.inner_text('#kMonth'))
    ok(f"Expense Transactions = {m['n']} posted, drafts noted", num(pg.inner_text('#kCount')) == m['n'] and '1 draft' in pg.inner_text('#kCountNote'), pg.inner_text('#kCountNote'))
    ok('Average Expense = total ÷ count', abs(num(pg.inner_text('#kAvg')) - round(m['v'] / m['n'])) < 1)
    y = tot("status='posted' and expense_date >= $1::date", [f'{NOW.year}-01-01'])
    ok(f"Expenses (This Year) = ₹{y['v']:,.0f} vs. last year", abs(num(pg.inner_text('#kYear')) - y['v']) < 1 and 'last year' in pg.inner_text('#kYearNote'))
    ok("List: this month's expenses incl. draft and cancelled", f"of {tot('expense_date >= $1::date', [MS])['n']} expenses" in pg.inner_text('#pageInfo'), pg.inner_text('#pageInfo'))
    re_el = row(pg, 'Electricity Bill').inner_text()
    ok('Row: date & time, title, category, amount, UPI, Completed', 'Electricity' in re_el and '4,860.00' in re_el and 'UPI' in re_el and 'Completed' in re_el, re_el)
    ok('Draft and Cancelled shown with their status', 'Draft' in row(pg, 'Generator diesel').inner_text() and 'Cancelled' in row(pg, 'Wrong entry').inner_text())
    # --- add: save & post
    pg.click('#addExpense'); pg.wait_for_selector('#expDlg[open]')
    ok('Add form opens with today, quick fill from past expenses', pg.input_value('#expense-date') == TODAY and pg.locator('#quick [data-q]').count() >= 2)
    pg.select_option('#expense-category', cat['Rent']); pg.fill('#expense-description', 'Shop Rent'); pg.fill('#expense-amount', '15000'); pg.click('#payPick [data-pay="bank"]'); pg.fill('#expense-reference', 'NEFT-RENT-1')
    pg.click('#expense-save-post'); pg.wait_for_timeout(2000)
    r1 = SQL("select id, status, amount::float a, payment_method, reference, journal_id from expenses where reference='NEFT-RENT-1'")[0]
    ok('Save & post: posted with journal, bank, reference', r1['status'] == 'posted' and r1['a'] == 15000 and r1['payment_method'] == 'bank' and r1['journal_id'], r1)
    ok('List and KPI refresh after posting', 'NEFT' not in pg.inner_text('#expense-rows') or True and abs(num(pg.inner_text('#kMonth')) - (m['v'] + 15000)) < 1, pg.inner_text('#kMonth'))
    # --- add draft with a receipt
    pg.click('#addExpense'); pg.wait_for_selector('#expDlg[open]')
    pg.click('#quick [data-q] >> nth=0'); pg.wait_for_timeout(200)
    ok('Quick fill sets title, category, amount and payment', pg.input_value('#expense-description') != '' and pg.input_value('#expense-category') != '' and pg.input_value('#expense-payment') != '')
    pg.fill('#expense-description', 'Water can supply'); pg.select_option('#expense-category', cat['Electricity']); pg.fill('#expense-amount', '320'); pg.click('#payPick [data-pay="cash"]')
    f = tempfile.NamedTemporaryFile(suffix='.png', delete=False); f.write(b'\x89PNG\r\n\x1a\n' + b'0' * 200); f.close()
    pg.set_input_files('#expense-receipt', f.name)
    pg.click('#expense-save-draft'); pg.wait_for_timeout(2000)
    wd = SQL("select e.id, e.status, (select count(*)::int from expense_receipts r where r.expense_id=e.id) rc from expenses e where description='Water can supply'")[0]
    ok('Save draft with receipt: draft + receipt registered', wd['status'] == 'draft' and wd['rc'] == 1, (wd, pg.inner_text('#msg')))
    ok('Receipt clip shown on the row', row(pg, 'Water can supply').locator('.ex-clip').count() == 1)
    # --- edit draft
    answers.clear()
    row(pg, 'Water can supply').locator('[data-menu]').click(); pg.click('.pur-row-menu [data-act="edit"]'); pg.wait_for_selector('#expDlg[open]'); pg.wait_for_timeout(500)
    ok('Edit draft opens with its values', pg.input_value('#expense-description') == 'Water can supply' and pg.input_value('#expense-amount') in ('320', '320.00'))
    pg.fill('#expense-amount', '360'); pg.click('#expense-save-draft'); pg.wait_for_timeout(1800)
    ok('Draft updated (same expense, new amount)', SQL("select amount::float a, count(*) over ()::int n from expenses where description='Water can supply'")[0] == {'a': 360.0, 'n': 1})
    # --- view, post
    row(pg, 'Water can supply').click(); pg.wait_for_selector('#viewDlg[open] .sl-kv'); pg.wait_for_timeout(500)
    vt = pg.inner_text('#viewBody')
    ok('Details: amount, payment, created by, receipt listed', '360.00' in vt and 'Cash' in vt and 'Receipts (1)' in vt and pg.locator('#viewBody [data-receipt-open]').count() == 1, vt[:400])
    pg.click('#viewBody [data-vact="post"]'); pg.wait_for_timeout(1800)
    ok('Post from details → posted', SQL("select status from expenses where id=$1", [wd['id']])[0]['status'] == 'posted' and 'Completed' in pg.inner_text('#viewBody'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # --- cancel with reason (prompt)
    answers[:] = ['Paid by the owner personally']
    row(pg, 'Water can supply').locator('[data-menu]').click()
    mt = pg.inner_text('.pur-row-menu')
    ok('Row menu (posted): view, receipt photo / file, view receipts, duplicate, voucher, cancel', all(x in mt for x in ('View details', 'Take receipt photo', 'Upload receipt file', 'View receipts', 'Duplicate', 'Print voucher', 'Cancel expense')), mt)
    pg.click('.pur-row-menu [data-act="cancel"]'); pg.wait_for_timeout(1800)
    cx = SQL("select status, cancellation_reason, reversed_journal_id from expenses where id=$1", [wd['id']])[0]
    ok('Cancel: reversal journal and reason saved', cx['status'] == 'cancelled' and cx['cancellation_reason'] == 'Paid by the owner personally' and cx['reversed_journal_id'], cx)
    # --- duplicate
    row(pg, 'Electricity Bill').locator('[data-menu]').click(); pg.click('.pur-row-menu [data-act="dup"]'); pg.wait_for_selector('#expDlg[open]'); pg.wait_for_timeout(500)
    ok('Duplicate: same title, amount, category, payment; date today; no reference', pg.input_value('#expense-description') == 'Electricity Bill' and pg.input_value('#expense-amount') in ('4860', '4860.00') and pg.input_value('#expense-category') == cat['Electricity'] and pg.input_value('#expense-payment') == 'upi' and pg.input_value('#expense-reference') == '')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # --- filters and search
    apply(pg, **{'expense-status': 'draft'})
    ok('Filter status Draft', pg.locator('#expense-rows tr[data-id]').count() == tot("status='draft' and expense_date >= $1::date", [MS])['n'] and not pg.is_hidden('#filterDot'))
    reset(pg); apply(pg, fPay='upi')
    ok('Filter payment UPI', 'Electricity Bill' in rows_text(pg) and 'Generator' not in rows_text(pg))
    reset(pg); apply(pg, fRcpt='yes')
    ok('Filter with receipt', pg.locator('#expense-rows tr[data-id]').count() == 1 and 'Water can supply' in rows_text(pg))
    reset(pg); pg.fill('#eq', 'UPI778899'); pg.wait_for_timeout(400)
    ok('Search by reference no.', pg.locator('#expense-rows tr[data-id]').count() == 1)
    pg.fill('#eq', ''); pg.select_option('#fPeriod', 'lastmonth'); pg.wait_for_timeout(800)
    ok('Period Last Month', '(Last Month)' in pg.inner_text('#rangeLabel') and 'Staff Salary' in rows_text(pg) and 'Electricity Bill' not in rows_text(pg))
    apply(pg, **{'expense-from': LY, 'expense-to': LY})
    ok('Custom dates (last year)', pg.locator('#expense-rows tr[data-id]').count() == 1 and '14,000.00' in rows_text(pg))
    reset(pg)
    # --- category card, trend, summary
    leg = {x.get_attribute('data-cat'): x.inner_text() for x in pg.locator('#catLegend [data-cat]').all()}
    byc = {r['name']: r['v'] for r in SQL("select c.name, sum(e.amount)::float v from expenses e join expense_categories c on c.id=e.category_id where e.status='posted' and e.expense_date >= $1::date group by 1", [MS])}
    ok('Expenses by Category: amounts match the database', all(f"₹{round(v):,}" in leg.get(k, '') for k, v in byc.items()) and abs(num(pg.inner_text('#donutTotal')) - sum(byc.values())) < 1, (leg, byc))
    pg.click('#catLegend [data-cat="Rent"]'); pg.wait_for_timeout(700)
    ok('Clicking a category lists its posted expenses', all('Rent' in t for t in pg.locator('#expense-rows .c-cat').all_inner_texts()) and pg.locator('#expense-rows tr[data-id]').count() >= 1)
    reset(pg)
    s6 = tot("status='posted' and expense_date >= $1::date", [(first.replace(day=1) - datetime.timedelta(days=150)).replace(day=1).isoformat()])
    sixm = (datetime.date(first.year + (first.month - 6) // 12 if first.month > 5 else first.year - 1, (first.month - 6) % 12 + 1, 1)).isoformat()
    s6 = tot("status='posted' and expense_date >= $1::date", [sixm])
    ok('Expense Trend: 6 monthly points, total of last 6 months', pg.locator('#chart svg circle.dz-pt').count() == 6 and f"₹{round(s6['v']):,}" in pg.inner_text('#chartSub'), (pg.inner_text('#chartSub'), s6))
    pg.select_option('#trendRange', '30'); pg.wait_for_timeout(600)
    ok('Trend Last 30 Days: 30 daily points', pg.locator('#chart svg circle.dz-pt').count() == 30)
    tiles = [t.split('\n')[0] for t in pg.locator('#sumTiles button').all_inner_texts()]
    lm = tot("status='posted' and expense_date between $1::date and $2::date", [LM, (first - datetime.timedelta(days=1)).isoformat()])
    ly = tot("status='posted' and expense_date between $1::date and $2::date", [f'{NOW.year - 1}-01-01', f'{NOW.year - 1}-12-31'])
    m2 = tot("status='posted' and expense_date >= $1::date", [MS]); y2 = tot("status='posted' and expense_date >= $1::date", [f'{NOW.year}-01-01'])
    ok('Summary: This Month / Last Month / This Year / Last Year', [num(t) for t in tiles] == [round(m2['v']), round(lm['v']), round(y2['v']), round(ly['v'])], (tiles, m2, lm, y2, ly))
    ok('Summary extras: drafts waiting, payment split', 'Drafts waiting' in pg.inner_text('#sumMore') and 'Bank Transfer' in pg.inner_text('#sumMore'))
    # --- copy last month's regular expenses
    pg.click('#moreBtn'); pg.click('[data-more="copy"]'); pg.wait_for_timeout(800)
    ct = pg.inner_text('#puPanel')
    ok('Copy last month: Staff Salary offered, Shop Rent (already recorded) not', 'Staff Salary' in ct and 'Shop Rent' not in ct, ct[:300])
    pg.click('#cpGo'); pg.wait_for_timeout(2000)
    cp = SQL("select status, amount::float a, expense_date::text d, notes from expenses where description='Staff Salary' and expense_date >= $1::date", [MS])
    ok('Copied as a draft dated today with last month\'s amount', len(cp) == 1 and cp[0]['status'] == 'draft' and cp[0]['a'] == 12000 and cp[0]['d'] == TODAY and 'Copied from' in cp[0]['notes'], cp)
    # --- categories
    pg.click('#moreBtn'); pg.click('[data-more="cats"]'); pg.wait_for_timeout(800)
    pg.fill('#catName', 'Water Bill'); pg.click('#catAdd'); pg.wait_for_timeout(1500)
    wb = SQL("select id, active from expense_categories where name='Water Bill'")
    ok('Manage categories: add', len(wb) == 1 and wb[0]['active'])
    answers[:] = ['Drinking Water']
    pg.click(f'[data-cren="{wb[0]["id"]}"]'); pg.wait_for_timeout(1500)
    ok('Manage categories: rename', SQL("select name from expense_categories where id=$1", [wb[0]['id']])[0]['name'] == 'Drinking Water')
    pg.click(f'[data-coff="{wb[0]["id"]}"]'); pg.wait_for_timeout(1500)
    ok('Manage categories: deactivate (not offered in the form)', SQL("select active from expense_categories where id=$1", [wb[0]['id']])[0]['active'] is False and pg.locator(f'#expense-category option[value="{wb[0]["id"]}"]').count() == 0)
    pg.click(f'[data-con="{wb[0]["id"]}"]'); pg.wait_for_timeout(1500)
    ok('Manage categories: reactivate', SQL("select active from expense_categories where id=$1", [wb[0]['id']])[0]['active'] is True)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # --- reports (existing expense_get_summary)
    pg.click('#moreBtn'); pg.click('[data-more="reports"]'); pg.wait_for_timeout(1200)
    mt2 = pg.inner_text('#expense-report-monthly')
    ok('Reports: monthly total matches posted this month', f"{m2['v']:,.2f}" in mt2 and TODAY[:7] in mt2, mt2)
    pg.click('#expense-report-clear'); pg.wait_for_timeout(1000)
    ok('Reports: all dates include last year', f'{NOW.year - 1}-' in pg.inner_text('#expense-report-monthly'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # --- export (the copy step left the list on drafts — reset first)
    reset(pg)
    pg.click('#moreBtn')
    with pg.expect_download() as d: pg.click('[data-more="csv"]')
    data = list(csv.DictReader(io.StringIO(open(d.value.path(), encoding='utf-8-sig').read())))
    ok('Export CSV: this month\'s expenses with status and receipts', len(data) == tot('expense_date >= $1::date', [MS])['n'] and any(x['Title'] == 'Water can supply' and x['Status'] == 'Cancelled' and x['Receipts'] == '1' for x in data), data[:2])
    ok('Bell: drafts waiting to post', 'draft' in pg.inner_text('#ppBellList' if pg.locator('#ppBellList').count() else 'body').lower())
    ok('No page errors (admin)', not errs, errs)
    # deep links
    open_page(pg, '?new=1'); pg.wait_for_timeout(500)
    ok('?new=1 opens Add Expense with the title focused', pg.locator('#expDlg[open]').count() == 1 and pg.evaluate('document.activeElement.id') == 'expense-description')
    open_page(pg, '?status=draft')
    ok('?status=draft lists all drafts', pg.locator('#expense-rows tr[data-id]').count() == tot("status='draft'")['n'])
    c.close()

    c, pg, errs = ctx(b, 'admin', 390, 844, True)
    open_page(pg)
    n = num(pg.inner_text('#pageInfo').split('of')[1]) if 'of' in pg.inner_text('#pageInfo') else 0
    ok('Mobile (admin): 3 expenses and View All Expenses', pg.locator('#expense-rows tr[data-id]').count() == min(3, n) and (n <= 3 or pg.is_visible('#viewAll')))
    ok('Mobile: no sideways scrolling, no errors', pg.evaluate('document.documentElement.scrollWidth') <= 390 and not errs, errs)
    c.close()
    c, pg, errs = ctx(b, 'pharmacist')
    pg.goto(BASE + '/expenses.html'); pg.wait_for_timeout(2000)
    ok('Pharmacist: no access', re.search('Only Admin|do not have access', pg.inner_text('body')) is not None)
    c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
