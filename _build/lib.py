"""Shared template, icons and components for the Harmony Living House website.
Run:  python3 _build/build.py   (from the repo root) to regenerate every public page.
"""
import re, html

SITE = {
    'name': 'Harmony Living House',
    'phone': '(951) 446-7774', 'tel': '+19514467774',
    'email': 'hello@harmonylivinghouse.com',
    'addr1': '120 Newaukum Village Dr', 'addr2': 'Chehalis, WA 98532',
    'wa': 'https://wa.me/19514467774',
    'fb': 'https://www.facebook.com/harmonylivinghouse',
    'license': '758581',
    'maps': 'https://www.google.com/maps/search/?api=1&query=120+Newaukum+Village+Dr+Chehalis+WA+98532',
}

# ── Line icons (24x24). Every shape gets pathLength=1 so it can "draw" in. ──
ICONS = {
 'arrow':'<path d="M5 12h14M13 6l6 6-6 6"/>',
 'chev':'<path d="M6 9l6 6 6-6"/>',
 'chev-r':'<path d="M9 6l6 6-6 6"/>',
 'up':'<path d="M12 19V5M6 11l6-6 6 6"/>',
 'plus':'<path d="M12 5v14M5 12h14"/>',
 'x':'<path d="M6 6l12 12M18 6L6 18"/>',
 'phone':'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
 'mail':'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/>',
 'pin':'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
 'clock':'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
 'shield':'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
 'check':'<circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
 'heart':'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
 'hands':'<path d="M11 14h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16"/><path d="M7 20l1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.8-2.8l-4.2 3.9"/><path d="M2 15l6 6"/><path d="M19.5 8.5c.7-.7 1.5-1.6 1.5-2.7A2.7 2.7 0 0 0 16 4a2.7 2.7 0 0 0-5 1.8c0 1.2.8 2 1.5 2.8L16 12z"/>',
 'pill':'<path d="M10.5 20.5l10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7z"/><path d="M8.5 8.5l7 7"/>',
 'steth':'<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 12 0V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 12 0v-4"/><circle cx="20" cy="10" r="2"/>',
 'utensils':'<path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3v7"/>',
 'brain':'<path d="M12 5a3 3 0 1 0-6 .1 4 4 0 0 0-2.5 5.8 4 4 0 0 0 .6 6.6A4 4 0 1 0 12 18z"/><path d="M12 5a3 3 0 1 1 6 .1 4 4 0 0 1 2.5 5.8 4 4 0 0 1-.6 6.6A4 4 0 1 1 12 18z"/><path d="M12 5v13"/>',
 'users':'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
 'home':'<path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
 'sparkle':'<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
 'bed':'<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>',
 'clipboard':'<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/>',
 'calendar':'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
 'file':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
 'coins':'<circle cx="8" cy="8" r="6"/><path d="M18.1 10.4A6 6 0 1 1 10.3 18"/><path d="M7 6h1v4"/>',
 'leaf':'<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.4 5.1-6"/>',
 'sun':'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
 'moon':'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
 'bulb':'<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>',
 'award':'<circle cx="12" cy="8" r="6"/><path d="M15.5 13.5L17 22l-5-3-5 3 1.5-8.5"/>',
 'key':'<circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
 'book':'<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
 'brief':'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
 'grad':'<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
 'compass':'<circle cx="12" cy="12" r="10"/><path d="M16.2 7.8l-2.1 6.4-6.4 2.1 2.1-6.4z"/>',
 'chat':'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
 'search':'<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>',
 'cross':'<path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z"/>',
 'star':'<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
 'expand':'<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
 'tea':'<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v2M10 2v2M14 2v2"/>',
 'lock':'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
 'flag':'<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
 'walker':'<circle cx="12" cy="4" r="2"/><path d="M10 22l1-7-2-3 1-4h3l2 4 3 1M9 12l-2 3M16 13v9M19 13v9"/>',
 'mapfold':'<path d="M9 3L3 6v15l6-3 6 3 6-3V3l-6 3z"/><path d="M9 3v15M15 6v15"/>',
 'eye':'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
 'bath':'<path d="M4 12h16a1 1 0 0 1 1 1v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-2a1 1 0 0 1 1-1z"/><path d="M6 12V5a2 2 0 0 1 4 0M6 20l-1 2M18 20l1 2"/>',
 'music':'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
 'church':'<path d="M12 2v6M9 5h6M5 22V12l7-4 7 4v10"/><path d="M10 22v-4a2 2 0 0 1 4 0v4"/>',
 'quote':'<path d="M3 21c3 0 7-1 7-8V5H3v8h4M14 21c3 0 7-1 7-8V5h-7v8h4"/>',
}

