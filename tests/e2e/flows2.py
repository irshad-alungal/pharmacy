import json, sys, datetime, zoneinfo, urllib.request, re
from playwright.sync_api import sync_playwright
BASE='http://localhost:8790'
U={'super_admin':'0c000000-0000-0000-0000-000000000001','billing_staff':'0c000000-0000-0000-0000-000000000002',
   'inventory_staff':'0c000000-0000-0000-0000-000000000003','pharmacist':'0c000000-0000-0000-0000-000000000004'}
TODAY=datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Kolkata')).strftime('%Y-%m-%d')
def api(kind, body):
    r=urllib.request.Request(BASE+'/api/'+kind, data=json.dumps(body).encode(), headers={'content-type':'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
def rpc(role, name, args): return api('rpc', {'user':U[role],'name':name,'args':args})
def query(role, q): return api('query', {'user':U[role],'q':q})
def srvlog(): return json.loads(urllib.request.urlopen(BASE+'/__log').read())
P=F=0
def ok(name, cond, extra=''):
    global P,F
    if cond: P+=1
    else: F+=1
    print(('PASS ' if cond else 'FAIL ')+name+('' if cond else '  → '+str(extra)[:500]))
def ctx_for(b, role, prompt='Test reason 123', answers_seq=None):
    uid=U[role]
    c=b.new_context(viewport={'width':1400,'height':950}, accept_downloads=True)
    c.add_init_script(f"localStorage.setItem('e2e_user','{uid}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{uid}',date:'{TODAY}'}}));window.__opened=[];window.open=(u)=>{{window.__opened.push(u);return null;}};")
    pg=c.new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e)))
    answers={'v':prompt}
    seq=iter(answers_seq) if answers_seq else None
    def handle(d):
        if d.type!='prompt': return d.accept()
        if seq is not None:
            try: return d.accept(next(seq))
            except StopIteration: pass
        d.accept(answers['v'])
    pg.on('dialog', handle)
    return c,pg,errs,answers
Q=lambda t,**k: dict({'table':t,'op':'select','cols':'*','filters':[],'order':[],'single':None,'count':None,'limit':None,'offset':None,'values':None,'returning':None},**k)

