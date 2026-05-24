# Neerazhi — AI Smart Drainage Intelligence

Real-time flood risk monitoring with AI-powered analysis for urban drainage networks.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# 3. Run
npm run dev
# → http://localhost:3000
```

## Pages

| Route | Page |
|---|---|
| `/` | Landing page |
| `/dashboard` | Live monitoring dashboard |
| `/docs` | Technical documentation |
| `/about` | About the project |

## Sensor modes

**Simulator** (default) — no hardware needed. Water levels rise/fall randomly based on the rain toggle.

**Real MQTT** — connect real IoT sensors. Publish to your MQTT broker:
```json
Topic: neerazhi/sensors/MH1
Payload: { "nodeId": 1, "level": 54.3 }
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes (for AI) | Your Anthropic API key |
| `PORT` | No (default: 3000) | Server port |
| `MQTT_BROKER` | Only for real sensors | e.g. `mqtt://localhost:1883` |
| `MQTT_TOPIC` | Only for real sensors | e.g. `neerazhi/sensors/#` |

## Deploy

**Railway:** `railway up` (set `ANTHROPIC_API_KEY` in dashboard)

**VPS:** Use pm2 + nginx with WebSocket proxy headers (`Upgrade`, `Connection`).

See `/docs` for full deployment instructions.

## Tech stack

- **Backend:** Node.js, Express, ws (WebSocket), MQTT
- **Frontend:** Vanilla JS, HTML Canvas, Chart.js
- **AI:** Anthropic Claude (claude-sonnet-4)
- **Algorithms:** Dijkstra pathfinding, DNVI scoring
