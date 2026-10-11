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

function drawFacilities() {
  for (const f of facilities || []) {
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

// Each file loads on its own: the checklist and the emergency screen must still work if the facility or
// demo-state file fails to load.
async function loadData() {
  const get = (n) => fetch(`data/${n}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [f, c, d] = await Promise.all(["facilities", "checklists", "demo-state"].map(get));
  facilities = f;
  checklists = c;
  state = d ? Sim.makeState(d.nowMin, d.facilities) : null;
  user = d ? d.user : null;
  if (user) userMarker = L.marker([user.lat, user.lng]).addTo(map).bindTooltip("You (demo location, near NC State)");
  drawFacilities();
}

// ---- Form ------------------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const ANSWER_LABELS = { yes: "Yes", no: "No", not_sure: "Not sure" };
const CHILD_TYPE = "child_minor_injury";
const INTAKE_TIMEOUT_MS = 9500; // a little longer than the server's own 8 s limit

let prefill = {}; // what Gemini pre-filled: { [itemId]: "yes" | "no" }. Unknown items are simply absent.
let answers = {}; // the answers currently shown on the checklist: pre-filled ones plus the person's taps
let intakeRequest = null;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// Radio group with NO default: an item starts blank unless `value` is given, and must be answered.
function radioRow(name, text, value, fromYou) {
  const legend = el("legend", {}, text);
  if (fromYou) legend.append(el("span", { className: "tag" }, "from what you said"));
  const row = el("fieldset", { className: "q" }, legend);
  row.dataset.item = name;
  for (const [v, label] of Object.entries(ANSWER_LABELS)) {
    row.append(el("label", { className: "opt" }, Object.assign(el("input"), { type: "radio", name, value: v, checked: v === value }), label));
  }
  return row;
}

// Age is blank, or a finite number. Non-numeric text in a number field reads as "".
function readAge() {
  const raw = $("age").value.trim();
  return raw === "" ? NaN : Number(raw);
}

// Shows this injury type's items, then any other item that already has an answer (pre-filled by Gemini, or
// tapped before the type was changed), so everything that could trigger the emergency screen is visible.
function renderChecklist() {
  const box = $("checklist");
  box.replaceChildren();
  if (!checklists) return;
  const type = $("injury-type").value;
  const own = Object.hasOwn(checklists.types, type) ? checklists.types[type] : [];
  const others = Object.keys(checklists.items).filter((id) => !own.includes(id) && answers[id]);
  const row = (id) => radioRow(id, checklists.items[id], answers[id], prefill[id] !== undefined && prefill[id] === answers[id]);
  if (own.length) {
    box.append(el("p", { className: "note" }, "Answer every question. Choose \"Not sure\" if you don't know."));
    for (const id of own) box.append(row(id));
  }
  if (others.length) {
    box.append(el("h3", {}, "Other warning signs with an answer"));
    box.append(el("p", { className: "note" }, "Check these too. Change any that are wrong."));
    for (const id of others) box.append(row(id));
  }
}

function readAnswers(scope) {
  const out = {};
  for (const r of scope.querySelectorAll("input[type=radio]:checked")) out[r.name] = r.value;
  return out;
}

function setStatus(text) { $("intake-status").textContent = text; }

function showForm(fromGemini) {
  $("describe").hidden = true;
  $("intake-form").hidden = false;
  $("understood").hidden = !fromGemini;
  $("body-part-chip").hidden = !fromGemini;
  renderChecklist();
}

// Gemini's reply only pre-fills the form. Anything that is not an exact "yes" or "no" for a known item
// stays blank for the person to answer. Returns false if the reply is unusable.
function applyIntake(data, text) {
  if (!data || typeof data !== "object" || typeof data.injury_type !== "string") return false;
  const select = $("injury-type");
  if (data.injury_type === CHILD_TYPE && !select.querySelector(`option[value=${CHILD_TYPE}]`)) {
    select.insertBefore(el("option", { value: CHILD_TYPE }, "Child's injury, type not clear"), select.querySelector("option[value=other]"));
  }
  if (!select.querySelector(`option[value="${CSS.escape(data.injury_type)}"]`) || data.injury_type === "") return false;
  select.value = data.injury_type;
  $("age").value = typeof data.age_years === "number" && Number.isFinite(data.age_years) ? String(data.age_years) : "";
  $("body-part").value = typeof data.body_part === "string" ? data.body_part : "";
  $("said-text").textContent = text;
  prefill = {};
  const given = data.answers && typeof data.answers === "object" ? data.answers : {};
  for (const id of Object.keys(checklists.items)) {
    if (given[id] === "yes" || given[id] === "no") prefill[id] = given[id];
  }
  answers = { ...prefill };
  return true;
}

// Never leaves the person stuck: any failure, junk reply or timeout shows the plain hand-filled form.
async function readDescription() {
  const text = $("description").value.trim();
  if (!text) { setStatus("Type what happened first, or fill in the form yourself."); return; }
  if (!checklists) { setStatus("Still loading. Try again in a moment."); return; }
  const request = { controller: new AbortController() };
  intakeRequest = request;
  $("read-btn").disabled = true;
  setStatus("Reading your description...");
  const timer = setTimeout(() => request.controller.abort(), INTAKE_TIMEOUT_MS);
  let ok = false;
  try {
    const res = await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: request.controller.signal,
    });
    const data = await res.json();
    if (intakeRequest !== request) return; // the person moved on while this was loading
    ok = res.ok && !data.error && applyIntake(data, text);
  } catch (err) {
    if (intakeRequest !== request) return;
    ok = false;
  } finally {
    clearTimeout(timer);
    $("read-btn").disabled = false;
  }
  intakeRequest = null;
  if (ok) {
    setStatus("");
    showForm(true);
  } else {
    showManualForm("Couldn't read that automatically. Please fill in the form yourself.");
  }
}

function cancelIntake() {
  if (intakeRequest) intakeRequest.controller.abort();
  intakeRequest = null;
  $("read-btn").disabled = false;
}

function showManualForm(message) {
  cancelIntake();
  prefill = {};
  answers = {};
  setStatus(message);
  showForm(false);
}

// ---- Results ---------------------------------------------------------------------------------

const mins = (m) => `${Math.round(m)} min`;

function showEmergency(res) {
  const result = $("result");
  const headline = el("h2", { id: "emergency-headline" });
  const er = res.nearestER;
  // The Call 911 button is always there. It is the big main button only while the headline says "Call 911".
  const call = el("a", { className: "call911", href: "tel:911" }, "Call 911");
  const body = el("div", { className: "emergency" }, el("div", { className: "emergency-head" }, headline, call));
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
  const setHeadline = () => {
    const text = Router.emergencyHeadline(checklists, readAnswers(amb));
    headline.textContent = text;
    call.classList.toggle("secondary", text !== "Call 911");
  };
  amb.addEventListener("change", setHeadline);
  setHeadline();
  body.append(amb);
  result.replaceChildren(body);
  $("intake-form").hidden = true;
  setStatus("");
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
  setStatus("");

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
  setStatus("");
}

function resetAll() {
  cancelIntake();
  prefill = {};
  answers = {};
  $("result").replaceChildren();
  $("form-error").textContent = "";
  setStatus("");
  $("intake-form").reset();
  $("injury-type").querySelector(`option[value=${CHILD_TYPE}]`)?.remove();
  $("description").value = "";
  $("checklist").replaceChildren();
  $("intake-form").hidden = true;
  $("describe").hidden = false;
  highlightLayer.clearLayers();
}

$("read-btn").addEventListener("click", readDescription);
$("manual-btn").addEventListener("click", () => showManualForm(""));
$("start-over").addEventListener("click", resetAll);
$("injury-type").addEventListener("change", renderChecklist);

// Every tap is recorded. A pre-filled answer the person changes loses its "from what you said" mark.
$("checklist").addEventListener("change", (e) => {
  if (e.target.type !== "radio") return;
  answers[e.target.name] = e.target.value;
  const row = e.target.closest("fieldset");
  row.classList.remove("unanswered");
  if (prefill[e.target.name] !== e.target.value) row.querySelector(".tag")?.remove();
});

// router.js decides. The checklist is checked first, so a yes or not sure shows the emergency screen even
// if the age is blank or the facility data did not load.
$("intake-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const err = $("form-error");
  err.textContent = "";
  if (!checklists) { err.textContent = "The checklist didn't load. Reload the page. If this is an emergency, call 911."; return; }
  const injuryType = $("injury-type").value;
  let res;
  try {
    res = Router.route({ injuryType, age: readAge(), answers: { ...answers }, user, state, facilities, checklists });
  } catch (ex) {
    err.textContent = "The facility list didn't load, so places can't be ranked. Reload the page. If this is an emergency, call 911.";
    return;
  }
  if (res.kind === "emergency") showEmergency(res);
  else if (!injuryType) err.textContent = "Choose an injury type.";
  else if (res.kind === "other") showOther();
  else if (res.kind === "results") showResults(res);
  else if (res.reason === "age") err.textContent = "Enter the person's age in years (0 to 120).";
  else {
    err.textContent = `Please answer every question (${res.missing.length} left).`;
    for (const row of $("checklist").querySelectorAll("fieldset.q")) {
      row.classList.toggle("unanswered", res.missing.some((m) => m.id === row.dataset.item));
    }
    $("checklist").querySelector(".unanswered")?.scrollIntoView({ block: "center" });
  }
});

loadData();
