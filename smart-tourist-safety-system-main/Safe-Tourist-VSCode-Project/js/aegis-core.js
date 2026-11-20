'use strict';
/* ============================================================================
   AEGISTRAVEL CORE — intelligence layer
   ----------------------------------------------------------------------------
   • Persistent Aegis state (localStorage) with safe defaults
   • Real SHA-256 (Web Crypto + pure-JS fallback for file:// contexts)
   • Tamper-evident, chained incident ledger ("black box")
   • Isolation-Forest anomaly detector (client-side, no dependencies)
   • Safety Pulse dead-man switch with auto Tier-1 escalation
   • Contextual 0–100 safety score: time, crowd, geofence, community alerts
   • Offline-first beacon cache (IndexedDB + localStorage ring buffer)
   • Stealth / low-power mode, disguise (decoy) screen, SMS payload builder
   This module never touches existing Supabase table mappings; persistence is
   delegated to optional `sbAegis*` helpers that no-op gracefully when offline.
   ========================================================================== */

const AEGIS_KEY = 'sts_aegis_v1';
const AEGIS_VERSION = '6.0';
const AEGIS_TIERS = {
  free:       { label: 'EXPLORER',   rank: 0 },
  pro:        { label: 'AEGIS PRO',  rank: 1 },
  enterprise: { label: 'ENTERPRISE', rank: 2 }
};

const AEG = {
  version: AEGIS_VERSION,
  tier: 'free',
  subscription: null,
  ledger: [],
  feed: [],
  alerts: [],
  trail: [],
  fleet: [],
  pulse: { active: false, interval: 900, startedAt: null, deadline: null, lastCheckin: null, escalated: false, escalations: 0 },
  stealth: { on: false, auto: false },
  battery: { level: null, charging: null, simulated: true, ts: null, warnedLow: false },
  identity: { hash: null, forId: null, verifiedAt: null },
  certs: [],
  broadcasts: [],
  prefs: { drawerLeft: true, drawerRight: true, sideTab: 'copilot', heat: false, mapMode: 'tactical' },
  sim: { mode: null, startedAt: null, lastStep: 0, deviation: 0, ifScore: 0, replay: { active: false, index: 0, speed: 1, playing: false } },
  counters: { sos: 0, checkins: 0, blocks: 0, broadcasts: 0 },
  booted: false,
  startedAt: new Date().toISOString()
};

let AEGIF = null;                 // fitted Isolation Forest instance
let AEG_CLOCK_TICK = null;        // single heartbeat interval
let AEG_AUDIO_CTX = null;         // lazily created WebAudio context
let AEG_SIREN = null;             // active siren oscillator
let AEG_DECOY_TAPS = 0;
let AEG_DECOY_TAP_TS = 0;

/* ---------------------------------------------------------------- utilities */
const aegisUid = (p = 'AX') => p + '-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
const aegisClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const aegisPad = (n, w = 2) => String(n).padStart(w, '0');
const aegisNowIso = () => new Date().toISOString();
const aegisFmtTime = d => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const aegisFmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const aegisFmtDur = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return aegisPad(m) + ':' + aegisPad(s % 60);
};
const aegisRelTime = ts => {
  const diff = Date.now() - new Date(ts).getTime();
  if (!isFinite(diff) || diff < 0) return 'now';
  if (diff < 60000) return Math.max(1, Math.round(diff / 1000)) + 's ago';
  if (diff < 3600000) return Math.round(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.round(diff / 3600000) + 'h ago';
  return Math.round(diff / 86400000) + 'd ago';
};
const aegisTierRank = () => (AEGIS_TIERS[AEG.tier] || AEGIS_TIERS.free).rank;

/* ------------------------------------------------------------------ storage */
function aegisSave() {
  try {
    const payload = {
      version: AEGIS_VERSION, tier: AEG.tier, subscription: AEG.subscription,
      ledger: AEG.ledger.slice(0, 160), feed: AEG.feed.slice(0, 70),
      alerts: AEG.alerts, trail: AEG.trail.slice(-720), fleet: AEG.fleet,
      pulse: AEG.pulse, stealth: AEG.stealth, battery: AEG.battery,
      identity: AEG.identity, certs: AEG.certs.slice(0, 40), broadcasts: AEG.broadcasts.slice(0, 30),
      prefs: AEG.prefs, counters: AEG.counters, startedAt: AEG.startedAt
    };
    localStorage.setItem(AEGIS_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('Aegis state could not be persisted:', err && err.message);
  }
}

function aegisLoad() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(AEGIS_KEY) || 'null'); } catch (e) { saved = null; }
  if (!saved || typeof saved !== 'object') return AEG;
  if (saved.tier && AEGIS_TIERS[saved.tier]) AEG.tier = saved.tier;
  if (saved.subscription) AEG.subscription = saved.subscription;
  ['ledger', 'feed', 'alerts', 'trail', 'fleet', 'certs', 'broadcasts'].forEach(k => {
    if (Array.isArray(saved[k])) AEG[k] = saved[k];
  });
  if (saved.pulse && typeof saved.pulse === 'object') AEG.pulse = Object.assign(AEG.pulse, saved.pulse);
  if (saved.stealth) AEG.stealth = Object.assign(AEG.stealth, saved.stealth);
  if (saved.battery) AEG.battery = Object.assign(AEG.battery, saved.battery);
  if (saved.identity) AEG.identity = Object.assign(AEG.identity, saved.identity);
  if (saved.prefs) AEG.prefs = Object.assign(AEG.prefs, saved.prefs);
  if (saved.counters) AEG.counters = Object.assign(AEG.counters, saved.counters);
  if (saved.startedAt) AEG.startedAt = saved.startedAt;
  // A pulse deadline that expired while the app was closed must escalate on boot.
  if (AEG.pulse.active && AEG.pulse.deadline && Date.now() > AEG.pulse.deadline && !AEG.pulse.escalated) {
    AEG.pulse.escalated = true;
    setTimeout(() => aegisEscalatePulse('restored-expired'), 1200);
  }
  return AEG;
}

