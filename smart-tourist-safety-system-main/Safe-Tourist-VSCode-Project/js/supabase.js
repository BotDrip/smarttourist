'use strict';
// ============================================================================
// SMART TOURIST SAFETY MONITORING & RAPID INCIDENT RESPONSE
// Supabase Cloud Backend Client & Realtime Sync Engine
// ============================================================================

const SUPABASE_CONFIG = {
  URL: localStorage.getItem('sts_sb_url') || 'https://jwaozlhbmlzefntqkrzx.supabase.co',
  KEY: localStorage.getItem('sts_sb_key') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3YW96bGhibWx6ZWZudHFrcnp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNTM4NDEsImV4cCI6MjEwNjkyOTg0MX0.oDfkp8TJA1CJQTD8u70crSlXnFTbCUdhMCn0g3x6_wE'
};

let sbClient = null;
let isCloudConnected = false;

function initSupabase() {
  if (window.supabase && SUPABASE_CONFIG.URL && SUPABASE_CONFIG.KEY) {
    try {
      sbClient = window.supabase.createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.KEY);
      isCloudConnected = true;
      console.log('✅ Supabase Client initialized');
      checkSupabaseHealth();
    } catch (err) {
      console.warn('⚠️ Supabase initialization failed, falling back to local storage:', err);
      sbClient = null;
      isCloudConnected = false;
      updateCloudStatusUI();
    }
  } else {
    sbClient = null;
    isCloudConnected = false;
    updateCloudStatusUI();
  }
  return isCloudConnected;
}

async function checkSupabaseHealth() {
  if (!sbClient) {
    isCloudConnected = false;
    updateCloudStatusUI();
    return false;
  }
  try {
    const { data, error } = await sbClient.from('safety_zones').select('id').limit(1);
    if (error) {
      console.warn('Supabase ping notice:', error.message);
      isCloudConnected = !error.message?.includes('FetchError') && !error.message?.includes('Failed to fetch');
    } else {
      isCloudConnected = true;
    }
  } catch (err) {
    console.warn('Supabase health check network error:', err);
    isCloudConnected = false;
  }
  updateCloudStatusUI();
  return isCloudConnected;
}

function updateCloudStatusUI() {
  // Cloud DB pills hidden from UI per design
}


// ----------------------------------------------------------------------------
// CLOUD AUTHENTICATION
// ----------------------------------------------------------------------------
async function sbSignUp(email, password, metadata) {
  if (!sbClient) return null;
  const { data, error } = await sbClient.auth.signUp({
    email,
    password,
    options: { data: metadata }
  });
  if (error) throw error;
  return data;
}

async function sbSignIn(email, password) {
  if (!sbClient) return null;
  const { data, error } = await sbClient.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  return data;
}

async function sbSignInAuthority(email, password) {
  if (!sbClient) return null;
  const { data, error } = await sbClient.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  const role = data?.user?.app_metadata?.role || data?.user?.user_metadata?.role;
  const isAuthority = role === 'authority' || email.toLowerCase().includes('authority');
  return { ...data, isAuthority };
}

async function sbSignOut() {
  if (!sbClient) return;
  try {
    await sbClient.auth.signOut();
  } catch (err) {
    console.error('Supabase signout error:', err);
  }
}

async function sbResetPassword(email) {
  if (!sbClient) return null;
  const { data, error } = await sbClient.auth.resetPasswordForEmail(email);
  if (error) throw error;
  return data;
}

async function sbGetSession() {
  if (!sbClient) return null;
  try {
    const { data } = await sbClient.auth.getSession();
    return data?.session || null;
  } catch (err) {
    return null;
  }
}

// ----------------------------------------------------------------------------
// RESILIENT OFFLINE SYNC QUEUE (TWO-WAY CONFLICT RESILIENCE)
// ----------------------------------------------------------------------------
const SYNC_QUEUE_KEY = 'sts_pending_sync_queue';

function sbEnqueueSync(action, payload) {
  try {
    const queue = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
    queue.push({
      id: 'SQ-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      action,
      payload,
      queuedAt: new Date().toISOString()
    });
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    console.log(`📥 Queued offline mutation [${action}] (${queue.length} items in queue)`);
  } catch (e) {
    console.warn('Could not enqueue sync action:', e);
  }
}

