from lib import *
from pages_a import (OWN_LIVING, OWN_FRONT, OWN_STREET, OWN_BATH, S_CALL, MEMORY, P_WACARES)

S = SITE
FAQ_HERO='1581579438930-a0269719fde7'; RES_HERO='1782248411973-c7b0ed450f5a'
A_AFH='1658632302217-984d432b4d38'; A_CHOOSE='1603796846097-bee99e4a601f'; A_PAY='1521791055366-0d553872125f'
A_DEM='1580869318757-a6c605b061ed'; A_MEDS='1584308666744-24d5c474f2ae'; A_MOVE='1761839257513-a921710a4291'
CAR_HERO='1765896387387-0538bc9f997e'; C_WHY1='1543333995-a78aea2eee50'; C_WHY2='1773227060484-41de85f93a08'; C_WHY3='1773227059522-acc3ae46abdc'
R_DAY='1773227059334-38d10a9075f2'

GUIDES = [
 ('guide-what-is-an-adult-family-home.html','What is an adult family home?','The basics: how adult family homes work in Washington, who they serve and how they differ from assisted living.',A_AFH,'A woman and a man talking in a comfortable living room','home','5 min'),
 ('guide-choosing-an-adult-family-home.html','How to choose an adult family home','A practical checklist of what to look for, what to ask and what to check before you decide.',A_CHOOSE,'A person writing notes on paper','clipboard','6 min'),
 ('guide-paying-for-care-in-washington.html','Paying for care in Washington','Medicaid, private pay, long-term care insurance, VA benefits and the new WA Cares Fund, explained simply.',A_PAY,'A person writing on a paper form','coins','6 min'),
 ('guide-supporting-a-loved-one-with-dementia.html','Supporting a loved one with dementia','Everyday communication tips and how a calm home routine helps people living with memory loss.',A_DEM,'Three pairs of hands held together in support','brain','5 min'),
 ('guide-medication-safety.html','Medication safety for older adults','Simple habits that prevent the most common medication mistakes, at home or in care.',A_MEDS,'Blister pack of white and blue medication','pill','4 min'),
 ('guide-making-the-move.html','Making the move: the first 30 days','How to help a parent or spouse settle into an adult family home, and what families can expect.',A_MOVE,'Two women admiring pink flowers in a garden','heart','5 min'),
]

# ───────────────────────── RESOURCES ─────────────────────────
gcards = ''.join(card(t, d, im, alt, ic, slug, 'Read guide', tag=mins+' read', d=(i%3)*0.1) for i,(slug,t,d,im,alt,ic,mins) in enumerate(GUIDES))
links = [
 ("DSHS Adult Family Home Locator","Look up any licensed adult family home in Washington, including inspection reports.","https://fortress.wa.gov/dshs/adsaapps/lookup/AFHAdvLookup.aspx","search"),
 ("Long-Term Care Ombuds","Free, confidential advocacy for residents: 1-800-562-6028.","https://www.waombudsman.org/","shield"),
 ("WA Cares Fund","Washington's long-term care benefit: 844-CARE4WA (844-227-3492).","https://wacaresfund.wa.gov/","heart"),
 ("Washington Connection","Apply online for Washington Medicaid and other benefits.","https://www.washingtonconnection.org/","file"),
 ("Alzheimer's Association","24/7 helpline for dementia questions: 1-800-272-3900.","https://www.alz.org/","brain"),
 ("DSHS complaint hotline","Report concerns about any long-term care home: 1-800-562-6078.","https://www.dshs.wa.gov/node/2826","phone"),
]
lcards = ''.join(f'<a class="c-card" href="{u}" target="_blank" rel="noopener" data-reveal="up" data-draw style="--d:{(i%2)*0.1:.2f}s"><div class="ico-badge">{icon(ic)}</div><div><small>External resource</small><strong>{t}</strong><span style="display:block;font-size:.9rem;color:var(--ink-soft)">{d}</span></div></a>' for i,(t,d,u,ic) in enumerate(links))

