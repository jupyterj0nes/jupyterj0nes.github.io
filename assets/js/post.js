/* We Investigate Anything: reading aids for inner pages.
   Progress bar, table of contents, code block headers with a copy button,
   callouts, image lightbox and reveal-on-scroll. No dependencies. */
(function () {
  'use strict';
  var lang = (document.documentElement.getAttribute('lang') || 'es').slice(0, 2);
  var T = lang === 'en'
    ? { copy: 'Copy', copied: 'Copied', toc: 'On this page', close: 'Close', console: 'console' }
    : { copy: 'Copiar', copied: 'Copiado', toc: 'En esta página', close: 'Cerrar', console: 'consola' };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  /* ---- code blocks: a header with the language and a copy button ---- */
  function codeBlocks(root) {
    var blocks = root.querySelectorAll('div.highlighter-rouge');
    Array.prototype.forEach.call(blocks, function (b) {
      if (b.querySelector('.code-head')) return;
      var m = /language-([\w+-]+)/.exec(b.className);
      var name = m ? m[1] : '';
      if (name === 'plaintext' || name === 'text' || name === '') name = T.console;
      var head = el('div', 'code-head');
      var dots = el('span', 'code-dots');
      dots.appendChild(el('i')); dots.appendChild(el('i')); dots.appendChild(el('i'));
      head.appendChild(dots);
      head.appendChild(el('span', 'code-lang', name));
      var btn = el('button', 'code-copy', T.copy);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        var pre = b.querySelector('pre');
        var text = pre ? pre.innerText.replace(/\n$/, '') : '';
        var done = function () {
          btn.textContent = T.copied; btn.classList.add('ok');
          setTimeout(function () { btn.textContent = T.copy; btn.classList.remove('ok'); }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () {});
        } else {
          var ta = el('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (e) {}
          document.body.removeChild(ta);
        }
      });
      head.appendChild(btn);
      b.insertBefore(head, b.firstChild);
      b.classList.add('code-block');
    });
  }

  /* ---- callouts: a paragraph that opens with a bold warning word ---- */
  var CALL = [
    [/^(ojo|cuidado|atenci[oó]n|aviso|importante|careful|warning|caution|important|watch out|mind)/i, 'warn'],
    [/^(nota|un detalle|detalle|note|a detail|one detail)/i, 'note'],
    [/^(consejo|truco|tip|hint)/i, 'tip']
  ];
  function callouts(root) {
    var ps = root.querySelectorAll(':scope > p');
    Array.prototype.forEach.call(ps, function (p) {
      var first = p.firstChild;
      if (!first || first.nodeType !== 1 || first.tagName !== 'STRONG') return;
      var t = first.textContent.trim();
      for (var i = 0; i < CALL.length; i++) {
        if (CALL[i][0].test(t)) { p.classList.add('callout', 'callout-' + CALL[i][1]); return; }
      }
    });
  }

  /* ---- images: open full size on click ---- */
  function lightbox(root) {
    var imgs = root.querySelectorAll('img');
    if (!imgs.length) return;
    var box = el('div', 'lightbox');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    var big = el('img');
    var cap = el('p', 'lightbox-cap');
    var x = el('button', 'lightbox-x', '×');
    x.type = 'button'; x.setAttribute('aria-label', T.close);
    box.appendChild(big); box.appendChild(cap); box.appendChild(x);
    document.body.appendChild(box);
    function close() { box.classList.remove('open'); document.documentElement.classList.remove('noscroll'); }
    box.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    Array.prototype.forEach.call(imgs, function (img) {
      if (img.closest('.post-hero')) return;
      img.classList.add('zoomable');
      var target = img.closest('a') || img;
      target.addEventListener('click', function (e) {
        var a = img.closest('a');
        var href = a ? a.getAttribute('href') : '';
        if (a && !/\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(href)) return; // a real link
        e.preventDefault();
        big.src = href || img.currentSrc || img.src;
        big.alt = img.alt || '';
        cap.textContent = img.alt || '';
        box.classList.add('open');
        document.documentElement.classList.add('noscroll');
      });
    });
  }

  /* ---- table of contents + reading progress ---- */
  function slug(s) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function toc(root) {
    var hs = root.querySelectorAll(':scope > h2');
    if (hs.length < 3) return;
    var nav = el('nav', 'toc');
    nav.setAttribute('aria-label', T.toc);
    nav.appendChild(el('p', 'toc-title', T.toc));
    var ul = el('ul');
    var links = [];
    Array.prototype.forEach.call(hs, function (h) {
      if (!h.id) h.id = slug(h.textContent);
      var li = el('li');
      var a = el('a', '', h.textContent);
      a.href = '#' + h.id;
      li.appendChild(a); ul.appendChild(li);
      links.push([h, a]);
    });
    nav.appendChild(ul);
    document.body.appendChild(nav);
    function mark() {
      var y = window.scrollY + 140, cur = null;
      for (var i = 0; i < links.length; i++) if (links[i][0].offsetTop <= y) cur = links[i][1];
      for (var j = 0; j < links.length; j++) links[j][1].classList.toggle('on', links[j][1] === cur);
      var top = root.getBoundingClientRect().top + window.scrollY;
      var end = top + root.offsetHeight;
      nav.classList.toggle('show', window.scrollY > top - 200 && window.scrollY < end - 300);
    }
    window.addEventListener('scroll', mark, { passive: true });
    window.addEventListener('resize', mark);
    mark();
  }
  function progress(root) {
    var bar = el('div', 'read-progress');
    var fill = el('span');
    bar.appendChild(fill);
    document.body.appendChild(bar);
    function upd() {
      var top = root.getBoundingClientRect().top + window.scrollY;
      var len = root.offsetHeight - window.innerHeight * 0.6;
      var p = len > 0 ? (window.scrollY - top + 120) / len : 0;
      p = Math.max(0, Math.min(1, p));
      fill.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    }
    window.addEventListener('scroll', upd, { passive: true });
    window.addEventListener('resize', upd);
    upd();
  }

  /* ---- reveal on scroll ---- */
  function reveal() {
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var items = document.querySelectorAll('.hub-group, .tool-card, .post-content > h2, .post-related, .post-nav');
    if (!items.length) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    var vh = window.innerHeight;
    Array.prototype.forEach.call(items, function (it) {
      if (it.getBoundingClientRect().top < vh) return; // already on screen: leave alone
      it.classList.add('reveal');
      io.observe(it);
    });
  }

  ready(function () {
    var post = document.querySelector('.post-content');
    var page = document.querySelector('.page-content');
    var body = post || page;
    if (body) codeBlocks(document);
    if (post) { callouts(post); lightbox(post); toc(post); progress(post); }
    else if (page) { lightbox(page); }
    reveal();
  });
})();
