require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// ─── Sensor state ────────────────────────────────────────────────
let sensorMode = "sim"; // "sim" | "mqtt"
let rain = false;

const state = {
  levels: {},
  prevLevels: {},
  riseRates: {},
  blockage: {},
  alerts: [],
};

for (let i = 1; i <= 15; i++) {
  state.levels[i] = 20 + Math.random() * 20;
  state.prevLevels[i] = state.levels[i];
  state.riseRates[i] = 0;
  state.blockage[i] = Math.random() * 15;
}

// ─── Simulator tick ──────────────────────────────────────────────
function simTick() {
  if (sensorMode !== "sim") return;
  for (let i = 1; i <= 15; i++) {
    state.prevLevels[i] = state.levels[i];
    if (rain) {
      state.levels[i] += 1 + Math.random() * 3;
    } else {
      state.levels[i] -= 0.5 + Math.random() * 1.5;
    }
    state.levels[i] = Math.max(5, Math.min(100, state.levels[i]));
    state.riseRates[i] = +(state.levels[i] - state.prevLevels[i]).toFixed(2);

    if (state.levels[i] > 80) {
      const alert = {
        id: Date.now() + i,
        node: i,
        level: Math.round(state.levels[i]),
        time: new Date().toISOString(),
        type: "critical",
      };
      state.alerts.unshift(alert);
      if (state.alerts.length > 50) state.alerts.pop();
    }
  }
  broadcast({ type: "sensors", data: buildPayload() });
}

setInterval(simTick, 2000);

// ─── MQTT (real sensor mode) ──────────────────────────────────────
let mqttClient = null;
function connectMQTT() {
  if (!process.env.MQTT_BROKER) return;
  try {
    const mqtt = require("mqtt");
    mqttClient = mqtt.connect(process.env.MQTT_BROKER);
    mqttClient.on("connect", () => {
      mqttClient.subscribe(process.env.MQTT_TOPIC || "neerazhi/sensors/#");
      console.log("MQTT connected to", process.env.MQTT_BROKER);
    });
    mqttClient.on("message", (topic, message) => {
      // Expected payload: { nodeId: 1..15, level: 0..100 }
      try {
        const { nodeId, level } = JSON.parse(message.toString());
        if (nodeId >= 1 && nodeId <= 15) {
          state.prevLevels[nodeId] = state.levels[nodeId];
          state.levels[nodeId] = Math.max(5, Math.min(100, level));
          state.riseRates[nodeId] = +(state.levels[nodeId] - state.prevLevels[nodeId]).toFixed(2);
          broadcast({ type: "sensors", data: buildPayload() });
        }
      } catch (e) {}
    });
    mqttClient.on("error", (e) => console.error("MQTT error:", e.message));
  } catch (e) {
    console.log("MQTT module not available:", e.message);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────
function buildPayload() {
  return Array.from({ length: 15 }, (_, i) => ({
    id: i + 1,
    level: Math.round(state.levels[i + 1]),
    predicted: Math.round(Math.min(100, state.levels[i + 1] + state.riseRates[i + 1] * 5)),
    riseRate: state.riseRates[i + 1],
    blockage: Math.round(state.blockage[i + 1]),
    risk: Math.round(
      0.5 * state.levels[i + 1] +
      0.3 * state.riseRates[i + 1] * 10 +
      0.2 * state.blockage[i + 1]
    ),
    status:
      state.levels[i + 1] < 35 ? "safe" :
      state.levels[i + 1] < 70 ? "warning" : "critical",
  }));
}

function broadcast(msg) {
  const str = JSON.stringify(msg);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(str);
  });
}

// ─── WebSocket ───────────────────────────────────────────────────
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "init", data: buildPayload(), rain, sensorMode }));
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "toggleRain") {
        rain = msg.value;
        broadcast({ type: "rainStatus", rain });
      }
      if (msg.type === "setMode") {
        sensorMode = msg.mode;
        if (msg.mode === "mqtt") connectMQTT();
        broadcast({ type: "modeStatus", sensorMode });
      }
    } catch (e) {}
  });
});

// ─── REST API ────────────────────────────────────────────────────
app.get("/api/sensors", (req, res) => {
  res.json({ sensors: buildPayload(), rain, sensorMode });
});

app.get("/api/history", (req, res) => {
  res.json({ alerts: state.alerts.slice(0, 20) });
});

app.post("/api/analyse", async (req, res) => {
  const { sensors, rain: isRaining, path: safePath, dnvi } = req.body;
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set in .env" });
  }
  const prompt = `You are an AI flood management expert analysing a real drainage network in Tamil Nadu, India.

Current sensor readings from ${sensors.length} manholes:
${sensors.map((n) => `MH${n.id}: level=${n.level}%, predicted(15min)=${n.predicted}%, riseRate=${n.riseRate}%/tick, risk=${n.risk}, status=${n.status}`).join("\n")}

Rain is currently ${isRaining ? "ON (active rainfall)" : "OFF (dry conditions)"}.
Computed optimal safe diversion path: ${safePath || "None found"}.
Top 3 vulnerable nodes by DNVI: ${dnvi || "–"}.

Provide a concise flood risk assessment in 2–3 sentences, then one specific actionable recommendation for drainage operators. Be direct, practical, and localised to urban Tamil Nadu drainage context.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await response.json();
    const text = data.content?.map((b) => b.text || "").join("") || "No response.";
    res.json({ analysis: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/toggle-rain", (req, res) => {
  rain = !rain;
  broadcast({ type: "rainStatus", rain });
  res.json({ rain });
});

// ─── Page routes ─────────────────────────────────────────────────
const pages = ["dashboard", "docs", "about"];
pages.forEach((p) => {
  app.get(`/${p}`, (req, res) => {
    res.sendFile(path.join(__dirname, `../public/pages/${p}.html`));
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ─── Start ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Neerazhi running at http://localhost:${PORT}`);
});