resources = page_hero("Resources","Guides &amp; resources","Helpful reading for <em>families</em>",
  "Plain-language guides to adult family homes, paying for care and supporting someone you love, plus trusted Washington resources.",
  RES_HERO,"Senior woman sketching in a sunlit garden") + f'''
<section class="section"><div class="wrap">
  {sec_head("Guides","Start <em>here</em>","Short, practical articles written for families exploring care in Washington.")}
  <div class="grid g3">{gcards}</div>
</div></section>
<section class="section tint"><div class="wrap">
  {sec_head("Trusted links","Washington <em>resources</em>","Independent agencies and organizations every family should know about.")}
  <div class="grid g2">{lcards}</div>
  <div style="margin-top:40px">{hint("Site hint","Every adult family home must display the Long-Term Care Ombuds contact information. It's a free, independent service for residents and families.")}</div>
</div></section>
{cta("Have a question we didn't answer?","Our team is happy to talk it through. Call, WhatsApp or email us.",OWN_LIVING,"Living room at Harmony Living House")}
'''

# ───────────────────────── FAQS ─────────────────────────
GROUPS = [
 ("About adult family homes","home",[
  ("What is an adult family home?","An adult family home (AFH) is a residential house licensed by Washington State DSHS to provide room, board, laundry, supervision and personal care to a small number of adults who cannot live alone safely."),
  ("How is an AFH different from assisted living?","Adult family homes are much smaller. With only a handful of residents, care is more personal, the setting feels like a family home, and caregivers get to know each resident very well."),
  ("Is Harmony Living House licensed?","Yes. We are licensed by Washington State DSHS as an adult family home, license #758581. You can look us up on the DSHS adult family home locator."),
 ]),
 ("Care &amp; daily life","heart",[
  ("Is someone awake at night?","Caregivers are in the home 24 hours a day, seven days a week, so help is always close by."),
  ("Can you help with medications?","Yes. We give medications as prescribed, keep daily records and coordinate refills with the pharmacy. When a task requires it, a registered nurse delegates and oversees it."),
  ("Do you care for people with dementia?","We support residents living with memory loss through calm routines, reminders and close supervision. Call us to talk about your loved one's specific needs."),
  ("What about meals and special diets?","We serve home-cooked meals and snacks every day, shaped around each resident's preferences and any diet ordered by their doctor."),
  ("How will I know how my loved one is doing?","We keep families informed about health changes, appointments and anything important, and you're welcome to call or visit."),
 ]),
 ("Cost &amp; payment","coins",[
  ("Do you accept Medicaid?","Yes. We accept Washington Medicaid as well as private pay. Long-term care insurance, VA benefits and WA Cares may also help."),
  ("How much does care cost?","Private pay rates depend on the level of care. Our Disclosure of Charges (DSHS form 15-449) lists rates and what's included, and it's available on request. Call or email us for a copy."),
  ("Can someone start private pay and switch to Medicaid?","Yes. Private pay residents need at least 12 months of private funds before converting to Medicaid, as explained in our disclosure."),
 ]),
 ("Visiting &amp; moving in","key",[
  ("When can family visit?","Families are always welcome. We simply ask that you consider residents' rest and mealtimes, and let us know if you're planning a larger gathering."),
  ("Can my loved one bring their own things?","Yes, please do. Photos, a favorite chair, blankets and keepsakes help a new room feel like home."),
  ("How soon can someone move in?","It depends on availability and paperwork. Call us and we'll tell you about current openings and timelines."),
  ("Can we tour before deciding?","Of course. Tours are by appointment. Call (951) 446-7774 or use the contact form."),
 ]),
]
fgroups = ''.join(f'<div class="faq-group"><h2 data-reveal="left" data-draw><span class="ico-badge" style="width:52px;height:52px;border-radius:16px">{icon(ic)}</span><span data-split>{g}</span></h2>{faq(items)}</div>' for g,ic,items in GROUPS)

