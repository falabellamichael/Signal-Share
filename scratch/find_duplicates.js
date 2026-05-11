
import fs from 'fs';
import path from 'path';

const files = [
    'api-v3.js',
    'app-v3.js',
    'app-v3-ui.js',
    'hero-media-player.js',
    'hero-media-player-preview.js',
    'hero-media-player-actions.js',
    'messenger-realtime.js',
    'notifications.js'
];

const functionRegex = /function\s+([a-zA-Z0-9_]+)\s*\(/g;
const exportFunctionRegex = /export\s+function\s+([a-zA-Z0-9_]+)\s*\(/g;
const asyncFunctionRegex = /async\s+function\s+([a-zA-Z0-9_]+)\s*\(/g;
const exportAsyncFunctionRegex = /export\s+async\s+function\s+([a-zA-Z0-9_]+)\s*\(/g;

const functionMap = {};

files.forEach(file => {
    try {
        const content = fs.readFileSync(file, 'utf8');
        
        const processMatches = (regex, type) => {
            let match;
            while ((match = regex.exec(content)) !== null) {
                const name = match[1];
                if (!functionMap[name]) functionMap[name] = [];
                functionMap[name].push({ file, type });
            }
        };

        processMatches(functionRegex, 'normal');
        processMatches(exportFunctionRegex, 'export');
        processMatches(asyncFunctionRegex, 'async');
        processMatches(exportAsyncFunctionRegex, 'export-async');
        
    } catch (e) {
        console.error(`Could not read ${file}: ${e.message}`);
    }
});

console.log('Duplicate Function Names:');
Object.keys(functionMap).forEach(name => {
    if (functionMap[name].length > 1) {
        const uniqueFiles = [...new Set(functionMap[name].map(f => f.file))];
        if (uniqueFiles.length > 1) {
            console.log(`- ${name}:`);
            functionMap[name].forEach(f => {
                console.log(`  - ${f.file} (${f.type})`);
            });
        }
    }
});