async function sbProcessSyncQueue() {
  if (!sbClient || !isCloudConnected) return { processed: 0, failed: 0 };
  let queue = [];
  try {
    queue = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
  } catch (e) {
    return { processed: 0, failed: 0 };
  }
  if (!queue.length) return { processed: 0, failed: 0 };

  console.log(`🔄 Flushing offline sync queue (${queue.length} actions pending)...`);
  const remaining = [];
  let processed = 0;

  for (const item of queue) {
    try {
      if (item.action === 'upsertTourist') {
        await sbUpsertTourist(item.payload, false);
      } else if (item.action === 'upsertIncident') {
        await sbUpsertIncident(item.payload, false);
      } else if (item.action === 'upsertZone') {
        await sbUpsertSafetyZone(item.payload, false);
      } else if (item.action === 'deleteZone') {
        await sbDeleteSafetyZone(item.payload, false);
      } else if (item.action === 'aegisLedger') {
        await sbAegisLedgerInsert(item.payload, false);
      } else if (item.action === 'aegisCheckin') {
        await sbAegisCheckinInsert(item.payload, false);
      } else if (item.action === 'aegisTelemetry') {
        await sbAegisTelemetryInsert(item.payload, false);
      } else if (item.action === 'aegisAlert') {
        await sbAegisAlertInsert(item.payload, false);
      } else if (item.action === 'aegisBroadcast') {
        await sbAegisBroadcastInsert(item.payload, false);
      } else if (item.action === 'aegisSubscription') {
        await sbAegisSubscriptionUpsert(item.payload, false);
      }
      processed++;
    } catch (err) {
      console.warn(`⚠️ Failed to replay queue item [${item.action}], retaining in queue:`, err);
      remaining.push(item);
    }
  }

  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(remaining));
  } catch (e) {}

  if (processed > 0) {
    console.log(`✅ Successfully synced ${processed} offline operations to Supabase Cloud.`);
  }
  return { processed, failed: remaining.length };
}

// ----------------------------------------------------------------------------
// CLOUD DATA PERSISTENCE & QUERIES
// ----------------------------------------------------------------------------
async function sbFetchTourists() {
  if (!sbClient) return null;
  const { data, error } = await sbClient
    .from('tourists')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('Supabase fetch tourists error:', error);
    return null;
  }
  return data.map(r => ({
    id: r.tourist_id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    familyContactName: r.emergency_contact_name,
    familyContactPhone: r.emergency_contact,
    blood: r.blood_group,
    allergy: r.allergies,
    identityHash: r.identity_hash,
    zone: r.zone,
    status: r.status,
    lat: r.latitude != null ? Number(r.latitude) : null,
    lng: r.longitude != null ? Number(r.longitude) : null,
    locationSource: r.location_source,
    updatedAt: r.location_updated_at || r.updated_at,
    authUserId: r.auth_user_id
  }));
}

async function sbUpsertTourist(t, enqueue = true) {
  if (!sbClient || !isCloudConnected) {
    if (enqueue) sbEnqueueSync('upsertTourist', t);
    return null;
  }
  const row = {
    tourist_id: t.id,
    name: t.name,
    email: t.email,
    phone: t.phone || '',
    emergency_contact_name: t.familyContactName || '',
    emergency_contact: t.familyContactPhone || '',
    blood_group: t.blood || '',
    allergies: t.allergy || '',
    identity_hash: t.identityHash || '',
    zone: t.zone || 'Outside monitored zones',
    status: t.status || 'Safe',
    latitude: t.lat != null ? Number(t.lat) : null,
    longitude: t.lng != null ? Number(t.lng) : null,
    location_source: t.locationSource || 'gps',
    location_updated_at: t.updatedAt || new Date().toISOString()
  };
  if (t.authUserId) row.auth_user_id = t.authUserId;

  const { data, error } = await sbClient
    .from('tourists')
    .upsert(row, { onConflict: 'tourist_id' })
    .select();
  if (error) {
    console.warn('Supabase upsert tourist error:', error.message || error);
    if (enqueue) sbEnqueueSync('upsertTourist', t);
    return null;
  }
  return data;
}

async function sbFetchSafetyZones() {
  if (!sbClient) return null;
  const { data, error } = await sbClient.from('safety_zones').select('*');
  if (error) {
    console.warn('Supabase fetch zones error:', error);
    return null;
  }
  return data.map(z => ({
    name: z.name,
    type: z.zone_type,
    risk: z.risk_level,
    lat: Number(z.latitude),
    lng: Number(z.longitude),
    radius: Number(z.radius)
  }));
}

