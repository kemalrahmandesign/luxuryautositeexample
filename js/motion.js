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
    var film = { el: video, vt: 0, missing: false, lazy: video.hasAttribute('data-lazy') };
    if (!film.lazy) video.load();
    var src = video.querySelector('source');
    (src || video).addEventListener('error', function () {
      film.missing = true;
      var pinEl = video.closest('[data-pin]');
      if (pinEl) pinEl.classList.add('film-missing');
    });
    return film;
  }

  function wakeFilm(film) {
    if (!film || !film.lazy) return;
    film.lazy = false;
    film.el.preload = 'auto';
    film.el.load();
  }

  /* Seek to an absolute time in seconds. All four guards exist because
     their absence caused visible stutter. */
  function seekFilm(film, tSec) {
    if (!film) return;
    var el = film.el;
    if (el.readyState < 1 || !el.duration) return;
    var t = clamp(tSec, 0, el.duration - 0.05);
    film.vt += (t - film.vt) * 0.35;
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

  /* The services film stays cold until the hero film is safely buffering
     (or the user is halfway through the hero) so first paint is fast. */
  function pinByName(name) {
    for (var i = 0; i < pins.length; i++) if (pins[i].name === name) return pins[i];
    return null;
  }
  var heroPin = pinByName('hero');
  var svcPin = pinByName('services');
  function wakeSvc() { if (svcPin) wakeFilm(svcPin.films.svc); }
  if (heroPin && heroPin.films.hero) {
    heroPin.films.hero.el.addEventListener('canplaythrough', wakeSvc, { once: true });
    setTimeout(wakeSvc, 12000); /* belt and braces if the event never fires */
  } else {
    wakeSvc();
  }

  /* Scene timelines: [scroll fraction, film time in seconds].
     Each scene is ONE continuous 19.33s film with baked, registered
     dissolves at the joins (built by scripts in the media workflow).
     Plateaus in the table are the holds.

     hero.mp4: 0-7.69 pan orbit | 7.69-8.04 dissolve | -15.38 x-ray morph
               | 15.38-15.73 dissolve | -19.33 dive to white
     svc.mp4:  0-7.69 warp streaks | 7.69-8.04 dissolve | -13.34 barrel
               roll onto headlight | 13.34-13.69 dissolve | -19.33 rise */
  var TIMELINE = {
    hero: [
      [0.00, 0],      /* front hold: wordmark, CTA, cue */
      [0.08, 0],
      [0.14, 1.4],    /* orbit starts unhurried */
      [0.31, 7.55],
      [0.55, 15.30],  /* morph plays through the first dissolve */
      [0.75, 15.30],  /* skeleton hold: callouts land on a parked frame */
      [0.94, 19.28],  /* dive to white */
      [1.00, 19.28]
    ],
    svc: [
      [0.00, 0],      /* streaks run from the first pixel after the white */
      [0.43, 7.55],
      [0.67, 13.25],  /* barrel roll lands on the headlight */
      [0.78, 13.25],  /* headlight hold: texts + flicker */
      [0.96, 19.28],  /* rise into the streak, out to black */
      [1.00, 19.28]
    ]
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
    /* The giant VANTA reveals letter-by-letter once the loader hands off
       (bottom-up per glyph, left-to-right via the --d stagger). */
    function revealTitle() { heroRefs.lockupTitle.classList.add('chars-in'); }
    if (window.__vantaLoaded) setTimeout(revealTitle, 120);
    else window.addEventListener('vanta:loaded', function () { setTimeout(revealTitle, 120); }, { once: true });
  }

  function heroFrame(pin, p) {
    var r = heroRefs;

    /* Beat map (one film, see TIMELINE.hero):
       0.00-0.08  hold: wordmark, CTA, cue, particles
       0.08-0.31  pan orbit
       0.31-0.55  x-ray morph
       0.55-0.75  skeleton hold: title, hairlines, cards
       0.75-0.94  dive into white
       0.92-1.00  white veil into the services room */

    seekFilm(pin.films.hero, remap(p, TIMELINE.hero));
    r.veil.style.opacity = fade(p, 0.92, 0.98);

    /* Halfway through the hero, make sure the services film is warming */
    if (p > 0.35) wakeSvc();

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
      hold: $('.light-hold', pin.el),
      holdTexts: $$('.light-hold__text', pin.el),
      introH: $('.rise-intro h2', pin.el),
      introP: $('.rise-intro p', pin.el)
    };
  }

  function servicesFrame(pin, p) {
    var r = svcRefs;

    /* Beat map (one film, see TIMELINE.svc):
       0.00-0.43  warp streaks from the first pixel; glass cards on top
       0.43-0.67  barrel-roll emergence onto the headlight
       0.67-0.78  headlight hold: texts land, flicker runs
       0.78-0.96  rise into the streak; center intro reveals
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

    seekFilm(pin.films.svc, remap(p, TIMELINE.svc));

    r.holdTexts.forEach(function (el, i) {
      var at = 0.67 + i * 0.03;
      el.style.opacity = fade(p, at, at + 0.035) - fade(p, 0.78, 0.81);
    });
    r.hold.classList.toggle('is-on', p > 0.68 && p < 0.97);

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
    /* offset* can be 0 before the pinned stage lays out; fall back to the
       viewport so the seed count is never 0 (that was killing the dust). */
    pCanvas.width = pCanvas.offsetWidth || window.innerWidth;
    pCanvas.height = pCanvas.offsetHeight || window.innerHeight;
  }

  function particlesSeed() {
    motes = [];
    var w = pCanvas.offsetWidth || window.innerWidth;
    var count = Math.max(60, Math.min(120, Math.round(w / 14)));
    for (var i = 0; i < count; i++) {
      var x = Math.random(), y = Math.random();
      /* keep the air around and above the car, not piled in front of it */
      if (x > 0.32 && x < 0.68 && y > 0.5) y = Math.random() * 0.5;
      motes.push({
        x: x, y: y,
        r: 0.7 + Math.random() * 1.9,
        s: 0.00005 + Math.random() * 0.00022,   /* slow leftward drift */
        g: 0.00003 + Math.random() * 0.00009,   /* gentle gravity */
        w: Math.random() * Math.PI * 2,
        a: 0.16 + Math.random() * 0.4
      });
    }
  }

  function particlesFrame(t) {
    if (!pCtx) return;
    pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
    if (!particlesActive) return;
    pCtx.fillStyle = '#ffffff';
    pCtx.shadowColor = 'rgba(255,255,255,0.9)';
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      m.x -= m.s;
      m.y += m.g;                                  /* fall with gravity */
      if (m.x < -0.02) { m.x = 1.02; m.y = Math.random() * 0.8; }
      if (m.y > 1.04) { m.y = -0.02; m.x = Math.random(); }
      var y = m.y + Math.sin(t * 0.0003 + m.w) * 0.006;
      /* dim anything drifting in front of the car so it stays a backdrop */
      var inCar = m.x > 0.34 && m.x < 0.66 && y > 0.55;
      pCtx.globalAlpha = m.a * (inCar ? 0.3 : 1) * (0.55 + 0.45 * Math.sin(t * 0.0008 + m.w));
      pCtx.shadowBlur = m.r * 2.5;
      pCtx.beginPath();
      pCtx.arc(m.x * pCanvas.width, y * pCanvas.height, m.r, 0, Math.PI * 2);
      pCtx.fill();
    }
    pCtx.globalAlpha = 1;
    pCtx.shadowBlur = 0;
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

  /* ---------- CTA directional fill (button stays put) ---------- */

  /* Independent x/y offsets so a corner entry fills diagonally and an edge
     entry fills straight in from that edge. */
  function edgeOffset(e, rect) {
    var nx = (e.clientX - rect.left) / rect.width - 0.5;   /* -0.5..0.5 */
    var ny = (e.clientY - rect.top) / rect.height - 0.5;
    var fx = nx < -0.28 ? '-101%' : nx > 0.28 ? '101%' : '0%';
    var fy = ny < -0.28 ? '-101%' : ny > 0.28 ? '101%' : '0%';
    if (fx === '0%' && fy === '0%') fy = ny < 0 ? '-101%' : '101%';
    return [fx, fy];
  }

  $$('.cta').forEach(function (btn) {
    var fill = $('.cta__fill', btn);
    if (!fill) return;
    btn.addEventListener('mouseenter', function (e) {
      var d = edgeOffset(e, btn.getBoundingClientRect());
      fill.style.transition = 'none';
      fill.style.setProperty('--fx', d[0]);
      fill.style.setProperty('--fy', d[1]);
      void fill.offsetWidth;            /* commit the start edge before sweeping in */
      fill.style.transition = '';
      btn.classList.add('is-filled');
    });
    btn.addEventListener('mouseleave', function (e) {
      var d = edgeOffset(e, btn.getBoundingClientRect());
      fill.style.setProperty('--fx', d[0]);
      fill.style.setProperty('--fy', d[1]);
      btn.classList.remove('is-filled');
    });
  });

  /* ---------- custom cursor (fine pointer only) ---------- */

  var cursorRing = null, cursorDot = null;
  var cx = window.innerWidth / 2, cy = window.innerHeight / 2;   /* live mouse */
  var rxp = cx, ryp = cy;                                        /* lagging ring */

  if (finePointer) {
    docEl.classList.add('cursor-on');
    cursorDot = document.createElement('div');
    cursorDot.className = 'cursor-dot';
    cursorRing = document.createElement('div');
    cursorRing.className = 'cursor-ring';
    document.body.appendChild(cursorRing);
    document.body.appendChild(cursorDot);

    window.addEventListener('mousemove', function (e) {
      cx = e.clientX; cy = e.clientY;
      cursorDot.style.transform = 'translate(' + cx + 'px,' + cy + 'px) translate(-50%,-50%)';
    });
    document.addEventListener('mouseover', function (e) {
      if (e.target.closest && e.target.closest('a, button, .cta, [data-magnetic], .svc-card, .callout, .nav__link')) {
        cursorRing.classList.add('is-hot');
      }
    });
    document.addEventListener('mouseout', function (e) {
      if (e.target.closest && e.target.closest('a, button, .cta, [data-magnetic], .svc-card, .callout, .nav__link')) {
        cursorRing.classList.remove('is-hot');
      }
    });
    document.addEventListener('mousedown', function () { cursorRing.classList.add('is-down'); });
    document.addEventListener('mouseup', function () { cursorRing.classList.remove('is-down'); });
    window.addEventListener('mouseout', function (e) {
      if (!e.relatedTarget) { cursorDot.style.opacity = 0; cursorRing.style.opacity = 0; }
    });
    window.addEventListener('mouseover', function () {
      cursorDot.style.opacity = ''; cursorRing.style.opacity = '';
    });
  }

  function cursorFrame() {
    if (!cursorRing) return;
    rxp += (cx - rxp) * 0.18;
    ryp += (cy - ryp) * 0.18;
    cursorRing.style.transform = 'translate(' + rxp + 'px,' + ryp + 'px) translate(-50%,-50%)';
  }

  /* ---------- init + main loop ---------- */

  var handlers = { hero: heroFrame, services: servicesFrame };
  var inits = { hero: heroInit, services: servicesInit };

  pins.forEach(function (pin) {
    if (inits[pin.name]) inits[pin.name](pin);
  });

  particlesResize();
  particlesSeed();
  window.addEventListener('resize', function () { particlesResize(); particlesSeed(); });

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
    cursorFrame();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
