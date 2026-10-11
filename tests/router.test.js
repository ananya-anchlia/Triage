// Run: node tests/router.test.js   (loads sim.js and router.js the same way the browser does: as plain scripts)
import vm from "node:vm";
import fs from "node:fs";
import assert from "node:assert/strict";

for (const f of ["../sim.js", "../router.js"]) vm.runInThisContext(fs.readFileSync(new URL(f, import.meta.url), "utf8"));
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const facilities = read("../data/facilities.json");
const checklists = read("../data/checklists.json");
const demo = read("../data/demo-state.json");
const state = Sim.makeState(demo.nowMin, demo.facilities);
const show = process.argv.includes("--show");

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FAIL ", name, "\n     ", e.message); }
}
const allNo = (type) => Object.fromEntries(checklists.types[type].map((id) => [id, "no"]));
const base = { facilities, checklists, user: demo.user, state };

// Each of these is one sign described with alternatives (e.g. "fingers or toes"), not two separate signs.
const ONE_SIGN_WITH_ALTERNATIVES = ["numb", "cold", "blue", "cant_move", "burn_around", "burn_deep", "groin_numb"];

test("checklist items are single questions with ids that exist", () => {
  for (const [type, ids] of Object.entries(checklists.types)) {
    for (const id of ids) {
      const text = checklists.items[id];
      assert.ok(text, `${type}: missing item ${id}`);
      if (!ONE_SIGN_WITH_ALTERNATIVES.includes(id)) assert.ok(!/\b(or|and)\b/i.test(text), `"${text}" joins two signs`);
    }
  }
  assert.ok(checklists._status.includes("CLINICIAN REVIEW"));
});

test("wrist case, child age 7, all no: ortho or kids' clinic first", () => {
  const r = Router.route({ ...base, injuryType: "sprain_or_simple_fracture", age: 7, answers: allNo("sprain_or_simple_fracture") });
  assert.equal(r.kind, "results");
  if (show) for (const x of r.ranked) console.log(x.rank, x.facility.id, x.bestFit, Math.round(x.driveMin), x.wait.low, x.wait.high, Math.round(x.totalMin));
  assert.ok(["ORTHO_RAL", "PEDS_CARY"].includes(r.top[0].facility.id), r.top[0].facility.id);
  assert.ok(r.top[0].wait.median < 30, `median ${r.top[0].wait.median}`);
  assert.equal(r.top.length, 3);
});

test("Hospital A ER is the closest pin but shows a multi-hour wait for the wrist case", () => {
  const r = Router.route({ ...base, injuryType: "sprain_or_simple_fracture", age: 7, answers: allNo("sprain_or_simple_fracture") });
  const er = r.ranked.find((x) => x.facility.id === "ER_RAL");
  const nearest = [...facilities].sort((a, b) => Sim.driveMinutes(demo.user, a) - Sim.driveMinutes(demo.user, b))[0];
  assert.equal(nearest.id, "ER_RAL");
  assert.ok(er.wait.median >= 150 && er.wait.median <= 240, `median ${er.wait.median}`);
});

test("times are unadjusted: total = drive + median wait, best fit is only a label", () => {
  const r = Router.route({ ...base, injuryType: "sprain_or_simple_fracture", age: 30, answers: allNo("sprain_or_simple_fracture") });
  for (const x of r.ranked) assert.ok(Math.abs(x.totalMin - (x.driveMin + x.wait.median)) < 1e-9);
});

test("best fit moves ahead only within 15 min of the fastest", () => {
  const f = [
    { id: "A", label: "A", type: "urgent", lat: 35.78, lng: -78.68, hours: "00:00-24:00", xray: true, specialists: [], slots: 3, min_age: 0, max_age: null, treats: ["sprain_or_simple_fracture"] },
    { id: "B", label: "B", type: "ortho", lat: 35.78, lng: -78.68, hours: "00:00-24:00", xray: true, specialists: ["ortho"], slots: 1, min_age: 0, max_age: null, treats: ["sprain_or_simple_fracture"] },
  ];
  const run = (waitingB) => Router.rank({
    injuryType: "sprain_or_simple_fracture", age: 30, user: demo.user, facilities: f,
    state: Sim.makeState(600, { A: { waiting: 0, inTreatment: 0 }, B: { waiting: waitingB, inTreatment: waitingB ? 1 : 0 } }),
  });
  assert.equal(run(0)[0].facility.id, "B"); // best fit, within window of the fastest
  const slow = run(8);
  assert.equal(slow[0].facility.id, "A");   // best fit too slow, does not jump ahead
  assert.ok(slow.find((x) => x.facility.id === "B").totalMin - slow[0].totalMin > Router.BEST_FIT_WINDOW_MIN);
});

