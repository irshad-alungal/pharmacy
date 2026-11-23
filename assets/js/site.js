// Public home page (index.html): live pharmacy details, open / closed status, opening hours,
// offers, delivery rules, medicine availability, WhatsApp ordering, Ayurvedic sister store,
// map, English / Malayalam. Content comes from Settings → Website (migration 0035).
// Without 0035 the page still works with the built-in defaults and the counter's
// Open / Closed switch (public_shop_is_open, 0016).
import { sb } from './supabase-client.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n, cls = 'ic') => `<svg class="${cls}"><use href="#i-${n}"/></svg>`;
const LANG_KEY = 'alza_public_language';

// ------------------------------------------------------------------ translations
const TR = {
  en: {
    shopOpen: 'Shop Open', shopClosed: 'Shop Closed', today: 'Today', closedToday: 'Closed today',
    navHome: 'Home', navServices: 'Services', navOffers: 'Offers', navAbout: 'About Us', navAyur: 'Ayurvedic Store', navContact: 'Contact',
    login: 'Login', staffLogin: 'Staff login', adminLogin: 'Admin login', deliveryLogin: 'Delivery login',
    staffLoginS: 'Billing, inventory, pharmacist', adminLoginS: 'Owner and administrators', deliveryLoginS: 'Delivery partners',
    welcome: 'Welcome to Pallikkal Pharmacy', heroTitle: 'Your Health.<br><em>Our Priority.</em>',
    heroText: 'Trusted pharmacy care, genuine medicines and everyday health essentials for you and your family.',
    explore: 'Explore Our Services', orderOnline: 'Order Medicines Online', vCare: 'Care', vTrust: 'Trust', vWell: 'Wellbeing',
    f1: 'Genuine Medicines', f1s: 'From licensed distributors', f2: 'Pharmacist Guidance', f2s: 'Ask us anything', f3: 'Home Delivery', within: 'Within',
    f4: 'Health &amp; Wellness', f4s: 'Everyday essentials', f5: 'Prescription Refill', f5s: 'Send it on WhatsApp', f6: 'Ayurvedic Products', f6s: 'At our sister store',
    hlKicker: 'Quick Highlights', hlTitle: 'Everything You Need, at a Glance', hlText: 'Offers, delivery, refills and essentials — all in one place.',
    hl1: 'Special Offers', hl1t: "Save more on medicines and wellness products. Ask at the counter for today's offers.", viewOffers: 'View Offers',
    hl2: 'Home Delivery', minPurchase: 'Minimum purchase', knowMore: 'Know More', deliveryOff: 'Home delivery is paused right now. Please visit the store or call us.',
    hl3: 'Prescription Refill', hl3t: "Send a photo of your prescription and we'll keep your medicines ready.", uploadRx: 'Upload Prescription',
    hl4: 'Health Essentials', hl4t: 'Vitamins, supplements, baby care, first aid and personal care.', exploreProducts: 'Explore Products',
    stockTitle: 'Is your medicine available?', stockText: 'Type at least 3 letters of the medicine name to check if we have it in stock.',
    stockNote: 'Availability is for guidance only. Prescription medicines are given only against a valid prescription.',
    tryLbl: 'Try:', askT: "Can't find your medicine?", askS: 'Our pharmacist can arrange it — usually within a day.', askBtn: 'Ask the pharmacist', askMsg: 'Hello, I am looking for this medicine: ',
    available: 'Available', askUs: 'Ask us', addToOrder: 'Add to order', noMatch: 'No medicine found with that name. Call or WhatsApp us — we can arrange it.',
    typeMore: 'Type at least 3 letters.', searching: 'Checking…', searchFail: 'Could not check right now. Please try again.',
    orderText: "Fill in the list and send it to us on WhatsApp. We'll call you to confirm the price and the delivery time.",
    oName: 'Your name', oPhone: 'Mobile number', oItems: 'Medicines and quantity', oHow: 'How do you want it?', oDelivery: 'Home delivery', oPickup: 'Pick up at store',
    oAddr: 'Delivery address', oSend: 'Send order on WhatsApp', eName: 'Enter your name.', ePhone: 'Enter a valid 10-digit mobile number.', eItems: 'List the medicines you need.',
    eAddr: 'Enter the delivery address.', oSent: 'WhatsApp opened with your order — press Send there.', added: 'Added to your order list.',
    servicesKicker: 'Our Services', servicesTitle: 'Complete Pharmacy Care for You', servicesText: 'Support and essentials to help you look after yourself and your family.', learnMore: 'Learn More',
    aboutKicker: 'About Us', aboutTitle: 'Here to Support Healthier Days',
    aboutText: 'Pallikkal Pharmacy is a trusted local pharmacy at Pallikkal Bazar, Malappuram, dedicated to providing genuine medicines, reliable advice and everyday health essentials for you and your family.',
    a1: 'Quality &amp; Safety', a1t: 'Genuine medicines stored the right way, checked for expiry.', a2: 'Caring Guidance', a2t: 'Clear answers about how and when to take your medicines.',
    a3: 'Your Wellbeing', a3t: 'Everyday care for every member of your family.', aboutMore: 'Learn More About Us', badgeT: 'Licensed Pharmacy', badgeS: 'Qualified pharmacists',
    ayurKicker: 'Our Sister Store', ayurText: 'Traditional Ayurvedic products and wellness essentials for a natural and healthier lifestyle.',
    ay1: 'Authentic Ayurvedic', ay2: 'Herbal Wellness', ay3: 'Trusted Brands', ay4: 'Expert Guidance', viewLocation: 'View Location on Map', ayExplore: 'Explore Ayurvedic Products',
    storesKicker: 'Our Locations', storesTitle: 'Visit Our Stores in', storesText: 'Pick a store to see it on the map.', sister: 'Sister store',
    saNote: 'Ayurvedic medicines, oils and herbal care', mapLoading: 'Loading map…', mapOpen: 'Open in Google Maps', open: 'Open', closed: 'Closed',
    r1: 'Easy to Reach', r1t: 'Right at Pallikkal Bazar', r2: 'Parking Available', r2t: 'Two-wheeler and car parking nearby', r3: 'Near Key Landmarks', r3t: 'On the main road at Pallikkal Bazar',
    helpKicker: "We're here for you", contactTitle: 'Need Help or Have a Question?', contactText: 'Our pharmacists are happy to help with medicines, availability and delivery.',
    contactNow: 'Contact Us Now', staffPortal: 'Staff Portal', callUs: 'Call Us', callNow: 'Call now →', chatNow: 'Chat now →', emailUs: 'Email Us', writeUs: 'Write to us →', visitUs: 'Visit Us', getDir: 'Get directions →',
    footAbout: 'Your trusted neighbourhood pharmacy for genuine medicines, caring guidance and everyday wellness.',
    quickLinks: 'Quick Links', ourServices: 'Our Services', storeDetails: 'Store Details', getInTouch: 'Get in Touch', dl: 'Drug Licence', rights: 'All rights reserved.',
    privacy: 'Privacy Policy', terms: 'Terms &amp; Conditions', disclaimer: 'Disclaimer', close: 'Close',
    offersT: 'Current offers', noOffers: 'No special offers right now. Ask at the counter — we often have savings on wellness products.', validTill: 'Valid till', ongoing: 'Ongoing',
    deliveryT: 'Home delivery', dl1: 'We deliver within {r} km of the pharmacy.', dl2: 'Minimum order value ₹{m}.', dl3: 'Send your list on WhatsApp or call us — we confirm the price before delivery.',
    dl4: 'Prescription medicines need a photo of a valid prescription.', orderNow: 'Order now', callPharmacy: 'Call the pharmacy',
    refillT: 'Prescription refill', rf1: 'Tap the button below to open WhatsApp.', rf2: 'Attach a clear photo of your prescription and send it.', rf3: 'We check stock and reply with the price and pickup / delivery time.',
    rfMsg: 'Hello Pallikkal Pharmacy, I would like to refill my prescription. I am attaching a photo of it.', openWa: 'Open WhatsApp', noWa: 'WhatsApp number is not set yet. Please call us.',
    aboutT: 'About Pallikkal Pharmacy', hoursT: 'Opening hours', licT: 'Drug licence numbers',
    ayurT: 'Ayurvedic products', ayurList: 'Classical Ayurvedic medicines|Herbal oils and balms|Churnas, arishtams and lehyams|Natural skin and hair care|Herbal teas and wellness blends',
    ayurCall: 'Call the store', ayurVisit: 'Get directions',
    unpub: 'Our website is being updated. You can still call or WhatsApp us, or visit the pharmacy.',
    lgPrivacy: 'We do not collect personal details on this website. When you send an order or prescription on WhatsApp, your name, number, address and the photo you share are used only to prepare and deliver your medicines, and are kept as required by pharmacy rules.',
    lgTerms: 'Prices and availability are confirmed by our pharmacist before billing. Prescription (Schedule H, H1 and X) medicines are dispensed only against a valid prescription. Delivery is subject to distance, minimum order value and stock.',
    lgDisclaimer: 'Information on this website is general and is not medical advice. Always follow your doctor\'s advice. In an emergency, call 108 or go to the nearest hospital.',
    days: 'Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday', daysS: 'Sun|Mon|Tue|Wed|Thu|Fri|Sat'
  },
  ml: {
    shopOpen: 'ഷോപ്പ് തുറന്നിരിക്കുന്നു', shopClosed: 'ഷോപ്പ് അടച്ചിരിക്കുന്നു', today: 'ഇന്ന്', closedToday: 'ഇന്ന് അവധി',
    navHome: 'ഹോം', navServices: 'സേവനങ്ങൾ', navOffers: 'ഓഫറുകൾ', navAbout: 'ഞങ്ങളെക്കുറിച്ച്', navAyur: 'ആയുർവേദ സ്റ്റോർ', navContact: 'ബന്ധപ്പെടുക',
    login: 'ലോഗിൻ', staffLogin: 'സ്റ്റാഫ് ലോഗിൻ', adminLogin: 'അഡ്മിൻ ലോഗിൻ', deliveryLogin: 'ഡെലിവറി ലോഗിൻ',
    staffLoginS: 'ബില്ലിംഗ്, ഇൻവെന്ററി, ഫാർമസിസ്റ്റ്', adminLoginS: 'ഉടമയും അഡ്മിനിസ്ട്രേറ്റർമാരും', deliveryLoginS: 'ഡെലിവറി പങ്കാളികൾ',
    welcome: 'പള്ളിക്കൽ ഫാർമസിയിലേക്ക് സ്വാഗതം', heroTitle: 'നിങ്ങളുടെ ആരോഗ്യം.<br><em>ഞങ്ങളുടെ മുൻഗണന.</em>',
    heroText: 'വിശ്വസ്തമായ ഫാർമസി സേവനം, യഥാർത്ഥ മരുന്നുകൾ, നിങ്ങൾക്കും കുടുംബത്തിനുമുള്ള ദൈനംദിന ആരോഗ്യ ഉൽപ്പന്നങ്ങൾ.',
    explore: 'സേവനങ്ങൾ കാണുക', orderOnline: 'മരുന്നുകൾ ഓൺലൈനായി ഓർഡർ ചെയ്യുക', vCare: 'പരിചരണം', vTrust: 'വിശ്വാസം', vWell: 'ക്ഷേമം',
    f1: 'യഥാർത്ഥ മരുന്നുകൾ', f1s: 'ലൈസൻസുള്ള വിതരണക്കാരിൽ നിന്ന്', f2: 'ഫാർമസിസ്റ്റ് സഹായം', f2s: 'എന്തും ചോദിക്കാം', f3: 'ഹോം ഡെലിവറി', within: 'പരിധി',
    f4: 'ആരോഗ്യവും ക്ഷേമവും', f4s: 'ദൈനംദിന ആവശ്യങ്ങൾ', f5: 'പ്രിസ്ക്രിപ്ഷൻ റീഫിൽ', f5s: 'വാട്സാപ്പിൽ അയയ്ക്കൂ', f6: 'ആയുർവേദ ഉൽപ്പന്നങ്ങൾ', f6s: 'ഞങ്ങളുടെ അനുബന്ധ സ്റ്റോറിൽ',
    hlKicker: 'പ്രധാന വിവരങ്ങൾ', hlTitle: 'നിങ്ങൾക്ക് വേണ്ടതെല്ലാം ഒറ്റനോട്ടത്തിൽ', hlText: 'ഓഫറുകൾ, ഡെലിവറി, റീഫിൽ, ആവശ്യ സാധനങ്ങൾ — എല്ലാം ഒരിടത്ത്.',
    hl1: 'പ്രത്യേക ഓഫറുകൾ', hl1t: 'മരുന്നുകൾക്കും ആരോഗ്യ ഉൽപ്പന്നങ്ങൾക്കും കൂടുതൽ ലാഭം. ഇന്നത്തെ ഓഫറുകൾ കൗണ്ടറിൽ ചോദിക്കൂ.', viewOffers: 'ഓഫറുകൾ കാണുക',
    hl2: 'ഹോം ഡെലിവറി', minPurchase: 'കുറഞ്ഞ വാങ്ങൽ', knowMore: 'കൂടുതൽ അറിയുക', deliveryOff: 'ഹോം ഡെലിവറി ഇപ്പോൾ ലഭ്യമല്ല. സ്റ്റോർ സന്ദർശിക്കുകയോ വിളിക്കുകയോ ചെയ്യുക.',
    hl3: 'പ്രിസ്ക്രിപ്ഷൻ റീഫിൽ', hl3t: 'പ്രിസ്ക്രിപ്ഷന്റെ ഫോട്ടോ അയയ്ക്കൂ, മരുന്നുകൾ ഞങ്ങൾ തയ്യാറാക്കി വയ്ക്കാം.', uploadRx: 'പ്രിസ്ക്രിപ്ഷൻ അയയ്ക്കുക',
    hl4: 'ആരോഗ്യ ആവശ്യങ്ങൾ', hl4t: 'വിറ്റാമിനുകൾ, സപ്ലിമെന്റുകൾ, ശിശു പരിചരണം, പ്രഥമശുശ്രൂഷ, വ്യക്തിഗത പരിചരണം.', exploreProducts: 'ഉൽപ്പന്നങ്ങൾ കാണുക',
    stockTitle: 'നിങ്ങളുടെ മരുന്ന് ലഭ്യമാണോ?', stockText: 'സ്റ്റോക്കുണ്ടോ എന്നറിയാൻ മരുന്നിന്റെ പേരിന്റെ കുറഞ്ഞത് 3 അക്ഷരങ്ങൾ ടൈപ്പ് ചെയ്യുക.',
    stockNote: 'ലഭ്യത ഒരു സൂചന മാത്രമാണ്. കുറിപ്പടി മരുന്നുകൾ സാധുവായ പ്രിസ്ക്രിപ്ഷൻ ഉണ്ടെങ്കിൽ മാത്രം.',
    tryLbl: 'ഉദാ:', askT: 'മരുന്ന് കണ്ടെത്തിയില്ലേ?', askS: 'ഫാർമസിസ്റ്റ് എത്തിച്ചുതരും — സാധാരണ ഒരു ദിവസത്തിനകം.', askBtn: 'ഫാർമസിസ്റ്റിനോട് ചോദിക്കൂ', askMsg: 'നമസ്കാരം, എനിക്ക് ഈ മരുന്ന് വേണം: ',
    available: 'ലഭ്യമാണ്', askUs: 'ചോദിക്കൂ', addToOrder: 'ഓർഡറിൽ ചേർക്കുക', noMatch: 'ഈ പേരിൽ മരുന്ന് കണ്ടെത്തിയില്ല. വിളിക്കുകയോ വാട്സാപ്പ് ചെയ്യുകയോ ചെയ്യൂ — ഞങ്ങൾ എത്തിച്ചുതരാം.',
    typeMore: 'കുറഞ്ഞത് 3 അക്ഷരങ്ങൾ ടൈപ്പ് ചെയ്യുക.', searching: 'പരിശോധിക്കുന്നു…', searchFail: 'ഇപ്പോൾ പരിശോധിക്കാനായില്ല. വീണ്ടും ശ്രമിക്കുക.',
    orderText: 'ലിസ്റ്റ് പൂരിപ്പിച്ച് വാട്സാപ്പിൽ അയയ്ക്കൂ. വിലയും ഡെലിവറി സമയവും ഉറപ്പിക്കാൻ ഞങ്ങൾ വിളിക്കും.',
    oName: 'നിങ്ങളുടെ പേര്', oPhone: 'മൊബൈൽ നമ്പർ', oItems: 'മരുന്നുകളും എണ്ണവും', oHow: 'എങ്ങനെ വേണം?', oDelivery: 'ഹോം ഡെലിവറി', oPickup: 'സ്റ്റോറിൽ നിന്ന് വാങ്ങാം',
    oAddr: 'ഡെലിവറി വിലാസം', oSend: 'വാട്സാപ്പിൽ ഓർഡർ അയയ്ക്കുക', eName: 'പേര് നൽകുക.', ePhone: 'ശരിയായ 10 അക്ക മൊബൈൽ നമ്പർ നൽകുക.', eItems: 'ആവശ്യമുള്ള മരുന്നുകൾ എഴുതുക.',
    eAddr: 'ഡെലിവറി വിലാസം നൽകുക.', oSent: 'ഓർഡറുമായി വാട്സാപ്പ് തുറന്നു — അവിടെ Send അമർത്തുക.', added: 'ഓർഡർ ലിസ്റ്റിൽ ചേർത്തു.',
    servicesKicker: 'ഞങ്ങളുടെ സേവനങ്ങൾ', servicesTitle: 'നിങ്ങൾക്കായി സമ്പൂർണ്ണ ഫാർമസി പരിചരണം', servicesText: 'നിങ്ങളെയും കുടുംബത്തെയും പരിപാലിക്കാൻ ആവശ്യമായ സഹായവും ഉൽപ്പന്നങ്ങളും.', learnMore: 'കൂടുതൽ അറിയുക',
    aboutKicker: 'ഞങ്ങളെക്കുറിച്ച്', aboutTitle: 'ആരോഗ്യകരമായ ദിവസങ്ങൾക്ക് നിങ്ങളോടൊപ്പം',
    aboutText: 'യഥാർത്ഥ മരുന്നുകളും വിശ്വസനീയമായ ഉപദേശവും ദൈനംദിന ആരോഗ്യ ഉൽപ്പന്നങ്ങളും നൽകുന്ന മലപ്പുറം പള്ളിക്കൽ ബസാറിലെ വിശ്വസ്ത ഫാർമസിയാണ് പള്ളിക്കൽ ഫാർമസി.',
    a1: 'ഗുണമേന്മയും സുരക്ഷയും', a1t: 'ശരിയായി സൂക്ഷിച്ച, കാലാവധി പരിശോധിച്ച യഥാർത്ഥ മരുന്നുകൾ.', a2: 'കരുതലോടെയുള്ള മാർഗനിർദേശം', a2t: 'മരുന്നുകൾ എങ്ങനെ, എപ്പോൾ കഴിക്കണം എന്നതിന് വ്യക്തമായ മറുപടി.',
    a3: 'നിങ്ങളുടെ ക്ഷേമം', a3t: 'കുടുംബത്തിലെ എല്ലാവർക്കും ദൈനംദിന പരിചരണം.', aboutMore: 'ഞങ്ങളെക്കുറിച്ച് കൂടുതൽ', badgeT: 'ലൈസൻസുള്ള ഫാർമസി', badgeS: 'യോഗ്യതയുള്ള ഫാർമസിസ്റ്റുകൾ',
    ayurKicker: 'ഞങ്ങളുടെ അനുബന്ധ സ്റ്റോർ', ayurText: 'പ്രകൃതിദത്തവും ആരോഗ്യകരവുമായ ജീവിതത്തിനായി പരമ്പരാഗത ആയുർവേദ ഉൽപ്പന്നങ്ങൾ.',
    ay1: 'യഥാർത്ഥ ആയുർവേദം', ay2: 'ഹെർബൽ വെൽനസ്', ay3: 'വിശ്വസ്ത ബ്രാൻഡുകൾ', ay4: 'വിദഗ്ധ സഹായം', viewLocation: 'മാപ്പിൽ ലൊക്കേഷൻ കാണുക', ayExplore: 'ആയുർവേദ ഉൽപ്പന്നങ്ങൾ കാണുക',
    storesKicker: 'ഞങ്ങളുടെ സ്റ്റോറുകൾ', storesTitle: 'ഞങ്ങളുടെ സ്റ്റോറുകൾ സന്ദർശിക്കൂ —', storesText: 'മാപ്പിൽ കാണാൻ ഒരു സ്റ്റോർ തിരഞ്ഞെടുക്കുക.', sister: 'അനുബന്ധ സ്റ്റോർ',
    saNote: 'ആയുർവേദ മരുന്നുകൾ, എണ്ണകൾ, ഹെർബൽ പരിചരണം', mapLoading: 'മാപ്പ് ലോഡ് ചെയ്യുന്നു…', mapOpen: 'ഗൂഗിൾ മാപ്പിൽ തുറക്കുക', open: 'തുറന്നിരിക്കുന്നു', closed: 'അടച്ചിരിക്കുന്നു',
    r1: 'എളുപ്പത്തിൽ എത്താം', r1t: 'പള്ളിക്കൽ ബസാറിൽ തന്നെ', r2: 'പാർക്കിംഗ് സൗകര്യം', r2t: 'ടൂവീലർ, കാർ പാർക്കിംഗ് സമീപത്ത്', r3: 'പ്രധാന സ്ഥലങ്ങൾക്ക് സമീപം', r3t: 'ബസ് സ്റ്റാൻഡിനും പ്രധാന റോഡുകൾക്കും അടുത്ത്',
    helpKicker: 'ഞങ്ങൾ നിങ്ങൾക്കൊപ്പം', contactTitle: 'സഹായം വേണോ, എന്തെങ്കിലും ചോദിക്കാനുണ്ടോ?', contactText: 'മരുന്നുകൾ, ലഭ്യത, ഡെലിവറി എന്നിവയെക്കുറിച്ച് സഹായിക്കാൻ ഞങ്ങളുടെ ഫാർമസിസ്റ്റുകൾ തയ്യാർ.',
    contactNow: 'ഇപ്പോൾ ബന്ധപ്പെടുക', staffPortal: 'സ്റ്റാഫ് പോർട്ടൽ', callUs: 'വിളിക്കുക', callNow: 'ഇപ്പോൾ വിളിക്കൂ →', chatNow: 'ചാറ്റ് ചെയ്യൂ →', emailUs: 'ഇമെയിൽ', writeUs: 'എഴുതൂ →', visitUs: 'സന്ദർശിക്കുക', getDir: 'വഴി കാണുക →',
    footAbout: 'യഥാർത്ഥ മരുന്നുകൾക്കും കരുതലുള്ള മാർഗനിർദേശത്തിനും ദൈനംദിന ആരോഗ്യത്തിനുമുള്ള നിങ്ങളുടെ വിശ്വസ്ത ഫാർമസി.',
    quickLinks: 'ലിങ്കുകൾ', ourServices: 'ഞങ്ങളുടെ സേവനങ്ങൾ', storeDetails: 'സ്റ്റോർ വിവരങ്ങൾ', getInTouch: 'ബന്ധപ്പെടാൻ', dl: 'ഡ്രഗ് ലൈസൻസ്', rights: 'എല്ലാ അവകാശങ്ങളും നിക്ഷിപ്തം.',
    privacy: 'സ്വകാര്യതാ നയം', terms: 'നിബന്ധനകൾ', disclaimer: 'നിരാകരണം', close: 'അടയ്ക്കുക',
    offersT: 'ഇപ്പോഴത്തെ ഓഫറുകൾ', noOffers: 'ഇപ്പോൾ പ്രത്യേക ഓഫറുകളില്ല. കൗണ്ടറിൽ ചോദിക്കൂ — ആരോഗ്യ ഉൽപ്പന്നങ്ങൾക്ക് പലപ്പോഴും ഇളവുകളുണ്ട്.', validTill: 'വരെ സാധു', ongoing: 'തുടരുന്നു',
    deliveryT: 'ഹോം ഡെലിവറി', dl1: 'ഫാർമസിയിൽ നിന്ന് {r} കി.മീ. പരിധിയിൽ ഡെലിവറി.', dl2: 'കുറഞ്ഞ ഓർഡർ തുക ₹{m}.', dl3: 'ലിസ്റ്റ് വാട്സാപ്പിൽ അയയ്ക്കുകയോ വിളിക്കുകയോ ചെയ്യൂ — ഡെലിവറിക്ക് മുമ്പ് വില ഉറപ്പിക്കും.',
    dl4: 'കുറിപ്പടി മരുന്നുകൾക്ക് സാധുവായ പ്രിസ്ക്രിപ്ഷന്റെ ഫോട്ടോ വേണം.', orderNow: 'ഓർഡർ ചെയ്യുക', callPharmacy: 'ഫാർമസിയിലേക്ക് വിളിക്കുക',
    refillT: 'പ്രിസ്ക്രിപ്ഷൻ റീഫിൽ', rf1: 'വാട്സാപ്പ് തുറക്കാൻ താഴെയുള്ള ബട്ടൺ അമർത്തുക.', rf2: 'പ്രിസ്ക്രിപ്ഷന്റെ വ്യക്തമായ ഫോട്ടോ ചേർത്ത് അയയ്ക്കുക.', rf3: 'സ്റ്റോക്ക് പരിശോധിച്ച് വിലയും സമയവും ഞങ്ങൾ അറിയിക്കും.',
    rfMsg: 'നമസ്കാരം പള്ളിക്കൽ ഫാർമസി, എന്റെ പ്രിസ്ക്രിപ്ഷൻ റീഫിൽ ചെയ്യണം. അതിന്റെ ഫോട്ടോ അയയ്ക്കുന്നു.', openWa: 'വാട്സാപ്പ് തുറക്കുക', noWa: 'വാട്സാപ്പ് നമ്പർ ചേർത്തിട്ടില്ല. ദയവായി വിളിക്കുക.',
    aboutT: 'പള്ളിക്കൽ ഫാർമസിയെക്കുറിച്ച്', hoursT: 'പ്രവർത്തന സമയം', licT: 'ഡ്രഗ് ലൈസൻസ് നമ്പറുകൾ',
    ayurT: 'ആയുർവേദ ഉൽപ്പന്നങ്ങൾ', ayurList: 'ക്ലാസിക്കൽ ആയുർവേദ മരുന്നുകൾ|ഹെർബൽ എണ്ണകളും ബാമുകളും|ചൂർണ്ണം, അരിഷ്ടം, ലേഹ്യം|പ്രകൃതിദത്ത ചർമ്മ-മുടി സംരക്ഷണം|ഹെർബൽ ചായകൾ',
    ayurCall: 'സ്റ്റോറിലേക്ക് വിളിക്കുക', ayurVisit: 'വഴി കാണുക',
    unpub: 'ഞങ്ങളുടെ വെബ്സൈറ്റ് പുതുക്കുകയാണ്. വിളിക്കുകയോ വാട്സാപ്പ് ചെയ്യുകയോ ഫാർമസി സന്ദർശിക്കുകയോ ചെയ്യാം.',
    lgPrivacy: 'ഈ വെബ്സൈറ്റ് വ്യക്തിഗത വിവരങ്ങൾ ശേഖരിക്കുന്നില്ല. വാട്സാപ്പിൽ അയയ്ക്കുന്ന പേര്, നമ്പർ, വിലാസം, ഫോട്ടോ എന്നിവ മരുന്നുകൾ തയ്യാറാക്കാനും എത്തിക്കാനും മാത്രം ഉപയോഗിക്കുന്നു.',
    lgTerms: 'വിലയും ലഭ്യതയും ബില്ലിംഗിന് മുമ്പ് ഫാർമസിസ്റ്റ് ഉറപ്പിക്കും. കുറിപ്പടി മരുന്നുകൾ സാധുവായ പ്രിസ്ക്രിപ്ഷൻ ഉണ്ടെങ്കിൽ മാത്രം. ഡെലിവറി ദൂരം, കുറഞ്ഞ തുക, സ്റ്റോക്ക് എന്നിവയ്ക്ക് വിധേയം.',
    lgDisclaimer: 'ഈ വെബ്സൈറ്റിലെ വിവരങ്ങൾ പൊതുവായതാണ്, വൈദ്യോപദേശമല്ല. എപ്പോഴും ഡോക്ടറുടെ നിർദേശം പാലിക്കുക. അടിയന്തര ഘട്ടത്തിൽ 108-ൽ വിളിക്കുക.',
    days: 'ഞായർ|തിങ്കൾ|ചൊവ്വ|ബുധൻ|വ്യാഴം|വെള്ളി|ശനി', daysS: 'ഞായർ|തിങ്കൾ|ചൊവ്വ|ബുധൻ|വ്യാഴം|വെള്ളി|ശനി'
  }
};

