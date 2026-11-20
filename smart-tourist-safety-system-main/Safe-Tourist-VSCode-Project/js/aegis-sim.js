'use strict';
/* ============================================================================
   AEGISTRAVEL SIMULATION, REPLAY & DISPATCH ENGINE
   ----------------------------------------------------------------------------
   • 56-person enterprise fleet seed (hotels / embassies / DMOs)
   • Isolation-Forest baseline fitting + per-step anomaly scoring
   • One-click scenarios: normal transit · route deviation · SOS panic
   • Time-travel playback over the recorded telemetry trail
   • Tier-1 SOS: siren, overlay, evidence block, auto-dispatch routing, SLA
   • Automated "are you safe?" check-in prompt with escalation on timeout
   ========================================================================== */

const AEGIS_HUBS = [
  { name: 'Gateway of India, Mumbai',  lat: 18.9220, lng: 72.8347, city: 'Mumbai',     zone: 'Gateway of India, Mumbai' },
  { name: 'Marine Drive Promenade',    lat: 18.9433, lng: 72.8235, city: 'Mumbai',     zone: 'Outside monitored zones' },
  { name: 'Colaba Causeway',           lat: 18.9067, lng: 72.8147, city: 'Mumbai',     zone: 'Outside monitored zones' },
  { name: 'Bandra Fort Sector',        lat: 19.0596, lng: 72.8295, city: 'Mumbai',     zone: 'Outside monitored zones' },
  { name: 'Juhu Beach Front',          lat: 19.1075, lng: 72.8263, city: 'Mumbai',     zone: 'Outside monitored zones' },
  { name: 'Pune Camp Heritage Walk',   lat: 18.5158, lng: 73.8796, city: 'Pune',       zone: 'Outside monitored zones' },
  { name: 'Ajanta Caves, Aurangabad',  lat: 20.5519, lng: 75.7033, city: 'Aurangabad', zone: 'Ajanta Caves, Aurangabad' },
  { name: 'Bhandardara Dam Overflow',  lat: 19.5398, lng: 73.7753, city: 'Nashik',     zone: 'Bhandardara Dam Overflow Area' }
];

const AEGIS_UNITS = [
  { id: 'MUM-01', name: 'Colaba Tourist Police Kiosk', lat: 18.9266, lng: 72.8317, type: 'police', phone: '112' },
  { id: 'MUM-04', name: 'Marine Drive Patrol Unit',     lat: 18.9433, lng: 72.8235, type: 'police', phone: '112' },
  { id: 'MUM-07', name: 'Bandra Rapid Medical Response',lat: 19.0596, lng: 72.8295, type: 'ems',    phone: '108' },
  { id: 'PUN-02', name: 'Pune Tourist Assistance Cell', lat: 18.5158, lng: 73.8796, type: 'police', phone: '112' },
  { id: 'AUR-03', name: 'Ajanta Ranger Response',       lat: 20.5519, lng: 75.7033, type: 'ranger', phone: '1363' },
  { id: 'NSK-05', name: 'Bhandardara Rescue Team',      lat: 19.5398, lng: 73.7753, type: 'rescue', phone: '108' }
];

const AEGIS_FIRST = ['Aarav','Diya','Kabir','Isha','Vivaan','Ananya','Reyansh','Myra','Advait','Saanvi','Arjun','Kiara','Rudra','Aadhya','Dev','Nitya','Ishaan','Pari','Yash','Riya','Neel','Tara','Om','Sara','Kian','Mira','Veer','Zoya','Aryan','Naina','Rohan','Aisha','Kunal','Meera','Siddh','Anika','Aditya','Sneha','Rahul','Pooja','Nikhil','Kavya','Manav','Trisha','Varun','Ritika','Sameer','Neha','Akash','Divya','Harsh','Ira','Nakul','Tanvi','Pranav','Ayesha'];
const AEGIS_LAST = ['Mehta','Sharma','Patel','Iyer','Nair','Bose','Kulkarni','Deshmukh','Shetty','Kapoor','Malhotra','Reddy','Ghosh','Pillai','Joshi','Verma','Chopra','Banerjee','Menon','Rao','Gupta','Saxena','Chawla','Bhat','Kaur','Sinha','Mishra','Dutta','Naidu','Ahuja'];
const AEGIS_HOTELS = ['Taj Mahal Palace','Marine Bay Hotel','Colaba Backpackers','Bandra Boutique Stay','Juhu Beach Resort','Pune Heritage Inn','Ajanta Rest House','Bhandardara Riverside Camp'];

let AEG_CHECKIN_TIMER = null;

