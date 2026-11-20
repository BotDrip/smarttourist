'use strict';
/* ============================================================================
   AEGISTRAVEL SaaS — monetization, parametric insurance & tenant operations
   ----------------------------------------------------------------------------
   • Feature gating across Explorer / Aegis Pro / Enterprise
   • Stripe-style checkout simulation (Luhn validation, tokenisation steps)
   • Billing console with subscription state and invoice ledger
   • Parametric incident certificates: real JSON + hand-built PDF (no deps)
   • Fleet bulk broadcast with audience targeting and delivery log
   ========================================================================== */

const AEGIS_PLANS = {
  free: {
    name: 'Explorer', monthly: 0, annual: 0, tier: 'free',
    tagline: 'Core safety for every traveler',
    features: ['Live map & geofence alerts', '1-tap SOS beacon', 'Digital ID + rotating QR', 'Community scam radar']
  },
  pro: {
    name: 'Aegis Pro', monthly: 9, annual: 86, tier: 'pro',
    tagline: 'Solo travelers & trekkers',
    features: ['Dead-man safety pulse', 'Parametric instant payout', '24/7 embassy escalation', 'Family / group mesh', 'Verified incident certificates']
  },
  enterprise: {
    name: 'Enterprise', monthly: 349, annual: 3350, tier: 'enterprise',
    tagline: 'Hotels, DMOs, embassies, insurers',
    features: ['50+ tourist fleet console', 'SLA response timers', 'Heatmaps & bulk broadcast', 'Evidence export API', 'Multi-tenant seats']
  }
};

const AEGIS_PRICING = { plan: 'pro', cycle: 'monthly', processing: false };

/* Reset modal width on every open so legacy modals stay narrow. */
(function patchModalWidth() {
  const original = window.openModal;
  if (typeof original !== 'function') return;
  window.openModal = function (html) {
    const m = $('modal');
    if (m) m.className = 'modal';
    return original(html);
  };
})();

function aegisModal(html, wide) {
  openModal(html);
  const m = $('modal');
  if (m && wide) m.className = 'modal modal-wide';
}

/* ------------------------------------------------------------------- tiers */
function aegisHasTier(need) {
  return aegisTierRank() >= (AEGIS_TIERS[need] ? AEGIS_TIERS[need].rank : 0);
}

function aegisRequireTier(need, feature) {
  if (aegisHasTier(need)) return true;
  if (typeof toast === 'function') toast(feature + ' requires ' + AEGIS_TIERS[need].label, 'warning');
  aegisOpenPricing(need);
  return false;
}

function aegisStartPulse(minutes) {
  aegisPulseStart(Math.round(Number(minutes) * 60));
}

/* ---------------------------------------------------------------- pricing UI */
function aegisPlanCardsHTML(selected) {
  return '<div class="plan-cards">' + Object.keys(AEGIS_PLANS).map(key => {
    const p = AEGIS_PLANS[key];
    const price = AEGIS_PRICING.cycle === 'annual' ? p.annual : p.monthly;
    const suffix = p.monthly === 0 ? '' : '<small>/' + (AEGIS_PRICING.cycle === 'annual' ? 'yr' : 'mo') + '</small>';
    return '<div class="plan-card ' + (selected === key ? 'sel' : '') + '" onclick="aegisSelectPlan(\'' + key + '\')" role="button" tabindex="0">' +
      '<div class="pn">' + esc(p.name) + '</div>' +
      '<div class="pp">' + (price === 0 ? 'Free' : '$' + price.toLocaleString('en-US') + suffix) + '</div>' +
      '<ul>' + p.features.slice(0, 4).map(f => '<li>' + esc(f) + '</li>').join('') + '</ul></div>';
  }).join('') + '</div>';
}

function aegisOpenPricing(preselect) {
  if (preselect && AEGIS_PLANS[preselect]) AEGIS_PRICING.plan = preselect;
  if (!AEGIS_PLANS[AEGIS_PRICING.plan] || AEGIS_PRICING.plan === 'free') AEGIS_PRICING.plan = AEG.tier === 'pro' ? 'pro' : 'enterprise';
  AEGIS_PRICING.processing = false;
  const plan = AEGIS_PLANS[AEGIS_PRICING.plan];
  const price = AEGIS_PRICING.cycle === 'annual' ? plan.annual : plan.monthly;
  aegisModal('<button class="icon-btn modal-x" onclick="closeModal()" aria-label="Close">✕</button>' +
    '<div class="hstack" style="gap:8px"><span class="badge cyan">AEGIS PLANS</span><span class="kicker">Current: ' + AEGIS_TIERS[AEG.tier].label + '</span></div>' +
    '<h2 style="margin:8px 0 4px">Upgrade your safety envelope</h2>' +
    '<p class="muted" style="font-size:12px;margin:0 0 12px">Parametric payouts, embassy escalation and fleet-scale command. Cancel anytime.</p>' +
    '<div class="between" style="margin-bottom:8px"><div class="plan-toggle"><button class="' + (AEGIS_PRICING.cycle === 'monthly' ? 'active' : '') + '" onclick="aegisToggleCycle(\'monthly\')">Monthly</button><button class="' + (AEGIS_PRICING.cycle === 'annual' ? 'active' : '') + '" onclick="aegisToggleCycle(\'annual\')">Annual −20%</button></div>' +
      '<span class="chip" id="planSummary">' + esc(plan.name) + ' · $' + price + '</span></div>' +
    '<div id="priceBody">' + aegisPlanCardsHTML(AEGIS_PRICING.plan) + aegisCheckoutHTML() + '</div>');
}

function aegisToggleCycle(cycle) {
  AEGIS_PRICING.cycle = cycle;
  aegisOpenPricing();
}

function aegisSelectPlan(key) {
  if (!AEGIS_PLANS[key]) return;
  AEGIS_PRICING.plan = key;
  aegisOpenPricing();
}

