// Run: node tests/saturday.test.js   (loads the scripts the same way the browser does: as plain scripts)
// Takes about half a minute: it plays the full 300-person afternoon four times.
// The 50-seed spread is separate: node tests/saturday-seeds.js
// Prints the results table for all three capacity scenarios at the end.
import vm from "node:vm";
import fs from "node:fs";
import assert from "node:assert/strict";

for (const f of ["../sim.js", "../router.js", "../saturday.js"]) vm.runInThisContext(fs.readFileSync(new URL(f, import.meta.url), "utf8"));
const facilities = JSON.parse(fs.readFileSync(new URL("../data/facilities.json", import.meta.url)));
const byId = Object.fromEntries(facilities.map((f) => [f.id, f]));
const S = Saturday.SETTINGS;
const SEED = S.DEMO_SEED;

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FAIL ", name, "\n     ", e.message); }
}

const results = {};
for (const scenario of Saturday.SCENARIOS) results[scenario] = Saturday.compare({ facilities, scenario });
const sides = (r) => [["baseline", r.baseline], ["triage", r.triage]];

test("the 300 people: inside noon-4 PM, four injury types, sensible ages, in arrival order", () => {
  const people = Saturday.makePeople(facilities, SEED);
  assert.equal(people.length, 300);
  const types = S.INJURY_MIX.map(([t]) => t);
  people.forEach((p, i) => {
    assert.ok(p.appear >= 720 && p.appear < 960, `appear ${p.appear}`);
    assert.ok(types.includes(p.injuryType), p.injuryType);
    assert.ok(Number.isInteger(p.age) && p.age >= 1 && p.age <= 84, `age ${p.age}`);
    if (p.injuryType === "back_strain") assert.ok(p.age >= 18);
    if (i > 0) assert.ok(people[i - 1].appear <= p.appear);
  });
  assert.equal(new Set(people.map((p) => p.k)).size, 300);
  assert.deepEqual(Saturday.makePeople(facilities, SEED), people);
  assert.notDeepEqual(Saturday.makePeople(facilities, SEED + 1), people);
});

test("same numbers every run with the fixed seed", () => {
  const again = Saturday.compare({ facilities, scenario: "medium" });
  assert.deepEqual(again, results.medium);
  assert.equal(results.medium.seed, SEED);
});

test("baseline and Triage share identical people, injuries and locations", () => {
  for (const r of Object.values(results)) {
    assert.deepEqual(r.people, results.medium.people, "same people in every capacity scenario");
    const person = Object.fromEntries(r.people.map((p) => [p.k, p]));
    for (const [side, s] of sides(r)) {
      assert.equal(s.trips.length, 300, side);
      assert.deepEqual(s.trips.map((x) => x.k).sort((a, b) => a - b), [...Array(300).keys()], `${side}: each person once`);
      // Assigned one at a time, in arrival order.
      assert.deepEqual(s.trips.map((x) => x.k), r.people.map((p) => p.k), `${side}: arrival order`);
      for (const x of s.trips) assert.ok(x.arrive >= person[x.k].appear && x.wait >= 0);
    }
  }
});

test("baseline and Triage share identical background arrivals, straight from Sim.makeArrivals", () => {
  // Rebuilt here from sim.js alone: every background arrival between noon and 4 PM (blocks 4 and 5 of the day).
  const bgSeed = Sim.subSeed(SEED, 12);
  const expected = {};
  for (const f of facilities) {
    const c = { minor: 0, emergency: 0, treatSum: 0 };
    for (const block of [4, 5]) {
      for (const a of Sim.makeArrivals(f, block * 180, bgSeed, block)) {
        const at = block * 180 + a.t;
        if (at < 720 || at >= 960) continue;
        c[a.emergency ? "emergency" : "minor"]++;
        c.treatSum += a.treat;
      }
    }
    expected[f.id] = c;
  }
  for (const r of Object.values(results)) {
    for (const [side, s] of sides(r)) assert.deepEqual(s.background, expected, `${r.scenario} ${side}`);
  }
  const emergencies = Object.entries(expected).filter(([, c]) => c.emergency > 0).map(([id]) => byId[id].type);
  assert.ok(emergencies.length > 0 && emergencies.every((t) => t === "er"), "emergencies arrive, and only at ERs");
});

