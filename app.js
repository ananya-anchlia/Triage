// UI wiring only. Logic lives in sim.js and router.js (later milestones).

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

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 19,
}).addTo(map);

async function loadFacilities() {
  const res = await fetch("data/facilities.json");
  const facilities = await res.json();
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
loadFacilities();

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
