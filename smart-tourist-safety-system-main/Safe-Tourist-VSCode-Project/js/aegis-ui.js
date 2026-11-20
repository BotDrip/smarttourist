'use strict';
/* ============================================================================
   AEGISTRAVEL UI — tactical command center
   ----------------------------------------------------------------------------
   Split-pane workspace: collapsible anomaly/pulse drawer · Leaflet stage with
   simulation dock · tabbed intelligence drawer (Copilot / ID Vault / Dispatch).
   Renders dedicated pages for command, pulse, vault, copilot, fleet, dispatch
   and billing while leaving every legacy app.js page untouched.
   ========================================================================== */

const CMAP = { m: null, layers: null, subject: null, halo: null, route: null, dev: null, replay: null, dispatch: null, heat: [], fleetMarkers: {} };
let AEG_QR_TIMER = null;
let AEG_PAINT_TICK = 0;

const AEGIS_TITLES = {
  command: 'Command Center', pulse: 'Safety Pulse', vault: 'Digital ID Vault',
  copilot: 'Risk Copilot', fleet: 'Fleet Monitor', dispatch: 'Incident Dispatch',
  billing: 'Plans & Billing', intel: 'ML Risk Intelligence'
};
const AEGIS_ICONS = {
  command: '⌖', pulse: '♡', vault: '◇', copilot: '✦', fleet: '◎', dispatch: '↗', billing: '◆', intel: '◈'
};

/* --------------------------------------------------------------- navigation */
function aegisDefaultPage() { return 'command'; }

function aegisRenderNav() {
  const tourist = [
    { label: 'OPERATIONS', items: [['command', 'Command Center', '⌖']] },
    { label: 'TRAVELER', items: [['pulse', 'Safety Pulse', '♡', AEG.pulse.active ? 'ARMED' : ''], ['vault', 'Digital ID Vault', '◇'], ['copilot', 'Risk Copilot', '✦'], ['intel', 'ML Risk Intelligence', '◈']] },
    { label: 'SAFETY', items: [['location', 'Live Location', '⌖'], ['zones', 'Safety Zones', '◌'], ['ai', 'AI Safety', '✦'], ['sos', 'Emergency / SOS', '!'], ['medical', 'Medical Contact', '♡'], ['incidents', 'My Incidents', '≡']] },
    { label: 'ACCOUNT', items: [['profile', 'Profile', '○'], ['billing', 'Plans & Billing', '◆', AEG.tier === 'free' ? 'PRO' : ''], ['settings', 'Settings & Data', '⚙']] }
  ];
  const authority = [
    { label: 'COMMAND', items: [['command', 'Command Center', '⌖'], ['fleet', 'Fleet Monitor', '◎', '56'], ['dispatch', 'Incident Dispatch', '↗'], ['copilot', 'Risk Copilot', '✦'], ['intel', 'ML Risk Intelligence', '◈']] },
    { label: 'MONITORING', items: [['monitor', 'Tourist Monitoring', '◎'], ['locations', 'Live Locations', '⌖'], ['alerts', 'Geofence Alerts', '△'], ['ai', 'AI Incident Analysis', '✦'], ['vault', 'ID Verification', '◇']] },
    { label: 'RESPONSE', items: [['incidents', 'Incident Management', '≡'], ['response', 'Emergency Response', '↗'], ['zones', 'Danger Zones', '◌'], ['reports', 'Reports', '▤'], ['billing', 'Plans & Billing', '◆', AEG.tier === 'enterprise' ? '' : 'UPGRADE']] }
  ];
  const groups = S.role === 'tourist' ? tourist : authority;
  const html = groups.map(g => '<div class="nav-label">' + g.label + '</div>' + g.items.map(([id, label, icon, pill]) => {
    if (id === 'settings') return '<button onclick="aegisOpenSettings()"><span class="ni">' + icon + '</span><span class="label">' + label + '</span></button>';
    const active = S.page === id ? 'active' : '';
    return '<button class="' + active + '" onclick="aegisGoto(\'' + id + '\')" title="' + esc(label) + '">' +
      '<span class="ni">' + icon + '</span><span class="label">' + esc(label) + '</span>' +
      (pill ? '<span class="pill ' + (pill === 'PRO' || pill === 'UPGRADE' ? 'pro' : '') + '">' + pill + '</span>' : '') +
      '</button>';
  }).join('')).join('');
  const nav = $('nav');
  if (nav) nav.innerHTML = html;
}

function aegisGoto(page) {
  if (!page) return;
  S.page = page;
  if (typeof renderNav === 'function') renderNav();
  if (typeof render === 'function') render();
  const content = $('content');
  if (content) content.scrollTop = 0;
}

function aegisSwitchRole(role) {
  if (!role || role === S.role) return;
  aegisStopScenario(true);
  S.role = role;
  S.page = 'command';
  S.trackedTouristId = null;
  AEG.sim.ifScore = 0;
  if (role === 'authority') aegisSeedFleet(false);
  aegisNotify('info', role === 'tourist' ? 'Tourist mode engaged' : 'Enterprise command mode engaged',
    role === 'tourist' ? 'Personal safety companion, pulse and ID vault active.' : '56-tourist fleet, SLA timers and bulk broadcast active.');
  if (typeof renderNav === 'function') renderNav();
  if (typeof render === 'function') render();
  if (typeof toast === 'function') toast(role === 'tourist' ? 'Switched to Tourist mode' : 'Switched to Enterprise command mode', 'info');
}

/* ------------------------------------------------------------------ chrome */
function aegisPaintChrome() {
  const tier = AEGIS_TIERS[AEG.tier] || AEGIS_TIERS.free;
  const pill = $('tierPill');
  if (pill) {
    pill.textContent = tier.label;
    pill.className = 'tier-badge ' + (AEG.tier === 'free' ? '' : AEG.tier);
  }
  const rt = $('roleTouristBtn'), rc = $('roleCommandBtn');
  if (rt) rt.classList.toggle('active', S.role === 'tourist');
  if (rc) rc.classList.toggle('active', S.role === 'authority');
  const mode = $('sideMode');
  if (mode) mode.textContent = S.role === 'tourist' ? 'TOURIST' : 'ENTERPRISE';
  const upgrade = $('sideUpgrade');
  if (upgrade) upgrade.style.display = AEG.tier === 'free' ? '' : 'none';
  const title = $('pageTitle');
  if (title) title.textContent = AEGIS_TITLES[S.page] || (typeof titles !== 'undefined' ? (titles[S.page] || 'Overview') : 'Overview');
  const roleLabel = $('roleLabel');
  if (roleLabel) roleLabel.textContent = S.role === 'tourist' ? 'Tourist portal · B2C' : 'Enterprise command · B2B';
  if (S.user) {
    const nameEl = $('userName'), roleEl = $('userRole'), av = $('avatar');
    if (nameEl) nameEl.textContent = S.user.name || 'Traveler';
    if (roleEl) roleEl.textContent = S.role === 'tourist' ? 'Tourist' : 'Commander';
    if (av) av.textContent = String(S.user.name || 'A').split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
  }
  const risk = aegisRiskContext();
  const sb = (id, v) => { const el = $(id); if (el) el.innerHTML = v; };
  sb('sbCloud', isCloudConnected ? '<b style="color:var(--mint)">SUPABASE</b>' : '<b>LOCAL</b>');
  sb('sbBattery', (AEG.battery.level != null ? AEG.battery.level + '%' : '—') + (AEG.battery.charging ? ' ⚡' : ''));
  sb('sbNet', (S.net || 'ONLINE'));
  sb('sbRisk', '<b style="color:' + (risk.score >= 70 ? 'var(--mint)' : risk.score >= 45 ? 'var(--amber)' : 'var(--red)') + '">' + risk.score + '</b>');
  sb('sbLedger', AEG.ledger.length + ' BLOCKS');
  sb('sbPulse', AEG.pulse.active ? '<b style="color:var(--amber)">' + aegisFmtDur(aegisPulseRemaining()) + '</b>' : 'STANDBY');
  sb('sbStealth', AEG.stealth.on ? '<b style="color:var(--amber)">STEALTH ON</b>' : 'STEALTH OFF');
  sb('sbNode', S.role === 'tourist' ? 'PERSONAL' : 'MUM-01');
}

/* --------------------------------------------------------------- fragments */
function aegisRing(pct, size, stroke, id, color) {
  const r = (size / 2) - (stroke / 2);
  const c = 2 * Math.PI * r;
  const offset = c * (1 - aegisClamp(pct, 0, 1));
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="width:100%;height:100%">' +
    '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="rgba(140,200,225,.14)" stroke-width="' + stroke + '"/>' +
    '<circle id="' + id + '" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '" style="transition:stroke-dashoffset .5s ease"/>' +
    '</svg>';
}

function aegisFeedHTML(limit) {
  const items = AEG.feed.slice(0, limit || 30);
  if (!items.length) return '<div class="feed-empty">No anomaly events yet.<br/>Run a simulation from the map dock.</div>';
  return items.map(f => {
    const cls = f.level === 'high' ? 'sev-high' : f.level === 'med' ? 'sev-med' : f.level === 'ok' ? 'sev-ok' : '';
    return '<div class="feed-item ' + cls + '"><div class="fi-top"><b>' + esc(f.title) + '</b><span class="fi-time">' + aegisRelTime(f.ts) + '</span></div>' +
      (f.desc ? '<p>' + esc(f.desc) + '</p>' : '') + '</div>';
  }).join('');
}

function aegisFactorBarsHTML(risk) {
  return risk.factors.map(f => {
    const pct = aegisClamp(Math.abs(f.impact) / (f.weight || 30) * 100, 0, 100);
    const cls = f.impact < 0 ? '' : f.impact >= 18 ? 'bad' : f.impact >= 8 ? 'warn' : '';
    return '<div class="bar-row"><div class="bl"><span>' + esc(f.label) + '</span><span>' + (f.impact > 0 ? '+' : '') + f.impact + '</span></div>' +
      '<div class="bar-track"><div class="bar-fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
      '<div class="bl"><span class="faint">' + esc(f.value) + '</span></div></div>';
  }).join('');
}

function aegisPulseMiniHTML() {
  const rem = aegisPulseRemaining();
  const total = AEG.pulse.interval || 900000;
  const pct = AEG.pulse.active ? rem / total : 1;
  return '<div class="pulse-ring">' + aegisRing(pct, 52, 4, 'pulseArcMini', AEG.pulse.active ? (rem < 60000 ? 'var(--red)' : 'var(--amber)') : 'var(--mint)') +
    '<div class="t" id="pulseMiniText">' + (AEG.pulse.active ? aegisFmtDur(rem) : '—') + '</div></div>' +
    '<div class="pulse-copy"><b>' + (AEG.pulse.active ? 'Dead-man switch armed' : 'Safety pulse standby') + '</b>' +
    '<small id="pulseMiniSub">' + (AEG.pulse.active ? 'Auto-SOS on expiry' : 'Arm before solo transit') + '</small>' +
    (AEG.pulse.active
      ? '<button class="btn tiny green wide" style="margin-top:6px" onclick="aegisPulseSafe(\'mini\')">I’m safe</button>'
      : '<button class="btn tiny wide" style="margin-top:6px" onclick="aegisGoto(\'pulse\')">Arm pulse →</button>') +
    '</div>';
}

function aegisSideTitle(tab) {
  return { copilot: 'AI Safety Copilot', vault: 'Digital ID Vault', pulse: 'Safety Pulse', dispatch: 'Incident Dispatch', fleet: 'Fleet Telemetry', alerts: 'Scam Radar' }[tab] || 'Intelligence';
}

function aegisTabsForRole() {
  return S.role === 'tourist'
    ? ['copilot', 'vault', 'pulse', 'alerts']
    : ['dispatch', 'fleet', 'copilot', 'vault'];
}

