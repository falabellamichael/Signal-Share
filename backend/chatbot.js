import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

const BRIDGE_SECRET = process.env.SIGNAL_SHARE_BRIDGE_SECRET || "";
const DEVICE_ID = process.env.SIGNAL_SHARE_DEVICE_ID || "";

const SYSTEM_PROMPT = `You are a helpful assistant for the Signal Share Arcade.
When the user asks to publish a game, output the code inside markdown code blocks with filename annotations.
Example:
\`\`\`html filename=index.html
<!DOCTYPE html>
<html>
...
</html>
\`\`\`
Do not output planning or audits. Just output the code directly.`;

export async function getLocalModelCatalog() {
    // Simple mock or fetch from LM Studio/Ollama
    return {
        lmstudio: ["loaded-model"],
        ollama: ["qwen2.5-coder"],
        all: ["loaded-model", "qwen2.5-coder"],
        checkedAt: new Date().toISOString()
    };
}

async function callLMStudio(messages) {
    try {
        // Fetch loaded models to get the model ID
        const modelsRes = await fetch("http://127.0.0.1:1234/v1/models");
        let modelId = "qwen3.5-2b-uncensored-hauhaucs-aggressive"; // Fallback
        if (modelsRes.ok) {
            const modelsData = await modelsRes.json();
            if (modelsData.data && modelsData.data.length > 0) {
                modelId = modelsData.data[0].id;
            }
        }

        const response = await fetch("http://127.0.0.1:1234/v1/chat/completions", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelId,
                messages: messages,
                temperature: 0.7,
                stream: false
            })
        });
        if (response.ok) {
            const data = await response.json();
            return data.choices[0].message.content;
        }
    } catch (e) {
        console.warn("[Chatbot] LM Studio connection failed:", e.message);
    }
    return null;
}

async function callOllama(messages) {
    try {
        const response = await fetch("http://127.0.0.1:11434/api/chat", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: "qwen2.5-coder", // Default fallback model
                messages: messages,
                stream: false
            })
        });
        if (response.ok) {
            const data = await response.json();
            return data.message.content;
        }
    } catch (e) {
        console.warn("[Chatbot] Ollama connection failed:", e.message);
    }
    return null;
}

export async function getChatResponse(message, history = [], pageContext = 'Signal Share', iteration = 0, attachment = null, preferredModel = 'auto', customInstructions = "") {
    if (!message && iteration === 0) return "No message provided.";

    console.log(`[Chatbot] Processing message: "${message ? message.substring(0, 50) : 'Tool loop'}..."`);

    const conversation = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.map(h => ({ role: h.role, content: h.content }))
    ];
    
    if (message) {
        conversation.push({ role: "user", content: message });
    }

    // Try LM Studio first
    let reply = await callLMStudio(conversation);
    
    // Fallback to Ollama
    if (!reply) {
        console.log("[Chatbot] Falling back to Ollama...");
        reply = await callOllama(conversation);
    }

    if (!reply) {
        return `❌ [Error]: Failed to connect to local AI servers (LM Studio on 1234 or Ollama on 11434). Please ensure one of them is running.`;
    }

    // Clean up DeepSeek tags if any
    if (reply.includes("<think>")) {
        reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    }

    return reply;
}
