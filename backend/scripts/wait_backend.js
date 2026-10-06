/**
 * wait_backend.js — Backend Readiness Waiter
 * Blocks execution until the Node.js Express backend is healthy and responding.
 */

const http = require('http');

const URL = 'http://127.0.0.1:7860/api/health';
const TIMEOUT_MS = 60000;
const start = Date.now();

console.log('[Lifecycle] Waiting for Node.js backend to initialize at http://127.0.0.1:7860...');

function checkBackend() {
  if (Date.now() - start > TIMEOUT_MS) {
    console.error('[Lifecycle Error] Timeout reached waiting for Node.js backend to start.');
    process.exit(1);
  }

  http.get(URL, (res) => {
    if (res.statusCode === 200) {
      console.log('[Lifecycle] Node.js backend is listening and healthy. Continuing startup...');
      process.exit(0);
    } else {
      setTimeout(checkBackend, 500);
    }
  }).on('error', () => {
    setTimeout(checkBackend, 500);
  });
}

checkBackend();
