from lib import *

# Image library (Unsplash photo ids, verified) and own photos
HERO_HOME='1765896387398-1e1ae8d2eb85'; SERV_HERO='1762955911431-4c44c7c3f408'
PERSONAL='1773227055624-07b515ba87c5'; MEDS='1563213126-a4273aed2016'; HEALTH='1631815590058-860e4f83c1e8'
MEALS='1790470743855-e7eba908d5c3'; MEMORY='1758691031158-8d19bc43fcf8'; SOCIAL='1764173039543-f9f197744e1b'
HOUSEKEEP='1699797467199-6bdf301649e8'; RESPITE='1757417983938-2c2a931d41aa'; COORD='1631815590016-ebce183022ce'
COMFORT='1761692980299-2a09a152e6a5'; HOW_HERO='1773234005378-ceebf3c877b9'
S_CALL='1621525434111-87a99d170b0e'; S_ASSESS='1631815589968-fdb09a223b1e'; S_SIGN='1664463760781-f159dfe3af30'; S_MOVE='1742522450616-a2cf0cba1274'
PAY_HERO='1775163024488-e88e4a71179f'; P_MEDICAID='1450101499163-c8848c66ca85'; P_PRIVATE='1758518730327-98070967caab'
P_LTC='1562564055-71e051d33c19'; P_VA='1720796675394-4c52298f0fc4'; P_WACARES='1488928553678-f09393d1ad6f'
T_SMALL='1586324304780-c9a5031a3599'; T_FAMILY='1593100126453-19b562a800c1'; T_MEALS='1758874960056-07aa3d0afa3b'; T_GARDEN='1769506551162-f56c343f0642'
AB_MISSION='1766524555239-245d78f3b3a2'; AB_VISION='1773227059780-5e865ce7fb13'; AB_PROMISE='1595023986775-e3e9ce35ca2f'
OWN_LIVING='assets/img/home/living-room.jpg'; OWN_BATH='assets/img/home/bathroom.jpg'
OWN_FRONT='assets/img/home/exterior-front.jpg'; OWN_STREET='assets/img/home/exterior-street.jpg'
H='assets/img/home/'
OWN_WIDE=H+'front-wide.jpg'; OWN_RAMP=H+'front-ramp.jpg'; OWN_TV=H+'living-tv.jpg'; OWN_KITCHEN=H+'kitchen-dining.jpg'
OWN_BED=H+'bedroom.jpg'; OWN_SHOWER=H+'shower.jpg'; OWN_DECK=H+'deck-back.jpg'; OWN_UMBRELLA=H+'deck-umbrella.jpg'
OWN_SEAT=H+'deck-seating.jpg'; OWN_GATE=H+'deck-gate.jpg'; OWN_GAZEBO=H+'gazebo-view.jpg'
ACTIVITY='assets/img/activity-chair-exercise.jpg'

S = SITE

