// UI wiring only. Logic lives in sim.js and router.js.

const TYPE_NAMES = {
  er: "Hospital ER",
  urgent: "Urgent care",
  ortho: "Ortho walk-in",
  peds: "Kids' urgent care",
};
const TYPE_COLORS = {
  er: "#c0392b",
  urgent: "#2980b9",
  ortho: "#27ae60",
  peds: "#8e44ad",
};

const map = L.map("map").setView([35.9, -78.75], 10);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

let facilities = [];
let checklists = null;
let state = null;
let user = null;
let userMarker = null;
const highlightLayer = L.layerGroup().addTo(map);

async function loadFacilities() {
  for (const f of facilities) {
    const marker = L.circleMarker([f.lat, f.lng], {
      radius: 9,
      color: "#fff",
      weight: 2,
      fillColor: TYPE_COLORS[f.type],
      fillOpacity: 1,
    }).addTo(map);
    const el = document.createElement("div");
    const label = document.createElement("div");
    label.className = "pin-label";
    label.textContent = f.label;
    const type = document.createElement("div");
    type.className = "pin-type";
    type.textContent = `${TYPE_NAMES[f.type]} · ${f.town}`;
    el.append(label, type);
    marker.bindTooltip(el, { direction: "top", offset: [0, -8] });
    marker.bindPopup(el.cloneNode(true));
  }
}

async function loadData() {
  const [f, c, d] = await Promise.all(
    ["facilities", "checklists", "demo-state"].map((n) => fetch(`data/${n}.json`).then((r) => r.json())),
  );
  facilities = f;
  checklists = c;
  state = Sim.makeState(d.nowMin, d.facilities);
  user = d.user;
  userMarker = L.marker([user.lat, user.lng]).addTo(map).bindTooltip("You (demo location, near NC State)");
  await loadFacilities();
}

// ---- Form ------------------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const ANSWER_LABELS = { yes: "Yes", no: "No", not_sure: "Not sure" };

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// Radio group with NO default, so every checklist item starts blank and must be answered.
function radioRow(name, text) {
  const row = el("fieldset", { className: "q" }, el("legend", {}, text));
  for (const [value, label] of Object.entries(ANSWER_LABELS)) {
    row.append(el("label", { className: "opt" }, Object.assign(el("input"), { type: "radio", name, value }), label));
  }
  return row;
}

// "Something else" for a child uses the child_minor_injury checklist; for an adult there is no checklist.
// Age is blank, or a finite number. Non-numeric text in a number field reads as "".
function readAge() {
  const raw = $("age").value.trim();
  return raw === "" ? NaN : Number(raw);
}
const ageIsValid = (a) => Number.isFinite(a) && a >= 0 && a <= 120;
function effectiveType() {
  const type = $("injury-type").value;
  const age = readAge();
  return type === "other" && ageIsValid(age) && Router.isChild(age) ? "child_minor_injury" : type;
}

function renderChecklist() {
  const type = effectiveType();
  const box = $("checklist");
  box.replaceChildren();
  const ids = checklists && checklists.types[type];
  if (!ids) return;
  box.append(el("p", { className: "note" }, "Answer every question. Choose \"Not sure\" if you don't know."));
  for (const id of ids) box.append(radioRow(id, checklists.items[id]));
}

function readAnswers(scope) {
  const out = {};
  for (const r of scope.querySelectorAll("input[type=radio]:checked")) out[r.name] = r.value;
  return out;
}

// ---- Results ---------------------------------------------------------------------------------

const mins = (m) => `${Math.round(m)} min`;

function showEmergency(res) {
  const result = $("result");
  const headline = el("h2", { id: "emergency-headline" });
  const er = res.nearestER;
  const body = el("div", { className: "emergency" }, headline);
  body.append(el("a", { className: "call911", href: "tel:911" }, "Call 911"));
  body.append(el("p", {}, "Because you answered:"));
  const list = el("ul");
  for (const t of res.triggered) list.append(el("li", {}, `${t.text} \u2014 ${ANSWER_LABELS[t.answer]}`));
  body.append(list);
  if (er) {
    body.append(el("p", { className: "er" },
      `Nearest ER: ${er.facility.label} (${er.facility.town}), about ${mins(er.driveMin)} away (approx.).`));
  }
  body.append(el("h3", {}, "Should you call an ambulance instead?"));
  const amb = el("div", { id: "ambulance" });
  for (const [id, text] of Object.entries(checklists.ambulance.questions)) amb.append(radioRow(id, text));
  amb.addEventListener("change", () => {
    headline.textContent = Router.emergencyHeadline(checklists, readAnswers(amb));
  });
  headline.textContent = Router.emergencyHeadline(checklists, {});
  body.append(amb);
  result.replaceChildren(body);
  $("intake-form").hidden = true;
  body.append(el("button", { type: "button", onclick: resetAll }, "Start over"));

  highlightLayer.clearLayers();
  if (er) {
    L.circleMarker([er.facility.lat, er.facility.lng], { radius: 16, color: "#c00", weight: 4, fill: false })
      .addTo(highlightLayer);
    map.setView([er.facility.lat, er.facility.lng], 11);
  }
}