faqs = page_hero("FAQs","Frequently asked questions","Answers to what <em>families</em> ask most",
  "Tap a question to open the answer. If yours isn't here, we'd love to hear from you.",
  FAQ_HERO,"Smiling older woman holding a warm mug of tea") + f'''
<section class="section"><div class="wrap">{fgroups}
  <div style="display:flex;justify-content:center">{hint("Site hint","Still have a question? Use the WhatsApp button at the bottom of your phone screen for a quick reply.")}</div>
</div></section>
{cta("Ask us anything","We'll answer honestly, even if the answer is that another kind of care would suit your loved one better.",OWN_FRONT,"Front porch of Harmony Living House")}
'''

# ───────────────────────── CAREERS ─────────────────────────
careers = page_hero("Careers","Join our team","Do work that <em>matters</em>, in a real home",
  "We're always glad to meet kind, dependable caregivers who want to make a difference for older adults in Lewis County.",
  CAR_HERO,"A nurse smiling with an elderly patient") + f'''
<section class="section"><div class="wrap">
  {sec_head("Why Harmony","A caring place to <em>work</em>")}
  <div class="grid g3">
    {tile("Know your residents","A small home means real relationships, not a rushed list of rooms.",C_WHY1,"Caregiver walking beside a woman in a wheelchair","users",0)}
    {tile("Supportive team","Clear care plans, good communication and a provider who is present and hands-on.",C_WHY3,"Three women talking warmly indoors","hands",.1)}
    {tile("Meaningful days","Music, laughter and small wins. You'll see the difference you make every shift.",C_WHY2,"An elderly woman dancing with a caregiver","sparkle",.2)}
  </div>
</div></section>
<section class="section tint"><div class="wrap feature">
  <div class="f-media" data-reveal="left"><div class="frame">{img(R_DAY,"Two elderly women holding hands with a younger caregiver")}</div></div>
  <div>
    <span class="eyebrow" data-reveal="up">Caregiver roles</span>
    <h2 data-split>Who we <em>look for</em></h2>
    <div class="divider" data-reveal="left"></div>
    <p data-reveal="blur">We hire day, evening and overnight caregivers. Requirements follow Washington State rules for adult family homes and typically include:</p>
    {checks(["A cleared DSHS background check",
             "Required long-term care training and certification, or willingness to complete it",
             "Current CPR and First Aid",
             "A Washington food handler card",
             "Patience, reliability and a genuine love of caring for people"])}
    <div class="btn-row" data-reveal="up">{btn("Email Your Resume","mailto:"+S["email"]+"?subject=Caregiver%20application","gold","mail")}{btn("Call Us","tel:"+S["tel"],"line","phone")}</div>
  </div>
</div></section>
<section class="section" style="padding-bottom:0"><div class="wrap">{hint("Application tip","Include your certifications and availability (days, evenings or nights) in your email so we can reply faster.")}</div></section>
{cta("Ready to care with us?","Send your resume or give us a call. We'd love to meet you.",OWN_STREET,"Harmony Living House in Chehalis")}
'''