const SERVICES = [
  { id: 'medicine', ic: 'pill', t: 't-green', en: ['Medicine Support', 'Help finding medicines and understanding the information that comes with them.', 'Prescription and over-the-counter medicines|Generic options where available|Help reading labels, doses and timings|We arrange medicines that are not in stock'],
    ml: ['മരുന്ന് സഹായം', 'മരുന്നുകൾ കണ്ടെത്താനും അവയുടെ വിവരങ്ങൾ മനസ്സിലാക്കാനും സഹായം.', 'കുറിപ്പടി മരുന്നുകളും സാധാരണ മരുന്നുകളും|ലഭ്യമെങ്കിൽ ജനറിക് മരുന്നുകൾ|ലേബൽ, ഡോസ്, സമയം മനസ്സിലാക്കാൻ സഹായം|സ്റ്റോക്കില്ലാത്ത മരുന്നുകൾ എത്തിച്ചുതരും'] },
  { id: 'wellness', ic: 'heart', t: 't-red', en: ['Everyday Wellness', 'Health and personal-care essentials for your day-to-day needs.', 'Vitamins and supplements|First aid and wound care|Baby and mother care|Diabetic care products'],
    ml: ['ദൈനംദിന ക്ഷേമം', 'ദൈനംദിന ആവശ്യങ്ങൾക്കുള്ള ആരോഗ്യ-വ്യക്തിഗത പരിചരണ ഉൽപ്പന്നങ്ങൾ.', 'വിറ്റാമിനുകളും സപ്ലിമെന്റുകളും|പ്രഥമശുശ്രൂഷ സാധനങ്ങൾ|അമ്മയ്ക്കും കുഞ്ഞിനുമുള്ള പരിചരണം|പ്രമേഹ പരിചരണ ഉൽപ്പന്നങ്ങൾ'] },
  { id: 'guidance', ic: 'guide', t: 't-blue', en: ['Helpful Guidance', 'A welcoming place to ask questions about your medicines and health.', 'Talk to a qualified pharmacist|How and when to take each medicine|Common side effects and interactions|When you should see a doctor'],
    ml: ['സഹായകരമായ മാർഗനിർദേശം', 'മരുന്നുകളെയും ആരോഗ്യത്തെയും കുറിച്ച് ചോദിക്കാൻ ഒരിടം.', 'യോഗ്യതയുള്ള ഫാർമസിസ്റ്റുമായി സംസാരിക്കാം|ഓരോ മരുന്നും എങ്ങനെ, എപ്പോൾ കഴിക്കണം|സാധാരണ പാർശ്വഫലങ്ങൾ|ഡോക്ടറെ കാണേണ്ടത് എപ്പോൾ'] },
  { id: 'monitor', ic: 'pulse', t: 't-violet', en: ['Health Monitoring', 'BP monitors, glucometers, thermometers and the strips you need.', 'BP monitors and glucometers|Test strips and lancets|Thermometers and pulse oximeters|Help setting up your device'],
    ml: ['ആരോഗ്യ നിരീക്ഷണം', 'ബിപി മോണിറ്റർ, ഗ്ലൂക്കോമീറ്റർ, തെർമോമീറ്റർ, സ്ട്രിപ്പുകൾ.', 'ബിപി മോണിറ്ററുകളും ഗ്ലൂക്കോമീറ്ററുകളും|ടെസ്റ്റ് സ്ട്രിപ്പുകളും ലാൻസെറ്റുകളും|തെർമോമീറ്റർ, പൾസ് ഓക്സിമീറ്റർ|ഉപകരണം ഉപയോഗിക്കാൻ സഹായം'] },
  { id: 'chronic', ic: 'refill', t: 't-teal', en: ['Chronic Care Support', 'Regular medicines for diabetes, BP, thyroid and heart care, ready every month.', 'Monthly refill reminders on WhatsApp|Medicines kept ready for pickup|Home delivery for regular orders|Stock arranged ahead for your refill date'],
    ml: ['ദീർഘകാല പരിചരണം', 'പ്രമേഹം, ബിപി, തൈറോയ്ഡ്, ഹൃദ്രോഗം — പതിവ് മരുന്നുകൾ എല്ലാ മാസവും തയ്യാർ.', 'വാട്സാപ്പിൽ പ്രതിമാസ റീഫിൽ ഓർമ്മപ്പെടുത്തൽ|മരുന്നുകൾ തയ്യാറാക്കി വയ്ക്കും|പതിവ് ഓർഡറുകൾക്ക് ഹോം ഡെലിവറി|റീഫിൽ തീയതിക്ക് മുമ്പേ സ്റ്റോക്ക്'] },
  { id: 'personal', ic: 'care', t: 't-amber', en: ['Personal Care', 'Skin, hair, oral and hygiene products from brands you trust.', 'Skin and hair care|Oral care|Hygiene and sanitary products|Elderly care'],
    ml: ['വ്യക്തിഗത പരിചരണം', 'വിശ്വസ്ത ബ്രാൻഡുകളുടെ ചർമ്മ, മുടി, ദന്ത, ശുചിത്വ ഉൽപ്പന്നങ്ങൾ.', 'ചർമ്മ-മുടി സംരക്ഷണം|ദന്ത സംരക്ഷണം|ശുചിത്വ ഉൽപ്പന്നങ്ങൾ|മുതിർന്നവരുടെ പരിചരണം'] }
];

