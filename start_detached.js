/**
 * Spawns BotsApp server in a detached background process.
 * Usage: node start_detached.js
 */
const { spawn } = require('child_process');
const path = require('path');

const botDir = __dirname;
const scriptPath = path.join(botDir, 'src', 'index.js');

const child = spawn(process.execPath, [scriptPath], {
    cwd: botDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
});

child.unref();

console.log('BotsApp detached server spawned successfully with PID:', child.pid);
process.exit(0);