/* ------------------------------------------------------------------ helpers */
function aegisRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function aegisNearestUnit(lat, lng) {
  let best = AEGIS_UNITS[0], bestD = Infinity;
  AEGIS_UNITS.forEach(u => {
    const d = haversine({ lat, lng }, { lat: u.lat, lng: u.lng });
    if (d < bestD) { bestD = d; best = u; }
  });
  return Object.assign({}, best, {
    distanceMeters: Math.round(bestD),
    etaMinutes: Math.max(2, Math.round(bestD / 1000 / 28 * 60) + 2)
  });
}

function aegisSlaMinutesFor(severity) {
  return severity === 'CRITICAL' ? 3 : severity === 'HIGH' ? 8 : severity === 'MEDIUM' ? 20 : 45;
}

function aegisSlaFor(inc) {
  if (!inc) return null;
  const total = (inc.slaMinutes || aegisSlaMinutesFor(inc.severity)) * 60000;
  let start = Date.parse(inc.occurredAt || inc.createdAt || inc.slaStartedAt || '');
  if (!isFinite(start)) start = Date.now();
  const deadline = inc.slaDeadline ? Date.parse(inc.slaDeadline) : start + total;
  const remaining = deadline - Date.now();
  return {
    total,
    remaining,
    deadline,
    over: remaining <= 0,
    pct: aegisClamp(100 - Math.max(0, remaining) / total * 100, 0, 100),
    label: remaining <= 0 ? 'SLA BREACH' : aegisFmtDur(remaining),
    resolved: inc.status === 'Resolved'
  };
}

/* ---------------------------------------------------------------- fleet seed */
function aegisSeedFleet(force) {
  if (!force && Array.isArray(AEG.fleet) && AEG.fleet.length >= 50) return AEG.fleet;
  const rnd = aegisRng(0xA3615);
  const fleet = [];
  for (let i = 0; i < 56; i++) {
    const hub = AEGIS_HUBS[i % AEGIS_HUBS.length];
    const name = AEGIS_FIRST[i % AEGIS_FIRST.length] + ' ' + AEGIS_LAST[(i * 7 + 3) % AEGIS_LAST.length];
    let status = 'Safe';
    if (i % 19 === 4) status = 'SOS';
    else if (i % 13 === 6) status = 'Alert';
    const battery = Math.round(46 + rnd() * 54);
    const risk = status === 'SOS' ? 82 + Math.round(rnd() * 14) : status === 'Alert' ? 46 + Math.round(rnd() * 24) : 8 + Math.round(rnd() * 26);
    const lat = +(hub.lat + (rnd() - 0.5) * 0.006).toFixed(6);
    const lng = +(hub.lng + (rnd() - 0.5) * 0.006).toFixed(6);
    fleet.push({
      id: 'ST-' + aegisPad(2001 + i, 5),
      name,
      email: name.toLowerCase().replace(/[^a-z]/g, '.') + '@traveler.aegis',
      phone: '98' + String(10000000 + Math.floor(rnd() * 89999999)),
      zone: aegisZoneAt(lat, lng).name,
      status,
      risk,
      battery,
      network: i % 11 === 9 ? 'OFFLINE' : 'ONLINE',
      lat,
      lng,
      accuracy: 8 + Math.round(rnd() * 26),
      locationSource: i % 5 === 0 ? 'gps' : 'demo',
      group: AEGIS_HOTELS[i % AEGIS_HOTELS.length],
      blood: ['O+', 'A+', 'B+', 'AB+', 'O-', 'A-'][i % 6],
      allergy: i % 4 === 0 ? 'Penicillin' : 'None reported',
      updatedAt: new Date(Date.now() - Math.round(rnd() * 240000)).toISOString(),
      alertSince: status === 'SOS' ? new Date(Date.now() - (4 + Math.round(rnd() * 22)) * 60000).toISOString() : null,
      slaMinutes: status === 'SOS' ? 5 : 15
    });
  }
  AEG.fleet = fleet;
  aegisSave();
  return AEG.fleet;
}

/* --------------------------------------------------------- route & features */
function aegisBuildRoute(origin) {
  const pts = [];
  const r = 0.00042; // ≈ 46 m radius loop
  const start = Math.random() * Math.PI * 2;
  const cosLat = Math.cos((origin.lat * Math.PI) / 180) || 1;
  for (let i = 0; i < 30; i++) {
    const a = start + i * ((Math.PI * 2) / 34);
    const wob = 1 + 0.16 * Math.sin(i * 1.7);
    pts.push({
      lat: +(origin.lat + Math.sin(a) * r * wob).toFixed(6),
      lng: +(origin.lng + (Math.cos(a) * r * wob) / cosLat).toFixed(6)
    });
  }
  return pts;
}

