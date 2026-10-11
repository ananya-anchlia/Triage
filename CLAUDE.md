# Triage — project rules for Claude Code

Triage is a HackNC prototype. A person describes a non-emergency injury; the app checks a fixed
safety checklist, then ranks Triangle-area facilities (ERs, urgent cares, ortho walk-ins, kids'
urgent cares) by estimated time to treatment, using a simulated network with live queues.

The full plan is in PLAN.md. Read the section for the current milestone before writing code.
Work on ONE milestone per session. Do not touch files or features outside it.

## Stack (do not change without asking)

- Plain HTML, CSS and JavaScript. No React, no bundler, no build step.
- Leaflet 1.9.4 from a CDN for the map. Chart.js from a CDN for About-page charts.
- One Vercel serverless function, `api/intake.js`, calls Gemini. Local dev: `vercel dev`.
- `POST /api/intake` with `{ "text": "..." }` returns
  `{ injury_type, age_years, body_part, answers }` or `{ "error": "..." }`.
  `answers` has one value per item in data/checklists.json: "yes", "no" or "unknown".
  The server validates Gemini's reply: any missing item, unknown key or other value becomes
  "unknown". The whole intake has a 12-second limit; on any error, junk reply or timeout the app
  shows the plain hand-filled form.
- `GEMINI_API_KEY` lives only in `.env` (gitignored) and Vercel environment variables.
  Never put it in browser code, never commit it, never print it.

## Files

```
index.html               page shell, map, panels
about.html               About page / presentation (milestone 7)
styles.css               styles (Frutiger Aero pass is milestone 7)
app.js                   UI wiring only
sim.js                   queue simulation + wait ranges — pure functions, no DOM
router.js                safety checklist rules + ranking — pure functions, no DOM
data/facilities.json     the 12 simulated facilities (table in PLAN.md)
data/demo-state.json     scripted Saturday 4 PM lines
data/checklists.json     fixed warning-sign checklist per injury type
api/intake.js            Vercel function that calls Gemini
tests/safety-cases.json  the 12 safety test cases
tests/run.html           runs router + safety tests in the browser
```

## Safety rules (non-negotiable)

1. An emergency is decided ONLY by fixed code in router.js matching a fixed, pre-set checklist
   (data/checklists.json, based on ACEP warning signs). Gemini never decides it.
2. Gemini only pre-fills checklist answers from what the user said. Anything not mentioned
   stays "unknown" and starts blank. The user must answer every item before routing.
3. Any "yes" or "not sure" → emergency screen: "Go to the nearest ER now", naming the checklist
   item that triggered it, with a 911 button always visible. If the user answers yes or not
   sure to any ACEP ambulance question, the headline becomes "Call 911".
4. Emergencies always go to the NEAREST ER. Never route an emergency by wait time.
5. Results wording: "These places can treat this type of injury. A clear checklist doesn't rule
   out a serious injury, so if anything gets worse or seems wrong, go to the ER or call 911."
   Never write "you don't need the ER" or any reassurance or diagnosis.
6. Always visible: an "Emergency? Call 911" bar and "Demo network: simulated facilities and
   wait times." Facility names stay neutral (e.g. "Hospital A ER"), never real hospital names.
7. Anything outside the four injury types (sprain_or_simple_fracture, cut, minor_burn,
   back_strain) → "ER or your doctor's nurse line", never a guess. "other" goes to the
   nurse-line screen at every age, child or adult, after the checklist check (a yes or not sure
   on any item is still an emergency). In the hand-filled form, "Something else" is "other".
   Children are not a separate type: age sets the child flag (under 18), which filters
   facilities by age and makes kids' clinics "Best fit". `child_minor_injury` is returned only
   by Gemini, and only when a child's injury is described without a specific type; anything
   that isn't an injury is "other". An adult with `child_minor_injury` gets the nurse-line screen.

## Simulation rules

- Parameters are fixed constants at the top of sim.js, chosen once with a written reason.
  Never tune them to make Triage look better. Only data/demo-state.json (starting lines) may be
  adjusted for the scripted demo.
- Emergencies jump the line but never interrupt someone already in treatment.
- Track patients in treatment separately from patients waiting.
- A pick adds a simulated patient to that facility's line at arrival time (now + drive).
  A recommendation alone changes nothing.
- Wait ranges: simulate 3 hours forward ~200 times; show the 25th–75th percentile, rounded to
  5 min, labeled "simulated wait range".
- Baseline vs. Triage comparisons use the same random arrivals (common random numbers), a seeded
  RNG (e.g. mulberry32), and are reported under low / medium / high urgent-care capacity,
  whatever the result.
- Ranking: total = drive + median wait, shown unadjusted. A best-fit facility moves ahead only
  if its total is within 15 minutes of the fastest. "Best fit" is a separate label.
- Drive time: straight-line distance × 1.3 at 40 km/h, labeled "approx."

## Working rules

- Keep sim.js and router.js free of DOM code so tests can run them alone.
- After finishing a milestone: run tests/run.html (once it exists), list what could break in a
  live demo, and suggest a git commit message. Don't start the next milestone.
- If a decision isn't covered here or in PLAN.md, ask instead of guessing.
