/**
 * Probe Runner — executes health checks against Twake services.
 *
 * Each probe:
 *   1. Sends an HTTP GET with a timeout
 *   2. Checks HTTP status against expected values
 *   3. Optionally checks response body for a required string
 *   4. Extracts TLS certificate expiry from the response
 *   5. Records the result in the metrics store
 */

import { TLSSocket } from 'node:tls';
import { URL } from 'node:url';

export class ProbeRunner {
  /**
   * @param {Array} services - Service definitions
   * @param {import('./metrics.js').MetricsStore} metrics - Metrics store
   * @param {{ timeout: number }} opts
   */
  constructor(services, metrics, opts = {}) {
    this.services = services;
    this.metrics = metrics;
    this.timeout = opts.timeout || 10000;
  }

  /** Run all probes concurrently. */
  async runAll() {
    const results = await Promise.allSettled(
      this.services.map(svc => this.probe(svc))
    );

    for (let i = 0; i < results.length; i++) {
      const svc = this.services[i];
      const result = results[i].status === 'fulfilled'
        ? results[i].value
        : { status: 'error', error: results[i].reason?.message || 'Unknown error', responseTime: 0 };

      this.metrics.record(svc.id, result);
      this.logResult(svc, result);
    }
  }

  /**
   * Probe a single service.
   *
   * @param {Object} svc - Service definition
   * @returns {{ status: 'up'|'degraded'|'down', httpStatus: number, responseTime: number, error?: string, certExpiry?: string }}
   */
  async probe(svc) {
    const start = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(svc.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'twake-monitor/0.1' },
        redirect: 'follow',
      });

      clearTimeout(timer);
      const responseTime = Math.round(performance.now() - start);
      const body = await res.text();

      // Check HTTP status
      const expectedStatuses = Array.isArray(svc.expect?.status)
        ? svc.expect.status
        : [svc.expect?.status || 200];
      const statusOk = expectedStatuses.includes(res.status);

      // Check body content if required
      let bodyOk = true;
      if (svc.expect?.bodyContains) {
        bodyOk = body.includes(svc.expect.bodyContains);
      }

      // Extract TLS cert expiry for HTTPS endpoints
      let certExpiry;
      try {
        const url = new URL(svc.url);
        if (url.protocol === 'https:') {
          certExpiry = await this.getCertExpiry(url.hostname, parseInt(url.port) || 443);
        }
      } catch { /* cert check is best-effort */ }

      if (statusOk && bodyOk) {
        return { status: 'up', httpStatus: res.status, responseTime, certExpiry };
      }

      return {
        status: 'degraded',
        httpStatus: res.status,
        responseTime,
        error: !statusOk
          ? `Unexpected status ${res.status} (expected ${expectedStatuses.join('|')})`
          : `Response missing expected content "${svc.expect.bodyContains}"`,
        certExpiry,
      };
    } catch (err) {
      clearTimeout(timer);
      const responseTime = Math.round(performance.now() - start);
      return {
        status: 'down',
        httpStatus: 0,
        responseTime,
        error: err.name === 'AbortError'
          ? `Timeout after ${this.timeout}ms`
          : err.message,
      };
    }
  }

  /**
   * Get TLS certificate expiry date.
   * @param {string} host
   * @param {number} port
   * @returns {Promise<string|undefined>} ISO date string of cert expiry
   */
  getCertExpiry(host, port) {
    return new Promise((resolve) => {
      const socket = new TLSSocket(undefined);
      // Use a basic TLS connection to extract the cert
      // This is best-effort — resolve undefined on any failure
      const timer = setTimeout(() => { socket.destroy(); resolve(undefined); }, 5000);

      import('node:tls').then(tls => {
        const conn = tls.connect({ host, port, servername: host }, () => {
          const cert = conn.getPeerCertificate();
          clearTimeout(timer);
          conn.destroy();
          resolve(cert?.valid_to ? new Date(cert.valid_to).toISOString() : undefined);
        });
        conn.on('error', () => { clearTimeout(timer); resolve(undefined); });
      }).catch(() => { clearTimeout(timer); resolve(undefined); });
    });
  }

  logResult(svc, result) {
    const icon = result.status === 'up' ? '\x1b[32m✓\x1b[0m'
      : result.status === 'degraded' ? '\x1b[33m⚠\x1b[0m'
      : '\x1b[31m✗\x1b[0m';
    const time = `${result.responseTime}ms`.padStart(6);
    const extra = result.error ? ` — ${result.error}` : '';
    console.log(`  ${icon} ${svc.name.padEnd(24)} ${time}${extra}`);
  }
}
