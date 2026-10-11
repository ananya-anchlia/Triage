// Queue simulation and wait ranges. Pure functions, no DOM, no network.
// Loaded as a plain <script> in the browser (exposes `Sim`) and via node:vm in tests.
//
// Everything here is a SIMULATION under invented parameters. The method is real; the numbers are not
// measurements of any real facility. Constants below are fixed once, with the reason beside each.
// Do not tune them to make Triage look better. Only data/demo-state.json may be adjusted for the demo.

const Sim = (() => {
  // ---- Fixed constants ------------------------------------------------------------------------

  // Minor-injury arrivals per hour, per facility, Saturday afternoon (PLAN.md "Simulation starting values").
  // Reason: ERs see the most walk-ins; ortho and kids' clinics are smaller, narrower practices.
  const MINOR_ARRIVALS_PER_HOUR = { er: 9, urgent: 5, ortho: 3, peds: 4 };

  // Emergency arrivals per hour. Only ERs receive them; they always jump the line (never interrupt treatment).
  const EMERGENCY_ARRIVALS_PER_HOUR = { er: 3, urgent: 0, ortho: 0, peds: 0 };

  // Mean treatment time in minutes, drawn exponential per patient.
  // Reason: PLAN.md starting values; exponential is the simple, memoryless choice.
  const MEAN_TREATMENT_MIN = { er: 75, urgent: 40, ortho: 35, peds: 35 };
  const MEAN_EMERGENCY_TREATMENT_MIN = 120;

  // Arrival-rate multiplier by hour of day (Saturday). 1.0 = the Saturday-afternoon rates above.
  // Reason: walk-in demand is lowest overnight, builds through the day, and peaks in the evening after
  // primary-care offices close. The shape is an assumption chosen once, not fitted to data.
  const HOURLY_MULTIPLIER = [
    0.3, 0.3, 0.3, 0.3, 0.3, 0.3, // 00-05
    0.5, 0.5, 0.5, // 06-08
    0.8, 0.8, 0.8, // 09-11
    1.0, 1.0, 1.0, 1.0, 1.0, // 12-16
    1.3, 1.3, 1.3, 1.3, // 17-20
    0.7, 0.7, 0.7, // 21-23
  ];

  const HORIZON_MIN = 180; // simulate 3 hours of arrivals forward (CLAUDE.md)
  const RUNS = 200; // runs per wait range (CLAUDE.md)
  // After the 3-hour window no new arrivals are generated; the run continues only until the person we are
  // estimating starts treatment. Later arrivals could only matter via emergencies jumping the line.
  // If they still have not started after this many extra minutes the result is flagged censored.
  const MAX_EXTRA_MIN = 600;
  const ROUND_TO_MIN = 5;
  const LOW_PCT = 0.25;
  const HIGH_PCT = 0.75;
  const DEFAULT_SEED = 20260610;

  // Drive time: straight-line km x 1.3 road factor at 40 km/h. Always labeled "approx."
  const ROAD_FACTOR = 1.3;
  const DRIVE_KMH = 40;

  const CONSTANTS = Object.freeze({
    MINOR_ARRIVALS_PER_HOUR, EMERGENCY_ARRIVALS_PER_HOUR, MEAN_TREATMENT_MIN,
    MEAN_EMERGENCY_TREATMENT_MIN, HOURLY_MULTIPLIER, HORIZON_MIN, RUNS, MAX_EXTRA_MIN,
    ROUND_TO_MIN, LOW_PCT, HIGH_PCT, DEFAULT_SEED, ROAD_FACTOR, DRIVE_KMH,
  });

  // ---- Random numbers (seeded, so demo mode repeats exactly) ------------------------------------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Mix several integers into one seed. Every (run, facility, purpose) gets its own stream, which is what
  // makes arrivals identical across scenarios (common random numbers): routing never shifts the stream.
  function subSeed(...ints) {
    let h = 0x811c9dc5;
    for (const n of ints) {
      h = Math.imul(h ^ (n >>> 0), 0x01000193);
      h ^= h >>> 15;
      h = Math.imul(h, 0x2c1b3c6d);
    }
    return h >>> 0;
  }

  function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
    return h;
  }

  const exponential = (rng, mean) => -mean * Math.log(1 - rng());

  function poisson(rng, lambda) {
    if (lambda <= 0) return 0;
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng();
    } while (p > limit);
    return k - 1;
  }

  // ---- Facility helpers -------------------------------------------------------------------------

  function parseHours(hours) {
    const [open, close] = hours.split("-").map((s) => {
      const [h, m] = s.split(":").map(Number);
      return h * 60 + m;
    });
    return { open, close };
  }

  // minuteOfDay in [0, 1440). Hours are same-day windows ("00:00-24:00" is always open).
  function isOpen(facility, minuteOfDay) {
    const { open, close } = parseHours(facility.hours);
    return minuteOfDay >= open && minuteOfDay < close;
  }

  const rateMultiplier = (minuteOfDay) => HOURLY_MULTIPLIER[Math.floor(minuteOfDay / 60) % 24];

  function distanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // Approx drive minutes (not rounded here; the UI labels it "approx.").
  function driveMinutes(from, facility) {
    const km = distanceKm(from.lat, from.lng, facility.lat, facility.lng) * ROAD_FACTOR;
    return (km / DRIVE_KMH) * 60;
  }

  // ---- State ------------------------------------------------------------------------------------
  // state = {
  //   nowMin: minute of day "now" is (e.g. 960 = 4 PM),
  //   facilities: { [id]: { waiting: n, inTreatment: n } },  // tracked separately
  //   picks: [{ facilityId, arriveAt }]                      // arriveAt = minutes from now
  // }

  function makeState(nowMin, facilityCounts) {
    return { nowMin, facilities: facilityCounts, picks: [] };
  }

  // A pick adds a simulated patient to that facility's line at arrival time (now + drive).
  // Returns a new state; a recommendation alone never calls this.
  function addPick(state, facilityId, arriveAt) {
    return { ...state, picks: [...state.picks, { facilityId, arriveAt }] };
  }

  // ---- One facility, one run --------------------------------------------------------------------

  // Arrivals for one facility in one run. Depends only on (seed, run, facility, clock), never on routing.
  function makeArrivals(facility, nowMin, seed, run) {
    const rng = mulberry32(subSeed(seed, run, hashString(facility.id), 1));
    const minorBase = MINOR_ARRIVALS_PER_HOUR[facility.type] / 60;
    const emergencyBase = EMERGENCY_ARRIVALS_PER_HOUR[facility.type] / 60;
    const out = [];
    for (let t = 0; t < HORIZON_MIN; t++) {
      const clock = (nowMin + t) % 1440;
      if (!isOpen(facility, clock)) continue;
      const m = rateMultiplier(clock);
      for (let i = poisson(rng, minorBase * m); i > 0; i--) {
        out.push({ t, emergency: false, treat: exponential(rng, MEAN_TREATMENT_MIN[facility.type]) });
      }
      for (let i = poisson(rng, emergencyBase * m); i > 0; i--) {
        out.push({ t, emergency: true, treat: exponential(rng, MEAN_EMERGENCY_TREATMENT_MIN) });
      }
    }
    return out;
  }

  // Minutes the person arriving at `arriveAt` waits before treatment starts, in one run.
  // Patients in treatment are tracked apart from those waiting; emergencies go first in line but never
  // interrupt anyone already in treatment.
  function runWait(facility, state, arriveAt, seed, run) {
    const counts = state.facilities[facility.id] || { waiting: 0, inTreatment: 0 };
    const mean = MEAN_TREATMENT_MIN[facility.type];
    const startRng = mulberry32(subSeed(seed, run, hashString(facility.id), 2));

    // Exponential times are memoryless, so someone already in treatment has a fresh exponential remaining.
    const busy = [];
    for (let i = 0; i < Math.min(counts.inTreatment, facility.slots); i++) {
      busy.push(exponential(startRng, mean));
    }
    let waiting = [];
    for (let i = 0; i < counts.waiting; i++) {
      waiting.push({ emergency: false, treat: exponential(startRng, mean), probe: false });
    }

    // Everyone who joins later, in arrival order. The probe sorts after others arriving the same minute.
    const pickRng = mulberry32(subSeed(seed, run, hashString(facility.id), 3));
    const joiners = makeArrivals(facility, state.nowMin, seed, run).map((a) => ({ ...a, probe: false }));
    for (const p of state.picks) {
      const treat = exponential(pickRng, mean); // drawn for every pick so the stream is stable
      if (p.facilityId === facility.id && p.arriveAt < HORIZON_MIN) {
        joiners.push({ t: p.arriveAt, emergency: false, treat, probe: false });
      }
    }
    joiners.sort((a, b) => a.t - b.t);
    const probe = { t: arriveAt, emergency: false, treat: mean, probe: true };
    let at = 0;
    while (at < joiners.length && joiners[at].t <= arriveAt) at++;
    joiners.splice(at, 0, probe);

    const end = HORIZON_MIN + MAX_EXTRA_MIN;
    let next = 0;
    for (let t = 0; t < end; t++) {
      while (next < joiners.length && joiners[next].t <= t) waiting.push(joiners[next++]);
      for (let i = busy.length - 1; i >= 0; i--) if (busy[i] <= t) busy.splice(i, 1);
      while (busy.length < facility.slots && waiting.length > 0) {
        let idx = waiting.findIndex((p) => p.emergency);
        if (idx < 0) idx = 0;
        const [p] = waiting.splice(idx, 1);
        if (p.probe) return { wait: t - arriveAt, censored: false };
        busy.push(t + p.treat);
      }
    }
    return { wait: end - arriveAt, censored: true };
  }

  // ---- Wait ranges ------------------------------------------------------------------------------

  function percentile(sorted, q) {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  const roundTo = (x, step) => Math.round(x / step) * step;

  // Simulated wait range for someone arriving `driveMin` minutes from now. Returns null if the facility
  // is closed at that moment. Label it "simulated wait range" wherever it is shown.
  function estimateWait(facility, state, driveMin, opts = {}) {
    const seed = opts.seed ?? DEFAULT_SEED;
    const runs = opts.runs ?? RUNS;
    const arriveAt = Math.max(0, Math.round(driveMin));
    if (arriveAt >= HORIZON_MIN) return null;
    if (!isOpen(facility, (state.nowMin + arriveAt) % 1440)) return null;

    const waits = [];
    let censored = 0;
    for (let run = 0; run < runs; run++) {
      const r = runWait(facility, state, arriveAt, seed, run);
      waits.push(r.wait);
      if (r.censored) censored++;
    }
    waits.sort((a, b) => a - b);
    const median = percentile(waits, 0.5);
    return {
      low: roundTo(percentile(waits, LOW_PCT), ROUND_TO_MIN),
      high: roundTo(percentile(waits, HIGH_PCT), ROUND_TO_MIN),
      median, // unrounded, used for ranking: total = drive + median wait
      medianRounded: roundTo(median, ROUND_TO_MIN),
      censoredShare: censored / runs,
      runs,
    };
  }

  return {
    CONSTANTS, mulberry32, subSeed, isOpen, distanceKm, driveMinutes,
    makeState, addPick, makeArrivals, runWait, estimateWait,
  };
})();

if (typeof globalThis !== "undefined") globalThis.Sim = Sim;
