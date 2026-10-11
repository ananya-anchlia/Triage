// UI wiring only for the About page. The numbers come from data/about-results.json (written by
// tests/about-results.js from sim.js, router.js, saturday.js and about-sim.js) and data/saturday-spread.json.
// The wait-range chart, the parameter table and the safety table are worked out here, live, by the same code
// the app uses.

const $ = (id) => document.getElementById(id);
const TYPE_ORDER = ["er", "urgent", "ortho", "peds"];
const SCENARIO_NAMES = { low: "low", medium: "medium", high: "high" };
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const SERIES_1 = css("--series-1");
const SERIES_2 = css("--series-2");
const INK = css("--ink");

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function duration(min) {
  const m = Math.round(min);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

// A share in plain words, only when the number really is close to that fraction.
function fractionWords(x) {
  for (const [value, words] of [[1 / 4, "about a quarter"], [1 / 3, "about a third"], [1 / 2, "about half"]]) {
    if (Math.abs(x - value) <= 0.04) return words;
  }
  return `${Math.round(x * 100)}%`;
}

function clock(minuteOfDay) {
  const h = Math.floor(minuteOfDay / 60) % 24;
  const m = minuteOfDay % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const hex = (color, alpha) => {
  const n = parseInt(color.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

const row = (label, cells) => el("tr", {}, el("th", { scope: "row", className: "text" }, label), ...cells.map((c) => el("td", {}, c)));

// ---- Charts ------------------------------------------------------------------------------------------

const hasCharts = typeof Chart !== "undefined";
const hourTicks = { stepSize: 60, callback: (v) => (v === 0 ? "0" : `${v / 60} h`) };
const grid = { color: "rgba(6, 60, 95, 0.12)" };

if (hasCharts) {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 15;
  Chart.defaults.color = INK;
  Chart.defaults.plugins.legend.display = false; // each chart has its legend in the page, in text
  Chart.defaults.animation = false;
  Chart.defaults.maintainAspectRatio = false;
}

// Without Chart.js (no internet), the numbers are still there: the table under each chart opens.
function chartOrTable(canvasId, make) {
  const canvas = $(canvasId);
  if (hasCharts) { make(canvas); return; }
  const box = canvas.parentElement;
  box.classList.add("offline");
  box.replaceChildren("The chart library didn't load (it comes from the internet). The numbers are in the table below.");
  box.parentElement.querySelector("details.table-view").open = true;
}

const hidden = { borderWidth: 0, pointRadius: 0, pointHitRadius: 0 };

// ---- Hero and section 5: the demo Saturday -------------------------------------------------------------

function renderHero(data, spread) {
  const { baseline: b, triage: t } = data.saturday.medium;
  if (t.avgTimeToTreatment < b.avgTimeToTreatment) {
    $("lead").textContent = "On a simulated busy Saturday at medium urgent-care capacity, people routed by Triage " +
      `reached treatment in ${fractionWords(t.avgTimeToTreatment / b.avgTimeToTreatment)} of the time.`;
  } else {
    $("lead").textContent = "On a simulated busy Saturday at medium urgent-care capacity, people routed by Triage did not reach treatment sooner.";
  }
  const max = Math.max(b.avgTimeToTreatment, t.avgTimeToTreatment, b.avgOtherClinicWait, t.avgOtherClinicWait);
  const bar = (who, value, className) => [
    el("div", { className: "who" }, who),
    el("div", { className: `bar ${className}` }, el("i", { style: `width: ${(value / max) * 78}%` }), el("b", {}, duration(value))),
  ];
  $("hero-bars").replaceChildren(
    el("h3", {}, "Average time to treatment for the 300 (approx. drive + wait)"),
    ...bar("Everyone to the nearest ER", b.avgTimeToTreatment, "base"),
    ...bar("Routed by Triage", t.avgTimeToTreatment, ""),
    el("h3", {}, "What it cost: average wait for the clinics' other patients"),
    ...bar("Everyone to the nearest ER", b.avgOtherClinicWait, "base"),
    ...bar("Routed by Triage", t.avgOtherClinicWait, "cost"));

  const parts = [`Medium urgent-care capacity, seed ${data.demoSeed}: the seed whose results sit closest to the middle of ${data.seeds}.`];
  const typical = spread && spread.avgTimeToTreatmentLowerWithTriage.medium;
  if (typical) {
    parts.push(`Across ${spread.seeds} simulated Saturdays, average time to treatment was ${duration(typical.median)} lower with Triage ` +
      `(range ${duration(typical.min)} to ${duration(typical.max)}).`);
  }
  const pct = (k) => `${Math.round(data.ratio[k].demo * 100)}%`;
  parts.push(`The result depends on urgent-care capacity. Triage's time as a share of the nearest-ER time: ${pct("low")} at low capacity, ${pct("medium")} at medium, ${pct("high")} at high.`);
  parts.push(`People who waited over 3 hours: ${b.over3h} of 300 at the nearest ER, ${t.over3h} with Triage. ` +
    `${t.afterClosing} people routed by Triage were treated after the place's closing time.`);
  $("hero-spread").textContent = parts.join(" ");
}

function renderSaturdayTable(data) {
  const rows = [
    ["Average ER wait", (s) => duration(s.avgErWait)],
    ["Average time to treatment", (s) => duration(s.avgTimeToTreatment)],
    ["Waited over 3 hours (of 300)", (s) => String(s.over3h)],
    ["Treated after closing time", (s) => String(s.afterClosing)],
    ["Average wait, clinics' other patients", (s) => duration(s.avgOtherClinicWait)],
  ];
  $("saturday-table").tBodies[0].replaceChildren(...rows.map(([label, read]) =>
    row(label, Object.keys(SCENARIO_NAMES).flatMap((k) => [read(data.saturday[k].baseline), read(data.saturday[k].triage)]))));
}

// ---- Section 3: parameters, read from sim.js -------------------------------------------------------------

function renderParams(facilities) {
  const c = Sim.CONSTANTS;
  const slots = (type) => {
    const xs = [...new Set(facilities.filter((f) => f.type === type).map((f) => f.slots))].sort((a, b) => a - b);
    return xs.length > 1 ? `${xs[0]}–${xs[xs.length - 1]}` : String(xs[0]);
  };
  const per = (read) => TYPE_ORDER.map((type) => String(read(type)));
  $("param-table").tBodies[0].replaceChildren(
    row("Places in the network", per((t) => facilities.filter((f) => f.type === t).length)),
    row("Treatment slots per place", per(slots)),
    row("Minor-injury arrivals per hour (Saturday afternoon)", per((t) => c.MINOR_ARRIVALS_PER_HOUR[t])),
    row("Emergency arrivals per hour", per((t) => c.EMERGENCY_ARRIVALS_PER_HOUR[t])),
    row("Average treatment time, minutes", per((t) => (t === "er" ? `${c.MEAN_TREATMENT_MIN[t]} (emergencies ${c.MEAN_EMERGENCY_TREATMENT_MIN})` : c.MEAN_TREATMENT_MIN[t]))),
    row("Arrivals by hour, against the afternoon", [`${Math.min(...c.HOURLY_MULTIPLIER)}× overnight to ${Math.max(...c.HOURLY_MULTIPLIER)}× in the evening`, "same", "same", "same"]),
    row("Wait range", [`${c.RUNS} runs of ${c.HORIZON_MIN / 60} hours; ${c.LOW_PCT * 100}th–${c.HIGH_PCT * 100}th percentile`, "same", "same", "same"]));
}

// ---- Section 4: one ER's wait range, live from Sim.runWait ------------------------------------------------

function renderBand(facilities, demo) {
  const er = facilities.find((f) => f.id === "ER_RAL");
  const state = Sim.makeState(demo.nowMin, demo.facilities);
  const band = AboutSim.waitBand(er, state);
  const times = band.points.map((p) => clock((demo.nowMin + p.t) % 1440));
  $("band-title").textContent = `${er.label}: simulated wait by arrival time, Saturday from ${clock(demo.nowMin)}`;
  $("band-runs").textContent = String(band.runs);

  const drive = Sim.driveMinutes(demo.user, er);
  const now = Sim.estimateWait(er, state, drive);
  if (now) {
    $("band-readout").replaceChildren(`${er.label}, leaving the demo location now: `, el("b", {}, `${now.low}–${now.high} min`),
      " simulated wait range. The same number the app shows.");
  }

  $("band-table").tBodies[0].replaceChildren(...band.points.map((p, i) =>
    row(times[i], [p.p10, p.p25, p.p50, p.p75, p.p90].map((x) => `${Math.round(x)} min`))));

  chartOrTable("band-chart", (canvas) => new Chart(canvas, {
    type: "line",
    data: {
      labels: times,
      datasets: [
        { data: band.points.map((p) => p.p10), ...hidden },
        { data: band.points.map((p) => p.p90), ...hidden, fill: "-1", backgroundColor: hex(SERIES_1, 0.18) },
        { data: band.points.map((p) => p.p25), ...hidden },
        { data: band.points.map((p) => p.p75), ...hidden, fill: "-1", backgroundColor: hex(SERIES_1, 0.32) },
        { label: "Median", data: band.points.map((p) => p.p50), borderColor: SERIES_1, backgroundColor: SERIES_1, borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6 },
      ],
    },
    options: {
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { title: { display: true, text: "Arrival time" }, grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: "Simulated wait" }, ticks: hourTicks, grid },
      },
      plugins: {
        tooltip: {
          filter: (item) => item.datasetIndex === 4,
          callbacks: {
            label: (item) => `Median ${duration(item.parsed.y)}`,
            afterLabel: (item) => {
              const p = band.points[item.dataIndex];
              return [`Middle half: ${duration(p.p25)} to ${duration(p.p75)}`, `10th to 90th: ${duration(p.p10)} to ${duration(p.p90)}`];
            },
          },
        },
      },
    },
  }));
}

// ---- Section 5: adoption ---------------------------------------------------------------------------------

let adoptChart = null;

function renderAdoption(data, scenario) {
  const a = data.adoption[scenario];
  const er = a.avgErWait;
  const clinic = a.avgOtherClinicWait;
  const pct = (p) => `${Math.round(p.share * 100)}%`;
  for (const b of $("adopt-capacity").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.scenario === scenario));
  for (const s of document.querySelectorAll(".seed-count")) s.textContent = String(data.seeds);

  const last = er.length - 1;
  const half = er.find((p) => p.share === 0.5) || er[last];
  $("adopt-readout").replaceChildren(
    "Average ER wait: ", el("b", {}, duration(er[0].median)), " with nobody using Triage, ",
    el("b", {}, duration(er[1].median)), ` at ${pct(er[1])}, `, el("b", {}, duration(half.median)), ` at ${pct(half)}, `,
    el("b", {}, duration(er[last].median)), ` at ${pct(er[last])}. The clinics' other patients: `,
    el("b", {}, duration(clinic[0].median)), " at 0%, ", el("b", {}, duration(clinic[last].median)), ` at ${pct(clinic[last])}.`,
    el("span", { className: "fine" }, ` Medians of ${data.seeds} simulated Saturdays, ${SCENARIO_NAMES[scenario]} capacity.`));

  const range = (p) => `${duration(p.median)} (${duration(p.low)} to ${duration(p.high)})`;
  $("adopt-table").tHead.replaceChildren(el("tr", {}, el("th", { className: "text" }, "Share using Triage"), ...er.map((p) => el("th", {}, pct(p)))));
  $("adopt-table").tBodies[0].replaceChildren(
    row("Average ER wait", er.map(range)),
    row("Average wait, clinics' other patients", clinic.map(range)),
    row("Average time to treatment, the 300", a.avgTimeToTreatment.map(range)),
    row("Waited over 3 hours (of 300)", a.over3h.map((p) => `${Math.round(p.median)} (${Math.round(p.low)} to ${Math.round(p.high)})`)));

  const xy = (points, key) => points.map((p) => ({ x: p.share * 100, y: p[key] }));
  const datasets = [
    { data: xy(er, "low"), ...hidden },
    { data: xy(er, "high"), ...hidden, fill: "-1", backgroundColor: hex(SERIES_1, 0.2) },
    { data: xy(clinic, "low"), ...hidden },
    { data: xy(clinic, "high"), ...hidden, fill: "-1", backgroundColor: hex(SERIES_2, 0.2) },
    { label: "Average ER wait", data: xy(er, "median"), borderColor: SERIES_1, backgroundColor: SERIES_1, borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, clip: 10, band: er },
    { label: "Clinics' other patients", data: xy(clinic, "median"), borderColor: SERIES_2, backgroundColor: SERIES_2, borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, clip: 10, pointStyle: "rectRot", band: clinic },
  ];
  if (adoptChart) {
    adoptChart.data.datasets = datasets;
    adoptChart.update();
    return;
  }
  chartOrTable("adopt-chart", (canvas) => {
    adoptChart = new Chart(canvas, {
      type: "line",
      data: { datasets },
      options: {
        interaction: { mode: "nearest", axis: "x", intersect: false },
        scales: {
          x: {
            type: "linear", min: 0, max: 100, grid: { display: false },
            title: { display: true, text: "Share of the 300 who use Triage" },
            afterBuildTicks: (axis) => { axis.ticks = data.shares.map((s) => ({ value: s * 100 })); },
            ticks: { callback: (v) => `${v}%` },
          },
          y: { beginAtZero: true, title: { display: true, text: "Average wait" }, ticks: hourTicks, grid },
        },
        plugins: {
          tooltip: {
            filter: (item) => item.datasetIndex >= 4,
            callbacks: {
              title: (items) => (items.length ? `${items[0].parsed.x}% use Triage` : ""),
              label: (item) => {
                const p = item.dataset.band[item.dataIndex];
                return `${item.dataset.label}: ${duration(p.median)} (middle 80%: ${duration(p.low)} to ${duration(p.high)})`;
              },
            },
          },
        },
      },
    });
  });
}

// ---- Section 6: herding -------------------------------------------------------------------------------------

function renderHerding(data, facilities) {
  const { aware, naive } = data.herding.medium;
  // The place where someone waited longest on the naive side, and the same place with Triage.
  const [worstId, worstWait] = Object.entries(naive.longestWaitByFacility).sort((x, y) => y[1] - x[1])[0];
  const worst = facilities.find((f) => f.id === worstId);
  $("herd-readout").replaceChildren(
    "Naive: ", el("b", {}, String(naive.byFacility[worstId])), ` of 300 sent to ${worst.label} (${worst.slots} treatment slots); the longest wait there was `,
    el("b", {}, duration(worstWait)), ". Triage: ", el("b", {}, String(aware.byFacility[worstId])), " sent there, longest wait ",
    el("b", {}, duration(aware.longestWaitByFacility[worstId] ?? 0)), ". ",
    `Average time to treatment: ${duration(naive.avgTimeToTreatment)} naive, ${duration(aware.avgTimeToTreatment)} with Triage.`);

  const longest = (side) => Math.max(0, ...Object.values(side.longestWaitByFacility));
  const rows = [
    ["Average time to treatment", (s) => duration(s.avgTimeToTreatment)],
    ["90th-percentile time to treatment", (s) => duration(s.p90TimeToTreatment)],
    ["Waited over 3 hours (of 300)", (s) => String(s.over3h)],
    ["Most people sent to one place", (s) => String(Math.max(...Object.values(s.byFacility)))],
    ["Longest wait anywhere", (s) => duration(longest(s))],
    ["Treated after closing time", (s) => String(s.afterClosing)],
    ["Average wait, clinics' other patients", (s) => duration(s.avgOtherClinicWait)],
  ];
  $("herd-table").tBodies[0].replaceChildren(...rows.map(([label, read]) =>
    row(label, Object.keys(SCENARIO_NAMES).flatMap((k) => [read(data.herding[k].aware), read(data.herding[k].naive)]))));

  const wait = (side, id) => (side.byFacility[id] ? duration(side.longestWaitByFacility[id] ?? 0) : "–");
  $("herd-places").tBodies[0].replaceChildren(...facilities.map((f) =>
    row(f.label, [String(aware.byFacility[f.id]), wait(aware, f.id), String(naive.byFacility[f.id]), wait(naive, f.id)])));

  chartOrTable("herd-chart", (canvas) => new Chart(canvas, {
    type: "bar",
    data: {
      labels: facilities.map((f) => f.label),
      datasets: [
        { label: "Triage", data: facilities.map((f) => aware.byFacility[f.id]), backgroundColor: SERIES_1, borderRadius: 3, borderColor: "#fff", borderWidth: { top: 1, bottom: 1 } },
        { label: "Naive", data: facilities.map((f) => naive.byFacility[f.id]), backgroundColor: SERIES_2, borderRadius: 3, borderColor: "#fff", borderWidth: { top: 1, bottom: 1 } },
      ],
    },
    options: {
      indexAxis: "y",
      interaction: { mode: "index", axis: "y", intersect: false },
      scales: {
        x: { beginAtZero: true, title: { display: true, text: "People sent there, of 300" }, grid },
        y: { grid: { display: false }, ticks: { autoSkip: false } },
      },
      plugins: { tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${item.parsed.x} people` } } },
    },
  }));
}

// ---- Section 7: the 12 safety cases, run now by router.js -----------------------------------------------------

const ANSWER_WORDS = { yes: "yes", no: "no", not_sure: "not sure" };

function renderSafety(suite, checklists, facilities, demo) {
  const state = Sim.makeState(demo.nowMin, demo.facilities);
  const nearest = Router.nearestER(facilities, demo.user, demo.nowMin);
  let passed = 0;
  const rows = suite.cases.map((c) => {
    // What the person in the case does on the checklist screen: the answers the case describes, and "no"
    // to every other item shown for that injury type.
    const type = c.types[0];
    const own = Object.hasOwn(checklists.types, type) ? checklists.types[type] : [];
    const answers = { ...c.fill };
    for (const id of own) if (!(id in answers)) answers[id] = "no";
    const res = Router.route({ injuryType: type, age: c.age, answers, user: demo.user, state, facilities, checklists });

    const problems = [];
    if (res.kind !== c.expect) problems.push("wrong screen");
    if (res.kind === "emergency") {
      for (const id of c.expect_items || []) {
        const hit = res.triggered.find((x) => x.id === id);
        if (!hit) problems.push(`did not name ${id}`);
        else if (c.fill[id] === "not_sure" && hit.answer !== "not_sure") problems.push(`${id} not shown as not sure`);
      }
      if (!nearest || !res.nearestER || res.nearestER.facility.id !== nearest.facility.id) problems.push("not the nearest ER");
    }
    if (res.kind === "results" && res.top.length === 0) problems.push("no places listed");
    const ok = problems.length === 0;
    if (ok) passed++;

    const said = Object.entries(c.fill).map(([id, v]) => `${id}: ${ANSWER_WORDS[v]}`);
    const expected = c.expect === "emergency"
      ? `Emergency screen, naming ${(c.expect_items || []).join(", ")}`
      : "Ranked places";
    const actual = res.kind === "emergency"
      ? `Emergency screen. ${res.triggered.map((x) => `"${x.text}" ${ANSWER_WORDS[x.answer]}`).join("; ")}. Nearest ER: ${res.nearestER ? res.nearestER.facility.label : "none"}`
      : res.kind === "results" ? `Ranked places, first ${res.top[0] ? res.top[0].facility.label : "none"}`
      : res.kind;
    return el("tr", {},
      el("td", {}, String(c.id)),
      el("td", { className: "text" }, c.text),
      el("td", { className: "text" }, said.length ? `${said.join(", ")}; every other item no` : "Every item no"),
      el("td", { className: "text" }, expected),
      el("td", { className: "text" }, actual),
      el("td", { className: "text" }, el("span", { className: ok ? "pass" : "fail" }, ok ? "✓ Pass" : `✗ FAIL: ${problems.join(", ")}`)));
  });
  $("safety-table").tBodies[0].replaceChildren(...rows);
  $("safety-summary").replaceChildren(el("b", {}, `${passed} of ${suite.cases.length}`),
    " safety cases behave as expected: every all-no case is ranked, every yes or not sure shows the emergency screen and names the item.");
}

// ---- Load ----------------------------------------------------------------------------------------------------

const get = (path) => fetch(path).then((r) => (r.ok ? r.json() : null)).catch(() => null);

function missing(sectionId, what) {
  $(sectionId).querySelector(".inner").append(el("p", { className: "error" }, `${what} didn't load. Reload the page.`));
}

async function load() {
  const [data, spread, facilities, demo, checklists, suite] = await Promise.all([
    "data/about-results.json", "data/saturday-spread.json", "data/facilities.json", "data/demo-state.json",
    "data/checklists.json", "tests/safety-cases.json",
  ].map(get));
  for (const s of document.querySelectorAll(".demo-seed")) s.textContent = String(Saturday.SETTINGS.DEMO_SEED);

  if (data) { renderHero(data, spread); renderSaturdayTable(data); renderAdoption(data, "medium"); }
  else for (const id of ["top", "s5", "s6"]) missing(id, "The simulation results");
  if (facilities) renderParams(facilities); else missing("s3", "The facility list");
  if (facilities && demo) renderBand(facilities, demo); else missing("s4", "The demo data");
  if (data && facilities) renderHerding(data, facilities);
  if (suite && checklists && facilities && demo) renderSafety(suite, checklists, facilities, demo); else missing("s7", "The safety cases");

  if (data) {
    $("adopt-capacity").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-scenario]");
      if (b) renderAdoption(data, b.dataset.scenario);
    });
  }
  // A link to a section may have been followed before its content had a height.
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}

// Presenting: keys 1 to 8 jump to that section, 0 to the top.
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (!/^[0-8]$/.test(e.key)) return;
  const target = $(e.key === "0" ? "top" : `s${e.key}`);
  if (target) { target.scrollIntoView(); history.replaceState(null, "", `#${target.id}`); }
});

load();
