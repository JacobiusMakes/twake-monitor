import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MetricsStore } from '../src/metrics.js';

describe('MetricsStore', () => {
  let store;

  beforeEach(() => { store = new MetricsStore(10); });

  it('records probe results', () => {
    store.record('matrix', { status: 'up', httpStatus: 200, responseTime: 45 });
    const status = store.getStatus();
    assert.equal(status.services.matrix.status, 'up');
    assert.equal(status.services.matrix.responseTime.last, 45);
  });

  it('computes uptime percentage', () => {
    store.record('matrix', { status: 'up', httpStatus: 200, responseTime: 40 });
    store.record('matrix', { status: 'up', httpStatus: 200, responseTime: 42 });
    store.record('matrix', { status: 'down', httpStatus: 0, responseTime: 0, error: 'timeout' });

    const status = store.getStatus();
    assert.equal(status.services.matrix.uptime, 66.67); // 2/3
    assert.equal(status.services.matrix.checks, 3);
  });

  it('computes response time percentiles', () => {
    const times = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    for (const t of times) {
      store.record('jmap', { status: 'up', httpStatus: 200, responseTime: t });
    }

    const status = store.getStatus();
    assert.equal(status.services.jmap.responseTime.p50, 50);
    assert.ok(status.services.jmap.responseTime.p95 >= 90);
    assert.equal(status.services.jmap.responseTime.p99, 100);
  });

  it('enforces window size', () => {
    for (let i = 0; i < 20; i++) {
      store.record('drive', { status: 'up', httpStatus: 200, responseTime: i });
    }

    const status = store.getStatus();
    assert.equal(status.services.drive.checks, 10); // window size is 10
  });

  it('isAllHealthy returns true when all up', () => {
    store.record('a', { status: 'up', httpStatus: 200, responseTime: 10 });
    store.record('b', { status: 'up', httpStatus: 200, responseTime: 20 });
    assert.equal(store.isAllHealthy(), true);
  });

  it('isAllHealthy returns false when any down', () => {
    store.record('a', { status: 'up', httpStatus: 200, responseTime: 10 });
    store.record('b', { status: 'down', httpStatus: 0, responseTime: 0 });
    assert.equal(store.isAllHealthy(), false);
  });

  it('tracks last error', () => {
    store.record('sso', { status: 'down', httpStatus: 0, responseTime: 0, error: 'Connection refused' });
    const status = store.getStatus();
    assert.equal(status.services.sso.lastError, 'Connection refused');
  });

  it('tracks certificate expiry', () => {
    store.record('matrix', { status: 'up', httpStatus: 200, responseTime: 50, certExpiry: '2025-12-31T00:00:00.000Z' });
    const status = store.getStatus();
    assert.equal(status.services.matrix.certExpiry, '2025-12-31T00:00:00.000Z');
  });
});

describe('MetricsStore — Prometheus export', () => {
  it('outputs valid Prometheus text format', () => {
    const store = new MetricsStore(10);
    store.record('matrix', { status: 'up', httpStatus: 200, responseTime: 42 });
    store.record('jmap', { status: 'down', httpStatus: 0, responseTime: 0 });

    const prom = store.getPrometheus();
    assert.ok(prom.includes('twake_service_up{service="matrix"} 1'));
    assert.ok(prom.includes('twake_service_up{service="jmap"} 0'));
    assert.ok(prom.includes('twake_response_time_ms{service="matrix"} 42'));
    assert.ok(prom.includes('twake_uptime_ratio{service="matrix"} 1.0000'));
    assert.ok(prom.includes('# HELP'));
    assert.ok(prom.includes('# TYPE'));
  });
});

describe('MetricsStore — percentile edge cases', () => {
  it('returns null for empty data', () => {
    const store = new MetricsStore(10);
    assert.equal(store.percentile([], 50), null);
  });

  it('returns single value for single-element array', () => {
    const store = new MetricsStore(10);
    assert.equal(store.percentile([42], 50), 42);
    assert.equal(store.percentile([42], 99), 42);
  });
});
