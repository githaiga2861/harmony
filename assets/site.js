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
  document.querySelectorAll('img').forEach(function (img) {
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
  function closeLb() { if (lb) lb.classList.remove('open'); }
  if (lb) {
    var lbImg = lb.querySelector('img'), lbTxt = lb.querySelector('p');
    document.querySelectorAll('.g-item').forEach(function (g) {
      function open() {
        var im = g.querySelector('img');
        lbImg.src = im.src; lbImg.alt = im.alt;
        lbTxt.textContent = g.getAttribute('data-caption') || im.alt;
        lb.classList.add('open');
      }
      g.addEventListener('click', open);
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    lb.addEventListener('click', function (e) { if (e.target === lb || e.target.closest('.lb-close')) closeLb(); });
  }

  /* Contact form → opens email */
  var form = document.querySelector('#tour-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = function (n) { var f = form.elements[n]; return f ? String(f.value || '').trim() : ''; };
      var name = v('name'), phone = v('phone'), email = v('email');
      if (!name || (!phone && !email)) { alert('Please enter your name and a phone number or email so we can reach you.'); return; }
      var lines = ['Name: ' + name, 'Phone: ' + phone, 'Email: ' + email, 'I am inquiring for: ' + (v('who') || '-'),
        'Care interest: ' + (v('interest') || 'General inquiry'), 'Preferred tour time: ' + (v('when') || '-'), '', v('message')];
      window.location.href = 'mailto:hello@harmonylivinghouse.com?subject=' + encodeURIComponent('Tour request from ' + name) + '&body=' + encodeURIComponent(lines.join('\n'));
      var ok = form.querySelector('.form-ok'); if (ok) ok.style.display = 'block';
    });
  }

  /* Year */
  document.querySelectorAll('[data-year]').forEach(function (y) { y.textContent = new Date().getFullYear(); });
})();
