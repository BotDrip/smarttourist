# Smart Tourist Safety Monitoring and Incident Response System

An enterprise-grade, integrated tourist safety monitoring and rapid incident response platform featuring AI safety assessment, precision geofencing, emergency SOS beacons, verifiable Digital ID, emergency medical records, and live Supabase PostgreSQL cloud sync with offline replay queue.

---

## 🚀 Key Features & Production Security

1. **Role-Based Row Level Security (RLS):**
   - Hardened PostgreSQL Row Level Security in `supabase/schema.sql`.
   - Function `public.is_authority()` verifies server-side JWT claims (`role = 'authority'`).
   - Tourists can only read/update their own profile data (`auth.uid() = auth_user_id`).
   - Incident records are private to tourists; only verified authorities can update, assign response units, or resolve incidents.
   - Danger and caution zones are public read-only for tourists and restricted to authorities for write operations.

2. **Web Crypto API (SHA-256) Credential Protection:**
   - Zero plaintext passwords in LocalStorage.
   - All credentials hashed client-side with unique salts using modern `crypto.subtle.digest('SHA-256')`.
   - Automatic legacy scrubbing cleanses any legacy plaintext keys upon initialization.

3. **Multi-Factor Security Challenge for Password Reset:**
   - Prevents unverified password resets.
   - Requires verification of **Email + Registered Next-of-Kin Phone Number + Registered Blood Group** before permitting credentials update.

4. **Telemetry & GPS Confidence Architecture:**
   - Real-time segregation of **Live Satellite GPS** (`● SATELLITE GPS (±Xm)`) versus **Demo Benchmark Coordinates** (`⚪ DEMO PROFILE COORDINATE`).
   - Authority command dashboard includes dedicated telemetry filters (`All Records`, `🟢 Live GPS Only`, `⚪ Demo Profiles`).
   - Stale GPS detection flags locations older than 3 minutes (`▲ STALE GPS`).
   - AI risk assessment factors in GPS confidence (`HIGH`, `MEDIUM`, `LOW`).

5. **AI Safety Risk Assessment:**
   - Multi-factor anomaly evaluation (Zone risk, hazard proximity, incident history, GPS confidence).
   - Generates actionable safety recommendations and dynamic threat levels (SAFE, CAUTION, DANGER).

6. **Precision Geofencing & Danger Zones:**
   - Interactive map-click boundary placement down to 10m radius.
   - Real-time perimeter breach detection (Safe, Caution, Restricted zones).

7. **Emergency SOS & Rapid Response:**
   - 1-Tap SOS beacon transmitting live GPS coordinates, audit reference token, and tourist profile to Authority command.
   - Structured response workflow: *Acknowledge → Assign Response Unit → Resolve*.
   - Voice SOS emergency command trigger.

8. **Digital Identity & Medical Records:**
   - Tamper-evident Digital ID with cryptographic SHA-256 hash validation.
   - Quick-response QR Code generator for field verification by law enforcement.
   - Emergency medical data (Blood group, allergies, next-of-kin contacts).

9. **Supabase Cloud Backend & Resilient Offline Replay Queue:**
   - Direct integration with Supabase PostgreSQL cloud database (`tourists`, `incidents`, `safety_zones`).
   - PostgreSQL Realtime WebSocket replication for multi-device live sync.
   - Resilient offline queue (`sts_pending_sync_queue`) captures writes during disconnections and automatically flushes to Supabase upon reconnection (`online` event listener).

---

## 📁 Project Structure

```
Safe-Tourist-VSCode-Project/
├── index.html            # Main application entry point
├── css/
│   └── style.css         # Modern, responsive UI stylesheet
├── js/
│   ├── app.js            # Core application state, Web Crypto auth, map engine, AI rules, workflows
│   └── supabase.js       # Supabase Cloud Client, authority auth, offline replay queue & realtime sync
├── supabase/
│   └── schema.sql        # Hardened PostgreSQL schema, RLS policies, functions & triggers
└── assets/               # Project icons & assets
```

---

## 🛠️ How to Run

1. Open `Safe-Tourist-VSCode-Project` in **VS Code**.
2. Start via **Live Server** (Right click `index.html` → *Open with Live Server*) or any local HTTP server (`http://localhost:5500`).
3. Open in any modern web browser with Geolocation enabled.

---

## ☁️ Supabase Cloud Setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** in your Supabase dashboard and run the queries from `supabase/schema.sql`.
3. The project comes pre-configured with active cloud credentials, or you can configure your own project URL and anon key in `js/supabase.js`.

---

# AegisTravel / SafeTourist Pro — v6.0 Upgrade

A tactical command-center upgrade of the original system. **No existing table mapping,
function or page was removed.** The new layer is additive and runs with zero build steps.

## 🧭 Architecture

