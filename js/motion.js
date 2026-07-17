/* Vanta Exotic Auto Repair: scroll motion engine.
   One rAF loop drives every pinned scene. GSAP (CDN) powers component
   flourishes (magnetic CTA); the pin/scrub core stays hand-rolled per
   SCROLLSITEPLAYBOOK section 2. */

(function () {
  'use strict';

  var docEl = document.documentElement;
  docEl.classList.add('js');

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    docEl.classList.add('reduced');
    return;
  }

  /* ---------- helpers ---------- */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fade(p, a, b) { return clamp((p - a) / (b - a), 0, 1); }

  /* Piecewise-linear remap: scroll progress in, video time out.
     Slow / fast / slow pacing lives here. */
  function remap(p, table) {
    if (p <= table[0][0]) return table[0][1];
    for (var i = 1; i < table.length; i++) {
      if (p <= table[i][0]) {
        var a = table[i - 1], b = table[i];
        return a[1] + (b[1] - a[1]) * ((p - a[0]) / ((b[0] - a[0]) || 1));
      }
    }
    return table[table.length - 1][1];
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------- momentum scroll (desktop wheel only) ---------- */

  var finePointer = window.matchMedia('(pointer: fine)').matches;
  var target = window.scrollY;
  var current = target;

  function maxScroll() { return docEl.scrollHeight - window.innerHeight; }

  if (finePointer) {
    docEl.classList.add('momentum');

    window.addEventListener('wheel', function (e) {
      e.preventDefault();
      var d = e.deltaY;
      if (e.deltaMode === 1) d *= 16;
      else if (e.deltaMode === 2) d *= window.innerHeight;
      target = clamp(target + d * 1.1, 0, maxScroll());
    }, { passive: false });

    window.addEventListener('scroll', function () {
      if (Math.abs(window.scrollY - current) > 2) {
        target = current = window.scrollY;
      }
    });

    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute('href').slice(1);
      if (!id) { e.preventDefault(); return; }
      var el = document.getElementById(id);
      if (el) {
        e.preventDefault();
        target = clamp(el.getBoundingClientRect().top + window.scrollY, 0, maxScroll());
      }
    });
  }

  /* ---------- video scrubbing ---------- */

  function makeFilm(video) {
    if (!video) return null;
    var film = { el: video, vt: 0, missing: false };
    video.load();
    var src = video.querySelector('source');
    (src || video).addEventListener('error', function () {
      film.missing = true;
      var pinEl = video.closest('[data-pin]');
      if (pinEl) pinEl.classList.add('film-missing');
    });
    return film;
  }

  /* All four guards exist because their absence caused visible stutter */
  function seekFilm(film, t01, reverse) {
    if (!film) return;
    var el = film.el;
    if (el.readyState < 1 || !el.duration) return;
    var t = (reverse ? 1 - t01 : t01) * (el.duration - 0.05);
    film.vt += (t - film.vt) * 0.3;
    if (el.seeking) return;
    var delta = Math.abs(el.currentTime - film.vt);
    if (delta < 1 / 60) return;
    if (delta > 0.5 && typeof el.fastSeek === 'function') el.fastSeek(film.vt);
    else el.currentTime = film.vt;
  }

  /* ---------- pins ---------- */

  var pins = $$('[data-pin]').map(function (el) {
    var pin = { el: el, name: el.getAttribute('data-pin-name'), films: {} };
    $$('video[data-film]', el).forEach(function (v) {
      pin.films[v.getAttribute('data-film')] = makeFilm(v);
    });
    return pin;
  });

  /* Per-clip pacing tables: [scroll fraction, video time fraction]. */
  var PACE = {
    pan:    [[0, 0], [0.25, 0.10], [0.70, 0.85], [1, 1]],
    morph:  [[0, 0], [0.20, 0.10], [0.75, 0.90], [1, 1]],
    dive:   [[0, 0], [0.30, 0.12], [0.85, 0.95], [1, 1]],
    warp:   [[0, 0], [0.45, 0.30], [0.75, 0.55], [1, 1]],
    /* emerge: linger inside the bulb early (macro detail crawl), then let
       the pull-back accelerate, settling softly onto the signature */
    emerge: [[0, 0], [0.4, 0.18], [0.75, 0.62], [1, 1]],
    rise:   [[0, 0], [0.30, 0.15], [0.80, 0.90], [1, 1]]
  };

  /* ---------- char splitter for the giant headers ---------- */

  $$('[data-chars]').forEach(function (el) {
    var text = el.textContent;
    el.textContent = '';
    var i = 0;
    text.split('').forEach(function (ch) {
      if (ch.trim() === '') { el.appendChild(document.createTextNode(' ')); return; }
      var mask = document.createElement('span');
      mask.className = 'char';
      var inner = document.createElement('span');
      inner.textContent = ch;
      inner.style.setProperty('--d', (i * 26) + 'ms');
      i++;
      mask.appendChild(inner);
      el.appendChild(mask);
    });
  });

  /* ---------- hero scene ---------- */

  var navMark = $('.nav__mark');
  var heroRefs = null;

  function heroInit(pin) {
    heroRefs = {
      still: $('.hero__still', pin.el),
      pan: $('.hero__pan', pin.el),
      morph: $('.hero__morph', pin.el),
      skeleton: $('.hero__skeleton', pin.el),
      skeletonImg: $('.hero__skeleton .layer__media', pin.el),
      divefilm: $('.hero__divefilm', pin.el),
      lockup: $('.hero__lockup', pin.el),
      lockupTitle: $('.hero__lockup h1', pin.el),
      flanks: $$('.hero__flank', pin.el),
      cue: $('.scrollcue', pin.el),
      callouts: $('.callouts', pin.el),
      calloutsTitle: $('.callouts__title', pin.el),
      calloutCards: $$('.callout', pin.el),
      linePaths: $$('.callouts__lines path', pin.el),
      veil: $('.veil--white', pin.el)
    };
    heroRefs.linePaths.forEach(function (path) {
      var len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      path.dataset.len = len;
    });
    if (heroRefs.skeletonImg) heroRefs.skeletonImg.style.transformOrigin = '58% 58%';
    setTimeout(function () { heroRefs.lockupTitle.classList.add('chars-in'); }, 150);
  }

  function heroFrame(pin, p) {
    var r = heroRefs;

    /* Beat map:
       0.00-0.08  hold: wordmark, CTA, cue, particles
       0.07-0.33  pan film scrub
       0.34-0.55  morph film scrub
       0.55-0.74  skeleton hold: title, hairlines, cards
       0.75-0.94  dive film scrub into white
       0.92-1.00  white veil into the services room */

    /* Clips are frame-locked to their neighbours, so hand-offs are tight
       cuts placed AFTER the outgoing scrub has fully settled — long soft
       crossfades between two moving films read as double exposure. */
    r.still.style.opacity = 1 - fade(p, 0.07, 0.1);
    r.pan.style.opacity = fade(p, 0.07, 0.1) - fade(p, 0.335, 0.35);
    seekFilm(pin.films.pan, remap(fade(p, 0.08, 0.31), PACE.pan));

    r.morph.style.opacity = fade(p, 0.335, 0.35) - fade(p, 0.555, 0.57);
    seekFilm(pin.films.morph, remap(fade(p, 0.36, 0.53), PACE.morph));

    var diveOk = pin.films.dive && !pin.films.dive.missing;
    if (diveOk) {
      r.skeleton.style.opacity = fade(p, 0.555, 0.57) - fade(p, 0.75, 0.77);
      r.divefilm.style.opacity = fade(p, 0.75, 0.77);
      seekFilm(pin.films.dive, remap(fade(p, 0.77, 0.94), PACE.dive));
      r.skeletonImg.style.transform = 'none';
    } else {
      /* Fallback: flat CSS zoom on the still carries the dive */
      r.skeleton.style.opacity = fade(p, 0.55, 0.58) - fade(p, 0.97, 1);
      r.divefilm.style.opacity = 0;
      var d = fade(p, 0.75, 0.93);
      var dEase = d * d * (3 - 2 * d);
      r.skeletonImg.style.transform = 'scale(' + (1 + dEase * 2.1) + ')';
    }
    r.veil.style.opacity = fade(p, 0.92, 0.98);

    /* Hold UI rides up and fades */
    var lift = fade(p, 0.02, 0.1);
    r.lockup.style.transform = 'translateY(' + (lift * -80) + 'px)';
    r.lockup.style.opacity = 1 - fade(p, 0.04, 0.1);
    r.lockup.style.pointerEvents = p > 0.08 ? 'none' : '';
    r.cue.style.opacity = 1 - fade(p, 0.015, 0.05);
    r.flanks.forEach(function (f) { f.style.opacity = 1 - fade(p, 0.04, 0.1); });
    navMark.classList.toggle('is-on', p > 0.08);

    /* Skeleton callouts */
    r.callouts.style.opacity = fade(p, 0.56, 0.59) - fade(p, 0.72, 0.75);
    r.calloutsTitle.classList.toggle('chars-in', p > 0.565 && p < 0.75);
    r.callouts.classList.toggle('cards-on', p > 0.58 && p < 0.75);
    var lineP = fade(p, 0.575, 0.66);
    r.linePaths.forEach(function (path) {
      path.style.strokeDashoffset = (1 - lineP) * path.dataset.len;
    });
    r.callouts.classList.toggle('lines-on', p > 0.64 && p < 0.75);
    r.calloutCards.forEach(function (card, i) {
      card.classList.toggle('is-on', p > 0.585 + i * 0.022 && p < 0.73);
    });

    particlesActive = p < 0.1;
  }

  /* ---------- services scene: bone room, cards over the warp ---------- */

  var svcRefs = null;

  function servicesInit(pin) {
    svcRefs = {
      content: $('.services__content', pin.el),
      head: $('.services__head', pin.el),
      headTitle: $('.services__head h2', pin.el),
      cards: $$('.svc-card', pin.el),
      warp: $('.film--warp', pin.el),
      emerge: $('.film--emerge', pin.el),
      rise: $('.film--rise', pin.el),
      hold: $('.light-hold', pin.el),
      holdTexts: $$('.light-hold__text', pin.el),
      introH: $('.rise-intro h2', pin.el),
      introP: $('.rise-intro p', pin.el)
    };
  }

  function servicesFrame(pin, p) {
    var r = svcRefs;

    /* Beat map:
       0.00-0.44  warp film runs from the first pixel (it opens on the same
                  warm white the dive ends on); glass cards ride on top
       0.44-0.74  emergence film, played FORWARD: slow colossal pull-back
                  out of the bulb, ending on the headlight signature
       0.62-0.80  headlight hold: texts land, flicker runs
       0.78-0.96  rise film; center intro reveals
       0.955+     edge glow border takes over */

    r.headTitle.classList.toggle('chars-in', p > 0.015 && p < 0.5);
    r.head.style.opacity = 1 - fade(p, 0.30, 0.37);

    r.cards.forEach(function (card, i) {
      var inAt = 0.035 + i * 0.03;
      var outAt = 0.35 + i * 0.025;
      card.classList.toggle('is-on', p > inAt && p < outAt);
      card.classList.toggle('is-off', p >= outAt);
    });
    r.content.classList.add('over-warp');
    r.content.style.opacity = 1 - fade(p, 0.42, 0.46);

    r.warp.style.opacity = 1 - fade(p, 0.44, 0.46);
    seekFilm(pin.films.warp, remap(fade(p, 0.0, 0.43), PACE.warp));

    /* Warp ends white, emerge begins white: a hard-cut hand-off. */
    r.emerge.style.opacity = fade(p, 0.44, 0.46) - fade(p, 0.77, 0.79);
    seekFilm(pin.films.emerge, remap(fade(p, 0.45, 0.74), PACE.emerge));

    r.holdTexts.forEach(function (el, i) {
      var at = 0.62 + i * 0.045;
      el.style.opacity = fade(p, at, at + 0.04) - fade(p, 0.78, 0.81);
    });
    r.hold.classList.toggle('is-on', p > 0.64 && p < 0.97);

    r.rise.style.opacity = fade(p, 0.76, 0.79);
    seekFilm(pin.films.rise, remap(fade(p, 0.78, 0.96), PACE.rise));

    var ih = fade(p, 0.85, 0.91);
    r.introH.style.opacity = ih;
    r.introH.style.transform = 'translateY(' + ((1 - ih) * 24) + 'px)';
    var ip = fade(p, 0.88, 0.93);
    r.introP.style.opacity = ip;
    r.introP.style.transform = 'translateY(' + ((1 - ip) * 16) + 'px)';

    servicesEndP = p;
  }

  /* ---------- edge glow (white apple-style traveling border) ---------- */

  var edgeGlow = $('.edge-glow');
  var servicesEndP = 0;
  var bookEl = $('#book');
  var edgeOnAt = 0;

  function edgeFrame(t) {
    if (!edgeGlow) return;
    var bookRect = bookEl.getBoundingClientRect();
    var bookVisible = bookRect.top < window.innerHeight * 0.9 && bookRect.bottom > 0;
    var on = servicesEndP > 0.955 || bookVisible;
    if (on && !edgeGlow.classList.contains('is-on')) edgeOnAt = t;
    edgeGlow.classList.toggle('is-on', on);
    if (on) {
      /* Starts with the bright segment at the top, where the light bar
         landed, then travels the frame. */
      var a = -14 + (t - edgeOnAt) * 0.02;
      edgeGlow.style.setProperty('--edge-a', a + 'deg');
    }
  }

  /* ---------- hero dust particles ---------- */

  var particlesActive = true;
  var pCanvas = $('.hero__particles');
  var pCtx = pCanvas ? pCanvas.getContext('2d') : null;
  var motes = [];

  function particlesResize() {
    if (!pCanvas) return;
    pCanvas.width = pCanvas.offsetWidth;
    pCanvas.height = pCanvas.offsetHeight;
  }

  function particlesSeed() {
    motes = [];
    for (var i = 0; i < 42; i++) {
      motes.push({
        x: Math.random(), y: Math.random(),
        r: 0.4 + Math.random() * 1.1,
        s: 0.00012 + Math.random() * 0.0005,
        w: Math.random() * Math.PI * 2,
        a: 0.05 + Math.random() * 0.22
      });
    }
  }

  function particlesFrame(t) {
    if (!pCtx) return;
    pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
    if (!particlesActive) return;
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      m.x -= m.s;
      if (m.x < -0.02) { m.x = 1.02; m.y = Math.random(); }
      var y = m.y + Math.sin(t * 0.0004 + m.w) * 0.012;
      pCtx.globalAlpha = m.a * (0.6 + 0.4 * Math.sin(t * 0.001 + m.w));
      pCtx.fillStyle = '#ffffff';
      pCtx.beginPath();
      pCtx.arc(m.x * pCanvas.width, y * pCanvas.height, m.r, 0, Math.PI * 2);
      pCtx.fill();
    }
    pCtx.globalAlpha = 1;
  }

  /* ---------- reveals for non-pinned sections ---------- */

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -12% 0px' });
  $$('[data-reveal]').forEach(function (el) { io.observe(el); });

  /* ---------- GSAP flourishes (guarded: site works without the CDN) ---------- */

  if (window.gsap && finePointer) {
    $$('[data-magnetic]').forEach(function (btn) {
      var xTo = window.gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power3' });
      var yTo = window.gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power3' });
      btn.addEventListener('mousemove', function (e) {
        var rect = btn.getBoundingClientRect();
        xTo((e.clientX - rect.left - rect.width / 2) * 0.35);
        yTo((e.clientY - rect.top - rect.height / 2) * 0.5);
      });
      btn.addEventListener('mouseleave', function () { xTo(0); yTo(0); });
    });
  }

  /* ---------- init + main loop ---------- */

  var handlers = { hero: heroFrame, services: servicesFrame };
  var inits = { hero: heroInit, services: servicesInit };

  pins.forEach(function (pin) {
    if (inits[pin.name]) inits[pin.name](pin);
  });

  particlesResize();
  particlesSeed();
  window.addEventListener('resize', particlesResize);

  /* Hide stills the media workflow has not fetched yet */
  $$('.layer img').forEach(function (img) {
    function missing() {
      img.style.visibility = 'hidden';
      var pinEl = img.closest('[data-pin]');
      if (pinEl) pinEl.classList.add('film-missing');
    }
    img.addEventListener('error', missing);
    if (img.complete && img.naturalWidth === 0) missing();
  });

  /* Dead demo links stay dead */
  $$('a[data-dead]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); });
  });

  function frame(t) {
    if (finePointer) {
      current += (target - current) * 0.075;
      if (Math.abs(target - current) < 0.4) current = target;
      window.scrollTo(0, current);
    }

    for (var i = 0; i < pins.length; i++) {
      var pin = pins[i];
      var rect = pin.el.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > window.innerHeight + 200) continue;
      var span = pin.el.offsetHeight - window.innerHeight;
      var p = clamp(-rect.top / span, 0, 1);
      if (handlers[pin.name]) handlers[pin.name](pin, p);
    }

    particlesFrame(t);
    edgeFrame(t);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