function aegisCheckoutHTML() {
  const plan = AEGIS_PLANS[AEGIS_PRICING.plan];
  const price = AEGIS_PRICING.cycle === 'annual' ? plan.annual : plan.monthly;
  if (plan.monthly === 0) {
    return '<div class="notice safe" style="margin-top:8px">Explorer is free forever — no card required.</div>' +
      '<div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" onclick="closeModal()">Continue on Explorer</button></div>';
  }
  return '<div class="checkout-summary"><div><div class="kicker">TOTAL DUE TODAY</div><div style="font-size:11px;color:var(--muted)">' + esc(plan.name) + ' · billed ' + AEGIS_PRICING.cycle + '</div></div>' +
      '<b>$' + price.toLocaleString('en-US') + '<small style="font-size:10px;color:var(--muted)">.00</small></b></div>' +
    '<div id="payFormArea"><div class="paycard">' +
      '<div class="field" style="margin:0"><label>Cardholder name</label><input id="payName" placeholder="ADITYA SANAP" autocomplete="cc-name"/></div>' +
      '<div class="field" style="margin:0"><label>Card number</label><input id="payCard" placeholder="4242 4242 4242 4242" inputmode="numeric" oninput="aegisFormatCard(this)" autocomplete="cc-number"/></div>' +
      '<div class="prow"><div class="field" style="margin:0"><label>Expiry</label><input id="payExp" placeholder="MM/YY" maxlength="5" oninput="aegisFormatExpiry(this)" autocomplete="cc-exp"/></div>' +
      '<div class="field" style="margin:0"><label>CVC</label><input id="payCvc" placeholder="123" maxlength="4" inputmode="numeric" autocomplete="cc-csc"/></div></div>' +
      '<div class="error" id="payErr"></div>' +
    '</div>' +
    '<div class="actions" style="margin-top:12px"><button class="btn primary wide" id="payBtn" onclick="aegisCheckout()">Pay $' + price.toLocaleString('en-US') + ' &amp; activate ' + esc(plan.name) + '</button></div>' +
    '<div class="secure-row"><span>◆ 256-bit TLS</span><span>◆ PCI-DSS simulation</span><span>◆ No card stored</span></div>' +
    '<div class="notice" style="margin-top:10px;font-size:11px">Demo checkout — no real payment is processed. Use test card <b class="mono">4242 4242 4242 4242</b>, any future expiry, any 3-digit CVC.</div></div>' +
    '<div id="payStatus" class="pay-status hidden"></div>';
}

function aegisFormatCard(input) {
  const digits = input.value.replace(/\D/g, '').slice(0, 19);
  input.value = digits.replace(/(.{4})/g, '$1 ').trim();
}

function aegisFormatExpiry(input) {
  const digits = input.value.replace(/\D/g, '').slice(0, 4);
  input.value = digits.length > 2 ? digits.slice(0, 2) + '/' + digits.slice(2) : digits;
}

function aegisLuhn(value) {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 13) return false;
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function aegisExpiryValid(value) {
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(value).trim());
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  const end = new Date(year, month, 1).getTime();
  return end > Date.now();
}

async function aegisCheckout() {
  if (AEGIS_PRICING.processing) return;
  const planKey = AEGIS_PRICING.plan;
  const plan = AEGIS_PLANS[planKey];
  if (!plan || plan.monthly === 0) { closeModal(); return; }
  const nameEl = $('payName'), cardEl = $('payCard'), expEl = $('payExp'), cvcEl = $('payCvc'), errEl = $('payErr');
  const name = (nameEl && nameEl.value || '').trim();
  const card = (cardEl && cardEl.value || '').trim();
  const exp = (expEl && expEl.value || '').trim();
  const cvc = (cvcEl && cvcEl.value || '').trim();
  const fail = msg => {
    if (errEl) errEl.textContent = msg;
    if (typeof toast === 'function') toast(msg, 'warning');
    aegisBlip(200, 0.16, 'square', 0.06);
  };
  if (name.length < 3) return fail('Enter the cardholder name.');
  if (!aegisLuhn(card)) return fail('Card number failed Luhn validation. Try 4242 4242 4242 4242.');
  if (!aegisExpiryValid(exp)) return fail('Expiry must be a future MM/YY.');
  if (!/^\d{3,4}$/.test(cvc)) return fail('CVC must be 3–4 digits.');

  AEGIS_PRICING.processing = true;
  const area = $('payFormArea'), status = $('payStatus');
  if (area) area.classList.add('hidden');
  if (status) status.classList.remove('hidden');
  const steps = ['Tokenising card with vault…', 'Authorising $' + (AEGIS_PRICING.cycle === 'annual' ? plan.annual : plan.monthly) + '…', 'Provisioning embassy channel…', 'Activating ' + plan.name + '…'];
  const setStatus = (i, done) => {
    if (!status) return;
    status.innerHTML = done
      ? '<div class="pay-check">✓</div><b style="font-family:var(--font-d);font-size:17px">' + esc(plan.name) + ' activated</b>' +
        '<div class="muted" style="font-size:11.5px">Evidence chain extended · receipt written to the ledger.</div>' +
        '<div class="hstack" style="justify-content:center"><button class="btn primary" onclick="closeModal();aegisGoto(\'vault\')">Open ID vault</button><button class="btn" onclick="closeModal()">Back to console</button></div>'
      : '<div class="pay-spinner"></div><b style="font-size:13px">' + esc(steps[i] || 'Finalising…') + '</b><div class="kicker">STEP ' + (i + 1) + ' / ' + steps.length + '</div>';
  };
  setStatus(0, false);
  for (let i = 0; i < steps.length; i++) {
    await new Promise(r => setTimeout(r, 520));
    setStatus(i, false);
  }
  await new Promise(r => setTimeout(r, 420));
  setStatus(steps.length, true);
  aegisActivatePlan(planKey, AEGIS_PRICING.cycle, card.replace(/\D/g, '').slice(-4));
  AEGIS_PRICING.processing = false;
}

