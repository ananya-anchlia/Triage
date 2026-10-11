# Triage — HackNC Build Plan

Oct 10, 2026 · @Ananya

## Goal and pitch

Triage tells you, in under a minute, where in the Triangle to take a non-emergency injury so you're seen sooner, by the right specialist, and it sends you to the ER or 911 at the first sign of an emergency.

**Pitch line:** "Nobody should wait six hours in the ER with a screaming kid when a clinic ten minutes away has no line."

**Positioning (say it before a judge asks):** a working prototype, demonstrated on hypothetical cases in a simulated Triangle network. The emergency checklist is a prototype guardrail based on published guidance; it would need clinical validation before real patients relied on it. A clean checklist doesn't prove an injury is minor; it only means none of the listed warning signs were reported.

**The two-part wow**

1. A judge describes an injury out loud; 30 seconds later they see ranked options on a map, with wait ranges and why each fits.
2. One button simulates a busy Saturday with and without Triage, and ER waits shrink across the region.

**Answers to the hard questions (memorize these)**

| Question | Answer |
| --- | --- |
| Where does the data come from? | Hospitals join the network and share capacity. "The routing is real. The hospital feed is simulated until hospitals plug in." |
| Why would hospitals share? | Crowded ERs are expensive, and low-urgency visits clog them. Each system also wants patients at its own urgent care instead of a competitor's. |
| Doesn't this exist? | Pieces do, spread across each system's own site. Nobody routes across competing systems by specialty and live load in one place. |
| What if you route a serious case away? | A fixed, pre-set checklist of warning signs runs first. Gemini only pre-fills it; the user confirms every item. Any yes or "not sure" means ER or 911, no routing. Gemini never makes that call. Options are ranked, never a single verdict. |
| Won't everyone flood the quiet clinic? | Each person who picks a place is added to its line at their estimated arrival time, after the drive, so the next person sees updated waits. In the prototype this runs on one laptop; a real deployment would keep the shared network state on a server. |
| Why Gemini? | Nobody wants to fill out a form in an emergency. Talk for 30 seconds, confirm a short safety checklist, get options. |

**Hard deadlines:** Devpost submission with GitHub link and a max 2-minute video (ChatGPT read the rules you shared as Sunday 10:00 AM; confirm in the hacker guide). Personal deadline: submitted by 9:00 AM, video recorded before that. All code written at the event.

## Safety design

A case becomes an emergency only by matching a fixed, pre-set checklist of warning signs. Gemini never makes that judgment: it pre-fills the checklist from what the user said, the user confirms every item, and fixed code in router.js decides. The emergency screen always names the checklist item that triggered it.