/* ------------------------------------------------------------------ command */
function aegisCommandPage() {
  const ent = S.role === 'authority';
  const tabs = aegisTabsForRole();
  if (tabs.indexOf(AEG.prefs.sideTab) < 0) AEG.prefs.sideTab = tabs[0];
  const tab = AEG.prefs.sideTab;
  const mode = AEG.sim.mode;
  const replay = AEG.sim.replay.active;
  return '' +
    '<div class="cmd ' + (AEG.prefs.drawerLeft ? '' : 'no-left ') + (AEG.prefs.drawerRight ? '' : 'no-right') + '" id="cmdRoot">' +
      '<section class="drawer drawer-left">' +
        '<div class="drw-head"><div><span class="drw-kicker">TELEMETRY</span><h3><i class="live-dot"></i> Live anomaly feed</h3></div>' +
          '<button class="icon-btn" onclick="aegisToggleDrawer(\'left\')" title="Collapse drawer">‹</button></div>' +
        '<div class="drw-body">' +
          '<div id="pulseMiniWrap">' + aegisPulseMiniHTML() + '</div>' +
          '<div class="ml-mini" id="zoneIntel"></div>' +
          '<div class="panel-title" style="margin-top:14px"><h4>Event stream</h4><span class="chip" id="feedCount">' + AEG.feed.length + '</span></div>' +
          '<div class="feed" id="feedHost">' + aegisFeedHTML(26) + '</div>' +
          '<div class="panel-title" style="margin-top:16px"><h4>Risk factors</h4><button class="icon-btn" onclick="aegisGoto(\'copilot\')" title="Full copilot">↗</button></div>' +
          '<div id="factorHostMini">' + aegisFactorBarsHTML(aegisRiskContext()) + '</div>' +
        '</div>' +
        '<div class="drw-foot"><button class="btn tiny wide" onclick="aegisOfflinePanel()">◐ Offline beacon cache</button></div>' +
      '</section>' +
      '<section class="stage"><div class="mapwrap">' +
        '<div class="cmd-map" id="cmdMap"></div>' +
        '<div class="map-veil"></div><div class="radar-veil tactical-hide"></div>' +
        '<div class="map-hud hud-tl"><div class="hud-score">' +
          '<div class="score-ring">' + aegisRing(aegisRiskContext().score / 100, 56, 5, 'hudScoreArc', aegisRiskContext().score >= 70 ? 'var(--mint)' : aegisRiskContext().score >= 45 ? 'var(--amber)' : 'var(--red)') + '<div class="val" id="hudScoreVal">' + aegisRiskContext().score + '</div></div>' +
          '<div class="hud-meta"><div class="k">SAFETY SCORE</div><div class="v" id="hudZone">' + esc(aegisZoneAt(aegisPoint().lat, aegisPoint().lng).type === 'Outside' ? 'Unmonitored sector' : aegisZoneAt(aegisPoint().lat, aegisPoint().lng).name) + '</div>' +
          '<div class="s" id="hudStatus">' + aegisRiskContext().band + ' · ' + esc((aegisSubject() && aegisSubject().name) || 'Traveler') + '</div></div>' +
        '</div></div>' +
        '<div class="map-hud hud-tr">' +
          '<span class="chip" id="hudBattery">BAT ' + (AEG.battery.level != null ? AEG.battery.level + '%' : '—') + '</span>' +
          '<span class="chip" id="hudNet">' + (S.net || 'ONLINE') + '</span>' +
          '<span class="chip" id="hudGate"><i class="live-dot' + (isCloudConnected ? '' : ' off') + '"></i>' + (isCloudConnected ? 'CLOUD' : 'LOCAL') + '</span>' +
        '</div>' +
        '<div class="map-hud hud-bl">' +
          '<span class="legend-item"><i class="legend-dot" style="background:#25E6A5;color:#25E6A5"></i>Safe</span>' +
          '<span class="legend-item"><i class="legend-dot" style="background:#FFB020;color:#FFB020"></i>Caution</span>' +
          '<span class="legend-item"><i class="legend-dot" style="background:#FF2A5F;color:#FF2A5F"></i>Restricted</span>' +
          '<span class="legend-item"><i class="legend-dot" style="background:#00F0FF;color:#00F0FF"></i>Telemetry</span>' +
        '</div>' +
        '<div class="map-btns map-rails"><button onclick="aegisMapZoom(1)" title="Zoom in">+</button><button onclick="aegisMapZoom(-1)" title="Zoom out">−</button><button onclick="aegisCenterMap()" title="Recenter">⌖</button></div>' +
        '<button class="fab fab-left" onclick="aegisToggleDrawer(\'left\')" title="Show telemetry drawer" aria-label="Show telemetry drawer">›</button>' +
        '<button class="fab fab-right" onclick="aegisToggleDrawer(\'right\')" title="Show intelligence drawer" aria-label="Show intelligence drawer">‹</button>' +
        '<div class="map-search-wrap">' +
          '<input id="indiaSearch" class="map-search" type="search" placeholder="Search anywhere in India — Leh, Manali, Goa…" autocomplete="off" oninput="aegisIndiaSearch(this.value)" onkeydown="aegisIndiaKey(event)" aria-label="Search any Indian location"/>' +
          '<div class="map-results" id="indiaResults" hidden></div>' +
        '</div>' +
        '<div class="lens-dial" id="lensDial" data-lens="heat" role="group" tabindex="0" aria-label="Intelligence lens switcher — use arrow keys">' +
          '<div class="dial-face">' +
            '<span class="dial-ticks" aria-hidden="true"></span>' +
            '<span class="dial-glow" aria-hidden="true"></span>' +
            '<button class="dial-stop s0" data-lens="zones" onclick="aegisSetLens(\'zones\')" title="ALL INDIA ZONES — state and UT atlas">ZONES</button>' +
            '<button class="dial-stop s1" data-lens="heat" onclick="aegisSetLens(\'heat\')" title="ML RISK FIELD — spatial risk classification">RISK</button>' +
            '<button class="dial-stop s2" data-lens="path" onclick="aegisSetLens(\'path\')" title="ISOLATION FOREST — trajectory anomaly">FOREST</button>' +
            '<button class="dial-stop s3" data-lens="havens" onclick="aegisSetLens(\'havens\')" title="SAFE HAVENS — verified response points">HAVEN</button>' +
            '<button class="dial-stop s4" data-lens="night" onclick="aegisSetLens(\'night\')" title="NIGHT SHIFT — danger recomputed after dark">NIGHT</button>' +
            '<div class="dial-hub" id="dialHub"><span id="dialLabel">ML RISK</span></div>' +
            '<i class="dial-arm" id="dialArm" aria-hidden="true"></i>' +
          '</div>' +
        '</div>' +
        '<div class="simdock" id="simDock" data-pane="sim">' +
          '<div class="simdock-top"><span class="sim-label"><i class="live-dot' + (mode || replay ? '' : ' off') + '" id="simDot"></i> STRESS-TEST SIMULATOR</span>' +
            '<div class="sim-tabs" role="tablist" aria-label="Simulator panes">' +
              '<button class="sim-tab active" data-pane="sim" role="tab" onclick="aegisSimPane(\'sim\')">SIMULATE</button>' +
              '<button class="sim-tab" data-pane="cine" role="tab" onclick="aegisSimPane(\'cine\')">SCENES</button></div>' +
            '<div class="hstack" style="gap:6px">' +
              '<button class="chip chip-btn" id="dayNightBtn" onclick="aegisToggleDayNight()" title="Recompute ML priors for day / night">☀ DAY</button>' +
              '<span class="chip" id="simState">' + (replay ? 'REPLAY' : aegisScenarioLabel(mode)) + '</span></div></div>' +
          '<div class="sim-modes">' +
            '<button class="sim-btn ' + (mode === 'normal' ? 'active' : '') + '" onclick="aegisStartScenario(\'normal\')"><i>●</i> Normal trip</button>' +
            '<button class="sim-btn ' + (mode === 'deviation' ? 'active amberb' : '') + '" onclick="aegisStartScenario(\'deviation\')"><i>▲</i> Route hijack</button>' +
            '<button class="sim-btn ' + (mode === 'sos' ? 'active redb' : '') + '" onclick="aegisStartScenario(\'sos\')"><i>◉</i> Dead-man SOS</button>' +
            '<button class="sim-btn ' + (replay ? 'active' : '') + '" onclick="aegisReplayStart()"><i>↺</i> Replay</button>' +
            '<button class="sim-btn" id="stressBtn" onclick="aegisStressTest()"><i>✦</i> Stress test</button>' +
          '</div>' +
          '<div class="live-telemetry">' +
            '<svg class="spark" viewBox="0 0 240 42" preserveAspectRatio="none" aria-label="Live risk and anomaly telemetry">' +
              '<defs><linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00F0FF" stop-opacity=".5"/><stop offset="1" stop-color="#00F0FF" stop-opacity="0"/></linearGradient></defs>' +
              '<path id="riskSparkArea" d="" fill="url(#riskGrad)"></path>' +
              '<path id="riskSpark" d="" fill="none" stroke="#00F0FF" stroke-width="1.7" stroke-linejoin="round"></path>' +
              '<path id="isoSpark" d="" fill="none" stroke="#FF2A5F" stroke-width="1.2" stroke-dasharray="3 4"></path>' +
            '</svg>' +
            '<div class="spark-meta"><span>RISK <b id="sparkRisk">--</b></span><span>ISO <b id="sparkIso">--</b></span><span class="chip tiny-chip" id="lensChip">ML RISK</span></div>' +
          '</div>' +
          '<div class="sim-scrub">' +
            '<button class="icon-btn" onclick="aegisReplayToggle()" title="Play / pause replay">' + (AEG.sim.replay.playing ? '❚❚' : '▶') + '</button>' +
            '<span class="tl" id="replayTime">' + (replay && AEG.trail.length ? aegisFmtTime(AEG.trail[Math.min(AEG.sim.replay.index, AEG.trail.length - 1)].t) : '--:--') + '</span>' +
            '<input type="range" id="scrubber" min="0" max="100" value="' + (replay && AEG.trail.length ? Math.round(AEG.sim.replay.index / Math.max(1, AEG.trail.length - 1) * 100) : 0) + '" oninput="aegisReplayScrub(this.value)" aria-label="Replay scrubber"/>' +
            '<span class="tl" style="text-align:right" id="replayIdx">' + (replay ? (AEG.sim.replay.index + 1) : 0) + '/' + AEG.trail.length + '</span>' +
            '<button class="speed-btn ' + (AEG.sim.replay.speed === 1 ? 'on' : '') + '" onclick="aegisReplaySetSpeed(1)">1x</button>' +
            '<button class="speed-btn ' + (AEG.sim.replay.speed === 2 ? 'on' : '') + '" onclick="aegisReplaySetSpeed(2)">2x</button>' +
          '</div>' +
          '<div class="cine-deck">' +
            '<div class="cine-head"><span class="cine-kicker">GUIDED SCENARIOS</span><span id="cineHead" class="cine-now">01 · Mumbai Coastal Transit</span></div>' +
            '<div class="cine-scenes">' +
              '<button class="cine-scene" data-scene="1"><i>01</i> Mumbai coastal</button>' +
              '<button class="cine-scene" data-scene="2"><i>02</i> Night drift</button>' +
              '<button class="cine-scene" data-scene="3"><i>03</i> Pulse null</button>' +
            '</div>' +
            '<div class="cine-line"><span class="cine-clock" id="cineClock">00:00</span>' +
              '<div class="cine-track"><span class="cine-fill" id="cineFill"></span>' +
                '<input class="cine-scrub" id="cineScrub" type="range" min="0" max="1000" value="0" aria-label="Scene timeline scrubber"/></div></div>' +
            '<div class="cine-beat" id="cineBeat">Pick a scenario — markers glide the Bezier route, the model rescoring live, then the ledger seals.</div>' +
          '</div>' +
        '</div>' +
      '</div></section>' +
      '<aside class="drawer drawer-right">' +
        '<div class="drw-head" style="flex-wrap:wrap;gap:8px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;width:100%">' +
            '<div><span class="drw-kicker" id="sideKicker">' + (ent ? 'ENTERPRISE INTELLIGENCE' : 'PERSONAL INTELLIGENCE') + '</span><h3 id="sideTitle">' + aegisSideTitle(tab) + '</h3></div>' +
            '<button class="icon-btn" onclick="aegisToggleDrawer(\'right\')" title="Collapse drawer">›</button></div>' +
          '<div class="tabrow" style="width:100%">' + tabs.map(t => '<button class="' + (t === tab ? 'active' : '') + '" data-tab="' + t + '" onclick="aegisSideTab(\'' + t + '\')">' + t + '</button>').join('') + '</div>' +
        '</div>' +
        '<div class="drw-body" id="sideBody">' + aegisSidePanelHTML(tab) + '</div>' +
        '<div class="drw-foot"><div class="hstack" style="justify-content:space-between">' +
          '<span class="kicker" id="sideFoot">SHA-256 · ' + AEG.ledger.length + ' blocks</span>' +
          '<button class="btn tiny" onclick="aegisGoto(\'vault\')">Open vault</button></div></div>' +
      '</aside>' +
    '</div>';
}