test("any single yes means emergency, for every item of every type", () => {
  for (const type of Object.keys(checklists.types)) {
    for (const id of checklists.types[type]) {
      const r = Router.route({ ...base, injuryType: type, age: type === "child_minor_injury" ? 7 : 30, answers: { ...allNo(type), [id]: "yes" } });
      assert.equal(r.kind, "emergency", `${type}/${id}`);
      assert.deepEqual(r.triggered.map((t) => t.id), [id]);
    }
  }
});

test("any single not_sure means emergency and names the item", () => {
  const r = Router.route({ ...base, injuryType: "back_strain", age: 40, answers: { ...allNo("back_strain"), leg_numb: "not_sure" } });
  assert.equal(r.kind, "emergency");
  assert.equal(r.triggered[0].id, "leg_numb");
  assert.equal(r.triggered[0].text, checklists.items.leg_numb);
});

test("a yes is an emergency even when other items are still blank", () => {
  const r = Router.route({ ...base, injuryType: "cut", age: 30, answers: { bleeding: "yes" } });
  assert.equal(r.kind, "emergency");
});

test("blank, unknown or garbage answers never route", () => {
  for (const bad of [undefined, "", "unknown", "maybe", null, false]) {
    const r = Router.route({ ...base, injuryType: "cut", age: 30, answers: { ...allNo("cut"), numb: bad } });
    assert.equal(r.kind, "incomplete", String(bad));
    assert.deepEqual(r.missing.map((m) => m.id), ["numb"]);
  }
  assert.equal(Router.route({ ...base, injuryType: "cut", age: 30, answers: {} }).kind, "incomplete");
});

test("emergency goes to the nearest ER, not the one with the shortest wait", () => {
  const r = Router.route({ ...base, injuryType: "cut", age: 30, answers: { ...allNo("cut"), bleeding: "yes" } });
  assert.equal(r.nearestER.facility.id, "ER_RAL");
  const waits = Object.fromEntries(facilities.filter((f) => f.type === "er").map((f) => [f.id, Sim.estimateWait(f, state, 10).median]));
  assert.ok(Object.values(waits).some((w) => w < waits.ER_RAL), "test premise: another ER has a shorter wait");
  // moving the user next to Hospital C ER flips the nearest ER; wait times play no part
  const r2 = Router.route({ ...base, user: { lat: 35.905, lng: -79.05 }, injuryType: "cut", age: 30, answers: { bleeding: "yes" } });
  assert.equal(r2.nearestER.facility.id, "ER_CH");
});

test("ambulance questions: yes or not_sure to any switches the headline to Call 911", () => {
  const qs = Object.keys(checklists.ambulance.questions);
  assert.equal(qs.length, 5);
  assert.equal(Router.emergencyHeadline(checklists, {}), "Go to the nearest ER now");
  assert.equal(Router.emergencyHeadline(checklists, Object.fromEntries(qs.map((q) => [q, "no"]))), "Go to the nearest ER now");
  for (const q of qs) for (const a of ["yes", "not_sure"]) {
    assert.equal(Router.emergencyHeadline(checklists, { [q]: a }), "Call 911", `${q}/${a}`);
  }
});

test("infants under 1 go to 'other' (ER or nurse line), even with a clean checklist", () => {
  for (const age of [0, 0.5]) {
    const r = Router.route({ ...base, injuryType: "cut", age, answers: allNo("cut") });
    assert.equal(r.kind, "other", `age ${age}`);
  }
  assert.equal(Router.route({ ...base, injuryType: "cut", age: 1, answers: allNo("cut") }).kind, "results");
});

test("PLAN.md must-route cases: all no routes to options", () => {
  const cases = [
    ["bagel cut, bleeding stopped", "cut", 30],
    ["sprained ankle at soccer", "sprain_or_simple_fracture", 30],
    ["couch back strain", "back_strain", 30],
    ["pan burn on a fingertip", "minor_burn", 30],
    ["child wrist, fingers moving", "sprain_or_simple_fracture", 7],
  ];
  for (const [name, injuryType, age] of cases) {
    const r = Router.route({ ...base, injuryType, age, answers: allNo(injuryType) });
    assert.equal(r.kind, "results", name);
    assert.ok(r.top.length > 0, name);
  }
});

test("injury outside the types returns 'other', never a guess", () => {
  assert.equal(Router.route({ ...base, injuryType: "other", age: 30, answers: {} }).kind, "other");
  assert.equal(Router.route({ ...base, injuryType: "chest_pain", age: 30, answers: {} }).kind, "other");
});

