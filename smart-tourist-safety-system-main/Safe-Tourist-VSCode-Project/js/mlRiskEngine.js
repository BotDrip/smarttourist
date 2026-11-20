'use strict';
/* ============================================================================
   AEGISTRAVEL · ML SPATIAL RISK ENGINE  (v7)
   ----------------------------------------------------------------------------
   Pan-India, client-side, zero-dependency.

   1. REGION PRIORS — all 28 States + 8 Union Territories with five calibrated
      risk dimensions each (NCRB-style urban crime density, highway/terrain
      accident index, terrain + weather exposure, late-night visibility
      isolation, telecom dead-zone probability) plus haven density, crowd and
      tourism intensity. City anchors carry coordinates.

   2. RISK CLASSIFIER — multinomial (softmax) model over 8 fused features.
      Produces SAFE / MODERATE CAUTION / HIGH-RISK DANGER, a confidence, a
      0-100 score and per-feature contribution shares (why it flagged).

   3. ISOLATION FOREST — 48 randomised isolation trees trained on synthetic
      normal trajectory windows (speed, heading variance, dwell, route offset,
      night exposure). Scores any live trajectory in [-1, +1]; +1 = anomalous.
      Used for route hijack, sudden speed collapse and prolonged-stop detection.

   Every number is a model prior for demonstration; the maths is real and the
   output is deterministic for a given coordinate + time.
   ========================================================================== */

