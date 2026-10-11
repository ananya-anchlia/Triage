// The experiments behind the About page's charts. Pure functions, no DOM, no network.
// Loaded as a plain <script> in the browser (exposes `AboutSim`) and via node:vm in tests.
// Needs `Sim`, `Router` and `Saturday` loaded first.
//
// Everything here is a SIMULATION on the simulated network. Nothing is re-implemented: the wait runs are
// Sim.runWait, the afternoons are Saturday.makeAfternoon with Saturday's own people, background arrivals,
// choosers and summary. The only new parts are who uses Triage (adoption) and a deliberately naive router
// (herding). The settings below were written down before any result was looked at.
// Do not tune them to make Triage look better.

const AboutSim = (() => {
  // ---- Fixed settings -----------------------------------------------------------------------------

  // Share of the 300 people who use Triage; everyone else goes to their nearest ER. From PLAN.md.
  const ADOPTION_SHARES = [0, 0.1, 0.25, 0.5, 1];
  // The interval drawn around each point: the middle 80% of the simulated Saturdays.
  const INTERVAL = [0.1, 0.9];
  // Wait-range chart: one point every this many minutes over sim.js's 3-hour window.
  const BAND_STEP_MIN = 15;
  const BAND_QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9];

  const SETTINGS = Object.freeze({ ADOPTION_SHARES, INTERVAL, BAND_STEP_MIN, BAND_QUANTILES });

  function quantile(xs, q) {
    const sorted = [...xs].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // ---- Wait ranges ----------------------------------------------------------------------------------

  // The app's own wait runs (Sim.runWait, default seed, 200 runs) for someone arriving t minutes from now,
  // for t across the 3-hour window. Unrounded percentiles; the app rounds its 25th-75th range to 5 minutes.
  function waitBand(facility, state) {
    const { HORIZON_MIN, RUNS, DEFAULT_SEED } = Sim.CONSTANTS;
    const points = [];
    for (let t = 0; t < HORIZON_MIN; t += BAND_STEP_MIN) {
      if (!Sim.isOpen(facility, (state.nowMin + t) % 1440)) continue;
      const waits = [];
      for (let run = 0; run < RUNS; run++) waits.push(Sim.runWait(facility, state, t, DEFAULT_SEED, run).wait);
      const [p10, p25, p50, p75, p90] = BAND_QUANTILES.map((q) => quantile(waits, q));
      points.push({ t, p10, p25, p50, p75, p90 });
    }
    return { facilityId: facility.id, nowMin: state.nowMin, seed: DEFAULT_SEED, runs: RUNS, points };
  }

  // ---- One afternoon with any chooser ---------------------------------------------------------------

  function afternoon({ facilities, seed, scenario, people: count }, choose) {
    const network = Saturday.applyScenario(facilities, scenario);
    const people = Saturday.makePeople(facilities, seed, count);
    const world = Saturday.makeAfternoon(network, people, Saturday.makeBackground(seed), choose);
    world.advance();
    return Saturday.summarize(world);
  }

  // ---- Adoption -------------------------------------------------------------------------------------

  // Each person has one fixed draw, from their own stream, that decides whether they use Triage. Someone
  // who uses it at a 10% share also uses it at 25%, 50% and 100%, so the shares differ only by who is added.
  // At 0% this is exactly Saturday's nearest-ER side; at 100% exactly its Triage side.
  function usesTriage(seed, k, share) {
    return Sim.mulberry32(Sim.subSeed(seed, 13, k))() < share;
  }

  function adoption({ facilities, seed = Saturday.SETTINGS.DEMO_SEED, scenario = "medium", share, people }) {
    return afternoon({ facilities, seed, scenario, people }, (person, t, world) =>
      (usesTriage(seed, person.k, share) ? Saturday.chooseTriage : Saturday.chooseNearestER)(person, t, world));
  }

  // ---- Herding --------------------------------------------------------------------------------------

  // The naive router: the same ranking code, but it only ever looks at the lines as they were when the
  // first person asked. It never sees the lines change and never counts the people it has already sent.
  // The capacity-aware side is Saturday.chooseTriage unchanged.
  function makeNaiveChooser() {
    let frozen = null;
    return (person, t, world) => {
      if (!frozen) frozen = world.stateNow().facilities;
      const ranked = Router.rank({
        injuryType: person.injuryType, age: person.age, user: person,
        state: Sim.makeState(t % 1440, frozen), facilities: world.facilities,
      });
      return ranked.length ? ranked[0] : Saturday.chooseNearestER(person, t, world);
    };
  }

  function herding({ facilities, seed = Saturday.SETTINGS.DEMO_SEED, scenario = "medium", people }) {
    const options = { facilities, seed, scenario, people };
    return { aware: afternoon(options, Saturday.chooseTriage), naive: afternoon(options, makeNaiveChooser()) };
  }

  // Longest wait among the people sent to each facility, from a summary's trips.
  function longestWaitByFacility(summary) {
    const out = {};
    for (const x of summary.trips) out[x.facilityId] = Math.max(out[x.facilityId] ?? 0, x.wait);
    return out;
  }

  return { SETTINGS, quantile, waitBand, usesTriage, adoption, herding, longestWaitByFacility };
})();

if (typeof globalThis !== "undefined") globalThis.AboutSim = AboutSim;
