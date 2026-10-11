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
  const ADULT_AGE = 18; // is_child = age under 18

  // ---- Emergency screen -------------------------------------------------------------------------

  // answers = { [itemId]: "yes" | "no" | "not_sure" | blank }.
  // triggered: EVERY checklist item answered yes or not_sure, whatever the injury type (this type's items
  // first, in checklist order, then any others). So a warning sign outside the type's list, or with an
  // injury type that has no list ("other"), is still an emergency.
  // missing: this type's items not yet answered. Routing needs every one of them = "no".
  // Any yes or not_sure is an emergency even if other items are still blank.
  function evaluateChecklist(checklists, injuryType, answers) {
    const known = Object.hasOwn(checklists.types, injuryType);
    const typeIds = known ? checklists.types[injuryType] : [];
    const otherIds = Object.keys(checklists.items).filter((id) => !typeIds.includes(id));
    const given = answers || {};
    const answerOf = (id) => (Object.hasOwn(given, id) ? given[id] : undefined);
    const triggered = [];
    const missing = [];
    for (const id of [...typeIds, ...otherIds]) {
      const a = answerOf(id);
      if (a === "yes" || a === "not_sure") {
        triggered.push({ id, text: checklists.items[id], answer: a });
      } else if (a !== "no" && typeIds.includes(id)) {
        missing.push({ id, text: checklists.items[id] });
      }
    }
    return {
      known,
      triggered,
      missing,
      emergency: triggered.length > 0,
      complete: known && missing.length === 0 && triggered.length === 0,
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
  // Returns null when the facility list or the user's location is missing; the emergency itself never
  // depends on this.
  function nearestER(facilities, user, nowMin = 0) {
    if (!Array.isArray(facilities) || !user || !Number.isFinite(user.lat) || !Number.isFinite(user.lng)) return null;
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

  const isChild = (age) => age < ADULT_AGE;

  // max_age is in whole years: 17 means "through age 17", so 17.5 is still served.
  function ageOk(f, age) {
    return age >= f.min_age && (f.max_age == null || age < f.max_age + 1);
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

  // Orders rows of { totalMin, driveMin, bestFit }: by total time, ties to the shorter drive. Best-fit rows
  // move ahead only if their total is within BEST_FIT_WINDOW_MIN of the fastest. Marks the fastest row.
  function orderRows(rows) {
    const sorted = [...rows].sort((a, b) => a.totalMin - b.totalMin || a.driveMin - b.driveMin);
    if (sorted.length === 0) return sorted;
    sorted.forEach((r, i) => { r.fastest = i === 0; });
    const cutoff = sorted[0].totalMin + BEST_FIT_WINDOW_MIN;
    const ahead = sorted.filter((r) => r.bestFit && r.totalMin <= cutoff);
    const rest = sorted.filter((r) => !ahead.includes(r));
    return [...ahead, ...rest];
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
    const ordered = orderRows(rows);
    ordered.forEach((r, i) => { r.rank = i + 1; });
    const fastest = ordered.find((r) => r.fastest);
    if (fastest) fastest.reasons.push("Shortest total time");
    return ordered;
  }

  // ---- One entry point for the UI and tests ------------------------------------------------------
  // input: { injuryType, age, answers, user, state, facilities, checklists, simOpts? }
  // Order matters: the checklist is checked BEFORE anything else, so a yes or not_sure on any item is an
  // emergency even with a blank, invalid or infant age, an injury type outside the list, or no facility data.
  // Then: a type outside the list is "other" at every age (ER or nurse line, never a guess). Then age (years)
  // is required: blank, negative, non-numeric or absurd ages are "incomplete", never routed.
  // child_minor_injury is only for a child (under 18) whose injury has no specific type.
  // kinds: "emergency" | "other" | "incomplete" | "results"
  function route(input) {
    const { age, answers, checklists, injuryType } = input;
    const check = evaluateChecklist(checklists, injuryType, answers);
    if (check.emergency) {
      let er = null;
      try {
        er = nearestER(input.facilities, input.user, input.state ? input.state.nowMin : undefined);
      } catch (e) {
        er = null; // the emergency screen must not depend on simulation data
      }
      return { kind: "emergency", injuryType, triggered: check.triggered, nearestER: er };
    }
    if (!INJURY_TYPES.includes(injuryType) || !check.known) return { kind: "other" };
    if (typeof age !== "number" || !Number.isFinite(age) || age < 0 || age > 120) {
      return { kind: "incomplete", reason: "age", missing: [] };
    }
    if (age < 1) return { kind: "other" }; // infants: ER or nurse line, never a guess
    if (injuryType === "child_minor_injury" && !isChild(age)) return { kind: "other" };
    if (!check.complete) return { kind: "incomplete", reason: "checklist", missing: check.missing };

    const ranked = rank({ ...input, injuryType });
    return { kind: "results", injuryType, ranked, top: ranked.slice(0, TOP_N) };
  }

  return {
    INJURY_TYPES, ANSWERS, BEST_FIT_WINDOW_MIN, TOP_N,
    evaluateChecklist, emergencyHeadline, nearestER, orderRows, rank, route, isChild,
  };
})();

if (typeof globalThis !== "undefined") globalThis.Router = Router;
