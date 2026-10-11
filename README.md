# Triage

A HackNC prototype. You describe a non-emergency injury; Triage checks a fixed safety checklist, then
ranks Triangle-area facilities (ERs, urgent cares, ortho walk-ins, kids' urgent cares) by estimated time
to treatment.

**Everything about the network is simulated.** The 12 facilities, their lines and every wait time are
invented for the demo, and facility names are neutral ("Hospital A ER"). Triage is not a clinical tool
and has not been reviewed by a clinician. In an emergency, call 911.

## What it does

1. **You describe what happened**, by typing or speaking.
2. **Gemini pre-fills a form** with only what you said. Anything you didn't mention stays blank. Gemini
   decides nothing.
3. **You answer every item** on a fixed warning-sign checklist (based on published ACEP guidance): yes,
   no or not sure.
4. **Fixed code decides.** Any "yes" or "not sure" shows the emergency screen: go to the nearest ER now,
   or call 911, naming the item that triggered it. Emergencies always go to the nearest ER, never by
   wait time.
5. **Otherwise, places are ranked** by approximate drive time plus the median simulated wait, shown as a
   simulated wait range. Picking a place adds you to that line, so the next person's ranking sees it.

Injuries outside the four supported types (sprain or simple fracture, cut, minor burn, back strain) are
sent to "ER or your doctor's nurse line" rather than guessed at.

## Pages

| Page | What it is |
| --- | --- |
| `index.html` | Find care: the map, the description box, the checklist and the ranked results |
| `saturday.html` | Busy Saturday: one simulated afternoon played twice, everyone to the nearest ER vs. routed by Triage |
| `about.html` | About: how it decides, the queue model, the results under low / medium / high urgent-care capacity, the safety cases and the limitations |

## Running it locally

Requires Node.js and the [Vercel CLI](https://vercel.com/docs/cli).

```sh
npm install
echo "GEMINI_API_KEY=your-key-here" > .env   # gitignored; never commit it
vercel dev
```

Without a key or without `vercel dev`, the pages still work from any static server (for example
`python3 -m http.server`). The Gemini intake fails over to the plain hand-filled form.

## Tests

```sh
node tests/sim.test.js              # queue simulation
node tests/router.test.js           # checklist rules and ranking
node tests/saturday.test.js         # Busy Saturday comparison (~30 s)
node tests/about.test.js            # About page numbers match the saved results (~20 s)
node tests/run-safety.js --offline  # the 12 safety cases against router.js
node --env-file=.env tests/run-safety.js   # same cases through live Gemini (~3 min)
```

After changing `sim.js`, `router.js`, `saturday.js` or `about-sim.js`, regenerate the About page's
numbers with `node tests/about-results.js --write`.

## How it's built

Plain HTML, CSS and JavaScript: no framework, no bundler, no build step. Leaflet draws the map and
Chart.js draws the About-page charts, both from a CDN. One Vercel serverless function calls Gemini.

```
index.html, app.js          Find care page and its UI wiring
saturday.html, saturday*.js Busy Saturday page and simulation
about.html, about-*.js      About page
styles.css                  styles (Frutiger Aero)
sim.js                      queue simulation and wait ranges: pure functions, no DOM
router.js                   safety checklist rules and ranking: pure functions, no DOM
api/intake.js               Vercel function that calls Gemini
data/                       facilities, checklists, scripted demo state, saved results
tests/                      node test scripts and the 12 safety cases
fonts/                      self-hosted fonts with their licenses
```

`PLAN.md` has the full build plan, the simulation's starting values with the reason for each, and the
sources. `CLAUDE.md` / `AGENTS.md` hold the project rules, including the safety rules the code must keep.

## Limitations

- The facility feed, arrival rates, treatment times and slots are invented. Real data could change the
  results.
- Drive times are straight-line distance × 1.3 at 40 km/h: no roads, no traffic.
- The checklist is a prototype guardrail, not clinical validation. A clear checklist doesn't rule out a
  serious injury.
- Routing moves the wait rather than removing it: the clinics' other patients wait longer. The About
  page reports that cost alongside the benefit.
