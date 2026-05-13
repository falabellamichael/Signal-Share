import fs from 'fs';
const path = 'mini-games.js';
let lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);

// We need to find the first occurrence of "window.setCategory = setCategory;" 
// and keep everything before it, and then only the valid exports.

const firstExportIndex = lines.findIndex(line => line.includes('window.setCategory = setCategory;'));
const secondExportIndex = lines.lastIndexOf('window.setCategory = setCategory;');

if (firstExportIndex !== -1 && secondExportIndex !== -1 && firstExportIndex !== secondExportIndex) {
    console.log(`Cleaning up duplication between ${firstExportIndex} and ${secondExportIndex}`);
    
    // Keep lines up to the first set of exports (but include those exports)
    // The exports end around toggleObstCount
    const exportsEndIndex = lines.indexOf('window.toggleObstCount = toggleObstCount;', firstExportIndex);
    
    if (exportsEndIndex !== -1) {
        const cleanLines = [
            ...lines.slice(0, exportsEndIndex + 1),
            "",
            "/**",
            " * Gathers stats for all games in the suite.",
            " * Used by the AI Companion to provide performance analysis.",
            " */",
            "window.getAllGameStats = function() {",
            "    if (typeof GAMES === 'undefined' || typeof discoverStats !== 'function') return {};",
            "    const allStats = {};",
            "    GAMES.forEach(game => {",
            "        allStats[game.id] = {",
            "            title: game.title,",
            "            stats: discoverStats(game)",
            "        };",
            "    });",
            "    return allStats;",
            "};",
            "",
            "// Start the engine",
            "document.addEventListener('DOMContentLoaded', init);"
        ];
        
        fs.writeFileSync(path, cleanLines.join('\n'), 'utf8');
        console.log("Successfully cleaned mini-games.js");
    }
} else {
    console.log("No duplication found or indices mismatch.");
}
