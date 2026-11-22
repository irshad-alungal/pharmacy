# Public home page (index.html) + Settings → Website: every value on the page checked against the database,
# visitor permissions, WhatsApp order / refill links, stock check, language, mobile layout, fallback without 0035.
import json, re, datetime, zoneinfo, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'admin': '0c000000-0000-0000-0000-000000000006', 'pharmacist': '0c000000-0000-0000-0000-000000000004'}
BR = '0b000000-0000-0000-0000-000000000001'
IST = zoneinfo.ZoneInfo('Asia/Kolkata')
TODAY = datetime.datetime.now(IST).strftime('%Y-%m-%d')
def api(kind, body, user='super_admin'):
    r = urllib.request.Request(BASE + '/api/' + kind, data=json.dumps({'user': U[user] if user else None, **body}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
def R(name, args=None, user='super_admin'):
    return api('rpc', {'name': name, 'args': args or {}}, user)
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
TILL = (datetime.datetime.now(IST) + datetime.timedelta(days=10)).strftime('%Y-%m-%d')
HOURS = [{'day': d, 'open': '08:00', 'close': '21:00', 'closed': False} for d in range(7)]
HOURS[0] = {'day': 0, 'open': '09:00', 'close': '13:00', 'closed': False}
SITE = {'published': True, 'headline': 'Your Health. Our Priority.', 'hero_text': '', 'about_text': '', 'whatsapp': '9847099999', 'map_query': 'Pallikkal Pharmacy, MG Road, Thrissur',
        'hours': HOURS, 'delivery': {'enabled': True, 'radius_km': 6, 'min_order': 350, 'note': 'Call to confirm.'},
        'offers': [{'title': 'Vitamins 15% off', 'text': 'This week only', 'tag': '15% OFF', 'valid_till': TILL}, {'title': 'Free BP check', 'text': '', 'tag': 'Free', 'valid_till': ''},
                   {'title': 'Old offer', 'text': '', 'tag': '', 'valid_till': '2020-01-01'}],
        'ayurveda': {'enabled': True, 'name': 'Pallikkal Ayurveda', 'text': '', 'address': 'Round North, Thrissur', 'phone': '9847012345', 'email': 'ay@example.in', 'website': 'https://ayur.example.in', 'map_query': ''},
        'socials': {'facebook': 'https://facebook.com/pp', 'instagram': '', 'youtube': 'https://youtube.com/pp'}, 'images': {}, 'stock_check': True, 'show_drug_licence': True}

def ctx(b, w=1440, h=900, mobile=False, user=None, block_site=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, reduced_motion='reduce')
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    c.route(re.compile(r'https://(maps\.google\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)/.*'), lambda r: r.fulfill(status=200, content_type='text/html', body=''))
    init = "window.__opened=[];window.open=(u)=>{window.__opened.push(String(u));return {};};"
    if user: init += f"localStorage.setItem('e2e_user','{U[user]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[user]}',date:'{TODAY}'}}));"
    c.add_init_script(init)
    if block_site:   # the site before migration 0035: public_site_info does not exist
        def h(route):
            body = json.loads(route.request.post_data or '{}')
            if body.get('name') in ('public_site_info', 'public_medicine_search'):
                return route.fulfill(status=200, content_type='application/json', body=json.dumps({'data': None, 'error': {'message': 'Could not find the function public.' + body['name'] + ' in the schema cache'}}))
            return route.continue_()
        c.route('**/api/rpc', h)
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errs.append(m.text))
    pg.on('dialog', lambda d: d.accept())
    return c, pg, errs
def home(pg):
    pg.goto(BASE + '/index.html'); pg.wait_for_function("window.__site && window.__site.info !== undefined"); pg.wait_for_timeout(900)
opened = lambda pg: pg.evaluate('window.__opened')

# ---- data
SQL("update branches set address='MG Road', city='Thrissur', state='Kerala', pincode='680001', phone='9847000000', email='info@pallikkal.in', drug_licence_nos='[\"KL-TSR-20B-77\"]' where id=$1", [BR])
SQL("delete from branch_shop_status where branch_id=$1", [BR])
r = R('website_settings_save', {'p': SITE})
ok('Admin saves the website (offers, hours, delivery, sister store)', not r.get('error') and r['data']['delivery']['radius_km'] == 6, r)
r = R('website_settings_save', {'p': SITE}, 'pharmacist'); ok('Pharmacist cannot change the website', bool(r.get('error')))
r = api('query', {'q': {'table': 'pharmacy_settings', 'op': 'select', 'cols': '*', 'filters': [], 'order': [], 'single': None, 'count': None, 'limit': None, 'offset': None, 'values': None, 'returning': None}}, None)
ok('Visitors cannot read the settings table', bool(r.get('error')) or not r.get('data'), r)
r = R('public_site_info', user=None)
info = r.get('data') or {}
ok('Visitors read public site info (no login)', info.get('available') and info.get('phone') == '9847000000' and len(info['site']['offers']) == 2, r)
r = R('public_medicine_search', {'p_q': 'dolo'}, None)
ok('Visitor stock check: name + Available only (no quantity, no price)', r.get('data') and r['data'][0]['available'] is True and set(r['data'][0]) == {'name', 'strength', 'dosage_form', 'available'}, r)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    # ------------------------------------------------------------- desktop, visitor
    c, pg, errs = ctx(b); home(pg)
    ok('Home page opens without errors', not errs, errs)
    ok('Top bar: address, phone and email from the pharmacy details', 'MG Road, Thrissur, Kerala, 680001' in pg.inner_text('#tAddress') and pg.inner_text('#tPhone') == '+91 98470 00000'
       and pg.get_attribute('#tPhone', 'href') == 'tel:+919847000000' and pg.inner_text('#tEmail') == 'info@pallikkal.in', [pg.inner_text('#tAddress'), pg.inner_text('#tPhone')])
    dow = int(datetime.datetime.now(IST).strftime('%w')); now = datetime.datetime.now(IST).strftime('%H:%M')
    h = HOURS[dow]; by_hours = h['open'] <= now < h['close']
    ok('Open / closed follows the opening hours when the counter switch is not set', ('is-open' in pg.get_attribute('#publicShopStatus', 'class')) == by_hours
       and pg.inner_text('#publicShopStatusText') == ('Shop Open' if by_hours else 'Shop Closed'), [now, pg.inner_text('#publicShopStatusText')])
    want = ('9:00 AM – 1:00 PM' if dow == 0 else '8:00 AM – 9:00 PM')
    ok("Today's hours in the top bar", pg.inner_text('#tHours') == want, pg.inner_text('#tHours'))
    rows = pg.eval_on_selector_all('#hoursTbl tr', 'rs => rs.map(r => r.innerText.replace(/\\s+/g, " ").trim())')
    ok('Opening hours grouped: Mon – Sat and Sunday', rows == ['Mon – Sat 8:00 AM – 9:00 PM', 'Sunday 9:00 AM – 1:00 PM'], rows)
    ok('Footer: drug licence and hours, © year and pharmacy name', 'KL-TSR-20B-77' in pg.inner_text('#fLic') and 'Mon – Sat' in pg.inner_text('#fHours') and pg.inner_text('#year') == str(datetime.date.today().year)
       and 'PALLIKKAL' in pg.inner_text('#fName'))
    ok('Header: logo, 6 menu items, language switch and Login', pg.locator('.s-nav > a, .s-nav > .s-nav-dd').count() == 6 and pg.is_visible('.s-head-r .s-lang') and pg.is_visible('#loginDD'))
    pg.click('#loginDD > button'); pg.wait_for_timeout(150)
    ok('Login menu: Staff, Admin and Delivery logins', pg.eval_on_selector_all('#loginDD .s-menu a', 'as => as.map(a => a.getAttribute("href"))') == ['staff-login.html', 'admin-login.html', 'delivery-boy-login.html'] and pg.is_visible('#loginDD .s-menu'))
    pg.mouse.click(700, 500); pg.wait_for_timeout(150)
    ok('Login menu closes on an outside click', not pg.is_visible('#loginDD .s-menu'))
    pg.click('#svcDD > button'); pg.wait_for_timeout(150)
    ok('Services menu lists the 6 services', pg.locator('#svcMenu [data-svc]').count() == 6 and pg.is_visible('#svcMenu'))
    pg.click('#svcMenu [data-svc="4"]'); pg.wait_for_timeout(250)
    ok('Service details open from the menu', pg.is_visible('#dlg') and pg.inner_text('#dlgT') == 'Chronic Care Support' and pg.locator('#dlgB li').count() == 4)
    pg.click('#dlgF [data-close]'); pg.wait_for_timeout(150)
    ok('Hero: heading, both buttons and the 6 feature tiles', 'Our Priority.' in pg.inner_text('#heroTitle') and pg.is_visible('.s-hero-cta [data-act="order"]') and pg.locator('.s-feat').count() == 6)
    ok('Feature strip shows the delivery distance', '6 km' in pg.inner_text('#featDelivery'))

    # highlights
    ok('Special Offers: badge counts only current offers, first offer shown', pg.inner_text('#offerBadge') == '2 offers' and 'Vitamins 15% off' in pg.inner_text('#offerLead'))
    pg.click('#offers [data-act="offers"]'); pg.wait_for_timeout(250)
    t = pg.inner_text('#dlgB')
    ok('Offers list: current offers with badge and end date, expired offer hidden', 'Vitamins 15% off' in t and 'Free BP check' in t and 'Old offer' not in t and '15% OFF' in t and 'Valid till' in t and 'Ongoing' in t, t)
    pg.click('#dlgF [data-close]')
    ok('Home Delivery: distance and minimum order from Settings', pg.inner_text('#deliveryList').replace('\n', ' ') == 'Within 6 km Minimum purchase ₹350', pg.inner_text('#deliveryList'))
    pg.click('#delivery-info [data-act="delivery"]'); pg.wait_for_timeout(250)
    t = pg.inner_text('#dlgB')
    ok('Delivery details: 6 km, ₹350, note and the week’s hours', 'within 6 km' in t and '₹350' in t and 'Call to confirm.' in t and 'Saturday' in t, t)
    pg.click('#dlgF [data-close]')
    pg.click('[data-act="refill"]'); pg.wait_for_timeout(250)
    href = pg.get_attribute('#dlgF a[href^="https://wa.me/"]', 'href') or ''
    ok('Prescription refill: WhatsApp to the website number with a ready message', href.startswith('https://wa.me/919847099999?text=') and 'refill' in urllib.parse.unquote(href), href)
    pg.click('#dlgF [data-close]')

    # stock check
    pg.click('[data-act="stock"]'); pg.wait_for_timeout(600)
    ok('Explore Products jumps to the stock search', pg.evaluate("document.activeElement.id") == 'stockQ')
    pg.fill('#stockQ', 'do'); pg.wait_for_timeout(200)
    ok('Stock check asks for 3 letters', '3 letters' in pg.inner_text('#stockRes'))
    pg.fill('#stockQ', 'dolo'); pg.wait_for_timeout(900)
    t = pg.inner_text('#stockRes')
    ok('Stock check: Dolo available (no quantity or price shown)', 'Dolo' in t and 'Available' in t and '₹' not in t, t)
    pg.click('#stockRes [data-add="0"]'); pg.wait_for_timeout(150)
    ok('Add to order puts it in the order list', pg.input_value('#oItems').startswith('Dolo'), pg.input_value('#oItems'))
    pg.click('.s-try [data-try="Cetirizine"]'); pg.wait_for_timeout(900)
    ok('Quick search chip runs the search', 'Cetirizine' in pg.inner_text('#stockRes'))
    pg.fill('#stockQ', 'zzqq'); pg.wait_for_timeout(900)
    ok('Not found: tells the visitor we can arrange it', 'No medicine found' in pg.inner_text('#stockRes'))
    pg.click('#askWa'); pg.wait_for_timeout(150)
    ok('Ask the pharmacist opens WhatsApp with the searched name', any('wa.me/919847099999' in u and 'zzqq' in urllib.parse.unquote(u) for u in opened(pg)), opened(pg))

    # order on WhatsApp
    pg.fill('#oItems', ''); pg.click('#orderForm button[type="submit"]'); pg.wait_for_timeout(150)
    ok('Order: name required', pg.inner_text('#oErr') == 'Enter your name.' and 'bad' in pg.get_attribute('#oName', 'class'))
    pg.fill('#oName', 'Ravi'); pg.fill('#oPhone', '12345'); pg.click('#orderForm button[type="submit"]'); pg.wait_for_timeout(150)
    ok('Order: 10-digit mobile number checked', pg.inner_text('#oErr').startswith('Enter a valid 10-digit'))
    pg.fill('#oPhone', '+91 98470 55555'); pg.click('#orderForm button[type="submit"]'); pg.wait_for_timeout(150)
    ok('Order: medicines required', pg.inner_text('#oErr') == 'List the medicines you need.')
    pg.fill('#oItems', 'Dolo 650 – 2 strips'); pg.click('#orderForm button[type="submit"]'); pg.wait_for_timeout(150)
    ok('Order: address required for home delivery', pg.inner_text('#oErr') == 'Enter the delivery address.')
    pg.fill('#oAddr', 'Kuruppam Road, Thrissur'); pg.click('#orderForm button[type="submit"]'); pg.wait_for_timeout(200)
    msg = urllib.parse.unquote(opened(pg)[-1])
    ok('Order sent to the pharmacy WhatsApp with name, number, address and list', msg.startswith('https://wa.me/919847099999?text=') and 'Ravi' in msg and '9847055555' in msg and 'Kuruppam Road' in msg and 'Dolo 650 – 2 strips' in msg, msg)
    pg.check('input[name="oHow"][value="pickup"]', force=True); pg.wait_for_timeout(100)
    ok('Pick up at store hides the address', not pg.is_visible('#oAddr'))
    pg.click('#orderForm button[type="submit"]'); pg.wait_for_timeout(150)
    ok('Pick-up order says it will be collected', 'pick it up at the store' in urllib.parse.unquote(opened(pg)[-1]))

    # services, about, ayurveda, stores, contact
    ok('Our Services: 6 cards with pictures and Learn More', pg.locator('#svcGrid .s-svc-c').count() == 6 and pg.locator('#svcGrid img').count() == 6 and pg.locator('#svcGrid [data-svc]').count() == 6)
    pg.click('#svcGrid [data-svc="0"]'); pg.wait_for_timeout(200)
    ok('Learn More shows the service details with Order and Call buttons', pg.inner_text('#dlgT') == 'Medicine Support' and pg.is_visible('#dlgF [data-act="order"]') and pg.is_visible('#dlgF a[href="tel:+919847000000"]'))
    pg.click('#dlgF [data-act="order"]'); pg.wait_for_timeout(600)
    ok('Order button in the dialog goes to the order form', not pg.is_visible('#dlg') and pg.evaluate("document.activeElement.id") == 'oName')
    pg.click('[data-act="about"]'); pg.wait_for_timeout(200)
    t = pg.inner_text('#dlgB')
    ok('About dialog: address, opening hours and drug licence', 'MG Road' in t and 'Sunday' in t and 'KL-TSR-20B-77' in t, t)
    pg.click('#dlgF [data-close]')
    ok('Ayurvedic store: name, address, phone, email and website from Settings', pg.inner_text('#ayName') == 'Pallikkal Ayurveda' and pg.inner_text('#ayAddr') == 'Round North, Thrissur'
       and pg.get_attribute('#ayPhone', 'href') == 'tel:+919847012345' and pg.inner_text('#ayEmail') == 'ay@example.in' and pg.inner_text('#ayWeb') == 'ayur.example.in')
    ok('View Location on Map opens Google Maps for the sister store', 'query=Pallikkal%20Ayurveda%2C%20Round%20North' in pg.get_attribute('#ayMap', 'href'), pg.get_attribute('#ayMap', 'href'))
    pg.click('#ayurvedic [data-act="ayur"]'); pg.wait_for_timeout(200)
    ok('Explore Ayurvedic Products: list with Call the store', pg.locator('#dlgB li').count() == 5 and pg.is_visible('#dlgF a[href="tel:+919847012345"]'))
    pg.click('#dlgF [data-close]')
    pg.evaluate("document.getElementById('stores').scrollIntoView()"); pg.wait_for_timeout(700)
    src = pg.get_attribute('#mapBox iframe', 'src') or ''
    ok('Map shows the pharmacy (map search text from Settings)', 'output=embed' in src and 'Pallikkal%20Pharmacy%2C%20MG%20Road' in src, src)
    pg.click('#storeAyur'); pg.wait_for_timeout(200)
    ok('Choosing the sister store moves the map', 'Pallikkal%20Ayurveda' in pg.get_attribute('#mapBox iframe', 'src') and 'on' in pg.get_attribute('#storeAyur', 'class'))
    ok('Store cards: pharmacy name, phone, open chip; sister store phone', pg.inner_text('#smName') == 'Pallikkal Medicals' and pg.inner_text('#smPhone') == '+91 98470 00000' and pg.inner_text('#smChip') in ('Open', 'Closed') and pg.inner_text('#saPhone') == '9847012345')
    ok('Contact: Call, WhatsApp, Email and Contact Us Now links', pg.get_attribute('#cCall', 'href') == 'tel:+919847000000' and pg.get_attribute('#cWa', 'href').startswith('https://wa.me/919847099999')
       and pg.get_attribute('#cMail', 'href') == 'mailto:info@pallikkal.in' and pg.get_attribute('#cNow', 'href') == 'tel:+919847000000' and pg.get_attribute('#contact a[href="staff-login.html"]', 'href'))
    socials = pg.eval_on_selector_all('#socials a', 'as => as.map(a => a.getAttribute("aria-label"))')
    ok('Footer social links: only the ones filled in, plus WhatsApp', socials == ['Facebook', 'YouTube', 'WhatsApp'], socials)
    pg.click('[data-legal="disclaimer"]'); pg.wait_for_timeout(200)
    ok('Privacy / Terms / Disclaimer open', pg.inner_text('#dlgT') == 'Disclaimer' and 'medical advice' in pg.inner_text('#dlgB'))
    pg.click('#dlgF [data-close]')
    ok('Floating WhatsApp button', pg.get_attribute('#waFloat', 'href').startswith('https://wa.me/919847099999'))

    # counter switch wins, polling
    SQL("insert into branch_shop_status(branch_id,is_open) values ($1,true) on conflict (branch_id) do update set is_open=true", [BR])
    pg.evaluate("window.dispatchEvent(new Event('focus'))"); pg.wait_for_timeout(700)
    ok('Counter switch Open shows Shop Open (refreshes on focus)', pg.inner_text('#publicShopStatusText') == 'Shop Open' and pg.inner_text('#smChip') == 'Open')
    SQL("update branch_shop_status set is_open=false where branch_id=$1", [BR])
    pg.wait_for_timeout(16000)
    ok('Counter switch Closed shows Shop Closed within 15 seconds', pg.inner_text('#publicShopStatusText') == 'Shop Closed' and 'is-closed' in pg.get_attribute('#publicShopStatus', 'class'))

    # language
    pg.click('.s-head-r .s-lang [data-lang="ml"]'); pg.wait_for_timeout(200)
    ok('Malayalam: menu, headings, status and buttons switch', pg.inner_text('.s-nav > a[href="#contact"]') == 'ബന്ധപ്പെടുക' and 'മുൻഗണന' in pg.inner_text('#heroTitle')
       and pg.inner_text('#publicShopStatusText') == 'ഷോപ്പ് അടച്ചിരിക്കുന്നു' and pg.evaluate("document.documentElement.lang") == 'ml' and pg.locator('#svcGrid h3').first.inner_text() == 'മരുന്ന് സഹായം')
    pg.reload(); pg.wait_for_timeout(1200)
    ok('Language remembered after reload (same storage key as before)', pg.evaluate("localStorage.getItem('alza_public_language')") == 'ml' and pg.inner_text('.s-nav > a[href="#home"]') == 'ഹോം')
    pg.click('#languageToggle', force=True); pg.wait_for_timeout(200)
    ok('Old language toggle button still works', pg.evaluate("document.documentElement.lang") == 'en' and pg.inner_text('.s-nav > a[href="#home"]') == 'Home')
    ok('No page errors (desktop)', not errs, errs)
    c.close()

    # ------------------------------------------------------------- Settings → Website (admin)
    c, pg, errs = ctx(b, 1536, 1000, user='admin')
    pg.goto(BASE + '/settings.html#website'); pg.wait_for_function("document.getElementById('wHead')"); pg.wait_for_timeout(600)
    ok('Settings → Website: loads saved values', pg.input_value('#wHead') == 'Your Health. Our Priority.' and pg.input_value('#wWa') == '9847099999' and pg.input_value('#wRad') == '6'
       and pg.locator('[data-off]').count() == 3 and pg.locator('.sg-offer-x').count() == 1 and pg.input_value('#wo0') == '09:00', [pg.input_value('#wRad'), pg.locator('[data-off]').count()])
    pg.fill('#wc3', '07:00'); pg.click('.sg-panel-acts [data-act="save"]'); pg.wait_for_timeout(700)
    ok('Closing time before opening time is refused', 'Wednesday: closing time must be after opening time' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    pg.fill('#wc3', '21:00')
    pg.fill('#wHead', 'Care you can trust.'); pg.fill('#wHero', 'Open every day in Thrissur.')
    pg.check('#wx0'); ok('Closed day disables its times', pg.is_disabled('#wo0') and pg.is_disabled('#wc0'))
    pg.fill('#wo1', '07:30'); pg.click('#wCopy')
    ok('Copy Monday to Tuesday – Saturday', all(pg.input_value(f'#wo{i}') == '07:30' for i in range(2, 7)))
    pg.click('#wAddOff'); pg.fill('[data-off="3"] input[id^="woT"]', 'Diabetic care combo'); pg.fill('[data-off="3"] input[id^="woG"]', '₹99')
    pg.click('[data-deloff="2"]')
    pg.fill('#wMin', '500'); pg.uncheck('#wAy', force=True); pg.fill('#wIg', 'https://instagram.com/pp')
    pg.set_input_files('#wpF_hero', files=[{'name': 'shop.png', 'mimeType': 'image/png', 'buffer': PNG}])
    ok('Photo preview before saving', pg.locator('#wpI_hero img').count() == 1)
    pg.click('.sg-panel-acts [data-act="save"]'); pg.wait_for_timeout(1500)
    v = (SQL("select value from pharmacy_settings where branch_id=$1 and key='website'", [BR]) or [{}])[0].get('value', {})
    ok('Saved to the database: heading, Sunday closed, 07:30, offers, ₹500, sister store off, Instagram',
       v.get('headline') == 'Care you can trust.' and v['hours'][0]['closed'] and v['hours'][4]['open'] == '07:30' and [o['title'] for o in v['offers']] == ['Vitamins 15% off', 'Free BP check', 'Diabetic care combo']
       and v['delivery']['min_order'] == 500 and v['ayurveda']['enabled'] is False and v['socials']['instagram'] == 'https://instagram.com/pp', v)
    img = v.get('images', {}).get('hero', '')
    ok('Photo uploaded to this branch’s folder and linked', img.startswith(BR + '/site-hero-') and SQL("select count(*)::int n from storage.objects where bucket_id='pharmacy-branding' and name=$1", [img])[0]['n'] == 1, img)
    ok('Saved message and audit entry', 'Website saved' in pg.inner_text('#toast') and SQL("select count(*)::int n from audit_logs where action='settings_saved' and entity_id='website'")[0]['n'] >= 1)
    pg.click('[data-phdel="hero"]'); pg.click('.sg-panel-acts [data-act="save"]'); pg.wait_for_timeout(1200)
    ok('Removing the photo deletes the file', SQL("select count(*)::int n from storage.objects where bucket_id='pharmacy-branding' and name=$1", [img])[0]['n'] == 0
       and (SQL("select value->'images'->>'hero' h from pharmacy_settings where branch_id=$1 and key='website'", [BR]) or [{}])[0]['h'] == '')
    pg.fill('#wFb', 'http://facebook.com/x'); pg.click('.sg-panel-acts [data-act="save"]'); pg.wait_for_timeout(800)
    ok('Social links must be https', 'https://' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    pg.fill('#wFb', 'https://facebook.com/pp'); pg.click('.sg-panel-acts [data-act="save"]'); pg.wait_for_timeout(1000)
    ok('Website appears in the settings search', R('website_settings_get', user='admin').get('data', {}).get('headline') == 'Care you can trust.')
    ok('No page errors (settings)', not errs, errs)
    c.close()
    c, pg, errs = ctx(b, 1536, 1000, user='pharmacist')
    pg.goto(BASE + '/settings.html#website'); pg.wait_for_timeout(2500)
    ok('Pharmacist cannot open Settings → Website', pg.query_selector('#wHead') is None)
    c.close()

    # ------------------------------------------------------------- the home page follows the new settings
    c, pg, errs = ctx(b); home(pg)
    ok('Home page shows the new heading and text', pg.inner_text('#heroTitle') == 'Care you can trust.' and pg.inner_text('#heroText') == 'Open every day in Thrissur.')
    ok('Changed heading stays in Malayalam (owner’s own words)', (pg.click('.s-head-r .s-lang [data-lang="ml"]') or True) and pg.inner_text('#heroTitle') == 'Care you can trust.' and pg.inner_text('.s-nav > a[href="#home"]') == 'ഹോം')
    pg.click('.s-head-r .s-lang [data-lang="en"]')
    rows = pg.eval_on_selector_all('#hoursTbl tr', 'rs => rs.map(r => r.innerText.replace(/\\s+/g, " ").trim())')
    ok('New hours: Mon – Sat 7:30 AM, Sunday closed', rows == ['Mon – Sat 7:30 AM – 9:00 PM', 'Sunday Closed'], rows)
    ok('Sister store hidden everywhere when switched off', not pg.is_visible('#ayurvedic') and not pg.is_visible('#navAyur') and not pg.is_visible('#storeAyur') and not pg.is_visible('.s-feat[data-ayur]'))
    ok('New minimum order and offer count', '₹500' in pg.inner_text('#deliveryList') and pg.inner_text('#offerBadge') == '3 offers')
    ok('Instagram link added to the footer', pg.locator('#socials a[aria-label="Instagram"]').count() == 1)
    c.close()
    # delivery off, stock check off, licence off
    s2 = json.loads(json.dumps(SITE)); s2['delivery']['enabled'] = False; s2['stock_check'] = False; s2['show_drug_licence'] = False; s2['whatsapp'] = ''
    R('website_settings_save', {'p': s2})
    c, pg, errs = ctx(b); home(pg)
    ok('Delivery off: card says paused, order form only offers pick-up', pg.is_visible('#deliveryOff') and not pg.is_visible('#deliveryList') and pg.is_checked('input[name="oHow"][value="pickup"]') and not pg.is_visible('#oAddr'))
    ok('Stock check off: search hidden and the function returns nothing', not pg.is_visible('#stockBox') and R('public_medicine_search', {'p_q': 'dolo'}, None).get('data') == [])
    ok('Drug licence hidden when switched off', not pg.is_visible('#fLicR'))
    ok('No WhatsApp number: falls back to the pharmacy phone', pg.get_attribute('#waFloat', 'href').startswith('https://wa.me/919847000000'))
    c.close()
    s2['published'] = False; R('website_settings_save', {'p': s2})
    c, pg, errs = ctx(b); home(pg)
    ok('Not published: only the contact details and a notice', not pg.is_visible('#home') and not pg.is_visible('#services') and pg.is_visible('#contact') and 'being updated' in pg.inner_text('main') and pg.is_visible('#loginDD'))
    c.close()
    R('website_settings_save', {'p': SITE})

    # ------------------------------------------------------------- before migration 0035
    c, pg, errs = ctx(b, block_site=True)
    SQL("update branch_shop_status set is_open=true where branch_id=$1", [BR])
    pg.goto(BASE + '/index.html'); pg.wait_for_timeout(1500)
    ok('Without 0035: page still works with built-in content', pg.inner_text('#heroTitle').startswith('Your Health.') and pg.locator('#svcGrid .s-svc-c').count() == 6 and pg.inner_text('#tPhone') == '+91 90000 00001')
    ok('Without 0035: status from the counter switch (public_shop_is_open)', pg.inner_text('#publicShopStatusText') == 'Shop Open')
    ok('Without 0035: no page errors', not [e for e in errs if 'schema cache' not in e], errs)
    c.close()

    # ------------------------------------------------------------- mobile
    c, pg, errs = ctx(b, 390, 844, mobile=True); home(pg)
    ok('Mobile: no sideways scrolling', pg.evaluate("document.documentElement.scrollWidth") <= 390, pg.evaluate("document.documentElement.scrollWidth"))
    ok('Mobile: menu button and user icon instead of the full menu', pg.is_visible('#burger') and pg.is_visible('.s-user') and not pg.is_visible('.s-nav') and not pg.is_visible('#loginDD'))
    ok('Mobile: status badge and today’s hours stay in the top bar', pg.is_visible('#publicShopStatus') and pg.is_visible('#tHours'))
    pg.click('#burger'); pg.wait_for_timeout(250)
    ok('Mobile: menu drawer with sections, language and the 3 logins', pg.is_visible('#drawer .s-drawer-p') and pg.locator('#drawer a.dl[href$="login.html"]').count() == 3 and pg.is_visible('#drawer .s-lang'))
    pg.click('#drawer a.dl[href="#services"]'); pg.wait_for_timeout(700)
    ok('Mobile: choosing a section closes the drawer', not pg.is_visible('#drawer .s-drawer-p'))
    ok('Mobile: hero picture shown under the text, buttons full width', pg.is_visible('#heroM') and abs(pg.eval_on_selector('.s-hero-cta .btn', 'e => e.getBoundingClientRect().width') - 358) < 2)
    ok('Mobile: services two per row', len(set(pg.eval_on_selector_all('#svcGrid .s-svc-c', 'es => es.slice(0, 2).map(e => Math.round(e.getBoundingClientRect().top))'))) == 1)
    pg.click('.s-hero-cta [data-act="order"]'); pg.wait_for_timeout(700)
    ok('Mobile: Order Medicines Online goes to the form', pg.evaluate("document.activeElement.id") == 'oName')
    ok('No page errors (mobile)', not errs, errs)
    c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