/* ----------------------------------------------------------------- SHA-256 */
function aegisRotr(x, n) { return (x >>> n) | (x << (32 - n)); }

function sha256HexSync(message) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const str = String(message);
  const bytes = new TextEncoder().encode(str);
  const bitLen = bytes.length * 8;
  const total = (((bytes.length + 9 + 63) >> 6) << 6);
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(bitLen / 4294967296));
  dv.setUint32(total - 4, bitLen >>> 0);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15], y = w[t - 2];
      const s0 = (aegisRotr(x, 7) ^ aegisRotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (aegisRotr(y, 17) ^ aegisRotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = (aegisRotr(e, 6) ^ aegisRotr(e, 11) ^ aegisRotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ ((~e) & g)) >>> 0;
      const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = (aegisRotr(a, 2) ^ aegisRotr(a, 13) ^ aegisRotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map(x => x.toString(16).padStart(8, '0')).join('');
}

async function aegisSha256(str) {
  try {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      const data = new TextEncoder().encode(String(str));
      const digest = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (err) { /* fall through to synchronous implementation */ }
  return sha256HexSync(str);
}

/* ------------------------------------------------------------ ledger / feed */
function aegisLedgerAppend(type, title, payload, meta) {
  const prev = AEG.ledger.length ? AEG.ledger[0].hash : 'GENESIS-AEGIS';
  const seq = (AEG.ledger.length ? AEG.ledger[0].seq : 0) + 1;
  const ts = aegisNowIso();
  const body = JSON.stringify({ seq, type, title, payload: payload || {}, ts, prev });
  const entry = Object.assign({
    seq, type, title, ts, payload: payload || {}, prev,
    hash: sha256HexSync(body)
  }, meta || {});
  AEG.ledger.unshift(entry);
  if (AEG.ledger.length > 180) AEG.ledger.length = 180;
  AEG.counters.blocks = (AEG.counters.blocks || 0) + 1;
  aegisSave();
  if (typeof sbAegisLedgerInsert === 'function') sbAegisLedgerInsert(entry);
  if (typeof aegisPaintFeed === 'function') aegisPaintFeed();
  return entry;
}

function aegisLedgerVerify() {
  if (!AEG.ledger.length) return { ok: true, checked: 0, broken: [] };
  const chain = AEG.ledger.slice().reverse();
  const broken = [];
  let prev = 'GENESIS-AEGIS';
  chain.forEach(entry => {
    const body = JSON.stringify({ seq: entry.seq, type: entry.type, title: entry.title, payload: entry.payload || {}, ts: entry.ts, prev });
    const expected = sha256HexSync(body);
    if (entry.prev !== prev || entry.hash !== expected) broken.push(entry.seq);
    prev = entry.hash;
  });
  return { ok: broken.length === 0, checked: chain.length, broken };
}

function aegisNotify(level, title, desc, meta) {
  const item = Object.assign({
    id: aegisUid('EV'),
    level: level || 'info',
    title,
    desc: desc || '',
    ts: aegisNowIso()
  }, meta || {});
  AEG.feed.unshift(item);
  if (AEG.feed.length > 70) AEG.feed.length = 70;
  aegisSave();
  if (typeof aegisPaintFeed === 'function') aegisPaintFeed();
  return item;
}

/* --------------------------------------------------------- identity dossier */
async function aegisEnsureIdentity(subject) {
  const t = subject || (typeof aegisSubject === 'function' ? aegisSubject() : null) || S.user;
  if (!t || !t.id) return null;
  if (AEG.identity.hash && AEG.identity.forId === t.id) return AEG.identity;
  const material = [t.id, t.name || '', t.email || '', t.phone || '', t.blood || '', t.allergy || ''].join('|');
  const hash = await aegisSha256('AEGIS-ID-V1::' + material);
  AEG.identity = {
    forId: t.id,
    hash,
    short: hash.slice(0, 12).toUpperCase(),
    verifiedAt: aegisNowIso(),
    qrNonce: Math.random().toString(36).slice(2, 8).toUpperCase()
  };
  if (!AEG.ledger.length) {
    aegisLedgerAppend('IDENTITY_ISSUED', 'Digital tourist ID issued', {
      touristId: t.id, name: t.name, hash, suite: 'SHA-256'
    });
  }
  aegisSave();
  return AEG.identity;
}

/* ------------------------------------------------------------------ subject */
function aegisSubject() {
  if (S.role === 'tourist') {
    const m = (typeof me === 'function') ? me() : null;
    if (m) return m;
  }
  if (S.trackedTouristId) {
    const f = AEG.fleet.find(x => x.id === S.trackedTouristId);
    if (f) return f;
    const local = S.tourists.find(x => x.id === S.trackedTouristId);
    if (local) return local;
  }
  if (S.role === 'authority' && AEG.fleet.length) return AEG.fleet[0];
  return (typeof me === 'function' && me()) || S.user || { id: 'GUEST', name: 'Guest Traveler', lat: DC.lat, lng: DC.lng };
}

function aegisPoint(subject) {
  const t = subject || aegisSubject();
  const lat = t && t.lat != null ? Number(t.lat) : (S.loc ? Number(S.loc.lat) : DC.lat);
  const lng = t && t.lng != null ? Number(t.lng) : (S.loc ? Number(S.loc.lng) : DC.lng);
  const accuracy = Number((t && t.accuracy) || (S.loc && S.loc.accuracy) || (t && t.locationSource === 'gps' ? 18 : 24));
  return { lat, lng, accuracy };
}

function aegisZoneAt(lat, lng) {
  let inside = null, best = Infinity, nearest = null, nearestD = Infinity;
  (S.zones || []).forEach(z => {
    const d = haversine({ lat, lng }, { lat: Number(z.lat), lng: Number(z.lng) });
    const r = radiusOf(z);
    if (d <= r && d < best) { inside = z; best = d; }
    if (d - r < nearestD) { nearestD = d - r; nearest = z; }
  });
  if (inside) return { name: inside.name, type: inside.type, risk: inside.risk, dist: Math.round(best), radius: radiusOf(inside), inside: true };
  if (nearest) return { name: 'Outside monitored zones', type: 'Outside', risk: 'Unknown', dist: Math.round(Math.max(0, nearestD)), nearest: nearest.name, inside: false };
  return { name: 'Outside monitored zones', type: 'Outside', risk: 'Unknown', dist: null, inside: false };
}

/* ---------------------------------------------------------------- crowd sim */
function aegisCrowdDensity(date) {
  const now = date || new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  const morning = Math.exp(-Math.pow(h - 11.2, 2) / 7.2);
  const evening = Math.exp(-Math.pow(h - 18.4, 2) / 8);
  const night = h >= 23 || h < 5 ? -0.16 : 0;
  return aegisClamp(0.16 + 0.62 * morning + 0.58 * evening + night + 0.05 * Math.sin(h / 1.7), 0.04, 1);
}

/* -------------------------------------------------- community alert seeding */
function aegisSeedAlerts() {
  if (AEG.alerts.length) return AEG.alerts;
  const base = [
    { title: 'Taxi overcharge hotspot', desc: 'Drivers quoting 3× metered fare for airport runs. Use prepaid counter only.', type: 'scam', lat: 18.9220, lng: 72.8347, upvotes: 128 },
    { title: 'Unlit alley behind market', desc: 'Streetlights out for 200 m. Avoid after 21:00; use the main causeway.', type: 'hazard', lat: 18.9388, lng: 72.8354, upvotes: 74 },
    { title: 'Police kiosk / safe haven', desc: 'Verified tourist police kiosk. 24/7, English speaking, water available.', type: 'haven', lat: 18.9266, lng: 72.8317, upvotes: 201 },
    { title: 'Fake ticket touts at gate', desc: 'Unaccompanied "guides" selling invalid cave passes. Buy only at the official counter.', type: 'scam', lat: 20.5519, lng: 75.7033, upvotes: 59 },
    { title: 'Slippery monsoon steps', desc: 'Loose gravel on the descent path near the dam overflow area.', type: 'hazard', lat: 19.5398, lng: 73.7753, upvotes: 41 },
    { title: 'Verified safe cafe corridor', desc: 'CCTV-covered corridor with 4 verified cafes and a first-aid point.', type: 'haven', lat: 19.0760, lng: 72.8777, upvotes: 163 },
    { title: 'Crowd surge risk at sunset', desc: 'Heavy crowding on the promenade between 18:30–19:30. Keep valuables zipped.', type: 'crowd', lat: 18.9433, lng: 72.8235, upvotes: 88 }
  ];
  AEG.alerts = base.map((a, i) => Object.assign({
    id: 'CA-' + aegisPad(i + 1, 3),
    verified: a.type === 'haven' || i % 3 === 0,
    ts: new Date(Date.now() - (i + 1) * 3600 * 1000).toISOString(),
    by: i % 2 ? 'Community' : 'Verified partner'
  }, a));
  aegisSave();
  return AEG.alerts;
}

function aegisAlertsNear(lat, lng, radius = 1500) {
  return AEG.alerts
    .map(a => Object.assign({}, a, { distance: Math.round(haversine({ lat, lng }, { lat: a.lat, lng: a.lng })) }))
    .filter(a => a.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
}

function aegisAddCommunityAlert(data) {
  const alert = {
    id: aegisUid('CA'),
    title: cleanText(data.title || 'Community report', 70),
    desc: cleanText(data.desc || '', 220),
    type: data.type || 'scam',
    lat: Number(data.lat != null ? data.lat : aegisPoint().lat),
    lng: Number(data.lng != null ? data.lng : aegisPoint().lng),
    upvotes: 1,
    verified: false,
    by: (S.user && S.user.name) || 'Community',
    ts: aegisNowIso()
  };
  AEG.alerts.unshift(alert);
  aegisSave();
  aegisNotify('med', 'Community alert submitted', alert.title + ' · under review');
  if (typeof sbAegisAlertInsert === 'function') sbAegisAlertInsert(alert);
  if (typeof aegisPaintCopilot === 'function') aegisPaintCopilot();
  return alert;
}

function aegisUpvoteAlert(id) {
  const a = AEG.alerts.find(x => x.id === id);
  if (!a) return;
  a.upvotes = (a.upvotes || 0) + 1;
  aegisSave();
  if (typeof aegisPaintCopilot === 'function') aegisPaintCopilot();
}

/* ------------------------------------------------------- contextual risk AI */
function aegisRiskContext(subject) {
  const t = subject || aegisSubject();
  const p = aegisPoint(t);
  const zone = aegisZoneAt(p.lat, p.lng);
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const crowd = aegisCrowdDensity(now);
  const near = aegisAlertsNear(p.lat, p.lng, 1800);
  const incidents = (S.incidents || []).filter(i => t && i.touristId === t.id && i.status !== 'Resolved');
  const factors = [];
  let penalty = 0;

  // 1. Time of day
  let nightPenalty = 0;
  if (hour >= 23 || hour < 5) nightPenalty = 18;
  else if (hour >= 20 || hour < 6) nightPenalty = 11;
  else if (hour >= 18) nightPenalty = 5;
  penalty += nightPenalty;
  factors.push({ label: 'Time of day', value: nightPenalty ? 'Night operations' : 'Daylight', impact: nightPenalty, weight: 18 });

  // 2. Crowd density — sparse crowds reduce guardianship, extreme crowds raise pickpocket risk
  const crowdRisk = Math.round((1 - crowd) * 12 + (crowd > 0.86 ? 4 : 0));
  penalty += crowdRisk;
  factors.push({ label: 'Crowd density', value: Math.round(crowd * 100) + '% footfall', impact: crowdRisk, weight: 14 });

  // 3. Geofence classification
  let zoneImpact = 6;
  if (zone.type === 'Restricted') zoneImpact = 42;
  else if (zone.type === 'Caution') zoneImpact = 20;
  else if (zone.type === 'Safe') zoneImpact = 0;
  penalty += zoneImpact;
  factors.push({ label: 'Geofence class', value: zone.type === 'Outside' ? 'Unmonitored' : zone.type, impact: zoneImpact, weight: 42 });

  // 4. Community intelligence within 1.8 km
  const scamCount = near.filter(a => a.type === 'scam').length;
  const hazardCount = near.filter(a => a.type === 'hazard' || a.type === 'crowd').length;
  const havens = near.filter(a => a.type === 'haven');
  const alertImpact = Math.min(24, scamCount * 6 + hazardCount * 5);
  penalty += alertImpact;
  factors.push({ label: 'Community alerts', value: near.length + ' nearby · ' + scamCount + ' scam', impact: alertImpact, weight: 24 });

  // 5. Verified safe haven relief
  const havenImpact = havens.length ? -8 : 0;
  penalty += havenImpact;
  factors.push({ label: 'Safe haven', value: havens.length ? havens[0].distance + ' m away' : 'None mapped', impact: havenImpact, weight: 8 });

  // 6. Open incidents
  const incImpact = Math.min(26, incidents.length * 12 + incidents.filter(i => i.severity === 'HIGH').length * 8);
  penalty += incImpact;
  factors.push({ label: 'Open incidents', value: incidents.length ? incidents.length + ' active' : 'Clear', impact: incImpact, weight: 26 });

  // 7. Isolation-Forest trajectory anomaly
  const isoScore = aegisClamp(Number(AEG.sim.ifScore) || 0, 0, 1);
  const isoImpact = Math.round(isoScore * 30);
  penalty += isoImpact;
  factors.push({ label: 'Trajectory anomaly', value: isoScore.toFixed(2) + ' IF score', impact: isoImpact, weight: 30 });

  // 8. Device resilience
  const bat = AEG.battery.level;
  const batImpact = bat != null && bat <= 20 ? 9 : 0;
  penalty += batImpact;
  factors.push({ label: 'Device resilience', value: bat != null ? bat + '% battery' : 'Unknown', impact: batImpact, weight: 9 });

  const score = Math.round(aegisClamp(100 - penalty, 3, 100));
  const band = score >= 78 ? 'SECURE' : score >= 58 ? 'GUARDED' : score >= 36 ? 'ELEVATED' : 'CRITICAL';
  const tone = score >= 78 ? 'safe' : score >= 58 ? 'cyan' : score >= 36 ? 'warning' : 'danger-b';
  return {
    score, band, tone, factors, zone, crowd, hour, near, incidents,
    iso: isoScore, point: p, safeHaven: havens[0] || null,
    recommendation: aegisRecommendation(score, zone, havens, isoScore)
  };
}

function aegisRecommendation(score, zone, havens, iso) {
  if (zone.type === 'Restricted') return { title: 'Leave the restricted perimeter', text: 'You are inside ' + zone.name + '. Move to the nearest safe corridor now, or trigger SOS if you cannot leave safely.', tone: 'danger' };
  if (iso > 0.66) return { title: 'Route deviation detected', text: 'Your trajectory no longer matches the expected safe route. Confirm you are safe, or rejoin the planned corridor.', tone: 'warning' };
  if (score < 40) return { title: 'Elevated risk — seek a safe haven', text: havens.length ? 'Move toward ' + havens[0].title + ' (' + havens[0].distance + ' m).' : 'Stay in well-lit public areas and keep your Safety Pulse armed.', tone: 'danger' };
  if (score < 60) return { title: 'Heightened awareness advised', text: 'Community reports are active in this sector. Keep valuables zipped and share your live route.', tone: 'warning' };
  if (zone.type === 'Caution') return { title: 'Caution zone — proceed carefully', text: 'You are inside ' + zone.name + '. Stay on marked paths and avoid isolated side routes.', tone: 'warning' };
  return { title: 'Corridor secure', text: 'No active anomalies on your route. Telemetry and evidence ledger are sealing normally.', tone: 'safe' };
}

/* --------------------------------------------------- isolation forest model */
class AegisIsolationForest {
  constructor(sampleSize = 64, treeCount = 28) {
    this.psi = sampleSize;
    this.treeCount = treeCount;
    this.limit = Math.ceil(Math.log2(Math.max(2, sampleSize)));
    this.trees = [];
    this.trained = false;
  }
  _c(n) {
    if (n <= 1) return 0;
    return 2 * (Math.log(n - 1) + 0.5772156649) - 2 * (n - 1) / n;
  }
  _build(rows, depth) {
    if (depth >= this.limit || rows.length <= 1) return { leaf: rows.length };
    const dims = rows[0].length;
    let feature = Math.floor(Math.random() * dims);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][feature];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === max) {
      // try another feature once, otherwise make a leaf
      feature = (feature + 1) % dims;
      min = Infinity; max = -Infinity;
      for (let i = 0; i < rows.length; i++) {
        const v = rows[i][feature];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (min === max) return { leaf: rows.length };
    }
    const split = min + Math.random() * (max - min);
    const left = [], right = [];
    rows.forEach(r => (r[feature] < split ? left : right).push(r));
    if (!left.length || !right.length) return { leaf: rows.length };
    return { f: feature, p: split, l: this._build(left, depth + 1), r: this._build(right, depth + 1) };
  }
  _path(x, node, depth) {
    if (node.leaf !== undefined) return depth + this._c(node.leaf);
    return this._path(x, x[node.f] < node.p ? node.l : node.r, depth + 1);
  }
  fit(rows) {
    if (!Array.isArray(rows) || rows.length < 8) return this;
    this.trees = [];
    for (let t = 0; t < this.treeCount; t++) {
      const sample = [];
      for (let i = 0; i < Math.min(this.psi, rows.length); i++) {
        sample.push(rows[Math.floor(Math.random() * rows.length)]);
      }
      this.trees.push(this._build(sample, 0));
    }
    this.trained = true;
    return this;
  }
  score(x) {
    if (!this.trained || !this.trees.length) return 0.5;
    const avg = this.trees.reduce((sum, tree) => sum + this._path(x, tree, 0), 0) / this.trees.length;
    return Math.pow(2, -avg / this._c(this.psi));
  }
}

/** Normalise an isolation score (≈0.5 for inliers) into 0..1 anomaly intensity. */
function aegisAnomalyIntensity(raw) {
  return aegisClamp((Number(raw) - 0.48) / 0.26, 0, 1);
}

/* ----------------------------------------------------------- telemetry trail */
function aegisIngestTelemetry(subject, extra) {
  const t = subject || aegisSubject();
  const p = aegisPoint(t);
  const last = AEG.trail[AEG.trail.length - 1];
  const dt = last ? (Date.now() - last.t) / 1000 : 0;
  const dist = last ? haversine(last, p) : 0;
  const speed = dt > 0 ? (dist / dt) * 3.6 : 0;
  const point = {
    t: Date.now(),
    lat: +p.lat.toFixed(6),
    lng: +p.lng.toFixed(6),
    acc: Math.round(p.accuracy || 0),
    speed: +speed.toFixed(2),
    zone: (aegisZoneAt(p.lat, p.lng).name || ''),
    risk: Math.round(aegisRiskContext(t).score),
    status: (t && t.status) || 'Safe'
  };
  if (extra) Object.assign(point, extra);
  if (!last || dist > 0.4 || Date.now() - last.t > 4000) {
    AEG.trail.push(point);
    if (AEG.trail.length > 720) AEG.trail.shift();
    if (AEG.trail.length % 6 === 0) aegisSave();
  }
  return point;
}

/* ------------------------------------------------------- battery & network */
function aegisInitBattery() {
  const finish = (level, charging) => {
    AEG.battery.level = Math.round(level);
    AEG.battery.charging = !!charging;
    AEG.battery.ts = aegisNowIso();
    AEG.battery.simulated = false;
    if (!charging && level <= 15 && !AEG.battery.warnedLow) {
      AEG.battery.warnedLow = true;
      aegisNotify('med', 'Low battery protocol armed', 'Stealth beacon cached at ' + Math.round(level) + '%. Coordinates written to offline store.');
      aegisToggleStealth(true, true);
      aegisOfflineCache(aegisTelemetrySnapshot('LOW_BATTERY'));
      if (typeof toast === 'function') toast('Low battery — stealth SOS beacon cached offline', 'warning');
    }
    if (typeof aegisPaintChrome === 'function') aegisPaintChrome();
  };
  try {
    if (navigator.getBattery) {
      navigator.getBattery().then(b => {
        finish(b.level * 100, b.charging);
        b.addEventListener('levelchange', () => finish(b.level * 100, b.charging));
        b.addEventListener('chargingchange', () => finish(b.level * 100, b.charging));
      }).catch(() => finish(82, false));
    } else {
      finish(AEG.battery.level != null ? AEG.battery.level : 82, false);
    }
  } catch (e) { finish(82, false); }
}

function aegisNetworkType() {
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c && c.effectiveType) return c.effectiveType.toUpperCase();
  } catch (e) {}
  return (typeof S !== 'undefined' && S.net) || 'ONLINE';
}

function aegisTelemetrySnapshot(kind) {
  const t = aegisSubject();
  const p = aegisPoint(t);
  return {
    kind: kind || 'PING',
    touristId: (t && t.id) || 'UNREGISTERED',
    name: (t && t.name) || 'Guest',
    lat: +p.lat.toFixed(6),
    lng: +p.lng.toFixed(6),
    accuracy: Math.round(p.accuracy || 0),
    battery: AEG.battery.level,
    charging: AEG.battery.charging,
    network: aegisNetworkType(),
    zone: aegisZoneAt(p.lat, p.lng).name,
    ts: aegisNowIso(),
    hash: (AEG.identity.hash || '').slice(0, 16)
  };
}

/* ------------------------------------------------------------ safety pulse */
function aegisPulseStart(seconds) {
  const secs = Math.max(20, Number(seconds) || 900);
  AEG.pulse = {
    active: true,
    interval: secs * 1000,
    startedAt: aegisNowIso(),
    deadline: Date.now() + secs * 1000,
    lastCheckin: null,
    escalated: false,
    escalations: AEG.pulse.escalations || 0
  };
  aegisSave();
  aegisLedgerAppend('PULSE_ARMED', 'Dead-man safety pulse armed', {
    intervalSeconds: secs, deadline: new Date(AEG.pulse.deadline).toISOString(), touristId: aegisSubject().id
  });
  aegisNotify('ok', 'Safety Pulse armed', 'Auto-escalation to Tier-1 in ' + Math.round(secs / 60) + ' min unless you check in.');
  if (typeof sbAegisCheckinInsert === 'function') sbAegisCheckinInsert({ tourist_id: aegisSubject().id, status: 'armed', deadline: new Date(AEG.pulse.deadline).toISOString() });
  if (typeof aegisPaintPulse === 'function') aegisPaintPulse();
  return AEG.pulse;
}

function aegisPulseRemaining() {
  if (!AEG.pulse.active || !AEG.pulse.deadline) return 0;
  return Math.max(0, AEG.pulse.deadline - Date.now());
}

function aegisPulseSafe(source) {
  if (!AEG.pulse.active) {
    if (typeof toast === 'function') toast('Safety Pulse is not armed', 'info');
    return false;
  }
  AEG.pulse.lastCheckin = aegisNowIso();
  AEG.pulse.deadline = Date.now() + AEG.pulse.interval;
  AEG.pulse.escalated = false;
  AEG.counters.checkins = (AEG.counters.checkins || 0) + 1;
  aegisSave();
  const subject = aegisSubject();
  aegisLedgerAppend('CHECKIN_SAFE', 'Traveler confirmed safe', {
    touristId: subject.id, source: source || 'manual', nextDeadline: new Date(AEG.pulse.deadline).toISOString()
  });
  aegisNotify('ok', 'Check-in received', (subject.name || 'Traveler') + ' confirmed safe · timer reset');
  if (typeof sbAegisCheckinInsert === 'function') sbAegisCheckinInsert({ tourist_id: subject.id, status: 'safe', checked_in_at: aegisNowIso(), deadline: new Date(AEG.pulse.deadline).toISOString() });
  aegisHaptic(35);
  if (typeof aegisPaintPulse === 'function') aegisPaintPulse();
  if (typeof toast === 'function') toast('Checked in — timer reset', 'success');
  return true;
}

function aegisPulseStop() {
  if (!AEG.pulse.active) return;
  AEG.pulse.active = false;
  AEG.pulse.deadline = null;
  aegisSave();
  aegisNotify('info', 'Safety Pulse disarmed', 'Automatic escalation disabled by traveler.');
  if (typeof aegisPaintPulse === 'function') aegisPaintPulse();
  if (typeof toast === 'function') toast('Safety Pulse disarmed', 'info');
}

function aegisEscalatePulse(reason) {
  if (!AEG.pulse.active && reason !== 'restored-expired') return;
  if (AEG.pulse.escalated && reason !== 'restored-expired') return;
  AEG.pulse.escalated = true;
  AEG.pulse.escalations = (AEG.pulse.escalations || 0) + 1;
  AEG.pulse.active = false;
  const snap = aegisTelemetrySnapshot('DEADMAN_ESCALATION');
  aegisSave();
  aegisLedgerAppend('PULSE_ESCALATED', 'Dead-man switch expired — Tier-1 escalation', snap);
  aegisNotify('high', 'DEAD-MAN SWITCH EXPIRED', 'No check-in received. Broadcasting Tier-1 SOS with last known coordinates.');
  if (typeof aegisTriggerSOS === 'function') {
    aegisTriggerSOS('deadman', snap);
  } else {
    aegisOfflineCache(snap);
    if (typeof toast === 'function') toast('SOS escalation queued offline', 'danger');
  }
  if (typeof aegisPaintPulse === 'function') aegisPaintPulse();
}

/* ---------------------------------------------------------- haptics & audio */
function aegisHaptic(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms || 30); } catch (e) {}
}