async function sbUpsertSafetyZone(z) {
  if (!sbClient) return null;
  const row = {
    name: z.name,
    zone_type: z.type,
    risk_level: z.risk,
    latitude: Number(z.lat),
    longitude: Number(z.lng),
    radius: Math.round(Number(z.radius))
  };
  const { data, error } = await sbClient.from('safety_zones').upsert(row, { onConflict: 'name' }).select();
  if (error) {
    console.warn('Supabase upsert zone error:', error.message || error);
    return null;
  }
  return data;
}

async function sbDeleteSafetyZone(name) {
  if (!sbClient) return null;
  const { data, error } = await sbClient.from('safety_zones').delete().eq('name', name);
  if (error) {
    console.warn('Supabase delete zone error:', error.message || error);
    return null;
  }
  return data;
}

async function sbFetchIncidents() {
  if (!sbClient) return null;
  const { data, error } = await sbClient
    .from('incidents')
    .select('*')
    .order('occurred_at', { ascending: false });
  if (error) {
    console.warn('Supabase fetch incidents error:', error);
    return null;
  }
  return data.map(i => ({
    id: i.id,
    tourist: i.tourist_name,
    touristId: i.tourist_id,
    type: i.type,
    severity: i.severity,
    status: i.status,
    zone: i.zone,
    lat: i.latitude != null ? Number(i.latitude) : null,
    lng: i.longitude != null ? Number(i.longitude) : null,
    accuracy: i.accuracy != null ? Number(i.accuracy) : null,
    auditRef: i.audit_ref,
    source: i.source,
    assignedTo: i.assigned_to,
    time: i.occurred_at ? new Date(i.occurred_at).toLocaleString('en-IN') : 'Just now'
  }));
}

async function sbUpsertIncident(i, enqueue = true) {
  if (!sbClient || !isCloudConnected) {
    if (enqueue) sbEnqueueSync('upsertIncident', i);
    return null;
  }
  const row = {
    id: i.id,
    tourist_id: i.touristId || '',
    tourist_name: i.tourist || '',
    type: i.type,
    severity: i.severity || 'HIGH',
    status: i.status || 'New',
    zone: i.zone || '',
    latitude: i.lat != null ? Number(i.lat) : null,
    longitude: i.lng != null ? Number(i.lng) : null,
    accuracy: i.accuracy != null ? Number(i.accuracy) : null,
    audit_ref: i.auditRef || '',
    source: i.source || 'manual',
    assigned_to: i.assignedTo || null
  };
  const { data, error } = await sbClient
    .from('incidents')
    .upsert(row, { onConflict: 'id' })
    .select();
  if (error) {
    console.warn('Supabase upsert incident error:', error.message || error);
    if (enqueue) sbEnqueueSync('upsertIncident', i);
    return null;
  }
  return data;
}

// ----------------------------------------------------------------------------
// REALTIME SUBSCRIPTIONS (LIVE DISPATCH & MULTI-DEVICE SYNC)
// ----------------------------------------------------------------------------
let realtimeChannel = null;

