# Upstox Futures Chart

Frontend for the Upstox futures chart. It connects to the WebSocket server in `../cloud_server`.

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

## Troubleshooting

- `Cannot connect` usually means `server.py` or `cloudflared` is not running.
- Check that port `8765` is listening:

```powershell
Get-NetTCPConnection -LocalPort 8765
```

- If the public connection fails, check the Oracle services and the Cloudflare route for `tradingcharts.win`.
- A missing `DATABASE_URL` disables PostgreSQL persistence but does not prevent WebSocket connections.
