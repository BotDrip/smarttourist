'use strict';
/* ============================================================================
   AEGISTRAVEL v8 · CINEMA LAYER
   ----------------------------------------------------------------------------
   One shared requestAnimationFrame ticker drives every heavy loop on the page:
   the ambient contour canvas, the cursor trail (registered by aegis-kinetic),
   the tilt field and the guided-scene player. Nothing repaints when the tab is
   hidden, Lite Mode is on, or there is no subscriber.

   Responsibilities
   • Ambient topographic + radar canvas that reacts to the live safety score.
   • Pointer-driven 3D tilt and specular sheen for stage / pass / intel cards.
   • Screen choreography hooks (cross-dissolve is CSS; this adds the stagger).
   • Leaflet invalidateSize whenever a drawer, dock or viewport settles.
   • Three narrated cinematic scenes with a scrubbable timeline.
   • window.Aegis namespace registration for every module.
   ========================================================================== */
(function () {
  const $ = (id) => document.getElementById(id);
  const Aegis = (window.Aegis = window.Aegis || {});
  Aegis.version = '8.0.0';

  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ----------------------------------------------------------- shared ticker */
  const subs = new Set();
  let running = false;
  let lastTs = 0;

  function loop(ts) {
    if (!subs.size || document.hidden) { running = false; return; }
    requestAnimationFrame(loop);
    const dt = ts - lastTs;
    if (dt < 15) return;                       // cap at ~60 fps
    lastTs = ts;
    subs.forEach((fn) => { try { fn(dt, ts); } catch (e) { console.error('[Aegis] frame', e); } });
  }

  function startTicker() {
    if (running) return;
    running = true;
    lastTs = performance.now();
    requestAnimationFrame(loop);
  }

  Aegis.ticker = {
    add(fn) { subs.add(fn); startTicker(); return () => subs.delete(fn); },
    get size() { return subs.size; }
  };

  document.addEventListener('visibilitychange', () => { if (!document.hidden) startTicker(); });

  /* ---------------------------------------------------------- ambient canvas */
  const THREAT = {
    safe:    { c: '0,240,255',   a: 0.20, pulse: 0.9,  amp: 14 },
    caution: { c: '255,176,32',  a: 0.24, pulse: 1.4,  amp: 22 },
    danger:  { c: '255,42,95',   a: 0.26, pulse: 2.2,  amp: 30 },
    sos:     { c: '255,42,95',   a: 0.34, pulse: 3.4,  amp: 40 }
  };

  const amb = { el: null, ctx: null, w: 0, h: 0, dpr: 1, t: 0, threat: 'safe', px: 0.5, py: 0.42, vx: 0, vy: 0, acc: 0, threatAt: 0 };

  function ambientResize() {
    if (!amb.el) return;
    const dpr = Math.min(1.6, window.devicePixelRatio || 1);
    amb.dpr = dpr;
    amb.w = window.innerWidth;
    amb.h = window.innerHeight;
    amb.el.width = Math.floor(amb.w * dpr);
    amb.el.height = Math.floor(amb.h * dpr);
    amb.el.style.width = amb.w + 'px';
    amb.el.style.height = amb.h + 'px';
    amb.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function readThreat() {
    const sos = $('sosOverlay');
    if (sos && getComputedStyle(sos).display !== 'none') return 'sos';
    const v = parseInt((($('hudScoreVal') || {}).textContent || '').trim(), 10);
    if (!isFinite(v)) return 'safe';
    return v < 45 ? 'danger' : v < 70 ? 'caution' : 'safe';
  }

  function drawAmbient() {
    const ctx = amb.ctx;
    if (!ctx) return;
    const cfg = THREAT[amb.threat] || THREAT.safe;
    const t = amb.t;
    const speed = Math.min(1, Math.hypot(amb.vx, amb.vy) / 900);
    const fx = amb.w * (0.18 + amb.px * 0.64);
    const fy = amb.h * (0.14 + amb.py * 0.62);
    const base = Math.min(amb.w, amb.h);

    ctx.clearRect(0, 0, amb.w, amb.h);

    // topographic contour bands, breathing with pointer velocity
    ctx.lineWidth = 1;
    for (let layer = 0; layer < 5; layer++) {
      const rad = base * (0.16 + layer * 0.11) + Math.sin(t * 0.00018 + layer) * cfg.amp;
      const alpha = cfg.a * (0.30 - layer * 0.042) + speed * 0.05;
      ctx.beginPath();
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const wob = Math.sin(a * 3 + t * 0.00022 + layer * 0.9) * (cfg.amp * 0.5)
                  + Math.cos(a * 5 - t * 0.00016 + layer) * (cfg.amp * 0.32)
                  + Math.sin(a * 2 - t * 0.00009) * (speed * 22);
        const x = fx + Math.cos(a) * (rad + wob * 1.6);
        const y = fy + Math.sin(a) * (rad * 0.72 + wob);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(' + cfg.c + ',' + Math.max(0.02, alpha).toFixed(3) + ')';
      ctx.stroke();
    }

    // radar waves radiating from the focus point
    for (let w = 0; w < 3; w++) {
      const phase = ((t * 0.00016 * cfg.pulse + w / 3) % 1);
      const rr = phase * base * 0.62;
      ctx.beginPath();
      ctx.arc(fx, fy, rr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(' + cfg.c + ',' + (cfg.a * (1 - phase) * 0.9).toFixed(3) + ')';
      ctx.stroke();
    }

    // horizon glow behind the focus
    ctx.fillStyle = 'rgba(' + cfg.c + ',' + (0.028 + speed * 0.02).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(fx, fy, base * 0.30, 0, Math.PI * 2);
    ctx.fill();
  }

  function ambientFrame(dt) {
    amb.acc += dt;
    if (amb.acc < 33) return;                 // 30 fps is imperceptible twice over
    amb.acc = 0;
    amb.t = performance.now();
    if (amb.t - amb.threatAt > 500) { amb.threatAt = amb.t; amb.threat = readThreat(); }
    amb.vx *= 0.9;
    amb.vy *= 0.9;
    drawAmbient();
  }

  function initAmbient() {
    const el = $('fxAmbient');
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    amb.el = el;
    amb.ctx = ctx;
    ambientResize();
    window.addEventListener('resize', ambientResize, { passive: true });
    window.addEventListener('pointermove', (ev) => {
      amb.px = ev.clientX / Math.max(1, window.innerWidth);
      amb.py = ev.clientY / Math.max(1, window.innerHeight);
      amb.vx += ev.movementX || 0;
      amb.vy += ev.movementY || 0;
    }, { passive: true });
    if (reduceMotion()) { amb.t = performance.now(); drawAmbient(); return; }
    Aegis.ticker.add((dt) => { if (!Aegis.lite) ambientFrame(dt); });
  }

  Aegis.ambient = {
    setThreat(v) { if (THREAT[v]) amb.threat = v; },
    get threat() { return amb.threat; }
  };

  /* -------------------------------------------------------- tilt + sheen */
  const TILT_SEL = '.hero-stage,.holo,.ml-mini,.intel-card,.feature-card,.price-card';
  let tiltEl = null;
  let tiltPending = null;
  let tiltRaf = 0;

  function applyTilt() {
    tiltRaf = 0;
    const ev = tiltPending;
    if (!ev || Aegis.lite) return;
    const el = ev.target && ev.target.closest ? ev.target.closest(TILT_SEL) : null;
    if (el !== tiltEl) {
      if (tiltEl) tiltEl.classList.remove('is-tilted');
      tiltEl = el;
      if (el) el.classList.add('is-tilted');
    }
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const px = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
    el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
    el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
    el.style.setProperty('--ry', ((px - 0.5) * 8).toFixed(2) + 'deg');
    el.style.setProperty('--rx', ((0.5 - py) * 6).toFixed(2) + 'deg');
  }

  function initTilt() {
    if (reduceMotion()) return;
    document.addEventListener('pointermove', (ev) => {
      if (Aegis.lite || ev.pointerType === 'touch') return;
      tiltPending = ev;
      if (!tiltRaf) tiltRaf = requestAnimationFrame(applyTilt);
    }, { passive: true });
    document.addEventListener('pointerleave', () => {
      if (tiltEl) tiltEl.classList.remove('is-tilted');
      tiltEl = null;
    });
  }

  /* -------------------------------------------------- screen choreography */
  function initScreens() {
    const base = window.show;
    if (typeof base !== 'function' || base.__aegis) return;
    const wrapped = function (id) {
      const before = ['landing', 'auth', 'register', 'app'].map($).find((el) => el && !el.classList.contains('hidden'));
      const out = base.apply(this, arguments);
      const next = $(id);
      if (next) {
        next.classList.remove('screen-in');
        void next.offsetWidth;
        next.classList.add('screen-in');
        setTimeout(() => next.classList.remove('screen-in'), 1100);
      }
      if (before && before !== next) {
        before.classList.add('screen-out');
        setTimeout(() => before.classList.remove('screen-out'), 520);
      }
      return out;
    };
    wrapped.__aegis = true;
    window.show = wrapped;
  }

  /* ------------------------------------------------------- Leaflet resync */
  let mapObserver = null;
  let mapTimer = 0;

  function invalidateMap(delay) {
    clearTimeout(mapTimer);
    mapTimer = setTimeout(() => {
      const m = window.CMAP && CMAP.m;
      if (m && typeof m.invalidateSize === 'function') {
        try { m.invalidateSize(false); } catch (e) { /* map torn down mid-render */ }
      }
    }, delay == null ? 520 : delay);
  }
  Aegis.map = { refresh: invalidateMap };

  function observeCommandRoot() {
    const root = $('cmdRoot');
    if (!root || !window.MutationObserver) return;
    if (mapObserver) mapObserver.disconnect();
    mapObserver = new MutationObserver(() => invalidateMap(520));
    mapObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  function initMapSync() {
    window.addEventListener('resize', () => invalidateMap(180), { passive: true });
    window.addEventListener('orientationchange', () => invalidateMap(320), { passive: true });
    observeCommandRoot();
    const prev = window.aegisAfterRender;
    window.aegisAfterRender = function (page) {
      const out = typeof prev === 'function' ? prev.apply(this, arguments) : undefined;
      observeCommandRoot();
      if (page === 'command') invalidateMap(220);
      return out;
    };
  }

  /* ------------------------------------------------------------ scene deck */
  const SCENES = [
    {
      id: 1, name: 'Mumbai Coastal Transit', lens: 'zones', night: false, zoom: 12.6, dur: 14000,
      p0: [18.9219, 72.8347], p1: [18.9496, 72.8092], p2: [19.0176, 72.8194],
      beats: [
        [0.00, 'Boarding at Gateway of India · geofence stable, 1,204 pings/min.'],
        [0.32, 'Marine Drive corridor · crowd density climbing, scam cluster flagged.'],
        [0.66, 'Worli sea-face · verified safe haven 240 m, police kiosk online.'],
        [0.93, 'Transit complete · SHA-256 evidence block sealed into the ledger.']
      ]
    },
    {
      id: 2, name: 'Late-Night High-Altitude Drift', lens: 'night', night: true, zoom: 11.4, dur: 15000,
      p0: [34.1526, 77.5771], p1: [34.2205, 77.4654], p2: [34.2781, 77.6042],
      beats: [
        [0.00, 'Leh depot · altitude 3,500 m, night prior armed.'],
        [0.30, 'Route drift 240 m off the approved corridor — Isolation Forest +0.41.'],
        [0.62, 'Telecom dead-zone ahead · haven distance 6.2 km, ETA 19 min.'],
        [0.92, 'Drift resolved · night risk recomputed, ledger acknowledged.']
      ]
    },
    {
      id: 3, name: 'Dead-Man Pulse Timeout', lens: 'path', night: true, zoom: 13.2, dur: 13000,
      p0: [15.2993, 74.124], p1: [15.335, 74.008], p2: [15.386, 74.053],
      beats: [
        [0.00, 'Check-in overdue · dead-man pulse counting down from 30 s.'],
        [0.34, 'No response · trajectory anomaly climbing, SOS pre-armed.'],
        [0.66, 'Broadcast tier-1 · responders notified, coordinates attached.'],
        [0.92, 'Pulse timeout sealed · SHA-256 ledger block written.']
      ]
    }
  ];

  const player = { scene: null, t: 0, playing: false, lastPaint: 0, unsub: null, raf: 0 };

  function bezier(a, b, c, t) {
    const u = 1 - t;
    return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]];
  }

  function mapObj() { return window.CMAP && CMAP.m ? CMAP.m : null; }

  const lastPan = { at: 0 };

  function placeSubject(lat, lng) {
    try {
      const subj = typeof aegisSubject === 'function' ? aegisSubject() : null;
      if (subj) { subj.lat = lat; subj.lng = lng; subj.accuracy = 14; subj.locationSource = 'cinema'; }
      if (typeof S !== 'undefined') S.loc = { lat: lat, lng: lng, accuracy: 14 };
      const m = mapObj();
      const now = performance.now();
      // Keep the subject in view without thrashing tiles: at most one camera
      // move per second, and only when the marker leaves the inner 56%.
      if (m && m.getBounds && now - lastPan.at > 950) {
        const b = m.getBounds();
        const c = m.getCenter();
        const far = Math.abs(c.lat - lat) > (b.getNorth() - b.getSouth()) * 0.22
                 || Math.abs(c.lng - lng) > (b.getEast() - b.getWest()) * 0.22;
        if (far || !b.contains([lat, lng])) {
          lastPan.at = now;
          try { m.panTo([lat, lng], { animate: true, duration: 0.72 }); } catch (e) {}
        }
      }
      if (typeof aegisDrawSubject === 'function') aegisDrawSubject();
    } catch (e) { /* scene runs before the map exists */ }
  }

  function fmtClock(sec) {
    const s = Math.max(0, Math.round(sec));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function paintSceneChrome() {
    const scrub = $('cineScrub');
    if (scrub) scrub.value = String(Math.round(player.t * 1000));
    const clock = $('cineClock');
    if (clock && player.scene) clock.textContent = fmtClock(player.t * (player.scene.dur / 1000));
    const fill = $('cineFill');
    if (fill) fill.style.width = (player.t * 100).toFixed(1) + '%';
    const head = $('cineHead');
    if (head && player.scene) head.textContent = '0' + player.scene.id + ' · ' + player.scene.name;
    document.querySelectorAll('.cine-scene').forEach((b) => {
      b.classList.toggle('active', !!player.scene && b.dataset.scene === String(player.scene.id));
    });
  }

  function sceneTick(dt, ts) {
    if (!player.playing || !player.scene) return;
    const s = player.scene;
    player.t = Math.min(1, player.t + dt / s.dur);
    const p = bezier(s.p0, s.p1, s.p2, player.t);
    placeSubject(p[0], p[1]);
    paintSceneChrome();

    if (ts - player.lastPaint > 280) {
      player.lastPaint = ts;
      try { if (window.aegisKinetic) window.aegisKinetic.paintIntel(); } catch (e) { /* panels not mounted */ }
      if (typeof aegisPaintLive === 'function') { try { aegisPaintLive(); } catch (e) {} }
    }

    const beat = s.beats.reduce((acc, b) => (player.t >= b[0] ? b : acc), s.beats[0]);
    const beatEl = $('cineBeat');
    if (beatEl && beatEl.textContent !== beat[1]) beatEl.textContent = beat[1];

    if (player.t >= 1) endScene();
  }

  function startScene(n) {
    const s = SCENES.find((x) => x.id === n);
    if (!s) return;
    stopScene(false);
    player.scene = s;
    player.t = 0;
    player.playing = true;
    player.lastPaint = 0;
    if (typeof aegisGoto === 'function') {
      try { if (typeof S === 'undefined' || S.page !== 'command') aegisGoto('command'); } catch (e) {}
    }
    // fly the camera before the first frame so the path reads as geography
    const m = mapObj();
    if (m && m.flyTo) { try { m.flyTo(s.p0, s.zoom, { duration: 1.1 }); } catch (e) {} }
    if (window.aegisKinetic && typeof window.aegisKinetic.setNight === 'function') window.aegisKinetic.setNight(!!s.night);
    if (typeof aegisSetLens === 'function') { try { aegisSetLens(s.lens, true); } catch (e) {} }
    if (typeof aegisLedgerAppend === 'function') {
      try { aegisLedgerAppend('SCENE_START', 'Guided scene ' + s.id + ' · ' + s.name, { scene: s.id }); } catch (e) {}
    }
    if (typeof toast === 'function') toast('Scene ' + s.id + ' · ' + s.name, 'info');
    player.unsub = Aegis.ticker.add(sceneTick);
    paintSceneChrome();
  }

  function stopScene(quiet) {
    player.playing = false;
    player.t = 0;
    if (player.unsub) { player.unsub(); player.unsub = null; }
    document.body.classList.remove('cine-alarm');
    if (!quiet) paintSceneChrome();
  }

  function endScene() {
    const s = player.scene;
    player.playing = false;
    if (player.unsub) { player.unsub(); player.unsub = null; }
    const p = bezier(s.p0, s.p1, s.p2, 1);
    if (typeof aegisLedgerAppend === 'function') {
      try {
        aegisLedgerAppend('SCENE_COMPLETE', 'Guided scene ' + s.id + ' sealed', {
          scene: s.id, lat: +p[0].toFixed(4), lng: +p[1].toFixed(4)
        });
      } catch (e) {}
    }
    if (s.id === 3) {
      document.body.classList.add('cine-alarm');
      if (window.Aegis && Aegis.ambient) Aegis.ambient.setThreat('sos');
      setTimeout(() => {
        document.body.classList.remove('cine-alarm');
        if (window.Aegis && Aegis.ambient) Aegis.ambient.setThreat(readThreat());
      }, 3200);
    }
    const beatEl = $('cineBeat');
    if (beatEl) beatEl.textContent = s.name + ' complete · ledger sealed.';
    if (typeof toast === 'function') toast('Scene ' + s.id + ' complete · evidence sealed', 'success');
    paintSceneChrome();
  }

  Aegis.scenes = { list: () => SCENES.map((s) => ({ id: s.id, name: s.name })), start: startScene, stop: () => stopScene(false), get progress() { return player.t; } };

  /* ------------------------------------------------------------- wiring */
  // Delegated: the dock is rebuilt on every command render, so listeners are
  // bound once to the document instead of per node.
  function initSceneDeck() {
    document.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('.cine-scene') : null;
      if (!btn) return;
      const n = Number(btn.dataset.scene);
      if (player.scene && player.scene.id === n && player.playing) stopScene(false);
      else startScene(n);
    }, { passive: true });

    document.addEventListener('input', (ev) => {
      if (!ev.target || ev.target.id !== 'cineScrub') return;
      const v = Math.min(1, Math.max(0, Number(ev.target.value) / 1000));
      if (player.scene) {
        player.t = v;
        const p = bezier(player.scene.p0, player.scene.p1, player.scene.p2, v);
        placeSubject(p[0], p[1]);
        paintSceneChrome();
      } else if (typeof aegisReplayScrub === 'function') {
        try { aegisReplayScrub(ev.target.value); } catch (e) {}
      }
    }, { passive: true });
  }

  function boot() {
    initAmbient();
    initTilt();
    initScreens();
    initMapSync();
    initSceneDeck();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  // stable namespace aliases for anything that prefers one entry point
  Aegis.goto = (p) => (typeof aegisGoto === 'function' ? aegisGoto(p) : null);
  Aegis.lens = (k, silent) => (typeof aegisSetLens === 'function' ? aegisSetLens(k, silent) : null);
  Aegis.toast = (m, t) => (typeof toast === 'function' ? toast(m, t) : null);
})();
