# twake-monitor

Health check and uptime monitor for [Twake Workplace](https://linagora.com/en/twake-workplace) services.

Probes Matrix, JMAP, Cozy Drive, LinShare, and LemonLDAP SSO on a configurable interval. Tracks response times (p50/p95/p99), uptime percentage, SSL certificate expiry, and exposes Prometheus metrics.

## Quick start

```bash
node src/index.js
```

## Endpoints

| Path | Description |
|------|-------------|
| `GET /status` | Full JSON status with percentiles, uptime, cert expiry |
| `GET /metrics` | Prometheus text format (`twake_service_up`, `twake_response_time_ms`, `twake_uptime_ratio`) |
| `GET /health` | Simple `{"healthy": true/false}` — returns 503 if any service is down |

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `CHECK_INTERVAL` | `30` | Seconds between probe cycles |
| `CHECK_TIMEOUT` | `10` | Seconds before a probe times out |
| `PORT` | `3400` | HTTP server port |
| `MATRIX_URL` | `https://matrix.twake.app/...` | Matrix health endpoint |
| `JMAP_URL` | `https://jmap.twake.app/...` | JMAP well-known endpoint |
| `DRIVE_URL` | `https://drive.twake.app/status` | Cozy status endpoint |
| `SSO_URL` | `https://sso.twake.app/...` | LemonLDAP OIDC discovery |
| `LINSHARE_URL` | `https://linshare.twake.app/...` | LinShare API endpoint |

## Example `/status` response

```json
{
  "timestamp": "2026-03-27T06:00:00.000Z",
  "healthy": true,
  "services": {
    "matrix": {
      "status": "up",
      "responseTime": { "last": 42, "p50": 45, "p95": 120, "p99": 180 },
      "uptime": 99.5,
      "checks": 200,
      "certExpiry": "2026-12-15T00:00:00.000Z"
    }
  }
}
```

## Architecture

```
[Cron loop] → [ProbeRunner] → fetch() each service with timeout
                  ↓
           [MetricsStore] → rolling window of results per service
                  ↓
           [HTTP Server] → /status (JSON) | /metrics (Prometheus) | /health (boolean)
```

No external dependencies. Zero `node_modules`. Uses native `fetch()`, `node:http`, `node:tls`.
