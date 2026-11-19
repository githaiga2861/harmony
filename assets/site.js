/* Harmony Living House — public website interactions */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Split headings into animated words */
  document.querySelectorAll('[data-split]').forEach(function (el) {
    var i = 0;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            var w = document.createElement('span'); w.className = 'w';
            var s = document.createElement('span'); s.textContent = part; s.style.setProperty('--i', i++);
            w.appendChild(s); frag.appendChild(w);
          });
          n.parentNode.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') { walk(n); }
      });
    })(el);
    el.classList.add('split');
  });

  /* Stagger children */
  document.querySelectorAll('[data-stagger]').forEach(function (p) {
    var step = parseFloat(p.getAttribute('data-stagger')) || 0.12;
    Array.prototype.forEach.call(p.querySelectorAll(':scope > [data-reveal], :scope > * > [data-reveal]'), function (c, k) {
      if (!c.style.getPropertyValue('--d')) c.style.setProperty('--d', (k * step).toFixed(2) + 's');
    });
  });

  /* Enter / exit observer */
  var targets = document.querySelectorAll('[data-reveal],[data-split],[data-draw]');
  if (reduce || !('IntersectionObserver' in window)) {
    targets.forEach(function (t) { t.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var el = e.target;
        if (e.isIntersecting) { el.classList.remove('out-up'); el.classList.add('in'); }
        else if (e.boundingClientRect.top < 0) { el.classList.remove('in'); el.classList.add('out-up'); }
        else { el.classList.remove('in', 'out-up'); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    targets.forEach(function (t) { io.observe(t); });
  }

  /* Header + to-top */
  var header = document.querySelector('.site-header');
  var totop = document.querySelector('.totop');
  function onScroll() {
    var y = window.scrollY;
    if (header) header.classList.toggle('scrolled', y > 30);
    if (totop) totop.classList.toggle('show', y > 700);
  }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  if (totop) totop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); });

  /* Mobile drawer */
  var body = document.body;
  function setMenu(open) {
    body.classList.toggle('menu-open', open);
    var b = document.querySelector('.burger'); if (b) b.setAttribute('aria-expanded', open);
    document.documentElement.style.overflow = open ? 'hidden' : '';
  }
  document.querySelectorAll('[data-menu-open]').forEach(function (b) { b.addEventListener('click', function () { setMenu(!body.classList.contains('menu-open')); }); });
  document.querySelectorAll('[data-menu-close]').forEach(function (b) { b.addEventListener('click', function () { setMenu(false); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setMenu(false); closeLb(); } });
  document.querySelectorAll('.panel nav a').forEach(function (a, k) { a.style.transitionDelay = (0.08 + k * 0.04) + 's'; });

  /* Image fallback: soft gradient instead of broken image */
  document.querySelectorAll('img:not(.lb-img)').forEach(function (img) {
    img.addEventListener('error', function () {
      img.style.visibility = 'hidden';
      if (img.parentElement) img.parentElement.style.background = 'linear-gradient(135deg,#F6EDD3,#F3F2EF)';
    }, { once: true });
  });

  /* Site hint pop-up */
  var pop = document.querySelector('.hint-pop');
  if (pop) {
    var key = 'hlh-hint-' + (pop.getAttribute('data-key') || location.pathname);
    var seen = false; try { seen = sessionStorage.getItem(key) === '1'; } catch (e) {}
    if (!seen) setTimeout(function () { pop.classList.add('show'); }, 6000);
    var x = pop.querySelector('.x');
    if (x) x.addEventListener('click', function () { pop.classList.remove('show'); try { sessionStorage.setItem(key, '1'); } catch (e) {} });
    setTimeout(function () { pop.classList.remove('show'); }, 26000);
  }

  /* Lightbox */
  var lb = document.querySelector('.lightbox');
  var lbY = 0;
  function closeLb() {
    if (!lb || !lb.classList.contains('open')) return;
    lb.classList.remove('open');
    document.documentElement.classList.remove('lb-lock');
    document.body.style.position = ''; document.body.style.top = ''; document.body.style.width = '';
    window.scrollTo({ top: lbY, behavior: 'instant' });
  }
  if (lb) {
    var lbImg = lb.querySelector('img'), lbTxt = lb.querySelector('p');
    document.querySelectorAll('.g-item').forEach(function (g) {
      function open() {
        var im = g.querySelector('img');
        lbImg.src = im.currentSrc || im.src; lbImg.alt = im.alt;
        lbTxt.textContent = g.getAttribute('data-caption') || im.alt;
        lbY = window.scrollY;
        document.documentElement.classList.add('lb-lock');
        document.body.style.position = 'fixed'; document.body.style.top = (-lbY) + 'px'; document.body.style.width = '100%';
        lb.classList.add('open');
      }
      g.addEventListener('click', open);
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    lb.addEventListener('click', function (e) { if (e.target === lb || e.target.closest('.lb-close')) closeLb(); });
    lb.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    lb.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });
  }

  /* ── Supabase (public, insert-only for tour requests; read-only settings) ── */
  var SB_URL = 'https://gkmvglzjrsneqkrlvohp.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdrbXZnbHpqcnNuZXFrcmx2b2hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2OTU0NTMsImV4cCI6MjA5MDI3MTQ1M30.bcGB06-v9xmJmgkY-4KbnHPgi13qP7_ng-BJHifd0UY';
  function sb(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(SB_URL + '/rest/v1/' + path, opts);
  }

  /* Tour request form → saved for the team (email fallback) */
  var form = document.querySelector('#tour-form');
  if (form) {
    var started = Date.now();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = function (n) { var f = form.elements[n]; return f ? String(f.value || '').trim() : ''; };
      var name = v('name'), phone = v('phone'), email = v('email');
      var ok = form.querySelector('.form-ok'), btn = form.querySelector('button[type=submit]');
      if (!name || (!phone && !email)) { alert('Please enter your name and a phone number or email so we can reach you.'); return; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('Please check your email address.'); return; }
      if (v('website') || Date.now() - started < 2500) { form.reset(); ok.textContent = 'Thank you! We\'ll be in touch soon.'; ok.style.display = 'block'; return; } // spam trap
      var row = { name: name.slice(0, 120), phone: phone.slice(0, 40) || null, email: email.slice(0, 160) || null,
        inquiring_for: v('who').slice(0, 80) || null, interest: v('interest').slice(0, 80) || null,
        preferred_time: v('when').slice(0, 120) || null, message: v('message').slice(0, 4000) || null, page: location.pathname.slice(0, 120) };
      btn.disabled = true; btn.style.opacity = '.7';
      sb('website_inquiries', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) })
        .then(function (r) {
          if (!r.ok) throw new Error('save failed');
          form.reset();
          ok.innerHTML = '<b>Thank you, ' + name.split(' ')[0].replace(/[<>&"]/g, '') + '!</b> Your request has reached our team. We\'ll contact you soon to arrange your visit. For anything urgent, call (951) 446-7774.';
          ok.style.display = 'block';
        })
        .catch(function () {
          var lines = ['Name: ' + name, 'Phone: ' + phone, 'Email: ' + email, 'I am inquiring for: ' + (v('who') || '-'),
            'Care interest: ' + (v('interest') || 'General inquiry'), 'Preferred tour time: ' + (v('when') || '-'), '', v('message')];
          window.location.href = 'mailto:hello@harmonylivinghouse.com?subject=' + encodeURIComponent('Tour request from ' + name) + '&body=' + encodeURIComponent(lines.join('\n'));
          ok.textContent = 'We couldn\'t send the form just now, so your email app has opened with your message. Press send there, or call (951) 446-7774.';
          ok.style.display = 'block';
        })
        .then(function () { btn.disabled = false; btn.style.opacity = ''; });
    });
  }

  /* Announcement bar + availability, managed from the staff portal */
  sb('website_settings?select=key,value').then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
    var S = {}; (rows || []).forEach(function (x) { S[x.key] = x.value || ''; });
    var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    if (S.announcement_enabled === 'true' && S.announcement_text) {
      var bar = document.createElement('div'); bar.className = 'announce';
      bar.innerHTML = '<div class="wrap"><span>' + esc(S.announcement_text) + '</span><a href="contact">Contact us</a></div>';
      document.body.insertBefore(bar, document.body.firstChild);
    }
    var labels = { accepting: 'Now accepting new residents', limited: 'Limited availability, call us', waitlist: 'Currently full, join our waitlist' };
    var st = S.availability_status;
    if (labels[st]) {
      document.querySelectorAll('[data-availability]').forEach(function (slot) {
        slot.innerHTML = '<span class="avail avail-' + st + '"><i></i>' + esc(labels[st]) + (S.availability_note ? ' &middot; ' + esc(S.availability_note) : '') + '</span>';
      });
    }
  }).catch(function () {});

  /* Keep the hero name on one line */
  function fitName() {
    document.querySelectorAll('.hero-name').forEach(function (el) {
      el.style.fontSize = '';
      var size = parseFloat(getComputedStyle(el).fontSize), guard = 0;
      while (el.scrollWidth > el.clientWidth + 1 && guard++ < 40) { size -= 1; el.style.fontSize = size + 'px'; }
    });
  }
  fitName(); window.addEventListener('resize', fitName);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitName);

  /* Year */
  document.querySelectorAll('[data-year]').forEach(function (y) { y.textContent = new Date().getFullYear(); });
})();
