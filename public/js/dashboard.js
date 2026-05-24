// ── Neerazhi Dashboard JS ──────────────────────────────────────

const EDGES = [
  [1,2],[2,3],[3,4],[4,5],[1,6],[2,7],[3,8],[4,9],[5,10],
  [6,7],[7,8],[8,9],[9,10],[6,11],[7,12],[8,13],[9,14],[10,15],
  [11,12],[12,13],[13,14],[14,15],[2,8],[7,3],[8,4],[9,13]
];

const NODE_POS = [null,
  {x:30,y:40},{x:100,y:20},{x:175,y:35},{x:245,y:25},{x:285,y:50},
  {x:20,y:130},{x:95,y:145},{x:170,y:130},{x:248,y:150},{x:290,y:130},
  {x:30,y:250},{x:100,y:235},{x:172,y:255},{x:245,y:240},{x:288,y:255}
];

// ── State ──────────────────────────────────────────────────────
let sensors = [];
let rain = false;
let sensorMode = "sim";
let selectedNode = null;
let ws = null;
let wsReady = false;
let chart = null;
let historyData = { labels: [], datasets: [] };

// ── WebSocket ──────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener("open", () => { wsReady = true; });

  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "init" || msg.type === "sensors") {
      sensors = msg.data;
      rain = msg.rain ?? rain;
      sensorMode = msg.sensorMode ?? sensorMode;
      renderAll();
    }
    if (msg.type === "rainStatus") {
      rain = msg.rain;
      document.getElementById("rainLabel").textContent = rain ? "Rain ON" : "Rain OFF";
      document.getElementById("rainToggle").checked = rain;
    }
    if (msg.type === "modeStatus") {
      sensorMode = msg.sensorMode;
      document.getElementById("modeLabel").textContent =
        sensorMode === "mqtt" ? "Real sensors" : "Simulator";
    }
  });

  ws.addEventListener("close", () => {
    wsReady = false;
    setTimeout(connectWS, 2000);
  });
}

function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ── Colour helpers ─────────────────────────────────────────────
function riskColor(level) {
  if (level < 35) return "#22c55e";
  if (level < 70) return "#f59e0b";
  return "#ef4444";
}