test("child picks 'something else': child_minor_injury checklist, kids' clinic best fit", () => {
  const none = Router.route({ ...base, injuryType: "other", age: 7, answers: {} });
  assert.equal(none.kind, "incomplete");
  assert.deepEqual(none.missing.map((m) => m.id), checklists.types.child_minor_injury);
  const r = Router.route({ ...base, injuryType: "other", age: 7, answers: allNo("child_minor_injury") });
  assert.equal(r.kind, "results");
  assert.equal(r.injuryType, "child_minor_injury");
  assert.ok(r.ranked.every((x) => x.facility.treats.includes("child_minor_injury")));
  assert.ok(r.ranked.some((x) => x.bestFit && x.facility.type === "peds"));
  const em = Router.route({ ...base, injuryType: "other", age: 7, answers: { ...allNo("child_minor_injury"), sleepy: "yes" } });
  assert.equal(em.kind, "emergency");
  assert.equal(em.triggered[0].id, "sleepy");
});

test("adult picks 'something else': ER or nurse line", () => {
  assert.equal(Router.route({ ...base, injuryType: "other", age: 30, answers: {} }).kind, "other");
  assert.equal(Router.route({ ...base, injuryType: "other", age: 18, answers: {} }).kind, "other");
});

test("child with a wrist injury: sprain/fracture checklist plus child flag", () => {
  const input = { ...base, injuryType: "sprain_or_simple_fracture", age: 7 };
  const none = Router.route({ ...input, answers: {} });
  assert.deepEqual(none.missing.map((m) => m.id), checklists.types.sprain_or_simple_fracture);
  const r = Router.route({ ...input, answers: allNo("sprain_or_simple_fracture") });
  assert.equal(r.kind, "results");
  assert.equal(r.injuryType, "sprain_or_simple_fracture");
  assert.ok(["ORTHO_RAL", "PEDS_CARY"].includes(r.top[0].facility.id));
  assert.ok(r.ranked.some((x) => x.facility.type === "peds" && x.bestFit));
  const adult = Router.route({ ...input, age: 30, answers: allNo("sprain_or_simple_fracture") });
  assert.ok(!adult.ranked.some((x) => x.facility.type === "peds"));
});

test("child flag is age under 18: ages 7, 17 and 18", () => {
  const wrist = (age) => Router.route({ ...base, injuryType: "sprain_or_simple_fracture", age, answers: allNo("sprain_or_simple_fracture") });
  const hasKids = (r) => r.ranked.some((x) => x.facility.type === "peds" && x.bestFit);
  assert.ok(hasKids(wrist(7)));
  assert.ok(hasKids(wrist(17)));
  assert.ok(!wrist(18).ranked.some((x) => x.facility.type === "peds"));
  const other = (age) => Router.route({ ...base, injuryType: "other", age, answers: allNo("child_minor_injury") });
  assert.equal(other(7).injuryType, "child_minor_injury");
  assert.equal(other(17).injuryType, "child_minor_injury");
  assert.equal(other(18).kind, "other");
});

test("age is required: blank, negative, non-numeric or absurd ages never route", () => {
  for (const type of ["cut", "other", "sprain_or_simple_fracture"]) {
    for (const age of [undefined, null, NaN, "", "7", "abc", -1, -0.5, Infinity, 121]) {
      const r = Router.route({ ...base, injuryType: type, age, answers: allNo(type === "other" ? "child_minor_injury" : type) });
      assert.equal(r.kind, "incomplete", `${type}/${String(age)}`);
      assert.equal(r.reason, "age");
    }
  }
  assert.equal(Router.route({ ...base, injuryType: "cut", age: 1, answers: allNo("cut") }).kind, "results");
});

test("age rules: adults never see kids' clinics; ortho excludes under-5", () => {
  const adult = Router.route({ ...base, injuryType: "sprain_or_simple_fracture", age: 30, answers: allNo("sprain_or_simple_fracture") });
  assert.ok(!adult.ranked.some((x) => x.facility.type === "peds"));
  const toddler = Router.route({ ...base, injuryType: "sprain_or_simple_fracture", age: 3, answers: allNo("sprain_or_simple_fracture") });
  assert.ok(!toddler.ranked.some((x) => x.facility.type === "ortho"));
  assert.ok(toddler.ranked.some((x) => x.facility.type === "peds"));
  assert.equal(Router.route({ ...base, injuryType: "child_minor_injury", age: 30, answers: allNo("child_minor_injury") }).kind, "incomplete");
});

test("closed facilities are left out", () => {
  const night = Router.route({ ...base, state: Sim.makeState(23 * 60, demo.facilities), injuryType: "cut", age: 30, answers: allNo("cut") });
  assert.ok(night.ranked.every((x) => ["er"].includes(x.facility.type)), night.ranked.map((x) => x.facility.id).join());
});

test("ranking is deterministic and a recommendation changes nothing", () => {
  const input = { ...base, injuryType: "cut", age: 30, answers: allNo("cut") };
  const a = Router.route(input);
  const b = Router.route(input);
  assert.deepEqual(a.ranked.map((x) => [x.facility.id, x.totalMin]), b.ranked.map((x) => [x.facility.id, x.totalMin]));
  assert.equal(state.picks.length, 0);
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