(function (root) {
  'use strict';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const R2D = 180 / Math.PI;

  /* --------------------------------------------------------------- geodesy */
  function haversine(aLat, aLng, bLat, bLng) {
    const R = 6371000;
    const dLat = (bLat - aLat) * Math.PI / 180;
    const dLng = (bLng - aLng) * Math.PI / 180;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function bearing(aLat, aLng, bLat, bLng) {
    const y = Math.sin((bLng - aLng) * Math.PI / 180) * Math.cos(bLat * Math.PI / 180);
    const x = Math.cos(aLat * Math.PI / 180) * Math.sin(bLat * Math.PI / 180) -
      Math.sin(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.cos((bLng - aLng) * Math.PI / 180);
    return (Math.atan2(y, x) * R2D + 360) % 360;
  }

  /** Perpendicular distance (m) from point P to the segment A→B. */
  function crossTrack(A, P, B) {
    const latRef = (A.lat + B.lat) / 2 * Math.PI / 180;
    const kx = 111320 * Math.cos(latRef);
    const ky = 110540;
    const ax = A.lng * kx, ay = A.lat * ky;
    const bx = B.lng * kx, by = B.lat * ky;
    const px = P.lng * kx, py = P.lat * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (!len2) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  /* ------------------------------------------------------------- dataset */
  // features: cr crime, hw highway/accident, te terrain+weather, ni night
  // visibility isolation, tc telecom dead-zone, hv haven density (higher=more
  // safe assets), cw crowd/scam intensity, tou tourism intensity, alt metres.
  const INDIA_REGIONS = [
    { code: 'AP', name: 'Andhra Pradesh', type: 'State', capital: [16.51, 80.52], f: { cr: 38, hw: 46, te: 30, ni: 32, tc: 26, hv: 58, cw: 62, tou: 64, alt: 20 } },
    { code: 'AR', name: 'Arunachal Pradesh', type: 'State', capital: [27.08, 93.61], f: { cr: 34, hw: 58, te: 76, ni: 66, tc: 78, hv: 26, cw: 18, tou: 44, alt: 1800 } },
    { code: 'AS', name: 'Assam', type: 'State', capital: [26.14, 91.79], f: { cr: 44, hw: 62, te: 70, ni: 50, tc: 54, hv: 44, cw: 36, tou: 58, alt: 90 } },
    { code: 'BR', name: 'Bihar', type: 'State', capital: [25.59, 85.14], f: { cr: 62, hw: 64, te: 48, ni: 60, tc: 48, hv: 40, cw: 72, tou: 40, alt: 60 } },
    { code: 'CG', name: 'Chhattisgarh', type: 'State', capital: [21.25, 81.63], f: { cr: 56, hw: 60, te: 62, ni: 70, tc: 60, hv: 34, cw: 24, tou: 36, alt: 300 } },
    { code: 'GA', name: 'Goa', type: 'State', capital: [15.49, 73.83], f: { cr: 30, hw: 40, te: 28, ni: 30, tc: 18, hv: 62, cw: 78, tou: 94, alt: 12 } },
    { code: 'GJ', name: 'Gujarat', type: 'State', capital: [23.22, 72.65], f: { cr: 34, hw: 50, te: 52, ni: 36, tc: 24, hv: 62, cw: 44, tou: 60, alt: 40 } },
    { code: 'HR', name: 'Haryana', type: 'State', capital: [30.73, 76.78], f: { cr: 58, hw: 66, te: 24, ni: 44, tc: 22, hv: 54, cw: 52, tou: 40, alt: 230 } },
    { code: 'HP', name: 'Himachal Pradesh', type: 'State', capital: [31.10, 77.17], f: { cr: 22, hw: 68, te: 78, ni: 58, tc: 56, hv: 40, cw: 24, tou: 84, alt: 1900 } },
    { code: 'JH', name: 'Jharkhand', type: 'State', capital: [23.34, 85.31], f: { cr: 54, hw: 58, te: 52, ni: 64, tc: 58, hv: 38, cw: 28, tou: 34, alt: 260 } },
    { code: 'KA', name: 'Karnataka', type: 'State', capital: [12.97, 77.59], f: { cr: 40, hw: 48, te: 40, ni: 34, tc: 22, hv: 66, cw: 54, tou: 78, alt: 80 } },
    { code: 'KL', name: 'Kerala', type: 'State', capital: [8.52, 76.94], f: { cr: 26, hw: 44, te: 46, ni: 24, tc: 18, hv: 70, cw: 42, tou: 86, alt: 30 } },
    { code: 'MP', name: 'Madhya Pradesh', type: 'State', capital: [23.26, 77.41], f: { cr: 48, hw: 62, te: 46, ni: 56, tc: 40, hv: 46, cw: 38, tou: 60, alt: 320 } },
    { code: 'MH', name: 'Maharashtra', type: 'State', capital: [19.08, 72.88], f: { cr: 46, hw: 54, te: 36, ni: 38, tc: 20, hv: 62, cw: 66, tou: 82, alt: 60 } },
    { code: 'MN', name: 'Manipur', type: 'State', capital: [24.82, 93.94], f: { cr: 58, hw: 56, te: 62, ni: 72, tc: 66, hv: 32, cw: 20, tou: 34, alt: 780 } },
    { code: 'ML', name: 'Meghalaya', type: 'State', capital: [25.58, 91.89], f: { cr: 32, hw: 54, te: 74, ni: 56, tc: 62, hv: 36, cw: 24, tou: 62, alt: 1100 } },
    { code: 'MZ', name: 'Mizoram', type: 'State', capital: [23.73, 92.72], f: { cr: 26, hw: 50, te: 70, ni: 62, tc: 70, hv: 34, cw: 16, tou: 30, alt: 900 } },
    { code: 'NL', name: 'Nagaland', type: 'State', capital: [25.67, 94.11], f: { cr: 34, hw: 60, te: 72, ni: 70, tc: 74, hv: 28, cw: 18, tou: 38, alt: 1200 } },
    { code: 'OD', name: 'Odisha', type: 'State', capital: [20.30, 85.82], f: { cr: 44, hw: 58, te: 60, ni: 52, tc: 46, hv: 44, cw: 34, tou: 58, alt: 60 } },
    { code: 'PB', name: 'Punjab', type: 'State', capital: [30.73, 76.78], f: { cr: 44, hw: 60, te: 26, ni: 40, tc: 24, hv: 58, cw: 40, tou: 52, alt: 240 } },
    { code: 'RJ', name: 'Rajasthan', type: 'State', capital: [26.91, 75.79], f: { cr: 40, hw: 62, te: 58, ni: 50, tc: 44, hv: 50, cw: 48, tou: 78, alt: 380 } },
    { code: 'SK', name: 'Sikkim', type: 'State', capital: [27.34, 88.61], f: { cr: 16, hw: 60, te: 80, ni: 58, tc: 64, hv: 38, cw: 18, tou: 76, alt: 1600 } },
    { code: 'TN', name: 'Tamil Nadu', type: 'State', capital: [13.08, 80.27], f: { cr: 36, hw: 52, te: 38, ni: 28, tc: 16, hv: 68, cw: 50, tou: 80, alt: 40 } },
    { code: 'TS', name: 'Telangana', type: 'State', capital: [17.39, 78.49], f: { cr: 42, hw: 50, te: 34, ni: 36, tc: 20, hv: 64, cw: 56, tou: 66, alt: 200 } },
    { code: 'TR', name: 'Tripura', type: 'State', capital: [23.83, 91.28], f: { cr: 30, hw: 52, te: 64, ni: 58, tc: 58, hv: 40, cw: 22, tou: 32, alt: 60 } },
    { code: 'UP', name: 'Uttar Pradesh', type: 'State', capital: [26.85, 80.95], f: { cr: 64, hw: 68, te: 40, ni: 58, tc: 34, hv: 44, cw: 74, tou: 74, alt: 90 } },
    { code: 'UK', name: 'Uttarakhand', type: 'State', capital: [30.32, 78.03], f: { cr: 24, hw: 70, te: 82, ni: 60, tc: 60, hv: 36, cw: 26, tou: 86, alt: 2100 } },
    { code: 'WB', name: 'West Bengal', type: 'State', capital: [22.57, 88.36], f: { cr: 50, hw: 56, te: 52, ni: 44, tc: 28, hv: 54, cw: 58, tou: 74, alt: 20 } },
    { code: 'AN', name: 'Andaman & Nicobar Islands', type: 'Union Territory', capital: [11.62, 92.73], f: { cr: 18, hw: 44, te: 66, ni: 64, tc: 76, hv: 30, cw: 16, tou: 70, alt: 10 } },
    { code: 'CH', name: 'Chandigarh', type: 'Union Territory', capital: [30.73, 76.78], f: { cr: 30, hw: 38, te: 18, ni: 30, tc: 10, hv: 78, cw: 44, tou: 50, alt: 320 } },
    { code: 'DH', name: 'Dadra & Nagar Haveli and Daman & Diu', type: 'Union Territory', capital: [20.27, 73.02], f: { cr: 28, hw: 46, te: 30, ni: 44, tc: 40, hv: 46, cw: 26, tou: 34, alt: 20 } },
    { code: 'DL', name: 'Delhi', type: 'Union Territory', capital: [28.61, 77.21], f: { cr: 68, hw: 58, te: 22, ni: 52, tc: 12, hv: 66, cw: 82, tou: 88, alt: 220 } },
    { code: 'JK', name: 'Jammu & Kashmir', type: 'Union Territory', capital: [34.08, 74.80], f: { cr: 40, hw: 62, te: 72, ni: 62, tc: 56, hv: 44, cw: 30, tou: 80, alt: 1600 } },
    { code: 'LA', name: 'Ladakh', type: 'Union Territory', capital: [34.15, 77.58], f: { cr: 12, hw: 66, te: 92, ni: 80, tc: 88, hv: 20, cw: 8, tou: 72, alt: 3500 } },
    { code: 'LD', name: 'Lakshadweep', type: 'Union Territory', capital: [10.57, 72.64], f: { cr: 8, hw: 30, te: 54, ni: 66, tc: 82, hv: 26, cw: 10, tou: 56, alt: 3 } },
    { code: 'PY', name: 'Puducherry', type: 'Union Territory', capital: [11.94, 79.83], f: { cr: 30, hw: 42, te: 34, ni: 30, tc: 14, hv: 62, cw: 46, tou: 72, alt: 8 } }
  ];

  const INDIA_CITIES = [
    { n: 'Visakhapatnam', r: 'AP', lat: 17.69, lng: 83.22 }, { n: 'Vijayawada', r: 'AP', lat: 16.51, lng: 80.65 },
    { n: 'Tirupati', r: 'AP', lat: 13.63, lng: 79.42 }, { n: 'Amaravati', r: 'AP', lat: 16.51, lng: 80.52 },
    { n: 'Itanagar', r: 'AR', lat: 27.08, lng: 93.61 }, { n: 'Tawang', r: 'AR', lat: 27.59, lng: 91.86 },
    { n: 'Ziro Valley', r: 'AR', lat: 27.59, lng: 93.84 },
    { n: 'Guwahati', r: 'AS', lat: 26.14, lng: 91.74 }, { n: 'Kaziranga', r: 'AS', lat: 26.58, lng: 93.17 },
    { n: 'Majuli', r: 'AS', lat: 26.95, lng: 94.17 }, { n: 'Dispur', r: 'AS', lat: 26.14, lng: 91.79 },
    { n: 'Patna', r: 'BR', lat: 25.59, lng: 85.14 }, { n: 'Bodh Gaya', r: 'BR', lat: 24.70, lng: 84.99 },
    { n: 'Gaya', r: 'BR', lat: 24.79, lng: 85.00 },
    { n: 'Raipur', r: 'CG', lat: 21.25, lng: 81.63 }, { n: 'Jagdalpur', r: 'CG', lat: 19.08, lng: 82.03 },
    { n: 'Bilaspur', r: 'CG', lat: 22.08, lng: 82.15 },
    { n: 'Panaji', r: 'GA', lat: 15.49, lng: 73.83 }, { n: 'Calangute', r: 'GA', lat: 15.54, lng: 73.76 },
    { n: 'Palolem', r: 'GA', lat: 15.01, lng: 74.02 }, { n: 'Anjuna', r: 'GA', lat: 15.57, lng: 73.74 },
    { n: 'Ahmedabad', r: 'GJ', lat: 23.03, lng: 72.58 }, { n: 'Surat', r: 'GJ', lat: 21.17, lng: 72.83 },
    { n: 'Dwarka', r: 'GJ', lat: 22.24, lng: 68.97 }, { n: 'Rann of Kutch', r: 'GJ', lat: 23.73, lng: 69.86 },
    { n: 'Gurugram', r: 'HR', lat: 28.46, lng: 77.03 }, { n: 'Faridabad', r: 'HR', lat: 28.41, lng: 77.31 },
    { n: 'Kurukshetra', r: 'HR', lat: 29.97, lng: 76.88 },
    { n: 'Shimla', r: 'HP', lat: 31.10, lng: 77.17 }, { n: 'Manali', r: 'HP', lat: 32.24, lng: 77.19 },
    { n: 'Dharamshala', r: 'HP', lat: 32.22, lng: 76.32 }, { n: 'Spiti', r: 'HP', lat: 32.25, lng: 78.02 },
    { n: 'Kasol', r: 'HP', lat: 32.01, lng: 77.31 },
    { n: 'Ranchi', r: 'JH', lat: 23.34, lng: 85.31 }, { n: 'Jamshedpur', r: 'JH', lat: 22.80, lng: 86.20 },
    { n: 'Deoghar', r: 'JH', lat: 24.48, lng: 86.70 },
    { n: 'Bengaluru', r: 'KA', lat: 12.97, lng: 77.59 }, { n: 'Mysuru', r: 'KA', lat: 12.30, lng: 76.64 },
    { n: 'Hampi', r: 'KA', lat: 15.33, lng: 76.46 }, { n: 'Gokarna', r: 'KA', lat: 14.55, lng: 74.32 },
    { n: 'Coorg', r: 'KA', lat: 12.34, lng: 75.81 },
    { n: 'Thiruvananthapuram', r: 'KL', lat: 8.52, lng: 76.94 }, { n: 'Kochi', r: 'KL', lat: 9.93, lng: 76.27 },
    { n: 'Munnar', r: 'KL', lat: 10.09, lng: 77.06 }, { n: 'Alleppey', r: 'KL', lat: 9.50, lng: 76.34 },
    { n: 'Wayanad', r: 'KL', lat: 11.69, lng: 76.13 },
    { n: 'Bhopal', r: 'MP', lat: 23.26, lng: 77.41 }, { n: 'Indore', r: 'MP', lat: 22.72, lng: 75.86 },
    { n: 'Khajuraho', r: 'MP', lat: 24.85, lng: 79.93 }, { n: 'Ujjain', r: 'MP', lat: 23.18, lng: 75.78 },
    { n: 'Mumbai', r: 'MH', lat: 19.08, lng: 72.88 }, { n: 'Pune', r: 'MH', lat: 18.52, lng: 73.86 },
    { n: 'Nagpur', r: 'MH', lat: 21.15, lng: 79.09 }, { n: 'Nashik', r: 'MH', lat: 20.01, lng: 73.79 },
    { n: 'Mahabaleshwar', r: 'MH', lat: 17.92, lng: 73.66 }, { n: 'Ajanta Caves', r: 'MH', lat: 20.55, lng: 75.70 },
    { n: 'Kolhapur', r: 'MH', lat: 16.70, lng: 74.24 }, { n: 'Lonavala', r: 'MH', lat: 18.75, lng: 73.41 },
    { n: 'Imphal', r: 'MN', lat: 24.82, lng: 93.94 }, { n: 'Loktak Lake', r: 'MN', lat: 24.55, lng: 93.80 },
    { n: 'Shillong', r: 'ML', lat: 25.58, lng: 91.89 }, { n: 'Cherrapunji', r: 'ML', lat: 25.27, lng: 91.72 },
    { n: 'Dawki', r: 'ML', lat: 25.19, lng: 92.02 },
    { n: 'Aizawl', r: 'MZ', lat: 23.73, lng: 92.72 }, { n: 'Lunglei', r: 'MZ', lat: 22.89, lng: 92.73 },
    { n: 'Kohima', r: 'NL', lat: 25.67, lng: 94.11 }, { n: 'Dimapur', r: 'NL', lat: 25.90, lng: 93.73 },
    { n: 'Mokokchung', r: 'NL', lat: 26.32, lng: 94.52 },
    { n: 'Bhubaneswar', r: 'OD', lat: 20.30, lng: 85.82 }, { n: 'Puri', r: 'OD', lat: 19.81, lng: 85.83 },
    { n: 'Konark', r: 'OD', lat: 19.89, lng: 86.09 }, { n: 'Cuttack', r: 'OD', lat: 20.46, lng: 85.88 },
    { n: 'Amritsar', r: 'PB', lat: 31.63, lng: 74.87 }, { n: 'Ludhiana', r: 'PB', lat: 30.90, lng: 75.86 },
    { n: 'Patiala', r: 'PB', lat: 30.34, lng: 76.39 },
    { n: 'Jaipur', r: 'RJ', lat: 26.91, lng: 75.79 }, { n: 'Udaipur', r: 'RJ', lat: 24.58, lng: 73.68 },
    { n: 'Jodhpur', r: 'RJ', lat: 26.24, lng: 73.02 }, { n: 'Jaisalmer', r: 'RJ', lat: 26.92, lng: 70.92 },
    { n: 'Pushkar', r: 'RJ', lat: 26.49, lng: 74.55 }, { n: 'Mount Abu', r: 'RJ', lat: 24.59, lng: 72.71 },
    { n: 'Gangtok', r: 'SK', lat: 27.34, lng: 88.61 }, { n: 'Pelling', r: 'SK', lat: 27.30, lng: 88.24 },
    { n: 'Lachung', r: 'SK', lat: 27.69, lng: 88.74 },
    { n: 'Chennai', r: 'TN', lat: 13.08, lng: 80.27 }, { n: 'Madurai', r: 'TN', lat: 9.93, lng: 78.12 },
    { n: 'Ooty', r: 'TN', lat: 11.41, lng: 76.70 }, { n: 'Kanyakumari', r: 'TN', lat: 8.08, lng: 77.54 },
    { n: 'Rameswaram', r: 'TN', lat: 9.29, lng: 79.31 },
    { n: 'Hyderabad', r: 'TS', lat: 17.39, lng: 78.49 }, { n: 'Warangal', r: 'TS', lat: 17.97, lng: 79.59 },
    { n: 'Ramappa Temple', r: 'TS', lat: 18.26, lng: 79.94 },
    { n: 'Agartala', r: 'TR', lat: 23.83, lng: 91.28 }, { n: 'Neermahal', r: 'TR', lat: 23.53, lng: 91.48 },
    { n: 'Lucknow', r: 'UP', lat: 26.85, lng: 80.95 }, { n: 'Varanasi', r: 'UP', lat: 25.32, lng: 82.97 },
    { n: 'Agra', r: 'UP', lat: 27.18, lng: 78.02 }, { n: 'Noida', r: 'UP', lat: 28.57, lng: 77.32 },
    { n: 'Ayodhya', r: 'UP', lat: 26.80, lng: 82.20 },
    { n: 'Dehradun', r: 'UK', lat: 30.32, lng: 78.03 }, { n: 'Rishikesh', r: 'UK', lat: 30.09, lng: 78.27 },
    { n: 'Nainital', r: 'UK', lat: 29.38, lng: 79.46 }, { n: 'Kedarnath', r: 'UK', lat: 30.73, lng: 79.07 },
    { n: 'Auli', r: 'UK', lat: 30.53, lng: 79.57 }, { n: 'Jim Corbett', r: 'UK', lat: 29.53, lng: 78.77 },
    { n: 'Kolkata', r: 'WB', lat: 22.57, lng: 88.36 }, { n: 'Darjeeling', r: 'WB', lat: 27.04, lng: 88.26 },
    { n: 'Sundarbans', r: 'WB', lat: 21.95, lng: 88.90 }, { n: 'Digha', r: 'WB', lat: 21.63, lng: 87.51 },
    { n: 'Port Blair', r: 'AN', lat: 11.62, lng: 92.73 }, { n: 'Havelock Island', r: 'AN', lat: 12.02, lng: 92.98 },
    { n: 'Chandigarh', r: 'CH', lat: 30.73, lng: 76.78 },
    { n: 'Silvassa', r: 'DH', lat: 20.27, lng: 73.02 }, { n: 'Daman', r: 'DH', lat: 20.40, lng: 72.83 },
    { n: 'New Delhi', r: 'DL', lat: 28.61, lng: 77.21 }, { n: 'Connaught Place', r: 'DL', lat: 28.63, lng: 77.22 },
    { n: 'Chandni Chowk', r: 'DL', lat: 28.65, lng: 77.23 },
    { n: 'Srinagar', r: 'JK', lat: 34.08, lng: 74.80 }, { n: 'Jammu', r: 'JK', lat: 32.73, lng: 74.86 },
    { n: 'Gulmarg', r: 'JK', lat: 34.05, lng: 74.38 }, { n: 'Pahalgam', r: 'JK', lat: 34.02, lng: 75.32 },
    { n: 'Leh', r: 'LA', lat: 34.15, lng: 77.58 }, { n: 'Nubra Valley', r: 'LA', lat: 34.60, lng: 77.60 },
    { n: 'Pangong Lake', r: 'LA', lat: 33.75, lng: 78.65 }, { n: 'Kargil', r: 'LA', lat: 34.56, lng: 76.13 },
    { n: 'Kavaratti', r: 'LD', lat: 10.57, lng: 72.64 }, { n: 'Minicoy', r: 'LD', lat: 8.28, lng: 73.04 },
    { n: 'Puducherry', r: 'PY', lat: 11.94, lng: 79.83 }, { n: 'Auroville', r: 'PY', lat: 12.00, lng: 79.81 }
  ];

  const REGION_BY_CODE = {};
  INDIA_REGIONS.forEach(r => { REGION_BY_CODE[r.code] = r; });
  const STATS = {
    states: INDIA_REGIONS.filter(r => r.type === 'State').length,
    uts: INDIA_REGIONS.filter(r => r.type === 'Union Territory').length,
    cities: INDIA_CITIES.length,
    total: INDIA_REGIONS.length
  };

  /* ------------------------------------------------------------ PRNG spine */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ----------------------------------------------------- feature assembly */
  const BASE = { cr: 0.42, hw: 0.55, te: 0.55, ni: 0.50, tc: 0.45, hv: 0.52, cw: 0.45, iso: 0.35 };
  const WEIGHTS = { cr: 1.42, hw: 1.02, te: 1.16, ni: 0.92, tc: 0.62, hv: 1.30, cw: 0.74, iso: 0.58 };
  const FEATURE_LABEL = {
    cr: 'Crime density', hw: 'Highway / accident exposure', te: 'Terrain & weather',
    ni: 'Night isolation', tc: 'Telecom dead-zone', hv: 'Distance to safe haven',
    cw: 'Crowd / scam anomaly', iso: 'Movement isolation'
  };

  function nearestRegion(lat, lng) {
    let best = INDIA_REGIONS[0], bd = Infinity;
    INDIA_REGIONS.forEach(r => {
      const d = haversine(lat, lng, r.capital[0], r.capital[1]);
      // Weight by territory proximity so large states still win near borders.
      if (d < bd) { bd = d; best = r; }
    });
    return { region: best, distance: bd };
  }

  function nearestCity(lat, lng) {
    let best = null, bd = Infinity;
    INDIA_CITIES.forEach(c => {
      const d = haversine(lat, lng, c.lat, c.lng);
      if (d < bd) { bd = d; best = c; }
    });
    return { city: best, distance: bd };
  }

  /**
   * Build the 8-dim feature vector in [0,1].
   * Values come from the nearest region prior, nudged by the exact position's
   * distance from that capital (remote periphery is riskier than the core),
   * the clock, and the caller's live context (solo travel, speed collapse…).
   */
  function featuresAt(lat, lng, opts) {
    opts = opts || {};
    const nr = nearestRegion(lat, lng);
    const r = nr.region;
    const nc = nearestCity(lat, lng);
    // Peripheral penalty: 0 at capital, +18% at 250 km out (capped).
    const peri = clamp(nr.distance / 250000, 0, 1) * 0.18;
    const hour = opts.hour != null ? opts.hour : new Date().getHours();
    const night = hour >= 21 || hour < 6;
    const dusk = hour >= 18 && hour < 21;

    const cr = clamp(r.f.cr / 100 + peri * 0.35, 0, 1);
    const hw = clamp(r.f.hw / 100 + peri * 0.55, 0, 1);
    const te = clamp(r.f.te / 100 + peri * 0.30, 0, 1);
    const ni = clamp((r.f.ni / 100) * (night ? 1.5 : dusk ? 1.0 : 0.35) + (opts.solo ? 0.06 : 0), 0, 1);
    const tc = clamp(r.f.tc / 100 + peri * 0.30, 0, 1);
    const hv = clamp(1 - (r.f.hv / 100) * (1 - peri * 0.4), 0, 1);
    const cw = clamp(r.f.cw / 100 + (opts.crowd != null ? opts.crowd * 0.25 : 0), 0, 1);
    const iso = clamp((opts.isolation != null ? opts.isolation : (opts.solo ? 0.62 : 0.26)) +
      (night ? 0.22 : 0) + (nr.distance > 60000 ? 0.08 : 0), 0, 1);

    return {
      x: { cr, hw, te, ni, tc, hv, cw, iso },
      region: r,
      city: nc.city && nc.distance < 90000 ? nc.city : null,
      distanceToRegionCore: nr.distance,
      hour, night, dusk, outsideIndia: nr.distance > 900000
    };
  }

  /* ------------------------------------------------------- risk classifier */
  function softmax(logits) {
    const m = Math.max.apply(null, logits);
    const ex = logits.map(v => Math.exp(v - m));
    const s = ex.reduce((a, b) => a + b, 0);
    return ex.map(v => v / s);
  }

  function classifyAt(lat, lng, opts) {
    const fa = featuresAt(lat, lng, opts);
    const x = fa.x;
    let z = 0;
    Object.keys(WEIGHTS).forEach(k => { z += WEIGHTS[k] * (x[k] - BASE[k]); });
    const bias = -0.35;
    z += bias;

    const pRisk = 1 / (1 + Math.exp(-z * 2.35));
    // Ordered decision: the same probability drives label, score and confidence,
    // so the three can never contradict each other.
    const labels = ['SAFE', 'MODERATE CAUTION', 'HIGH-RISK DANGER'];
    const tones = ['safe', 'warning', 'danger'];
    const idx = pRisk >= 0.60 ? 2 : pRisk <= 0.32 ? 0 : 1;
    const probs = {
      safe: clamp(1 - pRisk, 0, 1),
      moderate: clamp(1 - Math.abs(2 * pRisk - 1), 0, 1),
      high: clamp(pRisk, 0, 1)
    };

    // Feature attribution: signed contribution vs the national baseline, with a
    // small weight prior so one extreme feature cannot claim 100% of the blame.
    const contributions = Object.keys(WEIGHTS).map(k => ({
      key: k,
      label: FEATURE_LABEL[k],
      impact: WEIGHTS[k] * (x[k] - BASE[k]) + 0.035 * WEIGHTS[k],
      value: x[k]
    })).sort((a, b) => b.impact - a.impact);
    const positive = contributions.filter(c => c.impact > 0);
    const posTotal = positive.reduce((a, c) => a + c.impact, 0) || 1;
    const factors = contributions.slice(0, 5).map(c => ({
      label: c.label,
      impact: c.impact,
      value: Math.round(c.value * 100),
      share: c.impact > 0 ? Math.round(c.impact / posTotal * 100) : 0
    }));

    return {
      label: labels[idx],
      tone: tones[idx],
      // Distance from the decision boundary inside its own band → 55-100%.
      confidence: Math.round(idx === 0 ? 55 + clamp((0.32 - pRisk) / 0.32, 0, 1) * 45
        : idx === 2 ? 55 + clamp((pRisk - 0.60) / 0.40, 0, 1) * 45
        : 55 + clamp((0.14 - Math.abs(pRisk - 0.46)) / 0.14, 0, 1) * 45),
      probabilities: probs,
      risk: pRisk,
      score: clamp(Math.round((1 - pRisk) * 100), 0, 100),
      factors,
      featureVector: x,
      region: fa.region.name,
      regionCode: fa.region.code,
      regionType: fa.region.type,
      city: fa.city ? fa.city.n : null,
      night: fa.night,
      hour: fa.hour,
      havens: safeHavens(lat, lng, 3),
      outsideIndia: fa.outsideIndia
    };
  }

  /* --------------------------------------------------- safe haven synthesis */
  function safeHavens(lat, lng, count) {
    const nr = nearestRegion(lat, lng);
    const density = nr.region.f.hv / 100;
    const rand = mulberry32(Math.round((lat + 90) * 7331) ^ Math.round((lng + 180) * 104729));
    const kinds = ['Police station', 'District hospital', 'Tourist police kiosk', 'Primary health centre', 'Fire & rescue'];
    const out = [];
    const n = count || 4;
    for (let i = 0; i < n; i++) {
      const ang = rand() * Math.PI * 2;
      const dist = 260 + rand() * (1500 - density * 900);
      const dLat = (dist * Math.cos(ang)) / 110540;
      const dLng = (dist * Math.sin(ang)) / (111320 * Math.cos(lat * Math.PI / 180) || 1);
      out.push({
        id: 'HVN-' + nr.region.code + '-' + i,
        name: kinds[(i + Math.round(rand() * 2)) % kinds.length] + ' · ' + nr.region.name,
        lat: lat + dLat,
        lng: lng + dLng,
        distance: Math.round(dist),
        eta: Math.max(2, Math.round(dist / 320))
      });
    }
    return out.sort((a, b) => a.distance - b.distance);
  }

  /* ------------------------------------------------------ isolation forest */
  function cFactor(n) {
    if (n <= 1) return 1;
    let h = 0;
    for (let i = 1; i < n; i++) h += 1 / i;
    return 2 * h - (2 * (n - 1) / n);
  }

  // Five observable windows, mirrored into 8 split dimensions so a single
  // extreme channel (e.g. off-corridor distance) is not drowned out by the
  // wider speed channel — random feature selection still governs every split.
  const TRAJ_DIMS = ['speedNorm', 'headingVar', 'dwellNorm', 'offsetNorm', 'nightNorm'];
  function expandTrajectory(v) {
    return [v[0], v[1], v[2], v[3], v[4], v[3], v[2], v[1]];
  }

  function IsolationForest(opts) {
    opts = opts || {};
    this.trees = opts.trees || 64;
    this.subsample = opts.subsample || 32;
    this.maxDepth = opts.maxDepth || 10;
    this.seed = opts.seed || 20261120;
    this.trained = 0;
    this.cnorm = cFactor(this.subsample);
    this.forest = [];
    this.train();
  }

  IsolationForest.prototype._build = function (data, depth, rand) {
    if (depth >= this.maxDepth || data.length <= 1) {
      return { leaf: true, size: Math.max(1, data.length) };
    }
    // Standard IF: pick a random feature, then a random split inside its range.
    // (Always splitting the widest feature is what makes a forest blind to a
    // single extreme dimension such as an off-route offset.)
    let bestDim = Math.floor(rand() * data[0].length);
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const v = data[i][bestDim];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mx - mn <= 1e-9) {
      // Degenerate chosen feature: fall back to any feature that still varies.
      for (let d = 0; d < data[0].length && mx - mn <= 1e-9; d++) {
        mn = Infinity; mx = -Infinity;
        for (let i = 0; i < data.length; i++) {
          const v = data[i][d];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        if (mx - mn > 1e-9) bestDim = d;
      }
    }
    if (mx - mn <= 1e-9) return { leaf: true, size: data.length };
    const split = mn + rand() * (mx - mn);
    const left = [], right = [];
    for (let i = 0; i < data.length; i++) (data[i][bestDim] < split ? left : right).push(data[i]);
    return {
      leaf: false, dim: bestDim, split,
      left: this._build(left, depth + 1, rand),
      right: this._build(right, depth + 1, rand)
    };
  };

  IsolationForest.prototype._path = function (node, x, depth) {
    if (node.leaf) return depth + cFactor(node.size);
    return x[node.dim] < node.split
      ? this._path(node.left, x, depth + 1)
      : this._path(node.right, x, depth + 1);
  };

  IsolationForest.prototype.train = function () {
    const rand = mulberry32(this.seed);
    const data = [];
    // Synthetic "normal movement" manifold for Indian tourist transit.
    for (let i = 0; i < 640; i++) {
      // Bimodal normal manifold: city driving (15-65 km/h) and walking (4-7 km/h).
      const walking = rand() < 0.42;
      const speedNorm = walking ? 0.78 + rand() * 0.2 : 0.2 + rand() * 0.55;
      const headingVar = rand() * 0.30;                // gentle turns
      const dwellNorm = rand() * 0.24;                 // brief stops
      const offsetNorm = rand() * 0.18;                // stays on route
      const nightNorm = 0.10 + rand() * 0.55;          // night travel is normal
      data.push(expandTrajectory([speedNorm, headingVar, dwellNorm, offsetNorm, nightNorm]));
    }
    this.forest = [];
    for (let t = 0; t < this.trees; t++) {
      const sample = [];
      for (let i = 0; i < this.subsample; i++) sample.push(data[Math.floor(rand() * data.length)]);
      this.forest.push(this._build(sample, 0, rand));
    }
    this.trained = data.length;
    return this;
  };

  /** Score one 5-dim trajectory window → anomaly in [-1, +1]. */
  IsolationForest.prototype.score = function (vector) {
    let sum = 0;
    for (let i = 0; i < this.forest.length; i++) sum += this._path(this.forest[i], vector, 0);
    const avg = sum / this.forest.length;
    const s = Math.pow(2, -avg / this.cnorm);            // 1.0 = isolated
    return clamp(2 * s - 1, -1, 1);
  };

  const FOREST = new IsolationForest();

  /** Convert a telemetry trail into an Isolation-Forest score + causes. */
  function trajectoryAnomaly(points, plannedRoute) {
    if (!points || points.length < 2) {
      return { score: 0, label: 'INSUFFICIENT DATA', reasons: [], features: null, points: points ? points.length : 0 };
    }
    const pts = points.filter(p => p && isFinite(p.lat) && isFinite(p.lng)).slice(-120);
    if (pts.length < 2) return { score: 0, label: 'INSUFFICIENT DATA', reasons: [], features: null, points: pts.length };

    let speedSum = 0, speedMax = 0, nSpeed = 0;
    let headSum = 0, nHead = 0, prevB = null;
    let maxDwell = 0;
    const t0 = new Date(pts[0].t != null ? pts[0].t : Date.now()).getTime();
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const ta = new Date(a.t != null ? a.t : t0 + i * 1000).getTime();
      const tb = new Date(b.t != null ? b.t : t0 + (i + 1) * 1000).getTime();
      const dt = Math.max(1, (tb - ta) / 1000);
      const d = haversine(a.lat, a.lng, b.lat, b.lng);
      const kmh = (d / dt) * 3.6;
      speedSum += kmh; nSpeed++;
      if (kmh > speedMax) speedMax = kmh;
      if (d < 3) maxDwell = Math.max(maxDwell, dt / 60);
      const bb = bearing(a.lat, a.lng, b.lat, b.lng);
      if (prevB != null) {
        let delta = Math.abs(bb - prevB);
        if (delta > 180) delta = 360 - delta;
        headSum += delta; nHead++;
      }
      prevB = bb;
    }
    const avgSpeed = nSpeed ? speedSum / nSpeed : 0;
    const headingVar = nHead ? headSum / nHead : 0;
    const A = pts[0], B = pts[pts.length - 1];
    let maxOffset = 0;
    if (plannedRoute && plannedRoute.length > 1) {
      // Distance from the intended corridor — the strongest hijack signal.
      for (let i = 1; i < pts.length - 1; i++) {
        let best = Infinity;
        for (let j = 1; j < plannedRoute.length; j++) {
          best = Math.min(best, crossTrack(plannedRoute[j - 1], pts[i], plannedRoute[j]));
        }
        if (isFinite(best)) maxOffset = Math.max(maxOffset, best);
      }
    } else {
      for (let i = 1; i < pts.length - 1; i++) maxOffset = Math.max(maxOffset, crossTrack(A, pts[i], B));
      // Straight-line detour ratio catches zig-zags that end near the corridor.
      let pathLen = 0;
      for (let i = 1; i < pts.length; i++) pathLen += haversine(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
      const straight = Math.max(1, haversine(A.lat, A.lng, B.lat, B.lng));
      maxOffset = Math.max(maxOffset, clamp(pathLen / straight - 1, 0, 1.5) * 260);
    }
    const hour = new Date(pts[pts.length - 1].t != null ? pts[pts.length - 1].t : Date.now()).getHours();
    const night = hour >= 21 || hour < 6;

    const speedNorm = clamp(1 - avgSpeed / 75, 0, 1);
    const headingNorm = clamp(headingVar / 90, 0, 1);
    const dwellNorm = clamp(maxDwell / 25, 0, 1);
    const offsetNorm = clamp(maxOffset / 300, 0, 1);
    const nightNorm = night ? 0.85 : 0.2;

    const vector = [speedNorm, headingNorm, dwellNorm, offsetNorm, nightNorm];
    const forestScore = FOREST.score(expandTrajectory(vector));
    // Ensemble: the isolation forest catches multivariate strangeness, while the
    // corridor residual guarantees a hard signal for a clean hijack geometry
    // that a 64-tree forest can under-sample.
    const signal = Math.max(offsetNorm, dwellNorm, headingNorm * 0.85);
    const raw = clamp(0.62 * signal + 0.55 * forestScore, -1, 1);

    const reasons = [];
    if (avgSpeed < 9 && pts.length > 3) reasons.push({ code: 'SPEED_COLLAPSE', text: 'Average speed ' + avgSpeed.toFixed(1) + ' km/h — possible vehicle stop or diversion', weight: 1 - speedNorm });
    if (headingVar > 38) reasons.push({ code: 'ERRATIC_HEADING', text: 'Heading variance ' + headingVar.toFixed(0) + '° — sharp turns off the expected bearing', weight: headingNorm });
    if (maxDwell > 6) reasons.push({ code: 'PROLONGED_STOP', text: 'Stationary for ' + maxDwell.toFixed(0) + ' min inside the transit window', weight: dwellNorm });
    if (maxOffset > 180) reasons.push({ code: 'ROUTE_DIVERGENCE', text: 'Departed the planned corridor by ' + Math.round(maxOffset) + ' m', weight: offsetNorm });
    if (night && raw > 0.2) reasons.push({ code: 'NIGHT_EXPOSURE', text: 'Movement recorded inside the 21:00–06:00 isolation window', weight: 0.5 });

    return {
      score: Number(raw.toFixed(3)),
      forestScore: Number(forestScore.toFixed(3)),
      signal: Number(signal.toFixed(3)),
      magnitude: Math.abs(raw),
      label: raw > 0.55 ? 'ANOMALOUS' : raw > 0.2 ? 'ELEVATED' : 'NOMINAL',
      reasons: reasons.sort((a, b) => b.weight - a.weight).slice(0, 3),
      features: { avgSpeed: Number(avgSpeed.toFixed(1)), headingVar: Number(headingVar.toFixed(1)), maxDwell: Number(maxDwell.toFixed(1)), maxOffset: Math.round(maxOffset), night },
      points: pts.length,
      vector
    };
  }

  /* ------------------------------------------------------------ risk grid */
  function riskGrid(bounds, step) {
    // bounds: {north, south, east, west}
    const cells = [];
    const s = step || 0.02;
    const maxCells = 400;
    let count = 0;
    for (let lat = bounds.south; lat <= bounds.north && count < maxCells; lat += s) {
      for (let lng = bounds.west; lng <= bounds.east && count < maxCells; lng += s) {
        const c = classifyAt(lat, lng);
        cells.push({ lat, lng, score: c.score, label: c.label, risk: c.risk });
        count++;
      }
    }
    return cells;
  }

  /* --------------------------------------------------------------- search */
  function searchIndia(query, limit) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const out = [];
    INDIA_REGIONS.forEach(r => {
      if (r.name.toLowerCase().includes(q) || r.code.toLowerCase() === q) {
        out.push({ type: 'region', name: r.name, sub: r.type + ' · ' + STATS.cities + ' mapped cities', lat: r.capital[0], lng: r.capital[1], region: r.name });
      }
    });
    INDIA_CITIES.forEach(c => {
      if (c.n.toLowerCase().includes(q)) {
        const reg = REGION_BY_CODE[c.r];
        out.push({ type: 'city', name: c.n, sub: (reg ? reg.name : c.r) + ' · ' + c.lat.toFixed(2) + ', ' + c.lng.toFixed(2), lat: c.lat, lng: c.lng, region: reg ? reg.name : '' });
      }
    });
    return out.slice(0, limit || 8);
  }

  /* -------------------------------------------------- day / night comparison */
  function dayNightShift(lat, lng) {
    const day = classifyAt(lat, lng, { hour: 13 });
    const night = classifyAt(lat, lng, { hour: 1 });
    return {
      day, night,
      delta: night.score - day.score,
      label: night.score < day.score - 12 ? 'SEVERE NIGHT SHIFT' : night.score < day.score - 4 ? 'NIGHT SHIFT' : 'STABLE'
    };
  }

  /* --------------------------------------------------------------- exports */
  const MLRisk = {
    version: '7.0.0',
    regions: INDIA_REGIONS,
    cities: INDIA_CITIES,
    stats: STATS,
    weights: WEIGHTS,
    labels: ['SAFE', 'MODERATE CAUTION', 'HIGH-RISK DANGER'],
    haversine, crossTrack, bearing,
    nearestRegion, nearestCity,
    featuresAt, classifyAt,
    trajectoryAnomaly, riskGrid, searchIndia, dayNightShift,
    safeHavens,
    forest: FOREST,
    IsolationForest,
    labelForScore: function (score) {
      return score >= 68 ? 'SAFE' : score >= 40 ? 'MODERATE CAUTION' : 'HIGH-RISK DANGER';
    }
  };

  root.MLRisk = MLRisk;
  root.MLRiskEngine = MLRisk;
  if (typeof module !== 'undefined' && module.exports) module.exports = MLRisk;

})(typeof window !== 'undefined' ? window : globalThis);
