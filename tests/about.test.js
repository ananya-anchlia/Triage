// Run: node tests/about.test.js   (about 20 s; loads the scripts the same way the browser does)
//
// The About page's experiments (about-sim.js), and that the saved numbers the page shows
// (data/about-results.json) are what the code gives when run again.
import vm from "node:vm";
import fs from "node:fs";
import assert from "node:assert/strict";

for (const f of ["../sim.js", "../router.js", "../saturday.js", "../about-sim.js"]) {
  vm.runInThisContext(fs.readFileSync(new URL(f, import.meta.url), "utf8"));
}
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const facilities = read("../data/facilities.json");
const demo = read("../data/demo-state.json");
const saved = read("../data/about-results.json");
const spread = read("../data/saturday-spread.json");
const demoSeed = Saturday.SETTINGS.DEMO_SEED;

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FAIL ", name, "\n     ", e.message); }
}
// Saved numbers went through JSON, so compare after the same round trip.
const json = (x) => JSON.parse(JSON.stringify(x));
const subset = (full, like) => Object.fromEntries(Object.keys(like).map((k) => [k, full[k]]));
const SMALL = { facilities, seed: 3, scenario: "medium", people: 40 };

test("adoption at 0% is exactly Saturday's nearest-ER side, at 100% exactly its Triage side", () => {
  const r = Saturday.compare(SMALL);
  assert.deepEqual(AboutSim.adoption({ ...SMALL, share: 0 }), r.baseline);
  assert.deepEqual(AboutSim.adoption({ ...SMALL, share: 1 }), r.triage);
});

test("adoption: users are nested, and their number tracks the share", () => {
  const shares = AboutSim.SETTINGS.ADOPTION_SHARES;
  const ks = Array.from({ length: 300 }, (_, k) => k);
  let before = [];
  for (const share of shares) {
    const users = ks.filter((k) => AboutSim.usesTriage(demoSeed, k, share));
    for (const k of before) assert.ok(users.includes(k), `person ${k} stopped using Triage at ${share}`);
    assert.ok(Math.abs(users.length - share * 300) <= 20, `${users.length} users at share ${share}`);
    before = users;
  }
  assert.equal(before.length, 300);
});

test("adoption: people who don't use Triage go to an ER; the same people and arrivals at every share", () => {
  const half = AboutSim.adoption({ ...SMALL, share: 0.5 });
  const none = AboutSim.adoption({ ...SMALL, share: 0 });
  assert.deepEqual(half.background, none.background);
  for (const trip of half.trips) {
    if (AboutSim.usesTriage(SMALL.seed, trip.k, 0.5)) continue;
    assert.equal(trip.facilityId, none.trips.find((x) => x.k === trip.k).facilityId, `person ${trip.k}`);
  }
});

test("herding: the capacity-aware side is Saturday's Triage side; the naive side has the same people", () => {
  const h = AboutSim.herding(SMALL);
  assert.deepEqual(h.aware, Saturday.compare(SMALL).triage);
  assert.deepEqual(h.naive.background, h.aware.background);
  assert.deepEqual(h.naive.trips.map((x) => x.k).sort((a, b) => a - b), h.aware.trips.map((x) => x.k).sort((a, b) => a - b));
  // The first person sees the same lines on both sides, so is sent to the same place.
  assert.equal(h.naive.trips[0].facilityId, h.aware.trips[0].facilityId);
});

test("wait band: ordered percentiles, and the middle half is the app's own range", () => {
  const er = facilities.find((f) => f.id === "ER_RAL");
  const state = Sim.makeState(demo.nowMin, demo.facilities);
  const band = AboutSim.waitBand(er, state);
  assert.equal(band.points.length, Sim.CONSTANTS.HORIZON_MIN / AboutSim.SETTINGS.BAND_STEP_MIN);
  const round = (x) => Math.round(x / Sim.CONSTANTS.ROUND_TO_MIN) * Sim.CONSTANTS.ROUND_TO_MIN;
  for (const p of band.points) {
    assert.ok(p.p10 <= p.p25 && p.p25 <= p.p50 && p.p50 <= p.p75 && p.p75 <= p.p90, `t=${p.t}`);
    const app = Sim.estimateWait(er, state, p.t);
    assert.equal(round(p.p25), app.low, `t=${p.t}`);
    assert.equal(round(p.p75), app.high, `t=${p.t}`);
    assert.equal(p.p50, app.median, `t=${p.t}`);
  }
});

test("saved file: the wait band is what the code gives now", () => {
  const er = facilities.find((f) => f.id === saved.waitBand.facilityId);
  const fresh = AboutSim.waitBand(er, Sim.makeState(demo.nowMin, demo.facilities));
  assert.deepEqual(subset(saved.waitBand, fresh), json(fresh));
});

test("saved file: the demo Saturday (medium) is what Saturday.compare gives now", () => {
  assert.equal(saved.demoSeed, demoSeed);
  const r = Saturday.compare({ facilities, scenario: "medium" });
  assert.deepEqual(saved.saturday.medium.baseline, json(subset(r.baseline, saved.saturday.medium.baseline)));
  assert.deepEqual(saved.saturday.medium.triage, json(subset(r.triage, saved.saturday.medium.triage)));
  assert.equal(saved.ratio.medium.demo, r.triage.avgTimeToTreatment / r.baseline.avgTimeToTreatment);
});

test("saved file: the demo seed's adoption points at 0% and 100% are the demo Saturday, in every scenario", () => {
  const last = saved.shares.length - 1;
  assert.deepEqual(saved.shares, AboutSim.SETTINGS.ADOPTION_SHARES);
  for (const k of Saturday.SCENARIOS) {
    for (const key of Object.keys(saved.adoption[k])) {
      assert.equal(saved.adoption[k][key][0].demo, saved.saturday[k].baseline[key], `${k} ${key} 0%`);
      assert.equal(saved.adoption[k][key][last].demo, saved.saturday[k].triage[key], `${k} ${key} 100%`);
      for (const p of saved.adoption[k][key]) assert.ok(p.min <= p.low && p.low <= p.median && p.median <= p.high && p.high <= p.max, `${k} ${key}`);
    }
  }
});

test("saved file: one adoption point (demo seed, 10%, low capacity) is what the code gives now", () => {
  const fresh = AboutSim.adoption({ facilities, scenario: "low", share: 0.1 });
  for (const key of Object.keys(saved.adoption.low)) assert.equal(saved.adoption.low[key][1].demo, fresh[key], key);
});

test("saved file: the herding result (high capacity, naive side) is what the code gives now", () => {
  const options = { facilities, seed: demoSeed, scenario: "high" };
  const fresh = AboutSim.herding(options).naive;
  const s = saved.herding.high.naive;
  assert.deepEqual(s.byFacility, fresh.byFacility);
  assert.equal(s.avgTimeToTreatment, fresh.avgTimeToTreatment);
  assert.deepEqual(s.longestWaitByFacility, AboutSim.longestWaitByFacility(fresh));
  assert.deepEqual(saved.herding.high.aware.byFacility, saved.saturday.high.triage.byFacility);
});

test("saved file: uses the same seeds as data/saturday-spread.json", () => {
  assert.equal(saved.seeds, spread.seeds);
});

test("about-sim.js has no DOM or network code", () => {
  const src = fs.readFileSync(new URL("../about-sim.js", import.meta.url), "utf8");
  const code = src.replace(/\/\/.*$/gm, ""); // comments talk about "the 3-hour window" and "no network"
  assert.ok(!/\b(document|window|localStorage)\s*\.|\bfetch\s*\(/.test(code));
});

process.exit(failed ? 1 : 0);