// ------------------------------------------------------------------ state
let lang = localStorage.getItem(LANG_KEY) === 'ml' ? 'ml' : 'en';
let INFO = null;        // public_site_info() — null until loaded / when 0035 is not installed
let SITE = {};          // INFO.site
const OVR = {};         // texts the admin changed in Settings → Website (shown in both languages)
let mapStore = 'main';
const T = k => OVR[k] ?? TR[lang][k] ?? TR.en[k] ?? k;
const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k] ?? '');

// ------------------------------------------------------------------ helpers
const digits = v => String(v || '').replace(/\D/g, '');
function intl(v) { const d = digits(v); if (!d) return ''; if (d.length === 10) return '91' + d; if (d.length === 11 && d[0] === '0') return '91' + d.slice(1); return d; }
function prettyPhone(v) {
  const d = digits(v); if (!d) return '';
  const n = d.length > 10 ? d.slice(-10) : d;
  return n.length === 10 ? `+91 ${n.slice(0, 5)} ${n.slice(5)}` : String(v);
}
const waLink = (num, text = '') => num ? `https://wa.me/${intl(num)}${text ? '?text=' + encodeURIComponent(text) : ''}` : '';
const mapsLink = q => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const mapsEmbed = q => `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=16&output=embed`;
function t12(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const ap = h >= 12 ? 'PM' : 'AM'; const hh = h % 12 || 12;
  return `${hh}:${String(m || 0).padStart(2, '0')} ${ap}`;
}
const dayName = (i, short) => T(short ? 'daysS' : 'days').split('|')[i];
const fullAddress = () => INFO ? [INFO.address, INFO.city, INFO.state, INFO.pincode].filter(Boolean).join(', ') : '';
const titleCase = v => v ? (v === v.toUpperCase() ? v.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : v) : null;
const shopName = () => titleCase(INFO?.name) || 'Pallikkal Pharmacy';
function photo(path) { if (!path) return ''; try { return sb.storage.from('pharmacy-branding').getPublicUrl(path)?.data?.publicUrl || ''; } catch { return ''; } }
// use an uploaded photo only once it has loaded; otherwise keep the built-in illustration
function swapBg(el, path, cls) {
  const url = photo(path); if (!el || !url) return;
  const img = new Image();
  img.onload = () => { el.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`; if (cls) el.classList.add(cls); };
  img.src = url;
}
function toast(msg) {
  $('.s-toast')?.remove();
  const d = document.createElement('div'); d.className = 's-toast'; d.setAttribute('role', 'status'); d.textContent = msg;
  document.body.append(d); setTimeout(() => d.remove(), 3200);
}
const setText = (sel, v) => { const el = typeof sel === 'string' ? $(sel) : sel; if (el && v != null && v !== '') el.textContent = v; };
const setHref = (sel, v) => { const el = $(sel); if (el && v) el.href = v; };

// ------------------------------------------------------------------ language
function setLanguage(l) {
  lang = l === 'ml' ? 'ml' : 'en';
  document.documentElement.lang = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* private mode */ }
  $$('[data-i18n]').forEach(el => { const v = T(el.dataset.i18n); if (v !== undefined) el.innerHTML = v; });
  $$('[data-lang]').forEach(b => b.classList.toggle('on', b.dataset.lang === lang));
  const tg = $('#languageToggle'); if (tg) tg.textContent = lang === 'en' ? 'മലയാളം' : 'English';
  $('#stockQ')?.setAttribute('placeholder', lang === 'ml' ? 'ഉദാ: പാരസെറ്റമോൾ' : 'e.g. Paracetamol');
  renderServices(); renderStatus(); renderHours(); renderOffersCard(); renderStock();
}

// ------------------------------------------------------------------ services
function renderServices() {
  const L = s => s[lang] || s.en;
  $('#svcGrid').innerHTML = SERVICES.map((s, i) => `<article class="s-svc-c rv in"><div><span class="s-hl-ic ${s.t}">${icon(s.ic)}</span><h3>${esc(L(s)[0])}</h3><p>${esc(L(s)[1])}</p>
    <button class="link" type="button" data-svc="${i}">${T('learnMore')}${icon('right')}</button></div><img src="assets/images/site/svc-${s.id}.svg" alt="" width="160" height="100"></article>`).join('');
  $('#svcMenu').innerHTML = SERVICES.map((s, i) => `<button type="button" data-svc="${i}">${icon(s.ic)}<span>${esc(L(s)[0])}</span></button>`).join('');
  $('#footSvc').innerHTML = SERVICES.map((s, i) => `<li><a href="#services" data-svc="${i}">${esc(L(s)[0])}</a></li>`).join('');
}
function openService(i) {
  const s = SERVICES[i]; if (!s) return; const L = s[lang] || s.en;
  openDlg(L[0], `<p>${esc(L[1])}</p><ul>${L[2].split('|').map(x => `<li>${esc(x)}</li>`).join('')}</ul>`,
    [btn(T('orderOnline'), 'order', 'btn-green', 'bag'), callBtn()]);
}

// ------------------------------------------------------------------ dialog
const dlg = $('#dlg');
function btn(label, act, cls = 'btn-line', ic = '') { return `<button class="btn ${cls} btn-sm" type="button" data-act="${act}">${ic ? icon(ic) : ''}<span>${label}</span></button>`; }
function callBtn() { const p = INFO?.phone; return p ? `<a class="btn btn-line btn-sm" href="tel:+${intl(p)}">${icon('phone')}<span>${T('callPharmacy')}</span></a>` : ''; }
function waBtn(text) { const n = INFO?.whatsapp; return n ? `<a class="btn btn-green btn-sm" href="${waLink(n, text)}" target="_blank" rel="noopener">${icon('wa')}<span>${T('openWa')}</span></a>` : ''; }
function openDlg(title, body, foot = []) {
  $('#dlgT').textContent = title; $('#dlgB').innerHTML = body;
  $('#dlgF').innerHTML = foot.filter(Boolean).join('') + `<button class="btn btn-line btn-sm" type="button" data-close>${T('close')}</button>`;
  if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
}
function closeDlg() { if (dlg.open) dlg.close?.(); dlg.removeAttribute('open'); }
dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close]')) closeDlg(); });

function hoursHtml() {
  const H = SITE.hours; if (!Array.isArray(H)) return '';
  return `<table class="s-hours">${[1, 2, 3, 4, 5, 6, 0].map(d => { const h = H.find(x => +x.day === d) || {};
    return `<tr class="${INFO && d === INFO.dow ? 'today' : ''}"><td>${dayName(d)}</td><td>${h.closed ? T('closed') : `${t12(h.open)} – ${t12(h.close)}`}</td></tr>`; }).join('')}</table>`;
}
const ACTS = {
  offers() {
    const O = SITE.offers || [];
    openDlg(T('offersT'), O.length ? O.map(o => `<div class="s-offer"><i>${esc(o.tag || '%')}</i><div><b>${esc(o.title)}</b>${o.text ? `<div>${esc(o.text)}</div>` : ''}
      <small>${o.valid_till ? `${T('validTill')} ${new Date(o.valid_till + 'T00:00:00').toLocaleDateString(lang === 'ml' ? 'ml-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : T('ongoing')}</small></div></div>`).join('')
      : `<div class="s-empty">${icon('tag', 'ic')}<p>${T('noOffers')}</p></div>`, [btn(T('orderOnline'), 'order', 'btn-green', 'bag')]);
  },
  delivery() {
    const D = SITE.delivery || {};
    if (D.enabled === false) return openDlg(T('deliveryT'), `<p>${T('deliveryOff')}</p>`, [callBtn()]);
    openDlg(T('deliveryT'), `<ul><li>${fill(T('dl1'), { r: D.radius_km ?? 5 })}</li>${+D.min_order ? `<li>${fill(T('dl2'), { m: D.min_order })}</li>` : ''}<li>${T('dl3')}</li><li>${T('dl4')}</li></ul>
      ${D.note ? `<p>${esc(D.note)}</p>` : ''}${hoursHtml() ? `<h4 style="margin:8px 0 6px">${T('hoursT')}</h4>${hoursHtml()}` : ''}`,
    [btn(T('orderNow'), 'order', 'btn-green', 'bag'), callBtn()]);
  },
  refill() {
    openDlg(T('refillT'), `<ol style="margin:0 0 6px;padding-left:20px"><li>${T('rf1')}</li><li>${T('rf2')}</li><li>${T('rf3')}</li></ol>${INFO?.whatsapp ? '' : `<p class="s-err">${T('noWa')}</p>`}`,
      [waBtn(T('rfMsg')), callBtn()]);
  },
  stock() { closeDlg(); goTo('#order'); setTimeout(() => $('#stockQ')?.focus({ preventScroll: true }), 450); },
  order() { closeDlg(); closeDrawer(); goTo('#order'); setTimeout(() => $('#oName')?.focus({ preventScroll: true }), 450); },
  about() {
    const lic = (INFO?.drug_licence_nos || []).filter(Boolean);
    openDlg(T('aboutT'), `<p>${esc(OVR.aboutText ?? T('aboutText'))}</p>${fullAddress() ? `<p>${icon('pin')} ${esc(fullAddress())}</p>` : ''}
      ${hoursHtml() ? `<h4 style="margin:8px 0 6px">${T('hoursT')}</h4>${hoursHtml()}` : ''}${lic.length ? `<h4 style="margin:12px 0 4px">${T('licT')}</h4><p>${lic.map(esc).join(', ')}</p>` : ''}`,
    [callBtn(), btn(T('getDir').replace(' →', ''), 'map', 'btn-line', 'map')]);
  },
  ayur() {
    const A = SITE.ayurveda || {};
    openDlg(A.name || T('ayurT'), `<p>${esc(OVR.ayurText ?? T('ayurText'))}</p><ul>${T('ayurList').split('|').map(x => `<li>${esc(x)}</li>`).join('')}</ul>`,
      [A.phone ? `<a class="btn btn-green btn-sm" href="tel:+${intl(A.phone)}">${icon('phone')}<span>${T('ayurCall')}</span></a>` : '',
        `<a class="btn btn-line btn-sm" href="${mapsLink(A.map_query || [A.name, A.address].filter(Boolean).join(', ') || 'Pallikkal Bazar, Pallikkal PO, Malappuram 673634')}" target="_blank" rel="noopener">${icon('map')}<span>${T('ayurVisit')}</span></a>`]);
  },
  map() { closeDlg(); showMap('main'); goTo('#stores'); }
};
function goTo(sel) { const el = $(sel); if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }

