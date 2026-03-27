/**
 * Metrics Store — tracks probe results, computes percentiles, and
 * exposes Prometheus-compatible metrics.
 *
 * Each service gets a rolling window of the last N results.
 * Percentile calculation uses the simple nearest-rank method.
 */

export class MetricsStore {
  /**
   * @param {number} windowSize - Max results to keep per service
   */
  constructor(windowSize = 100) {
    this.windowSize = windowSize;
    /** @type {Map<string, Array<{timestamp: number, status: string, httpStatus: number, responseTime: number, error?: string, certExpiry?: string}>>} */
    this.history = new Map();
    /** @type {Map<string, {status: string, lastCheck: number}>} */
    this.current = new Map();
  }

  /**
   * Record a probe result.
   */
  record(serviceId, result) {
    if (!this.history.has(serviceId)) {
      this.history.set(serviceId, []);
    }

    const entry = {
      timestamp: Date.now(),
      ...result,
    };

    const list = this.history.get(serviceId);
    list.push(entry);
    if (list.length > this.windowSize) list.shift();

    this.current.set(serviceId, {
      status: result.status,
      lastCheck: entry.timestamp,
    });
  }

  /**
   * Get full status for all services.
   */
  getStatus() {
    const services = {};

    for (const [id, entries] of this.history) {
      const times = entries.map(e => e.responseTime).sort((a, b) => a - b);
      const upCount = entries.filter(e => e.status === 'up').length;
      const latest = entries[entries.length - 1];

      services[id] = {
        status: latest?.status || 'unknown',
        lastCheck: latest?.timestamp ? new Date(latest.timestamp).toISOString() : null,
        httpStatus: latest?.httpStatus,
        responseTime: {
          last: latest?.responseTime,
          p50: this.percentile(times, 50),
          p95: this.percentile(times, 95),
          p99: this.percentile(times, 99),
        },
        uptime: entries.length > 0
          ? Math.round((upCount / entries.length) * 10000) / 100
          : null,
        checks: entries.length,
        certExpiry: latest?.certExpiry || null,
        lastError: latest?.error || null,
      };
    }

    return {
      timestamp: new Date().toISOString(),
      healthy: this.isAllHealthy(),
      services,
    };
  }

  /**
   * Check if all services are currently up.
   */
  isAllHealthy() {
    for (const [, state] of this.current) {
      if (state.status === 'down') return false;
    }
    return true;
  }

  /**
   * Compute the Nth percentile from a sorted array.
   */
  percentile(sorted, pct) {
    if (sorted.length === 0) return null;
    const idx = Math.min(
      Math.ceil((pct / 100) * sorted.length) - 1,
      sorted.length - 1
    );
    return sorted[Math.max(0, idx)];
  }

  /**
   * Export metrics in Prometheus text format.
   */
  getPrometheus() {
    const lines = [
      '# HELP twake_service_up 1 if service is up, 0 if down',
      '# TYPE twake_service_up gauge',
    ];

    for (const [id, entries] of this.history) {
      const latest = entries[entries.length - 1];
      if (!latest) continue;

      const up = latest.status === 'up' ? 1 : 0;
      lines.push(`twake_service_up{service="${id}"} ${up}`);
    }

    lines.push('');
    lines.push('# HELP twake_response_time_ms Response time in milliseconds');
    lines.push('# TYPE twake_response_time_ms gauge');

    for (const [id, entries] of this.history) {
      const latest = entries[entries.length - 1];
      if (!latest) continue;
      lines.push(`twake_response_time_ms{service="${id}"} ${latest.responseTime}`);
    }

    lines.push('');
    lines.push('# HELP twake_uptime_ratio Uptime ratio (0-1) over the observation window');
    lines.push('# TYPE twake_uptime_ratio gauge');

    for (const [id, entries] of this.history) {
      const upCount = entries.filter(e => e.status === 'up').length;
      const ratio = entries.length > 0 ? (upCount / entries.length).toFixed(4) : '0';
      lines.push(`twake_uptime_ratio{service="${id}"} ${ratio}`);
    }

    return lines.join('\n') + '\n';
  }
}
