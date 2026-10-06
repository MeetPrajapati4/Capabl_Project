/**
 * kill_ports.js — Cross-platform process port cleanup utility.
 * Force-kills dangling processes on ports 7860, 5173, 5174.
 */

const { execSync } = require('child_process');
const os = require('os');

const PORTS_TO_KILL = [7860, 5173, 5174];

function killPort(port) {
  const isWindows = os.platform() === 'win32';
  try {
    const cmd = isWindows 
      ? `netstat -ano | findstr :${port}`
      : `lsof -t -i:${port}`;
    
    const output = execSync(cmd).toString().trim();
    if (!output) return;

    if (isWindows) {
      const lines = output.split('\n');
      const pids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[1].includes(`:${port}`)) {
          const pid = parts[parts.length - 1];
          if (parseInt(pid) > 0) {
            pids.add(pid);
          }
        }
      }
      for (const pid of pids) {
        console.log(`[Lifecycle] Freeing port ${port} (PID ${pid})...`);
        try {
          execSync(`taskkill /F /PID ${pid}`);
        } catch (killErr) {}
      }
    } else {
      const pids = output.split('\n').map(p => p.trim()).filter(Boolean);
      for (const pid of pids) {
        console.log(`[Lifecycle] Freeing port ${port} (PID ${pid})...`);
        try {
          execSync(`kill -9 ${pid}`);
        } catch (killErr) {}
      }
    }
  } catch (e) {
    // Port is already free
  }
}

console.log('[Lifecycle] Scanning for dangling port allocations...');
PORTS_TO_KILL.forEach(killPort);
console.log('[Lifecycle] Port cleanup completed.');
