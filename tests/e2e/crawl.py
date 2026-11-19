import json, sys, time, urllib.request
from playwright.sync_api import sync_playwright
BASE='http://localhost:8790'
USERS={'super_admin':'0c000000-0000-0000-0000-000000000001','billing_staff':'0c000000-0000-0000-0000-000000000002',
       'inventory_staff':'0c000000-0000-0000-0000-000000000003','pharmacist':'0c000000-0000-0000-0000-000000000004'}
PAGES=['dashboard','billing','delivery','medicines','inventory','purchases','distributors','customers','sales','returns','expenses','finance','reports','whatsapp','staff','documents','settings','audit-logs']
sys.path.insert(0,'.')
ACCESS={}
def srvlog():
    return json.loads(urllib.request.urlopen(BASE+'/__log').read())
def today():
    import datetime, zoneinfo
    return datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Kolkata')).strftime('%Y-%m-%d')
results=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=__import__('os').environ.get('CHROME') or None, args=['--no-sandbox'])
    only = sys.argv[1:] or list(USERS)
    for role in only:
        uid=USERS[role]
        ctx=b.new_context(viewport={'width':1366,'height':900})
        ctx.add_init_script(f"localStorage.setItem('e2e_user','{uid}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{uid}',date:'{today()}'}}));")
        pg=ctx.new_page()
        errs=[]
        pg.on('pageerror',lambda e: errs.append('PAGEERROR '+str(e)))
        pg.on('console',lambda m: m.type=='error' and 'Failed to load resource' not in m.text and errs.append('CONSOLE '+m.text[:200]))
        pg.on('dialog', lambda d: d.dismiss())
        srvlog()
        for page in PAGES:
            errs.clear()
            pg.goto(f'{BASE}/{page}.html')
            pg.wait_for_timeout(1800)
            nav=pg.eval_on_selector_all('nav.side a','els=>els.map(e=>e.textContent)') if pg.query_selector('nav.side') else []
            view=pg.inner_text('#view') if pg.query_selector('#view') else pg.inner_text('body')
            denied='do not have access' in view
            api=[x for x in srvlog()]
            results.append({'role':role,'page':page,'denied':denied,'errs':list(errs),'api':api,'len':len(view),'url':pg.url.split('/')[-1]})
            flag = 'DENIED' if denied else ('ERR' if (errs or api) else 'ok')
            print(f"{role:16} {page:13} {flag:6} {pg.url.split('/')[-1]:22} " + ' | '.join([e[:150] for e in errs]+[f"API {a['detail']}: {a['msg'][:120]}" for a in api]))
        ctx.close()
    b.close()
json.dump(results,open('crawl.json','w'),indent=1)