# ───────────────────────── HOME ─────────────────────────
home = f'''
<section class="hero">
  <div class="hero-media">{img(OWN_WIDE, "Harmony Living House: a blue single-story home with white trim, a covered porch and a railed ramp to the front door", eager=True)}</div>
  <div class="wrap"><div class="hero-copy">
    <span class="hero-name" data-reveal="zoom">HARMONY LIVING HOUSE</span>
    <span class="eyebrow" data-reveal="up">Licensed Adult Family Home &middot; Chehalis, Washington</span>
    <h1 data-split style="--d:.1s">A real home, with <em>caring hands</em> around the clock</h1>
    <p class="lead" data-reveal="blur" style="--d:.55s">Harmony Living House is a small, state-licensed adult family home in Lewis County. Your loved one gets personal attention, 24/7 support and the warmth of family life, in a home that is calm, bright and truly lived in.</p>
    <div class="btn-row" data-reveal="up" style="--d:.75s">{btn("Schedule a Tour","contact.html")}{btn("Explore Our Services","services.html","line")}</div>
    <div class="trust" data-stagger=".1">
      <span class="chip" data-reveal="up">{sicon("shield")}DSHS Licensed #{S["license"]}</span>
      <span class="chip" data-reveal="up">{sicon("clock")}Caregivers on site 24/7</span>
      <span class="chip" data-reveal="up">{sicon("coins")}Medicaid &amp; Private Pay</span>
    </div>
  </div></div>
</section>

<section class="section" style="padding-top:20px"><div class="wrap">
  <div class="facts" data-reveal="up">
    <div class="fact"><b>24/7</b><span>Awake, attentive care</span></div>
    <div class="fact"><b>DSHS</b><span>State-licensed home</span></div>
    <div class="fact"><b>1:1</b><span>Personal care plan</span></div>
    <div class="fact"><b>Home</b><span>Not a facility</span></div>
  </div>
</div></section>

<section class="section"><div class="wrap feature">
  <div class="f-media" data-reveal="left">
    <div class="frame">{img(OWN_LIVING, "The open living room at Harmony Living House with a large sectional sofa, dining table and kitchen")}</div>
    <div class="f-badge" data-reveal="up" style="--d:.4s"><div class="ico-badge" data-draw>{icon("home")}</div><div><strong>Real home</strong><span>Living room, kitchen &amp; dining together</span></div></div>
  </div>
  <div>
    <span class="eyebrow" data-reveal="up">Welcome to Harmony</span>
    <h2 data-split>Where care feels like <em>family</em></h2>
    <div class="divider" data-reveal="left"></div>
    <p class="lead" data-reveal="blur">Moving a parent or spouse into care is one of the biggest decisions a family makes. We built Harmony Living House to make that decision feel right: a real house on a quiet street, a small group of residents, and caregivers who know each person by name, story and smile.</p>
    {checks(["<b>Daily living help</b> with bathing, dressing, grooming, toileting and moving safely",
             "<b>Medication support</b> given on time and documented every day",
             "<b>Home-cooked meals</b> served at the family table",
             "<b>A care plan written for one person</b>, reviewed as needs change"])}
    <div class="btn-row" data-reveal="up">{btn("Our Story","about.html")}{btn("See the Home","our-home.html","line","eye")}</div>
  </div>
</div></section>

<section class="section tint"><div class="wrap">
  {sec_head("What we offer","Care that covers <em>every part</em> of the day","From the first cup of coffee to a safe, settled night, our caregivers support the everyday tasks that have become hard to manage alone.")}
  <div class="grid g3">
    {card("Personal Care","Gentle, respectful help with bathing, dressing, grooming, toileting and getting around, at your loved one's pace.",PERSONAL,"Caregiver helping an elderly woman walk with her walker","hands","services.html#personal",d=0)}
    {card("Medication Management","Medications given as prescribed, recorded on a daily log and coordinated with pharmacies and physicians.",MEDS,"Hand reaching into a weekly pill organizer","pill","services.html#medication",d=.1)}
    {card("Meals &amp; Nutrition","Fresh, home-cooked meals and snacks shaped around preferences, appetite and doctor's orders.",MEALS,"Elderly woman enjoying a meal at a round table by a sunny window","utensils","services.html#meals",d=.2)}
    {card("Memory Support","Calm routines, gentle reminders and patient redirection for residents living with memory loss.",MEMORY,"Seniors sharing coffee and working on a puzzle together","brain","services.html#memory",d=0)}
    {card("Health Coordination","Vital signs, appointment scheduling and clear updates between doctors, nurses and family.",HEALTH,"Healthcare worker checking a woman's blood pressure","steth","services.html#coordination",d=.1)}
    {card("Social &amp; Emotional Support","Conversation, music, games and quiet companionship, because feeling connected is part of good care.",ACTIVITY,"Older adults doing seated stretching exercises with colorful balls","users","services.html#social",d=.2)}
  </div>
  <div class="center" style="margin-top:44px" data-reveal="up">{btn("View All Services","services.html")}</div>
</div></section>

<section class="section"><div class="wrap">
  {sec_head("Why families choose us","Small home. <em>Big attention.</em>","An adult family home sits between living alone and a large facility. Here is what that difference feels like day to day.")}
  <div class="grid g4">
    {tile("Fewer residents","A small group means caregivers notice the little changes that matter: a skipped meal, a quiet mood, a new ache.",T_SMALL,"Two people holding hands, one in a blue shirt","heart",0)}
    {tile("Family is welcome","Visits, calls and holidays together. You stay part of every decision about your loved one's care.",T_FAMILY,"An elderly woman with white hair hugging a young child","users",.1)}
    {tile("Home-cooked food","Meals made in a real kitchen and shared at one table, never a cafeteria line.",T_MEALS,"Elderly woman preparing a fresh salad in a kitchen","utensils",.2)}
    {tile("Calm surroundings","Beside Newaukum Golf Club and the Newaukum River, with a deck, gazebo and lawn to enjoy on good days.",OWN_GAZEBO,"View from the gazebo with string lights toward the back deck","leaf",.3)}
  </div>
</div></section>

<section class="section grey"><div class="wrap">
  {sec_head("How it works","From first call to <em>moving in</em>","Four simple steps. We guide you through each one and answer every question along the way.")}
  <div class="mini-steps" data-stagger=".12">
    <div class="mini" data-reveal="up" data-draw><span class="n">01</span><div class="ico-badge">{icon("phone")}</div><h3>Call or message</h3><p>Tell us about your loved one and what you're looking for.</p></div>
    <div class="mini" data-reveal="up" data-draw><span class="n">02</span><div class="ico-badge">{icon("home")}</div><h3>Tour the home</h3><p>Meet the caregivers, see the rooms and ask anything.</p></div>
    <div class="mini" data-reveal="up" data-draw><span class="n">03</span><div class="ico-badge">{icon("clipboard")}</div><h3>Plan the care</h3><p>We review the assessment and write a personal care plan together.</p></div>
    <div class="mini" data-reveal="up" data-draw><span class="n">04</span><div class="ico-badge">{icon("key")}</div><h3>Settle in</h3><p>Move-in day is gentle and well prepared, with check-ins for the family.</p></div>
  </div>
  <div class="center" style="margin-top:40px" data-reveal="up">{btn("See the Full Process","how-it-works.html","line","compass")}</div>
</div></section>

<section class="section"><div class="wrap feature rev">
  <div class="f-media" data-reveal="right">
    <div class="frame">{img(OWN_DECK, "The large back deck at Harmony Living House with white railings and sliding doors to the house")}</div>
  </div>
  <div>
    <span class="eyebrow" data-reveal="up">Our home in Chehalis</span>
    <h2 data-split>Bright rooms, a <em>quiet street</em>, and a porch for sunny days</h2>
    <div class="divider" data-reveal="left"></div>
    <p class="lead" data-reveal="blur">Harmony Living House is a single-story home in the Newaukum Village neighborhood. Everything is on one level, with a ramp at the front door, an open living and dining area at its heart and a big gated back deck for fresh air. Take a look around before you visit.</p>
    <div class="btn-row" data-reveal="up" style="margin-top:28px">{btn("Open the Gallery","our-home.html")}</div>
  </div>
</div></section>

<section class="section tint"><div class="wrap">
  {sec_head("Questions families ask","Quick <em>answers</em>")}
  {faq([("What is an adult family home?","An adult family home (AFH) is a regular house licensed by Washington State DSHS to provide room, board and personal care to a small number of adults. Residents get 24-hour supervision and help with daily living in a family-style setting."),
        ("Do you accept Medicaid?","Yes. We accept Washington Medicaid as well as private pay. Long-term care insurance and veterans' benefits may also help. See Payment &amp; Admissions for details."),
        ("Can we visit before deciding?","Absolutely, and we encourage it. Call or message us to book a tour at a time that suits your family."),
        ("Is someone there at night?","Yes. Caregivers are in the home 24 hours a day, seven days a week.")])}
  <div class="center" style="margin-top:34px" data-reveal="up">{btn("All FAQs","faqs.html","line","chat")}</div>
</div></section>

<section class="section" style="padding-bottom:0"><div class="wrap">{hint("Helpful hint","When you tour any adult family home, ask to see its Disclosure of Charges (DSHS form 15-449). It lists the home's rates, services and policies. Ours is on the Payment &amp; Admissions page.")}</div></section>
{cta("Let's find the right care, together","Call, message or book a tour. We'll listen first, answer honestly and help you decide what's best for your family.",OWN_UMBRELLA,"Shaded table and chairs under a large umbrella on the back deck")}
'''