def icon(name, cls='ico', draw=True):
    body = ICONS[name]
    if draw:
        body = re.sub(r'<(path|circle|rect)\b', r'<\1 pathLength="1"', body)
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true">{body}</svg>'

def sicon(name):
    """Small plain stroke icon for UI (no draw-in)."""
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>'

SOCIAL_SVG = {
 'facebook':'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14 8.5V6.8c0-.8.5-1.3 1.4-1.3H17V2.2h-2.6C11.6 2.2 10.6 4 10.6 6.5v2H8v3.3h2.6V22H14V11.8h2.6l.5-3.3z"/></svg>',
 'whatsapp':'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.8-1.3A9.5 9.5 0 1 0 12 2.5z"/><path fill="currentColor" d="M8.7 7.7c.2-.4.4-.4.7-.4h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .6l-.5.7c-.1.2-.2.4 0 .6.4.8 1 1.5 1.7 2.1.7.6 1.4.9 1.8 1.1.2.1.4.1.6-.1l.7-.9c.2-.2.4-.2.6-.1l1.8.9c.2.1.4.2.4.4.1.3 0 1.2-.5 1.7-.5.5-1.3.9-2.1.8-.8 0-2.6-.6-4.3-2.2-1.7-1.6-2.6-3.4-2.8-4.2-.2-.8.1-1.7.4-2z"/></svg>',
 'mail':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/></svg>',
 'phone':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+ICONS['phone']+'</svg>',
}

def social(cls=''):
    items = [('whatsapp', SITE['wa'], 'Message us on WhatsApp', True),
             ('mail', 'mailto:'+SITE['email'], 'Email us', False),
             ('phone', 'tel:'+SITE['tel'], 'Call us', False)]
    out = []
    for i,(k,href,label,ext) in enumerate(items):
        tgt = ' target="_blank" rel="noopener"' if ext else ''
        rv = f' data-reveal="zoom" style="--d:{i*0.08:.2f}s"' if cls == 'lg' else ''
        out.append(f'<a href="{href}" aria-label="{label}"{tgt}{rv}>{SOCIAL_SVG[k]}</a>')
    return f'<div class="social {cls}">{"".join(out)}</div>'

def U(pid, w=1200):
    return f'https://images.unsplash.com/photo-{pid}?auto=format&fit=crop&w={w}&q=80'

def img(src, alt, cls='', eager=False, w=1200):
    if not src.startswith(('http', 'assets/')):
        src = U(src, w)
    load = 'eager' if eager else 'lazy'
    c = f' class="{cls}"' if cls else ''
    return f'<img src="{src}" alt="{html.escape(alt)}" loading="{load}" decoding="async"{c}>'

# ── Components ──
def card(title, text, image, alt, ico, href=None, link='Learn more', tag=None, d=0):
    tagh = f'<span class="tag">{tag}</span>' if tag else ''
    linkh = f'<a class="card-link" href="{href}">{link} {sicon("arrow")}</a>' if href else ''
    return f'''<article class="card" data-reveal="up" data-draw style="--d:{d:.2f}s">
  <div class="card-media">{img(image, alt)}<span class="shine"></span>{tagh}</div>
  <div class="card-body"><div class="ico-badge">{icon(ico)}</div>
    <h3>{title}</h3><p>{text}</p>{linkh}</div>
</article>'''

def tile(title, text, image, alt, ico, d=0):
    return f'''<article class="tile" data-reveal="up" data-draw style="--d:{d:.2f}s">{img(image, alt)}
  <div class="tile-body"><div class="ico-badge">{icon(ico)}</div><h3>{title}</h3><p>{text}</p></div>
</article>'''

def hint(title, text):
    return f'<aside class="hint" data-reveal="up">{sicon("bulb")}<div><b>{title}</b><p>{text}</p></div></aside>'

def checks(items):
    lis = ''.join(f'<li data-reveal="left" style="--d:{i*0.08:.2f}s">{sicon("check")}<span>{t}</span></li>' for i,t in enumerate(items))
    return f'<ul class="checks">{lis}</ul>'

def faq(items):
    out = []
    for i,(q,a) in enumerate(items):
        out.append(f'<details data-reveal="up" style="--d:{min(i,6)*0.06:.2f}s"><summary>{q}<span class="pm">{sicon("plus")}</span></summary><div class="ans"><p>{a}</p></div></details>')
    return '<div class="faq">' + ''.join(out) + '</div>'

