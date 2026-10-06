/**
 * logger.js — Structured JSON Logger Middleware
 * 
 * Emits consistent JSON logs for production observability, tracing requests with
 * unique request IDs, HTTP status, execution latency, and client IP.
 */

const { v4: uuidv4 } = require('uuid');
const { metrics } = require('./metrics');

function structuredLogger(req, res, next) {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);

  // Capture response finish
  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const statusCode = res.statusCode;
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const method = req.method;
    const path = req.originalUrl || req.url;

    // Record in in-memory metrics
    metrics.recordRequest(method, path.split('?')[0], statusCode, durationMs);

    // Format structured log entry
    const logEntry = {
      timestamp: new Date().toISOString(),
      req_id: requestId,
      method,
      path,
      status: statusCode,
      duration_ms: durationMs,
      ip: clientIp,
      user_agent: req.headers['user-agent'] ? req.headers['user-agent'].slice(0, 80) : undefined
    };

    if (statusCode >= 500) {
      console.error(JSON.stringify({ level: 'error', ...logEntry }));
    } else if (statusCode >= 400) {
      console.warn(JSON.stringify({ level: 'warn', ...logEntry }));
    } else {
      // Standard info log for API routes
      if (path.startsWith('/api/') || path === '/healthz') {
        console.log(JSON.stringify({ level: 'info', ...logEntry }));
      }
    }
  });

  next();
}

module.exports = { structuredLogger };