# ───────────────────────── ABOUT ─────────────────────────
about = page_hero("About Us","About Harmony Living House","Rooted in <em>dignity</em>, run like a family",
  "We are a licensed adult family home in Chehalis, Washington, built on a simple belief: every person deserves to age with dignity, comfort and real human connection.",
  OWN_RAMP,"Corner view of Harmony Living House with its ramp, porch and two-car garage") + f'''
<section class="section"><div class="wrap feature">
  <div class="f-media" data-reveal="left"><div class="frame">{img(OWN_KITCHEN,"Kitchen, dining table and living area inside Harmony Living House")}</div>
    <div class="f-badge" data-reveal="up" style="--d:.4s"><div class="ico-badge" data-draw>{icon("shield")}</div><div><strong>#{S["license"]}</strong><span>Washington DSHS adult family home license</span></div></div></div>
  <div>
    <span class="eyebrow" data-reveal="up">Our story</span>
    <h2 data-split>A home first, a <em>care provider</em> always</h2>
    <div class="divider" data-reveal="left"></div>
    <p data-reveal="blur">Harmony Living House was created for families who want more than a room and a schedule. Our home is not a medical institution. It is a house with a kitchen that smells like dinner, a living room where residents share the afternoon, and caregivers who treat each person the way they would want their own parents treated.</p>
    <p data-reveal="blur" style="margin-top:14px">The home is led by provider <b>Penninah Nyandia</b>, who oversees daily care, staffing and every resident's plan. Our caregivers are trained, background-checked and supported to deliver care with patience, discretion and warmth.</p>
  </div>
</div></section>

<section class="section tint"><div class="wrap">
  {sec_head("What guides us","Mission, vision &amp; <em>promise</em>")}
  <div class="grid g3">
    {card("Our Mission","To provide safe, personal, around-the-clock care in a true home, so every resident can live each day with dignity and purpose.",AB_MISSION,"Two elderly women walking side by side on a stone path","heart",d=0)}
    {card("Our Vision","To be the adult family home Lewis County families recommend first: known for honest communication and genuinely kind care.",AB_VISION,"Elderly residents enjoying a warm social gathering indoors","sun",d=.1)}
    {card("Our Promise","We listen before we plan, keep families informed, and never stop adjusting care as your loved one's needs change.",AB_PROMISE,"A man and a woman standing together, smiling","hands",d=.2)}
  </div>
</div></section>

<section class="section"><div class="wrap">
  {sec_head("Our values","Four things we <em>never</em> compromise on")}
  <div class="mini-steps" data-stagger=".12">
    <div class="mini" data-reveal="up" data-draw><div class="ico-badge">{icon("award")}</div><h3>Dignity</h3><p>Privacy during personal care, choices respected, and every resident addressed with respect.</p></div>
    <div class="mini" data-reveal="up" data-draw><div class="ico-badge">{icon("shield")}</div><h3>Safety</h3><p>Supervision day and night, an emergency plan, and careful records for medications and care.</p></div>
    <div class="mini" data-reveal="up" data-draw><div class="ico-badge">{icon("chat")}</div><h3>Honesty</h3><p>Clear answers about care, costs and changes. Families hear from us, not just about us.</p></div>
    <div class="mini" data-reveal="up" data-draw><div class="ico-badge">{icon("sparkle")}</div><h3>Joy</h3><p>Music, conversation, sunshine on the porch and small moments that make a day good.</p></div>
  </div>
</div></section>

<section class="section grey"><div class="wrap feature rev">
  <div class="f-media" data-reveal="right"><div class="frame">{img(COORD,"A caregiver with a stethoscope listening to a patient's breathing")}</div></div>
  <div>
    <span class="eyebrow" data-reveal="up">Licensed &amp; accountable</span>
    <h2 data-split>Care you can <em>trust</em> and verify</h2>
    <div class="divider" data-reveal="left"></div>
    {checks(["Licensed and inspected by <b>Washington State DSHS</b> (license #{0})".format(S["license"]),
             "A written <b>Negotiated Care Plan</b> for every resident, reviewed at least yearly and whenever needs change",
             "<b>Nurse delegation</b> through a registered nurse for tasks that require it",
             "Caregivers who are <b>trained, background-checked</b> and supervised",
             "Residents' rights posted in the home, including how to reach the <b>Long-Term Care Ombuds</b>"])}
    <div class="btn-row" data-reveal="up">{btn("How Care Works","how-it-works.html")}</div>
  </div>
</div></section>
{cta("Meet us in person","There is no better way to know a home than to walk through it. We'd love to show you around.",OWN_STREET,"Street view of Harmony Living House in Chehalis")}
'''