function aegisRouteIndex(route, lat, lng) {
  let best = 0, bestD = Infinity;
  route.forEach((p, i) => {
    const d = haversine({ lat, lng }, p);
    if (d < bestD) { bestD = d; best = i; }
  });
  return { index: best, distance: bestD };
}

function aegisFeatureVector(ctx) {
  const night = ctx.hour >= 22 || ctx.hour < 6 ? 1 : 0;
  return [
    aegisClamp(ctx.distFromRoute / 90, 0, 4),
    aegisClamp(Math.abs(ctx.speed) / 40, 0, 3),
    aegisClamp(Math.abs(ctx.headingDelta) / 90, 0, 3),
    aegisClamp(ctx.dwell / 45, 0, 4),
    night,
    aegisClamp(ctx.gap / 20, 0, 4)
  ];
}

function aegisFitBaseline() {
  if (AEGIF && AEGIF.trained) return AEGIF;
  const rows = [];
  for (let i = 0; i < 170; i++) {
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    rows.push([
      Math.abs(gauss()) * 0.34,
      0.06 + Math.abs(gauss()) * 0.09,
      Math.abs(gauss()) * 0.12,
      Math.abs(gauss()) * 0.10,
      Math.random() < 0.18 ? 1 : 0,
      0.04 + Math.abs(gauss()) * 0.06
    ]);
  }
  AEGIF = new AegisIsolationForest(64, 40).fit(rows);
  return AEGIF;
}

function aegisComputeAnomaly(distFromRoute, speed, headingDelta, dwell, gap) {
  const vec = aegisFeatureVector({ distFromRoute, speed, headingDelta, dwell, gap, hour: new Date().getHours() });
  const raw = AEGIF ? AEGIF.score(vec) : 0.5;
  // Blend the model output with the physical divergence so the signal is
  // interpretable in a live demo while remaining driven by the forest.
  return aegisClamp(Math.max(aegisAnomalyIntensity(raw), aegisClamp(distFromRoute / 130, 0, 1) * 0.92), 0, 1);
}

/* --------------------------------------------------------------- scenarios */
function aegisScenarioLabel(mode) {
  const map = {
    normal: 'NORMAL TRANSIT',
    deviation: 'ROUTE DEVIATION',
    sos: 'SOS PANIC',
    replay: 'HISTORY REPLAY'
  };
  return map[mode] || 'IDLE';
}

function aegisStartScenario(mode) {
  if (mode === 'replay') return aegisReplayStart();
  const t = aegisSubject();
  const p = aegisPoint(t);
  aegisFitBaseline();
  if (AEG.sim.mode === mode) return aegisStopScenario();
  AEG.sim.mode = mode;
  AEG.sim.startedAt = Date.now();
  AEG.sim.lastStep = 0;
  AEG.sim.step = 0;
  AEG.sim.deviation = 0;
  AEG.sim.ifScore = 0;
  AEG.sim.prompted = false;
  AEG.sim.route = aegisBuildRoute(p);
  AEG.sim.lastPos = { lat: p.lat, lng: p.lng };
  AEG.sim.replay.active = false;

  if (mode === 'sos') {
    aegisNotify('high', 'SOS panic simulation', 'Tier-1 beacon, evidence lock and responder routing engaged.');
    aegisTriggerSOS('simulation');
    if (typeof aegisPaintLive === 'function') aegisPaintLive();
    return;
  }

  if (mode === 'deviation') {
    aegisNotify('med', 'Deviation stress-test started', 'Trajectory will diverge from the approved corridor in 5 steps.');
    aegisLedgerAppend('SIMULATION_START', 'Route deviation stress-test', { touristId: t.id, mode, routePoints: 30 });
  } else {
    aegisNotify('ok', 'Normal transit simulation', 'Telemetry streaming along the approved corridor.');
    aegisLedgerAppend('SIMULATION_START', 'Normal transit simulation', { touristId: t.id, mode, routePoints: 30 });
  }
  if (typeof aegisDrawRoute === 'function') aegisDrawRoute(AEG.sim.route, null);
  if (typeof toast === 'function') toast('Scenario running · ' + aegisScenarioLabel(mode), 'info');
  if (typeof aegisPaintLive === 'function') aegisPaintLive();
}