document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (a && ACTS[a.dataset.act]) { e.preventDefault(); closeMenus(); closeDrawer(); ACTS[a.dataset.act](); return; }
  const s = e.target.closest('[data-svc]');
  if (s) { e.preventDefault(); closeMenus(); openService(+s.dataset.svc); return; }
  const lg = e.target.closest('[data-legal]');
  if (lg) { const k = lg.dataset.legal; openDlg(T(k).replace('&amp;', '&'), `<p>${T('lg' + k[0].toUpperCase() + k.slice(1))}</p>`); return; }
  const l = e.target.closest('[data-lang]');
  if (l) { setLanguage(l.dataset.lang); return; }
  const st = e.target.closest('[data-store]');
  if (st) { showMap(st.dataset.store); return; }
  if (!e.target.closest('.s-nav-dd')) closeMenus();
});
$('#languageToggle').addEventListener('click', () => setLanguage(lang === 'en' ? 'ml' : 'en'));

// ------------------------------------------------------------------ menus, drawer, header
function closeMenus(except) { $$('.s-nav-dd.open').forEach(d => { if (d !== except) { d.classList.remove('open'); d.querySelector(':scope > button')?.setAttribute('aria-expanded', 'false'); } }); }
$$('.s-nav-dd > button').forEach(b => b.addEventListener('click', e => {
  e.stopPropagation(); const d = b.parentElement; closeMenus(d);
  const on = d.classList.toggle('open'); b.setAttribute('aria-expanded', String(on));
}));
const drawer = $('#drawer');
function openDrawer() { drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); $('#burger').setAttribute('aria-expanded', 'true'); document.body.style.overflow = 'hidden'; }
function closeDrawer() { if (!drawer.classList.contains('open')) return; drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); $('#burger').setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; }
$('#burger').addEventListener('click', openDrawer);
drawer.addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target.closest('a.dl')) closeDrawer(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenus(); closeDrawer(); } });

