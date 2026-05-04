/**
 * SIGNAL SHARE | AI-Chat Apprentice v4.0 (Live Context Edition)
 * 
 * Logic:
 * This orchestrator establishes a high-performance asynchronous bridge to the 
 * local Ollama API. It utilizes the native Node.js 'http' module to manage 
 * raw stream data. By employing NDJSON parsing, it prevents memory overflows.
 * 
 * Innovative Pattern: Context Injection
 * This script automatically scans the project root for 'app.js' and 'config.js'
 * to provide the AI with the exact state structure and configuration constants
 * of Signal Share before each query.
 */

import http from 'node:http';
import readline from 'node:readline';
import fs from 'node:fs';
import { Buffer } from 'node:buffer';

// --- Configuration ---
const CONFIG = {
    host: '127.0.0.1',
    port: 11434,
    path: '/api/generate',
    model: 'llama3', 
};

const COLORS = {
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    reset: '\x1b[0m',
    bold: '\x1b[1m'
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
});

/**
 * Gathers the current code context to ensure the AI uses local variable names.
 * @returns {string} The formatted context string.
 */
const getProjectContext = () => {
    let context = "PROJECT CONTEXT:\n";
    const filesToRead = ['config.js', 'app.js'];
    
    filesToRead.forEach(file => {
        if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf8');
            // We take the first 1000 characters to keep the prompt lean but informative
            context += `--- FILE: ${file} ---\n${content.substring(0, 1000)}\n`;
        }
    });
    return context;
};

const printHeader = () => {
    process.stdout.write('\x1B[2J\x1B[0f');
    console.log(`${COLORS.cyan}${COLORS.bold}============================================================`);
    console.log(`  SIGNAL SHARE | Apprentice CLI v4.0`);
    console.log(`  Target Path: ${process.cwd()}`);
    console.log(`  Context Sync: ${fs.existsSync('app.js') ? 'Active (app.js detected)' : 'None'}`);
    console.log(`============================================================${COLORS.reset}\n`);
};

/**
 * Handles the low-level HTTP stream from the local Ollama API.
 */
const sendPrompt = async (userInput) => {
    // Merge project code context with user input
    const fullPrompt = `${getProjectContext()}\nUSER QUERY: ${userInput}`;

    const payload = JSON.stringify({
        model: CONFIG.model,
        prompt: fullPrompt,
        stream: true
    });

    const options = {
        hostname: CONFIG.host,
        port: CONFIG.port,
        path: CONFIG.path,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
        },
    };

    process.stdout.write(`${COLORS.yellow}${COLORS.bold}>> Apprentice:${COLORS.reset} `);

    const req = http.request(options, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.response) process.stdout.write(parsed.response);
                    if (parsed.done) process.stdout.write('\n\n');
                } catch (e) {}
            }
        });
        res.on('end', () => promptUser());
    });

    req.on('error', (err) => {
        console.error(`\n${COLORS.red}${COLORS.bold}Error:${COLORS.reset} Ollama unreachable. Run 'ollama serve'.\n`);
        promptUser();
    });

    req.write(payload);
    req.end();
};

const promptUser = () => {
    rl.question(`${COLORS.green}${COLORS.bold}>> You:${COLORS.reset} `, (input) => {
        const cmd = input.trim();
        if (cmd.toLowerCase() === 'exit') process.exit(0);
        if (!cmd) return promptUser();
        sendPrompt(cmd);
    });
};

// --- Initial Execution ---
printHeader();
promptUser();