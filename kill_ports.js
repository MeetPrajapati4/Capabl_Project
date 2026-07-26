/**
 * kill_ports.js — Cross-platform process lifecycle utility.
 * Force-kills active process listeners on specified ports to prevent EADDRINUSE conflicts.
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
        // Ensure it is listening on that port
        if (parts.length >= 5 && parts[1].includes(`:${port}`)) {
          const pid = parts[parts.length - 1];
          if (parseInt(pid) > 0) {
            pids.add(pid);
          }
        }
      }
      for (const pid of pids) {
        console.log(`[Lifecycle] Force killing PID ${pid} listening on port ${port}...`);
        try {
          execSync(`taskkill /F /PID ${pid}`);
        } catch (killErr) {
          // Process might have exited already
        }
      }
    } else {
      const pids = output.split('\n').map(p => p.trim()).filter(Boolean);
      for (const pid of pids) {
        console.log(`[Lifecycle] Killing PID ${pid} listening on port ${port}...`);
        try {
          execSync(`kill -9 ${pid}`);
        } catch (killErr) {
          // Process exited
        }
      }
    }
  } catch (e) {
    // netstat/lsof exit with non-zero code if no process is found, which is fine
  }
}

console.log('[Lifecycle] Scanning for dangling port allocations...');
PORTS_TO_KILL.forEach(killPort);
console.log('[Lifecycle] Port cleanup completed.');