function aegisActivatePlan(planKey, cycle, last4) {
  const plan = AEGIS_PLANS[planKey];
  if (!plan) return;
  AEG.tier = plan.tier;
  AEG.subscription = {
    plan: planKey,
    label: plan.name,
    cycle: cycle || 'monthly',
    price: cycle === 'annual' ? plan.annual : plan.monthly,
    last4: last4 || '4242',
    status: 'active',
    seats: planKey === 'enterprise' ? 25 : 1,
    activatedAt: aegisNowIso(),
    renewsAt: new Date(Date.now() + (cycle === 'annual' ? 365 : 30) * 86400000).toISOString()
  };
  aegisSave();
  const entry = aegisLedgerAppend('SUBSCRIPTION_ACTIVATED', plan.name + ' subscription activated', {
    plan: planKey, cycle: AEG.subscription.cycle, amount: AEG.subscription.price,
    cardLast4: AEG.subscription.last4, seats: AEG.subscription.seats
  });
  aegisNotify('ok', plan.name + ' unlocked', 'Parametric payout, embassy escalation and evidence exports are now live.');
  if (typeof sbAegisSubscriptionUpsert === 'function') sbAegisSubscriptionUpsert(AEG.subscription);
  aegisPaintChrome();
  if (typeof render === 'function' && S.page === 'billing') render();
  if (typeof toast === 'function') toast(plan.name + ' activated · receipt ' + entry.hash.slice(0, 10), 'success');
  setTimeout(() => aegisBlip(880, 0.14), 120);
  setTimeout(() => aegisBlip(1180, 0.18), 260);
}

function aegisCancelSubscription() {
  openModal('<h2>Cancel subscription?</h2><p class="muted" style="font-size:12.5px">Pro features (pulse escalation routing, parametric payout, embassy channel) will revert to Explorer at the end of the current cycle. Evidence already sealed remains verifiable forever.</p>' +
    '<div class="actions" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">Keep plan</button><button class="btn danger" onclick="aegisDoCancel()">Cancel plan</button></div>');
}

function aegisDoCancel() {
  const prev = AEG.subscription ? AEG.subscription.label : 'Subscription';
  AEG.tier = 'free';
  AEG.subscription = null;
  aegisSave();
  aegisLedgerAppend('SUBSCRIPTION_CANCELLED', prev + ' cancelled', { by: (S.user && S.user.name) || 'Traveler' });
  aegisNotify('info', 'Subscription cancelled', 'Reverted to Explorer. Existing evidence blocks remain valid.');
  closeModal();
  aegisPaintChrome();
  if (typeof render === 'function') render();
  if (typeof toast === 'function') toast('Plan cancelled — Explorer retained', 'info');
}

/* ---------------------------------------------------------------- billing UI */
function aegisBillingPage() {
  const sub = AEG.subscription;
  const plan = AEGIS_PLANS[AEG.tier] || AEGIS_PLANS.free;
  const invoices = sub ? [0, 1, 2].map(i => ({
    id: 'INV-' + (2026 - 0) + '-' + aegisPad(118 - i, 4),
    date: new Date(new Date(sub.activatedAt).getTime() - i * 30 * 86400000).toISOString(),
    amount: sub.price,
    status: 'Paid'
  })) : [];
  return '<div class="split-2">' +
    '<div class="stack">' +
      '<div class="card" style="background:linear-gradient(130deg,rgba(0,240,255,.07),transparent 60%),var(--card)">' +
        '<div class="between"><div><span class="kicker">CURRENT PLAN</span><h2 style="margin:4px 0 2px;font-size:22px">' + esc(plan.name) + '</h2>' +
          '<div class="muted" style="font-size:12px">' + esc(plan.tagline) + '</div></div>' +
          '<span class="tier-badge ' + (AEG.tier === 'free' ? '' : AEG.tier) + '">' + AEGIS_TIERS[AEG.tier].label + '</span></div>' +
        '<div class="grid" style="grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px">' +
          '<div class="card" style="padding:10px"><div class="stat-label">Billing</div><div class="stat-num" style="font-size:16px">' + (sub ? '$' + sub.price + ' / ' + sub.cycle : 'Free') + '</div></div>' +
          '<div class="card" style="padding:10px"><div class="stat-label">Seats</div><div class="stat-num" style="font-size:16px">' + (sub ? sub.seats : 1) + '</div></div>' +
          '<div class="card" style="padding:10px"><div class="stat-label">Renews</div><div class="stat-num" style="font-size:16px">' + (sub ? aegisFmtDate(sub.renewsAt) : '—') + '</div></div>' +
        '</div>' +
        '<div class="hstack" style="margin-top:12px"><button class="btn primary" onclick="aegisOpenPricing(\'' + (AEG.tier === 'pro' ? 'enterprise' : 'pro') + '\')">' + (AEG.tier === 'free' ? 'Upgrade plan' : 'Change plan') + '</button>' +
        (sub ? '<button class="btn" onclick="aegisCancelSubscription()">Cancel subscription</button>' : '') + '</div>' +
        '<div class="secure-row" style="justify-content:flex-start;margin-top:10px"><span>◆ Payment method ' + (sub ? '•••• ' + sub.last4 : 'none on file') + '</span><span>◆ PCI simulation</span></div>' +
      '</div>' +
      '<div class="card"><div class="panel-title"><h4>Included capabilities</h4><span class="chip">' + plan.features.length + ' features</span></div>' +
        plan.features.map(f => '<div class="row"><div><b>' + esc(f) + '</b></div><span class="badge safe">ACTIVE</span></div>').join('') +
      '</div>' +
      '<div class="card"><div class="panel-title"><h4>Invoices</h4><span class="kicker">Demo ledger</span></div>' +
        (invoices.length ? invoices.map(inv => '<div class="row"><div><b>' + esc(inv.id) + '</b><small>' + aegisFmtDate(inv.date) + ' · ' + esc(plan.name) + '</small></div><div style="text-align:right"><b>$' + inv.amount + '.00</b><div class="badge safe" style="margin-top:4px">PAID</div></div></div>').join('') : '<div class="feed-empty">No invoices yet — you are on the free tier.</div>') +
      '</div>' +
    '</div>' +
    '<div class="stack">' +
      '<div class="card"><div class="panel-title"><h4>Feature matrix</h4></div>' +
        '<div class="kv"><span>Dead-man safety pulse</span><b>Explorer+</b></div>' +
        '<div class="kv"><span>Parametric payout certificate</span><b style="color:var(--amber-ink)">Pro</b></div>' +
        '<div class="kv"><span>24/7 embassy escalation</span><b style="color:var(--amber-ink)">Pro</b></div>' +
        '<div class="kv"><span>Family / group mesh</span><b style="color:var(--amber-ink)">Pro</b></div>' +
        '<div class="kv"><span>Fleet console (50+)</span><b style="color:#C4B5FD">Enterprise</b></div>' +
        '<div class="kv"><span>Bulk broadcast</span><b style="color:#C4B5FD">Enterprise</b></div>' +
        '<div class="kv"><span>Evidence export API</span><b style="color:#C4B5FD">Enterprise</b></div>' +
      '</div>' +
      '<div class="card"><div class="panel-title"><h4>Buyer playbook</h4></div>' +
        '<div class="sos-steps" style="margin:0"><div><i>B2C</i>Solo traveler: safety pulse, holographic ID, parametric cover</div><div><i>B2B</i>Hotel / DMO: fleet heatmap, SLA timers, broadcast</div><div><i>B2B2C</i>Insurer: verified certificates settle claims in seconds</div></div>' +
      '</div>' +
      '<div class="card"><div class="panel-title"><h4>Evidence export</h4></div>' +
        '<p class="lead-sm">Certificates and the full ledger are portable. Hash chain is recomputable without our servers.</p>' +
        '<div class="actions" style="margin-top:10px"><button class="btn tiny" onclick="aegisExportLedger()">Export ledger</button><button class="btn tiny primary" onclick="aegisOpenCertificate()">New certificate</button></div>' +
      '</div>' +
    '</div></div>';
}