test("baseline: everyone goes to their nearest ER", () => {
  const ers = facilities.filter((f) => f.type === "er");
  for (const r of Object.values(results)) {
    const person = Object.fromEntries(r.people.map((p) => [p.k, p]));
    for (const x of r.baseline.trips) {
      const p = person[x.k];
      const nearest = ers.reduce((a, b) => (Sim.distanceKm(p.lat, p.lng, a.lat, a.lng) <= Sim.distanceKm(p.lat, p.lng, b.lat, b.lng) ? a : b));
      assert.equal(x.facilityId, nearest.id);
    }
    assert.equal(r.baseline.byType.er, 300);
  }
});

test("nobody, on either side, is sent to a facility that can't treat them (injury type, age, open on arrival)", () => {
  let clinics = 0;
  for (const r of Object.values(results)) {
    const person = Object.fromEntries(r.people.map((p) => [p.k, p]));
    for (const [side, s] of sides(r)) {
      for (const x of s.trips) {
        const p = person[x.k];
        const f = byId[x.facilityId];
        const where = `${r.scenario} ${side}: person ${x.k} (${p.injuryType}, age ${p.age}) -> ${f.id}`;
        assert.ok(f.treats.includes(p.injuryType), where);
        assert.ok(p.age >= f.min_age && (f.max_age == null || p.age <= f.max_age), where);
        assert.ok(Sim.isOpen(f, x.arrive % 1440), `${where} closed on arrival`);
        if (f.type !== "er") clinics++;
      }
    }
  }
  assert.ok(clinics > 0, "the check saw people sent to urgent cares, ortho and kids' clinics");
});

test("Triage: each person gets the first place in Router.rank from the lines at that minute", () => {
  // Replays the start of the afternoon with a spy on Router.rank and checks the pick against its answer.
  const realRank = Router.rank;
  const calls = [];
  Router.rank = (input) => {
    const ranked = realRank(input);
    calls.push({ input, first: ranked[0] });
    return ranked;
  };
  try {
    const run = Saturday.start({ facilities, scenario: "medium" });
    run.step(40);
    assert.equal(calls.length, 40);
    const trips = results.medium.triage.trips;
    calls.forEach((c, i) => {
      const p = results.medium.people[i];
      assert.equal(c.input.injuryType, p.injuryType);
      assert.equal(c.input.age, p.age);
      assert.deepEqual([c.input.user.lat, c.input.user.lng], [p.lat, p.lng]);
      assert.equal(c.input.simOpts, undefined, "the app's own estimate settings");
      assert.equal(c.input.state.nowMin, p.appear, "the clock is the minute this person asks");
      assert.deepEqual(Object.keys(c.input.state).sort(), ["facilities", "nowMin", "picks"], "lines and picks only");
      assert.equal(c.first.facility.id, trips[i].facilityId);
      // The picks are exactly the earlier people who are still driving, at their real arrival minute.
      // Everyone who has arrived is in the lines instead; nobody later is anywhere.
      const key = (id, at) => `${id}@${at}`;
      const driving = trips.slice(0, i).filter((x) => x.arrive >= p.appear).map((x) => key(x.facilityId, x.arrive - p.appear));
      assert.deepEqual(c.input.state.picks.map((x) => key(x.facilityId, x.arriveAt)).sort(), driving.sort(), `person ${i}`);
    });
  } finally {
    Router.rank = realRank;
  }
});

test("no knowledge of future arrivals: none of the estimate's 200 what-if runs is the real afternoon", () => {
  const est = Sim.CONSTANTS.DEFAULT_SEED; // what Sim.estimateWait uses when the app (and Triage here) asks
  const bgSeed = Sim.subSeed(SEED, 12);
  assert.notEqual(bgSeed, est);
  let compared = 0;
  for (const f of facilities) {
    for (const block of [4, 5]) { // noon-3 PM and 3-6 PM
      const real = Sim.makeArrivals(f, block * 180, bgSeed, block);
      assert.ok(real.length > 0, f.id);
      for (let run = 0; run < Sim.CONSTANTS.RUNS; run++) {
        assert.notDeepEqual(Sim.makeArrivals(f, block * 180, est, run), real, `${f.id} block ${block} run ${run}`);
        compared++;
      }
    }
  }
  assert.equal(compared, 12 * 2 * 200);
});