// ── Canvas drawing ─────────────────────────────────────────────
function drawCanvas(canvasId, nodeVal) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const cw = rect.width, ch = rect.height;

  const sx = (cw - 30) / 300, sy = (ch - 30) / 280;

  // Edges
  const safePath = dijkstra();
  const pathSet = new Set();
  if (safePath) {
    for (let i = 0; i < safePath.length - 1; i++) {
      pathSet.add(`${safePath[i]}-${safePath[i + 1]}`);
      pathSet.add(`${safePath[i + 1]}-${safePath[i]}`);
    }
  }

  for (const [a, b] of EDGES) {
    const pa = NODE_POS[a], pb = NODE_POS[b];
    const isPath = pathSet.has(`${a}-${b}`);
    ctx.beginPath();
    ctx.moveTo(15 + pa.x * sx, 15 + pa.y * sy);
    ctx.lineTo(15 + pb.x * sx, 15 + pb.y * sy);
    ctx.strokeStyle = isPath ? "#22d3ee" : "rgba(148,163,184,0.2)";
    ctx.lineWidth = isPath ? 2 : 1;
    ctx.stroke();
  }

  // Nodes
  for (let i = 1; i <= 15; i++) {
    const p = NODE_POS[i];
    const lv = nodeVal(i);
    const cx = 15 + p.x * sx, cy = 15 + p.y * sy;
    const col = riskColor(lv);
    const isSelected = selectedNode === i;

    ctx.beginPath();
    ctx.arc(cx, cy, isSelected ? 15 : 11, 0, Math.PI * 2);
    ctx.fillStyle = col + "28";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, isSelected ? 15 : 11, 0, Math.PI * 2);
    ctx.strokeStyle = col;
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
    ctx.stroke();

    ctx.fillStyle = col;
    ctx.font = `500 9px 'Segoe UI', sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("MH" + i, cx, cy - 17);
    ctx.font = `400 8px 'Segoe UI', sans-serif`;
    ctx.fillStyle = "#f1f5f9";
    ctx.fillText(Math.round(lv) + "%", cx, cy + 3);
  }
}

// ── Dijkstra ───────────────────────────────────────────────────
function buildGraph() {
  const g = {};
  for (let i = 1; i <= 15; i++) g[i] = [];
  if (!sensors.length) return g;
  for (const [a, b] of EDGES) {
    const ra = sensors[a - 1]?.risk ?? 0;
    const rb = sensors[b - 1]?.risk ?? 0;
    g[a].push({ node: b, cost: 1 + rb / 20 });
    g[b].push({ node: a, cost: 1 + ra / 20 });
  }
  return g;
}

function dijkstra() {
  if (!sensors.length) return null;
  const g = buildGraph();
  let start = 1, maxL = sensors[0]?.level ?? 0;
  let target = 1, minL = sensors[0]?.level ?? 100;
  for (let i = 0; i < sensors.length; i++) {
    if (sensors[i].level > maxL) { maxL = sensors[i].level; start = i + 1; }
    if (sensors[i].level < minL) { minL = sensors[i].level; target = i + 1; }
  }
  if (start === target) return [start];

  const dist = {}, prev = {}, vis = new Set();
  for (let i = 1; i <= 15; i++) dist[i] = Infinity;
  dist[start] = 0;

  while (true) {
    let cur = null, best = Infinity;
    for (let i = 1; i <= 15; i++) {
      if (!vis.has(i) && dist[i] < best) { best = dist[i]; cur = i; }
    }
    if (cur === null || cur === target) break;
    vis.add(cur);
    for (const n of g[cur]) {
      if ((sensors[n.node - 1]?.level ?? 0) > 80) continue;
      const nd = dist[cur] + n.cost;
      if (nd < dist[n.node]) { dist[n.node] = nd; prev[n.node] = cur; }
    }
  }
  if (dist[target] === Infinity) return null;
  const path = []; let c = target;
  while (c !== undefined) { path.unshift(c); c = prev[c]; }
  return path;
}

function dnvi() {
  if (!sensors.length) return [];
  const g = buildGraph();
  return sensors
    .map((s) => ({ id: s.id, score: s.risk * (g[s.id]?.length ?? 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// ── Render ─────────────────────────────────────────────────────
function renderAll() {
  if (!sensors.length) return;

  drawCanvas("currentCanvas", (id) => sensors[id - 1]?.level ?? 0);
  drawCanvas("predictedCanvas", (id) => sensors[id - 1]?.predicted ?? 0);

  const path = dijkstra();
  document.getElementById("pathText").textContent =
    path ? path.map((x) => "MH" + x).join(" → ") : "No safe path found";

  const top = dnvi();
  document.getElementById("dnviText").textContent =
    top.map((x) => "MH" + x.id).join(", ");

  const critical = sensors.filter((s) => s.status === "critical").length;
  document.getElementById("criticalCount").textContent = critical;

  const avg = Math.round(sensors.reduce((a, b) => a + b.level, 0) / sensors.length);
  document.getElementById("avgLevel").textContent = avg + "%";

  updateNodePanel();
  updateAlertTable();
  updateChart();
}

function updateNodePanel() {
  const list = document.getElementById("nodeList");
  if (!list) return;
  list.innerHTML = sensors.map((s) => `
    <div class="node-row ${selectedNode === s.id ? "selected" : ""}" onclick="selectNode(${s.id})">
      <span class="node-id">MH${s.id}</span>
      <div class="node-bar-wrap">
        <div class="node-bar" style="width:${s.level}%;background:${riskColor(s.level)}"></div>
      </div>
      <span class="node-val">${s.level}%</span>
      <span class="badge badge-${s.status === 'critical' ? 'danger' : s.status === 'warning' ? 'warn' : 'safe'}">${s.status}</span>
    </div>
  `).join("");
}

function selectNode(id) {
  selectedNode = selectedNode === id ? null : id;
  renderAll();
  const s = sensors[id - 1];
  if (!s) return;
  document.getElementById("nodeDetail").innerHTML = `
    <div class="detail-grid">
      <div><span class="detail-label">Node</span><span class="detail-val">MH${s.id}</span></div>
      <div><span class="detail-label">Level</span><span class="detail-val">${s.level}%</span></div>
      <div><span class="detail-label">Predicted</span><span class="detail-val">${s.predicted}%</span></div>
      <div><span class="detail-label">Rise rate</span><span class="detail-val">${s.riseRate}/tick</span></div>
      <div><span class="detail-label">Risk score</span><span class="detail-val">${s.risk}</span></div>
      <div><span class="detail-label">Blockage</span><span class="detail-val">${s.blockage}%</span></div>
      <div><span class="detail-label">Status</span><span class="badge badge-${s.status === 'critical' ? 'danger' : s.status === 'warning' ? 'warn' : 'safe'}">${s.status}</span></div>
    </div>
  `;
}

function updateAlertTable() {
  fetch("/api/history")
    .then((r) => r.json())
    .then(({ alerts }) => {
      const tbody = document.getElementById("alertBody");
      if (!tbody) return;
      if (!alerts.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:16px">No alerts yet</td></tr>`;
        return;
      }
      tbody.innerHTML = alerts.slice(0, 8).map((a) => `
        <tr>
          <td>MH${a.node}</td>
          <td>${a.level}%</td>
          <td><span class="badge badge-danger">Critical</span></td>
          <td style="color:var(--muted);font-size:12px">${new Date(a.time).toLocaleTimeString()}</td>
        </tr>
      `).join("");
    });
}