function aegisSidePanelHTML(tab) {
  const risk = aegisRiskContext();
  if (tab === 'copilot') return aegisCopilotPanelHTML(risk);
  if (tab === 'vault') return aegisVaultPanelHTML();
  if (tab === 'pulse') return aegisPulsePanelHTML();
  if (tab === 'dispatch') return aegisDispatchPanelHTML();
  if (tab === 'fleet') return aegisFleetPanelHTML();
  if (tab === 'alerts') return aegisAlertsPanelHTML(risk);
  return aegisCopilotPanelHTML(risk);
}

function aegisCopilotPanelHTML(risk) {
  const rec = risk.recommendation;
  return '<div class="panel-title"><h4>Contextual risk</h4><span class="badge ' + risk.tone + '">' + risk.band + '</span></div>' +
    '<div class="radar-panel" style="grid-template-columns:auto 1fr;gap:12px">' +
      '<div class="gauge" style="width:104px;height:104px">' + aegisRing(risk.score / 100, 104, 6, 'copilotGaugeArc', risk.score >= 70 ? 'var(--mint)' : risk.score >= 45 ? 'var(--amber)' : 'var(--red)') +
        '<div class="gv"><b id="copilotScore">' + risk.score + '</b><span>SAFETY</span></div></div>' +
      '<div><div class="mini-metric"><b>' + Math.round(risk.crowd * 100) + '%</b><span>crowd density</span></div>' +
        '<div class="mini-metric" style="margin-top:6px"><b>' + risk.zone.dist + 'm</b><span>to perimeter</span></div>' +
        '<div class="mini-metric" style="margin-top:6px"><b>' + risk.near.length + '</b><span>community signals</span></div></div>' +
    '</div>' +
    '<div class="notice ' + (rec.tone === 'danger' ? 'danger' : rec.tone === 'warning' ? 'warning' : 'safe') + '" style="margin-top:10px;font-size:11.5px">' +
      '<b>' + esc(rec.title) + '</b><br/>' + esc(rec.text) + '</div>' +
    '<div class="panel-title" style="margin-top:14px"><h4>Fusion factors</h4><span class="kicker">' + (risk.iso * 100).toFixed(0) + '% anomaly</span></div>' +
    '<div id="factorHost">' + aegisFactorBarsHTML(risk) + '</div>' +
    '<div class="panel-title" style="margin-top:14px"><h4>Nearby intelligence</h4></div>' +
    '<div class="alert-list">' + aegisAlertItemsHTML(risk.near.slice(0, 3)) + '</div>' +
    '<div class="actions" style="margin-top:10px"><button class="btn tiny wide" onclick="aegisGoto(\'copilot\')">Open full risk copilot</button></div>';
}

function aegisVaultPanelHTML() {
  const id = AEG.identity;
  const ok = aegisLedgerVerify();
  return '<div class="panel-title"><h4>Cryptographic ID</h4><span class="badge ' + (ok.ok ? 'safe' : 'danger-b') + '">' + (ok.ok ? 'VERIFIED' : 'TAMPERED') + '</span></div>' +
    '<div class="cert-preview" style="padding:12px">' +
      '<div class="kicker">AEGIS DIGITAL PASSPORT</div>' +
      '<div style="font-family:var(--font-d);font-size:15px;margin:4px 0 2px">' + esc((aegisSubject() && aegisSubject().name) || 'Traveler') + '</div>' +
      '<div class="hash" id="idHashText">' + esc((id.hash || 'computing…').slice(0, 42)) + (id.hash ? '…' : '') + '</div>' +
      '<div class="hstack" style="margin-top:8px"><span class="chip">' + esc((aegisSubject() && aegisSubject().id) || '—') + '</span><span class="chip">SHA-256</span></div>' +
    '</div>' +
    '<div style="display:flex;justify-content:center;margin-top:10px"><div class="holo-qr" id="vaultQR" style="width:104px;height:104px"><span class="qrload">GENERATING<br/>SECURE QR</span></div></div>' +
    '<div class="panel-title" style="margin-top:12px"><h4>Black-box ledger</h4><span class="chain-ok ' + (ok.ok ? '' : 'chain-bad') + '">' + (ok.ok ? '◆ chain intact' : '▲ ' + ok.broken.length + ' broken') + '</span></div>' +
    '<div class="ledger">' + aegisLedgerItemsHTML(3) + '</div>' +
    '<div class="actions" style="margin-top:10px"><button class="btn tiny wide" onclick="aegisGoto(\'vault\')">Open full vault</button></div>';
}

function aegisPulsePanelHTML() {
  const rem = aegisPulseRemaining();
  const total = AEG.pulse.interval || 900000;
  const pct = AEG.pulse.active ? rem / total : 1;
  return '<div class="panel-title"><h4>Dead-man switch</h4><span class="badge ' + (AEG.pulse.active ? (rem < 60000 ? 'danger-b' : 'warning') : 'neutral') + '">' + (AEG.pulse.active ? 'ARMED' : 'STANDBY') + '</span></div>' +
    '<div class="pulse-card" style="flex-direction:column;align-items:center;padding:14px">' +
      '<div class="pulse-big" style="width:168px;height:168px;margin:0">' + aegisRing(pct, 168, 8, 'pulseArcDrawer', rem < 60000 ? 'var(--red)' : AEG.pulse.active ? 'var(--amber)' : 'var(--mint)') +
        '<div class="t"><b id="pulseDrawerClock">' + (AEG.pulse.active ? aegisFmtDur(rem) : '--:--') + '</b><span>AUTO-SOS</span></div></div>' +
      '<div class="muted" style="font-size:10.5px;margin-top:8px;text-align:center">' + (AEG.pulse.active ? 'Check in before the timer expires.' : 'Arm a countdown. Miss it and Tier-1 dispatch fires automatically.') + '</div>' +
    '</div>' +
    '<div class="interval-grid">' + [[1, '1 min'], [15, '15 m'], [30, '30 m'], [60, '60 m']].map(([m, l]) =>
      '<button class="' + (AEG.pulse.interval === m * 60000 ? 'active' : '') + '" onclick="aegisStartPulse(' + m + ')">' + l + '</button>').join('') + '</div>' +
    '<button class="safe-btn" onclick="aegisPulseSafe(\'drawer\')">I’m safe</button>' +
    '<div class="hstack" style="margin-top:8px;justify-content:center">' +
      '<button class="btn tiny" onclick="aegisEnableShake()">Shake to check in</button>' +
      (AEG.pulse.active ? '<button class="btn tiny" onclick="aegisPulseStop()">Disarm</button>' : '') +
    '</div>' +
    '<div class="kv" style="margin-top:10px"><span>Last check-in</span><b>' + (AEG.pulse.lastCheckin ? aegisRelTime(AEG.pulse.lastCheckin) : '—') + '</b></div>' +
    '<div class="kv"><span>Escalations</span><b>' + (AEG.pulse.escalations || 0) + '</b></div>';
}

function aegisDispatchPanelHTML() {
  const open = S.incidents.filter(i => i.status !== 'Resolved').slice(0, 5);
  const fleet = AEG.fleet.filter(f => f.status !== 'Safe').slice(0, 3);
  return '<div class="panel-title"><h4>SLA queue</h4><span class="chip">' + S.incidents.filter(i => i.status !== 'Resolved').length + ' open</span></div>' +
    (open.length ? open.map(i => {
      const sla = aegisSlaFor(i);
      return '<div class="feed-item ' + (sla && sla.over ? 'sev-high' : i.severity === 'HIGH' ? 'sev-high' : 'sev-med') + '">' +
        '<div class="fi-top"><b>' + esc(i.id) + ' · ' + esc(i.type) + '</b><span class="fi-time ' + (sla && sla.over ? 'blink' : '') + '" data-sla="' + esc(i.id) + '">' + (sla ? sla.label : '—') + '</span></div>' +
        '<p>' + esc(i.tourist) + ' · ' + esc(i.zone || '—') + (i.assignedTo ? ' · ' + esc(i.assignedTo) : '') + '</p>' +
        '<div class="hstack" style="margin-top:6px"><button class="btn tiny primary" onclick="aegisDispatchAction(\'' + esc(i.id) + '\',\'Acknowledged\')">Acknowledge</button>' +
        '<button class="btn tiny" onclick="aegisOpenDispatchBoard()">Assign unit</button></div></div>';
    }).join('') : '<div class="feed-empty">No open incidents. SLA queue clear.</div>') +
    '<div class="panel-title" style="margin-top:14px"><h4>Fleet attention</h4><span class="kicker">' + AEG.fleet.filter(f => f.status !== 'Safe').length + ' flagged</span></div>' +
    (fleet.length ? fleet.map(f => '<div class="alert-item ' + (f.status === 'SOS' ? 'hazard' : '') + '"><div class="alert-ico">' + (f.status === 'SOS' ? '◉' : '▲') + '</div>' +
      '<div style="min-width:0"><b>' + esc(f.name) + '</b><small>' + esc(f.status) + ' · ' + esc(f.zone) + ' · risk ' + f.risk + '</small></div>' +
      '<div class="upvotes"><b>' + f.battery + '%</b></div></div>').join('') : '<div class="feed-empty">Fleet nominal.</div>') +
    '<div class="actions" style="margin-top:10px"><button class="btn tiny wide amber" onclick="aegisBulkBroadcast()">Broadcast to fleet</button></div>';
}

function aegisFleetPanelHTML() {
  const flagged = AEG.fleet.filter(f => f.status !== 'Safe');
  const avgRisk = Math.round(AEG.fleet.reduce((s, f) => s + f.risk, 0) / Math.max(1, AEG.fleet.length));
  return '<div class="panel-title"><h4>Fleet snapshot</h4><span class="chip">' + AEG.fleet.length + ' tourists</span></div>' +
    '<div class="split-3" style="gap:6px">' +
      '<div class="card" style="padding:9px"><div class="stat-label">Flagged</div><div class="stat-num" style="font-size:17px">' + flagged.length + '</div></div>' +
      '<div class="card" style="padding:9px"><div class="stat-label">Avg risk</div><div class="stat-num" style="font-size:17px">' + avgRisk + '</div></div>' +
      '<div class="card" style="padding:9px"><div class="stat-label">SOS</div><div class="stat-num" style="font-size:17px">' + AEG.fleet.filter(f => f.status === 'SOS').length + '</div></div>' +
    '</div>' +
    '<div class="panel-title" style="margin-top:12px"><h4>Highest risk</h4></div>' +
    AEG.fleet.slice().sort((a, b) => b.risk - a.risk).slice(0, 6).map(f =>
      '<div class="alert-item ' + (f.risk > 70 ? 'hazard' : '') + '"><div class="alert-ico">' + (f.status === 'SOS' ? '◉' : '▲') + '</div>' +
      '<div style="min-width:0"><b>' + esc(f.name) + '</b><small>' + esc(f.group) + ' · ' + esc(f.zone) + '</small></div>' +
      '<div class="upvotes"><b>' + f.risk + '</b><span>risk</span></div></div>').join('') +
    '<div class="actions" style="margin-top:10px"><button class="btn tiny wide" onclick="aegisGoto(\'fleet\')">Open fleet monitor</button>' +
    '<button class="btn tiny wide" onclick="aegisToggleHeat()">' + (AEG.prefs.heat ? 'Hide' : 'Show') + ' heatmap</button></div>';
}

function aegisAlertsPanelHTML(risk) {
  const near = risk.near.length ? risk.near : AEG.alerts;
  return '<div class="panel-title"><h4>Scam radar</h4><span class="chip">' + near.length + ' signals</span></div>' +
    '<div class="alert-list">' + aegisAlertItemsHTML(near.slice(0, 6)) + '</div>' +
    '<div class="actions" style="margin-top:10px"><button class="btn tiny wide" onclick="aegisOpenAlertForm()">＋ Report an area</button></div>' +
    '<div class="notice" style="margin-top:10px;font-size:11px">Community reports are weighted into your safety score within a 1.8 km radius.</div>';
}