# ───────────────────────── SERVICES ─────────────────────────
def svc(id_, title, text, bullets, image, alt, ico, d):
    lis = ''.join(f'<li>{b}</li>' for b in bullets)
    return f'''<article class="card" id="{id_}" data-reveal="up" data-draw style="--d:{d:.2f}s;scroll-margin-top:150px">
  <div class="card-media">{img(image, alt)}<span class="shine"></span></div>
  <div class="card-body"><div class="ico-badge">{icon(ico)}</div><h3>{title}</h3><p>{text}</p>
  <ul style="margin:6px 0 0 18px;font-size:.93rem;color:var(--ink-soft);display:grid;gap:4px">{lis}</ul></div>
</article>'''

services = page_hero("Services","Care &amp; services","Everything your loved one needs, <em>under one roof</em>",
  "From daily living assistance to total care, our services are built around one person at a time and adjusted whenever needs change.",
  SERV_HERO,"Caregiver helping an elderly couple with a coloring activity at a table") + f'''
<section class="section"><div class="wrap">
  {sec_head("What we provide","Ten ways we <em>care</em> every day","Every resident receives the services written into their personal care plan. Here is what that can include.")}
  <div class="grid g3">
    {svc("personal","Personal Care &amp; Daily Living","Respectful, hands-on help with the activities of daily living.",["Bathing, showering and grooming","Dressing and oral care","Toileting and continence care","Safe transfers and walking support"],PERSONAL,"Caregiver assisting an elderly woman using a walker","hands",0)}
    {svc("medication","Medication Management","Medications handled carefully and consistently.",["Given on schedule as prescribed","Daily medication records","Refills coordinated with your pharmacy","Changes communicated to family"],MEDS,"Person picking a pill from a weekly medicine organizer","pill",.1)}
    {svc("coordination","Health Monitoring &amp; Coordination","We keep everyone on the same page about health.",["Routine vital signs and weight","Doctor appointment scheduling","Updates to physicians and family","Nurse delegation when required"],HEALTH,"Healthcare worker in blue scrubs taking a woman's blood pressure","steth",.2)}
    {svc("meals","Meals &amp; Nutrition","Home-cooked food served at the family table.",["Three meals a day plus snacks","Menus shaped by preferences","Diet and texture per doctor's orders","Encouraging fluids and good appetite"],MEALS,"An elderly woman eating a meal at a round table by a window","utensils",0)}
    {svc("memory","Memory &amp; Dementia Support","Patient, structured support for memory loss.",["Calm, predictable routines","Gentle reminders and redirection","Visual cues around the home","Watchful supervision day and night"],MEMORY,"Seniors enjoying coffee and a jigsaw puzzle together","brain",.1)}
    {svc("social","Social &amp; Emotional Support","Connection is part of wellbeing.",["Conversation and companionship","Music, games, crafts and TV time","Porch time on pleasant days","Faith and cultural preferences honored"],ACTIVITY,"Older adults doing seated exercises with colorful balls in a bright room","users",.2)}
    {svc("housekeeping","Housekeeping &amp; Laundry","A clean, comfortable home without the chores.",["Daily tidying and sanitizing","Personal laundry and linens","Fresh bedding every week","Room kept the way residents like it"],HOUSEKEEP,"Freshly folded towels stacked on a neatly made bed","sparkle",0)}
    {svc("respite","Respite Stays","A break for family caregivers, when space allows.",["Short-term stays","Same care standards as long-term residents","Ideal after a hospital stay or during travel","Ask us about current availability"],RESPITE,"A cozy bedroom with a neatly made bed and soft light","bed",.1)}
    {svc("comfort","Comfort &amp; End-of-Life Care","Peace, comfort and presence in the final chapter.",["Comfort-focused personal care","Working alongside hospice providers","Family welcome to stay close","Quiet, dignified surroundings"],COMFORT,"Close-up of elderly hands gently clasped together","heart",.2)}
  </div>
  <div style="margin-top:40px">{hint("Good to know","Services are written into a Negotiated Care Plan that you, your loved one and our team agree on. If needs change, we update the plan, so care always matches the person.")}</div>
</div></section>

<section class="section tint"><div class="wrap feature">
  <div class="f-media" data-reveal="left"><div class="frame">{img(PERSONAL,"Caregiver walking beside an elderly woman who uses a walker")}</div>
    <div class="f-badge" data-reveal="up" style="--d:.4s"><div class="ico-badge" data-draw>{icon("clipboard")}</div><div><strong>Care plan</strong><span>Written for one person, never a template</span></div></div></div>
  <div>
    <span class="eyebrow" data-reveal="up">How we do it well</span>
    <h2 data-split>The details that make <em>great care</em></h2>
    <div class="divider" data-reveal="left"></div>
    {checks(["<b>We learn the person first.</b> Routines, food likes, life story and what calms them go into the plan.",
             "<b>Consistent caregivers.</b> Familiar faces build trust, especially for residents with memory loss.",
             "<b>Everything documented.</b> Care, medications and changes are recorded every shift.",
             "<b>Families kept informed.</b> You hear from us promptly about anything important.",
             "<b>Plans that keep up.</b> When needs change, we reassess and update care right away."])}
    <div class="btn-row" data-reveal="up">{btn("Book a Tour","contact.html")}{btn("Payment Options","payment.html","line","coins")}</div>
  </div>
</div></section>
{cta("Not sure what level of care is needed?","Tell us about your loved one. We'll talk through needs honestly and let you know if Harmony is the right fit.",OWN_TV,"Living room at Harmony Living House with sectional sofa and TV")}
'''

