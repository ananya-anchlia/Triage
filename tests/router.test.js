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

test("best-fit window boundary: exactly 15 minutes moves ahead, just over does not", () => {
  const row = (id, totalMin, bestFit, driveMin = 10) => ({ id, totalMin, driveMin, bestFit });
  const ids = (rows) => Router.orderRows(rows).map((r) => r.id);
  assert.equal(Router.BEST_FIT_WINDOW_MIN, 15);
  assert.deepEqual(ids([row("fast", 100, false), row("fit", 115, true)]), ["fit", "fast"]);
  assert.deepEqual(ids([row("fast", 100, false), row("fit", 115.01, true)]), ["fast", "fit"]);
  assert.deepEqual(ids([row("fast", 100, false), row("mid", 105, false), row("fit", 114, true)]), ["fit", "fast", "mid"]);
  // two best fits inside the window keep their time order; the fastest row is still marked
  const out = Router.orderRows([row("fast", 100, false), row("fitB", 112, true), row("fitA", 108, true), row("fitC", 130, true)]);
  assert.deepEqual(out.map((r) => r.id), ["fitA", "fitB", "fast", "fitC"]);
  assert.deepEqual(out.filter((r) => r.fastest).map((r) => r.id), ["fast"]);
  for (const r of out) assert.ok([100, 108, 112, 130].includes(r.totalMin), "times are never adjusted");
});

test("equal totals: the shorter drive goes first", () => {
  const row = (id, driveMin) => ({ id, totalMin: 60, driveMin, bestFit: false });
  assert.deepEqual(Router.orderRows([row("far", 25), row("near", 5), row("mid", 12)]).map((r) => r.id), ["near", "mid", "far"]);
  assert.deepEqual(Router.orderRows([row("near", 5), row("mid", 12), row("far", 25)]).map((r) => r.id), ["near", "mid", "far"]);
});

