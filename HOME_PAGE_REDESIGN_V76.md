# Home page redesign (version 76)

`index.html`, the public page visitors see, now follows the attached design on desktop and mobile. It uses the same navy and green theme, fonts and Pallikkal Pharmacy logo as the dashboard.

There is no "Your Trusted Healthcare Partner" section.

## What to do
1. **Run the migration.** In the Supabase SQL editor run `database/migrations/0035_public_website.sql`. It is safe to run twice.
2. **Check it (optional).** Run `database/diagnostics/verify_0035.sql`; every row should say `true`.
3. **Fill in your details.**
   - Open **Settings → Business Information** and check the address, phone, email and drug licence numbers. The home page shows these.
   - Open **Settings → Website** and set:
     - opening hours;
     - WhatsApp number;
     - offers;
     - delivery distance and minimum order;
     - Ayurvedic store details;
     - map search text;
     - social links;
     - photos (optional).
   - Press **Save**.
4. Upload the new files.

You can skip step 1. The page still works without the migration, using built-in texts and the counter's Open / Closed switch, but you cannot edit it from Settings.

## Page sections (top to bottom)

| Section | What it shows | Where the content comes from |
|---|---|---|
| Top bar | Address, phone, email, **Shop Open / Closed**, today's hours | Business Information + Website hours |
| Header | Logo; Home, Services ▾ (6 services), Offers, About Us, Ayurvedic Store, Contact; English / മലയാളം; **Login ▾** (Staff, Admin, Delivery). On mobile: user icon + menu drawer | — |
| Hero | Heading, text, *Explore Our Services*, *Order Medicines Online*, Care / Trust / Wellbeing, 6 feature tiles | Website heading / text, or built-in |
| Quick Highlights | Special Offers (count + list), Home Delivery (km + minimum), Prescription Refill (WhatsApp), Health Essentials | Website offers / delivery |
| **Is your medicine available?** | Visitor types 3+ letters and sees **Available / Ask us**; *Add to order*; *Ask the pharmacist* | Your medicine list and stock (no quantities, no prices) |
| **Order Medicines Online** | Name, mobile, medicines, delivery or pick-up, address. Sends the order to your WhatsApp | Website WhatsApp number (pharmacy phone if empty) |
| Our Services | 6 cards; *Learn More* opens details with Order and Call buttons | Built-in (English + Malayalam) |
| About Us | Text, 3 points, *Learn More About Us* (address, weekly hours, drug licence) | Website about text |
| Ayurvedic Store | Name, text, 4 features, address, phone, email, website, map link, product list | Website → Ayurvedic sister store |
| Visit Our Stores | Pharmacy and sister-store cards (hours, Open chip), Google map that switches between the two stores | Business Information + Website |
| Need Help? | Call, WhatsApp, Email, Visit; *Contact Us Now*; *Staff Portal* | Business Information |
| Footer | About, social links, quick links, services, store details, drug licence, contact, Privacy / Terms / Disclaimer | Website + Business Information |

There is also a floating WhatsApp button and a back-to-top button.

## Existing functions kept
- **Shop Open / Closed badge**
  - Refreshes every 15 seconds, when the window gets focus and when the tab becomes visible.
  - Keeps the last known status if the network drops.
  - The counter's Open / Closed switch on the billing screen still decides it.
  - When the switch has never been set, the opening hours decide it.
  - Without migration 0035 the badge uses `public_shop_is_open` exactly as before.
- **English / Malayalam switch**
  - Every text on the page is translated.
  - The choice is saved under the same key as before (`alza_public_language`).
  - The old `#languageToggle` button still works.
  - Text you type in Settings (heading, about text) is shown as you wrote it in both languages.
- **Login menu**
  - Staff login and Admin login, now also Delivery login.
  - Closes when you click outside it or press Esc.
- **Other content from the old page**
  - Offers banner, delivery rule (5 km / ₹300 by default, now editable), the three services, About Us, Ayurvedic sister store with map link, contact details, Staff portal link, footer year.
  - The old "demo contact details" labels are gone. The page now shows your real details from Settings.

## New Settings section: Website
Admin and Super Admin can edit everything visitors see:
- **Home page**
  - On/off switch: when off, visitors see only your contact details and "Our website is being updated".
  - Heading, text and about text.
  - WhatsApp number and map search text.
  - Stock-check switch and drug-licence switch.
- **Opening hours** for each day, with a Closed tick and *Copy Monday to Tuesday – Saturday*.
- **Home delivery**: on/off, distance, minimum order and a note.
- **Offers**: up to 12, each with title, badge, details and end date. Expired offers hide automatically.
- **Ayurvedic sister store**: on/off, name, description, address, phone, email, website and map text.
- **Social links**: Facebook, Instagram, YouTube. Only filled-in links are shown.
- **Photos**: top banner, about, Ayurvedic banner, and the two store cards. Each is JPG, PNG or WEBP up to 2 MB. Empty slots use the built-in illustrations.

Every save is checked (hours, lengths, https links, email, photos in your branch's folder) and recorded in Audit Logs.

## Privacy and security
- **What visitors can read.** Without signing in, a visitor can call only two functions:
  - `public_site_info()`: name, address, phone, email, hours, open now, offers, delivery rules, sister store, links.
  - `public_medicine_search()`: medicine name, strength, form and Available yes/no. It never returns quantities, batches, prices, customers, staff or sales. You can switch it off.
- **No customer data stored.** Orders and prescriptions go directly to your WhatsApp, and nothing the visitor types is saved in the database.
- **Who can change the website.** Only Admin and Super Admin can read or change website settings.

## Files
- New:
  - `database/migrations/0035_public_website.sql`
  - `database/diagnostics/verify_0035.sql`
  - `assets/css/site.css`
  - `assets/js/site.js`
  - `assets/images/site/*.svg`: illustrations for the hero, store, Ayurvedic store, card art, 6 service pictures and the pharmacist.
- Changed:
  - `index.html`
  - `assets/js/settings.js`: Website section.
  - `assets/css/settings-pos.css`
- Tests:
  - `tests/live-replica/live-0035.test.mjs`: 23 checks.
  - `tests/e2e/home_flow.py`: 93 checks.
  - `tests/e2e/settings_flow.py`: now expects 13 sections.
  - `tests/e2e/server.mjs`: runs 0035; visitors run as the `anon` role; demo website data.

## Notes
- The map is a Google Maps embed, which needs no API key.
- The WhatsApp order and refill links open WhatsApp with the message filled in. The visitor attaches the prescription photo and presses Send there. Websites cannot attach files to WhatsApp automatically.
- "Parking Available" and "Near Key Landmarks" are general lines. Change them in `assets/js/site.js` (keys `r1`–`r3`) if they do not fit your stores.
