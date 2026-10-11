// Run: node tests/sim.test.js   (loads sim.js the same way the browser does: as a plain script)
import vm from "node:vm";
import fs from "node:fs";
import assert from "node:assert/strict";

vm.runInThisContext(fs.readFileSync(new URL("../sim.js", import.meta.url), "utf8"));
const facilities = JSON.parse(fs.readFileSync(new URL("../data/facilities.json", import.meta.url)));
const demo = JSON.parse(fs.readFileSync(new URL("../data/demo-state.json", import.meta.url)));
const byId = Object.fromEntries(facilities.map((f) => [f.id, f]));
const mk = (nowMin, counts = demo.facilities) => Sim.makeState(nowMin, counts);
const show = process.argv.includes("--show");

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FAIL ", name, "\n     ", e.message); }
}

test("same seed gives identical ranges", () => {
  const a = Sim.estimateWait(byId.ER_RAL, mk(960), 10);
  const b = Sim.estimateWait(byId.ER_RAL, mk(960), 10);
  assert.deepEqual(a, b);
});

test("ranges are ordered and rounded to 5 minutes", () => {
  for (const f of facilities) {
    const r = Sim.estimateWait(f, mk(960), 10);
    if (!r) continue;
    assert.ok(r.low <= r.high, f.id);
    assert.equal(r.low % 5, 0); assert.equal(r.high % 5, 0);
  }
});

test("ER ranges are longer in the evening than in the morning, same starting lines", () => {
  for (const id of ["ER_RAL", "ER_DUR", "ER_CH", "ER_CARY"]) {
    const am = Sim.estimateWait(byId[id], mk(9 * 60), 10);
    const pm = Sim.estimateWait(byId[id], mk(18 * 60), 10);
    if (show) console.log(id, "9AM", am.low, am.high, "6PM", pm.low, pm.high);
    assert.ok(pm.median > am.median, `${id}: ${pm.median} vs ${am.median}`);
  }
});

test("ranges change with load (more waiting => longer)", () => {
  const light = mk(960, { ...demo.facilities, UC_NRAL: { waiting: 0, inTreatment: 1 } });
  const heavy = mk(960, { ...demo.facilities, UC_NRAL: { waiting: 12, inTreatment: 3 } });
  const a = Sim.estimateWait(byId.UC_NRAL, light, 10);
  const b = Sim.estimateWait(byId.UC_NRAL, heavy, 10);
  assert.ok(b.median > a.median, `${b.median} vs ${a.median}`);
});

test("a pick lengthens the next person's wait at that facility, and only there", () => {
  const base = mk(960);
  let picked = base;
  for (let i = 0; i < 4; i++) picked = Sim.addPick(picked, "ORTHO_RAL", 12);
  const before = Sim.estimateWait(byId.ORTHO_RAL, base, 15);
  const after = Sim.estimateWait(byId.ORTHO_RAL, picked, 15);
  const otherBefore = Sim.estimateWait(byId.ORTHO_CH, base, 15);
  const otherAfter = Sim.estimateWait(byId.ORTHO_CH, picked, 15);
  assert.ok(after.median > before.median, `${after.median} vs ${before.median}`);
  assert.deepEqual(otherAfter, otherBefore);
});

test("a recommendation alone changes nothing (addPick is pure)", () => {
  const s = mk(960);
  Sim.addPick(s, "ER_RAL", 10);
  assert.equal(s.picks.length, 0);
});

test("closed facility returns null", () => {
  assert.equal(Sim.estimateWait(byId.ORTHO_RAL, mk(21 * 60), 10), null);
  assert.ok(Sim.estimateWait(byId.ER_RAL, mk(21 * 60), 10));
});

test("CONSTANTS match PLAN starting values", () => {
  const c = Sim.CONSTANTS;
  assert.deepEqual(c.MINOR_ARRIVALS_PER_HOUR, { er: 9, urgent: 5, ortho: 3, peds: 4 });
  assert.equal(c.EMERGENCY_ARRIVALS_PER_HOUR.er, 3);
  assert.equal(c.RUNS, 200); assert.equal(c.HORIZON_MIN, 180);
});

if (show) {
  const user = demo.user;
  for (const f of facilities) {
    const d = Sim.driveMinutes(user, f);
    const r = Sim.estimateWait(f, mk(demo.nowMin), d);
    console.log(f.id.padEnd(10), "drive", d.toFixed(0).padStart(3), r ? `${r.low}-${r.high} (median ${r.median.toFixed(0)}, censored ${r.censoredShare})` : "closed");
  }
}
process.exit(failed ? 1 : 0);