# --- setup: a sale to a customer (for returns, customers, delivery) via the real RPCs
cust=query('billing_staff', Q('customers', cols='id,name', filters=[['eq','name','Ravi Kumar']]))['data'][0]['id']
med=query('billing_staff', Q('medicines', cols='id,name', filters=[['eq','name','Cetirizine']]))['data'][0]['id']
cart='22222222-0000-0000-0000-000000000001'
a=rpc('billing_staff','billing_allocate',{'p_cart':cart,'p_medicine':med,'p_qty':4})['data']
tot=sum(rpc('billing_staff','billing_calc_line',{'p_mrp':r['mrp'],'p_qty':r['qty'],'p_discount_pct':r['default_discount_pct'],'p_gst_pct':r['tax_rate'],'p_price_includes_tax':r['price_includes_tax']})['data'][0]['total_amount'] for r in a['rows'])
inv=rpc('billing_staff','finalize_sale_v3',{'p_customer':cust,'p_items':[{'batch_id':r['batch_id'],'qty':r['qty']} for r in a['rows']],'p_payments':[{'method':'cash','amount':round(tot,2)}],'p_discount':0,'p_cart':cart,'p_expected_total':None,'p_patient':{'patient_name':'Ravi'}})
ok('setup: customer sale created', inv.get('data') is not None, inv)
INV=inv.get('data')
invno=query('billing_staff', Q('sales_invoices', cols='id,invoice_no', filters=[['eq','id',INV]]))['data'][0]['invoice_no']

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=__import__('os').environ.get('CHROME') or None, args=['--no-sandbox'])
    which=sys.argv[1:]
    def want(x): return not which or x in which

    if want('sales'):
        c,pg,errs,_=ctx_for(b,'billing_staff')
        pg.goto(BASE+'/sales.html'); pg.wait_for_selector('#rows tr[data-id]'); pg.wait_for_timeout(1500)
        ok('sales: invoice list shows the bill', invno in pg.inner_text('#rows'), pg.inner_text('#rows')[:300])
        pg.locator('#rows tr[data-id]', has_text=invno).locator('[data-menu]').click(); pg.click('.pur-row-menu [data-act="print"]'); pg.wait_for_timeout(1500)
        ok('sales: invoice opens', pg.query_selector('dialog[open] #pv') is not None, json.dumps(srvlog()))
        ok('sales: no page errors', not errs, errs); c.close()

    if want('returns'):
        c,pg,errs,_=ctx_for(b,'billing_staff')
        pg.goto(BASE+'/returns.html'); pg.wait_for_timeout(1500)
        pg.click('#newReturn'); pg.wait_for_selector('#q')
        pg.fill('#q', invno); pg.wait_for_timeout(1500)
        btn=pg.query_selector(f'[data-invoice]')
        ok('returns: invoice found by number', btn is not None, pg.inner_text('#list')[:300] if pg.query_selector('#list') else '')
        if btn:
            btn.click(); pg.wait_for_selector('.return-qty'); pg.fill('.return-qty','1'); pg.select_option('#reasonCode','wrong_medicine'); pg.fill('#return-reason','Wrong strength')
            pg.click('#submit-return'); pg.wait_for_timeout(2500)
            ok('returns: credit note created', 'credit' in pg.inner_text('#msg').lower() or pg.query_selector('dialog[open]') is not None, pg.inner_text('#msg')+json.dumps(srvlog()))
        ok('returns: no page errors', not errs, errs); c.close()

    if want('customers'):
        c,pg,errs,_=ctx_for(b,'super_admin', prompt='3000')
        pg.goto(BASE+'/customers.html'); pg.wait_for_selector('#rows tr[data-id]'); pg.wait_for_timeout(1200)
        pg.click(f'#rows tr[data-id="{cust}"] [data-menu]'); pg.click('.pur-row-menu [data-act="limit"]'); pg.wait_for_timeout(1200)
        lim=query('super_admin', Q('customers', cols='id,credit_limit', filters=[['eq','id',cust]]))['data'][0]['credit_limit']
        ok('customers: admin edits credit limit (set_credit_limit)', float(lim)==3000, lim)
        pg.click(f'[data-view="{cust}"]'); pg.wait_for_selector('#customer-view[open]'); pg.wait_for_timeout(1500)
        up=pg.query_selector(f'[data-sheet-input="{INV}"]')
        ok('customers: bill shows doctor-sheet upload (table from 0021)', up is not None, pg.inner_text('#customer-view-body')[:400])
        if up:
            up.set_input_files(files=[{'name':'rx.pdf','mimeType':'application/pdf','buffer':b'%PDF rx'}]); pg.wait_for_timeout(2500)
            body=pg.inner_text('#customer-view-body')
            ok('customers: doctor sheet uploaded and listed', 'rx.pdf' in body, body[:500]+json.dumps(srvlog()))
        ok('customers: no page errors', not errs, errs); c.close()

    if want('distributors'):
        c,pg,errs,_=ctx_for(b,'inventory_staff')
        pg.goto(BASE+'/distributors.html'); pg.wait_for_selector('#new'); pg.click('#new'); pg.wait_for_selector('#dlg[open]')
        pg.fill('#f [name=name]','Calicut Pharma'); pg.fill('#f [name=phone]','9847033333'); pg.fill('#f [name=gstin]','32AAACC1234D1Z5')
        pg.set_input_files('#logoFile', files=[{'name':'logo.png','mimeType':'image/png','buffer':b'\x89PNG\r\n\x1a\n'+b'0'*40}])
        pg.click('#f button[type=submit], #f button:not([type=button])'); pg.wait_for_timeout(2500)
        rows=pg.inner_text('#rows')
        ok('distributors: added with logo by inventory staff', 'Calicut Pharma' in rows, pg.inner_text('#err') if pg.query_selector('#err') else ''+json.dumps(srvlog()))
        lp=query('inventory_staff', Q('distributors', cols='id,logo_path', filters=[['eq','name','Calicut Pharma']]))['data']
        ok('distributors: logo_path saved (column from 0021)', bool(lp and lp[0].get('logo_path')), lp)
        pg.click('[data-v]'); pg.wait_for_timeout(1200)
        ok('distributors: view opens', pg.query_selector('#viewDlg[open]') is not None)
        ok('distributors: no page errors', not errs, errs); c.close()

    if want('inventory'):
        c,pg,errs,ans=ctx_for(b,'inventory_staff')
        pg.goto(BASE+'/inventory.html'); pg.wait_for_selector('#r tr[data-batch]'); pg.wait_for_timeout(1500)
        pg.click('#r [data-menu]'); pg.click('.md-row-menu [data-do="adjust"]'); pg.wait_for_selector('#adj[open]'); pg.fill('#aq','2'); pg.fill('#ar','Found in rack'); pg.click('#af button[type=submit]'); pg.wait_for_timeout(1500)
        ok('inventory: stock adjusted by inventory staff (role fix)', 'Stock updated' in pg.inner_text('#msg'), pg.inner_text('#ae')+pg.inner_text('#msg')+json.dumps(srvlog()))
        c.close()
        c,pg,errs,ans=ctx_for(b,'inventory_staff', answers_seq=['recalled','Manufacturer recall notice'])
        pg.goto(BASE+'/inventory.html'); pg.wait_for_selector('#r [data-menu]'); pg.wait_for_timeout(800)
        pg.click('#r [data-menu]'); pg.click('.md-row-menu [data-st]'); pg.wait_for_timeout(1500)
        ok('inventory: batch recalled (set_batch_stock_status)', 'recalled' in pg.inner_text('#msg'), pg.inner_text('#msg')+json.dumps(srvlog()))
        pg.click('#invTabs [data-k="count"]'); pg.wait_for_selector('#cn')
        pg.fill('#cn','Monthly count'); pg.fill('.ct','25'); pg.click('#cs'); pg.wait_for_timeout(1500)
        ok('inventory: physical count by inventory staff (role fix)', 'Done' in pg.inner_text('#msg'), pg.inner_text('#msg')+json.dumps(srvlog()))
        pg.click('#invTabs [data-k="moves"]'); pg.wait_for_timeout(1500)
        ok('inventory: movements list loads', 'physical count' in pg.inner_text('#tab-moves'), pg.inner_text('#tab-moves')[:300]+json.dumps(srvlog()))
        ok('inventory: no page errors', not errs, errs); c.close()

    if want('initial'):
        c,pg,errs,_=ctx_for(b,'super_admin')
        pg.goto(BASE+'/inventory.html'); pg.wait_for_selector('#r tr[data-batch]'); pg.click('#invTabs [data-k="opening"]'); pg.wait_for_timeout(2000)
        ok('initial stock: tab renders without Excel library (0011 functions installed)', pg.query_selector('#os-save') is not None, pg.inner_text('#tab-opening')[:300]+json.dumps(srvlog()))
        ok('initial stock: no page errors', not errs, errs); c.close()

    if want('documents'):
        c,pg,errs,_=ctx_for(b,'super_admin')
        pg.goto(BASE+'/documents.html'); pg.wait_for_selector('#uploadBtn'); pg.wait_for_timeout(1200)
        pg.click('#uploadBtn'); pg.wait_for_selector('#docForm'); pg.select_option('#dCat', 'supplier')
        pg.set_input_files('#file', files=[{'name':'challan.pdf','mimeType':'application/pdf','buffer':b'%PDF ch'}])
        pg.select_option('#distributor', index=1); pg.wait_for_timeout(300)
        pg.click('#docForm button[type=submit]'); pg.wait_for_timeout(2000)
        ok('documents: admin uploads a supplier document', 'registered' in pg.inner_text('.dl-toast') or 'challan' in pg.inner_text('#rows'), pg.inner_text('#rows')[:300]+json.dumps(srvlog()))
        ok('documents: no page errors', not errs, errs); c.close()

    if want('delivery'):
        c,pg,errs,_=ctx_for(b,'billing_staff')
        pg.goto(BASE+'/delivery.html'); pg.wait_for_timeout(2500)
        pg.click('#filterBtn'); pg.check('#fAll'); pg.click('#fApply'); pg.wait_for_timeout(800)
        ok('delivery: management list shows final bills', invno in pg.inner_text('#deliveryRows'), pg.inner_text('#deliveryRows')[:300]+json.dumps(srvlog()))
        ok('delivery: no page errors', not errs, errs); c.close()

    if want('whatsapp'):
        c,pg,errs,_=ctx_for(b,'super_admin')
        pg.goto(BASE+'/whatsapp.html'); pg.wait_for_selector('#newCampaign'); pg.wait_for_timeout(1500)
        pg.click('#newCampaign'); pg.wait_for_selector('#wcList [data-c]')
        pg.click('#wcAll'); pg.fill('#wcName','Weekly offer'); pg.fill('#wcBody','Hello {{name}}, 10% off this week!'); pg.fill('#wcInt','30'); pg.dispatch_event('#wcInt','input')
        pg.click('#wcStart'); pg.wait_for_selector('#runDlg[open] [data-run="open"]'); pg.wait_for_timeout(500)
        pg.click('[data-run="open"]'); pg.wait_for_timeout(700)
        opened=pg.evaluate('window.__opened')
        ok('whatsapp: chat opened with personalised message', bool(opened) and 'wa.me/91' in opened[0] and re.search(r'Hello%20(Anu|Ravi)', opened[0]) is not None, opened)
        ok('whatsapp: interval enforced before next chat', pg.is_disabled('[data-run="open"]'), pg.inner_text('#runPanel'))
        pg.click('[data-run="skip"]'); pg.wait_for_timeout(800)
        ok('whatsapp: campaign finishes', 'finished' in pg.inner_text('#runPanel').lower(), pg.inner_text('#runPanel'))
        ok('whatsapp: no page errors', not errs, errs); c.close()

    if want('medicines'):
        c,pg,errs,_=ctx_for(b,'inventory_staff')
        pg.goto(BASE+'/medicines.html'); pg.wait_for_selector('#new'); pg.wait_for_timeout(1000)
        pg.click('#new'); pg.wait_for_selector('#dlg[open]')
        pg.fill('#f [name=name]','Montair LC'); pg.fill('#f [name=strength]','10 mg'); pg.fill('#f [name=discount_text]','5%')
        pg.click('#f button[type=submit]'); pg.wait_for_timeout(1800)
        ok('medicines: inventory staff adds a medicine', 'Montair LC' in pg.inner_text('#rows'), (pg.inner_text('#err') if pg.query_selector('#err') else '')+json.dumps(srvlog()))
        ok('medicines: no page errors', not errs, errs); c.close()

    if want('expenses'):
        c,pg,errs,_=ctx_for(b,'super_admin')
        pg.goto(BASE+'/expenses.html'); pg.wait_for_timeout(2000); pg.click('#addExpense'); pg.wait_for_selector('#expense-form')
        cats=pg.eval_on_selector_all('#expense-category option','els=>els.map(e=>e.value).filter(Boolean)')
        ok('expenses: categories load', len(cats)>0, cats)
        if cats:
            pg.select_option('#expense-category', cats[0]); pg.fill('#expense-amount','1250'); pg.fill('#expense-description','KSEB bill November')
            pg.click('#payPick [data-pay="cash"]'); pg.click('#expense-save-draft'); pg.wait_for_timeout(1800)
            ok('expenses: draft saved', 'KSEB' in pg.inner_text('#expense-rows'), pg.inner_text('#expense-form-message')+json.dumps(srvlog()))
            pg.locator('#expense-rows tr[data-id]', has_text='KSEB').locator('[data-menu]').click(); pg.click('[data-expense-post]'); pg.wait_for_timeout(1800)
            ok('expenses: expense posted', 'completed' in pg.locator('#expense-rows tr[data-id]', has_text='KSEB').inner_text().lower(), pg.inner_text('#expense-message')+json.dumps(srvlog()))
        ok('expenses: no page errors', not errs, errs); c.close()

    if want('finance'):
        c,pg,errs,_=ctx_for(b,'super_admin')
        pg.goto(BASE+'/finance.html'); pg.wait_for_selector('#tabs'); pg.wait_for_timeout(1200)
        tabs=pg.eval_on_selector_all('#tabs [data-k]','els=>els.map(e=>e.dataset.k)')
        for k in tabs:
            pg.click(f'#tabs [data-k="{k}"]'); pg.wait_for_timeout(900)
        ok('finance: all tabs open', not [a for a in srvlog() if re.search('does not exist|permission denied|Could not find', a['msg'])], tabs)
        ok('finance: no page errors', not errs, errs); c.close()

    if want('settings'):
        c,pg,errs,_=ctx_for(b,'super_admin')
        pg.goto(BASE+'/settings.html#business'); pg.wait_for_selector('#branch-profile'); pg.wait_for_timeout(1500)
        pg.fill('#branch-profile [name=phone]','9847099999'); pg.click('.sg-panel-acts [data-act="save"]'); pg.wait_for_timeout(1500)
        ok('settings: pharmacy profile saved', 'saved' in pg.inner_text('#toast').lower(), pg.inner_text('#toast')+json.dumps(srvlog()))
        ok('settings: no page errors', not errs, errs); c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