function aegisStopScenario(silent) {
  const had = AEG.sim.mode;
  AEG.sim.mode = null;
  AEG.sim.step = 0;
  AEG.sim.deviation = 0;
  AEG.sim.ifScore = 0;
  AEG.sim.prompted = false;
  AEG.sim.route = [];
  if (had && !silent) {
    aegisLedgerAppend('SIMULATION_END', 'Simulation stopped', { mode: had, steps: AEG.sim.step || 0 });
    aegisNotify('info', 'Simulation stopped', 'Telemetry returned to live profile coordinates.');
  }
  if (typeof aegisClearRoute === 'function') aegisClearRoute();
  if (typeof aegisPaintLive === 'function') aegisPaintLive();
  if (!silent && typeof toast === 'function') toast('Simulation stopped', 'info');
}

function aegisSimStep() {
  const mode = AEG.sim.mode;
  if (!mode || mode === 'sos') return;
  const t = aegisSubject();
  if (!t) return;
  const route = AEG.sim.route && AEG.sim.route.length ? AEG.sim.route : aegisBuildRoute(aegisPoint(t));
  AEG.sim.route = route;
  AEG.sim.step = (AEG.sim.step || 0) + 1;
  const idx = AEG.sim.step % route.length;
  let pos = Object.assign({}, route[idx]);
  let deviation = 0;

  if (mode === 'deviation' && AEG.sim.step > 4) {
    const grow = Math.min(0.0022, (AEG.sim.step - 4) * 0.00023);
    const next = route[(idx + 1) % route.length];
    const dLat = next.lat - route[idx].lat;
    const dLng = next.lng - route[idx].lng;
    const len = Math.hypot(dLat, dLng) || 1e-9;
    // perpendicular offset (right-hand side of travel)
    pos = {
      lat: +(pos.lat - (dLng / len) * grow).toFixed(6),
      lng: +(pos.lng + (dLat / len) * grow).toFixed(6)
    };
    deviation = haversine(pos, route[idx]);
    AEG.sim.deviation = deviation;
  } else {
    AEG.sim.deviation = 0;
  }

  const prev = AEG.sim.lastPos || pos;
  const stepDist = haversine(prev, pos);
  const speedKph = (stepDist / 1.4) * 3.6 * 0.32; // scaled for demo pacing
  const heading = Math.atan2(pos.lat - prev.lat, pos.lng - prev.lng) * (180 / Math.PI);
  const prevHeading = AEG.sim.lastHeading != null ? AEG.sim.lastHeading : heading;
  const headingDelta = Math.abs(((heading - prevHeading + 540) % 360) - 180);
  AEG.sim.lastHeading = heading;
  AEG.sim.lastPos = Object.assign({}, pos);

  aegisMoveSubject(pos.lat, pos.lng);
  AEG.sim.ifScore = aegisComputeAnomaly(deviation, speedKph, headingDelta, 0, 1.4);
  aegisIngestTelemetry(t, { ifScore: +AEG.sim.ifScore.toFixed(3), sim: mode });

  if (mode === 'deviation' && AEG.sim.step === 5 && !AEG.sim.anomalyLogged) {
    AEG.sim.anomalyLogged = true;
    const entry = aegisLedgerAppend('ANOMALY_DETECTED', 'Route deviation anomaly detected', {
      touristId: t.id,
      divergenceMeters: Math.round(deviation),
      isolationScore: +AEG.sim.ifScore.toFixed(3),
      point: pos
    });
    AEG.sim.lastEvidence = entry.hash;
    aegisNotify('high', 'Isolation Forest anomaly · ' + AEG.sim.ifScore.toFixed(2),
      'Trajectory diverged ' + Math.round(deviation) + ' m from the approved corridor.');
    aegisBlip(220, 0.16, 'square', 0.07);
    if (typeof toast === 'function') toast('⚠ Route deviation detected — risk score spiking', 'warning');
  }

  if (mode === 'deviation' && AEG.sim.step === 9 && !AEG.sim.prompted) {
    AEG.sim.prompted = true;
    if (typeof toast === 'function') toast('Automated check-in prompt generated', 'info');
    if (typeof aegisRaiseCheckinPrompt === 'function') aegisRaiseCheckinPrompt('deviation');
  }

  if (mode === 'normal' && AEG.sim.step % 12 === 0) {
    aegisLedgerAppend('TELEMETRY_SEAL', 'Telemetry window sealed', {
      touristId: t.id,
      samples: Math.min(12, AEG.trail.length),
      windowHash: sha256HexSync(JSON.stringify(AEG.trail.slice(-12))).slice(0, 32)
    });
    if (typeof sbAegisTouristExtras === 'function') sbAegisTouristExtras(t);
    if (typeof sbAegisTelemetryInsert === 'function' && AEG.trail.length > 6) sbAegisTelemetryInsert(AEG.trail.slice(-6));
  }

  if (typeof aegisDrawRoute === 'function') aegisDrawRoute(route, { point: pos, deviation });
  if (typeof aegisDrawSubject === 'function') aegisDrawSubject();
  if (typeof aegisPaintLive === 'function') aegisPaintLive();
}

