import json, sys, re, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE='http://localhost:8790'
U={'super_admin':'0c000000-0000-0000-0000-000000000001','billing_staff':'0c000000-0000-0000-0000-000000000002',
   'inventory_staff':'0c000000-0000-0000-0000-000000000003','pharmacist':'0c000000-0000-0000-0000-000000000004'}
ACCESS={'super_admin':['dashboard','billing','delivery','medicines','inventory','purchases','distributors','customers','sales','returns','expenses','finance','reports','whatsapp','staff','documents','settings','audit-logs'],
 'billing_staff':['billing','delivery','medicines','inventory','customers','sales','returns'],
 'inventory_staff':['medicines','inventory','purchases','distributors','documents'],
 'pharmacist':['billing','delivery','medicines','inventory','purchases','distributors','customers','sales','returns','documents']}
TODAY=datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Kolkata')).strftime('%Y-%m-%d')
SERIOUS=re.compile(r'does not exist|Could not find|permission denied|row-level security|not supported by the harness|No relationship|syntax error|Not authorised|not authorized|violates|invalid input syntax|Bad identifier|filter |schema cache', re.I)
def srvlog(): return json.loads(urllib.request.urlopen(BASE+'/__log').read())
roles = sys.argv[1:] or list(U)
issues=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=__import__('os').environ.get('CHROME') or None, args=['--no-sandbox'])
    for role in roles:
        uid=U[role]
        c=b.new_context(viewport={'width':1400,'height':950}, accept_downloads=True)
        c.add_init_script(f"localStorage.setItem('e2e_user','{uid}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{uid}',date:'{TODAY}'}}));window.open=()=>null;")
        pg=c.new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)[:200]))
        pg.on('dialog', lambda d: d.accept('Test reason 123') if d.type=='prompt' else d.dismiss())
        for page in ACCESS[role]:
            srvlog(); errs.clear()
            pg.goto(f'{BASE}/{page}.html'); pg.wait_for_timeout(1500)
            clicked=set(); count=0
            for round_ in range(3):
                btns=pg.query_selector_all('#view button, #view [role=tab], #view summary, dialog[open] button, .audit-modal button')
                for el in btns:
                    try:
                        if not el.is_visible() or not el.is_enabled(): continue
                        txt=(el.inner_text() or el.get_attribute('aria-label') or '').strip()[:40]
                        key=txt+'|'+(el.get_attribute('id') or '')+'|'+(el.get_attribute('class') or '')
                        if key in clicked or re.search(r'sign out|delete|deactivate|remove|reverse|cancel expense|end session|logout', txt, re.I): continue
                        clicked.add(key); count+=1
                        el.click(timeout=1500); pg.wait_for_timeout(350)
                        for dlg in pg.query_selector_all('dialog[open]'):
                            pass
                    except Exception as e:
                        pass
                    if count>70: break
                # close open dialogs between rounds
                pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
            api=[a for a in srvlog() if SERIOUS.search(a['msg'])]
            status='ok' if not errs and not api else 'ISSUE'
            print(f"{role:16} {page:13} clicks={count:3} {status} " + ' | '.join(errs[:3]+[f"API {a['detail']}: {a['msg'][:140]}" for a in api[:4]]))
            if status!='ok': issues.append((role,page,errs,api))
        c.close()
    b.close()
json.dump(issues,open('monkey.json','w'),indent=1,default=str)