const head = $('#sHead'), up = $('#toTop');
const onScroll = () => { const y = window.scrollY; head.classList.toggle('is-stuck', y > 40); up.classList.toggle('show', y > 700); };
window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
up.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// active menu item while scrolling
if ('IntersectionObserver' in window) {
  const links = $$('.s-nav > a[href^="#"]');
  const io = new IntersectionObserver(es => es.forEach(en => {
    if (!en.isIntersecting) return;
    const id = '#' + en.target.id;
    const hit = links.find(a => a.getAttribute('href') === id) || (id === '#order' || id === '#highlights' ? links.find(a => a.getAttribute('href') === '#highlights') : null);
    if (hit) links.forEach(a => a.classList.toggle('is-active', a === hit));
  }), { rootMargin: '-45% 0px -50% 0px' });
  ['home', 'highlights', 'services', 'about', 'ayurvedic', 'stores', 'contact'].forEach(id => { const el = document.getElementById(id); if (el) io.observe(el); });
}
// reveal on scroll
(function reveal() {
  const els = $$('.rv');
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) { els.forEach(e => e.classList.add('in')); return; }
  const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach(e => io.observe(e));
})();

// ------------------------------------------------------------------ open / closed + hours
let shopOpen = false;
function renderStatus() {
  const badge = $('#publicShopStatus');
  badge.classList.toggle('is-open', shopOpen); badge.classList.toggle('is-closed', !shopOpen);
  $('#publicShopStatusText').textContent = shopOpen ? T('shopOpen') : T('shopClosed');
  const chip = $('#smChip'); if (chip) { chip.textContent = shopOpen ? T('open') : T('closed'); chip.className = 's-chip ' + (shopOpen ? 'ok' : 'no'); }
}
function renderHours() {
  const H = SITE.hours; if (!Array.isArray(H) || !INFO) return;
  const td = INFO.today;
  $('#tHours').textContent = !td || td.closed ? T('closedToday') : `${t12(td.open)} – ${t12(td.close)}`;
  // group days with the same hours: Mon – Sat 8:00 AM – 9:00 PM, Sunday 9:00 AM – 1:00 PM
  const order = [1, 2, 3, 4, 5, 6, 0].map(d => H.find(x => +x.day === d) || { day: d, closed: true });
  const key = h => h.closed ? 'closed' : `${h.open}-${h.close}`;
  const groups = [];
  order.forEach(h => { const g = groups[groups.length - 1]; if (g && g.k === key(h)) g.days.push(+h.day); else groups.push({ k: key(h), h, days: [+h.day] }); });
  const label = g => g.days.length === 1 ? dayName(g.days[0], g.days.length > 1) : `${dayName(g.days[0], true)} – ${dayName(g.days[g.days.length - 1], true)}`;
  const val = g => g.h.closed ? T('closed') : `${t12(g.h.open)} – ${t12(g.h.close)}`;
  $('#hoursTbl').innerHTML = `<tbody>${groups.map(g => `<tr class="${g.days.includes(INFO.dow) ? 'today' : ''}"><td>${label(g)}</td><td>${val(g)}</td></tr>`).join('')}</tbody>`;
  $('#fHours').innerHTML = groups.map(g => `${esc(label(g))}: ${esc(val(g))}`).join('<br>');
}
async function refreshStatus() {
  try {
    if (INFO) {
      const { data, error } = await sb.rpc('public_site_info');
      if (error) throw error;
      if (data?.available) { const was = INFO.dow; INFO = data; shopOpen = data.shop_open === true; renderStatus(); if (data.dow !== was) renderHours(); return; }
    }
    // Before 0035 (or if the site info is unavailable): the counter's Open / Closed switch.
    const { data, error } = await sb.rpc('public_shop_is_open');
    if (error) throw error;
    shopOpen = data === true; renderStatus();
  } catch (error) {
    // Keep the last successfully fetched status visible during temporary outages.
    console.warn('Could not refresh public shop status:', error?.message || error);
  }
}

