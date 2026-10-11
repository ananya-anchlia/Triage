// UI wiring only for the Busy Saturday page. Logic lives in saturday.js (which uses sim.js and router.js).

const $ = (id) => document.getElementById(id);
const TYPE_NAMES = { er: "Hospital ER", urgent: "Urgent care", ortho: "Ortho walk-in", peds: "Kids' urgent care" };

let facilities = null;
let spread = null; // data/saturday-spread.json, written by tests/saturday-seeds.js --write
let results = {}; // { [scenario]: result } for the run on screen
let progress = {}; // { [scenario]: people assigned so far }
let workers = [];
let running = false;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function duration(min) {
  const m = Math.round(min);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

const selected = () => document.querySelector("input[name=scenario]:checked").value;

// label, how to read it off one side's summary
const ROWS = [
  ["Average ER wait", (s) => duration(s.avgErWait)],
  ["Average time to treatment (drive + wait)", (s) => duration(s.avgTimeToTreatment)],
  ["Median time to treatment", (s) => duration(s.medianTimeToTreatment)],
  ["90th-percentile time to treatment", (s) => duration(s.p90TimeToTreatment)],
  ["People who waited over 3 hours", (s) => `${s.over3h} of ${Saturday.SETTINGS.PEOPLE}`],
  ...Object.entries(TYPE_NAMES).map(([type, name]) => [`Went to: ${name}`, (s) => String(s.byType[type])]),
  ["Treated after the place's closing time", (s) => String(s.afterClosing)],
  ["Average wait, other patients at clinics", (s) => duration(s.avgOtherClinicWait)],
];

function renderSide(box, s) {
  const dl = el("dl");
  for (const [label, read] of ROWS) {
    dl.append(el("dt", {}, label), el("dd", {}, read(s)));
  }
  box.replaceChildren(dl, el("p", { className: "small" }, "simulated network"));
}

function render() {
  const scenario = selected();
  const r = results[scenario];
  $("sides").hidden = !r;
  if (r) {
    renderSide($("side-baseline"), r.baseline);
    renderSide($("side-triage"), r.triage);
  }

  const typical = r && spread && spread.avgTimeToTreatmentLowerWithTriage[scenario];
  $("typical").hidden = !typical;
  if (typical) {
    $("typical").textContent = `Typical result across ${spread.seeds} simulated Saturdays: average time to treatment ` +
      `${duration(typical.median)} lower with Triage (range ${duration(typical.min)} to ${duration(typical.max)}). Simulated network.`;
  }

  const have = Saturday.SCENARIOS.filter((k) => results[k]);
  $("all-scenarios").hidden = have.length === 0;
  $("all-body").replaceChildren(...ROWS.map(([label, read]) => {
    const tr = el("tr", {}, el("th", { scope: "row" }, label));
    for (const k of Saturday.SCENARIOS) {
      const x = results[k];
      tr.append(el("td", {}, x ? read(x.baseline) : "…"), el("td", {}, x ? read(x.triage) : "…"));
    }
    return tr;
  }));

  if (running) {
    const waiting = Saturday.SCENARIOS.filter((k) => !results[k]);
    $("run-status").textContent = waiting.length === 0 ? "" : r
      ? `Still simulating: ${waiting.join(" and ")} capacity.`
      : `Simulating the afternoon: person ${progress[scenario] || 0} of ${Saturday.SETTINGS.PEOPLE}...`;
  }
}

function finish(scenario, result) {
  results[scenario] = result;
  if (Saturday.SCENARIOS.every((k) => results[k])) {
    running = false;
    $("run-btn").disabled = false;
    $("run-status").textContent = "";
  }
  render();
}

// Without Web Workers the same code runs on the page itself: one scenario at a time, in the order asked
// for, a few people per turn so the page can still redraw.
const pageQueue = [];

function runOnPage(scenario) {
  pageQueue.push(scenario);
  if (pageQueue.length === 1) runNextOnPage();
}

function runNextOnPage() {
  if (pageQueue.length === 0) return;
  const scenario = pageQueue[0];
  const run = Saturday.start({ facilities, scenario });
  const tick = () => {
    const done = run.step(5);
    progress[scenario] = run.assigned();
    if (!done) { render(); setTimeout(tick, 0); return; }
    pageQueue.shift();
    finish(scenario, run.result());
    runNextOnPage();
  };
  setTimeout(tick, 0);
}

function runScenario(scenario) {
  let worker;
  try {
    worker = new Worker("saturday-worker.js");
  } catch (err) {
    runOnPage(scenario);
    return;
  }
  workers.push(worker);
  worker.onmessage = (e) => {
    if (e.data.result) {
      worker.terminate();
      finish(scenario, e.data.result);
    } else {
      progress[scenario] = e.data.assigned;
      if (scenario === selected()) render();
    }
  };
  worker.onerror = () => {
    worker.terminate();
    if (!results[scenario]) runOnPage(scenario);
  };
  worker.postMessage({ facilities, scenario });
}

// Plays all three capacity scenarios from scratch every time, the selected one first.
function runAfternoon() {
  if (!facilities || running) return;
  for (const w of workers) w.terminate();
  workers = [];
  results = {};
  progress = {};
  running = true;
  $("run-btn").disabled = true;
  const first = selected();
  for (const scenario of [first, ...Saturday.SCENARIOS.filter((k) => k !== first)]) runScenario(scenario);
  render();
}

$("seed").textContent = String(Saturday.SETTINGS.DEMO_SEED);
for (const span of document.querySelectorAll("[data-slots]")) {
  span.textContent = String(Saturday.SETTINGS.URGENT_SLOTS[span.dataset.slots]);
}
$("run-btn").addEventListener("click", runAfternoon);
for (const radio of document.querySelectorAll("input[name=scenario]")) radio.addEventListener("change", render);

$("run-btn").disabled = true;
fetch("data/facilities.json")
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  .then((f) => { facilities = f; $("run-btn").disabled = false; })
  .catch(() => { $("run-status").textContent = "The facility list didn't load. Reload the page."; });
// Optional: without it the "typical result" line is simply left out.
fetch("data/saturday-spread.json")
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => { spread = d; render(); })
  .catch(() => {});