function aegisBindBilling() {
  aegisPaintChrome();
}

/* ------------------------------------------------------- parametric certificates */
function aegisCertificateFor(incidentId) {
  let inc = incidentId ? S.incidents.find(i => i.id === incidentId) : null;
  if (!inc) {
    inc = S.incidents.find(i => (i.source === 'sos' || i.type === 'SOS Alert') && i.status !== 'Resolved') ||
      S.incidents.find(i => i.type === 'SOS Alert') || S.incidents[0] || null;
  }
  const subject = (inc && (S.tourists.find(t => t.id === inc.touristId) || AEG.fleet.find(f => f.id === inc.touristId))) || aegisSubject();
  const p = aegisPoint(subject);
  const zone = aegisZoneAt(p.lat, p.lng);
  const chain = aegisLedgerVerify();
  const blocks = AEG.ledger.slice(0, 12).map(b => ({ seq: b.seq, type: b.type, ts: b.ts, hash: b.hash, prev: b.prev }));
  const breadcrumbs = AEG.trail.slice(-24).map(pt => ({ ts: new Date(pt.t).toISOString(), lat: pt.lat, lng: pt.lng, risk: pt.risk }));
  const severity = incidentId && inc ? inc.severity : 'MEDIUM';
  const amount = severity === 'HIGH' ? 1500 : severity === 'MEDIUM' ? 600 : 250;
  const certificate = {
    schema: 'aegis.certificate/1.0',
    certificateId: 'CERT-' + Date.now().toString(36).toUpperCase(),
    issuedAt: aegisNowIso(),
    issuer: { name: 'AegisTravel Systems', jurisdiction: 'IN-MH', licence: 'DEMO-AG-2026', contact: 'claims@aegistravel.demo' },
    tourist: {
      id: subject.id, name: subject.name, email: subject.email || null,
      bloodGroup: subject.blood || null, allergies: subject.allergy || null,
      identityHash: AEG.identity.hash, plan: AEG.tier
    },
    incident: inc ? {
      id: inc.id, type: inc.type, severity: inc.severity, status: inc.status,
      zone: inc.zone || zone.name, coordinates: { lat: inc.lat != null ? inc.lat : p.lat, lng: inc.lng != null ? inc.lng : p.lng },
      occurredAt: inc.occurredAt || inc.time || null, auditRef: inc.auditRef || null,
      source: inc.source || 'sos', assignedTo: inc.assignedTo || null
    } : {
      id: 'AEGIS-ANOMALY-' + Date.now().toString(36).toUpperCase(),
      type: 'Transit delay / route anomaly',
      severity: 'MEDIUM', status: 'Verified', zone: zone.name,
      coordinates: { lat: p.lat, lng: p.lng }, occurredAt: aegisNowIso(),
      auditRef: 'AR-' + String(AEG.identity.hash || '').slice(0, 10).toUpperCase(), source: 'deviation', assignedTo: null
    },
    evidence: {
      algorithm: 'SHA-256', chainIntact: chain.ok, blocksVerified: chain.checked,
      headHash: AEG.ledger[0] ? AEG.ledger[0].hash : null, blocks
    },
    telemetry: { breadcrumbs, battery: AEG.battery.level, network: aegisNetworkType(), accuracyMeters: Math.round(p.accuracy) },
    parametric: {
      trigger: 'verified-incident', eligible: true, amount, currency: 'USD',
      settlementWindow: 'instant', basis: severity === 'HIGH' ? 'Tier-1 SOS with dispatcher assignment' : 'Verified anomaly sustained beyond SLA'
    },
    verification: {
      method: 'Recompute SHA-256 over each block body {seq,type,title,payload,ts,prev} and compare in sequence; documentHash covers this object without the documentHash field.',
      endpoint: 'aegis://verify/' + String(AEG.identity.hash || '').slice(0, 12)
    }
  };
  certificate.documentHash = sha256HexSync(JSON.stringify(certificate));
  certificate.shortHash = certificate.documentHash.slice(0, 16).toUpperCase();
  return certificate;
}