# ───────────────────────── CONTACT ─────────────────────────
contact = page_hero("Contact","Contact &amp; tours","We'd love to <em>welcome</em> you",
  "Call, WhatsApp, email or send the form below. Tours are by appointment, and caregivers are on site 24/7.",
  OWN_STREET,"Harmony Living House viewed from the street") + f'''
<section class="section"><div class="wrap contact-grid">
  <div>
    <span class="eyebrow" data-reveal="up">Get in touch</span>
    <h2 data-split style="margin:14px 0 26px">Every journey starts with a <em>conversation</em></h2>
    <div class="c-cards">
      <a class="c-card" href="tel:{S["tel"]}" data-reveal="left" data-draw><div class="ico-badge">{icon("phone")}</div><div><small>Call</small><strong>{S["phone"]}</strong></div></a>
      <a class="c-card" href="{S["wa"]}" target="_blank" rel="noopener" data-reveal="left" data-draw style="--d:.08s"><div class="ico-badge">{icon("chat")}</div><div><small>WhatsApp</small><strong>Message us</strong></div></a>
      <a class="c-card" href="mailto:{S["email"]}" data-reveal="left" data-draw style="--d:.16s"><div class="ico-badge">{icon("mail")}</div><div><small>Email</small><strong>hello@<wbr>harmonylivinghouse.com</strong></div></a>
      <a class="c-card" href="{S["maps"]}" target="_blank" rel="noopener" data-reveal="left" data-draw style="--d:.24s"><div class="ico-badge">{icon("pin")}</div><div><small>Visit</small><strong>{S["addr1"]}, {S["addr2"]}</strong></div></a>
    </div>
    <div class="map" data-reveal="zoom"><iframe title="Map to Harmony Living House, 120 Newaukum Village Dr, Chehalis WA" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=120%20Newaukum%20Village%20Dr%2C%20Chehalis%2C%20WA%2098532&z=15&output=embed"></iframe></div>
  </div>
  <form class="form" id="tour-form" novalidate data-reveal="right" aria-label="Tour request form" style="position:relative">
    <h3 data-split>Request a <em>personal tour</em></h3>
    <p class="form-note">Fill this in and press send. Our team will get back to you to arrange your visit.</p>
    <div data-availability style="text-align:center"></div>
    <div aria-hidden="true" style="position:absolute;left:-5000px;width:1px;height:1px;overflow:hidden"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <div class="row"><div class="field"><label for="f-name">Your name</label><input id="f-name" name="name" autocomplete="name" required></div>
    <div class="field"><label for="f-phone">Phone</label><input id="f-phone" name="phone" type="tel" autocomplete="tel"></div></div>
    <div class="field"><label for="f-email">Email</label><input id="f-email" name="email" type="email" autocomplete="email"></div>
    <div class="row"><div class="field"><label for="f-who">Inquiring for</label><select id="f-who" name="who"><option value="">Choose…</option><option>My parent</option><option>My spouse or partner</option><option>Myself</option><option>A client (professional referral)</option><option>Someone else</option></select></div>
    <div class="field"><label for="f-int">Care interest</label><select id="f-int" name="interest"><option value="">Choose…</option><option>Long-term care</option><option>Memory support</option><option>Respite stay</option><option>Comfort / end-of-life care</option><option>General question</option></select></div></div>
    <div class="field"><label for="f-when">Preferred tour day or time</label><input id="f-when" name="when" placeholder="e.g. Saturday afternoon"></div>
    <div class="field"><label for="f-msg">Message</label><textarea id="f-msg" name="message" placeholder="Tell us a little about your loved one's needs…"></textarea></div>
    <button class="btn btn-gold" type="submit">Send Request {sicon("arrow")}</button>
    <p class="form-ok" role="status">Your email app should now be open with your message. Press send there, or call us at {S["phone"]}.</p>
  </form>
</div></section>
<section class="section" style="padding-top:0"><div class="wrap">{hint("Site hint","On a phone, use the Call and WhatsApp buttons at the bottom of the screen to reach us in one tap.")}</div></section>
'''