# ───────────────────────── HOW IT WORKS ─────────────────────────
def step(n, title, text, image, alt, extra=''):
    return f'''<article class="step" data-reveal="up">
  <div class="step-media">{img(image, alt)}</div>
  <div class="step-body"><span class="step-num" data-reveal="zoom">{n}</span><h3 data-split>{title}</h3><p data-reveal="blur">{text}</p>{extra}</div>
</article>'''

how = page_hero("How It Works","Your path to Harmony","Six calm steps from <em>first call</em> to home",
  "Choosing care can feel overwhelming. We make the process clear, unhurried and personal, and we're with you at every step.",
  HOW_HERO,"Two hands holding each other with care") + f'''
<section class="section"><div class="wrap"><div class="steps">
  {step("01","Reach out","Call, WhatsApp or email us. We'll ask about your loved one's health, daily needs, personality and routines, and answer your first questions about care and cost. There's no pressure and no obligation.",S_CALL,"A person holding a smartphone, ready to call",f'<div class="btn-row" style="margin-top:8px">{btn("Call "+S["phone"],"tel:"+S["tel"],"line","phone")}</div>')}
  {step("02","Tour the home","Visit Harmony Living House, see the living spaces, meet the caregivers and get a feel for daily life. Bring your loved one if you can: their comfort matters most.",OWN_WIDE,"Front of Harmony Living House with its covered porch and railed ramp")}
  {step("03","Assessment","We review your loved one's care needs. For Medicaid residents, this is based on the DSHS assessment completed with a case manager. For private pay, we gather information from you, the physician and any recent records.",S_ASSESS,"A health professional examining an older woman's arm")}
  {step("04","Paperwork &amp; disclosures","You'll receive our Disclosure of Charges, admission agreement and house policies to read before signing. We explain everything in plain language, with no surprises.",S_SIGN,"A couple reviewing and signing documents at a desk")}
  {step("05","Your care plan","Together we write a Negotiated Care Plan: how we'll help with each daily activity, medications, preferences and goals. The first full plan is completed within 30 days of move-in and updated whenever needs change.",COORD,"A caregiver listening carefully to a resident's health")}
  {step("06","Move-in &amp; settling in","We prepare the room, set up medications and plan a gentle first day. During the first weeks we check in with family often while your loved one settles into their new routine.",S_MOVE,"A family embracing one another warmly")}
</div></div></section>

<section class="section tint"><div class="wrap feature">
  <div>
    <span class="eyebrow" data-reveal="up">Move-in checklist</span>
    <h2 data-split>What to bring on <em>day one</em></h2>
    <div class="divider" data-reveal="left"></div>
    {checks(["Photo ID, insurance and Medicaid or Medicare cards",
             "A current medication list and any medications on hand",
             "Physician and pharmacy contact details",
             "Advance directive, POA or guardianship papers, if any",
             "Comfortable clothing labeled with your loved one's name",
             "Familiar things: photos, a favorite blanket or chair"])}
  </div>
  <div class="f-media" data-reveal="right"><div class="frame">{img(OWN_BED,"A resident bedroom with a made bed, nightstand and lamp")}</div></div>
</div></section>
<section class="section" style="padding-bottom:0"><div class="wrap">{hint("Site hint","Not sure whether your loved one qualifies for Medicaid-paid care? Start with our guide to paying for care in Washington on the Resources page.")}</div></section>
{cta("Ready for step one?","Call or message us today. We'll talk through your situation and arrange a time to visit.",OWN_SEAT,"Sunny seating corner on the back deck")}
'''