function aegisSimTick() {
  // playback engine
  const rp = AEG.sim.replay;
  if (rp.active && rp.playing) {
    const now = Date.now();
    const interval = 700 / Math.max(0.5, rp.speed || 1);
    if (!rp.lastFrame || now - rp.lastFrame >= interval) {
      rp.lastFrame = now;
      rp.index = (rp.index + 1) % Math.max(1, AEG.trail.length);
      aegisReplayFrame();
    }
  }
  if (!AEG.sim.mode || AEG.sim.mode === 'sos') return;
  const now = Date.now();
  if (!AEG.sim.lastStep || now - AEG.sim.lastStep >= 1400) {
    AEG.sim.lastStep = now;
    aegisSimStep();
  }
}

function aegisMoveSubject(lat, lng) {
  const t = aegisSubject();
  if (!t) return null;
  t.lat = +Number(lat).toFixed(6);
  t.lng = +Number(lng).toFixed(6);
  t.updatedAt = aegisNowIso();
  t.locationSource = 'sim';
  t.zone = aegisZoneAt(t.lat, t.lng).name;
  if (S.role === 'tourist') {
    S.loc = { lat: t.lat, lng: t.lng, accuracy: t.accuracy || 14, updatedAt: t.updatedAt };
    if (typeof setSelfZone === 'function') setSelfZone(t);
  }
  if (S.user && S.user.id === t.id) Object.assign(S.user, { lat: t.lat, lng: t.lng, zone: t.zone });
  return t;
}

/* --------------------------------------------------------------- replay mode */
function aegisReplayStart() {
  if (!AEG.trail || AEG.trail.length < 6) {
    if (typeof toast === 'function') toast('Recorded telemetry is too short — run a simulation first', 'warning');
    return;
  }
  AEG.sim.replay = { active: true, index: 0, speed: 1, playing: true, lastFrame: 0 };
  AEG.sim.mode = null;
  if (typeof aegisDrawTrail === 'function') aegisDrawTrail();
  aegisReplayFrame();
  aegisNotify('info', 'History replay engaged', AEG.trail.length + ' telemetry frames loaded.');
  if (typeof toast === 'function') toast('Replaying recorded movement history', 'info');
  if (typeof aegisPaintLive === 'function') aegisPaintLive();
}

function aegisReplayToggle() {
  const rp = AEG.sim.replay;
  if (!rp.active) return aegisReplayStart();
  rp.playing = !rp.playing;
  if (typeof aegisPaintLive === 'function') aegisPaintLive();
}

function aegisReplaySetSpeed(speed) {
  AEG.sim.replay.speed = speed;
  if (typeof aegisPaintLive === 'function') aegisPaintLive();
}

function aegisReplayScrub(value) {
  if (!AEG.trail.length) return;
  const rp = AEG.sim.replay;
  rp.active = true;
  rp.playing = false;
  rp.index = Math.round((Number(value) / 100) * (AEG.trail.length - 1));
  aegisReplayFrame();
}

function aegisReplayFrame() {
  const rp = AEG.sim.replay;
  if (!rp.active || !AEG.trail.length) return;
  const point = AEG.trail[Math.min(rp.index, AEG.trail.length - 1)];
  if (!point) return;
  if (typeof aegisDrawReplayMarker === 'function') aegisDrawReplayMarker(point);
  if (typeof aegisPaintLive === 'function') aegisPaintLive();
}

function aegisReplayStop() {
  AEG.sim.replay.active = false;
  AEG.sim.replay.playing = false;
  if (typeof aegisClearReplay === 'function') aegisClearReplay();
  if (typeof aegisPaintLive === 'function') aegisPaintLive();
}