function aegisOpenCertificate(incidentId) {
  if (!aegisRequireTier('pro', 'Parametric insurance certificate')) return;
  const cert = aegisCertificateFor(incidentId);
  AEG.certs.unshift({ certificateId: cert.certificateId, incidentId: cert.incident.id, hash: cert.documentHash, issuedAt: cert.issuedAt, amount: cert.parametric.amount });
  if (AEG.certs.length > 20) AEG.certs.length = 20;
  aegisSave();
  aegisLedgerAppend('CERTIFICATE_ISSUED', 'Verified incident certificate issued', {
    certificateId: cert.certificateId, incidentId: cert.incident.id,
    documentHash: cert.documentHash, payout: cert.parametric.amount
  });
  const chainOk = cert.evidence.chainIntact;
  aegisModal('<button class="icon-btn modal-x" onclick="closeModal()">✕</button>' +
    '<div class="hstack"><span class="badge cyan">VERIFIED CERTIFICATE</span><span class="kicker">' + esc(cert.certificateId) + '</span></div>' +
    '<h2 style="margin:8px 0 2px">Incident certificate</h2>' +
    '<p class="muted" style="font-size:12px;margin:0">Tamper-evident evidence pack for insurers, embassies and police.</p>' +
    '<div class="cert-preview" style="margin-top:12px">' +
      '<div class="between"><div><div class="kicker">TRAVELLER</div><div style="font-family:var(--font-d);font-size:16px">' + esc(cert.tourist.name) + '</div>' +
        '<div class="faint" style="font-size:10.5px">' + esc(cert.tourist.id) + ' · blood ' + esc(cert.tourist.bloodGroup || '—') + ' · ' + esc(cert.tourist.allergies || 'no allergies') + '</div></div>' +
        '<div style="text-align:right"><div class="kicker">PAYOUT</div><div style="font-family:var(--font-d);font-size:22px">$' + cert.parametric.amount + '</div><div class="badge safe" style="margin-top:2px">PARAMETRIC</div></div></div>' +
      '<hr class="sep"/>' +
      '<div class="kv"><span>Incident</span><b>' + esc(cert.incident.id) + ' · ' + esc(cert.incident.type) + '</b></div>' +
      '<div class="kv"><span>Zone</span><b>' + esc(cert.incident.zone) + '</b></div>' +
      '<div class="kv"><span>Coordinates</span><b>' + Number(cert.incident.coordinates.lat).toFixed(5) + ', ' + Number(cert.incident.coordinates.lng).toFixed(5) + '</b></div>' +
      '<div class="kv"><span>Block chain</span><b style="color:' + (chainOk ? 'var(--mint)' : 'var(--red-ink)') + '">' + (chainOk ? cert.evidence.blocksVerified + ' blocks intact' : 'TAMPER DETECTED') + '</b></div>' +
      '<div class="kv"><span>Battery / network</span><b>' + (cert.telemetry.battery != null ? cert.telemetry.battery + '%' : '—') + ' · ' + esc(cert.telemetry.network) + '</b></div>' +
      '<div style="margin-top:8px"><div class="kicker">DOCUMENT HASH (SHA-256)</div><div class="hash">' + esc(cert.documentHash) + '</div></div>' +
      '<div class="breadcrumb-mini">' + cert.telemetry.breadcrumbs.slice(-24).map(p => '<i title="' + p.ts + '"></i>').join('') + '</div>' +
      '<div class="faint" style="font-size:9px;margin-top:4px;font-family:var(--font-m)">' + cert.telemetry.breadcrumbs.length + ' GPS breadcrumbs · signed ' + aegisFmtTime(cert.issuedAt) + '</div>' +
    '</div>' +
    '<div class="actions" style="margin-top:12px"><button class="btn primary" onclick="aegisDownloadCertificatePDF()">Download PDF</button>' +
      '<button class="btn" onclick="aegisDownloadCertificateJSON()">Download JSON</button>' +
      '<button class="btn" onclick="aegisCopyText(\'' + esc(cert.documentHash) + '\')">Copy hash</button></div>' +
    '<div class="actions" style="margin-top:6px"><button class="btn amber" onclick="aegisFileClaim()">File parametric claim ($' + cert.parametric.amount + ')</button>' +
      '<button class="btn" onclick="aegisEmbassyEscalate()">Embassy escalation</button></div>' +
    '<div class="notice" style="margin-top:10px;font-size:10.5px">Certificate hash covers the evidence object excluding <b>documentHash</b>. Any field edit invalidates verification.</div>');
  window.__aegisCert = cert;
  aegisNotify('ok', 'Certificate issued', cert.certificateId + ' · $' + cert.parametric.amount + ' parametric cover');
}

function aegisOpenCertificateFor(id) { aegisOpenCertificate(id); }

