// Run: node tests/about-results.js            (several minutes; uses every CPU core)
//      node tests/about-results.js --seeds=10
//      node tests/about-results.js --write     also saves data/about-results.json for the About page
//
// Works out every simulated number on the About page: the demo-seed Busy Saturday in all three capacity
// scenarios, one ER's wait range through the afternoon, the adoption curve over seeds 1..N (default 50, the
// same seeds as tests/saturday-seeds.js) and the herding test. The About page only reads the saved file,
// because the adoption curve alone is hundreds of simulated afternoons. tests/about.test.js checks the
// saved file against fresh runs. Simulated network.
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

for (const f of ["../sim.js", "../router.js", "../saturday.js", "../about-sim.js"]) {
  vm.runInThisContext(fs.readFileSync(new URL(f, import.meta.url), "utf8"));
}
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const facilities = read("../data/facilities.json");

// What the page shows from one side's summary. Trips and per-facility background counts are left out.
const KEYS = ["avgErWait", "erPatients", "avgTimeToTreatment", "medianTimeToTreatment", "p90TimeToTreatment",
  "over3h", "afterClosing", "byType", "byFacility", "avgOtherClinicWait", "otherClinicPatients"];
const slim = (s) => Object.fromEntries(KEYS.map((k) => [k, s[k]]));
const CURVES = ["avgErWait", "avgTimeToTreatment", "avgOtherClinicWait", "over3h"];

if (!isMainThread) {
  parentPort.on("message", (job) => {
    if (job.kind === "herding") {
      const h = AboutSim.herding({ facilities, scenario: job.scenario });
      const side = (s) => ({ ...slim(s), longestWaitByFacility: AboutSim.longestWaitByFacility(s) });
      parentPort.postMessage({ ...job, aware: side(h.aware), naive: side(h.naive) });
    } else {
      parentPort.postMessage({ ...job, summary: slim(AboutSim.adoption({ facilities, ...job })) });
    }
  });
} else {
  const arg = process.argv.find((a) => a.startsWith("--seeds="));
  const count = arg ? Number(arg.slice(8)) : 50;
  const demoSeed = Saturday.SETTINGS.DEMO_SEED;
  const seeds = Array.from({ length: count }, (_, i) => i + 1);
  const shares = AboutSim.SETTINGS.ADOPTION_SHARES;
  const jobs = [];
  for (const scenario of Saturday.SCENARIOS) {
    jobs.push({ kind: "herding", scenario });
    for (const seed of new Set([demoSeed, ...seeds])) for (const share of shares) jobs.push({ kind: "adoption", seed, scenario, share });
  }
  jobs.sort((a, b) => (a.share ?? 1) - (b.share ?? 1)); // popped from the end: the slow ones go first
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

  const q = AboutSim.quantile;
  const [lowQ, highQ] = AboutSim.SETTINGS.INTERVAL;
  const find = (scenario, seed, share) => done.find((r) => r.kind === "adoption" && r.scenario === scenario && r.seed === seed && r.share === share).summary;

  const saturday = {};
  const adoption = {};
  const ratio = {};
  const lower = {};
  for (const scenario of Saturday.SCENARIOS) {
    // 0% is Saturday's nearest-ER side and 100% its Triage side (tests/about.test.js checks that).
    saturday[scenario] = { baseline: find(scenario, demoSeed, 0), triage: find(scenario, demoSeed, 1) };
    adoption[scenario] = Object.fromEntries(CURVES.map((key) => [key, shares.map((share) => {
      const xs = seeds.map((seed) => find(scenario, seed, share)[key]);
      return { share, median: q(xs, 0.5), low: q(xs, lowQ), high: q(xs, highQ), min: Math.min(...xs), max: Math.max(...xs), demo: find(scenario, demoSeed, share)[key] };
    })]));
    const ratios = seeds.map((seed) => find(scenario, seed, 1).avgTimeToTreatment / find(scenario, seed, 0).avgTimeToTreatment);
    ratio[scenario] = { median: q(ratios, 0.5), min: Math.min(...ratios), max: Math.max(...ratios), demo: saturday[scenario].triage.avgTimeToTreatment / saturday[scenario].baseline.avgTimeToTreatment };
    const gaps = seeds.map((seed) => find(scenario, seed, 0).avgTimeToTreatment - find(scenario, seed, 1).avgTimeToTreatment);
    lower[scenario] = { median: q(gaps, 0.5), min: Math.min(...gaps), max: Math.max(...gaps) };
  }

  const herding = Object.fromEntries(Saturday.SCENARIOS.map((scenario) => {
    const h = done.find((r) => r.kind === "herding" && r.scenario === scenario);
    return [scenario, { aware: h.aware, naive: h.naive }];
  }));

  const demo = read("../data/demo-state.json");
  const er = facilities.find((f) => f.id === "ER_RAL");
  const waitBand = { label: er.label, ...AboutSim.waitBand(er, Sim.makeState(demo.nowMin, demo.facilities)) };

  const fmt = (x) => String(Math.round(x)).padStart(5);
  console.log(`About page results, simulated network. Demo seed ${demoSeed}; adoption over seeds 1..${count}.`);
  for (const scenario of Saturday.SCENARIOS) {
    console.log(`\n${scenario.toUpperCase()} urgent-care capacity`);
    console.log(`  time to treatment with Triage / nearest ER: demo seed ${ratio[scenario].demo.toFixed(2)}, ` +
      `median ${ratio[scenario].median.toFixed(2)} [${ratio[scenario].min.toFixed(2)}..${ratio[scenario].max.toFixed(2)}]`);
    console.log(`  share using Triage:                 ${shares.map((s) => `${String(s * 100).padStart(4)}%`).join(" ")}`);
    for (const key of CURVES) console.log(`  ${key.padEnd(34)}${adoption[scenario][key].map((p) => fmt(p.median)).join(" ")}   (median over seeds)`);
    const { aware, naive } = herding[scenario];
    console.log(`  herding, capacity-aware vs naive: avg time to treatment ${fmt(aware.avgTimeToTreatment)} vs ${fmt(naive.avgTimeToTreatment)}, ` +
      `over 3 h ${aware.over3h} vs ${naive.over3h}, busiest place ${Math.max(...Object.values(aware.byFacility))} vs ${Math.max(...Object.values(naive.byFacility))} people`);
  }

  // The same seeds as tests/saturday-seeds.js, so the two files must agree. Say so loudly if they do not.
  if (fs.existsSync(new URL("../data/saturday-spread.json", import.meta.url))) {
    const spread = read("../data/saturday-spread.json");
    if (spread.seeds === count) {
      const same = Saturday.SCENARIOS.every((k) => ["median", "min", "max"].every((m) =>
        Math.abs(spread.avgTimeToTreatmentLowerWithTriage[k][m] - lower[k][m]) < 1e-6));
      console.log(`\ndata/saturday-spread.json ${same ? "agrees" : "DOES NOT AGREE"} with these runs.`);
      if (!same) process.exitCode = 1;
    }
  }

  if (process.argv.includes("--write")) {
    const file = new URL("../data/about-results.json", import.meta.url);
    fs.writeFileSync(file, `${JSON.stringify({
      _note: "Written by: node tests/about-results.js --write. Every number is from the simulated network. Times are minutes. Checked against fresh runs by tests/about.test.js.",
      demoSeed, seeds: count, interval: AboutSim.SETTINGS.INTERVAL, shares,
      saturday, ratio, adoption, herding, waitBand,
    }, null, 1)}\n`);
    console.log(`\nWrote data/about-results.json`);
  }
}