def sec_head(eyebrow, title, lead='', center=True):
    c = ' center' if center else ''
    l = f'<p class="lead" data-reveal="blur" style="--d:.2s">{lead}</p>' if lead else ''
    return f'<div class="sec-head{c}"><span class="eyebrow" data-reveal="up">{eyebrow}</span><h2 data-split>{title}</h2>{l}</div>'

def btn(label, href, kind='gold', ico='arrow', ext=False):
    t = ' target="_blank" rel="noopener"' if ext else ''
    return f'<a class="btn btn-{kind}" href="{href}"{t}>{label} {sicon(ico)}</a>'

def cta(title, text, image, alt):
    return f'''<section class="section"><div class="wrap"><div class="cta" data-reveal="zoom">{img(image, alt)}
  <span class="eyebrow" data-reveal="up">Come see for yourself</span>
  <h2 data-split>{title}</h2>
  <p class="lead" data-reveal="blur">{text}</p>
  <div class="btn-row" data-reveal="up">{btn("Schedule a Tour","contact.html")}{btn("Call "+SITE["phone"],"tel:"+SITE["tel"],"line","phone")}</div>
</div></div></section>'''

def page_hero(crumb, eyebrow, title, lead, image, alt):
    return f'''<section class="page-hero"><div class="bg">{img(image, alt, eager=True, w=1800)}</div>
<div class="wrap">
  <nav class="crumbs" aria-label="Breadcrumb" data-reveal="down"><a href="index.html">Home</a>{sicon("chev-r")}<span>{crumb}</span></nav>
  <span class="eyebrow" data-reveal="up" style="--d:.1s">{eyebrow}</span>
  <h1 data-split style="--d:.15s">{title}</h1>
  <p class="lead" data-reveal="blur" style="--d:.45s">{lead}</p>
</div></section>'''

# ── Navigation ──
NAV = [
  ('Home', 'index.html', 'home', None),
  ('About', 'about.html', 'heart', None),
  ('Care & Services', None, 'hands', [
      ('Our Services', 'services.html', 'hands'),
      ('How It Works', 'how-it-works.html', 'compass'),
      ('Payment & Admissions', 'payment.html', 'coins')]),
  ('Our Home', 'our-home.html', 'eye', None),
  ('Resources', None, 'book', [
      ('Guides & Articles', 'resources.html', 'book'),
      ('FAQs', 'faqs.html', 'chat'),
      ('Careers', 'careers.html', 'brief')]),
  ('Contact', 'contact.html', 'mail', None),
]

def nav_html(active):
    out = []
    for label, href, ic, kids in NAV:
        if kids:
            cur = any(k[1] == active for k in kids)
            sub = ''.join(f'<a href="{h}"{" aria-current=page" if h==active else ""}>{sicon(i)}{l}</a>' for l,h,i in kids)
            out.append(f'<li class="has-drop"><button type="button" aria-haspopup="true"{" style=color:var(--gold-deep)" if cur else ""}>{label}{sicon("chev").replace("<svg","<svg class=chev",1)}</button><div class="drop">{sub}</div></li>')
        else:
            out.append(f'<li><a href="{href}"{" aria-current=page" if href==active else ""}>{label}</a></li>')
    return '<ul class="nav">' + ''.join(out) + '</ul>'

def drawer_links(active):
    flat = []
    for label, href, ic, kids in NAV:
        if kids: flat += [(l,h,i) for l,h,i in kids]
        else: flat.append((label, href, ic))
    return ''.join(f'<a href="{h}"{" aria-current=page" if h==active else ""}>{sicon(i)}{l}</a>' for l,h,i in flat)

HINTS = {}

def layout(slug, title, desc, content, hint_pop=None):
    s = SITE
    hp = ''
    if False:
        hp = f'<div class="hint-pop" role="status" data-key="{slug}"><div class="hp-ico">{sicon("bulb")}</div><div><b>Site hint</b><p>{hint_pop}</p></div><button class="x" type="button" aria-label="Dismiss hint">{sicon("x")}</button></div>'
    full_title = title if slug == 'index.html' else f'{title} | Harmony Living House'
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{html.escape(full_title)}</title>
<meta name="description" content="{html.escape(desc)}">
<meta name="theme-color" content="#FBF8F1">
<meta property="og:title" content="{html.escape(full_title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:image" content="https://harmonylivinghouse.com/assets/img/home/exterior-front.jpg">
<meta property="og:type" content="website">
<link rel="icon" href="favicon.ico">
<link rel="apple-touch-icon" href="harmony_living_house_logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://images.unsplash.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Jost:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="topbar"><div class="wrap">
  <div class="tb-left">
    <a class="tb-phone" href="tel:{s['tel']}">{sicon('phone')}{s['phone']}</a>
  </div>
  <div class="tb-right">
    <a class="tb-extra" href="mailto:{s['email']}">{sicon('mail')}{s['email']}</a>
    <a class="tb-extra" href="{s['maps']}" target="_blank" rel="noopener">{sicon('pin')}{s['addr1']}, Chehalis</a>
    {social()}
  </div>
