/**
 * wait_backend.js — Lifecycle synchronization utility.
 * Blocks execution until the Flask backend is fully initialized and listening.
 */

const http = require('http');

const URL = 'http://127.0.0.1:7860/api/health';
const TIMEOUT_MS = 60000; // 60 seconds max wait
const start = Date.now();

console.log('[Lifecycle] Waiting for Flask backend to initialize at http://127.0.0.1:7860...');

function checkBackend() {
  if (Date.now() - start > TIMEOUT_MS) {
    console.error('[Lifecycle Error] Timeout reached waiting for Flask backend to start.');
    process.exit(1);
  }

  http.get(URL, (res) => {
    if (res.statusCode === 200) {
      console.log('[Lifecycle] Flask backend is listening and healthy. Continuing startup...');
      process.exit(0);
    } else {
      setTimeout(checkBackend, 500);
    }
  }).on('error', () => {
    // Connection refused or network error, wait and retry
    setTimeout(checkBackend, 500);
  });
}

checkBackend();
