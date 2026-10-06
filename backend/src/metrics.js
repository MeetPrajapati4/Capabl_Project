/**
 * metrics.js — In-Memory Observability & Metrics Collector
 * 
 * Tracks request counts, error rates, streaming latency distribution (avg, p50, p95),
 * and system throughput for the Askify AI research application.
 */

class MetricsCollector {
  constructor() {
    this.startTime = Date.now();
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.activeStreams = 0;
    this.routes = {};
    this.statusCodes = {};
    this.recentLatencies = []; // Rolling window of last 200 latencies in ms
    this.maxLatencyWindow = 200;
  }

  recordRequest(method, route, statusCode, durationMs) {
    this.totalRequests++;
    
    // Track status codes
    const statusKey = String(statusCode);
    this.statusCodes[statusKey] = (this.statusCodes[statusKey] || 0) + 1;
    if (statusCode >= 400) {
      this.totalErrors++;
    }

    // Track routes
    const routeKey = `${method} ${route}`;
    if (!this.routes[routeKey]) {
      this.routes[routeKey] = { count: 0, totalDuration: 0, errors: 0 };
    }
    this.routes[routeKey].count++;
    this.routes[routeKey].totalDuration += durationMs;
    if (statusCode >= 400) {
      this.routes[routeKey].errors++;
    }

    // Rolling latency window
    if (typeof durationMs === 'number' && durationMs >= 0) {
      this.recentLatencies.push(durationMs);
      if (this.recentLatencies.length > this.maxLatencyWindow) {
        this.recentLatencies.shift();
      }
    }
  }

  incrementActiveStreams() {
    this.activeStreams++;
  }

  decrementActiveStreams() {
    if (this.activeStreams > 0) {
      this.activeStreams--;
    }
  }

  getPercentile(percentile) {
    if (this.recentLatencies.length === 0) return 0;
    const sorted = [...this.recentLatencies].sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor((percentile / 100) * sorted.length))
    );
    return Math.round(sorted[index]);
  }

  getSummary() {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const avgLatency = this.recentLatencies.length > 0
      ? Math.round(this.recentLatencies.reduce((a, b) => a + b, 0) / this.recentLatencies.length)
      : 0;

    const errorRatePercent = this.totalRequests > 0
      ? Number(((this.totalErrors / this.totalRequests) * 100).toFixed(2))
      : 0;

    const memory = process.memoryUsage();

    return {
      uptime_seconds: uptimeSeconds,
      uptime_human: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`,
      total_requests: this.totalRequests,
      total_errors: this.totalErrors,
      error_rate_pct: errorRatePercent,
      active_streams: this.activeStreams,
      latencies_ms: {
        samples: this.recentLatencies.length,
        average: avgLatency,
        p50: this.getPercentile(50),
        p90: this.getPercentile(90),
        p95: this.getPercentile(95),
        p99: this.getPercentile(99)
      },
      status_codes: this.statusCodes,
      routes: this.routes,
      memory: {
        rss_mb: Math.round(memory.rss / (1024 * 1024)),
        heap_used_mb: Math.round(memory.heapUsed / (1024 * 1024)),
        heap_total_mb: Math.round(memory.heapTotal / (1024 * 1024))
      }
    };
  }
}

const metrics = new MetricsCollector();

module.exports = { metrics };