# ───────────────────────── OUR HOME (gallery) ─────────────────────────
GAL = [
 (OWN_WIDE,"Front of the home","A single-story blue home with crisp white trim and a covered front porch. A long ramp with white railings runs along the front of the house, so residents using walkers or wheelchairs can come and go easily. A wide green lawn sits in front, with tall evergreens behind.",
  "Blue single-story house with a covered porch and a long white-railed ramp, behind a green lawn"),
 (OWN_RAMP,"Ramp entrance &amp; garage","The corner view shows the gently sloped ramp up to the front porch, a concrete walkway along neat red-mulch beds, lantern-style lights and a two-car garage. Family visitors have easy parking right at the door.",
  "Corner of the blue house showing the house number 120, railed ramp, American flag and two-car garage"),
 (OWN_LIVING,"Living room","The heart of the home: a big open room with a cream reclining sectional, warm wood-look floors and bright recessed lighting. The dining table and kitchen sit just beyond, so residents are never far from company.",
  "Large open living room with a cream sectional sofa, wood-look floors, dining table and kitchen beyond"),
 (OWN_TV,"TV corner","Looking back across the living room from the TV wall. A wall-mounted TV for favorite shows, fresh flowers, natural light from the windows and a wall-mounted heating and cooling unit keep the space comfortable all year.",
  "Living room with a wall-mounted TV, flowers on a console, a cream sectional and the kitchen in the background"),
 (OWN_KITCHEN,"Kitchen &amp; dining","Home-cooked meals are made in this full kitchen with a large island, stainless appliances and a farmhouse sink, then served at the dining table under the chandelier. The wood-plank wall with family photos makes it feel like home.",
  "Open kitchen with white cabinets, island, stainless fridge and a dining table set beneath a chandelier"),
 (OWN_BED,"Resident bedroom","A calm, freshly painted bedroom with a sleigh bed, white quilt, nightstand and lamp, window blinds and soft overhead lighting. Residents are encouraged to bring photos and favorite things to make it their own.",
  "Bedroom with a dark wood sleigh bed, white bedding, nightstand with lamp and a window with blinds"),
 (OWN_BATH,"Bathroom","A bright bathroom with a long grey vanity, quartz counter, plenty of light, a wall cabinet and fresh towels. Caregivers assist with bathing here with privacy and dignity always respected.",
  "Bathroom with a grey vanity, large mirror, three-light fixture, white wall cabinet and towels"),
 (OWN_SHOWER,"Walk-in shower with grab bars","Designed for safe bathing: a walk-in shower with several sturdy grab bars, a handheld shower head on a slide bar, a built-in niche for toiletries and textured hexagon floor tile.",
  "Walk-in shower with black and white marble-look tile, multiple grab bars and a handheld shower head"),
 (OWN_DECK,"Back deck","A large back deck stretches across the rear of the house with white safety railings and sliding doors from inside, making it easy to step out for sunshine and fresh air.",
  "Wide back deck with white railings along the back of the blue house under a clear sky"),
 (OWN_UMBRELLA,"Shaded patio table","A big umbrella shades the outdoor table and chairs, perfect for coffee, lunch outside or a visit with family. A fire extinguisher is mounted close by.",
  "Outdoor table and white chairs under a large grey umbrella on the deck"),
 (OWN_SEAT,"Sunny seating corner","A quiet corner of the deck with chairs around a small table, a favorite spot to sit in the sun and chat.",
  "Four white chairs around a small round table on the deck beside the blue house"),
 (OWN_GATE,"Deck steps &amp; safety gate","Steps with handrails lead up to the deck, with a black safety gate at the top so the deck stays a secure space.",
  "Grey steps with white handrails leading to a black safety gate on the deck"),
 (OWN_GAZEBO,"View from the gazebo","From the backyard gazebo, strung with lights, you can see the whole deck. It's a lovely place for warm evenings and family gatherings.",
  "View through a wooden gazebo with string lights toward the gated deck"),
 (OWN_FRONT,"Evening at Harmony","The home at sunset, with the railed ramp, porch and mature trees and shrubs along the street.",
  "The blue house at sunset with a railed ramp, flag and landscaped trees"),
 (OWN_STREET,"Our quiet street","A calm residential street near Newaukum Golf Club and the Newaukum River, where neighbors walk their dogs in the evening.",
  "Street view of the house with a green lawn, garage and people walking a dog on the road"),
]
gal_items = ''.join(f'''<div class="g-item" tabindex="0" role="button" aria-label="Enlarge photo: {t}" data-caption="{t}: {alt}." data-reveal="up" style="--d:{(i%2)*0.12:.2f}s">
  <figure>{img(src, alt)}<span class="zoom">{sicon("expand")}</span></figure>
  <figcaption><h3>{t}</h3><p>{desc}</p></figcaption></div>''' for i,(src,t,desc,alt) in enumerate(GAL))