test("facility labels are neutral: no real hospital or clinic names", () => {
  const REAL = /duke|unc\b|wakemed|rex\b|novant|atrium|cone health|vidant|ecu health|fastmed|nextcare|medfirst|emergeortho|raleigh ortho|triangle ortho|carolina|cape fear|mission|johnston|maria parham|minuteclinic|cvs|walgreens|concentra|va\b|veterans|st\.|saint|memorial|regional|university|children's/i;
  const NEUTRAL = /^(Hospital [A-Z] ER|Urgent Care \d+|Ortho Walk-in [A-Z]|Kids Urgent Care [A-Z])$/;
  assert.equal(facilities.length, 12);
  for (const f of facilities) {
    assert.ok(NEUTRAL.test(f.label), `"${f.label}" is not a neutral label`);
    assert.ok(!REAL.test(f.label), `"${f.label}" looks like a real name`);
    assert.ok(!REAL.test(f.id), `id ${f.id} looks like a real name`);
  }
  assert.equal(new Set(facilities.map((f) => f.label)).size, facilities.length);
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

test("a yes or not_sure is an emergency even when every other item is still blank, for every item of every type", () => {
  for (const type of Object.keys(checklists.types)) {
    for (const id of checklists.types[type]) {
      for (const a of ["yes", "not_sure"]) {
        const r = Router.route({ ...base, injuryType: type, age: type === "child_minor_injury" ? 7 : 30, answers: { [id]: a } });
        assert.equal(r.kind, "emergency", `${type}/${id}/${a}`);
        assert.deepEqual(r.triggered, [{ id, text: checklists.items[id], answer: a }]);
      }
    }
  }
});

test("any single not_sure means emergency, for every item of every type", () => {
  for (const type of Object.keys(checklists.types)) {
    for (const id of checklists.types[type]) {
      const r = Router.route({ ...base, injuryType: type, age: type === "child_minor_injury" ? 7 : 30, answers: { ...allNo(type), [id]: "not_sure" } });
      assert.equal(r.kind, "emergency", `${type}/${id}`);
      assert.deepEqual(r.triggered.map((t) => t.id), [id]);
    }
  }
});

test("every triggered item is named, in checklist order", () => {
  const r = Router.route({ ...base, injuryType: "sprain_or_simple_fracture", age: 30, answers: { ...allNo("sprain_or_simple_fracture"), cold: "not_sure", numb: "yes", thinners: "yes" } });
  assert.equal(r.kind, "emergency");
  assert.deepEqual(r.triggered.map((t) => [t.id, t.answer]), [["numb", "yes"], ["cold", "not_sure"], ["thinners", "yes"]]);
  for (const t of r.triggered) assert.equal(t.text, checklists.items[t.id]);
});

test("a warning sign beats the age check: blank, invalid and infant ages still get the emergency screen", () => {
  for (const age of [undefined, null, NaN, "", "abc", -1, 130, Infinity, 0, 0.5]) {
    for (const a of ["yes", "not_sure"]) {
      const r = Router.route({ ...base, injuryType: "cut", age, answers: { ...allNo("cut"), bleeding: a } });
      assert.equal(r.kind, "emergency", `${String(age)}/${a}`);
      assert.deepEqual(r.triggered.map((t) => t.id), ["bleeding"]);
      assert.equal(r.nearestER.facility.id, "ER_RAL");
    }
  }
  const adult = Router.route({ ...base, injuryType: "child_minor_injury", age: 30, answers: { sleepy: "yes" } });
  assert.equal(adult.kind, "emergency");
});

test("a yes or not_sure on ANY checklist item is an emergency, whatever the injury type", () => {
  const all = Object.keys(checklists.items);
  for (const type of [...Object.keys(checklists.types), "other", "chest_pain", undefined]) {
    const own = checklists.types[type] ? allNo(type) : {};
    for (const id of all) {
      for (const a of ["yes", "not_sure"]) {
        for (const age of [7, 30, undefined]) {
          const r = Router.route({ ...base, injuryType: type, age, answers: { ...own, [id]: a } });
          assert.equal(r.kind, "emergency", `${String(type)}/${id}/${a}/${age}`);
          assert.deepEqual(r.triggered, [{ id, text: checklists.items[id], answer: a }]);
        }
      }
    }
  }
  // the grandpa case: no specific injury type, on blood thinners
  const grandpa = Router.route({ ...base, injuryType: "other", age: 70, answers: { thinners: "yes" } });
  assert.equal(grandpa.kind, "emergency");
  assert.equal(grandpa.triggered[0].text, checklists.items.thinners);
});

test("items outside the type's list are not required, and a 'no' on one changes nothing", () => {
  const r = Router.route({ ...base, injuryType: "cut", age: 30, answers: { ...allNo("cut"), thinners: "no", burn_face: "unknown" } });
  assert.equal(r.kind, "results");
  const blank = Router.route({ ...base, injuryType: "cut", age: 30, answers: { thinners: "no" } });
  assert.deepEqual(blank.missing.map((m) => m.id), checklists.types.cut);
});

test("the emergency is returned without simulation data: nearestER is null, nothing throws", () => {
  const answers = { ...allNo("cut"), bleeding: "yes" };
  const broken = [
    { state: undefined }, { state: null }, { user: undefined }, { user: null }, { user: {} },
    { user: { lat: "x", lng: NaN } }, { facilities: undefined }, { facilities: null }, { facilities: {} },
    { facilities: undefined, state: undefined, user: undefined },
  ];
  for (const b of broken) {
    const r = Router.route({ ...base, ...b, injuryType: "cut", age: 30, answers });
    assert.equal(r.kind, "emergency", JSON.stringify(b));
    assert.deepEqual(r.triggered.map((t) => t.id), ["bleeding"]);
    if (!("state" in b) || Object.keys(b).length > 1) assert.equal(r.nearestER, null, JSON.stringify(b));
  }
  // no clock, but facilities and a location: still names the nearest ER
  assert.equal(Router.route({ ...base, state: undefined, injuryType: "cut", age: 30, answers }).nearestER.facility.id, "ER_RAL");
  assert.equal(Router.route({ ...base, facilities: [], injuryType: "cut", age: 30, answers }).nearestER, null);
  assert.equal(Router.route({ injuryType: "cut", checklists, answers }).kind, "emergency");
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

test("emergency goes to an ER even when another kind of facility is nearer", () => {
  const ortho = facilities.find((f) => f.id === "ORTHO_RAL");
  const at = { lat: ortho.lat, lng: ortho.lng };
  const nearestAny = [...facilities].sort((a, b) => Sim.driveMinutes(at, a) - Sim.driveMinutes(at, b))[0];
  assert.notEqual(nearestAny.type, "er", "test premise: the nearest pin is not an ER");
  const r = Router.route({ ...base, user: at, injuryType: "cut", age: 30, answers: { bleeding: "yes" } });
  assert.equal(r.nearestER.facility.type, "er");
  const nearestEr = facilities.filter((f) => f.type === "er").sort((a, b) => Sim.driveMinutes(at, a) - Sim.driveMinutes(at, b))[0];
  assert.equal(r.nearestER.facility.id, nearestEr.id);
  for (const f of facilities) assert.equal(Router.nearestER([f], at, 960) !== null, f.type === "er", f.id);
});

test("emergency ignores wait time: a near ER with a long line beats a far ER with no line", () => {
  const er = (id, lat, lng) => ({ id, label: id, type: "er", lat, lng, hours: "00:00-24:00", xray: true, specialists: [], slots: 5, min_age: 0, max_age: null, treats: ["cut"] });
  const f = [er("FAR", 35.86, -78.68), er("NEAR", 35.79, -78.68)];
  const st = Sim.makeState(960, { NEAR: { waiting: 30, inTreatment: 5 }, FAR: { waiting: 0, inTreatment: 0 } });
  const total = (x) => { const d = Sim.driveMinutes(demo.user, x); return d + Sim.estimateWait(x, st, d).median; };
  assert.ok(total(f[0]) + 60 < total(f[1]), `test premise: FAR is faster overall (${total(f[0])} vs ${total(f[1])})`);
  const r = Router.route({ ...base, facilities: f, state: st, injuryType: "cut", age: 30, answers: { bleeding: "yes" } });
  assert.equal(r.nearestER.facility.id, "NEAR");
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

test("'something else' is the nurse-line screen at every age, with or without an age", () => {
  for (const age of [3, 7, 17, 17.5, 18, 30, undefined, NaN, 130]) {
    assert.equal(Router.route({ ...base, injuryType: "other", age, answers: {} }).kind, "other", String(age));
    assert.equal(Router.route({ ...base, injuryType: "other", age, answers: allNo("child_minor_injury") }).kind, "other", String(age));
  }
});

test("any type outside the list is 'other' for a child too, never the child checklist", () => {
  for (const type of ["chest_pain", "fever", "", undefined, "constructor", "__proto__", "toString"]) {
    for (const age of [7, 30]) {
      const r = Router.route({ ...base, injuryType: type, age, answers: allNo("child_minor_injury") });
      assert.equal(r.kind, "other", `${String(type)}/${age}`);
    }
  }
});

test("child_minor_injury: its own checklist for a child, kids' clinic best fit; 'other' for an adult", () => {
  const none = Router.route({ ...base, injuryType: "child_minor_injury", age: 7, answers: {} });
  assert.equal(none.kind, "incomplete");
  assert.deepEqual(none.missing.map((m) => m.id), checklists.types.child_minor_injury);
  const r = Router.route({ ...base, injuryType: "child_minor_injury", age: 7, answers: allNo("child_minor_injury") });
  assert.equal(r.kind, "results");
  assert.equal(r.injuryType, "child_minor_injury");
  assert.ok(r.ranked.every((x) => x.facility.treats.includes("child_minor_injury")));
  assert.ok(r.ranked.some((x) => x.bestFit && x.facility.type === "peds"));
  const em = Router.route({ ...base, injuryType: "child_minor_injury", age: 7, answers: { ...allNo("child_minor_injury"), sleepy: "yes" } });
  assert.equal(em.kind, "emergency");
  assert.equal(em.triggered[0].id, "sleepy");
  for (const age of [18, 30]) {
    assert.equal(Router.route({ ...base, injuryType: "child_minor_injury", age, answers: allNo("child_minor_injury") }).kind, "other");
  }
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

test("child flag is age under 18: ages 7, 17, 17.5, 17.99 and 18", () => {
  const wrist = (age) => Router.route({ ...base, injuryType: "sprain_or_simple_fracture", age, answers: allNo("sprain_or_simple_fracture") });
  const hasKids = (r) => r.ranked.some((x) => x.facility.type === "peds" && x.bestFit);
  for (const age of [7, 17, 17.5, 17.99]) {
    assert.ok(Router.isChild(age), `isChild ${age}`);
    assert.ok(hasKids(wrist(age)), `kids' clinics at ${age}`);
  }
  assert.ok(!Router.isChild(18));
  assert.ok(!wrist(18).ranked.some((x) => x.facility.type === "peds"));
  const unspecified = (age) => Router.route({ ...base, injuryType: "child_minor_injury", age, answers: allNo("child_minor_injury") });
  assert.equal(unspecified(17.5).kind, "results");
  assert.equal(unspecified(18).kind, "other");
});

test("age is required: blank, negative, non-numeric or absurd ages never route", () => {
  for (const type of ["cut", "child_minor_injury", "sprain_or_simple_fracture"]) {
    for (const age of [undefined, null, NaN, "", "7", "abc", -1, -0.5, Infinity, 121]) {
      const r = Router.route({ ...base, injuryType: type, age, answers: allNo(type) });
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