function showResults(res) {
  const result = $("result");
  const body = el("div", { className: "results" });
  body.append(el("h2", {}, "Places that can treat this"));
  body.append(el("p", { className: "wording" },
    "These places can treat this type of injury. A clear checklist doesn't rule out a serious injury, " +
    "so if anything gets worse or seems wrong, go to the ER or call 911."));
  const ol = el("ol");
  for (const r of res.top) {
    const li = el("li", {}, el("strong", {}, r.facility.label), ` \u00b7 ${r.facility.town}`);
    if (r.bestFit) li.append(el("span", { className: "badge" }, "Best fit"));
    li.append(el("div", { className: "big" }, `${r.wait.low}\u2013${r.wait.high} min`));
    li.append(el("div", { className: "small" }, "simulated wait range"));
    li.append(el("div", {}, `Drive about ${mins(r.driveMin)} (approx.) \u00b7 total about ${mins(r.totalMin)}`));
    li.append(el("div", { className: "small" }, r.reasons.join(" \u00b7 ")));
    ol.append(li);
  }
  body.append(ol);
  body.append(el("button", { type: "button", onclick: resetAll }, "Start over"));
  result.replaceChildren(body);
  $("intake-form").hidden = true;

  highlightLayer.clearLayers();
  const pts = [[user.lat, user.lng]];
  res.top.forEach((r, i) => {
    L.circleMarker([r.facility.lat, r.facility.lng], { radius: 15, color: "#0a7", weight: 4, fill: false })
      .bindTooltip(`${i + 1}`, { permanent: true, direction: "center", className: "rank-tip" })
      .addTo(highlightLayer);
    pts.push([r.facility.lat, r.facility.lng]);
  });
  map.fitBounds(pts, { padding: [40, 40] });
}

function showOther() {
  const body = el("div", { className: "other" },
    el("h2", {}, "ER or your doctor's nurse line"),
    el("p", {}, "Triage only covers four injury types in this demo. For anything else, go to an ER or call your doctor's nurse line. If it is an emergency, call 911."),
    el("a", { className: "call911", href: "tel:911" }, "Call 911"),
    el("button", { type: "button", onclick: resetAll }, "Start over"));
  $("result").replaceChildren(body);
  $("intake-form").hidden = true;
}

function resetAll() {
  $("result").replaceChildren();
  $("form-error").textContent = "";
  $("intake-form").reset();
  $("checklist").replaceChildren();
  $("intake-form").hidden = false;
  highlightLayer.clearLayers();
}

$("injury-type").addEventListener("change", renderChecklist);
$("age").addEventListener("input", renderChecklist);

$("intake-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const err = $("form-error");
  err.textContent = "";
  if (!checklists) { err.textContent = "Still loading. Try again in a moment."; return; }
  const injuryType = $("injury-type").value;
  if (!injuryType) { err.textContent = "Choose an injury type."; return; }
  const age = readAge();
  if (!ageIsValid(age)) { err.textContent = "Enter the person's age in years (0 to 120)."; return; }
  if (injuryType === "other" && !Router.isChild(age)) { showOther(); return; }
  const res = Router.route({
    injuryType, age, answers: readAnswers($("checklist")), user, state, facilities, checklists,
  });
  if (res.kind === "emergency") showEmergency(res);
  else if (res.kind === "results") showResults(res);

  else err.textContent = `Please answer every question (${res.missing.length} left).`;
});

loadData();

// Temporary Gemini connection test (removed in milestone 4).
document.getElementById("test-gemini").addEventListener("click", async () => {
  const out = document.getElementById("gemini-reply");
  out.textContent = "Asking Gemini...";
  try {
    const res = await fetch("/api/intake");
    const data = await res.json();
    out.textContent = data.reply ?? `Error: ${data.error}`;
  } catch (err) {
    out.textContent = "Request failed. Is the server running (vercel dev)?";
  }
});