```
Safe-Tourist-VSCode-Project/
├── index.html                 # Landing · auth · command shell · SOS/decoy overlays
├── css/style.css              # Tactical design system (glass HUD, radar, holo pass)
├── js/
│   ├── supabase.js            # Existing cloud client + optional Aegis persistence helpers
│   ├── app.js                 # Existing engine (auth, zones, maps, AI rules, SOS) — 3 hooks added
│   ├── aegis-core.js          # State · SHA-256 · ledger · isolation forest · pulse · risk · stealth
│   ├── aegis-sim.js           # 56-person fleet · scenarios · replay · Tier-1 SOS · dispatch/SLA
│   ├── aegis-ui.js            # Split-pane command center · drawers · pages · map layers
│   └── aegis-saas.js          # Plans · checkout · certificates (PDF/JSON) · broadcast
└── supabase/
    ├── schema.sql             # (unchanged) core tables + RLS
    ├── migration_v2.sql       # (unchanged) zones + area_reports
    └── migration_v3.sql       # (new, optional) Aegis ledger/check-ins/telemetry/alerts/billing
```

### How the upgrade hooks into the existing app

`app.js` received exactly three additive hooks:

1. `render()` first asks `aegisRender(page)` for a page; `null` falls through to the original
   `touristPage()` / `authorityPage()`. Every legacy page keeps rendering untouched.
2. `enterApp()` asks `aegisDefaultPage()` for the landing page inside the console (`command`).
3. `enterApp()` calls `aegisBoot()` once to seed the fleet, ledger and watchdog.

Navigation, page titles and the tenant role switcher are layered on top without
changing the legacy `touristNav` / `authorityNav` arrays.

## 🚀 What the new layer does

| Area | Implementation |
|---|---|
| Tactical UI | Dark obsidian/cyan/amber/crimson design system, glass drawers, glowing borders, radar sweeps, micro-interactions, reduced-motion + light mode |
| Command center | Leaflet center stage with collapsible anomaly/pulse drawer and tabbed intelligence drawer (Copilot / Vault / Dispatch / Fleet / Scam radar) |
| Simulation | Normal transit · route deviation · SOS panic · playback scrubber with 1×/2× and ghost trail |
| Anomaly detection | Real Isolation Forest (40 trees, ψ=64) over 6 telemetry features; score blended with physical divergence |
| Safety Pulse | Configurable countdown (1/15/30/60 min), “I’m Safe”, `S` shortcut, shake-to-check-in, auto Tier-1 escalation with battery/network snapshot |
| Digital ID | 3D-tilt holographic pass, rotating single-use QR (9 s), SHA-256 identity hash, blood/allergy badge, offline matrix fallback |
| Evidence ledger | Append-only SHA-256 chain (`prev` committed per block), live verification, JSON export, tamper flags |
| Risk copilot | 0–100 safety score fusing time-of-day, crowd curve, geofence class, community scam/hazard/haven reports, open incidents, IF score, battery |
| Offline SOS | IndexedDB + localStorage beacon cache, compressed SMS/WhatsApp payload, low-battery auto-stealth, calculator disguise with covert exit |
| Enterprise | 56-tourist fleet, risk heatmap, SLA countdowns, unit dispatch, bulk broadcast with audience targeting |
| Monetization | Explorer / Aegis Pro / Enterprise, feature gating, Luhn-validated Stripe-style checkout simulation, billing console |
| Insurance | 1-click verified incident certificate, real single-page PDF (hand-built, no dependency) + JSON, parametric settlement simulation, embassy escalation |

## ☁️ Optional persistence checklist (migration_v3.sql)

**New columns on `tourists`**
- `battery_level` int · `network_status` text · `plan_tier` text default `'free'`
- `last_checkin_at` timestamptz · `pulse_deadline` timestamptz
- `stealth_mode` boolean default false · `group_mesh_id` text

**New tables**
- `aegis_ledger` — append-only evidence blocks (`seq`, `entry_type`, `payload jsonb`, `prev_hash`, `entry_hash`, `occurred_at`)
- `safety_checkins` — dead-man switch audit (`status`, `deadline`, `checked_in_at`, `escalated_incident_id`)
- `telemetry_breadcrumbs` — replay + certificate GPS trail (`latitude`, `longitude`, `risk_score`, `recorded_at`)
- `community_alerts` — scam/hazard/crowd/haven radar (`category`, `verified`, `upvotes`, `status`)
- `subscriptions` — SaaS billing state (`plan`, `billing_cycle`, `price`, `seats`, `renews_at`)
- `broadcasts` — fleet mass notification log

**Security** — RLS is enabled on every new table; tourists read/insert their own rows via
`tourists.auth_user_id = auth.uid()`, authorities use the existing `public.is_authority()`.
`community_alerts` is public-read, authenticated-submit, authority-moderated.
Realtime publication is recreated including the new tables.

All helpers in `supabase.js` are fail-soft: if `migration_v3.sql` has not been run, writes
are queued in the existing offline queue and never break the app or the legacy tables.

## ▶️ Run

Open `index.html` directly or serve the folder (`python3 -m http.server 5500`).
No build step. Guest access: **Explore console as guest** → `Command Center`.
Demo SOS shortcut: `Shift+S`; pulse check-in: `S`.

> Demo environment: simulation data, simulated checkout, and simulated parametric settlement.
