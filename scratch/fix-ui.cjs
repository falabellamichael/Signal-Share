const fs = require('fs');
const path = 'app-v3-ui.js';
let content = fs.readFileSync(path, 'utf8');
const search = 'onStatusChange: render\r\n  });';
const replace = 'onStatusChange: render,\r\n    setHeroControlMode\r\n  });';
if (content.includes(search)) {
    content = content.replace(search, replace);
} else {
    // Try with LF
    const searchLF = 'onStatusChange: render\n  });';
    const replaceLF = 'onStatusChange: render,\n    setHeroControlMode\n  });';
    content = content.replace(searchLF, replaceLF);
}
fs.writeFileSync(path, content);
console.log('Done');
