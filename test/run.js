// Discover *.test.js files — avoids shell glob issues on Linux CI runners.
const { readdirSync } = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const files = readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => path.join(__dirname, f));

const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
