# Upstox Futures Chart

Frontend for the Upstox futures chart. It connects to the WebSocket server in `../cloud_server`.

## Local Project Directories

- Server workspace: `D:\upstox-chart`
- Server code project: `D:\upstox-chart\cloud_server`
- Options web page: `D:\upstox-chart\upstox-chart-options`
- Futures web page: `D:\upstox-chart\chart-futures`

## Start the Local Server

Open PowerShell in `../cloud_server` and run:

```powershell
.venv\Scripts\python.exe server.py
```

The local WebSocket endpoint is:

```text
ws://127.0.0.1:8765/ws
```

Keep this terminal running while using the chart.

## Use Locally

Open `index.html` in a browser. To force the local server, add this query parameter to the file URL:

```text
?ws=ws%3A%2F%2F127.0.0.1%3A8765%2Fws
```

The complete URL will look like:

```text
file:///D:/upstox-chart/chart-futures/index.html?ws=ws%3A%2F%2F127.0.0.1%3A8765%2Fws
```

Then click **Connect** and authenticate with a valid Upstox token.

## Volume Profile

Click **Select Range** (or press **Q**), then drag across the loaded chart to request a profile
for that historical time range. The volume histogram, point of control (POC),
70% value area (VAH/VAL), and volume-weighted average price (VWAP) are
calculated locally from the loaded historical ticks. The backend is requested
only for historical Bid/Ask aggressor-side data used in delta; its volume
totals are not used for the histogram. Live ticks are included in newly drawn
profiles for the active instrument; an existing profile remains fixed after
creation. Delta bars appear to the left of the volume histogram: green is
positive (Ask minus Bid), red is negative. The backend classifies stored
tick-volume estimates using each row's saved bid/ask and falls back to the tick
rule when quotes do not determine a side, so delta is not exact trade-by-trade.
Use **Show delta** to toggle the delta bars, **Price bin Δ** to set the bin
size (default 0.5; for example, 0.05 for options or 1/5 for index futures), **Profile width**
to adjust the histogram, and **Clear** to remove all profiles. The range's left
edge is the shared baseline: volume bars extend right inside the range, while
delta bars extend left outside it. To remove one,
double-click within its time range to select it, click once to deselect it, or
press **D** to delete it. The selected profile is highlighted. Load chart
history covering the range before profiling it.

## Drawing Rectangles

Open **Drawing Tools** in the right sidebar, then click **Draw rectangle** or
press **R** to arm a single rectangle. Click and drag over the chart to draw
it; drawing mode exits when the drag ends. Choose red or green with the fill
color swatches before drawing. Click a rectangle to select it, then double-click
it to delete that rectangle. Use **Clear rectangles** to remove all drawn
areas. You can draw across empty time slots and into future chart space. Press
**Escape** to cancel drawing. Rectangles are cleared when the selected
instrument or loaded history changes.

## Refreshing Bubbles

Use the **↻** button beside the **Bubbles** checkbox to reload saved tick data
for the selected instrument and the current history date range. This refreshes
the bubble overlay without reloading candles or clearing chart drawings.

## Tick Replay

Connect to the WebSocket server, select a futures contract, choose a trading
date, chart interval, and playback speed in the **Tick Replay** panel of the
right-side drawer, then click **Replay**.
The server streams that session's stored PostgreSQL ticks in timestamp order;
**Pause/Resume** and **Stop** control playback. Replay uses Asia/Kolkata date
boundaries and requires a complete saved session of no more than
`MAX_HISTORY_TICKS` (default 200,000). It does not place orders. Load a live
chart again to return that browser session to the live feed.

## Oracle Cloud Deployment

The production WebSocket server runs on the Oracle Cloud VM at `/opt/upstox-chart`.
The frontend uses the stable named Cloudflare Tunnel hostname:

```text
wss://tradingcharts.win/ws
```

The Cloudflare route is:

```text
tradingcharts.win -> http://127.0.0.1:8765
```

On the VM, these services are enabled and start automatically:

```bash
sudo systemctl status upstox-chart
sudo systemctl status cloudflared
```

Do not use `cloudflared tunnel --url`; that creates a temporary Quick Tunnel URL.

### Deploying New Features

Vercel deploys this repository's static frontend only. It does not deploy the
WebSocket backend in `../cloud_server`. Features that add browser messages,
such as `get_price_zones`, must be released in both repositories.

On the Oracle VM, pull the backend production branch and restart the service:

```bash
cd /opt/upstox-chart
git pull origin main
sudo systemctl restart upstox-chart
sudo systemctl status upstox-chart --no-pager
```

Then push the frontend changes to this repository and wait for Vercel to
finish its deployment. Keep the frontend WebSocket URL set to
`wss://socket.tradingcharts.win/ws`; that domain is the backend socket origin,
not the Vercel chart URL.

## Troubleshooting

- `Cannot connect` usually means `server.py` or `cloudflared` is not running.
- Check that port `8765` is listening:

```powershell
Get-NetTCPConnection -LocalPort 8765
```

- If the public connection fails, check the Oracle services and the Cloudflare route for `tradingcharts.win`.
- A missing `DATABASE_URL` disables PostgreSQL persistence but does not prevent WebSocket connections.