function aegisAlertItemsHTML(list) {
  if (!list || !list.length) return '<div class="feed-empty">No community signals in this sector.</div>';
  return list.map(a => {
    const tone = a.type === 'haven' ? 'safe' : a.type === 'hazard' ? 'hazard' : '';
    const icon = a.type === 'haven' ? '✓' : a.type === 'scam' ? '⚠' : a.type === 'crowd' ? '◉' : '▲';
    return '<div class="alert-item ' + tone + '"><div class="alert-ico">' + icon + '</div>' +
      '<div style="min-width:0"><b>' + esc(a.title) + '</b><small>' + esc(a.desc) + '</small>' +
      '<small class="faint" style="margin-top:3px">' + (a.distance != null ? a.distance + ' m · ' : '') + (a.verified ? 'Verified · ' : '') + esc(a.by || 'Community') + '</small></div>' +
      '<div class="upvotes"><button onclick="aegisUpvoteAlert(\'' + esc(a.id) + '\')" title="Confirm">▲</button><span>' + (a.upvotes || 0) + '</span></div></div>';
  }).join('');
}

function aegisLedgerItemsHTML(limit) {
  if (!AEG.ledger.length) return '<div class="feed-empty">No blocks sealed yet.</div>';
  return AEG.ledger.slice(0, limit || 8).map(e =>
    '<div class="ledger-item"><div class="ledger-seq">' + e.seq + '</div>' +
    '<div class="lt"><b>' + esc(e.title) + '</b><code>' + esc(String(e.hash).slice(0, 34)) + '…</code></div>' +
    '<div class="ledger-time">' + aegisFmtTime(e.ts) + '</div></div>').join('');
}

/* ------------------------------------------------------------ drawer actions */
function aegisToggleDrawer(side) {
  if (side === 'left') AEG.prefs.drawerLeft = !AEG.prefs.drawerLeft;
  else AEG.prefs.drawerRight = !AEG.prefs.drawerRight;
  aegisSave();
  const root = $('cmdRoot');
  if (!root) return;
  root.classList.toggle('no-left', !AEG.prefs.drawerLeft);
  root.classList.toggle('no-right', !AEG.prefs.drawerRight);
  const fabL = document.querySelector('.fab-left'), fabR = document.querySelector('.fab-right');
  if (fabL) fabL.style.display = AEG.prefs.drawerLeft ? 'none' : '';
  if (fabR) fabR.style.display = AEG.prefs.drawerRight ? 'none' : '';
  setTimeout(() => { if (CMAP.m) CMAP.m.invalidateSize(); }, 340);
}