test("the afternoon's queue rules match Sim.runWait minute for minute (emergencies first, nobody interrupted)", () => {
  // One made-up 2-slot ER with hand-made arrivals from noon, played by both engines. Its hours never open,
  // so Sim.runWait adds no arrivals of its own; the afternoon engine gets the same list as its background.
  const f = { id: "T", type: "er", hours: "00:00-00:00", slots: 2 };
  let jumped = 0;
  for (let round = 0; round < 40; round++) {
    const rng = Sim.mulberry32(5000 + round);
    const arrivals = [];
    for (let i = 0, at = 720; i < 40; i++) {
      at += Math.floor(rng() * 6);
      const emergency = rng() < 0.25;
      arrivals.push({ at, emergency, treat: 1 + rng() * (emergency ? 30 : 20), label: `p${i}` });
    }
    assert.ok(arrivals.at(-1).at < 960);

    const trace = [];
    Sim.runWait(f, Sim.makeState(720, { T: { waiting: 0, inTreatment: 0 } }), 700, 7, round, {
      extra: arrivals.map((a) => ({ t: a.at - 720, emergency: a.emergency, treat: a.treat, label: a.label })),
      trace,
    });
    const simStart = Object.fromEntries(trace.map((e) => [e.label, e.startedAt + 720]));

    const background = (fac, block) => arrivals.filter((a) => Math.floor(a.at / 180) === block)
      .map((a) => ({ t: a.at - block * 180, emergency: a.emergency, treat: a.treat }));
    const world = Saturday.makeAfternoon([f], [], background, null);
    assert.equal(world.advance(), true);

    const minors = arrivals.filter((a) => !a.emergency);
    assert.equal(world.others.length, minors.length);
    minors.forEach((a, i) => {
      assert.equal(world.others[i].arrive, a.at);
      assert.equal(world.others[i].start, simStart[a.label], `round ${round} ${a.label}`);
    });
    // The rule is really being exercised: some emergency started before a minor patient who arrived earlier.
    for (const e of arrivals.filter((a) => a.emergency)) {
      if (minors.some((a) => a.at < e.at && simStart[a.label] > simStart[e.label])) jumped++;
    }
  }
  assert.ok(jumped > 20, `emergencies jumped the line ${jumped} times`);
});

test("the lines handed to the ranking are the real lines at that minute, plus earlier people still driving", () => {
  // One made-up 2-slot clinic, hand-made arrivals, and ten people who ask at set minutes (some in the same
  // minute) with drives of 0 to 27 minutes. Afterwards everyone's real arrival, start and treatment time is
  // known, so the lines at each asking minute can be recounted from scratch.
  const f = { id: "T", type: "urgent", hours: "00:00-24:00", slots: 2 };
  const rng = Sim.mulberry32(77);
  const arrivals = [];
  for (let i = 0, at = 720; i < 60; i++) {
    at += Math.floor(rng() * 5);
    arrivals.push({ at, emergency: false, treat: 2 + rng() * 16 });
  }
  assert.ok(arrivals.at(-1).at < 960);
  const background = (fac, block) => arrivals.filter((a) => Math.floor(a.at / 180) === block)
    .map((a) => ({ t: a.at - block * 180, emergency: false, treat: a.treat }));
  const people = [725, 725, 740, 741, 760, 760, 760, 790, 815, 840]
    .map((appear, k) => ({ k, appear, treatU: 0.1 + 0.08 * k, drive: (k * 9) % 28 }));
  const snaps = [];
  const world = Saturday.makeAfternoon([f], people, background, (person, t, w) => {
    snaps.push({ t, state: w.stateNow(), earlier: w.trips.length });
    return { facility: f, driveMin: person.drive };
  });
  assert.equal(world.advance(), true);
  assert.equal(snaps.length, 10);
  assert.deepEqual(world.others.map((p) => p.arrive), arrivals.map((a) => a.at));

  const everyone = [...world.others.map((p, i) => ({ arrive: p.arrive, start: p.start, treat: arrivals[i].treat })), ...world.trips];
  let sawLine = 0;
  let sawPicks = 0;
  for (const { t, state, earlier } of snaps) {
    assert.equal(state.nowMin, t);
    assert.deepEqual(state.facilities.T, {
      waiting: everyone.filter((p) => p.arrive < t && p.start >= t).length,
      inTreatment: everyone.filter((p) => p.start < t && p.start + p.treat > t).length,
    }, `lines at minute ${t}`);
    const driving = world.trips.slice(0, earlier).filter((x) => x.arrive >= t).map((x) => x.arrive - t);
    assert.deepEqual(state.picks.map((x) => x.arriveAt).sort((a, b) => a - b), driving.sort((a, b) => a - b), `picks at minute ${t}`);
    if (state.facilities.T.waiting > 2 && state.facilities.T.inTreatment === 2) sawLine++;
    if (state.picks.length > 0) sawPicks++;
  }
  // The recount is not trivially zero: most askers saw a real line, and several saw people still driving.
  assert.ok(sawLine >= 6 && sawPicks >= 3, `lines seen ${sawLine}, picks seen ${sawPicks}`);
});