</div></div>
<header class="site-header"><div class="wrap">
  <a class="brand" href="index.html" aria-label="Harmony Living House home"><img src="assets/img/logo.png" alt="Harmony Living House Adult Family Home logo" width="385" height="300"></a>
  <nav aria-label="Main">{nav_html(slug)}</nav>
  <div class="header-cta">
    {btn('Schedule a Tour','contact.html')}
    <button class="burger" type="button" aria-label="Open menu" aria-expanded="false" data-menu-open><span></span></button>
  </div>
</div></header>
<div class="drawer" aria-hidden="false">
  <div class="scrim" data-menu-close></div>
  <div class="panel" role="dialog" aria-label="Menu">
    <div class="panel-top"><img src="assets/img/logo.png" alt="Harmony Living House"><button class="panel-close" type="button" aria-label="Close menu" data-menu-close>{sicon('x')}</button></div>
    <nav>{drawer_links(slug)}</nav>
    <div class="panel-foot">{btn('Schedule a Tour','contact.html')}{btn('Call '+s['phone'],'tel:'+s['tel'],'line','phone')}{social()}</div>
  </div>
</div>
<main id="main">
{content}
</main>
<footer class="footer"><div class="wrap">
  <div class="f-grid">
    <div class="f-brand" data-reveal="up">
      <img src="assets/img/logo.png" alt="Harmony Living House Adult Family Home logo" loading="lazy">
      <p>A Washington State licensed adult family home in Chehalis, where every resident is cared for like family, around the clock.</p>
      {social('lg')}
    </div>
    <div class="f-col" data-reveal="up" style="--d:.1s"><h4>Explore</h4><ul>
      <li><a href="about.html">About Us</a></li><li><a href="services.html">Our Services</a></li><li><a href="how-it-works.html">How It Works</a></li><li><a href="our-home.html">Our Home</a></li><li><a href="payment.html">Payment &amp; Admissions</a></li></ul></div>
    <div class="f-col" data-reveal="up" style="--d:.2s"><h4>Help</h4><ul>
      <li><a href="resources.html">Guides &amp; Articles</a></li><li><a href="faqs.html">FAQs</a></li><li><a href="careers.html">Careers</a></li><li><a href="contact.html">Contact</a></li><li><a href="staff.html">Staff Login</a></li></ul></div>
    <div class="f-col" data-reveal="up" style="--d:.3s"><h4>Visit &amp; Call</h4><ul class="f-contact">
      <li>{sicon('pin')}<a href="{s['maps']}" target="_blank" rel="noopener">{s['addr1']}<br>{s['addr2']}</a></li>
      <li>{sicon('phone')}<a href="tel:{s['tel']}">{s['phone']}</a></li>
      <li>{sicon('mail')}<a href="mailto:{s['email']}">{s['email']}</a></li>
      <li>{sicon('clock')}<span>Caregivers on site 24/7<br>Tours by appointment</span></li></ul>
      <p class="f-near">{sicon('leaf')}<span>Next to <b>Newaukum Golf Club</b> and the <b>Newaukum River</b>, in a quiet Chehalis neighborhood.</span></p>
      <div class="f-map"><iframe title="Small map of Harmony Living House near Newaukum Golf Club, Chehalis WA" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=120%20Newaukum%20Village%20Dr%2C%20Chehalis%2C%20WA%2098532&z=14&output=embed"></iframe></div></div>
  </div>
  <div class="f-bottom"><span>&copy; <span data-year>2026</span> Harmony Living House Adult Family Home LLC. All rights reserved.</span><span>Licensed by Washington State DSHS &middot; Adult Family Home License #{s['license']}</span></div>
</div></footer>
<nav class="mbar" aria-label="Quick actions">
  <a href="tel:{s['tel']}">{sicon('phone')}Call</a>
  <a href="{s['wa']}" target="_blank" rel="noopener">{SOCIAL_SVG['whatsapp']}WhatsApp</a>
  <a class="go" href="contact.html">{sicon('calendar')}Book a Tour</a>
</nav>
<button class="totop" type="button" aria-label="Back to top">{sicon('up')}</button>
{hp}
<script src="assets/site.js" defer></script>
</body>
</html>
'''