/* ------------------------------------------------------- check-in escalation */
function aegisRaiseCheckinPrompt(reason) {
  let left = 25;
  const render = () => {
    openModal('<div class="hstack" style="gap:8px;margin-bottom:6px"><span class="badge warning">AUTOMATED CHECK-IN</span><span class="kicker">' + esc(aegisScenarioLabel(AEG.sim.mode)) + '</span></div>' +
      '<h2>Are you safe?</h2>' +
      '<p class="muted" style="font-size:12.5px">Your trajectory diverged from the approved corridor by <b>' + Math.round(AEG.sim.deviation) + ' m</b>. Isolation-Forest risk is <b>' + AEG.sim.ifScore.toFixed(2) + '</b>. Confirm you are safe, or help will be dispatched automatically.</p>' +
      '<div class="sos-code" style="border-color:rgba(255,176,32,.35)"><span>Auto-escalation in</span><b id="ckCount">' + left + 's</b></div>' +
      '<div class="sos-steps"><div><i>1</i>Tap “I’m safe” to reset the safety pulse</div><div><i>2</i>No response → Tier-1 SOS broadcast with your last coordinates</div><div><i>3</i>Evidence block sealed for insurance verification</div></div>' +
      '<div class="actions" style="justify-content:flex-end"><button class="btn danger" onclick="aegisCheckinSOS()">Send SOS now</button><button class="btn primary" onclick="aegisCheckinSafe()">I’m safe</button></div>');
  };
  render();
  clearInterval(AEG_CHECKIN_TIMER);
  AEG_CHECKIN_TIMER = setInterval(() => {
    left -= 1;
    const el = $('ckCount');
    if (el) el.textContent = left + 's';
    if (left <= 0) {
      clearInterval(AEG_CHECKIN_TIMER);
      AEG_CHECKIN_TIMER = null;
      closeModal();
      aegisNotify('high', 'Check-in timed out', 'Automated Tier-1 escalation for unacknowledged deviation.');
      aegisTriggerSOS(reason + '-unacknowledged');
    }
  }, 1000);
  aegisBlip(660, 0.14, 'triangle', 0.06);
}

function aegisCheckinSafe() {
  clearInterval(AEG_CHECKIN_TIMER);
  AEG_CHECKIN_TIMER = null;
  closeModal();
  aegisPulseSafe('deviation-prompt');
  AEG.sim.deviation = 0;
  AEG.sim.ifScore = 0;
  AEG.sim.prompted = false;
  aegisSimStopDeviation();
  if (typeof toast === 'function') toast('Marked safe — deviation scenario resolved', 'success');
}

function aegisCheckinSOS() {
  clearInterval(AEG_CHECKIN_TIMER);
  AEG_CHECKIN_TIMER = null;
  closeModal();
  aegisTriggerSOS('deviation-confirmed');
}

function aegisSimStopDeviation() {
  if (AEG.sim.mode === 'deviation') {
    AEG.sim.mode = 'normal';
    AEG.sim.lastStep = Date.now();
    aegisNotify('ok', 'Corridor re-joined', 'Risk model returned to nominal baseline.');
  }
  if (typeof aegisPaintLive === 'function') aegisPaintLive();
}