function setupSupabaseRealtime(onIncidentChange, onTouristChange, onZoneChange) {
  if (!sbClient) return;
  if (realtimeChannel) {
    try { sbClient.removeChannel(realtimeChannel); } catch(e) {}
  }

  realtimeChannel = sbClient
    .channel('public-safety-stream')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, payload => {
      console.log('📡 Realtime incident update:', payload);
      if (typeof onIncidentChange === 'function') onIncidentChange(payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tourists' }, payload => {
      console.log('📡 Realtime tourist location/status update:', payload);
      if (typeof onTouristChange === 'function') onTouristChange(payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'safety_zones' }, payload => {
      console.log('📡 Realtime zone update:', payload);
      if (typeof onZoneChange === 'function') onZoneChange(payload);
    })
    .subscribe(status => {
      console.log('📡 Supabase Realtime Stream Status:', status);
    });
}

// ----------------------------------------------------------------------------
// 1-CLICK ZONE STATUS TOGGLE (NEW FEATURE)
// ----------------------------------------------------------------------------
async function updateAreaStatus(areaName, newStatus) {
  if (!sbClient) {
    alert("Cloud database not connected. Cannot save status.");
    return false;
  }
  
  // Format the status string exactly how the database schema expects it ('Safe', 'Restricted')
  const formattedStatus = newStatus.charAt(0).toUpperCase() + newStatus.slice(1).toLowerCase();
  
  // Automatically adjust the risk level based on the status
  const autoRiskLevel = formattedStatus === 'Safe' ? 'Low' : 'High';

  try {
    const { data, error } = await sbClient
      .from('safety_zones')
      .update({ 
        zone_type: formattedStatus,
        risk_level: autoRiskLevel
      }) 
      .eq('name', areaName);

    if (error) throw error;
    
    console.log(`✅ Successfully updated ${areaName} to ${formattedStatus}`);
    return true;
  } catch (error) {
    console.error("Error saving status update to Supabase:", error.message);
    alert("Failed to save changes to the database. Check your console.");
    return false;
  }
}
// ----------------------------------------------------------------------------
// AEGIS COMMAND-CENTER PERSISTENCE (MIGRATION V3 — optional, fail-soft)
// Each helper writes to the Aegis tables when the project has run
// migration_v3.sql. Missing tables / offline states are queued locally and
// replayed by sbProcessSyncQueue(); nothing here can break the existing app.
// ----------------------------------------------------------------------------
const AEGIS_QUEUE_CAP = 160;

function sbAegisQueue(action, payload) {
  try {
    const q = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
    if (q.length >= AEGIS_QUEUE_CAP) return;
  } catch (e) {}
  sbEnqueueSync(action, payload);
}

async function sbAegisLedgerInsert(entry, enqueue = true) {
  if (!sbClient || !isCloudConnected) {
    if (enqueue) sbAegisQueue('aegisLedger', entry);
    return null;
  }
  const row = {
    tourist_id: entry.subjectId || entry.touristId || (entry.payload && entry.payload.touristId) || null,
    seq: entry.seq,
    entry_type: entry.type,
    title: entry.title,
    payload: entry.payload || {},
    prev_hash: entry.prev,
    entry_hash: entry.hash,
    occurred_at: entry.ts
  };
  try {
    const { data, error } = await sbClient.from('aegis_ledger').insert(row).select();
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('aegis_ledger write skipped (run migration_v3.sql):', err && err.message);
    if (enqueue) sbAegisQueue('aegisLedger', entry);
    return null;
  }
}

async function sbAegisCheckinInsert(row, enqueue = true) {
  if (!sbClient || !isCloudConnected) {
    if (enqueue) sbAegisQueue('aegisCheckin', row);
    return null;
  }
  try {
    const { data, error } = await sbClient.from('safety_checkins').insert(row).select();
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('safety_checkins write skipped:', err && err.message);
    if (enqueue) sbAegisQueue('aegisCheckin', row);
    return null;
  }
}

async function sbAegisTelemetryInsert(points, enqueue = true) {
  const list = Array.isArray(points) ? points.slice(0, 25) : [points];
  if (!sbClient || !isCloudConnected) {
    if (enqueue) sbAegisQueue('aegisTelemetry', list);
    return null;
  }
  const rows = list.map(p => ({
    tourist_id: p.touristId || p.id || null,
    latitude: Number(p.lat),
    longitude: Number(p.lng),
    accuracy: p.accuracy != null ? Number(p.accuracy) : null,
    risk_score: p.risk != null ? Math.round(Number(p.risk)) : null,
    zone: p.zone || null,
    recorded_at: p.ts || new Date().toISOString()
  })).filter(r => r.tourist_id && isFinite(r.latitude) && isFinite(r.longitude));
  if (!rows.length) return null;
  try {
    const { data, error } = await sbClient.from('telemetry_breadcrumbs').insert(rows).select();
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('telemetry_breadcrumbs write skipped:', err && err.message);
    if (enqueue) sbAegisQueue('aegisTelemetry', list);
    return null;
  }
}

async function sbAegisAlertInsert(alert, enqueue = true) {
  if (!sbClient || !isCloudConnected) {
    if (enqueue) sbAegisQueue('aegisAlert', alert);
    return null;
  }
  const row = {
    id: alert.id,
    title: alert.title,
    category: alert.type || 'scam',
    description: alert.desc || '',
    latitude: alert.lat,
    longitude: alert.lng,
    upvotes: alert.upvotes || 0,
    verified: !!alert.verified,
    reported_by: alert.by || 'community',
    status: alert.verified ? 'approved' : 'pending'
  };
  try {
    const { data, error } = await sbClient.from('community_alerts').upsert(row, { onConflict: 'id' }).select();
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('community_alerts write skipped:', err && err.message);
    if (enqueue) sbAegisQueue('aegisAlert', alert);
    return null;
  }
}

async function sbAegisBroadcastInsert(record, enqueue = true) {
  if (!sbClient || !isCloudConnected) {
    if (enqueue) sbAegisQueue('aegisBroadcast', record);
    return null;
  }
  try {
    const { data, error } = await sbClient.from('broadcasts').insert({
      id: record.id,
      audience: record.audience,
      severity: record.severity || 'info',
      message: record.message,
      recipients: record.recipients || 0,
      sent_by: record.by || 'commander',
      sent_at: record.sentAt || new Date().toISOString()
    }).select();
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('broadcasts write skipped:', err && err.message);
    if (enqueue) sbAegisQueue('aegisBroadcast', record);
    return null;
  }
}

async function sbAegisSubscriptionUpsert(sub, enqueue = true) {
  if (!sbClient || !isCloudConnected) {
    if (enqueue) sbAegisQueue('aegisSubscription', sub);
    return null;
  }
  const tourist = (typeof aegisSubject === 'function' && aegisSubject()) || {};
  try {
    const { data, error } = await sbClient.from('subscriptions').insert({
      tourist_id: tourist.id || null,
      plan: sub.plan,
      billing_cycle: sub.cycle,
      price: sub.price,
      card_last4: sub.last4 || null,
      seats: sub.seats || 1,
      status: sub.status || 'active',
      activated_at: sub.activatedAt,
      renews_at: sub.renewsAt
    }).select();
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('subscriptions write skipped:', err && err.message);
    if (enqueue) sbAegisQueue('aegisSubscription', sub);
    return null;
  }
}

// Best-effort mirror of Aegis telemetry into the existing tourists row.
async function sbAegisTouristExtras(t) {
  if (!sbClient || !isCloudConnected || !t || !t.id) return null;
  try {
    const { data, error } = await sbClient.from('tourists').update({
      battery_level: AEG && AEG.battery ? AEG.battery.level : null,
      network_status: (typeof aegisNetworkType === 'function') ? aegisNetworkType() : (S && S.net) || null,
      plan_tier: AEG ? AEG.tier : 'free',
      last_checkin_at: AEG && AEG.pulse && AEG.pulse.lastCheckin ? AEG.pulse.lastCheckin : null,
      pulse_deadline: AEG && AEG.pulse && AEG.pulse.deadline ? new Date(AEG.pulse.deadline).toISOString() : null,
      stealth_mode: !!(AEG && AEG.stealth && AEG.stealth.on)
    }).eq('tourist_id', t.id).select();
    if (error) throw error;
    return data;
  } catch (err) {
    // Column may not exist until migration_v3.sql is applied — never fatal.
    return null;
  }
}

async function sbAegisFetchAlerts() {
  if (!sbClient) return null;
  try {
    const { data, error } = await sbClient
      .from('community_alerts')
      .select('*')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) throw error;
    return (data || []).map(a => ({
      id: a.id,
      title: a.title,
      desc: a.description || '',
      type: a.category,
      lat: Number(a.latitude),
      lng: Number(a.longitude),
      upvotes: a.upvotes || 0,
      verified: !!a.verified,
      by: a.reported_by || 'community',
      ts: a.created_at
    }));
  } catch (err) {
    console.warn('community_alerts read skipped:', err && err.message);
    return null;
  }
}

async function sbAegisFetchLedger(limit = 40) {
  if (!sbClient) return null;
  try {
    const { data, error } = await sbClient
      .from('aegis_ledger')
      .select('*')
      .order('seq', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(e => ({
      seq: e.seq,
      type: e.entry_type,
      title: e.title,
      payload: e.payload || {},
      prev: e.prev_hash,
      hash: e.entry_hash,
      ts: e.occurred_at
    }));
  } catch (err) {
    console.warn('aegis_ledger read skipped:', err && err.message);
    return null;
  }
}
