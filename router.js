// Safety checklist rules + facility ranking. Pure functions, no DOM, no network.
// Loaded as a plain <script> in the browser (exposes `Router`) and via node:vm in tests. Needs `Sim` loaded first.
//
// An emergency is decided ONLY here, by fixed code matching the fixed checklist in data/checklists.json.
// Gemini (milestone 4) may pre-fill answers; it never decides anything.

const Router = (() => {
  const INJURY_TYPES = ["sprain_or_simple_fracture", "cut", "minor_burn", "back_strain", "child_minor_injury"];
  const ANSWERS = ["yes", "no", "not_sure"]; // anything else (blank, "unknown", typos) counts as unanswered
  const BEST_FIT_WINDOW_MIN = 15; // a best-fit place moves ahead only if within this many minutes of the fastest
  const TOP_N = 3;
  const CHILD_MAX_AGE = 17;

  const isAnswer = (a) => ANSWERS.includes(a);

  // ---- Emergency screen -------------------------------------------------------------------------

  // answers = { [itemId]: "yes" | "no" | "not_sure" | blank }.
  // triggered: every item answered yes or not_sure, in checklist order. missing: items not yet answered.
  // Any yes or not_sure is an emergency even if other items are still blank. Routing needs every item = "no".
  function evaluateChecklist(checklists, injuryType, answers) {
    const ids = checklists.types[injuryType];
    if (!ids) return { known: false, triggered: [], missing: [], emergency: false, complete: false };
    const triggered = [];
    const missing = [];
    for (const id of ids) {
      const a = (answers || {})[id];
      if (a === "yes" || a === "not_sure") {
        triggered.push({ id, text: checklists.items[id], answer: a });
      } else if (a !== "no") {
        missing.push({ id, text: checklists.items[id] });
      }
    }
    return {
      known: true,
      triggered,
      missing,
      emergency: triggered.length > 0,
      complete: missing.length === 0 && triggered.length === 0,
    };
  }

  // Headline switches to "Call 911" if any ambulance question is yes or not sure. Unanswered ones change nothing.
  function emergencyHeadline(checklists, ambulanceAnswers) {
    const qs = Object.keys(checklists.ambulance.questions);
    const call911 = qs.some((q) => {
      const a = (ambulanceAnswers || {})[q];
      return a === "yes" || a === "not_sure";
    });
    return call911 ? "Call 911" : "Go to the nearest ER now";
  }

  // Emergencies go to the NEAREST open ER by straight-line distance (same as drive time). Never by wait time.
  function nearestER(facilities, user, nowMin = 0) {
    let best = null;
    for (const f of facilities) {
      if (f.type !== "er" || !Sim.isOpen(f, nowMin % 1440)) continue;
      const km = Sim.distanceKm(user.lat, user.lng, f.lat, f.lng);
      if (!best || km < best.km) best = { facility: f, km };
    }
    if (!best) return null;
    return { facility: best.facility, driveMin: Sim.driveMinutes(user, best.facility) };
  }

  // ---- Ranking ----------------------------------------------------------------------------------

  const isChild = (age) => age <= CHILD_MAX_AGE;

  function ageOk(f, age) {
    return age >= f.min_age && (f.max_age == null || age <= f.max_age);
  }

  // Best fit: ortho clinic for a sprain or possible fracture; kids' clinic for a child.
  function isBestFit(f, injuryType, child) {
    if (injuryType === "sprain_or_simple_fracture" && f.type === "ortho") return true;
    if (child && f.type === "peds") return true;
    return false;
  }

  function reasonsFor(f, injuryType, child, bestFit) {
    const out = [];
    if (f.type === "ortho" && f.xray) out.push("X-ray and an orthopedist on site");
    else if (f.type === "ortho") out.push("Orthopedist on site");
    else if (f.type === "peds") out.push(`Kids' clinic${f.xray ? " with X-ray" : ""}`);
    else if (f.type === "er") out.push("Hospital ER; can treat all of these injuries");
    else if (f.xray && injuryType === "sprain_or_simple_fracture") out.push("X-ray on site");
    if (bestFit && child && f.type === "ortho") out.push("Accepts children this age");
    return out;
  }

  // Ranks places that are open at arrival, treat this injury type, and serve this age.
  // input: { injuryType, age, user: {lat, lng}, state (from Sim.makeState), facilities, simOpts? }
  // Each result: total = drive + median wait, UNADJUSTED. "Best fit" is a separate label.
  function rank({ injuryType, age, user, state, facilities, simOpts }) {
    const child = isChild(age);
    const rows = [];
    for (const f of facilities) {
      if (!f.treats.includes(injuryType) || !ageOk(f, age)) continue;
      const driveMin = Sim.driveMinutes(user, f);
      const wait = Sim.estimateWait(f, state, driveMin, simOpts); // null when closed at arrival
      if (!wait) continue;
      const bestFit = isBestFit(f, injuryType, child);
      rows.push({
        facility: f, driveMin, wait, totalMin: driveMin + wait.median,
        bestFit, reasons: reasonsFor(f, injuryType, child, bestFit),
      });
    }
    const byTotal = (a, b) => a.totalMin - b.totalMin || a.driveMin - b.driveMin;
    rows.sort(byTotal);
    if (rows.length === 0) return rows;
    const cutoff = rows[0].totalMin + BEST_FIT_WINDOW_MIN;
    const ahead = rows.filter((r) => r.bestFit && r.totalMin <= cutoff);
    const rest = rows.filter((r) => !ahead.includes(r));
    const ordered = [...ahead, ...rest];
    ordered.forEach((r, i) => { r.rank = i + 1; });
    const fastest = rows[0];
    fastest.reasons.push("Shortest total time");
    return ordered;
  }

  // ---- One entry point for the UI and tests ------------------------------------------------------
  // input: { injuryType, age, answers, user, state, facilities, checklists, simOpts? }
  // age (years) is required: blank, negative, non-numeric or absurd ages are "incomplete", never routed.
  // is_child = age under 18. A child who picks "other" gets the child_minor_injury checklist; an adult gets "other".
  // kinds: "emergency" | "other" | "incomplete" | "results"
  function route(input) {
    const { age, answers, checklists } = input;
    if (typeof age !== "number" || !Number.isFinite(age) || age < 0 || age > 120) {
      return { kind: "incomplete", reason: "age", missing: [] };
    }
    if (age < 1) return { kind: "other" }; // infants: ER or nurse line, never a guess
    const child = isChild(age);
    const injuryType = input.injuryType === "other" && child ? "child_minor_injury" : input.injuryType;
    if (!INJURY_TYPES.includes(injuryType)) return { kind: "other" };
    if (injuryType === "child_minor_injury" && !child) return { kind: "incomplete", reason: "age", missing: [] };

    const check = evaluateChecklist(checklists, injuryType, answers);
    if (check.emergency) {
      return {
        kind: "emergency",
        injuryType,
        triggered: check.triggered,
        nearestER: nearestER(input.facilities, input.user, input.state.nowMin),
      };
    }
    if (!check.complete) return { kind: "incomplete", reason: "checklist", missing: check.missing };

    const ranked = rank({ ...input, injuryType });
    return { kind: "results", injuryType, ranked, top: ranked.slice(0, TOP_N) };
  }

  return {
    INJURY_TYPES, ANSWERS, BEST_FIT_WINDOW_MIN, TOP_N,
    evaluateChecklist, emergencyHeadline, nearestER, rank, route, isChild,
  };
})();

if (typeof globalThis !== "undefined") globalThis.Router = Router;
