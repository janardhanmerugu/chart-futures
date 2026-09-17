# Upstox Futures Chart

Frontend for the Upstox futures chart. It connects to the WebSocket server in `../local_server`.

## Start the Local Server

Open PowerShell in `../local_server` and run:

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

## Create a New Cloudflare Tunnel

Use a second PowerShell window. Make sure `cloudflared` is installed, then run:

```powershell
cloudflared tunnel --url http://127.0.0.1:8765
```

Cloudflare prints a line similar to:

```text
Your quick Tunnel has been created! Visit it at https://example-name.trycloudflare.com
```

That `https://...trycloudflare.com` address is the newly generated public address. Convert it for WebSocket use:

```text
https://example-name.trycloudflare.com
         -> wss://example-name.trycloudflare.com/ws
```

The tunnel terminal must remain open. A new quick tunnel gets a new random hostname, and the old hostname stops working when its tunnel process exits.

## Prevent Changing Tunnel URLs

For regular use, create a named tunnel instead of using `cloudflared tunnel --url`. A named tunnel needs a domain managed by Cloudflare, but its hostname stays stable.

One-time setup:

```powershell
cloudflared tunnel login
cloudflared tunnel create upstox-chart
cloudflared tunnel route dns upstox-chart ws.your-domain.com
```

Create `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: upstox-chart
credentials-file: C:\Users\YOUR_USER\.cloudflared\TUNNEL_ID.json

ingress:
    - hostname: ws.your-domain.com
        service: http://127.0.0.1:8765
    - service: http_status:404
```

Run it whenever the server is running:

```powershell
cloudflared tunnel run upstox-chart
```

Use this permanent WebSocket URL in the frontend:

```text
wss://ws.your-domain.com/ws
```

This avoids changing source files whenever a quick tunnel expires. Keep `server.py` and the named tunnel process running, or install the tunnel as a Windows service for automatic startup.

## Connect Through the Tunnel

Append the generated WebSocket URL as the `ws` query parameter:

```text
file:///D:/upstox-chart/chart-futures/index.html?ws=wss%3A%2F%2Fexample-name.trycloudflare.com%2Fws
```

For a deployed HTTPS page, use the same parameter after the page URL:

```text
https://your-futures-site.example/?ws=wss%3A%2F%2Fexample-name.trycloudflare.com%2Fws
```

Do not use `ws://` from an HTTPS page. Use `wss://`.

## Troubleshooting

- `Cannot connect` usually means `server.py` or `cloudflared` is not running.
- Check that port `8765` is listening:

```powershell
Get-NetTCPConnection -LocalPort 8765
```

- If the tunnel URL is old, start `cloudflared` again and replace the hostname in the `ws` query parameter.
- A missing `DATABASE_URL` disables PostgreSQL persistence but does not prevent WebSocket connections.