function aegisAudioCtx() {
  if (!AEG_AUDIO_CTX) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try { AEG_AUDIO_CTX = new Ctx(); } catch (e) { return null; }
  }
  if (AEG_AUDIO_CTX.state === 'suspended') { try { AEG_AUDIO_CTX.resume(); } catch (e) {} }
  return AEG_AUDIO_CTX;
}

function aegisBlip(freq, dur, type, gain) {
  const ctx = aegisAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.value = freq || 880;
  g.gain.value = 0.0001;
  osc.connect(g); g.connect(ctx.destination);
  const now = ctx.currentTime;
  g.gain.exponentialRampToValueAtTime(gain || 0.08, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + (dur || 0.18));
  osc.start(now);
  osc.stop(now + (dur || 0.18) + 0.02);
}

function aegisSirenStart() {
  const ctx = aegisAudioCtx();
  if (!ctx || AEG_SIREN) return;
  try {
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 640;
    lfo.type = 'sine';
    lfo.frequency.value = 1.6;
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    gain.gain.value = 0.035;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); lfo.start();
    AEG_SIREN = { osc, lfo, gain };
  } catch (e) { AEG_SIREN = null; }
}

function aegisSirenStop() {
  if (!AEG_SIREN) return;
  try {
    AEG_SIREN.osc.stop();
    AEG_SIREN.lfo.stop();
    AEG_SIREN.osc.disconnect();
    AEG_SIREN.gain.disconnect();
  } catch (e) {}
  AEG_SIREN = null;
}

