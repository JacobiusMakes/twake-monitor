import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MetricsStore } from '../src/metrics.js';

describe('MetricsStore', () => {
  let store;

  beforeEach(() => {
    store = new MetricsStore(5);
  });

  it('records and retrieves probe results', () => {
    store.record('matrix', { status: 'up', httpStatus: 200, responseTime: 150 });
    const status = store.getStatus();
    assert.equal(status.services.matrix.status, 'up');
    assert.equal(status.services.matrix.responseTime.last, 150);
    assert.equal(status.services.matrix.checks, 1);
  });

  it('computes uptime percentage', () => {
    store.record('svc', { status: 'up', httpStatus: 200, responseTime: 100 });
    store.record('svc', { status: 'up', httpStatus: 200, responseTime: 110 });
    store.record('svc', { status: 'down', httpStatus: 0, responseTime: 0 });
    store.record('svc', { status: 'up', httpStatus: 200, responseTime: 120 });
    assert.equal(store.getStatus().services.svc.uptime, 75);
  });

  it('enforces rolling window size', () => {
    for (let i = 0; i < 10; i++) {
      store.record('svc', { status: 'up', httpStatus: 200, responseTime: i * 10 });
    }
    assert.equal(store.getStatus().services.svc.checks, 5);
  });

  it('computes percentiles correctly', () => {
    for (const t of [50, 10, 30, 20, 40]) {
      store.record('svc', { status: 'up', httpStatus: 200, responseTime: t });
    }
    const svc = store.getStatus().services.svc;
    assert.equal(svc.responseTime.p50, 30);
    assert.equal(svc.responseTime.p95, 50);
  });

  it('isAllHealthy returns false if any service is down', () => {
    store.record('a', { status: 'up', httpStatus: 200, responseTime: 100 });
    store.record('b', { status: 'down', httpStatus: 0, responseTime: 0 });
    assert.equal(store.isAllHealthy(), false);
  });

  it('isAllHealthy returns true when all up or degraded', () => {
    store.record('a', { status: 'up', httpStatus: 200, responseTime: 100 });
    store.record('b', { status: 'degraded', httpStatus: 500, responseTime: 200 });
    assert.equal(store.isAllHealthy(), true);
  });

  it('tracks cert expiry', () => {
    store.record('svc', { status: 'up', httpStatus: 200, responseTime: 100, certExpiry: '2026-06-01T00:00:00Z' });
    assert.equal(store.getStatus().services.svc.certExpiry, '2026-06-01T00:00:00Z');
  });

  it('exports Prometheus metrics', () => {
    store.record('matrix', { status: 'up', httpStatus: 200, responseTime: 150 });
    store.record('jmap', { status: 'down', httpStatus: 0, responseTime: 0 });
    const prom = store.getPrometheus();
    assert.ok(prom.includes('twake_service_up{service="matrix"} 1'));
    assert.ok(prom.includes('twake_service_up{service="jmap"} 0'));
    assert.ok(prom.includes('twake_response_time_ms{service="matrix"} 150'));
  });
});