/* --------------------------------------------------------------------- SOS */
function aegisTriggerSOS(reason, snapshot) {
  const subject = aegisSubject();
  const snap = snapshot || aegisTelemetrySnapshot('SOS');
  const incidentId = newId('INC');
  const breadcrumbs = AEG.trail.slice(-14);
  const unit = aegisNearestUnit(snap.lat, snap.lng);
  const entry = aegisLedgerAppend('SOS_TRIGGERED', 'Tier-1 SOS broadcast sealed', {
    incidentId,
    touristId: snap.touristId,
    name: snap.name,
    reason: reason || 'manual',
    coordinates: { lat: snap.lat, lng: snap.lng, accuracy: snap.accuracy },
    battery: snap.battery,
    network: snap.network,
    zone: snap.zone,
    anomalyScore: +(AEG.sim.ifScore || 0).toFixed(3),
    breadcrumbs,
    dispatchedUnit: unit.id
  }, { subjectId: snap.touristId, severity: 'CRITICAL' });

  const existing = S.incidents.find(i => i.touristId === subject.id && i.type === 'SOS Alert' && i.status !== 'Resolved');
  let incident = existing;
  if (existing) {
    Object.assign(existing, {
      lat: snap.lat, lng: snap.lng, accuracy: snap.accuracy,
      severity: 'HIGH', status: 'New', zone: snap.zone, source: reason || 'sos',
      evidenceHash: entry.hash, auditRef: existing.auditRef || auditRef(),
      slaMinutes: 5, slaDeadline: new Date(Date.now() + 5 * 60000).toISOString(),
      ifScore: +AEG.sim.ifScore.toFixed(3), assignedTo: unit.id + ' · ' + unit.name,
      unit, etaMinutes: unit.etaMinutes
    });
  } else {
    incident = {
      id: incidentId,
      tourist: snap.name,
      touristId: snap.touristId,
      type: 'SOS Alert',
      severity: 'HIGH',
      status: 'Assigned',
      time: new Date().toLocaleString('en-IN'),
      zone: snap.zone || 'Outside monitored zones',
      description: 'Tier-1 SOS (' + (reason || 'manual') + ') · auto-dispatched ' + unit.id,
      lat: snap.lat,
      lng: snap.lng,
      accuracy: snap.accuracy,
      auditRef: auditRef(),
      source: reason || 'sos',
      assignedTo: unit.id + ' · ' + unit.name,
      unit,
      etaMinutes: unit.etaMinutes,
      slaMinutes: 5,
      slaDeadline: new Date(Date.now() + 5 * 60000).toISOString(),
      occurredAt: aegisNowIso(),
      evidenceHash: entry.hash,
      ifScore: +AEG.sim.ifScore.toFixed(3),
      battery: snap.battery,
      network: snap.network
    };
    S.incidents.unshift(incident);
  }
  S.active = incident;
  subject.status = 'SOS';
  AEG.counters.sos = (AEG.counters.sos || 0) + 1;
  AEG.sim.sosIncident = incident.id;
  aegisSave();
  if (typeof save === 'function') save();
  if (isCloudConnected && typeof sbUpsertIncident === 'function') sbUpsertIncident(incident);
  if (isCloudConnected && typeof sbUpsertTourist === 'function') sbUpsertTourist(subject);
  aegisOfflineCache(snap);

  aegisNotify('high', 'TIER-1 SOS BROADCAST', snap.name + ' · ' + Math.round(snap.lat * 1000) / 1000 + ', ' + Math.round(snap.lng * 1000) / 1000 + ' · unit ' + unit.id + ' dispatched');
  aegisShowSOSOverlay(incident, snap, unit, entry);
  aegisSirenStart();
  aegisHaptic([80, 60, 180]);
  document.body.classList.add('sos-active');
  if (typeof aegisDrawDispatch === 'function') aegisDrawDispatch(unit, snap);
  if (typeof aegisPaintLive === 'function') aegisPaintLive();
  return incident;
}

function aegisShowSOSOverlay(incident, snap, unit, entry) {
  const overlay = $('sosOverlay');
  if (!overlay) return;
  overlay.classList.add('on');
  const sub = $('sosOverlaySub');
  if (sub) sub.textContent = 'Tier-1 broadcast · ' + (unit ? unit.id + ' dispatched · ETA ' + unit.etaMinutes + ' min' : 'responder routing');
  const coords = $('sosOverlayCoords');
  if (coords) coords.textContent = Number(snap.lat).toFixed(6) + ', ' + Number(snap.lng).toFixed(6) + ' ±' + snap.accuracy + 'm';
  const hash = $('sosOverlayHash');
  if (hash) hash.textContent = 'HASH ' + String((entry && entry.hash) || '').slice(0, 12).toUpperCase();
  const steps = $('sosOverlaySteps');
  if (steps) {
    steps.innerHTML = [
      'Evidence block sealed · SHA-256 ' + String((entry && entry.hash) || '').slice(0, 10) + '…',
      'Battery ' + (snap.battery != null ? snap.battery + '%' : 'unknown') + ' · network ' + snap.network,
      'Nearest unit ' + (unit ? unit.id + ' (' + unit.distanceMeters + ' m, ETA ' + unit.etaMinutes + ' min)' : 'routing'),
      'Digital ID + medical record transmitted to command'
    ].map((t, i) => '<div><i>' + (i + 1) + '</i>' + esc(t) + '</div>').join('');
  }
}

function aegisCloseSOSOverlay() {
  const overlay = $('sosOverlay');
  if (overlay) overlay.classList.remove('on');
  aegisSirenStop();
  if (typeof toast === 'function') toast('Alert minimised — broadcast continues in command center', 'warning');
}

function aegisCancelSOS() {
  const subject = aegisSubject();
  const active = S.incidents.filter(i => i.touristId === subject.id && i.type === 'SOS Alert' && i.status !== 'Resolved');
  active.forEach(i => {
    i.status = 'Resolved';
    i.resolvedAt = aegisNowIso();
    i.description = (i.description || '') + ' · cancelled by traveller';
    if (isCloudConnected && typeof sbUpsertIncident === 'function') sbUpsertIncident(i);
  });
  subject.status = 'Safe';
  if (AEG.sim.mode === 'sos') AEG.sim.mode = null;
  aegisSirenStop();
  const overlay = $('sosOverlay');
  if (overlay) overlay.classList.remove('on');
  document.body.classList.remove('sos-active');
  aegisLedgerAppend('SOS_CANCELLED', 'SOS cancelled — false alarm', {
    touristId: subject.id, resolved: active.map(i => i.id), cancelledAt: aegisNowIso()
  });
  aegisNotify('ok', 'SOS cancelled', 'Broadcast withdrawn. Incident archived with audit trail intact.');
  if (typeof save === 'function') save();
  if (typeof aegisPaintLive === 'function') aegisPaintLive();
  if (typeof toast === 'function') toast('SOS cancelled — responders stood down', 'success');
}