function aegisSideTab(tab) {
  AEG.prefs.sideTab = tab;
  aegisSave();
  document.querySelectorAll('.tabrow button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const title = $('sideTitle');
  if (title) title.textContent = aegisSideTitle(tab);
  const body = $('sideBody');
  if (body) {
    body.innerHTML = aegisSidePanelHTML(tab);
    if (tab === 'vault') aegisDrawIDQR('vaultQR', 104);
    aegisPaintChrome();
  }
}

/* ---------------------------------------------------------------- map engine */
function aegisMapZoom(delta) {
  if (CMAP.m) CMAP.m.zoomIn(delta > 0 ? 1 : -1, { animate: true });
}

function aegisCenterMap() {
  if (!CMAP.m) return;
  const p = aegisPoint();
  CMAP.m.setView([p.lat, p.lng], Math.max(CMAP.m.getZoom(), 16), { animate: true });
}

function aegisInitCommandMap() {
  const el = $('cmdMap');
  if (!el) return;
  if (!window.L) {
    el.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:20px;color:var(--muted);font-size:12px">Map engine unavailable (Leaflet CDN blocked).<br/>Telemetry, pulse and ledger remain fully functional.</div>';
    return;
  }
  if (CMAP.m) { try { CMAP.m.remove(); } catch (e) {} CMAP.m = null; }
  const origin = aegisPoint();
  const m = L.map('cmdMap', { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([origin.lat, origin.lng], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
  CMAP.m = m;
  CMAP.layers = {
    zones: L.layerGroup().addTo(m),
    fleet: L.layerGroup().addTo(m),
    subject: L.layerGroup().addTo(m),
    route: L.layerGroup().addTo(m),
    replay: L.layerGroup().addTo(m),
    dispatch: L.layerGroup().addTo(m)
  };
  aegisDrawZones();
  aegisDrawFleet();
  aegisDrawSubject();
  if (AEG.sim.route && AEG.sim.route.length) aegisDrawRoute(AEG.sim.route, null);
  if (AEG.trail.length > 1) aegisDrawTrail();
  if (AEG.sim.sosIncident) {
    const inc = S.incidents.find(i => i.id === AEG.sim.sosIncident);
    if (inc && inc.unit) aegisDrawDispatch(inc.unit, { lat: inc.lat, lng: inc.lng });
  }
  setTimeout(() => m.invalidateSize(), 120);
}

function aegisDrawZones() {
  if (!CMAP.m || !CMAP.layers) return;
  CMAP.layers.zones.clearLayers();
  (S.zones || []).forEach(z => {
    const color = ZC[z.type] || '#00F0FF';
    L.circle([Number(z.lat), Number(z.lng)], {
      radius: radiusOf(z), color, weight: 1.5, opacity: .9,
      fillColor: color, fillOpacity: .10, dashArray: z.type === 'Safe' ? null : '5 7'
    }).addTo(CMAP.layers.zones).bindTooltip('<b>' + esc(z.name) + '</b><br/>' + esc(z.type) + ' · ' + radiusOf(z) + ' m', { direction: 'top' });
  });
}

function aegisFleetColor(f) {
  if (f.status === 'SOS' || f.risk >= 75) return '#FF2A5F';
  if (f.risk >= 55 || f.status === 'Alert') return '#FFB020';
  return '#25E6A5';
}

function aegisDrawFleet() {
  if (!CMAP.m || !CMAP.layers) return;
  CMAP.layers.fleet.clearLayers();
  CMAP.heat.forEach(h => { try { h.remove(); } catch (e) {} });
  CMAP.heat = [];
  CMAP.fleetMarkers = {};
  if (S.role !== 'authority' && AEG.prefs.heat) return;
  const list = S.role === 'authority' ? AEG.fleet : [];
  if (AEG.prefs.heat && S.role === 'authority') {
    list.forEach(f => {
      const c = L.circle([f.lat, f.lng], { radius: 420, stroke: false, fillColor: aegisFleetColor(f), fillOpacity: f.risk > 70 ? .18 : .09, interactive: false }).addTo(CMAP.m);
      CMAP.heat.push(c);
    });
  }
  list.forEach(f => {
    const col = aegisFleetColor(f);
    const mk = L.circleMarker([f.lat, f.lng], {
      radius: f.status === 'SOS' ? 7 : 4.5, color: '#040A12', weight: 1,
      fillColor: col, fillOpacity: 1, opacity: .9
    }).addTo(CMAP.layers.fleet);
    mk.on('click', () => aegisInspectTourist(f.id));
    mk.bindTooltip('<b>' + esc(f.name) + '</b> · ' + esc(f.status) + ' · risk ' + f.risk, { direction: 'top' });
    CMAP.fleetMarkers[f.id] = mk;
  });
}

function aegisDrawSubject() {
  if (!CMAP.m || !CMAP.layers) return;
  const p = aegisPoint();
  CMAP.layers.subject.clearLayers();
  const tone = AEG.pulse.active ? '#FFB020' : '#00F0FF';
  CMAP.halo = L.circle([p.lat, p.lng], { radius: Math.max(60, (p.accuracy || 20) * 2.4), stroke: false, fillColor: tone, fillOpacity: .12, interactive: false }).addTo(CMAP.layers.subject);
  CMAP.subject = L.circleMarker([p.lat, p.lng], { radius: 8, color: '#fff', weight: 2, fillColor: tone, fillOpacity: 1 }).addTo(CMAP.layers.subject);
  CMAP.subject.bindTooltip(esc((aegisSubject() && aegisSubject().name) || 'Traveler') + ' · ' + esc(aegisRiskContext().band), { direction: 'top' });
}

function aegisDrawRoute(route, dev) {
  if (!CMAP.m || !CMAP.layers || !route || !route.length) return;
  CMAP.layers.route.clearLayers();
  const latlngs = route.map(p => [p.lat, p.lng]);
  L.polyline(latlngs, { color: '#00F0FF', weight: 2.5, opacity: .85, dashArray: '7 9' }).addTo(CMAP.layers.route);
  if (dev && dev.point) {
    const idx = aegisRouteIndex(route, dev.point.lat, dev.point.lng).index;
    const a = route[idx] || route[0];
    L.polyline([[a.lat, a.lng], [dev.point.lat, dev.point.lng]], { color: '#FF2A5F', weight: 3, opacity: .95 }).addTo(CMAP.layers.route);
    const mid = [(a.lat + dev.point.lat) / 2, (a.lng + dev.point.lng) / 2];
    L.marker(mid, { icon: L.divIcon({ className: '', html: '<div style="font-family:IBM Plex Mono,monospace;font-size:9px;color:#FF8DAB;background:rgba(10,4,10,.9);border:1px solid rgba(255,42,95,.5);padding:2px 5px;border-radius:4px;white-space:nowrap">+' + Math.round(dev.deviation) + 'm</div>', iconSize: [46, 16] }) }).addTo(CMAP.layers.route);
  }
}

function aegisClearRoute() {
  if (CMAP.layers) CMAP.layers.route.clearLayers();
}

function aegisDrawTrail() {
  if (!CMAP.m || !AEG.trail.length) return;
  if (CMAP.layers.route) CMAP.layers.route.clearLayers();
  const pts = AEG.trail.slice(-300).map(p => [p.lat, p.lng]);
  L.polyline(pts, { color: 'rgba(0,240,255,.55)', weight: 2 }).addTo(CMAP.layers.replay);
  pts.forEach((p, i) => {
    if (i % 6 !== 0) return;
    const src = AEG.trail.slice(-300)[i];
    L.circleMarker(p, { radius: 2.2, color: 'transparent', fillColor: src.risk < 45 ? '#FFB020' : '#FF2A5F', fillOpacity: .7 }).addTo(CMAP.layers.replay);
  });
  CMAP.m.fitBounds(pts, { padding: [40, 40], maxZoom: 17 });
}

function aegisDrawReplayMarker(point) {
  if (!CMAP.layers || !point) return;
  CMAP.layers.replay.clearLayers();
  const pts = AEG.trail.map(p => [p.lat, p.lng]);
  L.polyline(pts, { color: 'rgba(0,240,255,.30)', weight: 1.5, dashArray: '3 5' }).addTo(CMAP.layers.replay);
  L.circleMarker([point.lat, point.lng], { radius: 7, color: '#FFB020', weight: 2, fillColor: '#FFB020', fillOpacity: .9 }).addTo(CMAP.layers.replay)
    .bindTooltip('Replay · risk ' + point.risk, { direction: 'top' }).openTooltip();
  if (CMAP.m && !CMAP.replayCentered) {
    CMAP.m.setView([point.lat, point.lng], 16, { animate: true });
    CMAP.replayCentered = true;
  }
}

function aegisClearReplay() {
  if (CMAP.layers) CMAP.layers.replay.clearLayers();
  CMAP.replayCentered = false;
}

function aegisDrawDispatch(unit, point) {
  if (!CMAP.m || !CMAP.layers || !unit || !point) return;
  CMAP.layers.dispatch.clearLayers();
  L.polyline([[unit.lat, unit.lng], [point.lat, point.lng]], { color: '#FFB020', weight: 3, dashArray: '10 6', opacity: .95 }).addTo(CMAP.layers.dispatch);
  L.circleMarker([unit.lat, unit.lng], { radius: 6, color: '#04141A', weight: 2, fillColor: '#FFB020', fillOpacity: 1 }).addTo(CMAP.layers.dispatch)
    .bindTooltip(esc(unit.id) + ' · ' + esc(unit.name), { direction: 'top' }).openTooltip();
  if (CMAP.m) CMAP.m.fitBounds([[unit.lat, unit.lng], [point.lat, point.lng]], { padding: [50, 50], maxZoom: 16 });
}

function aegisToggleHeat() {
  AEG.prefs.heat = !AEG.prefs.heat;
  aegisSave();
  aegisDrawFleet();
  if (typeof toast === 'function') toast(AEG.prefs.heat ? 'Heatmap overlay enabled' : 'Heatmap overlay hidden', 'info');
}

/* --------------------------------------------------------------- QR & tilt */
function aegisDrawIDQR(targetId, size) {
  const el = $(targetId);
  if (!el) return;
  const subject = aegisSubject() || {};
  const hash = (AEG.identity.hash || 'PENDING').slice(0, 12).toUpperCase();
  const nonce = Math.random().toString(36).slice(2, 7).toUpperCase();
  const payload = 'AEGIS://ID/' + (subject.id || 'GUEST') + '?h=' + hash + '&n=' + nonce + '&t=' + Math.floor(Date.now() / 1000);
  el.innerHTML = '';
  if (window.QRCode) {
    try {
      new QRCode(el, {
        text: payload,
        width: size || 96,
        height: size || 96,
        colorDark: '#06121A',
        colorLight: '#FFFFFF',
        correctLevel: QRCode.CorrectLevel.M
      });
    } catch (e) {
      el.innerHTML = '<span class="qrload">QR offline</span>';
    }
  } else {
    // Deterministic matrix fallback so the credential remains visually verifiable offline
    const cells = 9;
    let out = '<div style="display:grid;grid-template-columns:repeat(' + cells + ',1fr);gap:1px;width:100%;height:100%;background:#06121A;padding:3px">';
    for (let i = 0; i < cells * cells; i++) {
      const on = (hash.charCodeAt(i % hash.length) + i * 7) % 5 < 2;
      out += '<i style="background:' + (on ? '#06121A' : '#fff') + '"></i>';
    }
    el.innerHTML = out + '</div>';
  }
  const stamp = $('qrStamp');
  if (stamp) stamp.textContent = 'TOKEN ' + nonce + ' · ' + hash.slice(0, 8);
}

function aegisRotateQR() {
  clearInterval(AEG_QR_TIMER);
  AEG_QR_TIMER = setInterval(() => {
    if (S.page === 'vault') {
      aegisDrawIDQR('idQR', 150);
      aegisDrawIDQR('vaultQR', 104);
      const rot = $('qrRotateState');
      if (rot) rot.textContent = 'ROTATING · ' + new Date().toLocaleTimeString('en-IN');
    }
  }, 9000);
}

function aegisBindHoloTilt() {
  const card = $('holoCard');
  if (!card) return;
  const scene = card.parentElement;
  scene.addEventListener('mousemove', ev => {
    const r = card.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width - .5;
    const y = (ev.clientY - r.top) / r.height - .5;
    card.style.setProperty('--ry', (x * 16).toFixed(2) + 'deg');
    card.style.setProperty('--rx', (-y * 14).toFixed(2) + 'deg');
  });
  scene.addEventListener('mouseleave', () => {
    card.style.setProperty('--ry', '0deg');
    card.style.setProperty('--rx', '0deg');
  });
}

/* ------------------------------------------------------------ page painters */
function aegisPaintLive() {
  AEG_PAINT_TICK++;
  const risk = aegisRiskContext();
  const scoreEl = $('hudScoreVal');
  if (scoreEl) scoreEl.textContent = risk.score;
  const arc = $('hudScoreArc');
  if (arc) {
    const c = 2 * Math.PI * 25.5;
    arc.setAttribute('stroke-dashoffset', (c * (1 - risk.score / 100)).toFixed(1));
    arc.setAttribute('stroke', risk.score >= 70 ? 'var(--mint)' : risk.score >= 45 ? 'var(--amber)' : 'var(--red)');
  }
  const band = $('hudStatus');
  if (band) band.textContent = risk.band + ' · ' + ((aegisSubject() && aegisSubject().name) || 'Traveler');
  const zone = $('hudZone');
  if (zone) zone.textContent = risk.zone.type === 'Outside' ? 'Unmonitored sector' : risk.zone.name;
  const simState = $('simState');
  if (simState) simState.textContent = AEG.sim.replay.active ? 'REPLAY' : aegisScenarioLabel(AEG.sim.mode);
  const simDot = $('simDot');
  if (simDot) simDot.className = 'live-dot' + (AEG.sim.mode || AEG.sim.replay.active ? '' : ' off');
  const scorEl = $('copilotScore');
  if (scorEl) scorEl.textContent = risk.score;
  const copArc = $('copilotGaugeArc');
  if (copArc) {
    const c = 2 * Math.PI * 49;
    copArc.setAttribute('stroke-dashoffset', (c * (1 - risk.score / 100)).toFixed(1));
  }
  const bat = $('hudBattery');
  if (bat) bat.textContent = 'BAT ' + (AEG.battery.level != null ? AEG.battery.level + '%' : '—');
  const net = $('hudNet');
  if (net) net.textContent = S.net || 'ONLINE';

  // Replay scrubber
  const scrub = $('scrubber');
  if (scrub) {
    const pct = AEG.trail.length > 1 ? (AEG.sim.replay.index / (AEG.trail.length - 1)) * 100 : 0;
    if (document.activeElement !== scrub) scrub.value = String(Math.round(pct));
    scrub.style.setProperty('--fill', pct + '%');
    const idx = $('replayIdx');
    if (idx) idx.textContent = (AEG.trail.length ? (AEG.sim.replay.index + 1) : 0) + '/' + AEG.trail.length;
    const time = $('replayTime');
    if (time && AEG.trail.length) time.textContent = aegisFmtTime(AEG.trail[Math.min(AEG.sim.replay.index, AEG.trail.length - 1)].t);
  }
  // Live SLA labels
  document.querySelectorAll('[data-sla]').forEach(el => {
    const inc = S.incidents.find(i => i.id === el.getAttribute('data-sla'));
    if (!inc) return;
    const sla = aegisSlaFor(inc);
    if (!sla) return;
    el.textContent = sla.resolved ? 'RESOLVED' : sla.label;
    el.classList.toggle('blink', sla.over && !sla.resolved);
  });
  aegisPaintPulse();
  if (AEG_PAINT_TICK % 8 === 0) {
    const factorHost = $('factorHostMini');
    if (factorHost) factorHost.innerHTML = aegisFactorBarsHTML(risk);
    const factorHost2 = $('factorHost');
    if (factorHost2) factorHost2.innerHTML = aegisFactorBarsHTML(risk);
  }
  const feedCount = $('feedCount');
  if (feedCount) feedCount.textContent = AEG.feed.length;
  aegisPaintChrome();
}

function aegisPaintPulse() {
  const rem = aegisPulseRemaining();
  const total = AEG.pulse.interval || 900000;
  const pct = AEG.pulse.active ? rem / total : 1;
  const color = AEG.pulse.active ? (rem < 60000 ? 'var(--red)' : 'var(--amber)') : 'var(--mint)';
  [['pulseArcMini', 21, 52], ['pulseArcDrawer', 76, 168]].forEach(([id, r, size]) => {
    const el = $(id);
    if (!el) return;
    const c = 2 * Math.PI * r;
    el.setAttribute('stroke-dashoffset', (c * (1 - pct)).toFixed(1));
    el.setAttribute('stroke', color);
  });
  const mini = $('pulseMiniText');
  if (mini) mini.textContent = AEG.pulse.active ? aegisFmtDur(rem) : '—';
  const drawer = $('pulseDrawerClock');
  if (drawer) drawer.textContent = AEG.pulse.active ? aegisFmtDur(rem) : '--:--';
  const big = $('pulseClock');
  if (big) big.textContent = AEG.pulse.active ? aegisFmtDur(rem) : '--:--';
  const bigArc = $('pulseArcBig');
  if (bigArc) {
    const c = 2 * Math.PI * 104;
    bigArc.setAttribute('stroke-dashoffset', (c * (1 - pct)).toFixed(1));
    bigArc.setAttribute('stroke', color);
  }
  const status = $('pulseStatus');
  if (status) {
    status.textContent = AEG.pulse.active ? (rem < 60000 ? 'CRITICAL · CHECK IN NOW' : 'ARMED · DEAD-MAN ACTIVE') : 'STANDBY · NO COUNTDOWN';
    status.className = 'badge ' + (AEG.pulse.active ? (rem < 60000 ? 'danger-b' : 'warning') : 'neutral');
  }
  const bigWrap = $('pulseBigWrap');
  if (bigWrap) bigWrap.className = 'pulse-big' + (AEG.pulse.active ? (rem < 60000 ? ' critical armed' : ' armed') : '');
}

function aegisPaintFeed() {
  const host = $('feedHost');
  if (host) host.innerHTML = aegisFeedHTML(26);
  const full = $('feedHostFull');
  if (full) full.innerHTML = aegisFeedHTML(60);
  const c = $('feedCount');
  if (c) c.textContent = AEG.feed.length;
}

function aegisPaintCopilot() {
  const host = $('factorHostFull');
  if (!host) return;
  const risk = aegisRiskContext();
  host.innerHTML = aegisFactorBarsHTML(risk);
  const score = $('copilotScoreFull');
  if (score) score.textContent = risk.score;
  const band = $('copilotBandFull');
  if (band) { band.textContent = risk.band; band.className = 'badge ' + risk.tone; }
  const list = $('alertListFull');
  if (list) list.innerHTML = aegisAlertItemsHTML(risk.near.length ? risk.near : AEG.alerts);
  const rec = $('copilotRecFull');
  if (rec) {
    rec.className = 'notice ' + (risk.recommendation.tone === 'danger' ? 'danger' : risk.recommendation.tone === 'warning' ? 'warning' : 'safe');
    rec.innerHTML = '<b>' + esc(risk.recommendation.title) + '</b><br/>' + esc(risk.recommendation.text);
  }
  const arc = $('copilotGaugeFull');
  if (arc) {
    const c = 2 * Math.PI * 55;
    arc.setAttribute('stroke-dashoffset', (c * (1 - risk.score / 100)).toFixed(1));
  }
}

function aegisPaintFleet() {
  const body = $('fleetBody');
  if (!body) return;
  const q = (($('fleetSearch') && $('fleetSearch').value) || '').toLowerCase();
  const filter = AEG_FLEET_FILTER || 'all';
  let rows = AEG.fleet.slice().sort((a, b) => b.risk - a.risk);
  if (q) rows = rows.filter(f => (f.name + ' ' + f.id + ' ' + f.zone).toLowerCase().includes(q));
  if (filter === 'alert') rows = rows.filter(f => f.status !== 'Safe');
  if (filter === 'sos') rows = rows.filter(f => f.status === 'SOS');
  if (filter === 'offline') rows = rows.filter(f => f.network === 'OFFLINE');
  body.innerHTML = rows.map(f => {
    const sla = f.alertSince ? aegisSlaFor({ severity: f.status === 'SOS' ? 'HIGH' : 'MEDIUM', occurredAt: f.alertSince, status: f.status === 'SOS' ? 'New' : 'Acknowledged', slaMinutes: f.slaMinutes }) : null;
    return '<tr class="' + (sla && sla.over ? 'sla-breach' : '') + '">' +
      '<td><div class="fleet-name"><i class="fleet-dot" style="background:' + aegisFleetColor(f) + ';color:' + aegisFleetColor(f) + '"></i><div><b>' + esc(f.name) + '</b><div class="faint" style="font-size:9px;font-family:var(--font-m)">' + esc(f.id) + ' · ' + esc(f.group) + '</div></div></div></td>' +
      '<td>' + esc(f.zone) + '</td>' +
      '<td><span class="badge ' + (f.status === 'SOS' ? 'danger-b' : f.status === 'Alert' ? 'warning' : 'safe') + '">' + esc(f.status) + '</span></td>' +
      '<td><b style="font-family:var(--font-m);color:' + (f.risk > 70 ? 'var(--red-ink)' : f.risk > 45 ? 'var(--amber-ink)' : 'var(--ink)') + '">' + f.risk + '</b></td>' +
      '<td><span class="batt"><span class="batt-bar ' + (f.battery < 20 ? 'low' : '') + '"><i style="width:' + f.battery + '%"></i></span>' + f.battery + '%</span></td>' +
      '<td><span class="sla ' + (sla && sla.over ? 'over' : sla && sla.remaining < 120000 ? 'warn' : 'ok') + '">' + (sla ? sla.label : '—') + '</span></td>' +
      '<td><div class="hstack" style="gap:4px"><button class="btn tiny" onclick="aegisInspectTourist(\'' + esc(f.id) + '\')">Inspect</button>' +
      '<button class="btn tiny danger" onclick="aegisSOSFor(\'' + esc(f.id) + '\')">SOS</button></div></td></tr>';
  }).join('') || '<tr><td colspan="7" class="muted" style="padding:20px;text-align:center">No tourists match this filter.</td></tr>';
  const count = $('fleetCount');
  if (count) count.textContent = rows.length;
}

function aegisInspectTourist(id) {
  const f = AEG.fleet.find(x => x.id === id) || S.tourists.find(x => x.id === id);
  if (!f) return;
  const risk = aegisRiskContext(f);
  openModal('<div class="hstack" style="gap:8px;margin-bottom:6px"><span class="badge ' + (f.status === 'SOS' ? 'danger-b' : f.status === 'Alert' ? 'warning' : 'safe') + '">' + esc(f.status) + '</span><span class="kicker">' + esc(f.id) + '</span></div>' +
    '<h2>' + esc(f.name) + '</h2>' +
    '<div class="grid" style="grid-template-columns:1fr 1fr;gap:8px;margin:10px 0">' +
      '<div class="card" style="padding:10px"><div class="stat-label">Risk</div><div class="stat-num" style="font-size:19px">' + risk.score + '</div></div>' +
      '<div class="card" style="padding:10px"><div class="stat-label">Battery</div><div class="stat-num" style="font-size:19px">' + (f.battery != null ? f.battery + '%' : '—') + '</div></div></div>' +
    '<div class="kv"><span>Zone</span><b>' + esc(f.zone) + '</b></div>' +
    '<div class="kv"><span>Hotel / group</span><b>' + esc(f.group || '—') + '</b></div>' +
    '<div class="kv"><span>Blood group</span><b>' + esc(f.blood || '—') + '</b></div>' +
    '<div class="kv"><span>Allergies</span><b>' + esc(f.allergy || '—') + '</b></div>' +
    '<div class="kv"><span>Last ping</span><b>' + (f.updatedAt ? aegisRelTime(f.updatedAt) : '—') + '</b></div>' +
    '<div class="notice ' + (risk.recommendation.tone === 'danger' ? 'danger' : risk.recommendation.tone === 'warning' ? 'warning' : 'safe') + '" style="margin-top:10px;font-size:11.5px"><b>' + esc(risk.recommendation.title) + '</b><br/>' + esc(risk.recommendation.text) + '</div>' +
    '<div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="btn" onclick="closeModal()">Close</button>' +
    '<button class="btn primary" onclick="closeModal();aegisTrackTourist(\'' + esc(f.id) + '\')">Track on map</button>' +
    '<button class="btn danger" onclick="closeModal();aegisSOSFor(\'' + esc(f.id) + '\')">Force SOS</button></div>');
}

function aegisTrackTourist(id) {
  S.trackedTouristId = id;
  if (S.page !== 'command') aegisGoto('command');
  else {
    aegisDrawSubject();
    aegisDrawFleet();
    aegisCenterMap();
  }
  const t = AEG.fleet.find(x => x.id === id);
  if (typeof toast === 'function') toast('Tracking ' + (t ? t.name : id), 'info');
}

function aegisSOSFor(id) {
  S.trackedTouristId = id;
  const f = AEG.fleet.find(x => x.id === id);
  if (f) { f.status = 'SOS'; f.risk = Math.max(88, f.risk); }
  aegisTriggerSOS('operator-force-sos');
}

/* --------------------------------------------------------------- full pages */
function aegisPulsePage() {
  const rem = aegisPulseRemaining();
  const total = AEG.pulse.interval || 900000;
  const pct = AEG.pulse.active ? rem / total : 1;
  const risk = aegisRiskContext();
  return '<div class="pulse-page">' +
    '<div class="card pulse-hero fade-up">' +
      '<div class="hstack" style="justify-content:space-between;width:100%"><span class="eyebrow no-rule">Dead-man switch</span><span class="badge ' + (AEG.pulse.active ? (rem < 60000 ? 'danger-b' : 'warning') : 'neutral') + '" id="pulseStatus">' + (AEG.pulse.active ? 'ARMED · DEAD-MAN ACTIVE' : 'STANDBY · NO COUNTDOWN') + '</span></div>' +
      '<div class="pulse-big' + (AEG.pulse.active ? (rem < 60000 ? ' critical armed' : ' armed') : '') + '" id="pulseBigWrap">' + aegisRing(pct, 238, 10, 'pulseArcBig', AEG.pulse.active ? (rem < 60000 ? 'var(--red)' : 'var(--amber)') : 'var(--mint)') +
        '<div class="t"><b id="pulseClock">' + (AEG.pulse.active ? aegisFmtDur(rem) : '--:--') + '</b><span>AUTO-ESCALATION</span></div></div>' +
      '<button class="safe-btn" onclick="aegisPulseSafe(\'page\')">I’m safe — reset timer</button>' +
      '<div class="interval-grid">' + [[1, '1 min'], [15, '15 min'], [30, '30 min'], [60, '60 min']].map(([m, l]) => '<button class="' + (AEG.pulse.interval === m * 60000 ? 'active' : '') + '" onclick="aegisStartPulse(' + m + ')">' + l + '</button>').join('') + '</div>' +
      '<div class="hstack" style="justify-content:center">' +
        '<button class="btn" onclick="aegisEnableShake()">📳 Shake to check in</button>' +
        '<button class="btn" onclick="aegisShowDecoy(\'calc\')">◐ Disguise screen</button>' +
        (AEG.pulse.active ? '<button class="btn" onclick="aegisPulseStop()">Disarm pulse</button>' : '') +
      '</div>' +
      '<div class="muted" style="font-size:10.5px;margin-top:10px">Shortcut: press <b>S</b> anywhere to check in · <b>Shift+S</b> for SOS</div>' +
    '</div>' +
    '<div class="stack">' +
      '<div class="card"><div class="panel-title"><h4>Escalation protocol</h4><span class="kicker">Tier-1</span></div>' +
        '<div class="sos-steps" style="margin:6px 0"><div><i>1</i>Timer expires without a check-in</div><div><i>2</i>Tier-1 SOS broadcasts last-known coordinates, battery and network</div><div><i>3</i>Nearest unit auto-dispatched, evidence block sealed for insurers</div></div>' +
        '<div class="kv"><span>Configured interval</span><b>' + Math.round((AEG.pulse.interval || 900000) / 60000) + ' min</b></div>' +
        '<div class="kv"><span>Last check-in</span><b>' + (AEG.pulse.lastCheckin ? aegisRelTime(AEG.pulse.lastCheckin) : '—') + '</b></div>' +
        '<div class="kv"><span>Escalations this session</span><b>' + (AEG.pulse.escalations || 0) + '</b></div>' +
        '<div class="kv"><span>Current safety score</span><b style="color:' + (risk.score >= 70 ? 'var(--mint)' : risk.score >= 45 ? 'var(--amber)' : 'var(--red-ink)') + '">' + risk.score + ' / 100</b></div>' +
      '</div>' +
      '<div class="card"><div class="panel-title"><h4>Offline SOS beacon</h4><button class="icon-btn" onclick="aegisOfflinePanel()">↗</button></div>' +
        '<p class="lead-sm">If the network drops, coordinates are cached to IndexedDB and a compressed SMS/WhatsApp payload is generated locally.</p>' +
        '<div class="cert-preview" style="margin-top:8px"><div class="kicker">PAYLOAD PREVIEW</div><div class="hash" style="color:var(--ink);font-size:10px;margin-top:4px">' + esc(aegisSmsPayload('SOS')) + '</div></div>' +
        '<div class="actions" style="margin-top:10px"><button class="btn tiny primary" onclick="aegisCopyPayload()">Copy payload</button><button class="btn tiny" onclick="aegisWhatsAppSOS()">WhatsApp</button><button class="btn tiny" onclick="aegisToggleStealth()">Stealth mode</button></div>' +
      '</div>' +
    '</div></div>';
}

function aegisVaultPage() {
  const t = aegisSubject() || {};
  const id = AEG.identity;
  const ok = aegisLedgerVerify();
  return '<div class="split-2">' +
    '<div class="stack">' +
      '<div class="card">' +
        '<div class="hstack" style="justify-content:space-between"><div><span class="eyebrow no-rule">Cryptographic credential</span><h2 style="margin:4px 0 2px;font-size:20px">Digital tourist pass</h2></div><span class="badge safe">LIVE</span></div>' +
        '<div class="holo-scene"><div class="holo" id="holoCard">' +
          '<div class="holo-top"><div class="holo-brand"><span class="brand-mark">Æ</span> AEGISTRAVEL · VERIFIED IDENTITY</div><div class="holo-chip"></div></div>' +
          '<div class="holo-name">' + esc(t.name || 'Traveler') + '</div>' +
          '<div class="holo-role">' + esc(t.id || 'GUEST') + ' · TOURIST CLASS ' + (AEG.tier === 'free' ? 'I' : AEG.tier === 'pro' ? 'II' : 'III') + '</div>' +
          '<div class="holo-grid"><div class="holo-kv">' +
            '<div><div class="k">SHA-256 IDENTITY HASH</div><div class="v" id="holoHash">' + esc((id.hash || 'computing').slice(0, 34)) + '…</div></div>' +
            '<div><div class="k">BLOOD GROUP · ALLERGIES</div><div class="v">' + esc((t.blood || '—') + ' · ' + (t.allergy || 'None reported')) + '</div></div>' +
            '<div><div class="k">ISSUED</div><div class="v">' + (id.verifiedAt ? aegisFmtDate(id.verifiedAt) : aegisFmtDate(new Date())) + ' · AEGIS / IN</div></div>' +
          '</div><div class="holo-qr" id="idQR"><span class="qrload">GENERATING</span></div></div>' +
          '<div class="holo-bottom"><span class="holo-badge">◆ TAMPER-EVIDENT</span><span class="holo-med">EMERGENCY<br/><b>' + esc(t.blood || '—') + '</b> · ' + esc((t.allergy || 'NO ALLERGIES').slice(0, 22)) + '</span></div>' +
        '</div></div>' +
        '<div class="hstack" style="justify-content:space-between"><div><div class="kicker" id="qrStamp">ROTATING SECURE QR</div><div class="faint" style="font-size:10px;margin-top:2px" id="qrRotateState">ROTATES EVERY 9s</div></div>' +
          '<div class="hstack"><button class="btn tiny" onclick="aegisDrawIDQR(\'idQR\',150)">↻ Refresh QR</button><button class="btn tiny primary" onclick="aegisDownloadIDCard()">Download credential</button></div></div>' +
      '</div>' +
      '<div class="card"><div class="panel-title"><h4>Emergency medical badge</h4><span class="badge danger-b">CRITICAL DATA</span></div>' +
        '<div class="hstack" style="gap:14px;flex-wrap:wrap"><div class="blood-avatar">' + esc(t.blood || '—') + '</div>' +
        '<div style="flex:1;min-width:180px"><div class="kicker">ALLERGIES / CONDITIONS</div><div style="font-size:14px;font-weight:600;margin-top:3px">' + esc(t.allergy || 'None reported') + '</div>' +
        '<div class="kicker" style="margin-top:8px">NEXT OF KIN</div><div style="font-size:12px">' + esc(t.familyContactName || 'Not provided') + ' · ' + esc(t.familyContactPhone || '—') + '</div></div>' +
        '<button class="btn tiny" onclick="aegisGoto(\'medical\')">Edit record</button></div>' +
      '</div>' +
      '<div class="card"><div class="panel-title"><h4>Parametric incident certificates</h4><span class="kicker">Insurer-ready</span></div>' +
        '<p class="lead-sm">Every verified SOS or severe delay seals a block. Generate a certificate with GPS breadcrumbs, timestamps and the SHA-256 chain proof for instant claims.</p>' +
        '<div class="actions" style="margin-top:10px"><button class="btn primary" onclick="aegisOpenCertificate()">Generate verified certificate</button>' +
        '<button class="btn" onclick="aegisExportLedger()">Export full ledger (JSON)</button></div>' +
        '<div id="certHost" style="margin-top:12px"></div>' +
      '</div>' +
    '</div>' +
    '<div class="stack">' +
      '<div class="card"><div class="panel-title"><h4>Black-box incident ledger</h4><span class="chain-ok ' + (ok.ok ? '' : 'chain-bad') + '" id="chainState">' + (ok.ok ? '◆ SHA-256 chain intact' : '▲ ' + ok.broken.length + ' block(s) broken') + '</span></div>' +
        '<p class="lead-sm">Append-only. Each block commits the previous hash, so any edit is detectable by police, insurers or the traveller.</p>' +
        '<div class="actions" style="margin:10px 0"><button class="btn tiny" onclick="aegisVerifyChain()">Verify chain integrity</button><button class="btn tiny" onclick="aegisExportLedger()">Export</button></div>' +
        '<div class="ledger" id="ledgerList">' + aegisLedgerItemsHTML(12) + '</div>' +
      '</div>' +
      '<div class="card"><div class="panel-title"><h4>Verification protocol</h4></div>' +
        '<div class="sos-steps" style="margin:0"><div><i>1</i>Field officer scans the rotating QR (single-use token)</div><div><i>2</i>Hash recomputed from the identity dossier</div><div><i>3</i>Ledger chain replayed; mismatches flagged in crimson</div></div>' +
        '<div class="cert-preview" style="margin-top:10px"><div class="kicker">IDENTITY HASH</div><div class="hash" style="color:var(--ink);margin-top:4px" id="idHashFull">' + esc(id.hash || 'computing…') + '</div></div>' +
      '</div>' +
    '</div></div>';
}

function aegisCopilotPage() {
  const risk = aegisRiskContext();
  return '<div class="split-2">' +
    '<div class="stack">' +
      '<div class="card"><div class="hstack" style="justify-content:space-between"><div><span class="eyebrow no-rule">Contextual intelligence</span><h2 style="margin:4px 0 2px;font-size:20px">Area risk &amp; scam radar</h2></div><span class="badge ' + risk.tone + '" id="copilotBandFull">' + risk.band + '</span></div>' +
        '<div class="radar-panel" style="margin-top:14px">' +
          '<div class="gauge">' + aegisRing(risk.score / 100, 132, 7, 'copilotGaugeFull', risk.score >= 70 ? 'var(--mint)' : risk.score >= 45 ? 'var(--amber)' : 'var(--red)') + '<div class="gv"><b id="copilotScoreFull">' + risk.score + '</b><span>SAFETY / 100</span></div></div>' +
          '<div><div class="notice ' + (risk.recommendation.tone === 'danger' ? 'danger' : risk.recommendation.tone === 'warning' ? 'warning' : 'safe') + '" id="copilotRecFull" style="font-size:12px"><b>' + esc(risk.recommendation.title) + '</b><br/>' + esc(risk.recommendation.text) + '</div>' +
          '<div class="hstack" style="margin-top:8px"><span class="chip">' + Math.round(risk.crowd * 100) + '% footfall</span><span class="chip">' + risk.zone.dist + ' m to perimeter</span><span class="chip">ISO ' + risk.iso.toFixed(2) + '</span></div></div>' +
        '</div>' +
        '<div class="panel-title" style="margin-top:14px"><h4>Fusion factor breakdown</h4><span class="kicker">time · crowd · geofence · community · anomaly</span></div>' +
        '<div id="factorHostFull">' + aegisFactorBarsHTML(risk) + '</div>' +
      '</div>' +
      '<div class="card"><div class="panel-title"><h4>Community &amp; verified intelligence</h4><span class="chip" id="alertCountFull">' + (risk.near.length || AEG.alerts.length) + ' signals</span></div>' +
        '<div class="alert-list" id="alertListFull">' + aegisAlertItemsHTML(risk.near.length ? risk.near : AEG.alerts) + '</div>' +
        '<div class="actions" style="margin-top:10px"><button class="btn tiny primary" onclick="aegisOpenAlertForm()">＋ Report scam / hazard / safe haven</button><button class="btn tiny" onclick="aegisGoto(\'zones\')">Manage geofences</button></div>' +
      '</div>' +
    '</div>' +
    '<div class="stack">' +
      '<div class="card"><div class="panel-title"><h4>Scam radar legend</h4></div>' +
        '<div class="kv"><span>⚠ Scam hotspot</span><b>Overcharging, fake guides, card skimming</b></div>' +
        '<div class="kv"><span>▲ Hazard</span><b>Poor lighting, unsafe terrain, crowd surge</b></div>' +
        '<div class="kv"><span>✓ Safe haven</span><b>Police kiosk, verified cafe corridor, first aid</b></div>' +
        '<div class="notice" style="margin-top:10px;font-size:11.5px">Signals within 1.8 km are fused into your score. Verified partners carry 2× weight.</div>' +
      '</div>' +
      '<div class="card"><div class="panel-title"><h4>Time-of-day model</h4><span class="kicker">24h curve</span></div>' +
        '<div id="crowdChart">' + aegisCrowdChartHTML() + '</div>' +
        '<div class="kv" style="margin-top:8px"><span>Night penalty (23:00–05:00)</span><b>−18 pts</b></div>' +
        '<div class="kv"><span>Peak guardianship (10:00–13:00)</span><b>+0 pts</b></div>' +
      '</div>' +
      '<div class="card"><div class="panel-title"><h4>Nearby safe havens</h4></div>' +
        (risk.near.filter(a => a.type === 'haven').length
          ? risk.near.filter(a => a.type === 'haven').map(a => '<div class="row"><div><b>' + esc(a.title) + '</b><small>' + a.distance + ' m · ' + esc(a.desc) + '</small></div><span class="badge safe">HAVEN</span></div>').join('')
          : '<div class="feed-empty">No verified haven mapped nearby. Ask command to add one.</div>') +
      '</div>' +
    '</div></div>';
}

function aegisCrowdChartHTML() {
  let bars = '';
  for (let h = 0; h < 24; h++) {
    const d = new Date();
    d.setHours(h, 30, 0, 0);
    const v = aegisCrowdDensity(d);
    const night = h >= 22 || h < 6;
    bars += '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:56px"><div title="' + aegisPad(h) + ':00 · ' + Math.round(v * 100) + '%" style="height:' + Math.max(6, v * 100) + '%;background:' + (night ? 'rgba(255,42,95,.55)' : 'linear-gradient(180deg,rgba(0,240,255,.85),rgba(0,240,255,.2))') + ';border-radius:2px"></div></div>';
  }
  return '<div style="display:flex;gap:2px;align-items:flex-end">' + bars + '</div><div class="hstack" style="justify-content:space-between;margin-top:4px"><span class="kicker">00:00</span><span class="kicker">12:00</span><span class="kicker">23:59</span></div>';
}

function aegisFleetPage() {
  const flagged = AEG.fleet.filter(f => f.status !== 'Safe');
  const sos = AEG.fleet.filter(f => f.status === 'SOS');
  const avg = Math.round(AEG.fleet.reduce((s, f) => s + f.risk, 0) / Math.max(1, AEG.fleet.length));
  const slaBreaches = flagged.filter(f => {
    const sla = aegisSlaFor({ severity: f.status === 'SOS' ? 'HIGH' : 'MEDIUM', occurredAt: f.alertSince, status: f.status, slaMinutes: f.slaMinutes });
    return sla && sla.over;
  }).length;
  return '<div class="grid stats" style="margin-bottom:12px">' +
    '<div class="card"><div class="stat-label">Active tourists</div><div class="stat-num">' + AEG.fleet.length + '</div><div class="stat-sub">' + AEG.fleet.filter(f => f.network === 'ONLINE').length + ' streaming telemetry</div></div>' +
    '<div class="card"><div class="stat-label">Flagged</div><div class="stat-num" style="color:var(--amber-ink)">' + flagged.length + '</div><div class="stat-sub">' + sos.length + ' active SOS</div></div>' +
    '<div class="card"><div class="stat-label">Avg fleet risk</div><div class="stat-num">' + avg + '</div><div class="stat-sub">isolation forest · 60s window</div></div>' +
    '<div class="card"><div class="stat-label">SLA breaches</div><div class="stat-num" style="color:' + (slaBreaches ? 'var(--red-ink)' : 'var(--mint)') + '">' + slaBreaches + '</div><div class="stat-sub">8 min response target</div></div></div>' +
    '<div class="card">' +
      '<div class="between" style="margin-bottom:10px"><div class="hstack"><input class="search-box" id="fleetSearch" placeholder="Search name, ID or zone…" oninput="aegisPaintFleet()" style="max-width:240px"/>' +
        '<div class="tabrow"><button class="active" onclick="aegisFleetFilter(\'all\',this)">All</button><button onclick="aegisFleetFilter(\'alert\',this)">Flagged</button><button onclick="aegisFleetFilter(\'sos\',this)">SOS</button><button onclick="aegisFleetFilter(\'offline\',this)">Offline</button></div></div>' +
        '<div class="hstack"><span class="heat-legend">Risk <span class="heat-scale"></span></span><button class="btn tiny" onclick="aegisToggleHeat()">' + (AEG.prefs.heat ? 'Hide heatmap' : 'Heatmap') + '</button><button class="btn tiny amber" onclick="aegisBulkBroadcast()">Broadcast</button></div></div>' +
      '<div class="fleet-wrap"><table class="fleet"><thead><tr><th>Tourist</th><th>Zone</th><th>Status</th><th>Risk</th><th>Battery</th><th>SLA</th><th>Action</th></tr></thead><tbody id="fleetBody"></tbody></table></div>' +
      '<div class="faint" style="font-size:10px;margin-top:8px;font-family:var(--font-m)"><span id="fleetCount">' + AEG.fleet.length + '</span> rows · click a tourist to inspect · heatmap uses risk-weighted density</div>' +
    '</div>';
}

let AEG_FLEET_FILTER = 'all';
function aegisFleetFilter(filter, btn) {
  AEG_FLEET_FILTER = filter;
  if (btn && btn.parentElement) btn.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
  aegisPaintFleet();
}

function aegisDispatchPage() {
  const open = S.incidents.filter(i => i.status !== 'Resolved');
  const closed = S.incidents.filter(i => i.status === 'Resolved').slice(0, 5);
  return '<div class="split-2">' +
    '<div class="stack">' +
      '<div class="card"><div class="panel-title"><h4>Open incident queue</h4><span class="chip">' + open.length + ' active</span></div>' +
        (open.length ? open.map(i => {
          const sla = aegisSlaFor(i);
          return '<div class="card" style="margin-bottom:8px;padding:12px;border-color:' + (sla && sla.over ? 'rgba(255,42,95,.5)' : 'var(--line)') + '">' +
            '<div class="between"><div><b>' + esc(i.id) + ' · ' + esc(i.type) + '</b><div class="faint" style="font-size:10.5px">' + esc(i.tourist) + ' · ' + esc(i.zone || '—') + ' · ' + esc(i.time || '') + '</div></div>' +
            '<div style="text-align:right"><span class="badge ' + (i.severity === 'HIGH' ? 'danger-b' : 'warning') + '">' + esc(i.severity) + '</span>' +
            '<div class="sla ' + (sla && sla.over ? 'over' : 'ok') + '" data-sla="' + esc(i.id) + '" style="margin-top:4px">' + (sla ? sla.label : '—') + '</div></div></div>' +
            '<div class="hstack" style="margin-top:8px"><span class="chip">' + esc(i.assignedTo || 'Unassigned') + '</span>' + (i.etaMinutes ? '<span class="chip">ETA ' + i.etaMinutes + 'm</span>' : '') + '</div>' +
            '<div class="actions" style="margin-top:8px"><button class="btn tiny primary" onclick="aegisDispatchAction(\'' + esc(i.id) + '\',\'Acknowledged\')">Acknowledge</button>' +
            '<button class="btn tiny amber" onclick="aegisOpenDispatchBoard()">Assign unit</button>' +
            '<button class="btn tiny green" onclick="aegisDispatchAction(\'' + esc(i.id) + '\',\'Resolved\')">Resolve</button>' +
            '<button class="btn tiny" onclick="aegisOpenCertificateFor(\'' + esc(i.id) + '\')">Certificate</button></div></div>';
        }).join('') : '<div class="feed-empty">Queue clear. All incidents resolved.</div>') +
      '</div>' +
      '<div class="card"><div class="panel-title"><h4>Resolved this cycle</h4><button class="btn tiny" onclick="exportCSV()">Export CSV</button></div>' +
        (closed.length ? closed.map(i => '<div class="row"><div><b>' + esc(i.id) + ' · ' + esc(i.type) + '</b><small>' + esc(i.tourist) + ' · ' + esc(i.zone || '—') + '</small></div><span class="badge safe">Resolved</span></div>').join('') : '<div class="feed-empty">Nothing archived yet.</div>') +
      '</div>' +
    '</div>' +
    '<div class="stack">' +
      '<div class="card"><div class="panel-title"><h4>Responder units</h4><span class="kicker">' + AEGIS_UNITS.length + ' online</span></div>' +
        AEGIS_UNITS.map(u => '<div class="row"><div><b>' + esc(u.id) + ' · ' + esc(u.name) + '</b><small>' + u.type.toUpperCase() + ' · ' + u.lat.toFixed(3) + ', ' + u.lng.toFixed(3) + '</small></div><span class="badge cyan">READY</span></div>').join('') +
        '<div class="actions" style="margin-top:10px"><button class="btn tiny wide" onclick="aegisOpenDispatchBoard()">Dispatch nearest unit</button></div>' +
      '</div>' +
      '<div class="card"><div class="panel-title"><h4>Bulk broadcast</h4></div>' +
        '<p class="lead-sm">Push a targeted advisory to every tourist, a zone, or flagged profiles. Delivered in-app + queued for SMS.</p>' +
        '<div class="field"><label>Message</label><textarea id="bcMessage" rows="3" placeholder="e.g. Cyclone advisory — avoid coastal promenades after 18:00.">High tide advisory: avoid the causeway steps until 20:00.</textarea></div>' +
        '<div class="field"><label>Audience</label><select id="bcAudience"><option value="all">All tourists (' + AEG.fleet.length + ')</option><option value="flagged">Flagged only</option><option value="zone">Specific zone</option></select></div>' +
        '<div class="actions"><button class="btn primary" onclick="aegisBulkBroadcast()">Broadcast now</button></div>' +
        '<div id="bcLog" style="margin-top:10px"></div>' +
      '</div>' +
      '<div class="card"><div class="panel-title"><h4>SLA policy</h4></div>' +
        '<div class="kv"><span>CRITICAL / SOS</span><b>3–5 min</b></div><div class="kv"><span>HIGH</span><b>8 min</b></div><div class="kv"><span>MEDIUM</span><b>20 min</b></div><div class="kv"><span>LOW</span><b>45 min</b></div>' +
        '<div class="notice warning" style="margin-top:10px;font-size:11.5px">Breached SLAs escalate to the embassy channel when Aegis Pro/Enterprise is active.</div>' +
      '</div>' +
    '</div></div>';
}

function aegisDispatchAction(id, status) {
  const inc = S.incidents.find(i => i.id === id);
  if (!inc) return;
  S.active = inc;
  if (typeof updateIncident === 'function') updateIncident(status);
  else {
    inc.status = status;
    if (typeof save === 'function') save();
    if (typeof render === 'function') render();
  }
  aegisLedgerAppend(status === 'Resolved' ? 'INCIDENT_RESOLVED' : 'INCIDENT_' + status.toUpperCase(), 'Incident ' + status.toLowerCase(), {
    incidentId: id, by: (S.user && S.user.name) || 'Operator'
  });
  setTimeout(() => { if (typeof aegisPaintLive === 'function') aegisPaintLive(); }, 80);
}

/* ------------------------------------------------------------- misc modals */
function aegisOpenAlertForm() {
  const p = aegisPoint();
  openModal('<h2>Report an area</h2><p class="muted" style="font-size:12px">Community reports feed the scam radar and safety score within 1.8 km. Verified partners review submissions.</p>' +
    '<div class="field"><label>Category</label><select id="alertType"><option value="scam">⚠ Scam / overcharging hotspot</option><option value="hazard">▲ Hazard / poorly lit area</option><option value="crowd">◉ Crowd surge risk</option><option value="haven">✓ Verified safe haven</option></select></div>' +
    '<div class="field"><label>Title</label><input id="alertTitle" placeholder="e.g. Meter tampering at taxi stand"/></div>' +
    '<div class="field"><label>Details</label><textarea id="alertDesc" rows="3" placeholder="What should other travellers know?"></textarea></div>' +
    '<div class="field"><label>Coordinates</label><input id="alertCoords" value="' + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) + '"/></div>' +
    '<div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="aegisSubmitAlert()">Submit report</button></div>');
}

function aegisSubmitAlert() {
  const type = ($('alertType') || {}).value || 'scam';
  const title = cleanText(($('alertTitle') || {}).value || '', 70);
  const desc = cleanText(($('alertDesc') || {}).value || '', 220);
  const coords = (($('alertCoords') || {}).value || '').split(',');
  if (!title) { toast('Add a short title for the report', 'warning'); return; }
  const lat = parseFloat(coords[0]);
  const lng = parseFloat(coords[1]);
  aegisAddCommunityAlert({ title, desc, type, lat: isFinite(lat) ? lat : aegisPoint().lat, lng: isFinite(lng) ? lng : aegisPoint().lng });
  closeModal();
  aegisPaintCopilot();
  if (typeof toast === 'function') toast('Report submitted — folded into the risk model', 'success');
}

function aegisOfflinePanel() {
  aegisOfflineRead(8).then(rows => {
    openModal('<h2>Offline SOS beacon</h2><p class="muted" style="font-size:12px">Coordinates are cached locally (IndexedDB + localStorage) so a beacon can be sent without any network. The compressed payload is accepted by SMS, WhatsApp and satellite messengers.</p>' +
      '<div class="cert-preview" style="margin-top:10px"><div class="kicker">COMPRESSED PAYLOAD</div><div class="hash" style="color:var(--ink);margin-top:4px">' + esc(aegisSmsPayload('SOS')) + '</div></div>' +
      '<div class="hstack" style="margin-top:10px"><button class="btn tiny primary" onclick="aegisCopyPayload()">Copy</button><button class="btn tiny" onclick="aegisWhatsAppSOS()">WhatsApp</button><a class="btn tiny" href="' + esc(aegisSmsLink()) + '">SMS</a><a class="btn tiny" href="tel:112">Call 112</a></div>' +
      '<hr class="sep"/><div class="panel-title"><h4>Cached beacons</h4><span class="chip">' + rows.length + ' stored</span></div>' +
      (rows.length ? rows.map(r => '<div class="kv"><span>' + aegisFmtTime(r.cachedAt || r.ts) + '</span><b>' + Number(r.lat).toFixed(4) + ', ' + Number(r.lng).toFixed(4) + ' · ' + (r.battery != null ? r.battery + '%' : '—') + '</b></div>').join('') : '<div class="feed-empty">No cached beacons yet.</div>') +
      '<div class="actions" style="justify-content:space-between;margin-top:12px"><button class="btn" onclick="aegisCacheNow()">Cache current position</button><button class="btn primary" onclick="closeModal()">Close</button></div>');
  });
}

function aegisCacheNow() {
  aegisOfflineCache(aegisTelemetrySnapshot('MANUAL_CACHE')).then(res => {
    if (typeof toast === 'function') toast('Beacon cached (' + res.stored + ' · ' + res.count + ' total)', 'success');
    aegisNotify('ok', 'Beacon cached offline', res.stored + ' · ' + res.count + ' beacons retained');
  });
}

function aegisOpenSettings() {
  const q = (() => { try { return JSON.parse(localStorage.getItem('sts_pending_sync_queue') || '[]').length; } catch (e) { return 0; } })();
  openModal('<h2>Settings &amp; data</h2><p class="muted" style="font-size:12px">Local-first configuration. Cloud sync engages automatically when Supabase keys are live.</p>' +
    '<div class="row"><div><b>Stealth / low-power mode</b><small>Strips animation, dims telemetry, disables glow</small></div><button class="btn tiny ' + (AEG.stealth.on ? 'amber' : '') + '" onclick="aegisToggleStealth()">' + (AEG.stealth.on ? 'On' : 'Off') + '</button></div>' +
    '<div class="row"><div><b>Daylight operations</b><small>Switch between tactical dark and light HUD</small></div><button class="btn tiny" onclick="toggleTheme()">Toggle theme</button></div>' +
    '<div class="row"><div><b>Pulse watchdog</b><small>Auto-escalation state</small></div><span class="badge ' + (AEG.pulse.active ? 'warning' : 'neutral') + '">' + (AEG.pulse.active ? 'ARMED' : 'STANDBY') + '</span></div>' +
    '<div class="row"><div><b>Offline sync queue</b><small>Writes waiting for Supabase</small></div><span class="chip">' + q + ' pending</span></div>' +
    '<div class="row"><div><b>Evidence blocks</b><small>Chained SHA-256 records</small></div><button class="btn tiny" onclick="aegisVerifyChain()">Verify</button></div>' +
    '<div class="row"><div><b>Cloud database</b><small>' + (isCloudConnected ? 'Supabase connected' : 'Local storage fallback') + '</small></div><button class="btn tiny" onclick="closeModal();openSupabaseConfig()">Configure</button></div>' +
    '<div class="row"><div><b>Flight recorder</b><small>Reset demo state on this device</small></div><button class="btn tiny danger" onclick="closeModal();resetSystemData()">Reset</button></div>' +
    '<div class="actions" style="justify-content:flex-end;margin-top:14px"><button class="btn primary" onclick="closeModal()">Done</button></div>');
}

function aegisVerifyChain() {
  const res = aegisLedgerVerify();
  const host = $('chainState');
  if (host) {
    host.textContent = res.ok ? '◆ SHA-256 chain intact' : '▲ ' + res.broken.length + ' block(s) broken';
    host.className = 'chain-ok ' + (res.ok ? '' : 'chain-bad');
  }
  aegisLedgerAppend('CHAIN_VERIFIED', 'Ledger integrity verification', { blocks: res.checked, ok: res.ok, broken: res.broken });
  if (typeof toast === 'function') toast(res.ok ? 'Ledger verified · ' + res.checked + ' blocks intact' : 'Integrity failure in ' + res.broken.length + ' block(s)', res.ok ? 'success' : 'danger');
  aegisNotify(res.ok ? 'ok' : 'high', res.ok ? 'Ledger integrity verified' : 'Ledger tamper detected', res.checked + ' blocks recomputed · ' + (res.ok ? 'all hashes match' : 'broken: #' + res.broken.join(', #')));
}

/* ------------------------------------------------------------- render hooks */
const AEGIS_PAGES = {
  command: aegisCommandPage,
  pulse: aegisPulsePage,
  vault: aegisVaultPage,
  copilot: aegisCopilotPage,
  fleet: aegisFleetPage,
  dispatch: aegisDispatchPage
};

function aegisRender(page) {
  const fn = AEGIS_PAGES[page];
  if (fn) {
    try { return fn(); } catch (err) { console.error('Aegis page render error:', err); return null; }
  }
  if (page === 'billing' && typeof aegisBillingPage === 'function') return aegisBillingPage();
  return null;
}

function aegisAfterRender(page) {
  aegisPaintChrome();
  if (page === 'command') {
    aegisInitCommandMap();
    aegisDrawIDQR('vaultQR', 104);
    aegisRotateQR();
  }
  if (page === 'vault') {
    aegisEnsureIdentity().then(() => {
      aegisDrawIDQR('idQR', 150);
      aegisDrawIDQR('vaultQR', 104);
      const h = $('idHashFull');
      if (h) h.textContent = AEG.identity.hash || '';
      const hh = $('holoHash');
      if (hh && AEG.identity.hash) hh.textContent = AEG.identity.hash.slice(0, 34) + '…';
    });
    aegisBindHoloTilt();
    aegisRotateQR();
  }
  if (page === 'pulse') aegisPaintPulse();
  if (page === 'copilot') { aegisPaintCopilot(); }
  if (page === 'fleet') aegisPaintFleet();
  if (page === 'dispatch' && typeof aegisRenderBroadcastLog === 'function') aegisRenderBroadcastLog();
  if (page === 'billing' && typeof aegisBindBilling === 'function') aegisBindBilling();
  aegisPaintLive();
}

/* --------------------------------------------------------------- public API */
window.renderNav = aegisRenderNav;
window.aegisRender = aegisRender;
window.aegisAfterRender = aegisAfterRender;
window.aegisDefaultPage = aegisDefaultPage;

Object.keys(AEGIS_TITLES).forEach(k => { if (typeof titles !== 'undefined') titles[k] = AEGIS_TITLES[k]; });
Object.keys(AEGIS_ICONS).forEach(k => { if (typeof icons !== 'undefined') icons[k] = AEGIS_ICONS[k]; });