**Rule 1: any warning sign means emergency.** Warning signs from the American College of Emergency Physicians ([ACEP](https://www.emergencyphysicians.org/siteassets/files/pdfs/isitanemergency.pdf)):

| Adults | Children (in addition) |
| --- | --- |
| Trouble breathing or shortness of breath | Any big change in behavior or alertness: confusion, very sleepy, seizures, unusually irritable or withdrawn |
| Chest or upper belly pain or pressure lasting 2+ minutes | Severe headache or vomiting, especially after a head injury |
| Fainting, sudden dizziness or weakness | Can't stand or walks unsteadily |
| Vision changes; difficulty speaking | Unconscious |
| Confusion, changes in mental state, trouble waking | Blue, purple or gray skin or lips |
| Sudden or severe pain | Difficulty feeding or eating |
| Bleeding that won't stop | Fever with behavior change, stiff neck, severe headache or rash |
| Coughing up or vomiting blood | Severe or ongoing vomiting or diarrhea |
| Severe or ongoing vomiting or diarrhea; unusual belly pain | Bleeding that won't stop |
| Thoughts of suicide or harming others | Increasing or severe persistent pain |

**Injury-specific checks (confirm with a clinician or your mentor before the demo):** bone through the skin, an obviously deformed limb, numb, cold or blue below the injury, can't move fingers or toes, a deep or gaping wound, head injury with any loss of consciousness, a person on blood thinners who fell.

**Rule 2: emergency means nearest ER, never a "better" one.** ACEP says if you drive to an emergency, go to the nearest ER and don't bypass it for a farther one. Triage never routes emergencies by wait time.

**Rule 3: when to say "call 911"** (ACEP's checklist). Recommend an ambulance if any is yes, or the user is unsure: looks life-threatening; could become life-threatening on the way; moving the person could cause more injury; they need paramedic skills or equipment; distance or traffic would delay care.

**Two emergency messages, not one:** a checklist match shows "Go to the nearest ER now," with a 911 button always visible. The same screen then lists ACEP's ambulance questions (above); if the user answers yes or not sure to any, the headline switches to "Call 911." Both come from fixed lists, never from Gemini's judgment.

**Rule 4: wording.** Never "you don't need the ER." Always "These places can treat this type of injury. A clear checklist doesn't rule out a serious injury, so if anything gets worse or seems wrong, go to the ER or call 911." A persistent banner shows 911 at all times.

**The checklist step:** after Gemini reads the description, the app shows only the warning signs that apply to this injury type: 5–7 yes / no / not sure taps. Items the user mentioned come pre-filled and marked "from what you said"; the rest start blank. The user must answer every item; nothing is assumed either way. Any yes or "not sure" goes to the emergency path. This is fast (a few taps) and keeps the decision visible.

**Prototype guardrails:** these rules are a prototype safety layer based on published guidance, not a validated clinical triage tool. The checklist screen says so.

## How it works

Three separate jobs: Gemini pre-fills a fixed checklist from what you said, the checklist (confirmed by you, not judged by Gemini) catches emergencies, and the router ranks places using live load. Each pick feeds back into the load the next person sees.

&#91;embedded content: Triage flow · one emergency exit, one routing path, one feedback loop\]

## Simulated Triangle network

About 12 facilities placed at real Triangle towns, with neutral labels like "Hospital A ER (Raleigh)" instead of real hospital names, so nobody reads a fake wait time as a real hospital's.

**Mix (roughly):** 4 hospital ERs, 4 general urgent cares, 2 orthopedic walk-in clinics, 2 pediatric urgent cares, spread across Raleigh, Durham, Chapel Hill, Cary and Morrisville.

**Injury types for the demo (keep it to five):**

| Injury type | ER | Urgent care | Ortho walk-in | Pediatric urgent care |
| --- | --- | --- | --- | --- |
| Sprain or possible simple fracture (wrist, ankle) | Yes | If it has X-ray | Best fit | If it has X-ray |
| Cut that may need stitches | Yes | Yes | No | Yes |
| Minor burn | Yes | Yes | No | Yes |
| Back or muscle strain | Yes | Yes | Yes | No |
| Child with a minor injury | Yes | Yes | Depends on age | Best fit |

Anything outside these five, or anything uncertain, gets "ER or call your doctor's nurse line," not a guess.

**Each facility's record:** name label, town, coordinates, type, hours, X-ray yes/no, specialists on shift (e.g. ortho, pediatrics), treatment rooms, staff on shift, ages served. These are made up but plausible, and live in one JSON file.

**Labeling:** a permanent strip on the map: "Demo network: simulated facilities and wait times."

Open question: check whether any Triangle health system posts real ER or urgent care wait times online. If one does, show that single real feed beside the simulated ones to prove the data can exist.

## Routing and the queue simulation

The router ranks facilities by total time to treatment (drive plus predicted wait) among places that can treat the injury, and every choice updates that facility's queue. This is the technical core; build it in plain JavaScript so it runs offline.

**Queue model (simple, explainable):**

- Each facility has a number of treatment slots (rooms with staff) and a typical treatment time per injury type.
- Patients arrive at random through the day, busier in the evening and on weekends. ERs also receive emergencies, which always go first.
- A small simulation steps forward minute by minute and tracks each facility's line.

**Model details to get right:**

- Emergencies move ahead in line but never interrupt someone already being treated.
- Track patients in treatment separately from patients waiting.
- A routed patient's wait starts when they arrive, after their drive, not when they press the button.
- The baseline and Triage runs both model every ER and urgent care, fed the exact same random arrivals, so the only difference between them is the routing. (This is called common random numbers, a standard way to make a simulated comparison fair.)

**Wait as a range, not a number (the stats moment):** from the current state, run the next few hours forward about 200 times with different random arrivals. Show the middle half of results: "likely 20–45 min." Label these "simulated wait ranges under our assumptions." They describe uncertainty inside the model, not predictions for real facilities.

**Ranking:**

1. Filter to facilities that are open, can treat this injury type, and serve this age.
2. Total time = drive time + median predicted wait.
3. Rank by total time. A best-fit place (ortho clinic for a likely fracture, kids' clinic for a child) moves ahead only when its total time is within 15 minutes of the fastest option. The time shown is always the real estimate, never adjusted, and fit is shown separately as a "Best fit" label.
4. Show the top 3 with plain reasons: "X-ray and an orthopedist on site," "shortest total time."

**Drive time:** straight-line distance converted at an average city speed, labeled "approx." Real routing APIs are a stretch goal.

**Capacity-aware (your answer to herding):** when a user picks a place, a simulated patient is added to that facility's line at their estimated arrival time (now plus drive), and the next user's ranking uses the updated lines. A recommendation alone changes nothing; only a pick does. Assigning people one at a time with updated lines naturally spreads them out.

**The "busy Saturday" button:** simulate 300 minor-injury patients over an afternoon two ways, everyone to the nearest ER vs. routed by Triage, and show both side by side: average ER wait, average time to treatment, and how many people waited over 3 hours. Fixed random seed so the demo shows the same result every time. The parameters are fixed before this comparison runs, and the result is reported whatever it shows.

**Be honest in Q&A:** the parameters are invented; the method is real. With real hospital feeds, the same code would run on real lines.

**Sensitivity scenarios (report all of them):** run the comparison under low, medium and high urgent-care capacity. If Triage helps little, or makes things worse, in a scenario, show that too. A result that levels off when urgent cares fill up is more convincing to a stats judge than a perfect one.

## Gemini intake

The user talks or types for 30 seconds; Gemini returns structured answers and pre-fills the safety checklist. Gemini never diagnoses and never decides whether something is an emergency.

**Talking:** use the browser's built-in speech-to-text (works in Chrome) to turn speech into text, then send the text to Gemini. Sending audio straight to Gemini also works, but browser speech is faster to build. Typing is always available.

**Extraction schema** (use Gemini's structured JSON output):

```json
{
  "patient": {"age_years": 7, "is_child": true, "on_blood_thinners": "unknown"},
  "injury_type": "sprain_or_simple_fracture | cut | minor_burn | back_strain | other",
  "body_part": "left wrist",
  "how_it_happened": "fell off monkey bars",
  "warning_signs": {"trouble_breathing": false, "bleeding_wont_stop": false, "loss_of_consciousness": false, "bone_through_skin": false, "deformed_limb": "unknown", "numb_cold_or_blue": false, "cant_move_fingers_or_toes": false},
  "mentioned": ["can move fingers", "swollen"]
}
```

**Prompt rules**

- Extract only what the user said. Use "unknown" for anything not mentioned; never guess.
- Ask no questions. Anything not mentioned stays "unknown" so the app's fixed checklist can ask the user directly.
- No diagnosis, no treatment advice, no reassurance ("it's probably just a sprain").
- Anything outside the five injury types returns "other."

**Checklist:** the app shows the fixed warning signs for this injury type with Gemini's pre-filled answers marked "from what you said"; "unknown" items start blank and the user must answer them. Fixed code, not Gemini, then decides.

**Confirm step:** show the filled-in form as chips the user can tap to correct, then route. It doubles as proof to judges that the AI isn't making decisions.

**Privacy:** no accounts, nothing saved. The description goes to Google's Gemini API to be read; say so on screen. The API key lives only in a small server function, never in the browser.

## Design: Frutiger Aero

Frutiger Aero's glossy aqua, sky and water look suits a calm medical tool, as long as the gloss stays on the frame and the information stays crisp.

- **Background:** sky-to-water gradient with soft light, a few bubbles drifting slowly behind the panels. Respect reduced-motion settings.
- **Panels:** frosted glass cards (translucent white, soft blur, thin bright edge highlight), rounded corners.
- **Buttons:** glossy aqua pills with the classic top highlight; the main "Find care" button is the biggest thing on screen.
- **Map:** light, clean tiles; facility pins as glossy orbs colored by wait (green, amber, red), with the type icon inside.
- **Microphone button:** a large glassy orb that ripples like water while listening. This is your signature Frutiger Aero moment.
- **Type:** a humanist sans in the Frutiger family spirit (Segoe UI on Windows, or a similar Google Font), big and high-contrast for numbers and wait ranges.
- **Emergency state breaks the theme on purpose:** the 911 / nearest-ER screen drops the gloss and goes solid red and white. The contrast tells the user this is different.
- **Always visible:** a slim "Emergency? Call 911" bar and the "Demo network: simulated" strip.

Test readability on glass: if a judge squints at a wait time, add more opacity behind the text.

Open question: paste your brand kit colors and fonts here so Claude Code uses exact values.

## Decisions for Claude Code

These are fixed so every Claude Code session builds the same thing. Paste this section into each session along with the milestone you're on. Change a decision only on purpose, and update this section when you do.

### Stack and files

Plain HTML, CSS and JavaScript. No React, no build step. Leaflet for the map. One Vercel serverless function for Gemini.

```
triage/
  index.html            page shell, map, panels
  styles.css            Frutiger Aero styles (milestone 7)
  app.js                UI wiring only
  sim.js                queue simulation + wait ranges (pure functions, no DOM)
  router.js             emergency screen + ranking (pure functions, no DOM)
  data/facilities.json  the 12 simulated facilities
  data/demo-state.json  the scripted Saturday 4 PM lines
  api/intake.js         Vercel function that calls Gemini
  tests/safety-cases.json  the 12 safety test cases
  tests/run.html        opens in a browser and runs router + safety tests
  .env                  GEMINI_API_KEY (in .gitignore)
```

- **Map:** Leaflet 1.9.4 from a CDN; light map tiles (OpenStreetMap or CARTO Positron) with the required attribution. Check the tile provider's usage terms; a demo's light use is normally fine.
- **Hosting:** Vercel free tier. Local testing with `vercel dev`. The API key is set as an environment variable in Vercel, never in browser code.
- **Gemini:** Google's current JavaScript SDK and a current Flash model; check Google's docs for exact names on the day. Temperature 0. JSON output with a response schema.
- **Rule:** sim.js and router.js never touch the page, so they can be tested alone.

### Facility data

Pins sit at approximate town-center coordinates, not real facility addresses, with neutral labels.

```json
{
  "id": "ORTHO_RAL",
  "label": "Ortho Walk-in A",
  "town": "Raleigh",
  "lat": 35.8200, "lng": -78.6600,
  "type": "ortho",
  "hours": "08:00-20:00",
  "xray": true,
  "specialists": ["ortho"],
  "slots": 2,
  "min_age": 5,
  "treats": ["sprain_or_simple_fracture", "back_strain"]
}
```

| id | Label | Town | lat, lng | Type | X-ray | Slots | Treats |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ER\_RAL | Hospital A ER | Raleigh | 35.7796, -78.6382 | er | yes | 6 | all five |
| ER\_DUR | Hospital B ER | Durham | 36.0070, -78.9380 | er | yes | 6 | all five |
| ER\_CH | Hospital C ER | Chapel Hill | 35.9050, -79.0500 | er | yes | 5 | all five |
| ER\_CARY | Hospital D ER | Cary | 35.7880, -78.7700 | er | yes | 5 | all five |
| UC\_NRAL | Urgent Care 1 | North Raleigh | 35.8700, -78.6200 | urgent | yes | 3 | all five |
| UC\_GAR | Urgent Care 2 | Garner | 35.7113, -78.6142 | urgent | no | 3 | cut, burn, back, child |
| UC\_MOR | Urgent Care 3 | Morrisville | 35.8235, -78.8256 | urgent | yes | 3 | all five |
| UC\_SDUR | Urgent Care 4 | South Durham | 35.9500, -78.9200 | urgent | yes | 3 | all five |
| ORTHO\_RAL | Ortho Walk-in A | Raleigh | 35.8200, -78.6600 | ortho | yes | 2 | sprain/fracture, back |
| ORTHO\_CH | Ortho Walk-in B | Chapel Hill | 35.9600, -79.0000 | ortho | yes | 2 | sprain/fracture, back |
| PEDS\_CARY | Kids Urgent Care A | Cary | 35.7500, -78.8000 | peds | yes | 2 | all but back, ages 0–17 |
| PEDS\_WF | Kids Urgent Care B | Wake Forest | 35.9799, -78.5097 | peds | no | 2 | cut, burn, child, ages 0–17 |

ERs are open 24 hours; urgent cares 8 AM–10 PM; ortho and kids' clinics 8 AM–8 PM.

### Simulation starting values

Choose these once, write down why, and don't tune them to make Triage look good.

| Setting | ER | Urgent care | Ortho | Kids' urgent care |
| --- | --- | --- | --- | --- |
| Minor-injury arrivals per hour (Sat afternoon) | 9 | 5 | 3 | 4 |
| Emergency arrivals per hour (always go first) | 3 | 0 | 0 | 0 |
| Average treatment time, minutes | 75 (emergencies 120) | 40 | 35 | 35 |

- Arrivals are random (Poisson); treatment times random around the average (exponential is fine).
- Wait range: from the current lines, simulate the next 3 hours 200 times; report the 25th–75th percentile wait for someone arriving now, rounded to 5 minutes.
- Drive time: straight-line distance × 1.3 for roads, at 40 km/h, labeled "approx."
- Ranking: total = drive + median wait; shown unadjusted. A best-fit type (ortho for sprain/fracture, kids' clinic for a child) moves ahead only if its total is within 15 minutes of the fastest; otherwise ties go to the shorter drive.
- Random numbers come from a seeded generator (for example mulberry32) so demo mode repeats exactly.

### Scripted demo state (Saturday 4 PM)

People waiting in line at each facility, in demo-state.json:

| ER\_RAL | ER\_DUR | ER\_CH | ER\_CARY | UC\_NRAL | UC\_GAR | UC\_MOR | UC\_SDUR | ORTHO\_RAL | ORTHO\_CH | PEDS\_CARY | PEDS\_WF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 16 | 15 | 12 | 18 | 3 | 6 | 1 | 4 | 1 | 2 | 2 | 0 |

**Demo user location:** near NC State, Raleigh (35.7847, -78.6821).

**Targets the demo must hit** (only the scripted starting lines may be adjusted to hit targets 1 and 2; target 3 is an experiment, not a target):

1. Wrist case, child age 7: first choice Ortho Walk-in A or Kids Urgent Care A with a wait under about 30 minutes; Hospital A ER is the closest pin but shows roughly 2.5–4 hours.
2. A second user with the same case right after the first sees a slightly longer wait at the first user's pick.
3. Busy Saturday: 300 minor-injury patients over 4 hours from random points across the Triangle, nearest ER vs. routed one at a time. Report whatever it shows, with the same random arrivals in both runs, under all three capacity scenarios.

### Gemini intake

**Endpoint:** `POST /api/intake` with `{ "text": "..." }`. Returns the schema from the Gemini intake section, or `{ "error": "..." }` after 10 seconds, in which case the app shows the plain form.

**Instructions to give Gemini (system prompt):**

```
You convert a person's description of an injury into structured data for an app that
shows where to get care. You never diagnose, give medical advice, or reassure.

Rules:
- Extract only what the person said. Use "unknown" for any warning sign not mentioned.
- If the person describes any warning sign, set it to true.
- injury_type must be one of: sprain_or_simple_fracture, cut, minor_burn,
  back_strain, other. Use "other" if unsure.
- Do not ask questions. Leave any warning sign not mentioned as "unknown"
  so the app's fixed checklist can ask the user directly.
- You never decide whether something is an emergency.
```

**Emergency rule in router.js, not in Gemini:** the user must answer every checklist item; any yes or "not sure" means emergency. Gemini's pre-filled answers are only suggestions the user confirms.

## Milestones for Claude Code

Build the logic before the look: routing and safety working with a plain form by 9 PM, Gemini by 10:30, the Saturday simulation by 1 AM, Frutiger Aero in the morning. One milestone per Claude Code session, commit after each.

| # | Milestone | Target | Done when |
| --- | --- | --- | --- |
| 1 | Repo, map (Leaflet + free map tiles), facilities JSON with 12 pins, and a hello-world /api/intake deployed on Vercel | Sat 6:30 PM | Map shows all pins with types; the deployed /api/intake returns a reply from Gemini |
| 2 | Queue simulation and wait ranges, tested on its own | Sat 8:00 PM | ER ranges are longer in the evening; ranges change with load |
| 3 | Emergency screen + ranking, using a plain hand-filled form | Sat 9:00 PM | Wrist case ranks the ortho clinic first; any warning sign shows the ER screen |
| 4 | Server function + Gemini intake, pre-filled safety checklist, confirm chips | Sat 10:30 PM | All 12 safety test cases (below) behave correctly 3 runs in a row |
| 5 | Speech input; a pick joins that facility's line | Sat 11:30 PM | Two picks in a row show different waits for the second person |
| 6 | "Busy Saturday" side-by-side simulation, fixed seed | Sun 1:00 AM | Same numbers every run; all three capacity scenarios reported, whatever they show |
| — | Sleep (shifts are fine) | Sun 1–5 AM | — |
| 7 | About page (sections 1–8), then Frutiger Aero pass: glass panels, orb pins, mic orb, red emergency screen | Sun 7:30 AM | A teammate reads every wait time from arm's length |
| 8 | Freeze; 5 outside testers; record video; Devpost write-up | Sun 9:00 AM | Submitted by 9:00 AM, video included |

**Safety test set (must pass before any design work):** write 12 short descriptions in three groups and check each result. These test prototype guardrails; they are not clinical validation.

- Checklist fully answered, all no → must route to options: kid fell off monkey bars, wrist swollen, moves fingers · cut finger slicing bagels, bleeding stopped · sprained ankle at soccer · back strain moving a couch · small burn from a pan.
- Any checklist yes → must go to ER or 911: grandpa fell and is on blood thinners · kid hit head and is now very sleepy · table saw cut that won't stop bleeding · ankle bent the wrong way · wrist injury and fingers are numb and cold.

* Any checklist item answered "not sure" → must show the emergency path and name that item: kid fell and you're not sure he hit his head · back pain after a fall, not sure about numbness in the legs.

**Prompting tips:** start each session with "Read PLAN.md. We're on milestone N. Don't touch anything outside it." Keep simulation parameters as named constants at the top of one file. Export this doc as Markdown and save it as PLAN.md.

## Demo script and judge Q&A

You open with your own story, the judge does the talking into the app, and the Saturday simulation closes it.

1. **0:00–0:20 Story.** One or two sentences of your own real experience with ER waits or medical costs, then: "Triage fixes the waiting part." Don't use a story that didn't happen; judges can tell.
2. **0:20–0:55 The judge talks.** Hand them the mic: "Pretend your kid just fell off the monkey bars." Gemini pre-fills the safety checklist and the judge taps the rest; ranked options appear on the map with wait ranges and reasons.
3. **0:55–1:15 Safety.** Type the grandpa-on-blood-thinners case. The screen goes solid red: nearest ER, call 911. "That came from a fixed checklist item, not from Gemini. Any yes, and Triage gets out of the way."
4. **1:15–1:45 The Saturday button.** Side by side: everyone to the nearest ER vs. routed. Point at the ER wait column.
5. **1:45–2:00 Close.** "The routing is real. The hospital feed is simulated until hospitals plug in. Nobody should wait six hours in the ER when a clinic ten minutes away has no line."

**Video:** the same five beats as a screen recording with voiceover, under 2:00.

**Extra questions to rehearse** (the core ones are in Goal and pitch):

| Question | Answer |
| --- | --- |
| Is this medical advice? | No. It never diagnoses. It shows where care is available and sends anything with a warning sign to the ER. |
| What about insurance and cost? | Out of scope for this weekend; a natural next layer using hospitals' published price files. |
| How accurate are the waits? | Simulated ranges, not promises. With real feeds, the same method shows real ranges. |
| What about people without cars? | Next step: transit and rideshare times. Today it shows drive time only. |
| Who pays for this? | Health systems, to keep low-urgency patients out of crowded ERs and in their own urgent cares. |

## About page (doubles as the presentation)

One scrolling page at /about, built for judges: each section fills about one screen and answers one question, so you can scroll while you talk or jump straight to a section when asked. Every chart comes from the same sim.js with fixed seeds, so the About numbers match the app.

1. **The problem.** Two or three real numbers on ER crowding and non-urgent ER visits, each with a source link. Good places to look: CDC's National Hospital Ambulatory Medical Care Survey (ER visits by urgency) and NC health data. No number on this page without a source.
2. **How Triage decides.** The flow diagram: emergency screen first, then routing.
3. **The queue model.** Plain-language explanation: arrivals, lines, treatment slots, emergencies first. A parameter table labeled "invented for the demo."
4. **Wait ranges.** One ER's predicted wait through the afternoon, with a shaded band for the middle half of simulation runs and a lighter one for 10–90%.
5. **The adoption curve (your strongest stats chart).** Average ER wait vs. the share of people using Triage: 0%, 10%, 25%, 50%, 100%, each point with an interval from repeated runs. It answers "but who will use it?": does it help even if only some people do? Expect it to level off once urgent cares fill up, and show that honestly.
6. **The herding test.** Capacity-aware routing (one person at a time, updated lines) vs. naive "everyone to the shortest line." Shows the naive version flooding the quiet clinic.
7. **Safety validation.** The 12 safety test cases as a table: description, expected result, actual result, pass.
8. **Limitations and next steps.** Simulated feed, approximate drive times, invented parameters, and what real hospital data would change. The checklist is a prototype guardrail that needs clinical validation. Picks during the demo change only the simulation on that laptop; a real network would share state on a server.

**Charts:** Chart.js from a CDN (keeps the no-build-step rule). Label every simulated number as simulated.

**How to use it in 4 minutes:** live demo first (2 minutes), then show only sections 5 and 7. The rest is there for questions, and a judge who asks "how does the model work?" gets a whole screen instead of a vague answer.

**Timing:** build it Sun 5:00–6:30 AM from sim.js outputs, then the Frutiger Aero pass styles the app and the About page together, both done by 7:30 AM.

## Risks and what to cut first

If you fall behind, cut from the top of this list down; never cut the safety checklist, the simulated-data label, or the honest sensitivity results.

1. Speech input (typing still works)
2. Pediatric facilities and the age filter
3. About page sections other than the adoption curve and safety table, then the Frutiger Aero bubbles and animations (keep the glass panels)
4. The "busy Saturday" simulation (keep live ranking with ranges)

| Risk | Fallback |
| --- | --- |
| Gemini misreads a description | The user confirms every checklist item and can fix the chips; Gemini's answers are only suggestions |
| Venue Wi-Fi drops | Phone hotspot; a demo mode with cached Gemini replies for the scripted cases |
| Random waits look similar during the demo | Fixed demo scenario (Saturday 4 PM, fixed seed) |
| A judge asks about a case outside the five types | It says "ER or your doctor's nurse line"; say that's deliberate |
| Safety wording slips into reassurance | One teammate reviews every screen's text against Rule 4 |
| API key leaks via GitHub | Key only in the server function's environment; .env in .gitignore; rotate after the event |

## Sources

- [ACEP: Is it an emergency? (warning signs, when to call an ambulance)](https://www.emergencyphysicians.org/siteassets/files/pdfs/isitanemergency.pdf)
- [ShellHacks 2026 project gallery](https://shellhacks-2026.devpost.com/project-gallery)
- [MHacks 2026 project gallery](https://mhacks-2026.devpost.com/project-gallery)