// ------------------------------------------------------------------ site details
function applyInfo() {
  const I = INFO; SITE = I.site || {};
  shopOpen = I.shop_open === true;
  const D = { heroTitle: SITE.headline, heroText: SITE.hero_text, aboutText: SITE.about_text, ayurText: SITE.ayurveda?.text };
  const DEF = { heroTitle: 'Your Health. Our Priority.', heroText: TR.en.heroText, aboutText: TR.en.aboutText, ayurText: TR.en.ayurText };
  for (const k of Object.keys(D)) { if (D[k] && D[k].trim() !== DEF[k]) OVR[k] = esc(D[k].trim()); else delete OVR[k]; }

  if (SITE.published === false || I.published === false) {
    document.body.classList.add('s-unpub');
    $$('main > section:not(#contact)').forEach(s => { s.hidden = true; });
    $('#contact').insertAdjacentHTML('beforebegin', `<section class="s-sec"><div class="wrap"><div class="s-box" style="text-align:center"><h3 style="justify-content:center">${esc(shopName())}</h3><p>${T('unpub')}</p></div></div></section>`);
  }
  const addr = fullAddress();
  setText('#tAddress', addr); setText('#fAddr', addr); setText('#smAddr', addr); setText('#cVisitT', [I.address, I.city].filter(Boolean).join(', '));
  setText('#smName', titleCase(I.name));
  setText('#fName', (I.name || '').toUpperCase());
  setText('#storesCity', I.city);
  if (I.phone) {
    const p = prettyPhone(I.phone), tel = `tel:+${intl(I.phone)}`;
    ['#tPhone', '#fPhone'].forEach(s => { setText(s, p); setHref(s, tel); });
    setText('#smPhone', p); setText('#cCallT', p); setHref('#cCall', tel); setHref('#cNow', tel);
  }
  if (I.email) { ['#tEmail', '#fEmail'].forEach(s => { setText(s, I.email); setHref(s, `mailto:${I.email}`); }); setText('#cMailT', I.email); setHref('#cMail', `mailto:${I.email}`); }
  else { $('#cMail').hidden = true; }
  const wa = I.whatsapp;
  if (wa) {
    const hi = `Hello ${shopName()}, `;
    setHref('#cWa', waLink(wa, hi)); setHref('#fWa', waLink(wa, hi)); setHref('#waFloat', waLink(wa, hi)); setText('#cWaT', prettyPhone(wa)); setText('#fWa', prettyPhone(wa));
  } else { ['#cWa', '#waFloat'].forEach(s => { $(s).hidden = true; }); $('#fWa').closest('li').hidden = true; }
  const lic = (I.drug_licence_nos || []).filter(Boolean);
  if (lic.length) { $('#fLicR').hidden = false; setText('#fLic', lic.join(', ')); setText('#aboutLic', `${T('dl')}: ${lic[0]}`); }

  // delivery
  const Dl = SITE.delivery || {};
  $$('.dRadius').forEach(e => { e.textContent = +Dl.radius_km || 5; });
  $$('.dMin').forEach(e => { e.textContent = +Dl.min_order || 0; });
  if (!+Dl.min_order) $('#deliveryList li:nth-child(2)').hidden = true;
  if (Dl.enabled === false) {
    $('#deliveryList').hidden = true; $('#deliveryOff').hidden = false; $('#featDelivery small').hidden = true;
    $('input[name="oHow"][value="delivery"]').closest('label').hidden = true;
    $('input[name="oHow"][value="pickup"]').checked = true; syncHow();
  }

  // Ayurvedic sister store
  const A = SITE.ayurveda || {};
  if (A.enabled === false) { $('#ayurvedic').hidden = true; $$('[data-ayur]').forEach(e => { e.hidden = true; }); $('#navAyur').hidden = true; }
  else {
    setText('#ayName', A.name); setText('#saName', A.name);
    if (A.address) { setText('#ayAddr', A.address); setText('#saAddr', A.address); }
    if (A.phone) { $('#ayPhoneR').hidden = false; setText('#ayPhone', A.phone); setHref('#ayPhone', `tel:+${intl(A.phone)}`); setText('#saPhone', A.phone); } else $('#saPhoneR').hidden = true;
    if (A.email) { $('#ayEmailR').hidden = false; setText('#ayEmail', A.email); setHref('#ayEmail', `mailto:${A.email}`); }
    if (A.website) { $('#ayWebR').hidden = false; setText('#ayWeb', A.website.replace(/^https?:\/\//, '').replace(/\/$/, '')); setHref('#ayWeb', A.website); }
    setHref('#ayMap', mapsLink(ayurQuery()));
  }
  setHref('#cVisit', '#stores');

  // photos uploaded in Settings → Website
  const P = SITE.images || {};
  swapBg($('#heroBg'), P.hero, 'photo'); swapBg($('#heroM'), P.hero, 'photo'); swapBg($('#aboutBg'), P.about);
  if (P.about) { const u = photo(P.about); const im = new Image(); im.onload = () => $('#aboutArt').classList.add('photo'); im.src = u; }
  swapBg($('#ayImg'), P.ayurveda); swapBg($('#storeMainImg'), P.store_main); swapBg($('#storeAyurImg'), P.store_ayur);

  // social links
  const S = SITE.socials || {};
  $('#socials').innerHTML = [['facebook', 'fb', 'Facebook'], ['instagram', 'ig', 'Instagram'], ['youtube', 'yt', 'YouTube']]
    .filter(([k]) => /^https:\/\//i.test(S[k] || '')).map(([k, ic, n]) => `<a href="${esc(S[k])}" target="_blank" rel="noopener" aria-label="${n}">${icon(ic)}</a>`).join('')
    + (wa ? `<a href="${esc(waLink(wa))}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('wa')}</a>` : '');

  if (SITE.stock_check === false) $('#stockBox').hidden = true;
  setLanguage(lang);
}
const mainQuery = () => SITE.map_query || [shopName(), fullAddress()].filter(Boolean).join(', ') || 'Pallikkal Pharmacy, Pallikkal Bazar, Malappuram 673634';
const ayurQuery = () => { const A = SITE.ayurveda || {}; return A.map_query || [A.name, A.address].filter(Boolean).join(', ') || 'Pallikkal Bazar, Pallikkal PO, Malappuram 673634'; };

// ------------------------------------------------------------------ map
let mapShown = false;
function showMap(which = mapStore) {
  mapStore = which;
  $$('.s-store').forEach(b => b.classList.toggle('on', b.dataset.store === which));
  const q = which === 'ayur' ? ayurQuery() : mainQuery();
  setHref('#cVisit', mapsLink(mainQuery()));
  const box = $('#mapBox');
  box.innerHTML = `<iframe title="Map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${esc(mapsEmbed(q))}"></iframe>
    <a class="btn btn-white btn-sm" style="position:absolute;right:12px;bottom:12px;z-index:1;box-shadow:var(--sh)" href="${esc(mapsLink(q))}" target="_blank" rel="noopener">${icon('map')}<span>${T('mapOpen')}</span></a>`;
  mapShown = true;
}
if ('IntersectionObserver' in window) {
  const mo = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && !mapShown) { showMap('main'); mo.disconnect(); } }, { rootMargin: '300px' });
  mo.observe($('#mapBox'));
} else showMap('main');

// ------------------------------------------------------------------ offers card
function renderOffersCard() {
  const O = SITE.offers || [];
  const b = $('#offerBadge'); b.hidden = !O.length; b.textContent = O.length === 1 ? (O[0].tag || '1') : `${O.length} ${lang === 'ml' ? 'ഓഫറുകൾ' : 'offers'}`;
  const lead = $('#offerLead');
  if (O.length) lead.innerHTML = `<b style="color:var(--ink)">${esc(O[0].title)}</b>${O[0].text ? `<br>${esc(O[0].text)}` : ''}`;
  else lead.innerHTML = T('hl1t');
}

// ------------------------------------------------------------------ stock check
let stockT = 0, stockSeq = 0, stockLast = null;
function renderStock() {
  const box = $('#stockRes'); if (!box || !stockLast) return;
  if (stockLast.state === 'short') box.innerHTML = '';
  else if (stockLast.state === 'busy') box.innerHTML = `<div class="s-hint">${T('searching')}</div>`;
  else if (stockLast.state === 'fail') box.innerHTML = `<div class="s-hint">${T('searchFail')}</div>`;
  else if (!stockLast.rows.length) box.innerHTML = `<div class="s-hint">${T('noMatch')}</div>`;
  else box.innerHTML = stockLast.rows.map((r, i) => `<div class="s-res"><div><b>${esc(r.name)}</b><small>${esc([r.strength, r.dosage_form].filter(Boolean).join(' · '))}</small></div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end"><span class="s-chip ${r.available ? 'ok' : 'no'}">${r.available ? icon('check') : ''}${r.available ? T('available') : T('askUs')}</span>
    <button class="link" type="button" data-add="${i}">${T('addToOrder')}</button></div></div>`).join('');
}
$('#stockQ').addEventListener('input', e => {
  clearTimeout(stockT);
  const v = e.target.value.trim();
  if (v.length < 3) { stockLast = { state: 'short' }; renderStock(); if (v.length) $('#stockRes').innerHTML = `<div class="s-hint">${T('typeMore')}</div>`; return; }
  stockT = setTimeout(async () => {
    const seq = ++stockSeq; stockLast = { state: 'busy' }; renderStock();
    try {
      const { data, error } = await sb.rpc('public_medicine_search', { p_q: v });
      if (error) throw error;
      if (seq !== stockSeq) return;
      stockLast = { state: 'ok', rows: data || [] };
    } catch (err) {
      if (seq !== stockSeq) return;
      console.warn('stock check', err?.message || err);
      stockLast = { state: 'fail' };
    }
    renderStock();
  }, 350);
});
$$('[data-try]').forEach(b => b.addEventListener('click', () => { const q = $('#stockQ'); q.value = b.dataset.try; q.dispatchEvent(new Event('input')); q.focus(); }));
$('#askWa').addEventListener('click', e => {
  const n = INFO?.whatsapp; if (!n) return;   // without a number the link just goes to the contact section
  e.preventDefault(); window.open(waLink(n, T('askMsg') + ($('#stockQ').value.trim() || '')), '_blank', 'noopener');
});
$('#stockRes').addEventListener('click', e => {
  const b = e.target.closest('[data-add]'); if (!b || !stockLast?.rows) return;
  const r = stockLast.rows[+b.dataset.add]; const ta = $('#oItems');
  const line = `${r.name}${r.strength && !r.name.includes(r.strength) ? ' ' + r.strength : ''} – 1`;
  if (!ta.value.split('\n').some(l => l.trim().startsWith(r.name))) ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + line;
  toast(T('added'));
});

// ------------------------------------------------------------------ order on WhatsApp
function syncHow() {
  const del = $('input[name="oHow"]:checked')?.value === 'delivery';
  $('#oAddrF').hidden = !del;
}
$$('input[name="oHow"]').forEach(r => r.addEventListener('change', syncHow));
$('#orderForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = { name: $('#oName'), phone: $('#oPhone'), items: $('#oItems'), addr: $('#oAddr') };
  Object.values(f).forEach(x => x.classList.remove('bad'));
  const how = $('input[name="oHow"]:checked')?.value || 'pickup';
  const ph = digits(f.phone.value).replace(/^(91|0)(?=\d{10}$)/, '');
  const err = (el, k) => { el.classList.add('bad'); el.focus(); $('#oErr').textContent = T(k); };
  if (f.name.value.trim().length < 2) return err(f.name, 'eName');
  if (!/^[6-9]\d{9}$/.test(ph)) return err(f.phone, 'ePhone');
  if (f.items.value.trim().length < 3) return err(f.items, 'eItems');
  if (how === 'delivery' && f.addr.value.trim().length < 5) return err(f.addr, 'eAddr');
  $('#oErr').textContent = '';
  const wa = INFO?.whatsapp || INFO?.phone;
  if (!wa) { $('#oErr').textContent = T('noWa'); return; }
  const msg = [`*New medicine order — ${shopName()}*`, '', `Name: ${f.name.value.trim()}`, `Mobile: ${ph}`,
    how === 'delivery' ? `Home delivery to: ${f.addr.value.trim()}` : 'I will pick it up at the store', '', '*Medicines*', f.items.value.trim(), '',
    'Please confirm the price and time. (Sent from the website)'].join('\n');
  window.open(waLink(wa, msg), '_blank', 'noopener');
  toast(T('oSent'));
});
syncHow();

// ------------------------------------------------------------------ start
document.getElementById('year').textContent = new Date().getFullYear();
setLanguage(lang);
(async () => {
  try {
    const { data, error } = await sb.rpc('public_site_info');
    if (error) throw error;
    if (data?.available) { INFO = data; applyInfo(); }
    else refreshStatus();
  } catch (err) {
    console.warn('Website details are not available (run migration 0035):', err?.message || err);
    refreshStatus();
  }
  renderStatus();
})();
// Polling keeps the public status current on every device without requiring
// public read access to the underlying branch status table.
window.setInterval(refreshStatus, 15000);
window.addEventListener('focus', refreshStatus);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshStatus(); });
window.__site = { get info() { return INFO; }, setLanguage, showMap };