ourhome = page_hero("Our Home","Take a look around","A bright, single-level home made for <em>comfort</em>",
  "Real photos of Harmony Living House in Chehalis. Every space is designed to feel like home, not a facility.",
  OWN_KITCHEN,"Kitchen and dining area at Harmony Living House") + f'''
<section class="section"><div class="wrap">
  {sec_head("Photo gallery","Inside &amp; outside <em>Harmony</em>","Tap any photo to see it larger.")}
  <div class="gallery g3gal">{gal_items}</div>
</div></section>
<div class="lightbox" role="dialog" aria-label="Photo viewer"><button class="lb-close" type="button" aria-label="Close">{sicon("x")}</button><img class="lb-img" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""><p></p></div>

<section class="section tint"><div class="wrap">
  {sec_head("A day at Harmony","Gentle rhythms, <em>familiar</em> routines","No two days are identical, because they follow each resident. Here's what a typical day can look like.")}
  <div class="mini-steps" data-stagger=".12">
    <div class="mini" data-reveal="up" data-draw><div class="ico-badge">{icon("sun")}</div><h3>Morning</h3><p>Unhurried wake-ups, help with washing and dressing, morning medications and a warm breakfast.</p></div>
    <div class="mini" data-reveal="up" data-draw><div class="ico-badge">{icon("tea")}</div><h3>Midday</h3><p>Lunch at the table, conversation, music or a favorite show, and rest for those who like a nap.</p></div>
    <div class="mini" data-reveal="up" data-draw><div class="ico-badge">{icon("leaf")}</div><h3>Afternoon</h3><p>Visits from family, games, puzzles or porch time, plus snacks and plenty of fluids.</p></div>
    <div class="mini" data-reveal="up" data-draw><div class="ico-badge">{icon("moon")}</div><h3>Evening &amp; night</h3><p>Dinner, evening care and a calm bedtime, with caregivers awake and nearby all night.</p></div>
  </div>
</div></section>

<section class="section"><div class="wrap feature">
  <div>
    <span class="eyebrow" data-reveal="up">Comfort &amp; safety</span>
    <h2 data-split>Designed to feel safe, <em>not clinical</em></h2>
    <div class="divider" data-reveal="left"></div>
    {checks(["<b>Single-level living</b> with no stairs between bedroom, bathroom and living areas",
             "<b>Ramp entrance</b> with railings at the front door",
             "<b>Walk-in shower with grab bars</b> and a handheld shower head",
             "<b>Gated back deck</b> with safety railings",
             "<b>Caregivers on site 24/7</b>, including overnight",
             "<b>Emergency and evacuation plan</b> for every resident, as Washington requires",
             "<b>Open common areas</b> where staff can keep a gentle eye on everyone",
             "<b>Clean, bright rooms</b> that residents are encouraged to personalize"])}
    <div class="btn-row" data-reveal="up">{btn("Book an In-Person Tour","contact.html")}</div>
  </div>
  <div class="f-media" data-reveal="right"><div class="frame">{img(OWN_SHOWER,"Walk-in shower with grab bars")}</div></div>
</div></section>
<section class="section" style="padding-top:0;padding-bottom:0"><div class="wrap">{hint("Tour tip","Visit around a mealtime if you can. It's the best way to see how residents and caregivers interact, and to taste the food.")}</div></section>
{cta("Photos only tell half the story","Come and feel the atmosphere for yourself. Tours are by appointment, any day of the week.",OWN_GAZEBO,"Gazebo view of the back deck")}
'''

