import fs from 'fs';
const path = 'mini-games.js';
let content = fs.readFileSync(path, 'utf8');

// Fix the hiwindow error
content = content.replace('window.hideAuth = hiwindow.showAuth = showAuth;', 'window.hideAuth = hideAuth;\nwindow.showAuth = showAuth;');

// Fix the trailing garbage
content = content.replace('document.addEventListener(\'DOMContentLoaded\', init);\n, init);', 'document.addEventListener(\'DOMContentLoaded\', init);');

fs.writeFileSync(path, content, 'utf8');
console.log("Fixed mini-games.js corruption");
