import json, sys, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE='http://localhost:8790'
U={'super_admin':'0c000000-0000-0000-0000-000000000001','billing_staff':'0c000000-0000-0000-0000-000000000002',
   'inventory_staff':'0c000000-0000-0000-0000-000000000003','pharmacist':'0c000000-0000-0000-0000-000000000004'}
TODAY=datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Kolkata')).strftime('%Y-%m-%d')
def api(kind, body):
    r=urllib.request.Request(BASE+'/api/'+kind, data=json.dumps(body).encode(), headers={'content-type':'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
def srvlog(): return json.loads(urllib.request.urlopen(BASE+'/__log').read())
P=F=0
def ok(name, cond, extra=''):
    global P,F
    if cond: P+=1
    else: F+=1
    print(('PASS ' if cond else 'FAIL ')+name+('' if cond else '  → '+str(extra)[:400]))
def ctx_for(b, role):
    uid=U[role]
    c=b.new_context(viewport={'width':1400,'height':950}, accept_downloads=True)
    c.add_init_script(f"localStorage.setItem('e2e_user','{uid}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{uid}',date:'{TODAY}'}}));")
    pg=c.new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e)))
    return c,pg,errs
flows = sys.argv[1:]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=__import__('os').environ.get('CHROME') or None, args=['--no-sandbox'])

    if not flows or 'billing' in flows:
        c,pg,errs=ctx_for(b,'billing_staff')
        pg.on('dialog', lambda d: d.accept('Counter 2') if d.type=='prompt' else d.accept())
        srvlog()
        pg.goto(BASE+'/billing.html'); pg.wait_for_selector('#q')
        pg.fill('#patientName','Anu Thomas'); pg.fill('#doctorName','Dr. Rao'); pg.fill('#diagnosis','Fever')
        pg.fill('#q','Dol'); pg.wait_for_selector('.medicine-result'); pg.click('.medicine-result')
        pg.wait_for_selector('tr.batch-row')
        pg.fill('[data-gqty]','25'); pg.wait_for_timeout(1500)
        rows=pg.eval_on_selector_all('tr.batch-row td.batch-cell','els=>els.map(e=>e.innerText.split("\\n")[0])')
        ok('billing: 25 tablets allocated FEFO across 3 batches', len(rows)==3 and 'D-A' in rows[0] and 'D-C' in rows[2], rows)
        tot=pg.inner_text('#tot')
        ok('billing: grand total shown', '₹' in tot, tot)
        pg.click('#pay'); pg.wait_for_timeout(2500)
        msg=pg.inner_text('#msg')
        ok('billing: bill finalized (finalize_sale_v3)', 'Bill saved' in msg, msg + ' ' + json.dumps(srvlog()))
        ok('billing: invoice preview opened', pg.query_selector('dialog[open] #pv') is not None)
        pv=pg.inner_text('dialog[open] #pv') if pg.query_selector('dialog[open] #pv') else ''
        ok('billing: invoice shows patient and doctor', 'Anu Thomas' in pv and 'Dr. Rao' in pv, pv[:300])
        if pg.query_selector('dialog[open] #cl'): pg.click('dialog[open] #cl')
        # hold + resume
        pg.fill('#q','Pan'); pg.wait_for_selector('.medicine-result'); pg.click('.medicine-result'); pg.wait_for_selector('tr.batch-row')
        pg.fill('#patientName','Hold Patient')
        pg.click('#hold'); pg.wait_for_timeout(1500)
        ok('billing: bill held (billing_staff, was blocked live)', 'Bill held' in pg.inner_text('#msg'), pg.inner_text('#msg') + json.dumps(srvlog()))
        pg.click('#held'); pg.wait_for_selector('[data-res]'); pg.click('[data-res]'); pg.wait_for_timeout(2500)
        ok('billing: held bill resumed with medicine and patient', pg.query_selector('tr.batch-row') is not None and pg.input_value('#patientName')=='Hold Patient', pg.inner_text('#msg'))
        pg.click('#clear'); pg.wait_for_timeout(800)
        ok('billing: no page errors', not errs, errs)
        c.close()

    if not flows or 'purchase' in flows:
        c,pg,errs=ctx_for(b,'inventory_staff')
        pg.on('dialog', lambda d: d.accept())
        srvlog()
        pg.goto(BASE+'/purchases.html'); pg.wait_for_selector('#newPurchase')
        pg.click('#newPurchase'); pg.wait_for_selector('#purchaseDialog[open]')
        pg.select_option('#supplier', label='Kerala Pharma Distributors')
        pg.fill('#invoiceNo','KPD-2002')
        row='#itemRows tr:first-child '
        pg.fill(row+'.med-name','Cetirizine 10 mg'); pg.dispatch_event(row+'.med-name','change'); pg.wait_for_timeout(1200)
        pg.fill(row+'.pack','10'); pg.fill(row+'.batch','C-9'); pg.fill(row+'.expiry','2028-09-30'); pg.fill(row+'.qty','4'); pg.fill(row+'.free','1')
        pg.fill(row+'.mrp','180'); pg.fill(row+'.rate','95'); pg.fill(row+'.gst','12')
        units=pg.inner_text(row+'.stock-units')
        ok('purchase: stock units = 10 × (4 + 1) = 50', units=='50', units)
        # second row: new medicine via create
        pg.click('#addItem'); r2='#itemRows tr:nth-child(2) '
        pg.fill(r2+'.med-name','Brandnew Syrup'); pg.dispatch_event(r2+'.med-name','change'); pg.wait_for_timeout(1200)
        ok('purchase: unknown medicine offers Create', pg.is_visible(r2+'.create-med'))
        pg.click(r2+'.create-med'); pg.wait_for_selector('#newMedDialog[open]'); pg.fill('#nmStrength','100 ml'); pg.click('#nmSave'); pg.wait_for_timeout(1500)
        ok('purchase: medicine created from bill row', pg.get_attribute('#itemRows tr:nth-child(2)','data-medicine-id') is not None, pg.inner_text('#formError')+json.dumps(srvlog()))
        pg.fill(r2+'.batch','S-1'); pg.fill(r2+'.expiry','2027-10-31'); pg.fill(r2+'.qty','2'); pg.fill(r2+'.mrp','95'); pg.fill(r2+'.rate','60')
        pg.click('#saveDraft'); pg.wait_for_timeout(1500)
        ok('purchase: draft saved', 'Draft saved' in pg.inner_text('#formError'), pg.inner_text('#formError')+json.dumps(srvlog()))
        pg.click('#closePurchase'); pg.click('[data-tab="drafts"]'); pg.wait_for_timeout(600)
        ok('purchase: draft listed in Drafts tab', 'KPD-2002' in pg.inner_text('#purchaseRows'))
        pg.click('[data-resume]'); pg.wait_for_selector('#purchaseDialog[open]'); pg.wait_for_timeout(800)
        ok('purchase: draft reopened with 2 rows', len(pg.query_selector_all('#itemRows tr'))==2)
        pg.set_input_files('#billFiles', files=[{'name':'bill.pdf','mimeType':'application/pdf','buffer':b'%PDF-1.4 test'}])
        pg.click('#confirmPurchase'); pg.wait_for_timeout(1500)
        if not pg.query_selector('#confirmDialog[open]'): print('FORM MSG:', pg.inner_text('#formError'), [ (r.get_attribute('data-medicine-id'), r.query_selector('.med-name').input_value()) for r in pg.query_selector_all('#itemRows tr')])
        pg.wait_for_selector('#confirmDialog[open]', timeout=3000)
        pg.click('#postNow'); pg.wait_for_timeout(3000)
        ok('purchase: posted by inventory_staff and detail opened', pg.query_selector('#viewDialog[open]') is not None, pg.inner_text('#formError')+json.dumps(srvlog()))
        detail=pg.inner_text('#viewContent') if pg.query_selector('#viewDialog[open]') else ''
        ok('purchase: detail shows lines and attached bill', 'C-9' in detail and 'bill.pdf' in detail, detail[:500])
        ok('purchase: cost hidden from inventory staff', 'Rate/pack' not in detail)
        pg.click('#closeView'); pg.click('[data-tab="drafts"]'); pg.wait_for_timeout(500)
        ok('purchase: draft removed after posting', 'KPD-2002' not in pg.inner_text('#purchaseRows'))
        ok('purchase: no page errors', not errs, errs)
        c.close()

    if not flows or 'reports' in flows:
        c,pg,errs=ctx_for(b,'super_admin')
        srvlog()
        pg.goto(BASE+'/reports.html'); pg.wait_for_selector('#rp')
        pg.click('[data-r="all"]')
        opts=pg.eval_on_selector_all('#rp option','els=>els.map(e=>e.value)')
        for o in opts:
            pg.select_option('#rp', o); pg.click('#run'); pg.wait_for_timeout(1300)
            out=pg.inner_text('#out'); msg=pg.inner_text('#msg')
            bad='error' in (pg.get_attribute('#msg','class') or '') or 'Could not find' in msg or 'Not authorised' in msg
            ok(f'report {o} runs', not bad, msg + json.dumps(srvlog()))
        pg.select_option('#rp','sales'); pg.click('#run'); pg.wait_for_timeout(1200)
        ok('reports: sales report lists invoices', 'INV' in pg.inner_text('#out') or '-0' in pg.inner_text('#out'), pg.inner_text('#out')[:300])
        ok('reports: no page errors', not errs, errs)
        c.close()

    if not flows or 'audit' in flows:
        c,pg,errs=ctx_for(b,'super_admin')
        pg.goto(BASE+'/audit-logs.html'); pg.wait_for_selector('#rows'); pg.wait_for_timeout(1500)
        n=len(pg.query_selector_all('#rows [data-i]'))
        ok('audit: activity rows listed', n>0, pg.inner_text('#summary'))
        if n: pg.click('#rows [data-i]'); ok('audit: detail modal opens', not pg.is_hidden('#modal')); pg.click('#modal header [data-close]')
        pg.select_option('#action','purchase'); pg.wait_for_timeout(1200)
        ok('audit: action filter', all('purchase' in t.lower() for t in pg.eval_on_selector_all('#rows .audit-action','els=>els.map(e=>e.textContent)')))
        pg.click('[data-tab="logins"]'); pg.wait_for_timeout(1000)
        ok('audit: sign-in history tab loads', 'Staff ID' in pg.inner_text('#head'))
        with pg.expect_download() as dl: pg.click('#export')
        ok('audit: CSV export downloads', dl.value.suggested_filename.endswith('.csv'))
        ok('audit: no page errors', not errs, errs)
        c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
