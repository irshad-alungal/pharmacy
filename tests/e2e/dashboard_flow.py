# Dashboard end-to-end: every figure is compared with the database, and every control is exercised.
import json, re, os, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE='http://localhost:8790'; SA='0c000000-0000-0000-0000-000000000001'
TODAY=datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Kolkata')).strftime('%Y-%m-%d')
def api(kind, body):
    r=urllib.request.Request(BASE+'/api/'+kind, data=json.dumps({'user':SA, **body}).encode(), headers={'content-type':'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
def Q(t, cols, **k): return api('query', {'q': dict({'table':t,'op':'select','cols':cols,'filters':[],'order':[],'single':None,'count':None,'limit':None,'offset':None,'values':None,'returning':None}, **k)})['data']
P=F=0
def ok(n,c,x=''):
    global P,F
    P+=c; F+=not c
    print(('PASS ' if c else 'FAIL ')+n+('' if c else '  → '+str(x)[:300]))
num=lambda s: float(re.sub(r'[^0-9.\-]','',s) or 0)
ist=lambda ts: (datetime.datetime.fromisoformat(ts).astimezone(zoneinfo.ZoneInfo('Asia/Kolkata'))).strftime('%Y-%m-%d')


def R(name, args):
    r=api('rpc',{'name':name,'args':args})
    if r.get('error'): print('setup', name, r['error'])
    return r.get('data')
# --- activity for today: a cash sale, a sales return, a purchase return, expenses (posted + draft)
med=Q('medicines','id,name',filters=[['eq','name','Cetirizine']])[0]['id']
cart='33333333-0000-0000-0000-0000000000d1'
a=R('billing_allocate',{'p_cart':cart,'p_medicine':med,'p_qty':6})
tot=sum(R('billing_calc_line',{'p_mrp':r['mrp'],'p_qty':r['qty'],'p_discount_pct':r['default_discount_pct'],'p_gst_pct':r['tax_rate'],'p_price_includes_tax':r['price_includes_tax']})[0]['total_amount'] for r in a['rows'])
sale=R('finalize_sale_v3',{'p_customer':None,'p_items':[{'batch_id':r['batch_id'],'qty':r['qty']} for r in a['rows']],'p_payments':[{'method':'cash','amount':round(tot,2)}],'p_discount':0,'p_cart':cart,'p_expected_total':None,'p_patient':{}})
ri=R('returnable_items',{'p_invoice':sale})
R('process_sales_return',{'p_invoice':sale,'p_items':[{'sales_item_id':ri[0]['sales_item_id'],'qty':2,'disposition':'restock'}],'p_method':'cash','p_reason':'Dashboard test'})
pi=[r for r in R('purchase_list',{'p_limit':5}) if r['supplier_invoice_no']=='KPD-1001'][0]['id']
pr=R('purchase_returnable',{'p_invoice':pi})
R('process_purchase_return',{'p_invoice':pi,'p_items':[{'purchase_item_id':pr[0]['purchase_item_id'],'qty':1}],'p_reason':'Dashboard test'})
cat=R('expense_category_get_list',{'p_include_inactive':False})[0]['category_id']
e1=R('expense_save_draft',{'p_expense_id':None,'p_expense_date':TODAY,'p_category_id':cat,'p_description':'Power bill','p_amount':1250,'p_payment_method':'cash','p_reference':None,'p_notes':None})
R('expense_post',{'p_expense_id':e1})
R('expense_save_draft',{'p_expense_id':None,'p_expense_date':TODAY,'p_category_id':cat,'p_description':'Tea','p_amount':80,'p_payment_method':'cash','p_reference':None,'p_notes':None})

# --- expected values straight from the database
inv=[r for r in Q('sales_invoices','id,total,created_at,status') if r['status']=='final']
today_total=sum(float(r['total']) for r in inv if ist(r['created_at'])==TODAY)
today_n=sum(1 for r in inv if ist(r['created_at'])==TODAY)
low=api('rpc',{'name':'low_stock','args':{}})['data']
dl=api('rpc',{'name':'delivery_management_list','args':{}})['data']['invoices']
pend=sum(1 for r in dl if r.get('delivery') and r['delivery']['is_requested'] and r['delivery']['status'] in ('pending','out'))
meds=Q('medicines','id,reorder_level',filters=[['eq','active',True]])
bat=Q('medicine_batches','medicine_id,qty,expiry,quarantined,stock_status',filters=[['gt','qty',0]])
sell={}
for b in bat:
    if b['expiry']>TODAY and not b['quarantined'] and b['stock_status']=='active': sell[b['medicine_id']]=sell.get(b['medicine_id'],0)+float(b['qty'])
ins=lo=out=0
for m in meds:
    q=sell.get(m['id'],0); lvl=float(m['reorder_level'] or 0)
    if q<=0: out+=1
    elif lvl>0 and q<=lvl: lo+=1
    else: ins+=1
latest=sorted(Q('sales_invoices','invoice_no,created_at'), key=lambda r:r['created_at'], reverse=True)[:5]
pur=sum(float(r['total']) for r in Q('purchase_invoices','total,status,created_at') if r['status']=='confirmed' and ist(r['created_at'])==TODAY)
srt=sum(float(r['total']) for r in Q('sales_returns','total,created_at') if ist(r['created_at'])==TODAY)
prt=sum(float(r['total_value']) for r in Q('purchase_returns','total_value,created_at') if ist(r['created_at'])==TODAY)
expd=Q('expenses','amount,status,expense_date')
ex_today=sum(float(r['amount']) for r in expd if r['status']=='posted' and r['expense_date']==TODAY)
ex_month=sum(float(r['amount']) for r in expd if r['status']=='posted' and r['expense_date']>=TODAY[:8]+'01')
drafts=sum(1 for r in expd if r['status']=='draft')
led=Q('financial_ledger','account,debit,credit,entry_at')
led=[r for r in led if ist(r['entry_at'])==TODAY]
money_in=sum(float(r['debit']) for r in led if r['account'] in ('cash','upi','card','bank'))
money_out=sum(float(r['credit']) for r in led if r['account'] in ('cash','upi','card','bank'))
cash_net=sum(float(r['debit'])-float(r['credit']) for r in led if r['account']=='cash')
dues=sum(float(r['outstanding']) for r in api('rpc',{'name':'customer_dues','args':{}})['data'])
pays=sum(float(r['balance']) for r in api('rpc',{'name':'payable_balances','args':{}})['data'] if float(r['balance'])>0)
d30=(datetime.date.fromisoformat(TODAY)+datetime.timedelta(days=30)).isoformat()
d90=(datetime.date.fromisoformat(TODAY)+datetime.timedelta(days=90)).isoformat()
expired=sum(1 for b in bat if b['expiry']<=TODAY); exp30=sum(1 for b in bat if TODAY<b['expiry']<=d30); exp90=sum(1 for b in bat if d30<b['expiry']<=d90)
recent_pur=[r['supplier_invoice_no'] for r in api('rpc',{'name':'purchase_list','args':{'p_limit':6}})['data']]
print('expected', dict(pur=pur,srt=srt,prt=prt,ex_today=ex_today,ex_month=ex_month,drafts=drafts,money_in=money_in,money_out=money_out,dues=dues,pays=pays,expired=expired,exp30=exp30,exp90=exp90))

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    c=b.new_context(viewport={'width':1536,'height':1024})
    c.add_init_script(f"localStorage.setItem('e2e_user','{SA}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{SA}',date:'{TODAY}'}}));")
    pg=c.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(BASE+'/dashboard.html'); pg.wait_for_selector('#kSales:not(:has(.dz-skel))'); pg.wait_for_timeout(1500)
    ok(f"Today's Sales = ₹{today_total:,.0f}", abs(num(pg.inner_text('#kSales'))-round(today_total))<1, pg.inner_text('#kSales'))
    ok(f'Orders = {today_n}', num(pg.inner_text('#kOrders'))==today_n, pg.inner_text('#kOrders'))
    ok(f'Low Stock = {len(low)} (same rule as Inventory → Alerts)', num(pg.inner_text('#kLow'))==len(low), pg.inner_text('#kLow'))
    ok(f'Pending Deliveries = {pend}', num(pg.inner_text('#kDel'))==pend, pg.inner_text('#kDel'))
    ok(f'Inventory total = {len(meds)} medicines', num(pg.inner_text('#invTotal'))==len(meds), pg.inner_text('#invTotal'))
    leg=pg.inner_text('#legend')
    ok(f'Inventory split {ins}/{lo}/{out}', [int(x) for x in re.findall(r'(\d+) items?', leg)]==[ins,lo,out], leg)
    ok(f"Today's Purchases = ₹{pur:,.0f}", abs(num(pg.inner_text('#kPur'))-round(pur))<1, pg.inner_text('#kPur'))
    ok(f'Sales Returns Today = ₹{srt:,.0f}', srt>0 and abs(num(pg.inner_text('#kSRet'))-round(srt))<1, pg.inner_text('#kSRet'))
    ok(f'Purchase Returns Today = ₹{prt:,.0f}', prt>0 and abs(num(pg.inner_text('#kPRet'))-round(prt))<1, pg.inner_text('#kPRet'))
    ok(f"Today's Expenses = ₹{ex_today:,.0f} and {drafts} draft(s) flagged", abs(num(pg.inner_text('#kExp'))-round(ex_today))<1 and f'{drafts} draft' in pg.inner_text('#kExpNote'), pg.inner_text('#kExp')+' '+pg.inner_text('#kExpNote'))
    lt=pg.inner_text('#ledger')
    ok(f'Ledger: money in ₹{money_in:,.0f} / out ₹{money_out:,.0f}', f'₹{round(money_in):,}'.replace(',','') in lt.replace(',','') and f'₹{round(money_out):,}'.replace(',','') in lt.replace(',',''), lt[:300])
    ok('Ledger: debits equal credits', 'balanced' in lt and 'not balanced' not in lt, lt[-200:])
    cash_row=pg.inner_text('#ledger tbody tr:first-child')
    ok(f'Ledger: cash net ₹{cash_net:,.0f}', abs(num(cash_row.split()[-1])-round(cash_net))<1 if cash_net>=0 else '−' in cash_row, cash_row)
    ot=pg.inner_text('#outstanding')
    ok(f'Outstanding: customers owe ₹{dues:,.0f}, distributors ₹{pays:,.0f}', f'₹{round(dues):,}'.replace(',','') in ot.replace(',','') and f'₹{round(pays):,}'.replace(',','') in ot.replace(',',''), ot[:300])
    et=pg.inner_text('#expenses')
    ok(f'Expenses overview: month ₹{ex_month:,.0f}, category bar shown', f'₹{round(ex_month):,}'.replace(',','') in et.replace(',','') and 'Electricity' in et, et[:300])
    al=pg.inner_text('#alerts')
    ok('Inventory alerts tiles', 'Out of stock' in al and 'Expired in stock' in al and 'Deactivation requests' in al, al)
    ok(f'Expiry watch counts {expired}/{exp30}/{exp90}', [int(pg.inner_text(x)) for x in ('#segExpired','#seg30','#seg90')]==[expired,exp30,exp90])
    ok('Expiry watch lists the ≤30-day batch (Azithral Z-1)', 'Z-1' in pg.inner_text('#expiryRows') if exp30 else True, pg.inner_text('#expiryRows'))
    pg.click('#expSeg [data-w="expired"]'); pg.wait_for_timeout(200)
    ok('Expiry watch: Expired tab switches', ('No expired stock' in pg.inner_text('#expiryRows')) == (expired==0), pg.inner_text('#expiryRows'))
    rp=pg.inner_text('#recentPur')
    ok('Recent Purchases list newest bills', all(n in rp for n in recent_pur[:3]), rp)
    ok('Quick actions: 10 shortcuts', pg.locator('.dz-qa-item').count()==10)
    ok('Sidebar footer removed', 'Trusted' not in pg.inner_text('#ppSidebar'))
    rec=pg.inner_text('#recent')
    ok('Recent Sales = newest bills', all(r['invoice_no'] in rec for r in latest), rec[:300])
    lr=pg.inner_text('#lowRows')
    ok('Low Stock Alerts list the low medicines', all(l['name'] in lr for l in low[:5]), lr)
    tip=pg.inner_text('#dzTip')
    ok('Chart highlights today’s total', abs(num(tip)-round(today_total))<1, tip)
    pg.select_option('#chartRange','30'); pg.wait_for_timeout(400)
    ok('Chart period switch (30 days)', 'last 30 days' in pg.inner_text('#chartSub'))
    pg.click('#ppBell'); pg.wait_for_timeout(300)
    ok('Notifications open with live alerts', not pg.is_hidden('#ppNotify') and 'low stock' in pg.inner_text('#ppNotifyList').lower(), pg.inner_text('#ppNotifyList'))
    pg.click('#ppUser'); pg.wait_for_timeout(300)
    ok('User menu opens (settings, password, sign out)', not pg.is_hidden('#ppUserMenu') and 'Sign out' in pg.inner_text('#ppUserMenu'))
    pg.keyboard.press('Escape')
    pg.keyboard.press('Control+k'); pg.keyboard.type('Dol'); pg.wait_for_selector('.pp-sr-item')
    ok('Ctrl+K search finds medicines', 'Dolo' in pg.inner_text('.pp-search-results'))
    pg.keyboard.press('Enter'); pg.wait_for_url('**/medicines.html?q=*'); pg.wait_for_timeout(1500)
    ok('Search result opens Medicines filtered', pg.input_value('#q')=='Dolo' and 'Dolo' in pg.inner_text('#rows') and 'Pan' not in pg.inner_text('#rows'), pg.inner_text('#rows')[:200])
    pg.goto(BASE+'/dashboard.html'); pg.wait_for_timeout(1500)
    pg.fill('#ppSearch', latest[0]['invoice_no'][-6:]); pg.wait_for_selector('.pp-sr-item')
    pg.click('.pp-sr-item'); pg.wait_for_url('**/sales.html?q=*'); pg.wait_for_timeout(1500)
    ok('Invoice result opens Sales filtered', latest[0]['invoice_no'] in pg.inner_text('#sales-rows'))
    pg.goto(BASE+'/dashboard.html'); pg.wait_for_timeout(1200)
    pg.fill('#ppSearch','Ravi'); pg.wait_for_selector('.pp-sr-item'); pg.click('.pp-sr-item'); pg.wait_for_url('**/customers.html?q=*'); pg.wait_for_timeout(1500)
    ok('Customer result opens Customers filtered', 'Ravi' in pg.inner_text('#rows') and 'Anu' not in pg.inner_text('#rows'), pg.inner_text('#rows')[:200])
    pg.goto(BASE+'/dashboard.html'); pg.wait_for_timeout(1200)
    pg.click('text=Add Medicine'); pg.wait_for_timeout(1500)
    ok('Add Medicine opens the new-medicine form', pg.query_selector('#dlg[open]') is not None)
    pg.goto(BASE+'/dashboard.html'); pg.wait_for_timeout(1200)
    pg.click('text=New Sale'); pg.wait_for_url('**/billing.html'); ok('New Sale opens Billing', True)
    pg.goto(BASE+'/dashboard.html'); pg.wait_for_timeout(1200)
    pg.click('#recent tr'); pg.wait_for_url('**/sales.html?q=*'); ok('Clicking a transaction opens it in Sales', True)
    for href, check in [('purchases.html?new=1', lambda: pg.evaluate("document.getElementById('purchaseDialog').open")),
                        ('returns.html?tab=purchase', lambda: not pg.is_hidden('#purchase-panel')),
                        ('finance.html?tab=rec', lambda: 'Owes' in pg.inner_text('#panel') and 'sec' not in (pg.get_attribute('#tabs [data-k="rec"]','class') or '')),
                        ('expenses.html?new=1', lambda: pg.evaluate("document.activeElement.id")=='expense-description'),
                        ('customers.html?new=1', lambda: pg.query_selector('dialog[open]') is not None)]:
        pg.goto(BASE+'/dashboard.html'); pg.wait_for_timeout(1000)
        pg.click(f'.dz-qa-item[href="{href}"]'); pg.wait_for_timeout(1800)
        ok(f'Quick action → {href}', check(), pg.url)
    pg.goto(BASE+'/dashboard.html'); pg.wait_for_timeout(1200)
    pg.click('#recentPur tr'); pg.wait_for_url('**/purchases.html?q=*'); pg.wait_for_timeout(1500)
    ok('Clicking a purchase opens Purchases filtered', recent_pur[0] in pg.inner_text('#purchaseRows'), pg.inner_text('#purchaseRows')[:200])
    ok('No page errors (desktop)', not errs, errs)
    c.close()
    m=b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)
    m.add_init_script(f"localStorage.setItem('e2e_user','{SA}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{SA}',date:'{TODAY}'}}));")
    pg=m.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(BASE+'/dashboard.html'); pg.wait_for_timeout(2500)
    ok('Mobile: bottom navigation shown', pg.is_visible('.pp-bottom-nav'))
    pg.click('#ppMore'); pg.wait_for_timeout(400)
    ok('Mobile: More opens the full menu', 'open' in (pg.get_attribute('#ppSidebar','class') or ''))
    pg.click('#ppScrim', position={'x':370,'y':400}); pg.wait_for_timeout(400)
    ok('Mobile: menu closes', 'open' not in (pg.get_attribute('#ppSidebar','class') or ''))
    pg.fill('#dzSearchMobile','Pan'); pg.wait_for_selector('.dz-mobile-search .pp-sr-item'); pg.wait_for_timeout(300)
    ok('Mobile: search works', 'Pan' in pg.inner_text('.dz-mobile-search'))
    ok('No page errors (mobile)', not errs, errs)
    b.close()
print(f'\n{P} passed, {F} failed')