function aegisCertificateLines(cert) {
  const lines = [];
  lines.push({ text: 'CERTIFICATE ' + cert.certificateId, size: 9, bold: true, gap: 16 });
  lines.push({ text: 'Issued ' + new Date(cert.issuedAt).toLocaleString('en-IN') + ' · schema ' + cert.schema, size: 8, muted: true, gap: 16 });
  lines.push({ rule: true });
  lines.push({ text: '1. TRAVELLER', size: 9, bold: true, gap: 14 });
  lines.push({ text: cert.tourist.name + '  ·  ID ' + cert.tourist.id + '  ·  plan ' + cert.tourist.plan, gap: 13 });
  lines.push({ text: 'Blood group ' + (cert.tourist.bloodGroup || '-') + '  ·  allergies: ' + (cert.tourist.allergies || 'none reported'), gap: 13, muted: true });
  lines.push({ text: 'Identity hash ' + String(cert.tourist.identityHash || '').slice(0, 48), hash: true, size: 7.5, gap: 18 });
  lines.push({ rule: true });
  lines.push({ text: '2. INCIDENT', size: 9, bold: true, gap: 14 });
  lines.push({ text: cert.incident.id + '  ·  ' + cert.incident.type + '  ·  severity ' + cert.incident.severity, gap: 13 });
  lines.push({ text: 'Zone: ' + cert.incident.zone + '  ·  status ' + cert.incident.status, gap: 13, muted: true });
  lines.push({ text: 'Coordinates ' + Number(cert.incident.coordinates.lat).toFixed(6) + ', ' + Number(cert.incident.coordinates.lng).toFixed(6) + '  +/-' + cert.telemetry.accuracyMeters + 'm', gap: 13, muted: true });
  lines.push({ text: 'Occurred ' + (cert.incident.occurredAt || '-') + '  ·  audit ' + (cert.incident.auditRef || '-'), gap: 18, muted: true });
  lines.push({ rule: true });
  lines.push({ text: '3. EVIDENCE CHAIN', size: 9, bold: true, gap: 14 });
  lines.push({ text: (cert.evidence.chainIntact ? 'INTACT' : 'TAMPER DETECTED') + '  ·  ' + cert.evidence.blocksVerified + ' blocks verified  ·  SHA-256', gap: 13, accent: cert.evidence.chainIntact });
  lines.push({ text: 'Head ' + String(cert.evidence.headHash || '').slice(0, 56), hash: true, size: 7.5, gap: 14 });
  lines.push({ text: 'Document hash', size: 8, bold: true, gap: 12 });
  const h = cert.documentHash;
  for (let i = 0; i < h.length; i += 64) lines.push({ text: h.slice(i, i + 64), hash: true, size: 7.5, gap: 11 });
  lines.push({ rule: true });
  lines.push({ text: '4. GPS BREADCRUMBS (last ' + cert.telemetry.breadcrumbs.length + ')', size: 9, bold: true, gap: 13 });
  lines.push({ text: 'time       latitude     longitude     risk', size: 7.5, muted: true, gap: 11 });
  cert.telemetry.breadcrumbs.slice(-9).forEach(p => {
    lines.push({
      text: new Date(p.ts).toISOString().slice(11, 19) + '   ' + Number(p.lat).toFixed(6) + '   ' + Number(p.lng).toFixed(6) + '    ' + p.risk,
      hash: true, size: 7.5, gap: 10.5
    });
  });
  lines.push({ rule: true });
  lines.push({ text: '5. PARAMETRIC SETTLEMENT', size: 9, bold: true, gap: 13 });
  lines.push({ text: 'Eligible: ' + (cert.parametric.eligible ? 'YES' : 'NO') + '  ·  amount USD ' + cert.parametric.amount + '  ·  ' + cert.parametric.settlementWindow, gap: 13 });
  lines.push({ text: 'Trigger: ' + cert.parametric.basis, gap: 13, muted: true });
  lines.push({ text: 'Battery ' + (cert.telemetry.battery != null ? cert.telemetry.battery + '%' : 'unknown') + '  ·  network ' + cert.telemetry.network, gap: 18, muted: true });
  lines.push({ rule: true });
  lines.push({ text: 'VERIFICATION', size: 8, bold: true, gap: 12 });
  lines.push({ text: cert.verification.method, size: 7, muted: true, gap: 10 });
  lines.push({ text: 'Endpoint ' + cert.verification.endpoint, size: 7, muted: true, gap: 10 });
  return lines;
}

/* Minimal, dependency-free PDF 1.4 writer (Helvetica / Courier, single page). */
function aegisAscii(input) {
  return String(input == null ? '' : input)
    .replace(/₹/g, 'Rs ')
    .replace(/[—–·•]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[→←]/g, '->')
    .replace(/[^\x20-\x7E\n]/g, '?');
}