function aegisPanic() {
  const active = S.incidents.find(i => i.touristId === aegisSubject().id && i.type === 'SOS Alert' && i.status !== 'Resolved');
  if (active) {
    const overlay = $('sosOverlay');
    if (overlay) overlay.classList.add('on');
    aegisSirenStart();
    return;
  }
  const snap = aegisTelemetrySnapshot('PANIC_BUTTON');
  openModal('<div class="hstack" style="gap:8px;margin-bottom:6px"><span class="badge danger-b">TIER-1</span><span class="kicker">Panic channel</span></div>' +
    '<h2>Send emergency SOS?</h2>' +
    '<p class="muted" style="font-size:12.5px">This broadcasts your live coordinates, Digital ID hash, medical badge and battery/network state to the command center, and dispatches the nearest responder unit.</p>' +
    '<div class="sos-code"><span>Beacon position</span><b>' + snap.lat.toFixed(5) + ', ' + snap.lng.toFixed(5) + '</b></div>' +
    '<div class="sos-code"><span>Nearest unit</span><b>' + aegisNearestUnit(snap.lat, snap.lng).id + '</b></div>' +
    '<div class="actions" style="justify-content:flex-end;margin-top:14px"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn danger" onclick="closeModal();aegisTriggerSOS(\'panic-button\')">Send SOS now</button></div>');
}

/* ------------------------------------------------------------- dispatch API */
function aegisAssignUnit(incidentId, unitId) {
  const inc = S.incidents.find(i => i.id === incidentId);
  if (!inc) return;
  const unit = AEGIS_UNITS.find(u => u.id === unitId) || aegisNearestUnit(inc.lat || DC.lat, inc.lng || DC.lng);
  inc.assignedTo = unit.id + ' · ' + unit.name;
  inc.unit = unit;
  inc.etaMinutes = unit.etaMinutes;
  inc.status = 'Assigned';
  inc.slaMinutes = inc.slaMinutes || 5;
  inc.slaDeadline = inc.slaDeadline || new Date(Date.now() + inc.slaMinutes * 60000).toISOString();
  aegisLedgerAppend('UNIT_ASSIGNED', 'Response unit assigned', {
    incidentId, unit: unit.id, unitName: unit.name, etaMinutes: unit.etaMinutes
  });
  if (typeof save === 'function') save();
  if (isCloudConnected && typeof sbUpsertIncident === 'function') sbUpsertIncident(inc);
  aegisNotify('med', 'Unit ' + unit.id + ' assigned', inc.id + ' · ETA ' + unit.etaMinutes + ' min');
  if (typeof aegisDrawDispatch === 'function') aegisDrawDispatch(unit, { lat: inc.lat, lng: inc.lng });
  if (typeof aegisPaintLive === 'function') aegisPaintLive();
  if (typeof toast === 'function') toast('Unit ' + unit.id + ' dispatched · ETA ' + unit.etaMinutes + ' min', 'success');
}

function aegisOpenDispatchBoard() {
  const open = S.incidents.filter(i => i.status !== 'Resolved');
  if (!open.length) {
    if (typeof toast === 'function') toast('No open incidents to dispatch', 'info');
    return;
  }
  const inc = open[0];
  openModal('<h2>Dispatch responder</h2><p class="muted" style="font-size:12px">' + esc(inc.id) + ' · ' + esc(inc.type) + ' · ' + esc(inc.tourist) + '</p>' +
    AEGIS_UNITS.map(u => '<div class="row"><div><b>' + esc(u.id) + ' · ' + esc(u.name) + '</b><small>' + u.type.toUpperCase() + ' · ' + Math.round(haversine({ lat: inc.lat || DC.lat, lng: inc.lng || DC.lng }, { lat: u.lat, lng: u.lng })) + ' m away</small></div><button class="btn tiny primary" onclick="aegisAssignUnit(\'' + esc(inc.id) + '\',\'' + esc(u.id) + '\');closeModal()">Dispatch</button></div>').join('') +
    '<div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="btn" onclick="closeModal()">Close</button></div>');
}
