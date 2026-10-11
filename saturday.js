// "Busy Saturday": the same afternoon played twice on the simulated network, once with everyone going to
// their nearest ER and once with each person routed by Triage. Pure functions, no DOM, no network.
// Loaded as a plain <script> in the browser (exposes `Saturday`) and via node:vm in tests.
// Needs `Sim` and `Router` loaded first.
//
// Everything here is a SIMULATION on the simulated network. It uses sim.js's constants, arrival generator
// and wait estimate, and router.js's ranking, all unchanged. The settings below were chosen once, before any
// result was looked at (the seed is the one exception, explained beside it), with the reason beside each.
// Do not tune them to make Triage look better.

const Saturday = (() => {
  // ---- Fixed scenario settings ------------------------------------------------------------------

  // The seed shown on screen. It was first 20261011 (the hackathon date), set before any run. The 50-seed
  // check (tests/saturday-seeds.js) then showed that afternoon was lighter than all 50 others, which made
  // Triage's own numbers look better than usual. So it was replaced, once, by the seed among 1..50 whose
  // medium-scenario numbers sit closest to the 50-seed medians: chosen to be typical, not favourable.
  const DEMO_SEED = 17;
  const PEOPLE = 300; // PLAN.md: 300 minor-injury patients
  const START_MIN = 720; // noon
  const WINDOW_MIN = 240; // noon to 4 PM; sim.js's hourly multiplier is 1.0 for all of it

  // Share of each injury type among the 300. Reason: sprains, strains and possible fractures are the most
  // common minor injuries, then cuts, then back strains; burns are a small share. An assumption, not data.
  const INJURY_MIX = [
    ["sprain_or_simple_fracture", 0.4],
    ["cut", 0.3],
    ["back_strain", 0.2],
    ["minor_burn", 0.1],
  ];
  // One in four people with a sprain, cut or burn is a child (age 1-17, any age equally likely); everyone
  // else is an adult aged 18-84. Back strains are adults only. Reason: roughly a quarter of injury visits
  // are children. An assumption, not data. Under 1 is left out: router.js sends infants to the nurse line.
  const CHILD_SHARE = 0.25;
  const CHILD_AGES = [1, 17];
  const ADULT_AGES = [18, 84];
  // Home = one of the 12 facility pins (each equally likely; pins are town centers) plus a random offset
  // with this standard deviation in each direction. Reason: people live around the towns, not on the pins.
  const HOME_SCATTER_KM = 4;

  // Urgent-care capacity scenarios: treatment slots at each of the 4 general urgent cares. Medium is
  // data/facilities.json as it stands. Nothing else differs between scenarios.
  const URGENT_SLOTS = { low: 2, medium: 3, high: 4 };
  const SCENARIOS = Object.keys(URGENT_SLOTS);

  const LONG_WAIT_MIN = 180; // "waited over 3 hours" counts the wait after arriving, not the drive
  const MAX_DAYS = 6; // the run stops with an error if anyone is still waiting after this long
  const TYPES = ["er", "urgent", "ortho", "peds"];

  const SETTINGS = Object.freeze({
    DEMO_SEED, PEOPLE, START_MIN, WINDOW_MIN, INJURY_MIX, CHILD_SHARE, CHILD_AGES, ADULT_AGES,
    HOME_SCATTER_KM, URGENT_SLOTS, LONG_WAIT_MIN,
  });

  const BLOCK_MIN = Sim.CONSTANTS.HORIZON_MIN; // Sim.makeArrivals makes this many minutes at a time
  const KM_PER_DEG = 111.2;

  // ---- The same people for both sides -------------------------------------------------------------

  // Every person has their own random stream, so the people depend only on (seed, their number): never on
  // the capacity scenario or on where anyone was sent. `treatU` is their treatment-time draw; it is turned
  // into minutes using the mean of the facility type that treats them (as sim.js does for a pick).
  function makePeople(facilities, seed, count = PEOPLE) {
    const people = [];
    for (let k = 0; k < count; k++) {
      const rng = Sim.mulberry32(Sim.subSeed(seed, 11, k));
      const appear = START_MIN + Math.floor(rng() * WINDOW_MIN);
      let u = rng();
      let injuryType = INJURY_MIX[INJURY_MIX.length - 1][0];
      for (const [type, share] of INJURY_MIX) {
        if (u < share) { injuryType = type; break; }
        u -= share;
      }
      const childDraw = rng();
      const ageDraw = rng();
      const child = injuryType !== "back_strain" && childDraw < CHILD_SHARE;
      const [lo, hi] = child ? CHILD_AGES : ADULT_AGES;
      const age = lo + Math.floor(ageDraw * (hi - lo + 1));
      const anchor = facilities[Math.floor(rng() * facilities.length)];
      const r = Math.sqrt(-2 * Math.log(1 - rng())) * HOME_SCATTER_KM;
      const angle = 2 * Math.PI * rng();
      const lat = anchor.lat + (r * Math.cos(angle)) / KM_PER_DEG;
      const lng = anchor.lng + (r * Math.sin(angle)) / (KM_PER_DEG * Math.cos((anchor.lat * Math.PI) / 180));
      people.push({ k, appear, injuryType, age, lat, lng, treatU: rng() });
    }
    people.sort((a, b) => a.appear - b.appear || a.k - b.k);
    return people;
  }

  // Background arrivals (minor patients everywhere, emergencies at ERs) straight from Sim.makeArrivals, one
  // 3-hour block at a time from midnight. They depend only on (seed, facility id, clock), so both sides and
  // all three capacity scenarios get exactly the same ones. The seed is mixed first so these streams are
  // not the ones Sim.estimateWait uses for its own what-if runs: the estimate never sees the real future.
  function makeBackground(seed) {
    const bgSeed = Sim.subSeed(seed, 12);
    const cache = {};
    return (facility, block) => {
      const key = `${facility.id}:${block}`;
      if (!cache[key]) cache[key] = Sim.makeArrivals(facility, (block * BLOCK_MIN) % 1440, bgSeed, block);
      return cache[key];
    };
  }

  function applyScenario(facilities, scenario) {
    if (!Object.hasOwn(URGENT_SLOTS, scenario)) throw new Error(`Unknown capacity scenario: ${scenario}`);
    return facilities.map((f) => (f.type === "urgent" ? { ...f, slots: URGENT_SLOTS[scenario] } : f));
  }

  // ---- One afternoon ------------------------------------------------------------------------------
  // Time is minutes from Saturday midnight. Every line starts empty at midnight and fills from background
  // arrivals alone until noon, so the noon lines come from sim.js's own rates, not from a scripted file.
  // Each minute follows Sim.runWait: people arriving join the line, finished treatments free their slot,
  // free slots take the next person (emergencies first; nobody in treatment is interrupted). Lines that are
  // still there at closing time are worked through; a closed place gets no new background arrivals.
  //
  // choose(person, t, world) -> { facility, driveMin } is the only thing that differs between the two sides.
  function makeAfternoon(facilities, people, background, choose) {
    const sites = facilities.map((f) => ({
      f, mean: Sim.CONSTANTS.MEAN_TREATMENT_MIN[f.type],
      busy: [], // end times of the treatments under way
      waiting: [], // the line, in arrival order
      pending: [], // people who have picked this place and are still driving, by arrival time
      block: -1, bg: [], bgAt: 0,
    }));
    const siteOf = Object.fromEntries(sites.map((s) => [s.f.id, s]));
    const windowEnd = START_MIN + WINDOW_MIN;
    const trips = []; // one per person, in the order they were assigned
    const others = []; // background non-emergency patients who arrived between noon and 4 PM
    const seen = {}; // background arrivals admitted between noon and 4 PM, per facility (for the tests)
    for (const s of sites) seen[s.f.id] = { minor: 0, emergency: 0, treatSum: 0 };
    let open = 0; // tracked patients who have not started treatment yet
    let next = 0;
    let t = 0;

    function admit(s) {
      for (;;) {
        if (s.bgAt >= s.bg.length) {
          if ((s.block + 1) * BLOCK_MIN > t) break;
          s.block++;
          s.bg = background(s.f, s.block);
          s.bgAt = 0;
          continue;
        }
        const a = s.bg[s.bgAt];
        const at = s.block * BLOCK_MIN + a.t;
        if (at > t) break;
        s.bgAt++;
        const p = { emergency: a.emergency, treat: a.treat, arrive: at, start: null, tracked: false };
        if (at >= START_MIN && at < windowEnd) {
          const c = seen[s.f.id];
          c[a.emergency ? "emergency" : "minor"]++;
          c.treatSum += a.treat;
          if (!a.emergency) {
            p.tracked = true;
            p.type = s.f.type;
            others.push(p);
            open++;
          }
        }
        s.waiting.push(p);
      }
      while (s.pending.length && s.pending[0].arrive <= t) s.waiting.push(s.pending.shift());
    }

    function stepSite(s) {
      admit(s);
      for (let i = s.busy.length - 1; i >= 0; i--) if (s.busy[i] <= t) s.busy.splice(i, 1);
      while (s.busy.length < s.f.slots && s.waiting.length > 0) {
        let idx = s.waiting.findIndex((p) => p.emergency);
        if (idx < 0) idx = 0;
        const [p] = s.waiting.splice(idx, 1);
        p.start = t;
        if (p.tracked) open--;
        s.busy.push(t + p.treat);
      }
    }

    // The lines as the app would see them at minute t: who is waiting, who is in treatment, and who has
    // already picked a place and is on the way (Sim.addPick). Nothing about later arrivals.
    function stateNow() {
      const counts = {};
      for (const s of sites) {
        counts[s.f.id] = { waiting: s.waiting.length, inTreatment: s.busy.filter((end) => end > t).length };
      }
      let state = Sim.makeState(t % 1440, counts);
      for (const s of sites) for (const p of s.pending) state = Sim.addPick(state, s.f.id, p.arrive - t);
      return state;
    }

    function assign(person) {
      const pick = choose(person, t, world);
      const s = siteOf[pick.facility.id];
      const drive = Math.max(0, Math.round(pick.driveMin)); // same rounding as a "Go here" pick in app.js
      const trip = {
        person, facilityId: s.f.id, type: s.f.type, drive, arrive: t + drive, start: null,
        emergency: false, treat: -s.mean * Math.log(1 - person.treatU), tracked: true,
      };
      let at = s.pending.length;
      while (at > 0 && s.pending[at - 1].arrive > trip.arrive) at--;
      s.pending.splice(at, 0, trip);
      trips.push(trip);
      open++;
    }

    // Moves the afternoon on until `maxAssignments` more people have been assigned, or to the end.
    // Returns true when everyone tracked has started treatment.
    function advance(maxAssignments = Infinity) {
      let budget = maxAssignments;
      for (;;) {
        while (next < people.length && people[next].appear === t) {
          if (budget <= 0) return false;
          assign(people[next++]);
          budget--;
        }
        for (const s of sites) stepSite(s);
        if (t >= windowEnd && next >= people.length && open === 0) return true;
        t++;
        if (t > MAX_DAYS * 1440) throw new Error("Busy Saturday: lines never cleared");
      }
    }

    const world = { facilities, stateNow, advance, trips, others, seen, assigned: () => next };
    return world;
  }

  // ---- The two sides ------------------------------------------------------------------------------

  // Baseline: everyone goes to their nearest ER (router.js's own nearest-ER rule).
  function chooseNearestER(person, t, world) {
    return Router.nearestER(world.facilities, person, t);
  }

  // Triage: the first place in router.js's real ranking, worked out from the lines at that minute.
  function chooseTriage(person, t, world) {
    const ranked = Router.rank({
      injuryType: person.injuryType, age: person.age, user: person,
      state: world.stateNow(), facilities: world.facilities,
    });
    return ranked.length ? ranked[0] : chooseNearestER(person, t, world);
  }

  // ---- Report -------------------------------------------------------------------------------------

  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  function percentile(xs, q) {
    if (!xs.length) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // All times in minutes. "wait" = arriving at the facility until treatment starts.
  // "time to treatment" = drive + wait, for the 300 people.
  function summarize(world) {
    const { trips, others } = world;
    const totals = trips.map((x) => x.start - x.person.appear);
    const byType = Object.fromEntries(TYPES.map((type) => [type, 0]));
    const byFacility = Object.fromEntries(world.facilities.map((f) => [f.id, 0]));
    for (const x of trips) { byType[x.type]++; byFacility[x.facilityId]++; }
    const facilityOf = Object.fromEntries(world.facilities.map((f) => [f.id, f]));
    const erWaits = [...trips, ...others].filter((p) => p.type === "er").map((p) => p.start - p.arrive);
    const clinicOthers = others.filter((p) => p.type !== "er").map((p) => p.start - p.arrive);
    return {
      // Everyone who is not an emergency at an ER: the 300 who went to one, plus the ER's other minor
      // patients who arrived between noon and 4 PM. Emergencies go first, so they are left out.
      avgErWait: mean(erWaits),
      erPatients: erWaits.length,
      avgTimeToTreatment: mean(totals),
      medianTimeToTreatment: percentile(totals, 0.5),
      p90TimeToTreatment: percentile(totals, 0.9),
      over3h: trips.filter((x) => x.start - x.arrive > LONG_WAIT_MIN).length,
      // Of the 300: treatment started when the place had already closed. sim.js keeps working through a
      // line after closing time, in the app's wait estimate and here alike, so this is counted, not hidden.
      afterClosing: trips.filter((x) => !Sim.isOpen(facilityOf[x.facilityId], x.start % 1440)).length,
      byType,
      byFacility,
      // Not the 300: everyone else who walked into an urgent care, ortho or kids' clinic between noon and
      // 4 PM. Sending people to those places makes their lines longer, so this is reported too.
      avgOtherClinicWait: mean(clinicOthers),
      otherClinicPatients: clinicOthers.length,
      background: world.seen,
      trips: trips.map((x) => ({
        k: x.person.k, facilityId: x.facilityId, drive: x.drive, arrive: x.arrive, wait: x.start - x.arrive,
      })),
    };
  }

  // Starts one comparison. The baseline side is worked out straight away (it needs no wait estimates).
  // The Triage side is advanced a few people at a time with step(), so a page can show progress.
  function start({ facilities, seed = DEMO_SEED, scenario = "medium", people: count = PEOPLE }) {
    const network = applyScenario(facilities, scenario);
    const people = makePeople(facilities, seed, count);
    const background = makeBackground(seed);
    const baselineWorld = makeAfternoon(network, people, background, chooseNearestER);
    baselineWorld.advance();
    const baseline = summarize(baselineWorld);
    const triageWorld = makeAfternoon(network, people, background, chooseTriage);
    let done = false;
    return {
      total: people.length,
      assigned: () => triageWorld.assigned(),
      step(maxAssignments) {
        if (!done) done = triageWorld.advance(maxAssignments);
        return done;
      },
      result() {
        if (!done) throw new Error("Busy Saturday: the afternoon has not finished");
        return { seed, scenario, urgentSlots: URGENT_SLOTS[scenario], people, baseline, triage: summarize(triageWorld) };
      },
    };
  }

  function compare(options) {
    const run = start(options);
    run.step(Infinity);
    return run.result();
  }

  return {
    SETTINGS, SCENARIOS, makePeople, makeBackground, applyScenario, makeAfternoon, start, compare,
    chooseNearestER, chooseTriage, summarize, // used by about-sim.js, so the About page reuses these unchanged
  };
})();

if (typeof globalThis !== "undefined") globalThis.Saturday = Saturday;