// ── Chart (level history) ─────────────────────────────────────
function initChart() {
  const canvas = document.getElementById("levelChart");
  if (!canvas || !window.Chart) return;

  const ctx = canvas.getContext("2d");
  historyData = {
    labels: [],
    datasets: [
      { label: "Avg level", data: [], borderColor: "#22d3ee", tension: 0.4, fill: false, pointRadius: 0 },
      { label: "Max level", data: [], borderColor: "#ef4444", tension: 0.4, fill: false, pointRadius: 0, borderDash: [4,2] },
    ]
  };
  chart = new Chart(ctx, {
    type: "line",
    data: historyData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { ticks: { color: "#94a3b8", maxTicksLimit: 6 }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { min: 0, max: 100, ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,0.05)" } }
      },
      plugins: { legend: { labels: { color: "#94a3b8", boxWidth: 12 } } }
    }
  });
}

function updateChart() {
  if (!chart || !sensors.length) return;
  const now = new Date().toLocaleTimeString();
  const avg = Math.round(sensors.reduce((a, b) => a + b.level, 0) / sensors.length);
  const max = Math.max(...sensors.map((s) => s.level));

  historyData.labels.push(now);
  historyData.datasets[0].data.push(avg);
  historyData.datasets[1].data.push(Math.round(max));

  if (historyData.labels.length > 30) {
    historyData.labels.shift();
    historyData.datasets.forEach((d) => d.shift && d.data.shift());
    historyData.labels = historyData.labels.slice(-30);
    historyData.datasets[0].data = historyData.datasets[0].data.slice(-30);
    historyData.datasets[1].data = historyData.datasets[1].data.slice(-30);
  }
  chart.update("none");
}

// ── AI analysis ────────────────────────────────────────────────
async function runAI() {
  const btn = document.getElementById("aiBtn");
  const out = document.getElementById("aiOutput");
  if (!btn || !out) return;
  btn.disabled = true;
  btn.textContent = "Analysing…";
  out.textContent = "Sending sensor data to Claude…";

  const path = dijkstra();
  const top = dnvi();

  try {
    const res = await fetch("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sensors,
        rain,
        path: path ? path.map((x) => "MH" + x).join(" → ") : null,
        dnvi: top.map((x) => "MH" + x.id + " (score " + Math.round(x.score) + ")").join(", "),
      }),
    });
    const data = await res.json();
    out.textContent = data.analysis || data.error || "No response.";
  } catch (e) {
    out.textContent = "Error: " + e.message;
  }

  btn.disabled = false;
  btn.textContent = "Run AI analysis";
}

// ── Controls ──────────────────────────────────────────────────
function toggleRain() {
  rain = !rain;
  wsSend({ type: "toggleRain", value: rain });
  document.getElementById("rainLabel").textContent = rain ? "Rain ON" : "Rain OFF";
}

function setMode(mode) {
  sensorMode = mode;
  wsSend({ type: "setMode", mode });
  document.getElementById("modeLabel").textContent =
    mode === "mqtt" ? "Real sensors" : "Simulator";
}

// ── Canvas click ──────────────────────────────────────────────
function setupCanvasClick(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const sx = (rect.width - 30) / 300, sy = (rect.height - 30) / 280;
    for (let i = 1; i <= 15; i++) {
      const p = NODE_POS[i];
      const cx = 15 + p.x * sx, cy = 15 + p.y * sy;
      if (Math.hypot(mx - cx, my - cy) < 16) {
        selectNode(i);
        return;
      }
    }
    selectedNode = null;
    renderAll();
  });
}

// ── Init ──────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  connectWS();
  initChart();
  setupCanvasClick("currentCanvas");
  setupCanvasClick("predictedCanvas");

  window.addEventListener("resize", () => {
    if (sensors.length) renderAll();
  });
});
