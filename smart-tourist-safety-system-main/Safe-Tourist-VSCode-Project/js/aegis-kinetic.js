'use strict';
/* ============================================================================
   AEGISTRAVEL · KINETIC LAYER (v7)
   ----------------------------------------------------------------------------
   Turns the console into a tactile instrument:

   • Rotary "Intelligence Lens" dial (drag, click, arrow keys) that drives real
     map layers fed by js/mlRiskEngine.js: ML risk heatmap, Isolation-Forest
     path, all-India safe havens, night-shift prediction and the ledger.
   • Floating stress-test dock with live SVG risk / anomaly telemetry.
   • Pan-India search: any state, UT or mapped city becomes the subject's
     position and the ML model recomputes class, confidence and drivers.
   • Particle + glow cursor trail, magnetic controls and spring drawers, with a
     persisted Lite Mode for low-power devices.
   • A demo telemetry engine so every panel keeps moving with no Supabase.
   ========================================================================== */

(function () {
  'use strict';

  const $id = (x) => document.getElementById(x);
  const txt = (v) => (typeof esc === 'function' ? esc(v) : String(v == null ? '' : v));
  const num = (v, d) => (isFinite(Number(v)) ? Number(v) : d);

  const KIN = {
    lens: 'heat',
    night: false,
    lite: false,
    hist: [],
    isoHist: [],
    layers: null,
    dialBound: false,
    timers: [],
    liteReady: false
  };

  const LENS_META = {
    zones:  { label: 'INDIA',  title: 'All-India Zone Atlas',   chip: 'ALL INDIA ZONES', angle: 0 },
    heat:   { label: 'RISK',   title: 'ML Risk Field',          chip: 'ML RISK FIELD',   angle: 72 },
    path:   { label: 'FOREST', title: 'Isolation Forest Path',  chip: 'ISOLATION FOREST', angle: 144 },
    havens: { label: 'HAVENS', title: 'Safe Havens',            chip: 'SAFE HAVENS',     angle: 216 },
    night:  { label: 'NIGHT',  title: 'Night Shift',            chip: 'NIGHT SHIFT',     angle: 288 },
    ledger: { label: 'LEDGER', title: 'Blockchain Ledger',      chip: 'LEDGER',          angle: 0 }
  };
  const LENS_ORDER = ['zones', 'heat', 'path', 'havens', 'night'];

  /* --------------------------------------------------------------- helpers */
  function ml() { return (typeof MLRisk !== 'undefined') ? MLRisk : null; }

  function toneFor(score) {
    return score >= 68 ? 'safe' : score >= 40 ? 'warning' : 'danger';
  }
  function colorFor(score) {
    return score >= 68 ? '#25E6A5' : score >= 40 ? '#FFB020' : '#FF2A5F';
  }
  function currentPoint() {
    try { return aegisPoint(); } catch (e) { return { lat: 19.076, lng: 72.8777, accuracy: 25 }; }
  }
  function announce(msg) {
    const live = $id('srLive');
    if (live) live.textContent = msg;
  }
  function saveState() {
    try { if (typeof aegisSave === 'function') aegisSave(); } catch (e) {}
  }

  /* ==========================================================================
     1. LITE MODE + CURSOR TRAIL + MAGNETIC CONTROLS
     ========================================================================== */
  function applyLite(on, silent) {
    KIN.lite = !!on;
    if (window.Aegis) window.Aegis.lite = KIN.lite;
    document.body.classList.toggle('lite', KIN.lite);
    const btn = $id('liteToggle');
    if (btn) {
      btn.setAttribute('aria-pressed', KIN.lite ? 'true' : 'false');
      btn.textContent = KIN.lite ? '◉ Lite' : '◌ Lite';
    }
    if (typeof AEG !== 'undefined' && AEG.prefs) { AEG.prefs.lite = KIN.lite; saveState(); }
    if (KIN.lite && typeof KIN.trailReset === 'function') KIN.trailReset();
    if (!silent && typeof toast === 'function') toast(KIN.lite ? 'Lite Mode on — particles and glow suspended' : 'Lite Mode off — full kinetic rendering', 'info');
    announce(KIN.lite ? 'Lite mode enabled' : 'Lite mode disabled');
  }

  window.aegisToggleLite = function () { applyLite(!KIN.lite, false); };

  function initTrail() {
    const canvas = $id('fxTrail');
    if (!canvas || KIN.liteReady) return;
    KIN.liteReady = true;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0, h = 0;
    const parts = [];
    const halo = $id('fxHalo');
    let last = 0, lastPaint = 0, trailUnsub = null, haloQueued = false;
    let hx = 0, hy = 0;
    const FRAME_MS = 1000 / 30;   // decorative trail: 30 fps is indistinguishable
    const SPAWN_MS = 24;          // ≤ ~42 particles per second
    const MAX_PARTS = 90;

    function resize() {
      w = canvas.width = Math.floor(window.innerWidth * dpr);
      h = canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    function flushHalo() {
      haloQueued = false;
      if (!halo || KIN.lite) return;
      halo.style.opacity = '1';
      halo.style.transform = 'translate(' + hx + 'px,' + hy + 'px)';
    }

    // Runs on the shared Aegis ticker and only while particles exist.
    function step(dt, ts) {
      if (KIN.lite || !parts.length) {
        parts.length = 0;
        ctx.clearRect(0, 0, w / dpr, h / dpr);
        if (trailUnsub) { trailUnsub(); trailUnsub = null; }
        return;
      }
      if (ts - lastPaint < FRAME_MS) return;
      lastPaint = ts;
      ctx.clearRect(0, 0, w / dpr, h / dpr);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.012;
        p.life -= 0.03;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, p.life) * 0.55;
        ctx.fillStyle = p.hue;
        ctx.shadowBlur = 10;
        ctx.shadowColor = p.hue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.4 + p.life * 0.9), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    function kick() {
      if (KIN.lite || document.hidden) return;
      const ticker = window.Aegis && window.Aegis.ticker;
      if (!ticker || trailUnsub) return;
      trailUnsub = ticker.add(step);
    }

    KIN.trailReset = function () {
      parts.length = 0;
      if (trailUnsub) { trailUnsub(); trailUnsub = null; }
      ctx.clearRect(0, 0, w / dpr, h / dpr);
    };

    window.addEventListener('pointermove', (ev) => {
      if (KIN.lite) return;
      hx = ev.clientX; hy = ev.clientY;
      if (halo && !haloQueued) { haloQueued = true; requestAnimationFrame(flushHalo); }
      const now = performance.now();
      if (now - last < SPAWN_MS) return;
      last = now;
      parts.push({
        x: hx, y: hy,
        vx: (Math.random() - 0.5) * 0.9,
        vy: (Math.random() - 0.5) * 0.9 - 0.15,
        life: 1, r: 0.8 + Math.random() * 1.6,
        hue: Math.random() < 0.18 ? '#FFB020' : '#00F0FF'
      });
      if (parts.length > MAX_PARTS) parts.splice(0, parts.length - MAX_PARTS);
      kick();
    }, { passive: true });

    window.addEventListener('pointerleave', () => { if (halo) halo.style.opacity = '0'; });

    // Never burn frames in a hidden tab.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) KIN.trailReset();
    });
  }

  function initMagnetic() {
    document.addEventListener('pointermove', (ev) => {
      if (KIN.lite) return;
      const el = ev.target && ev.target.closest ? ev.target.closest('.sim-btn') : null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', Math.round(ev.clientX - r.left) + 'px');
      el.style.setProperty('--my', Math.round(ev.clientY - r.top) + 'px');
    }, { passive: true });
  }

  /* ==========================================================================
     2. ROTARY INTELLIGENCE LENS
     ========================================================================== */
  function applyArm(deg, animate) {
    const arm = $id('dialArm');
    if (!arm) return;
    arm.classList.toggle('is-dragging', !animate);
    arm.style.setProperty('--angle', deg + 'deg');
  }

  function paintDial() {
    const meta = LENS_META[KIN.lens] || LENS_META.heat;
    document.querySelectorAll('.dial-stop').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-lens') === KIN.lens);
      b.setAttribute('aria-pressed', b.getAttribute('data-lens') === KIN.lens ? 'true' : 'false');
    });
    KIN.angle = meta.angle;
    applyArm(meta.angle, true);
    const faceEl = document.querySelector('.dial-face');
    if (faceEl) faceEl.style.setProperty('--angle', meta.angle + 'deg');
    const label = $id('dialLabel');
    if (label) label.textContent = meta.label;
    const chip = $id('lensChip');
    if (chip) chip.textContent = meta.chip;
    const ring = $id('lensDial');
    if (ring) ring.setAttribute('data-lens', KIN.lens);
  }

  function bindDial() {
    const face = document.querySelector('.dial-face');
    // Guard per node, not per session: every page render replaces the dial, and
    // a session-wide flag left the fresh node without drag or arrow-key support.
    if (!face || face.dataset.dialBound) return;
    face.dataset.dialBound = '1';
    let dragging = false, lastAngle = 0, lastTime = 0, velocity = 0;

    function angleAt(ev) {
      const r = face.getBoundingClientRect();
      return Math.atan2(ev.clientX - (r.left + r.width / 2), -(ev.clientY - (r.top + r.height / 2))) * 180 / Math.PI;
    }

    face.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.dial-stop')) return;
      dragging = true;
      face.classList.add('is-dragging');
      lastAngle = angleAt(ev);
      lastTime = performance.now();
      velocity = 0;
      try { face.setPointerCapture(ev.pointerId); } catch (e) {}
    });

    // Inertial instrument: the arm follows the pointer continuously, then the
    // release velocity projects forward and snaps to the nearest 72° detent.
    face.addEventListener('pointermove', (ev) => {
      if (!dragging) return;
      const a = angleAt(ev);
      let delta = a - lastAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      const now = performance.now();
      const span = Math.max(8, now - lastTime);
      velocity = (delta / span) * 1000;
      KIN.angle = (KIN.angle || 0) + delta;
      lastAngle = a;
      lastTime = now;
      applyArm(KIN.angle, false);
      face.style.setProperty('--angle', KIN.angle + 'deg');
    });

    function release() {
      if (!dragging) return;
      dragging = false;
      face.classList.remove('is-dragging');
      // a flick may travel at most 2.5 detents, so the instrument never spins
      const fling = Math.max(-180, Math.min(180, velocity * 0.09));
      const projected = (KIN.angle || 0) + fling;
      const snapped = Math.round(projected / 72) * 72;
      KIN.angle = snapped;
      applyArm(snapped, true);
      face.style.setProperty('--angle', snapped + 'deg');
      const idx = ((Math.round(snapped / 72) % LENS_ORDER.length) + LENS_ORDER.length) % LENS_ORDER.length;
      const key = LENS_ORDER[idx];
      if (key !== KIN.lens) aegisSetLens(key);
      else paintDial();
      velocity = 0;
    }
    face.addEventListener('pointerup', release);
    face.addEventListener('pointercancel', release);

    const dial = face.closest('.lens-dial');
    if (dial) {
      dial.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
        ev.preventDefault();
        const i = LENS_ORDER.indexOf(KIN.lens);
        const next = (i + (ev.key === 'ArrowRight' ? 1 : LENS_ORDER.length - 1)) % LENS_ORDER.length;
        aegisSetLens(LENS_ORDER[next]);
      });
    }
  }

  window.aegisSetLens = function (key, silent) {
    if (!LENS_META[key]) return;
    KIN.lens = key;
    if (typeof AEG !== 'undefined' && AEG.prefs) AEG.prefs.lens = key;
    saveState();
    paintDial();
    if (key === 'ledger') {
      if (typeof aegisGoto === 'function') aegisGoto('vault');
      if (!silent && typeof toast === 'function') toast('Ledger lens — showing the SHA-256 evidence chain', 'info');
      return;
    }
    drawLens();
    if (!silent && typeof toast === 'function') toast(LENS_META[key].title + ' lens active', 'info');
    announce(LENS_META[key].title + ' lens');
  };

  function ensureLayers() {
    if (!window.L || !CMAP || !CMAP.m) return null;
    if (!KIN.layers) {
      KIN.layers = L.layerGroup().addTo(CMAP.m);
      let moveTimer = null;
      CMAP.m.on('moveend', () => {
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => drawLens(true), 420);
      });
    }
    return KIN.layers;
  }

  function drawLens(quiet) {
    const engine = ml();
    const group = ensureLayers();
    if (!group || !engine) {
      if (!quiet && typeof toast === 'function') toast('Map engine offline — telemetry lens still active', 'warning');
      return;
    }
    group.clearLayers();
    const p = currentPoint();
    const bounds = CMAP.m.getBounds();
    const center = [p.lat, p.lng];

    if (KIN.lens === 'zones') {
      const regions = engine.regions || [];
      regions.forEach(r => {
        if (!r.capital) return;
        const c = engine.classifyAt(r.capital[0], r.capital[1], { hour: KIN.night ? 1 : new Date().getHours() });
        L.circle([r.capital[0], r.capital[1]], {
          radius: 42000, stroke: colorFor(c.score), weight: 1, opacity: .5,
          dashArray: '3 5', fillColor: colorFor(c.score), fillOpacity: .1
        }).addTo(group).bindTooltip('<b>' + txt(r.name) + '</b><br/>' + txt(c.label) + ' · ' + c.score + '/100 · ' + c.confidence + '% conf', { direction: 'top' });
      });
      if (!quiet) toast(regions.length + ' states and UTs scored for the atlas', 'info');
    } else if (KIN.lens === 'heat' || KIN.lens === 'night') {
      const isNight = KIN.lens === 'night';
      const step = Math.max((bounds.getNorth() - bounds.getSouth()) / 9, (bounds.getEast() - bounds.getWest()) / 9, 0.004);
      const cells = [];
      for (let lat = bounds.getSouth(); lat <= bounds.getNorth(); lat += step) {
        for (let lng = bounds.getWest(); lng <= bounds.getEast(); lng += step) {
          if (cells.length >= 140) break;
          const c = engine.classifyAt(lat, lng, { hour: isNight ? 1 : new Date().getHours() });
          cells.push({ lat, lng, score: c.score, label: c.label });
        }
      }
      const radius = Math.max(120, step * 111320 * 0.55);
      cells.forEach(c => {
        L.circle([c.lat, c.lng], {
          radius, stroke: false, fillColor: colorFor(c.score), fillOpacity: isNight ? 0.20 : 0.15, interactive: false
        }).addTo(group);
      });
      if (!quiet) toast((isNight ? 'Night-shift' : 'ML risk') + ' heatmap · ' + cells.length + ' cells scored', 'info');
    } else if (KIN.lens === 'havens') {
      const havens = engine.safeHavens(p.lat, p.lng, 7);
      havens.forEach(h => {
        L.circleMarker([h.lat, h.lng], { radius: 5, color: '#04121A', weight: 1, fillColor: '#25E6A5', fillOpacity: 1 })
          .addTo(group)
          .bindTooltip('<b>' + txt(h.name) + '</b><br/>' + h.distance + ' m · ETA ' + h.eta + ' min', { direction: 'top' });
        L.circle([h.lat, h.lng], { radius: 90, stroke: false, fillColor: '#25E6A5', fillOpacity: 0.1, interactive: false }).addTo(group);
      });
      if (!quiet) toast(havens.length + ' verified safe havens mapped around ' + (engine.classifyAt(p.lat, p.lng).city || 'this point'), 'success');
    } else if (KIN.lens === 'path') {
      const trail = (typeof AEG !== 'undefined' && AEG.trail) ? AEG.trail.slice(-120) : [];
      if (trail.length < 2) {
        if (!quiet) toast('No trajectory yet — run Normal trip or Route hijack first', 'warning');
      } else {
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1], b = trail[i];
          const risk = num(b.risk, 30);
          L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
            color: colorFor(100 - risk), weight: 3, opacity: 0.9
          }).addTo(group);
        }
        const iso = engine.trajectoryAnomaly(trail, (AEG && AEG.sim && AEG.sim.route) || null);
        trail.forEach((pt, i) => {
          if (i % 4 !== 0) return;
          L.circleMarker([pt.lat, pt.lng], { radius: 2, stroke: false, fillColor: colorFor(100 - num(pt.risk, 30)), fillOpacity: 0.8 }).addTo(group);
        });
        if (iso.reasons.length) {
          L.circle(center, { radius: 260, color: '#FF2A5F', weight: 1.5, dashArray: '4 6', fillColor: '#FF2A5F', fillOpacity: 0.06 }).addTo(group);
        }
        if (!quiet) toast('Isolation Forest path · score ' + iso.score.toFixed(2) + ' · ' + iso.label, iso.score > 0.2 ? 'warning' : 'info');
      }
    }
    if (!quiet && KIN.lens !== 'heat' && KIN.lens !== 'night' && KIN.lens !== 'havens' && KIN.lens !== 'path') {
      /* ledger handled above */
    }
  }

  /* ==========================================================================
     3. PAN-INDIA SEARCH + SUBJECT RELOCATION
     ========================================================================== */
  window.aegisIndiaSearch = function (q) {
    const engine = ml();
    const box = $id('indiaResults');
    if (!box || !engine) return;
    const query = String(q || '').trim();
    if (!query) { box.hidden = true; box.innerHTML = ''; return; }
    const results = engine.searchIndia(query, 7);
    if (!results.length) {
      box.hidden = false;
      box.innerHTML = '<div class="mr-empty">No state, UT or mapped city matches “' + txt(query) + '”.</div>';
      return;
    }
    box.hidden = false;
    box.innerHTML = results.map((r, i) => {
      const c = engine.classifyAt(r.lat, r.lng, { hour: KIN.night ? 1 : new Date().getHours() });
      return '<button class="mr-item" data-i="' + i + '" onclick="aegisFlyTo(' + r.lat + ',' + r.lng + ',\'' + txt(r.name).replace(/'/g, '') + '\')">' +
        '<span><b>' + txt(r.name) + '</b><small>' + txt(r.sub) + '</small></span>' +
        '<span class="mr-score" style="color:' + colorFor(c.score) + '">' + c.score + '</span></button>';
    }).join('');
  };

  window.aegisIndiaKey = function (ev) {
    const box = $id('indiaResults');
    if (!box) return;
    if (ev.key === 'Escape') { box.hidden = true; ev.target.blur(); return; }
    if (ev.key === 'Enter') {
      const first = box.querySelector('.mr-item');
      if (first) { ev.preventDefault(); first.click(); }
    }
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      const first = box.querySelector('.mr-item');
      if (first) first.focus();
    }
  };

  window.aegisFlyTo = function (lat, lng, name) {
    const la = num(lat, NaN), ln = num(lng, NaN);
    if (!isFinite(la) || !isFinite(ln)) return;
    const engine = ml();
    const target = (typeof aegisSubject === 'function') ? aegisSubject() : null;
    if (target) { target.lat = la; target.lng = ln; target.accuracy = 18; target.locationSource = 'gps'; }
    try { S.loc = { lat: la, lng: ln, accuracy: 18 }; } catch (e) {}
    if (typeof S !== 'undefined' && S.trackedTouristId && AEG && AEG.fleet) {
      const f = AEG.fleet.find(x => x.id === S.trackedTouristId);
      if (f) { f.lat = la; f.lng = ln; }
    }
    const box = $id('indiaResults');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    const input = $id('indiaSearch');
    if (input) { input.value = name || (engine ? (engine.nearestCity(la, ln).city || {}).n || '' : ''); input.blur(); }

    if (CMAP && CMAP.m) {
      CMAP.m.setView([la, ln], 14, { animate: true });
      if (typeof aegisDrawSubject === 'function') aegisDrawSubject();
      if (typeof aegisDrawFleet === 'function') aegisDrawFleet();
      drawLens(true);
    }
    const c = engine ? engine.classifyAt(la, ln, { hour: KIN.night ? 1 : new Date().getHours() }) : null;
    if (c) {
      if (typeof aegisLedgerAppend === 'function') {
        aegisLedgerAppend('LOCATION_JUMP', 'Subject relocated to ' + (name || c.city || c.region), {
          lat: la, lng: ln, predicted: c.label, confidence: c.confidence, region: c.region
        });
      }
      if (typeof toast === 'function') toast((name || c.city || c.region) + ' · ' + c.label + ' (' + c.confidence + '% conf)', c.tone === 'danger' ? 'danger' : c.tone === 'warning' ? 'warning' : 'success');
      announce('Relocated to ' + (name || c.region) + '. Predicted ' + c.label);
    }
    saveState();
    paintIntel();
    if (typeof aegisPaintLive === 'function') aegisPaintLive();
    // shared-element style focus on the telemetry card that now describes this place
    const card = $id('zoneIntel');
    if (card) {
      card.classList.remove('is-focus');
      void card.offsetWidth;
      card.classList.add('is-focus');
      setTimeout(() => card.classList.remove('is-focus'), 1200);
    }
  };

  window.aegisSimPane = function (pane) {
    const dock = $id('simDock');
    if (!dock) return;
    const p = pane === 'cine' ? 'cine' : 'sim';
    KIN.pane = p;
    dock.dataset.pane = p;
    dock.querySelectorAll('.sim-tab').forEach(b => b.classList.toggle('active', b.dataset.pane === p));
    if (window.Aegis && Aegis.map) Aegis.map.refresh(320);
  };

  /* ==========================================================================
     4. ML TELEMETRY PANELS
     ========================================================================== */
  function zoneIntelHTML(c) {
    if (!c) return '<div class="ml-sub">ML engine loading…</div>';
    const head = '<div class="ml-head"><span class="ml-class ' + c.tone + '">' + txt(c.label) + '</span>' +
      '<span class="ml-conf">' + c.confidence + '% CONF</span></div>';
    const sub = '<div class="ml-sub">' + txt(c.city || c.region) + ' · ' + txt(c.regionType || '') + ' · score ' + c.score + '/100' + (c.night ? ' · night prior' : '') + '</div>';
    const bars = c.factors.slice(0, 3).map(f =>
      '<div class="ml-bar"><div class="t"><i style="width:' + Math.max(4, Math.min(100, f.share)) + '%"></i></div><span>' + Math.round(f.share) + '%</span></div>'
    ).join('');
    const labels = c.factors.slice(0, 3).map(f => txt(f.label)).join(' · ');
    return head + sub + '<div class="ml-bars">' + bars + '</div>' +
      '<div class="ml-sub" style="margin-top:6px">' + labels + '</div>' +
      '<button class="btn tiny wide" style="margin-top:8px" onclick="aegisGoto(\'intel\')">Open ML intelligence →</button>';
  }

  function sparkPath(values, min, max) {
    if (values.length < 3) return { line: '', area: '' };
    const w = 240, h = 42, pad = 3;
    const span = Math.max(1e-6, max - min);
    const pts = values.map((v, i) => {
      const x = values.length === 1 ? w / 2 : (i / (values.length - 1)) * w;
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return [x, y];
    });
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = line + ' L' + w + ' ' + h + ' L0 ' + h + ' Z';
    return { line, area };
  }

  function paintIntel() {
    const engine = ml();
    const p = currentPoint();
    let c = null;
    try {
      c = engine ? engine.classifyAt(p.lat, p.lng, {
        hour: KIN.night ? 1 : new Date().getHours(),
        solo: !!(typeof AEG !== 'undefined' && AEG.pulse && AEG.pulse.active)
      }) : null;
    } catch (e) { c = null; }

    const host = $id('zoneIntel');
    if (host && c) {
      const key = c.label + '|' + c.score + '|' + c.confidence + '|' + c.city + '|' + (KIN.night ? 'n' : 'd');
      if (KIN.intelKey !== key || !host.firstChild) {
        KIN.intelKey = key;
        host.innerHTML = zoneIntelHTML(c);
      }
    }

    const riskEl = $id('sparkRisk');
    if (riskEl && c) riskEl.textContent = c.score;
    const lensLabel = $id('lensChip');
    if (lensLabel) lensLabel.textContent = (LENS_META[KIN.lens] || LENS_META.heat).chip;

    let iso = { score: 0, label: 'NOMINAL' };
    const trail = (typeof AEG !== 'undefined' && AEG.trail) ? AEG.trail : [];
    if (engine && trail.length > 2) {
      try { iso = engine.trajectoryAnomaly(trail, (AEG.sim && AEG.sim.route) || null); } catch (e) {}
    }
    const isoEl = $id('sparkIso');
    if (isoEl) isoEl.textContent = (iso.score > 0 ? '+' : '') + iso.score.toFixed(2);

        // Sparkline sampling + repaint are throttled: one sample per second and no
    // DOM write when the geometry has not changed.
    const risk = $id('riskSpark'), area = $id('riskSparkArea'), isoS = $id('isoSpark');
    if (c && risk) {
      const now = performance.now();
      if (now - (KIN.lastSample || 0) >= 1000) {
        KIN.lastSample = now;
        KIN.hist.push(c.score);
        KIN.isoHist.push(Math.round((iso.score + 1) * 50));
        if (KIN.hist.length > 46) KIN.hist.shift();
        if (KIN.isoHist.length > 46) KIN.isoHist.shift();
        const rp = sparkPath(KIN.hist, 0, 100);
        const ip = sparkPath(KIN.isoHist, 0, 100);
        if (risk.getAttribute('d') !== rp.line) risk.setAttribute('d', rp.line);
        if (area && area.getAttribute('d') !== rp.area) area.setAttribute('d', rp.area);
        if (isoS && isoS.getAttribute('d') !== ip.line) isoS.setAttribute('d', ip.line);
      }
    }

    const nightBtn = $id('dayNightBtn');
    if (nightBtn) {
      nightBtn.textContent = KIN.night ? '☾ NIGHT' : '☀ DAY';
      nightBtn.setAttribute('data-mode', KIN.night ? 'night' : 'day');
    }
  }

  /* ==========================================================================
     5. DAY/NIGHT + STRESS TEST
     ========================================================================== */
  window.aegisToggleDayNight = function () {
    KIN.night = !KIN.night;
    document.body.classList.toggle('is-night', KIN.night);
    if (typeof AEG !== 'undefined' && AEG.prefs) AEG.prefs.night = KIN.night;
    saveState();
    const p = currentPoint();
    const engine = ml();
    const d = engine ? engine.dayNightShift(p.lat, p.lng) : null;
    if (d && typeof aegisLedgerAppend === 'function') {
      aegisLedgerAppend('ML_DAY_NIGHT', 'ML day/night prior switched', {
        night: KIN.night, dayScore: d.day.score, nightScore: d.night.score, shift: d.label
      });
    }
    paintIntel();
    drawLens(true);
    if (typeof toast === 'function') {
      toast(KIN.night ? 'Night prior applied · score ' + (d ? d.night.score : '—') + ' (−' + (d ? Math.abs(d.delta) : 0) + ')' : 'Daylight prior applied · score ' + (d ? d.day.score : '—'), KIN.night ? 'warning' : 'info');
    }
    announce(KIN.night ? 'Night prediction active' : 'Daylight prediction active');
    if (typeof aegisPaintLive === 'function') aegisPaintLive();
  };

  window.aegisStressTest = function () {
    KIN.timers.forEach(t => clearTimeout(t));
    KIN.timers = [];
    if (typeof toast === 'function') toast('Stress test started — normal → hijack → dead-man SOS', 'info');
    if (typeof aegisLedgerAppend === 'function') aegisLedgerAppend('STRESS_TEST', 'Synthetic stress test initiated', { sequence: ['normal', 'deviation', 'sos'] });
    if (S.page !== 'command' && typeof aegisGoto === 'function') aegisGoto('command');

    KIN.timers.push(setTimeout(() => { try { aegisStartScenario('normal'); } catch (e) {} }, 80));
    KIN.timers.push(setTimeout(() => { try { aegisStartScenario('deviation'); } catch (e) {} }, 2600));
    KIN.timers.push(setTimeout(() => { try { aegisStartScenario('sos'); } catch (e) {} }, 7200));
    KIN.timers.push(setTimeout(() => {
      paintIntel();
      if (typeof toast === 'function') toast('Stress test complete — evidence block sealed', 'success');
      announce('Stress test complete');
    }, 9200));
  };

  /* ==========================================================================
     6. FULL ML INTELLIGENCE PAGE
     ========================================================================== */
  window.aegisIntelPage = function () {
    const engine = ml();
    const p = currentPoint();
    if (!engine) return '<div class="card"><div class="feed-empty">ML engine unavailable.</div></div>';
    const c = engine.classifyAt(p.lat, p.lng, { hour: KIN.night ? 1 : new Date().getHours() });
    const dn = engine.dayNightShift(p.lat, p.lng);
    const trail = (typeof AEG !== 'undefined' && AEG.trail) ? AEG.trail : [];
    const iso = engine.trajectoryAnomaly(trail, (AEG.sim && AEG.sim.route) || null);

    const factorRows = c.factors.map(f =>
      '<div class="bar-row"><div class="bl"><span>' + txt(f.label) + '</span><span>' + (f.impact > 0 ? '+' : '') + f.impact.toFixed(2) + '</span></div>' +
      '<div class="bar-track"><div class="bar-fill ' + (f.impact > 0.25 ? 'bad' : f.impact > 0.1 ? 'warn' : '') + '" style="width:' + Math.max(4, Math.min(100, f.share)) + '%"></div></div>' +
      '<div class="bl"><span class="faint">feature ' + f.value + '/100 · ' + Math.round(f.share) + '% of drivers</span></div></div>'
    ).join('');

    const regions = engine.regions.map(r => {
      const rc = engine.classifyAt(r.capital[0], r.capital[1], { hour: KIN.night ? 1 : new Date().getHours() });
      return '<button class="region-chip" onclick="aegisFlyTo(' + r.capital[0] + ',' + r.capital[1] + ',\'' + txt(r.name).replace(/'/g, '') + '\')">' +
        '<b>' + txt(r.name) + '</b><span style="color:' + colorFor(rc.score) + '">' + rc.score + ' · ' + txt(rc.label.replace('HIGH-RISK DANGER', 'HIGH')) + '</span>' +
        '<i><em style="width:' + rc.score + '%;background:' + colorFor(rc.score) + '"></em></i></button>';
    }).join('');

    const havens = c.havens.map(h =>
      '<div class="row"><div><b>' + txt(h.name) + '</b><small>' + h.distance + ' m · ETA ' + h.eta + ' min</small></div><span class="badge safe">HAVEN</span></div>'
    ).join('');

    return '<div class="stack" style="gap:12px">' +
      '<div class="card">' +
        '<div class="between" style="gap:12px;align-items:flex-start">' +
          '<div><span class="eyebrow no-rule">Pan-India spatial model · 28 states · 8 UTs · ' + engine.stats.cities + ' city anchors</span>' +
          '<h2 style="margin:4px 0 2px;font-size:22px">' + txt(c.city || c.region) + '</h2>' +
          '<div class="muted" style="font-size:11.5px">' + txt(c.region) + ' · ' + txt(c.regionType) + ' · ' + p.lat.toFixed(4) + ', ' + p.lng.toFixed(4) + '</div></div>' +
          '<div style="text-align:right"><div class="intel-big" style="color:' + colorFor(c.score) + '">' + c.score + '</div>' +
          '<span class="badge ' + c.tone + '">' + txt(c.label) + '</span>' +
          '<div class="kicker" style="margin-top:6px">' + c.confidence + '% model confidence</div></div>' +
        '</div>' +
        '<div class="hstack" style="margin-top:10px;flex-wrap:wrap;gap:6px">' +
          '<span class="chip">ISO ' + iso.score.toFixed(2) + ' · ' + iso.label + '</span>' +
          '<span class="chip">Day ' + dn.day.score + ' → Night ' + dn.night.score + '</span>' +
          '<span class="chip">' + txt(dn.label) + '</span>' +
          '<span class="chip">' + (c.night ? 'NIGHT PRIOR' : 'DAYLIGHT PRIOR') + '</span>' +
        '</div>' +
        '<div class="actions" style="margin-top:10px">' +
          '<button class="btn tiny" onclick="aegisToggleDayNight()">Switch day / night prediction</button>' +
          '<button class="btn tiny" onclick="aegisSetLens(\'night\')">Night lens</button>' +
          '<button class="btn tiny primary" onclick="aegisSetLens(\'heat\')">Show on map</button>' +
        '</div>' +
        '<div class="panel-title" style="margin-top:14px"><h4>Why the model flagged this</h4><span class="kicker">feature importance</span></div>' +
        factorRows +
      '</div>' +

      '<div class="split-2">' +
        '<div class="card"><div class="panel-title"><h4>Trajectory anomaly</h4><span class="badge ' + (iso.score > 0.55 ? 'danger-b' : iso.score > 0.2 ? 'warning' : 'safe') + '">' + iso.label + '</span></div>' +
          '<div class="intel-big" style="font-size:34px;color:' + (iso.score > 0.2 ? '#FF6E92' : '#25E6A5') + '">' + (iso.score > 0 ? '+' : '') + iso.score.toFixed(2) + '</div>' +
          '<div class="muted" style="font-size:11px">Isolation Forest ensemble over 64 trees · ' + iso.points + ' points</div>' +
          (iso.reasons.length ? iso.reasons.map(r => '<div class="notice warning" style="margin-top:8px;font-size:11px"><b>' + txt(r.code) + '</b><br/>' + txt(r.text) + '</div>').join('') : '<div class="feed-empty" style="margin-top:10px">Movement matches the normal transit manifold.</div>') +
          '<div class="actions" style="margin-top:10px"><button class="btn tiny" onclick="aegisSetLens(\'path\')">Render path lens</button>' +
          '<button class="btn tiny" onclick="aegisStressTest()">Run stress test</button></div>' +
        '</div>' +
        '<div class="card"><div class="panel-title"><h4>Safe havens nearby</h4><span class="chip">' + txt(c.region) + '</span></div>' + havens +
          '<div class="notice" style="margin-top:10px;font-size:11px">Distance is modelled from haven density and ETA from a 320 m/min response speed.</div>' +
        '</div>' +
      '</div>' +

      '<div class="card"><div class="panel-title"><h4>All-India zone predictions</h4><span class="kicker">click a region to relocate the subject</span></div>' +
        '<div class="region-grid">' + regions + '</div>' +
      '</div>' +
    '</div>';
  };

  /* ==========================================================================
     7. DEMO TELEMETRY ENGINE (no Supabase required)
     ========================================================================== */
  function tickDemo() {
    if (!document.body || document.body.classList.contains('hidden') || document.hidden) return;
    try { paintIntel(); } catch (e) {}
    if (typeof AEG !== 'undefined' && AEG.fleet && AEG.fleet.length && S.role === 'authority') {
      AEG.fleet.forEach(f => {
        if (Math.random() > 0.35) return;
        f.lat += (Math.random() - 0.5) * 0.00012;
        f.lng += (Math.random() - 0.5) * 0.00012;
        f.risk = Math.max(6, Math.min(96, Math.round(f.risk + (Math.random() - 0.5) * 3)));
        if (CMAP && CMAP.fleetMarkers && CMAP.fleetMarkers[f.id]) {
          try { CMAP.fleetMarkers[f.id].setLatLng([f.lat, f.lng]); } catch (e) {}
        }
      });
    }
    if (typeof aegisPaintChrome === 'function') { try { aegisPaintChrome(); } catch (e) {} }
  }

  /* ==========================================================================
     8. BOOT + HOOKS
     ========================================================================== */
  let compactApplied = false;
  function syncViewport() {
    const root = $id('cmdRoot');
    if (!root) return;
    if (window.innerWidth <= 1100) {
      // Each render replaces #cmdRoot, so mark the new node and close once.
      if (!root.dataset.kinCompact) {
        root.dataset.kinCompact = '1';
        root.classList.add('no-left', 'no-right');
      }
      compactApplied = true;
    } else if (compactApplied) {
      compactApplied = false;
      root.classList.remove('no-left', 'no-right');
      // Clear the per-node marker too: without this, shrinking the window from
      // desktop to tablet skips the close pass and both overlays cover the map.
      root.dataset.kinCompact = '';
    }
  }
  window.addEventListener('resize', () => { syncViewport(); }, { passive: true });

  function kinAfter(page) {
    if (page === 'command') {
      syncViewport();
      KIN.intelKey = null;
      bindDial();
      paintDial();
      initTrail();
      paintIntel();
      if (KIN.lens !== 'ledger') drawLens(true);
    } else {
      paintIntel();
    }
  }

  const prevAfter = window.aegisAfterRender;
  window.aegisAfterRender = function (page) {
    try { if (typeof prevAfter === 'function') prevAfter(page); } catch (e) { console.error('base afterRender', e); }
    try { kinAfter(page); } catch (e) { console.error('kinetic afterRender', e); }
  };

  const prevRender = window.aegisRender;
  window.aegisRender = function (page) {
    if (page === 'intel') {
      try { return aegisIntelPage(); } catch (e) { console.error('intel render', e); return null; }
    }
    return typeof prevRender === 'function' ? prevRender(page) : null;
  };

  function boot() {
    const prefs = (typeof AEG !== 'undefined' && AEG.prefs) ? AEG.prefs : {};
    KIN.lens = LENS_META[prefs.lens] ? prefs.lens : 'heat';
    KIN.night = !!prefs.night;
    applyLite(!!prefs.lite, true);
    if (KIN.night) document.body.classList.add('is-night');
    initMagnetic();
    initTrail();
    paintDial();
    setInterval(tickDemo, 1500);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { try { paintIntel(); } catch (e) {} } });
    paintIntel();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  // Global guard: a single broken legacy control must never blank the console.
  window.addEventListener('error', function (ev) {
    try {
      const src = String(ev.filename || '');
      // CDN fetch failures are expected offline and must not spam the operator.
      if (/unpkg|jsdelivr|cdnjs|fonts\.googleapis/.test(src)) return;
      console.error('[Aegis] contained error:', ev.message, src + ':' + ev.lineno);
      if (typeof toast === 'function') toast('Interface error contained — ' + String(ev.message || 'unknown').slice(0, 70), 'danger');
    } catch (e) {}
  });
  window.addEventListener('unhandledrejection', function (ev) {
    try {
      // Optional cloud calls (Supabase, GPS) reject harmlessly in demo mode.
      console.warn('[Aegis] background request skipped:', (ev.reason && ev.reason.message) || ev.reason);
    } catch (e) {}
  });

  // Public helpers used by the shell.
  window.aegisKinetic = {
    KIN, applyLite, paintIntel, drawLens,
    lens: () => KIN.lens,
    setNight: (v) => { if (!!v !== KIN.night) aegisToggleDayNight(); }
  };
})();
