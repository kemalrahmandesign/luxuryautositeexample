/* Vanta Exotic Auto Repair: scroll motion engine.
   One rAF loop drives every pinned scene. No scroll libraries by design:
   the pin math below replaces them (see SCROLLSITEPLAYBOOK section 2). */

(function () {
  'use strict';

  var docEl = document.documentElement;
  docEl.classList.add('js');

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    docEl.classList.add('reduced');
    return;
  }

  /* Seam constants: keep in sync with css/tokens.css */
  var SEAM_WHITE = '#edebe7';
  var SEAM_CANVAS = '#0b0b0b';

  /* ---------- helpers ---------- */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* Linear 0..1 window between two progress values */
  function fade(p, a, b) { return clamp((p - a) / (b - a), 0, 1); }

  /* Piecewise-linear remap: scroll progress in, video time (0..1) out.
     This is where slow / fast / slow pacing lives. Tune tables freely. */
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
      target = clamp(target + d, 0, maxScroll());
    }, { passive: false });

    /* Native scrolling (scrollbar, keys, find-in-page) resyncs the lerp */
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
    var film = { el: video, vt: 0 };
    video.load();
    var src = video.querySelector('source');
    (src || video).addEventListener('error', function () {
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
    film.vt += (t - film.vt) * 0.22;
    if (el.seeking) return;
    var delta = Math.abs(el.currentTime - film.vt);
    if (delta < 1 / 30) return;
    if (delta > 0.5 && typeof el.fastSeek === 'function') el.fastSeek(film.vt);
    else el.currentTime = film.vt;
  }

  /* ---------- pins ---------- */

  var pins = $$('[data-pin]').map(function (el) {
    var pin = {
      el: el,
      name: el.getAttribute('data-pin-name'),
      films: {}
    };
    $$('video[data-film]', el).forEach(function (v) {
      pin.films[v.getAttribute('data-film')] = makeFilm(v);
    });
    return pin;
  });

  /* Per-clip pacing tables: [scroll fraction, video time fraction].
     Middle segments steeper = faster playback under scroll. */
  var PACE = {
    pan:    [[0, 0], [0.25, 0.10], [0.70, 0.85], [1, 1]],
    morph:  [[0, 0], [0.20, 0.10], [0.75, 0.90], [1, 1]],
    warp:   [[0, 0], [0.45, 0.30], [0.75, 0.55], [1, 1]],   /* end sped up on request */
    emerge: [[0, 0], [0.40, 0.55], [1, 1]],
    rise:   [[0, 0], [0.30, 0.15], [0.80, 0.90], [1, 1]]
  };

  /* ---------- hero scene ---------- */

  var heroRefs = null;
  function heroInit(pin) {
    heroRefs = {
      still: $('.hero__still', pin.el),
      pan: $('.hero__pan', pin.el),
      morph: $('.hero__morph', pin.el),
      dive: $('.hero__dive', pin.el),
      diveImg: $('.hero__dive .layer__media', pin.el),
      lockup: $('.hero__lockup', pin.el),
      flanks: $$('.hero__flank', pin.el),
      cue: $('.hero__cue', pin.el),
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
  }

  function heroFrame(pin, p) {
    var r = heroRefs;

    /* Beat map:
       0.00-0.10  still hold, wordmark, particles
       0.10-0.34  pan film scrub
       0.36-0.56  morph film scrub
       0.56-0.74  skeleton hold: title, hairlines, cards
       0.74-0.92  CSS dive into the skeleton still
       0.86-1.00  white veil to the bone room */

    r.still.style.opacity = 1 - fade(p, 0.08, 0.12);
    r.pan.style.opacity = fade(p, 0.08, 0.12) - fade(p, 0.35, 0.37);
    seekFilm(pin.films.pan, remap(fade(p, 0.10, 0.34), PACE.pan));

    r.morph.style.opacity = fade(p, 0.35, 0.37) - fade(p, 0.57, 0.60);
    seekFilm(pin.films.morph, remap(fade(p, 0.36, 0.56), PACE.morph));

    /* Lockup rides up and fades; corner mark snaps on (threshold) */
    var lift = fade(p, 0.02, 0.12);
    r.lockup.style.transform = 'translateY(' + (lift * -70) + 'px)';
    r.lockup.style.opacity = 1 - fade(p, 0.05, 0.12);
    r.cue.style.opacity = 1 - fade(p, 0.02, 0.06);
    r.flanks.forEach(function (f) { f.style.opacity = 1 - fade(p, 0.05, 0.12); });
    navMark.classList.toggle('is-on', p > 0.1);

    /* Skeleton hold: still image carries the frame from morph end onward */
    r.dive.style.opacity = fade(p, 0.57, 0.60) - fade(p, 0.97, 1);
    r.callouts.style.opacity = fade(p, 0.57, 0.60) - fade(p, 0.75, 0.78);
    r.calloutsTitle.classList.toggle('is-on', p > 0.58 && p < 0.75);
    var lineP = fade(p, 0.58, 0.68);
    r.linePaths.forEach(function (path) {
      path.style.strokeDashoffset = (1 - lineP) * path.dataset.len;
    });
    r.calloutCards.forEach(function (card, i) {
      var at = 0.60 + i * 0.03;
      card.classList.toggle('is-on', p > at && p < 0.76);
    });

    /* The dive: flat CSS zoom, capped near 3x so the raster never pixelates */
    var d = fade(p, 0.74, 0.92);
    var dEase = d * d * (3 - 2 * d); /* smoothstep */
    r.diveImg.style.transform = 'scale(' + (1 + dEase * 2.1) + ')';
    r.veil.style.opacity = fade(p, 0.86, 0.94);

    particlesActive = p < 0.12;
  }

  /* ---------- reviews scene (bone room, horizontal) ---------- */

  var revRefs = null;
  function reviewsInit(pin) {
    revRefs = {
      head: $('.reviews__head', pin.el),
      track: $('.reviews__track', pin.el)
    };
  }

  function reviewsFrame(pin, p) {
    var r = revRefs;
    r.head.classList.toggle('is-in', p > 0.04);
    var span = r.track.scrollWidth - window.innerWidth;
    if (span > 0) {
      var t = fade(p, 0.12, 0.92);
      var e = t * t * (3 - 2 * t);
      r.track.style.transform = 'translateX(' + (-span * e) + 'px)';
    }
  }

  /* ---------- warp / headlight scene ---------- */

  var warpRefs = null;
  function warpInit(pin) {
    warpRefs = {
      warp: $('.film--warp', pin.el),
      emerge: $('.film--emerge', pin.el),
      rise: $('.film--rise', pin.el),
      hold: $('.light-hold', pin.el),
      holdTexts: $$('.light-hold__text', pin.el),
      whiteVeil: $('.veil--white', pin.el),
      blackVeil: $('.veil--black', pin.el)
    };
  }

  function warpFrame(pin, p) {
    var r = warpRefs;

    /* Beat map:
       0.00-0.05  hold on seam white (matches the bone room behind us)
       0.03-0.32  warp film scrub (ends white)
       0.30-0.60  emergence film scrubbed REVERSED with a code barrel roll
       0.58-0.76  headlight hold: flicker, text on all sides
       0.76-0.97  rise film scrub
       0.95-1.00  settle to canvas black */

    r.whiteVeil.style.opacity = 1 - fade(p, 0.03, 0.06);

    r.warp.style.opacity = fade(p, 0.0, 0.02) - fade(p, 0.31, 0.34);
    seekFilm(pin.films.warp, remap(fade(p, 0.03, 0.32), PACE.warp));

    /* Reversed: forward clip runs headlight to white, so reversed playback
       unwinds white back into the headlight. The roll is ours. */
    var ep = fade(p, 0.30, 0.60);
    r.emerge.style.opacity = fade(p, 0.31, 0.34) - fade(p, 0.75, 0.78);
    seekFilm(pin.films.emerge, remap(ep, PACE.emerge), true);
    var unroll = 1 - ep;
    var angle = unroll * -200;
    var scale = 1 + unroll * 0.9;
    r.emerge.style.transform = 'rotate(' + angle + 'deg) scale(' + scale + ')';

    /* Texts land one by one while the headlight unrolls, scrub-locked */
    r.holdTexts.forEach(function (el, i) {
      var at = 0.42 + i * 0.06;
      el.style.opacity = fade(p, at, at + 0.05) - fade(p, 0.73, 0.77);
    });
    r.hold.classList.toggle('is-on', p > 0.5 && p < 0.74);

    r.rise.style.opacity = fade(p, 0.75, 0.78);
    seekFilm(pin.films.rise, remap(fade(p, 0.76, 0.97), PACE.rise));

    r.blackVeil.style.opacity = fade(p, 0.95, 1);
  }

  /* ---------- hero dust particles (canvas, time based) ---------- */

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
        x: Math.random(),
        y: Math.random(),
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

  /* Word mask for the reviews header: split text nodes only */
  $$('[data-split]').forEach(function (el) {
    var text = el.textContent.trim();
    el.textContent = '';
    text.split(/\s+/).forEach(function (word, i) {
      var mask = document.createElement('span');
      mask.className = 'word';
      var inner = document.createElement('span');
      inner.textContent = word;
      inner.style.transitionDelay = (i * 70) + 'ms';
      mask.appendChild(inner);
      el.appendChild(mask);
      el.appendChild(document.createTextNode(' '));
    });
  });

  /* ---------- init + main loop ---------- */

  var navMark = $('.nav__mark');

  var handlers = {
    hero: heroFrame,
    reviews: reviewsFrame,
    warp: warpFrame
  };
  var inits = {
    hero: heroInit,
    reviews: reviewsInit,
    warp: warpInit
  };

  pins.forEach(function (pin) {
    if (inits[pin.name]) inits[pin.name](pin);
  });

  particlesResize();
  particlesSeed();
  window.addEventListener('resize', particlesResize);

  /* Hide stills that have not been fetched by the media workflow yet.
     The 404 can fire before this runs, so also check current state. */
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
      current += (target - current) * 0.06;
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
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
