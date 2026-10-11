// Web Worker: plays one Busy Saturday comparison off the page's main thread, so the page stays responsive
// and the three capacity scenarios can run at the same time. All logic is in saturday.js.
importScripts("sim.js", "router.js", "saturday.js");

onmessage = (e) => {
  const run = Saturday.start(e.data);
  while (!run.step(10)) postMessage({ assigned: run.assigned(), total: run.total });
  postMessage({ result: run.result() });
};