# ───────────────────────── GUIDES ─────────────────────────
def guide(slug, title, lead, image, alt, mins, body):
    others = ''.join(card(t, d, im, a, ic, s, 'Read guide', d=k*0.1) for k,(s,t,d,im,a,ic,m) in enumerate([g for g in GUIDES if g[0]!=slug][:3]))
    return (slug, title, lead, page_hero("Guides", "Family guide", title, lead, image, alt) + f'''
<section class="section"><div class="wrap"><article class="article">
  <div class="meta" data-reveal="up"><span>{sicon("book")}Harmony Living House</span><span>{sicon("clock")}{mins} read</span><span>{sicon("pin")}Washington State</span></div>
  <div class="cover" data-reveal="zoom">{img(image, alt)}</div>
  <div data-reveal="up">{body}</div>
  <p style="margin-top:30px;font-size:.9rem;color:var(--ink-soft)"><i>This guide is general information for families, not legal, medical or financial advice. Rules and programs change, so please confirm details with the agency involved.</i></p>
</article></div></section>
<section class="section tint"><div class="wrap">{sec_head("Keep reading","More <em>guides</em>")}<div class="grid g3">{others}</div></div></section>
{cta("Talk to a real person","Questions after reading? Call or message us. We're glad to help, even if you're just starting to explore.",OWN_FRONT,"Harmony Living House front porch")}
''', 'Questions after reading? Tap WhatsApp or Call to reach us directly.')