/* ---------------------------------------------------------- offline caching */
function aegisOfflineOpen() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open('aegis_offline', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('beacons')) db.createObjectStore('beacons', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

function aegisOfflineFallback(point) {
  try {
    const key = 'sts_offline_beacons';
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    list.unshift(Object.assign({ cachedAt: aegisNowIso() }, point));
    localStorage.setItem(key, JSON.stringify(list.slice(0, 240)));
  } catch (e) {}
}

async function aegisOfflineCache(point) {
  const payload = Object.assign({ cachedAt: aegisNowIso() }, point || aegisTelemetrySnapshot('CACHED_PING'));
  aegisOfflineFallback(payload);
  try {
    const db = await aegisOfflineOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('beacons', 'readwrite');
      tx.objectStore('beacons').add(payload);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return { stored: 'indexeddb', count: await aegisOfflineCount() };
  } catch (err) {
    return { stored: 'localStorage', count: await aegisOfflineCount() };
  }
}

async function aegisOfflineRead(limit = 60) {
  try {
    const db = await aegisOfflineOpen();
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('beacons', 'readonly');
      const req = tx.objectStore('beacons').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows.slice(-limit).reverse();
  } catch (err) {
    try { return JSON.parse(localStorage.getItem('sts_offline_beacons') || '[]').slice(0, limit); } catch (e) { return []; }
  }
}

async function aegisOfflineCount() {
  const rows = await aegisOfflineRead(240);
  return rows.length;
}

/* --------------------------------------------------------- emergency payload */
function aegisSmsPayload(kind) {
  const snap = aegisTelemetrySnapshot(kind || 'SOS');
  const shortHash = (AEG.identity.hash || '').slice(0, 10).toUpperCase() || 'UNHASHED';
  return [
    'AEGIS', (kind || 'SOS').toUpperCase(),
    'ID:' + snap.touristId,
    snap.lat.toFixed(5) + ',' + snap.lng.toFixed(5),
    '±' + snap.accuracy + 'm',
    'BAT:' + (snap.battery != null ? snap.battery : '?') + '%',
    'NET:' + snap.network,
    'H:' + shortHash,
    snap.ts.slice(11, 19) + 'Z'
  ].join(' ');
}

function aegisSmsLink() {
  return 'sms:112?&body=' + encodeURIComponent(aegisSmsPayload('SOS'));
}

function aegisWhatsAppLink() {
  return 'https://wa.me/?text=' + encodeURIComponent(aegisSmsPayload('SOS') + ' — please send help.');
}

async function aegisCopyPayload() {
  const text = aegisSmsPayload('SOS');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      if (typeof toast === 'function') toast('Emergency payload copied — paste into SMS/WhatsApp', 'success');
      return;
    }
    throw new Error('clipboard unavailable');
  } catch (err) {
    if (typeof openModal === 'function') {
      openModal('<h2>Offline SOS payload</h2><p class="muted" style="font-size:12px">Copy this compressed beacon into any SMS or WhatsApp message. It contains your coordinates, battery, network state and cryptographic ID prefix.</p><div class="cert-preview"><div class="hash" style="font-size:11px;color:var(--ink)">' + esc(text) + '</div></div><div class="actions" style="justify-content:flex-end;margin-top:14px"><button class="btn primary" onclick="closeModal()">Done</button></div>');
    }
  }
}

