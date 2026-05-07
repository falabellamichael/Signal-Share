const fs = require('fs');
const path = 'hero-media-player.js';
let lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
// lines are 0-indexed here.
// 997 is index 996. 1016 is index 1015.
lines.splice(996, 20); // Remove 20 lines starting from 997 (index 996)
fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log('Cleanup complete');