G_BODY = {}
G_BODY['guide-what-is-an-adult-family-home.html'] = '''
<p>If you're starting to look at care options for a parent or spouse in Washington, you'll quickly hear the term <b>adult family home</b>, often shortened to AFH. Here's what it means and why many families choose one.</p>
<h2>A home, licensed for care</h2>
<p>An adult family home is a regular residential house that is licensed by the Washington State Department of Social and Health Services (DSHS) to care for a small number of adults. Most homes care for up to six residents, and some are approved for up to eight. Residents receive a room, meals, laundry, supervision and help with personal care.</p>
<h2>Who lives in an adult family home?</h2>
<p>AFH residents are usually older adults or adults with disabilities who can no longer live safely on their own but don't need a hospital. Common reasons include:</p>
<ul><li>Needing help with bathing, dressing, toileting or moving around</li><li>Trouble managing medications safely</li><li>Memory loss or dementia that makes living alone risky</li><li>Recovery after a hospital stay, or a decline in health over time</li></ul>
<h2>How it compares with other options</h2>
<p><b>Assisted living facilities</b> are larger buildings with many apartments. <b>Nursing homes</b> provide skilled nursing around the clock. An <b>adult family home</b> sits in between: a small, family-style setting with 24-hour care and much more personal attention.</p>
<p class="pullquote">The biggest difference families notice is the ratio: a few residents, the same familiar caregivers and a real kitchen table.</p>
<h2>Every resident has a care plan</h2>
<p>Washington requires each AFH to write a <b>Negotiated Care Plan</b> with the resident and their representative. It describes the help the person needs, their preferences and who does what. The plan is completed within 30 days of moving in and updated when needs change.</p>
<h2>How homes are overseen</h2>
<p>DSHS licenses and inspects adult family homes, and you can look up any home's license and inspection history online. Residents also have access to the free <b>Long-Term Care Ombuds</b> program for advocacy and support.</p>
'''
G_BODY['guide-choosing-an-adult-family-home.html'] = '''
<p>Every adult family home is different. A good fit comes from the right mix of care, people and atmosphere. Use this checklist when you call and visit.</p>
<h2>Before you visit</h2>
<ul><li><b>Check the license.</b> Search the home on the DSHS adult family home locator and read recent inspection reports.</li><li><b>Ask about openings and fit.</b> Describe your loved one's needs and ask honestly whether the home can meet them.</li><li><b>Request the Disclosure of Charges</b> (DSHS form 15-449). It lists rates, what's included and key policies.</li></ul>
<h2>On the tour, look for</h2>
<ul><li>Clean, bright, odor-free rooms and bathrooms</li><li>Residents who look comfortable, groomed and engaged</li><li>Caregivers who speak kindly and know residents by name</li><li>A safe layout: clear walkways, accessible bathrooms, easy exits</li><li>Real food being prepared, and a schedule that follows residents' rhythms</li></ul>
<h2>Questions worth asking</h2>
<ol><li>Who is in the home overnight, and are they awake?</li><li>How are medications given and recorded?</li><li>How often is the care plan reviewed, and how are families involved?</li><li>What happens if my loved one's needs increase?</li><li>How do you communicate with families about changes or incidents?</li><li>What activities and outings happen in a typical week?</li></ol>
<p class="pullquote">Trust what you feel. If residents seem relaxed and caregivers seem unhurried, that's a very good sign.</p>
<h2>After the visit</h2>
<p>Compare notes with family, review the disclosure and agreement carefully, and don't hesitate to call back with follow-up questions. A good home will welcome them.</p>
'''
G_BODY['guide-paying-for-care-in-washington.html'] = '''
<p>Paying for long-term care is one of the biggest worries families bring to us. Washington offers several routes, and many families combine more than one.</p>
<h2>Private pay</h2>
<p>Many residents pay from savings, pensions, Social Security or the sale of a home. Rates vary by home and level of care. Every home's Disclosure of Charges explains its rates and what's included.</p>
<h2>Medicaid (Apple Health long-term care)</h2>
<p>Washington Medicaid can pay for care in an adult family home for people who meet both <b>financial</b> and <b>functional</b> eligibility. A DSHS case manager completes an assessment to determine care needs. Residents may be asked to contribute part of their income toward the cost of care each month.</p>
<ul><li>Apply online through Washington Connection, or contact your local DSHS Home &amp; Community Services office.</li><li>Start early. Approval can take several weeks.</li><li>Ask each home whether it accepts Medicaid. Harmony Living House does.</li></ul>
<h2>Long-term care insurance</h2>
<p>If your loved one has a long-term care policy, check its terms for adult family home coverage, elimination periods and daily limits. Homes can usually provide the documentation insurers request.</p>
<h2>Veterans' benefits</h2>
<p>Wartime veterans and surviving spouses may qualify for VA pension benefits with Aid &amp; Attendance, which can help pay for care. A county veterans service officer can help with the application at no cost.</p>
<h2>WA Cares Fund</h2>
<p>Washington's WA Cares Fund began paying benefits in July 2026. Eligible workers can use a lifetime benefit of up to $36,500 (adjusted for inflation) toward approved long-term care services, including care in an adult family home. Call 844-CARE4WA to check eligibility.</p>
<p class="pullquote">You don't have to work this out alone. We're glad to talk through options and point you to the right agency.</p>
'''
G_BODY['guide-supporting-a-loved-one-with-dementia.html'] = '''
<p>Watching someone you love change because of dementia is hard. Small changes in how we communicate and organize the day can make life calmer for everyone.</p>
<h2>Communicating with care</h2>
<ul><li><b>Approach from the front</b> and say their name before you start talking.</li><li><b>Keep sentences short</b> and ask one question at a time.</li><li><b>Offer simple choices:</b> "the blue sweater or the red one?" rather than open questions.</li><li><b>Don't argue with their reality.</b> Respond to the feeling behind the words.</li><li><b>Use touch and a warm tone.</b> Body language often speaks louder than words.</li></ul>
<h2>Routine is reassuring</h2>
<p>Predictable days lower anxiety. Meals, personal care, activities and bedtime at familiar times help people living with memory loss know what comes next, even when they can't remember the schedule.</p>
<h2>Making the home easier to read</h2>
<ul><li>Clear signs or pictures on doors, such as the bathroom</li><li>Good lighting, especially in the evening</li><li>Less clutter and fewer loud distractions</li><li>Familiar photos and objects nearby</li></ul>
<p class="pullquote">When someone with dementia is upset, look for the need behind the behavior: pain, hunger, the toilet, boredom or feeling lost.</p>
<h2>When to consider more support</h2>
<p>Wandering, nighttime confusion, missed medications, falls or caregiver exhaustion are all signs it may be time for 24-hour support. An adult family home offers supervision and routine in a smaller, quieter setting that many people with dementia find easier to manage.</p>
<p>The Alzheimer's Association's 24/7 helpline (1-800-272-3900) is a free source of advice for families at any stage.</p>
'''
G_BODY['guide-medication-safety.html'] = '''
<p>Many older adults take several medications every day. Each one may help, but together they raise the risk of mistakes and side effects. These habits make a real difference.</p>
<h2>Keep one up-to-date list</h2>
<p>Write down every prescription, over-the-counter medicine, vitamin and supplement, with the dose and time. Bring the list to every appointment and share it with every pharmacy and care provider.</p>
<h2>Use one pharmacy when you can</h2>
<p>A single pharmacy can check for interactions across all prescriptions. Ask about blister packs or pre-sorted packaging, which make it easy to see whether a dose was taken.</p>
<h2>Watch for warning signs</h2>
<ul><li>New confusion, drowsiness or dizziness</li><li>Falls or unsteadiness</li><li>Changes in appetite, sleep or mood</li><li>Unusual bruising or bleeding, especially with blood thinners</li></ul>
<p>Report changes to the doctor or pharmacist promptly. Never stop or change a medication without medical advice.</p>
<p class="pullquote">The right medication, the right dose, the right time, every time, and written down.</p>
<h2>How we handle medications at Harmony</h2>
<p>At Harmony Living House, medications are given as prescribed, recorded on a daily medication log and coordinated with each resident's pharmacy and physician. When a task requires a nurse, it's delegated and supervised by a registered nurse under Washington's nurse delegation rules.</p>
'''
G_BODY['guide-making-the-move.html'] = '''
<p>Moving into an adult family home is a big change, for your loved one and for you. A little preparation and patience help the first weeks go smoothly.</p>
<h2>Before move-in day</h2>
<ul><li>Talk about the move honestly and positively, focusing on safety, company and good care.</li><li>Share their life story with the home: routines, favorite foods, music, faith and what comforts them.</li><li>Label clothing and bring familiar items such as photos, a quilt or a favorite chair.</li><li>Gather documents and the current medication list.</li></ul>
<h2>On the day</h2>
<p>Plan to arrive earlier in the day when energy is better. Help arrange the room together, share a meal, then keep the goodbye warm and brief.</p>
<h2>The first 30 days</h2>
<p>Settling in can take a few weeks. It's normal to see some sadness, confusion or restlessness at first. During this time the home completes the full Negotiated Care Plan, learning what works best for your loved one.</p>
<ul><li>Visit regularly, but give space for new routines to form.</li><li>Keep in touch with caregivers and share what you notice.</li><li>Celebrate small wins: a good night's sleep, a new friendship, an empty plate.</li></ul>
<p class="pullquote">Feeling guilty is common. Choosing safe, loving care is an act of love, not giving up.</p>
<h2>Take care of yourself too</h2>
<p>Many family caregivers are exhausted by the time they choose a home. Rest, reconnect and let your relationship become about time together again, not tasks.</p>
'''

guide_pages = []
for slug, title, lead, image, alt, ic, mins in GUIDES:
    s, t, l, content, hp = guide(slug, title, lead, image, alt, mins, G_BODY[slug])
    guide_pages.append((s, t, l, content, hp))

PAGES_B = [
 ('resources.html','Guides & Resources','Guides for families about adult family homes, paying for care, dementia and medication safety in Washington State.',resources,'Each guide ends with links to related reading.'),
 ('faqs.html','FAQs','Answers to common questions about Harmony Living House adult family home in Chehalis, WA: care, cost, visiting and moving in.',faqs,'Tap any question to open its answer.'),
 ('careers.html','Careers','Caregiver jobs at Harmony Living House adult family home in Chehalis, Washington.',careers,'Email your resume to hello@harmonylivinghouse.com.'),
 ('contact.html','Contact & Tours','Call (951) 446-7774, WhatsApp or email Harmony Living House to book a tour of our adult family home at 120 Newaukum Village Dr, Chehalis, WA.',contact,'Prefer to talk? Tap the phone number and we will answer your questions directly.'),
] + guide_pages