async function aegisSharePayload() {
  const text = aegisSmsPayload('SOS');
  if (navigator.share) {
    try { await navigator.share({ title: 'AegisTravel SOS', text }); return; } catch (e) { /* cancelled */ }
  }
  aegisCopyPayload();
}

/* ------------------------------------------------------- stealth & disguise */
function aegisToggleStealth(force, silent) {
  const on = force != null ? !!force : !AEG.stealth.on;
  AEG.stealth.on = on;
  document.body.classList.toggle('stealth', on);
  aegisSave();
  if (typeof aegisPaintChrome === 'function') aegisPaintChrome();
  if (!silent && typeof toast === 'function') {
    toast(on ? 'Stealth mode on — heavy telemetry animation stripped' : 'Stealth mode off — full tactical HUD restored', on ? 'warning' : 'info');
  }
  if (!silent) aegisBlip(on ? 420 : 760, 0.1);
}

let AEG_DECOY_HOLD = null;

function aegisShowDecoy(kind) {
  const el = $('decoyScreen');
  if (!el) return;
  el.classList.add('on');
  aegisDecoyReset();
  // Covert exit: tap the display 3×, then hold = for 650 ms.
  const display = $('decoyDisplay');
  if (display) display.onclick = aegisDecoyTapDisplay;
  const eqBtn = document.querySelector('.decoy-keys button.eq');
  if (eqBtn) {
    const arm = () => { if (AEG_DECOY_TAPS >= 3) { AEG_DECOY_HOLD = setTimeout(() => { AEG_DECOY_HOLD = null; aegisHideDecoy(); }, 650); } };
    const clear = () => { if (AEG_DECOY_HOLD) { clearTimeout(AEG_DECOY_HOLD); AEG_DECOY_HOLD = null; } };
    eqBtn.onpointerdown = arm;
    eqBtn.onpointerup = clear;
    eqBtn.onpointerleave = clear;
    eqBtn.onmousedown = arm;
    eqBtn.onmouseup = clear;
    eqBtn.ontouchstart = arm;
    eqBtn.ontouchend = clear;
  }
  const tick = () => {
    const c = $('decoyClock');
    if (c) c.textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  clearInterval(window.__aegisDecoyClock);
  window.__aegisDecoyClock = setInterval(tick, 20000);
  aegisNotify('info', 'Disguise screen engaged', 'Interface masked. Emergency beacon stays armed.');
}

function aegisHideDecoy() {
  const el = $('decoyScreen');
  if (el) el.classList.remove('on');
  if (AEG_DECOY_HOLD) { clearTimeout(AEG_DECOY_HOLD); AEG_DECOY_HOLD = null; }
  clearInterval(window.__aegisDecoyClock);
  AEG_DECOY_TAPS = 0;
  if (typeof toast === 'function') toast('Disguise released', 'success');
}

function aegisDecoyReset() {
  AEG_DECOY_EXPR = '';
  AEG_DECOY_TAPS = 0;
  const d = $('decoyDisplay');
  if (d) d.textContent = '0';
}

let AEG_DECOY_EXPR = '';

function aegisCalcEval(input) {
  const s = String(input).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, '');
  let i = 0;
  const peek = () => s[i];
  function number() {
    const start = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    if (start === i) throw new Error('expected number');
    const v = parseFloat(s.slice(start, i));
    if (!isFinite(v)) throw new Error('invalid number');
    return v;
  }
  function factor() {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error('unbalanced'); i++; return v; }
    return number();
  }
  function term() {
    let v = factor();
    while (i < s.length && '*/%'.includes(s[i])) {
      const op = s[i++];
      const r = factor();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (i < s.length && '+-'.includes(s[i])) {
      const op = s[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const out = expr();
  if (i !== s.length) throw new Error('unexpected token');
  if (!isFinite(out)) throw new Error('not finite');
  return out;
}

function aegisDecoyPress(key) {
  const display = $('decoyDisplay');
  if (!display) return;
  aegisHaptic(8);
  if (key === 'C') { AEG_DECOY_EXPR = ''; display.textContent = '0'; return; }
  if (key === '=') {
    try {
      const val = aegisCalcEval(AEG_DECOY_EXPR || '0');
      const rounded = Math.round(val * 1e10) / 1e10;
      AEG_DECOY_EXPR = String(rounded);
      display.textContent = AEG_DECOY_EXPR;
    } catch (e) {
      display.textContent = 'Error';
      AEG_DECOY_EXPR = '';
    }
    return;
  }
  if (key === '±') {
    AEG_DECOY_EXPR = AEG_DECOY_EXPR.startsWith('-') ? AEG_DECOY_EXPR.slice(1) : '-' + AEG_DECOY_EXPR;
    display.textContent = AEG_DECOY_EXPR || '0';
    return;
  }
  if (AEG_DECOY_EXPR.length > 24) return;
  AEG_DECOY_EXPR += key;
  display.textContent = AEG_DECOY_EXPR;
}

function aegisDecoyTapDisplay() {
  const now = Date.now();
  if (now - AEG_DECOY_TAP_TS > 1600) AEG_DECOY_TAPS = 0;
  AEG_DECOY_TAP_TS = now;
  AEG_DECOY_TAPS++;
  aegisHaptic(12);
  if (AEG_DECOY_TAPS >= 3) {
    const d = $('decoyDisplay');
    if (d) d.textContent = '•••';
  }
}

/* ------------------------------------------------------------------- boot */
function aegisEnableShake() {
  if (!window.DeviceMotionEvent) {
    if (typeof toast === 'function') toast('Motion sensor unavailable on this device', 'warning');
    return;
  }
  const attach = () => {
    let last = 0;
    window.addEventListener('devicemotion', ev => {
      if (!AEG.pulse.active) return;
      const a = ev.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
      if (mag > 24 && Date.now() - last > 2500) {
        last = Date.now();
        aegisPulseSafe('shake');
      }
    });
    if (typeof toast === 'function') toast('Shake-to-check-in armed', 'success');
  };
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission().then(res => {
      if (res === 'granted') attach();
      else if (typeof toast === 'function') toast('Motion permission denied', 'warning');
    }).catch(() => {});
  } else attach();
}

function aegisHeartbeat() {
  // Dead-man switch evaluation
  if (AEG.pulse.active && AEG.pulse.deadline && Date.now() >= AEG.pulse.deadline && !AEG.pulse.escalated) {
    aegisEscalatePulse('deadline');
  }
  // Simulated battery drift (only when no Battery API is available)
  if (AEG.battery.simulated) {
    const now = Date.now();
    if (!AEG.battery.ts) AEG.battery.ts = new Date(now).toISOString();
    if (now % 60000 < 1100) {
      AEG.battery.level = Math.max(6, (AEG.battery.level != null ? AEG.battery.level : 82) - 1);
      if (AEG.battery.level <= 15 && !AEG.battery.warnedLow) {
        AEG.battery.warnedLow = true;
        aegisToggleStealth(true, true);
        aegisNotify('med', 'Low battery protocol armed', 'Stealth beacon cached at ' + AEG.battery.level + '%.');
      }
    }
  }
  if (typeof aegisSimTick === 'function') aegisSimTick();
  if (typeof aegisPaintLive === 'function') aegisPaintLive();
}

function aegisKeyboard(e) {
  const tag = (e.target && e.target.tagName) || '';
  const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
  if (typing) return;
  if (e.shiftKey && (e.key === 'S' || e.key === 's')) {
    e.preventDefault();
    if (typeof aegisPanic === 'function') aegisPanic();
    return;
  }
  if ((e.key === 's' || e.key === 'S') && !e.shiftKey && AEG.pulse.active) {
    e.preventDefault();
    aegisPulseSafe('keyboard');
  }
  if (e.key === 'Escape') {
    const decoy = $('decoyScreen');
    if (decoy && !decoy.classList.contains('on') && $('modalBack') && !$('modalBack').classList.contains('hidden')) closeModal();
  }
}

function aegisBoot() {
  if (AEG.booted) {
    if (typeof aegisPaintChrome === 'function') aegisPaintChrome();
    return;
  }
  AEG.booted = true;
  aegisSeedAlerts();
  if (typeof aegisSeedFleet === 'function') aegisSeedFleet(false);
  aegisInitBattery();
  if (AEG.stealth.on) document.body.classList.add('stealth');
  // Seed an opening ledger block so the evidence chain is demonstrable immediately
  if (!AEG.ledger.length) {
    aegisLedgerAppend('SESSION_OPEN', 'Command session opened', {
      user: (S.user && S.user.name) || 'Guest', role: S.role,
      suite: 'SHA-256', client: navigator.userAgent.slice(0, 60)
    });
    aegisNotify('ok', 'Aegis session initialised', 'Telemetry fusion, ledger sealing and pulse watchdog online.');
  }
  if (!AEG_CLOCK_TICK) AEG_CLOCK_TICK = setInterval(aegisHeartbeat, 1000);
  document.removeEventListener('keydown', aegisKeyboard);
  document.addEventListener('keydown', aegisKeyboard);
  if (typeof aegisEnsureIdentity === 'function') aegisEnsureIdentity();
  if (typeof aegisPaintChrome === 'function') aegisPaintChrome();
}

/* Load persisted state immediately so the first render has real data. */
aegisLoad();