test("stepping a few people at a time (as the page does) gives the same result as one go", () => {
  const whole = Saturday.compare({ facilities, scenario: "low", people: 60 });
  const run = Saturday.start({ facilities, scenario: "low", people: 60 });
  let steps = 0;
  while (!run.step(7)) steps++;
  assert.ok(steps >= 8, `steps ${steps}`);
  assert.equal(run.assigned(), 60);
  assert.deepEqual(run.result(), whole);
});

test("capacity scenarios change only urgent-care slots", () => {
  for (const scenario of Saturday.SCENARIOS) {
    const net = Saturday.applyScenario(facilities, scenario);
    net.forEach((f, i) => {
      const slots = f.type === "urgent" ? S.URGENT_SLOTS[scenario] : facilities[i].slots;
      assert.deepEqual(f, { ...facilities[i], slots });
    });
  }
  assert.deepEqual(Saturday.applyScenario(facilities, "medium"), facilities, "medium is facilities.json as it stands");
  assert.throws(() => Saturday.applyScenario(facilities, "huge"));
});

test("every count adds up to 300 and every number is finite", () => {
  for (const r of Object.values(results)) {
    for (const [side, s] of sides(r)) {
      assert.equal(Object.values(s.byType).reduce((a, b) => a + b, 0), 300, side);
      assert.equal(Object.values(s.byFacility).reduce((a, b) => a + b, 0), 300, side);
      for (const k of ["avgErWait", "avgTimeToTreatment", "medianTimeToTreatment", "p90TimeToTreatment", "avgOtherClinicWait"]) {
        assert.ok(Number.isFinite(s[k]) && s[k] >= 0, `${r.scenario} ${side} ${k} = ${s[k]}`);
      }
      assert.ok(s.over3h >= 0 && s.over3h <= 300);
      assert.ok(s.afterClosing >= 0 && s.afterClosing <= 300 - s.byType.er, "ERs never close");
    }
  }
});

// ---- Results table (simulated network) ------------------------------------------------------------
const m = (x) => `${Math.round(x)} min`;
console.log(`\nBusy Saturday on the simulated network. Seed ${SEED}, 300 people, noon to 4 PM.`);
for (const scenario of Saturday.SCENARIOS) {
  const { baseline: b, triage: t, urgentSlots } = results[scenario];
  console.log(`\n${scenario.toUpperCase()} urgent-care capacity (${urgentSlots} treatment slots at each urgent care)`);
  const rows = [
    ["", "Nearest ER", "Triage"],
    ["Average ER wait", m(b.avgErWait), m(t.avgErWait)],
    ["Average time to treatment (drive + wait)", m(b.avgTimeToTreatment), m(t.avgTimeToTreatment)],
    ["Median time to treatment", m(b.medianTimeToTreatment), m(t.medianTimeToTreatment)],
    ["90th-percentile time to treatment", m(b.p90TimeToTreatment), m(t.p90TimeToTreatment)],
    ["People who waited over 3 hours (of 300)", b.over3h, t.over3h],
    ["Treated after the place's closing time", b.afterClosing, t.afterClosing],
    ["Went to: hospital ER", b.byType.er, t.byType.er],
    ["Went to: urgent care", b.byType.urgent, t.byType.urgent],
    ["Went to: ortho walk-in", b.byType.ortho, t.byType.ortho],
    ["Went to: kids' urgent care", b.byType.peds, t.byType.peds],
    ["Average wait, other patients at clinics", m(b.avgOtherClinicWait), m(t.avgOtherClinicWait)],
  ];
  for (const [a, x, y] of rows) console.log(`  ${a.padEnd(42)}${String(x).padStart(12)}${String(y).padStart(12)}`);
}
process.exit(failed ? 1 : 0);