# ───────────────────────── PAYMENT ─────────────────────────
payment = page_hero("Payment &amp; Admissions","Paying for care","Clear options, <em>honest</em> answers",
  "Care is a big investment. We'll walk you through every payment option and share our full Disclosure of Charges before you decide anything.",
  PAY_HERO,"Two people reviewing documents together at a table") + f'''
<section class="section"><div class="wrap">
  {sec_head("Ways to pay","Options that <em>work</em> for families")}
  <div class="grid g3">
    {card("Washington Medicaid","We accept Medicaid. Eligibility and the care level are set through DSHS Home &amp; Community Services, and residents may pay a monthly participation amount toward care.",P_MEDICAID,"A person filling out paperwork with a pen","shield",tag="Accepted",d=0)}
    {card("Private Pay","Monthly rates depend on the level of care in the resident's plan. Private pay residents need at least 12 months of private funds before converting to Medicaid.",P_PRIVATE,"An advisor showing a document to a client","coins",tag="Accepted",d=.1)}
    {card("Long-Term Care Insurance","Many long-term care policies cover adult family homes. We'll provide the documentation your insurer needs to process claims.",P_LTC,"Two women reviewing and signing paperwork","file",d=.2)}
    {card("Veterans' Benefits","Veterans and surviving spouses may qualify for VA benefits, such as Aid &amp; Attendance, that can help with the cost of care.",P_VA,"A man holding an American flag","flag",d=0)}
    {card("WA Cares Fund","Since July 2026, eligible Washington workers can use WA Cares benefits toward care, including adult family homes. Ask us how it may apply to you.",P_WACARES,"A couple talking over coffee at a wooden table","heart",d=.1)}
    {card("Not sure yet?","Call us. We'll help you understand which options fit and point you to the right agency for the next step.",S_CALL,"Person holding a phone ready to make a call","phone","contact.html","Talk to us",d=.2)}
  </div>
</div></section>

<section class="section tint"><div class="wrap feature">
  <div>
    <span class="eyebrow" data-reveal="up">Documents</span>
    <h2 data-split>Read our policies <em>before</em> you decide</h2>
    <div class="divider" data-reveal="left"></div>
    <p data-reveal="blur">Washington requires every adult family home to give families a written disclosure of its charges and policies. Ours are available to download right now.</p>
    <div class="c-cards" style="margin-top:26px">
      <a class="c-card" href="documents/Harmony_DSHS_15-449_Disclosure_of_Charges.pdf" target="_blank" rel="noopener" data-reveal="left" data-draw><div class="ico-badge">{icon("file")}</div><div><small>DSHS 15-449 &middot; PDF</small><strong>Disclosure of Charges</strong></div></a>
      <a class="c-card" href="documents/Harmony_Private_Pay_Policy.pdf" target="_blank" rel="noopener" data-reveal="left" data-draw style="--d:.1s"><div class="ico-badge">{icon("file")}</div><div><small>House policy &middot; PDF</small><strong>Private Pay Policy</strong></div></a>
    </div>
  </div>
  <div>
    <span class="eyebrow" data-reveal="up">Admissions</span>
    <h2 data-split>What we need to <em>admit</em></h2>
    <div class="divider" data-reveal="left"></div>
    {checks(["A recent assessment of care needs (DSHS assessment for Medicaid residents)",
             "Physician information, current diagnoses and a medication list",
             "Signed admission agreement and acknowledgment of our disclosures",
             "Legal documents if applicable: POA, guardianship or advance directive",
             "Emergency contacts for family or representatives"])}
  </div>
</div></section>
<section class="section" style="padding-bottom:0"><div class="wrap">{hint("Helpful hint","If you're applying for Medicaid long-term care, contact your local DSHS Home &amp; Community Services office early. Approval can take several weeks, and we're happy to help you plan around it.")}</div></section>
{cta("Questions about cost?","We'll give you straight answers about rates and options. Call or write any time.",PAY_HERO,"Two people going over documents at a table")}
'''

PAGES_A = [
 ('index.html','Harmony Living House | Adult Family Home in Chehalis, WA','A Washington State licensed adult family home in Chehalis, WA offering 24/7 personal care, medication management, meals and memory support in a warm family home.',home,'Tap "Schedule a Tour" at any time to tell us when you would like to visit.'),
 ('about.html','About Us','Learn about Harmony Living House, a DSHS-licensed adult family home in Chehalis, WA, our mission, values and the people behind the care.',about,'You can download our Disclosure of Charges from the Payment &amp; Admissions page.'),
 ('services.html','Care & Services','Personal care, medication management, meals, memory support, health coordination, respite and comfort care at Harmony Living House in Chehalis, WA.',services,'Each service card opens a detailed list. Ask us about anything not shown here.'),
 ('how-it-works.html','How It Works','The six steps from your first call to move-in day at Harmony Living House adult family home in Chehalis, WA.',how,'Bring your questions to the tour. Nothing is too small to ask.'),
 ('our-home.html','Our Home','Photo gallery of Harmony Living House, a bright single-level adult family home in Chehalis, Washington.',ourhome,'Tap any photo to enlarge it and read its description.'),
 ('payment.html','Payment & Admissions','Medicaid, private pay, long-term care insurance, VA benefits and WA Cares at Harmony Living House adult family home in Chehalis, WA.',payment,'Our Disclosure of Charges PDF lists rates and what is included.'),
]
