#!/usr/bin/env node

/**
 * twake-monitor — Health check and uptime monitor for Twake Workplace
 *
 * Probes each Twake service on a configurable interval and tracks:
 *   - Response time (p50, p95, p99)
 *   - HTTP status codes
 *   - Uptime percentage (rolling window)
 *   - SSL certificate expiry
 *
 * Services monitored:
 *   - Matrix homeserver (/_matrix/client/versions)
 *   - JMAP/TMail (/.well-known/jmap)
 *   - Cozy Drive (/status)
 *   - LinShare (/linshare/webservice/rest/admin/authentication/jwt)
 *   - LemonLDAP SSO (/oauth2/.well-known/openid-configuration)
 *
 * Outputs:
 *   - JSON status endpoint (GET /status)
 *   - Prometheus-compatible metrics (GET /metrics)
 *   - Console log with color-coded status
 */

import { ProbeRunner } from './probes.js';
import { MetricsStore } from './metrics.js';
import { createServer } from 'node:http';

// ── Configuration ────────────────────────────────────────────────
const config = {
  interval: parseInt(process.env.CHECK_INTERVAL || '30') * 1000,
  timeout: parseInt(process.env.CHECK_TIMEOUT || '10') * 1000,
  port: parseInt(process.env.PORT || '3400'),
  historySize: parseInt(process.env.HISTORY_SIZE || '100'),
};

// Service definitions — override URLs via env vars
const services = [
  {
    id: 'matrix',
    name: 'Twake Chat (Matrix)',
    url: process.env.MATRIX_URL || 'https://matrix.twake.app/_matrix/client/versions',
    expect: { status: 200, bodyContains: 'versions' },
  },
  {
    id: 'jmap',
    name: 'Twake Mail (JMAP)',
    url: process.env.JMAP_URL || 'https://jmap.twake.app/.well-known/jmap',
    expect: { status: [200, 302, 401] }, // 302/401 = server alive, auth required
  },
  {
    id: 'sso',
    name: 'SSO (LemonLDAP)',
    url: process.env.SSO_URL || 'https://sso.twake.app/',
    expect: { status: 200 },
  },
  {
    id: 'oidc',
    name: 'OIDC Provider (sign-up)',
    url: process.env.OIDC_URL || 'https://sign-up.twake.app/.well-known/openid-configuration',
    expect: { status: 200, bodyContains: 'authorization_endpoint' },
  },
  {
    id: 'linshare',
    name: 'LinShare',
    url: process.env.LINSHARE_URL || 'https://linshare.twake.app/',
    expect: { status: [200, 302, 401, 404] }, // any HTTP response = server alive
  },
];

// ── Initialize ───────────────────────────────────────────────────
const metrics = new MetricsStore(config.historySize);
const runner = new ProbeRunner(services, metrics, {
  timeout: config.timeout,
});

// ── HTTP Server for status + metrics ─────────────────────────────
const server = createServer((req, res) => {
  if (req.url === '/status' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics.getStatus(), null, 2));
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(metrics.getPrometheus());
  } else if (req.url === '/health') {
    const allUp = metrics.isAllHealthy();
    res.writeHead(allUp ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ healthy: allUp }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// ── Start ────────────────────────────────────────────────────────
async function main() {
  console.log('twake-monitor starting...');
  console.log(`  Interval: ${config.interval / 1000}s`);
  console.log(`  Timeout:  ${config.timeout / 1000}s`);
  console.log(`  Services: ${services.length}`);
  console.log('');

  // Initial probe
  await runner.runAll();

  // Schedule recurring probes
  setInterval(() => runner.runAll(), config.interval);

  // Start HTTP server
  server.listen(config.port, () => {
    console.log(`  Status:  http://localhost:${config.port}/status`);
    console.log(`  Metrics: http://localhost:${config.port}/metrics`);
    console.log(`  Health:  http://localhost:${config.port}/health`);
    console.log('');
  });
}

export { config, services, metrics, runner };
main().catch(err => { console.error(err); process.exit(1); });
