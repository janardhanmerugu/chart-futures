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

Load chart history, click **Volume Profile**, then drag across the chart to
select a time range. The selected instrument and exact range timestamps are
sent to the server, which calculates price-level volume from persisted ticks.
The browser draws those historical levels; live ticks do not change an
existing or new profile. The chart shows the point of control (POC), and the
highlighted bars indicate the 70% value area. Each range remains marked by a
shaded rectangle bounded vertically by the selected candles' low and high.
Use **Price grouping** to show 1, 2, 5, or 10 minimum price increments per
row, and **Profile width** to adjust the overlay width. If a selected range
contains more than the server's `MAX_HISTORY_TICKS` limit, the server reports
an error rather than returning a partial profile.

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
