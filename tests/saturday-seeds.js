// Run: node tests/saturday-seeds.js            (a few minutes; uses every CPU core)
//      node tests/saturday-seeds.js --seeds=10
//      node tests/saturday-seeds.js --write     also saves data/saturday-spread.json for the page
//
// Robustness check for the Busy Saturday comparison: is the demo seed a lucky one?
// Plays the same afternoon with seeds 1..N (default 50) under all three urgent-care capacity scenarios and
// prints the spread of the difference Triage minus nearest-ER. Negative = Triage lower. Simulated network.
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

for (const f of ["../sim.js", "../router.js", "../saturday.js"]) vm.runInThisContext(fs.readFileSync(new URL(f, import.meta.url), "utf8"));
const facilities = JSON.parse(fs.readFileSync(new URL("../data/facilities.json", import.meta.url)));

const METRICS = [
  ["avgErWait", "Average ER wait (min)"],
  ["avgTimeToTreatment", "Average time to treatment (min)"],
  ["medianTimeToTreatment", "Median time to treatment (min)"],
  ["p90TimeToTreatment", "90th-pct time to treatment (min)"],
  ["over3h", "People waiting over 3 hours"],
  ["afterClosing", "Treated after closing time"],
  ["avgOtherClinicWait", "Avg wait, others at clinics (min)"],
];

if (!isMainThread) {
  parentPort.on("message", ({ seed, scenario }) => {
    const r = Saturday.compare({ facilities, seed, scenario });
    const pick = (s) => Object.fromEntries(METRICS.map(([k]) => [k, s[k]]));
    parentPort.postMessage({ seed, scenario, baseline: pick(r.baseline), triage: pick(r.triage) });
  });
} else {
  const arg = process.argv.find((a) => a.startsWith("--seeds="));
  const count = arg ? Number(arg.slice(8)) : 50;
  const demoSeed = Saturday.SETTINGS.DEMO_SEED;
  const seeds = Array.from({ length: count }, (_, i) => i + 1);
  const jobs = [];
  for (const seed of new Set([demoSeed, ...seeds])) for (const scenario of Saturday.SCENARIOS) jobs.push({ seed, scenario });
  const total = jobs.length;
  const done = [];

  await new Promise((resolve, reject) => {
    const size = Math.min(os.availableParallelism(), total);
    let running = size;
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL(import.meta.url));
      const next = () => {
        const job = jobs.pop();
        if (job) { w.postMessage(job); return; }
        w.terminate();
        if (--running === 0) resolve();
      };
      w.on("message", (r) => {
        done.push(r);
        process.stderr.write(`\r${done.length}/${total} afternoons`);
        next();
      });
      w.on("error", reject);
      next();
    }
  });
  process.stderr.write("\n");

  const quantile = (xs, q) => {
    const s = [...xs].sort((a, b) => a - b);
    const pos = (s.length - 1) * q;
    return s[Math.floor(pos)] + (s[Math.ceil(pos)] - s[Math.floor(pos)]) * (pos - Math.floor(pos));
  };
  // "median [min..max]" over the seeds
  const spread = (xs) => `${Math.round(quantile(xs, 0.5))} [${Math.round(Math.min(...xs))}..${Math.round(Math.max(...xs))}]`;

  console.log(`Busy Saturday, simulated network: ${count} seeds (1..${count}), shown as median [min..max] over the seeds.`);
  console.log(`Difference = Triage minus nearest ER, so negative = lower with Triage.`);
  console.log(`"Demo" is the on-screen seed ${demoSeed}${seeds.includes(demoSeed) ? `, one of the ${count}` : `, which is not one of the ${count}`}.`);
  const typical = {};
  for (const scenario of Saturday.SCENARIOS) {
    const rows = done.filter((r) => r.scenario === scenario);
    const demo = rows.find((r) => r.seed === demoSeed);
    const rest = rows.filter((r) => seeds.includes(r.seed));
    const gaps = rest.map((r) => r.baseline.avgTimeToTreatment - r.triage.avgTimeToTreatment);
    typical[scenario] = { median: quantile(gaps, 0.5), min: Math.min(...gaps), max: Math.max(...gaps) };
    console.log(`\n${scenario.toUpperCase()} urgent-care capacity (${Saturday.SETTINGS.URGENT_SLOTS[scenario]} slots per urgent care)`);
    console.log(`  ${"".padEnd(34)}${"nearest ER".padEnd(18)}${"Triage".padEnd(18)}${"difference".padEnd(20)}${"Triage lower".padEnd(14)}${"demo: ER -> Triage (diff)".padEnd(27)}seeds worse than demo: Triage, difference`);
    for (const [key, label] of METRICS) {
      const diffs = rest.map((r) => r.triage[key] - r.baseline[key]);
      const d = demo.triage[key] - demo.baseline[key];
      const lower = diffs.filter((x) => x < 0).length;
      // Every number here is "lower is better", so a seed is worse than the demo seed when its number is higher.
      const worseTriage = rest.filter((r) => r.triage[key] > demo.triage[key]).length;
      const worseDiff = diffs.filter((x) => x > d).length;
      console.log(`  ${label.padEnd(34)}${spread(rest.map((r) => r.baseline[key])).padEnd(18)}${spread(rest.map((r) => r.triage[key])).padEnd(18)}` +
        `${spread(diffs).padEnd(20)}${`${lower}/${count}`.padEnd(14)}` +
        `${`${Math.round(demo.baseline[key])} -> ${Math.round(demo.triage[key])} (${Math.round(d)})`.padEnd(27)}${`${worseTriage}/${count}`.padEnd(8)}${worseDiff}/${count}`);
    }
  }
  console.log(`\n"Triage lower" = seeds where the Triage number is lower than the nearest-ER number.`);
  console.log(`"seeds worse than demo" = seeds where the Triage number itself, or the difference, came out less favourable`);
  console.log(`  to Triage than on the demo seed. Around ${Math.round(count / 2)}/${count}: the demo seed is typical. Near ${count}/${count}: the demo seed makes`);
  console.log(`  Triage look better than usual (a lucky seed). Near 0/${count}: worse than usual.`);

  // The page's "Typical result across 50 simulated Saturdays" line reads this file.
  if (process.argv.includes("--write")) {
    const file = new URL("../data/saturday-spread.json", import.meta.url);
    fs.writeFileSync(file, `${JSON.stringify({
      _note: "Written by: node tests/saturday-seeds.js --write. Minutes by which average time to treatment (drive + wait) was lower with Triage than with nearest ER, over the seeds. Simulated network.",
      seeds: count, avgTimeToTreatmentLowerWithTriage: typical,
    }, null, 2)}\n`);
    console.log(`\nWrote data/saturday-spread.json`);
  }
}