function aegisPdfEscape(value) {
  return aegisAscii(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function aegisBuildCertificatePdf(cert) {
  const lines = aegisCertificateLines(cert);
  const content = [];
  content.push('q 0.035 0.055 0.09 rg 0 742 595 100 re f Q');
  content.push('q 0 0.941 1 rg 0 739 595 3 re f Q');
  content.push('q 0.15 0.85 1 rg 40 786 46 3 re f Q');
  content.push('BT /F2 17 Tf 1 1 1 rg 40 806 Td (' + aegisPdfEscape('AEGISTRAVEL - VERIFIED INCIDENT CERTIFICATE') + ') Tj ET');
  content.push('BT /F1 8.5 Tf 0.65 0.80 0.88 rg 40 788 Td (' + aegisPdfEscape('Parametric evidence pack · SHA-256 chained · ' + cert.certificateId) + ') Tj ET');
  content.push('BT /F1 8 Tf 0.65 0.80 0.88 rg 40 772 Td (' + aegisPdfEscape('Issued ' + new Date(cert.issuedAt).toLocaleString('en-IN') + ' · issuer ' + cert.issuer.name + ' · licence ' + cert.issuer.licence) + ') Tj ET');
  let y = 706;
  lines.forEach(line => {
    if (y < 58) return;
    if (line.rule) {
      content.push('q 0.80 0.87 0.92 RG 0.6 w 40 ' + y + ' m 555 ' + y + ' l S Q');
      y -= 13;
      return;
    }
    const size = line.size || 9.2;
    const font = line.bold ? 'F2' : line.hash ? 'F3' : 'F1';
    const color = line.accent ? '0.0 0.6 0.45' : line.muted ? '0.38 0.47 0.54' : '0.06 0.09 0.13';
    content.push('BT /' + font + ' ' + size + ' Tf ' + color + ' rg 40 ' + y.toFixed(1) + ' Td (' + aegisPdfEscape(line.text) + ') Tj ET');
    y -= (line.gap || 12.5);
  });
  content.push('q 0.80 0.87 0.92 RG 0.6 w 40 52 m 555 52 l S Q');
  content.push('BT /F1 7 Tf 0.42 0.52 0.60 rg 40 38 Td (' + aegisPdfEscape('Verify by recomputing SHA-256 over each ledger block body and comparing in sequence. Document hash covers this certificate without the documentHash field.') + ') Tj ET');
  content.push('BT /F1 7 Tf 0.42 0.52 0.60 rg 40 28 Td (' + aegisPdfEscape('AegisTravel Systems · claims@aegistravel.demo · demo environment, not a regulated insurance instrument') + ') Tj ET');

  const stream = content.join('\n');
  let out = '%PDF-1.4\n';
  const offsets = [];
  const addObject = (num, body) => {
    offsets[num] = out.length;
    out += num + ' 0 obj\n' + body + '\nendobj\n';
  };
  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  addObject(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>');
  addObject(4, '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
  addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  addObject(6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  addObject(7, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  const xref = out.length;
  out += 'xref\n0 8\n0000000000 65535 f \n';
  for (let i = 1; i <= 7; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  out += 'trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return new Blob([out], { type: 'application/pdf' });
}

function aegisDownload(blob, filename) {
  let url = null;
  try {
    if (blob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') url = URL.createObjectURL(blob);
  } catch (e) { url = null; }
  if (!url) {
    // Hardened webviews and in-app browsers can block object URLs entirely.
    if (typeof toast === 'function') toast('Download blocked by this browser — copy the JSON export instead', 'warning');
    return false;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} a.remove(); }, 1200);
  if (typeof toast === 'function') toast(filename + ' downloaded', 'success');
}

function aegisDownloadCertificatePDF() {
  const cert = window.__aegisCert || aegisCertificateFor();
  try {
    aegisDownload(aegisBuildCertificatePdf(cert), 'aegis-certificate-' + cert.certificateId + '.pdf');
    aegisLedgerAppend('CERTIFICATE_EXPORTED', 'Certificate PDF exported', { certificateId: cert.certificateId, format: 'pdf' });
  } catch (err) {
    console.error(err);
    if (typeof toast === 'function') toast('PDF generation failed — JSON export remains available', 'danger');
  }
}

function aegisDownloadCertificateJSON() {
  const cert = window.__aegisCert || aegisCertificateFor();
  aegisDownload(new Blob([JSON.stringify(cert, null, 2)], { type: 'application/json' }), 'aegis-certificate-' + cert.certificateId + '.json');
  aegisLedgerAppend('CERTIFICATE_EXPORTED', 'Certificate JSON exported', { certificateId: cert.certificateId, format: 'json' });
}

function aegisCopyText(text) {
  const value = String(text || '');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value).then(() => toast('Copied', 'success')).catch(() => aegisShowText(value));
  } else aegisShowText(value);
}

function aegisShowText(text) {
  aegisModal('<h2>Copy value</h2><div class="cert-preview"><div class="hash" style="color:var(--ink)">' + esc(text) + '</div></div><div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" onclick="closeModal()">Done</button></div>');
}

function aegisExportLedger() {
  const verify = aegisLedgerVerify();
  const payload = {
    schema: 'aegis.ledger/1.0',
    exportedAt: aegisNowIso(),
    tourist: { id: (aegisSubject() || {}).id, name: (aegisSubject() || {}).name, identityHash: AEG.identity.hash },
    verification: verify,
    blocks: AEG.ledger
  };
  aegisDownload(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'aegis-ledger-' + Date.now() + '.json');
  aegisLedgerAppend('LEDGER_EXPORTED', 'Evidence ledger exported', { blocks: AEG.ledger.length, chainOk: verify.ok });
}

function aegisDownloadIDCard() {
  const t = aegisSubject() || {};
  const card = {
    schema: 'aegis.digital-id/1.0',
    issuedAt: aegisNowIso(),
    holder: { id: t.id, name: t.name, email: t.email, phone: t.phone, blood: t.blood, allergies: t.allergy },
    identityHash: AEG.identity.hash,
    chainHead: AEG.ledger[0] ? AEG.ledger[0].hash : null,
    blocks: AEG.ledger.length,
    verify: 'Recompute SHA-256 over id|name|email|phone|blood|allergies prefixed with AEGIS-ID-V1::'
  };
  aegisDownload(new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' }), 'aegis-id-' + (t.id || 'guest') + '.json');
  aegisLedgerAppend('ID_EXPORTED', 'Digital ID credential exported', { touristId: t.id, hash: AEG.identity.hash });
}

function aegisFileClaim() {
  const cert = window.__aegisCert;
  if (!cert) return;
  if (!aegisRequireTier('pro', 'Parametric instant payout')) return;
  aegisModal('<div class="pay-status"><div class="pay-spinner"></div><b style="font-size:14px">Submitting verified claim…</b>' +
    '<div class="kicker">' + esc(cert.certificateId) + ' · $' + cert.parametric.amount + '</div></div>' +
    '<div id="claimSteps" class="sos-steps" style="margin-top:10px"></div>');
  const steps = ['Certificate hash verified', 'Evidence chain replayed (' + cert.evidence.blocksVerified + ' blocks)', 'Payout rule matched: ' + cert.parametric.basis, 'Settlement dispatched'];
  let i = 0;
  const timer = setInterval(() => {
    const host = $('claimSteps');
    if (host) host.innerHTML += '<div><i>✓</i>' + esc(steps[i]) + '</div>';
    i++;
    if (i >= steps.length) {
      clearInterval(timer);
      aegisLedgerAppend('CLAIM_SETTLED', 'Parametric claim settled', {
        certificateId: cert.certificateId, amount: cert.parametric.amount, currency: 'USD', method: 'instant-bank-rail'
      });
      aegisNotify('ok', 'Parametric payout settled', '$' + cert.parametric.amount + ' released · ' + cert.certificateId);
      const host2 = $('claimSteps');
      if (host2) host2.innerHTML += '<div class="notice safe" style="margin-top:8px"><b>$' + cert.parametric.amount + ' settled</b> — reference ' + cert.shortHash + '</div>' +
        '<div class="actions" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" onclick="closeModal()">Done</button></div>';
      aegisBlip(980, 0.16);
    }
  }, 620);
}

function aegisEmbassyEscalate() {
  if (!aegisRequireTier('pro', '24/7 embassy escalation')) return;
  const t = aegisSubject() || {};
  aegisLedgerAppend('EMBASSY_ESCALATION', 'Embassy channel escalation opened', {
    touristId: t.id, name: t.name, consulate: 'Consulate General — Mumbai', channel: '24/7 duty officer'
  });
  aegisNotify('med', 'Embassy channel opened', 'Duty officer notified with Digital ID and last known coordinates.');
  aegisModal('<div class="pay-status"><div class="pay-check">✓</div><b style="font-family:var(--font-d);font-size:17px">Embassy channel opened</b>' +
    '<div class="muted" style="font-size:11.5px;text-align:center">Consulate General — Mumbai · duty officer notified with evidence pack ' + esc(String(AEG.ledger[0].hash).slice(0, 10)) + '…</div>' +
    '<div class="actions" style="justify-content:center;margin-top:8px"><button class="btn primary" onclick="closeModal()">Acknowledge</button></div></div>');
}

/* ------------------------------------------------------------- fleet broadcast */
function aegisBulkBroadcast() {
  if (!aegisRequireTier('enterprise', 'Bulk fleet broadcast')) return;
  const existing = $('bcMessage') ? $('bcMessage').value : '';
  const zones = Array.from(new Set(AEG.fleet.map(f => f.zone))).slice(0, 8);
  aegisModal('<button class="icon-btn modal-x" onclick="closeModal()">✕</button>' +
    '<div class="hstack"><span class="badge warning">ENTERPRISE</span><span class="kicker">Mass notification</span></div>' +
    '<h2 style="margin:8px 0 4px">Broadcast to fleet</h2>' +
    '<p class="muted" style="font-size:12px">In-app push + SMS queue. Delivery is acknowledged per tourist and logged to the evidence chain.</p>' +
    '<div class="field"><label>Message</label><textarea id="bcMsgModal" rows="3">' + esc(existing || 'High tide advisory: avoid the causeway steps until 20:00.') + '</textarea></div>' +
    '<div class="field"><label>Audience</label><select id="bcAud"><option value="all">All tourists (' + AEG.fleet.length + ')</option><option value="flagged">Flagged only (' + AEG.fleet.filter(f => f.status !== 'Safe').length + ')</option>' +
    zones.map(z => '<option value="zone:' + esc(z) + '">Zone · ' + esc(z) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label>Severity</label><select id="bcSeverity"><option value="info">Information</option><option value="warning">Advisory</option><option value="critical">Critical</option></select></div>' +
    '<div class="actions" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="aegisSendBroadcast()">Send broadcast</button></div>');
}

function aegisSendBroadcast() {
  const msg = cleanText(($('bcMsgModal') || {}).value || '', 200);
  const audience = ($('bcAud') || {}).value || 'all';
  const severity = ($('bcSeverity') || {}).value || 'info';
  if (!msg) { toast('Broadcast message cannot be empty', 'warning'); return; }
  let recipients = AEG.fleet.slice();
  if (audience === 'flagged') recipients = recipients.filter(f => f.status !== 'Safe');
  if (audience.indexOf('zone:') === 0) recipients = recipients.filter(f => f.zone === audience.slice(5));
  const record = {
    id: 'BC-' + Date.now().toString(36).toUpperCase(),
    message: msg, audience, severity, recipients: recipients.length,
    sentAt: aegisNowIso(), by: (S.user && S.user.name) || 'Commander'
  };
  AEG.broadcasts.unshift(record);
  if (AEG.broadcasts.length > 24) AEG.broadcasts.length = 24;
  AEG.counters.broadcasts = (AEG.counters.broadcasts || 0) + 1;
  aegisSave();
  aegisLedgerAppend('BROADCAST_SENT', 'Fleet broadcast dispatched', record);
  aegisNotify(severity === 'critical' ? 'high' : severity === 'warning' ? 'med' : 'info',
    'Broadcast → ' + record.recipients + ' tourists', msg);
  if (typeof sbAegisBroadcastInsert === 'function') sbAegisBroadcastInsert(record);
  closeModal();
  aegisRenderBroadcastLog();
  if (typeof toast === 'function') toast('Broadcast delivered to ' + record.recipients + ' tourists', 'success');
  aegisBlip(720, 0.12);
}

function aegisRenderBroadcastLog() {
  const host = $('bcLog');
  if (!host) {
    if (typeof aegisPaintLive === 'function') aegisPaintLive();
    return;
  }
  host.innerHTML = AEG.broadcasts.length
    ? AEG.broadcasts.slice(0, 3).map(b => '<div class="kv"><span>' + aegisFmtTime(b.sentAt) + ' · ' + b.recipients + ' recipients</span><b>' + esc(String(b.message).slice(0, 40)) + '…</b></div>').join('')
    : '<div class="faint" style="font-size:10.5px">No broadcasts sent this cycle.</div>';
}

/* --------------------------------------------------------------- SOS sharing */
function aegisWhatsAppSOS() {
  const url = aegisWhatsAppLink();
  try { window.open(url, '_blank', 'noopener'); } catch (e) { aegisCopyPayload(); }
  aegisLedgerAppend('SOS_PAYLOAD_EXPORTED', 'Emergency payload shared to messaging', { channel: 'whatsapp', payload: aegisSmsPayload('SOS') });
}

