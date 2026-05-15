import fs from "fs";

const path = "arcade-chat.js";
let content = fs.readFileSync(path, "utf8");

const oldBlock = `            addChatMessage('ai', reply || "...");
            arcadeChatHistory.push({ role: 'assistant', content: reply });
            saveCurrentChat();
            updateChatStatus('active');

            // Execute any tags in the reply
            if (window.showFeedback && (reply.includes('[PUBLISH]') || isWorkshopPublishIntentPrompt(text))) {
                window.showFeedback("🕹️ Processing Workshop Assets...", false, 4000);
            }
            const actionResult = await executeArcadeChatActions(reply, { userPrompt: text });

            // AUTO-REFINE: If AI requested a search, automatically fetch it and trigger a follow-up`;

const newBlock = `            // Execute structured action tags before rendering the raw AI reply.
            // This prevents [PUBLISH:{...}] JSON from appearing as a normal chat message.
            if (
                window.showFeedback
                && (
                    reply.includes('[PUBLISH:')
                    || reply.includes('[PUBLISH]')
                    || isWorkshopPublishIntentPrompt(text)
                )
            ) {
                window.showFeedback("🕹️ Processing Workshop Assets...", false, 4000);
            }

            const actionResult = await executeArcadeChatActions(reply, { userPrompt: text });

            if (
                actionResult?.handled
                || actionResult?.publishTagDetected
                || actionResult?.workshopPublishAttempted
                || actionResult?.workshopPublishSucceeded
            ) {
                let publishStatusReply = "";

                if (actionResult.workshopPublishSucceeded) {
                    publishStatusReply = "🕹️ [Workshop Arcade]: Published to Supabase Workshop Arcade.";
                    updateChatStatus('active');
                } else if (actionResult.errorReason) {
                    publishStatusReply = \`⚠️ [Workshop Arcade]: Publish failed — \${actionResult.errorReason}\`;
                    updateChatStatus('idle');
                } else if (actionResult.workshopPublishAttempted) {
                    publishStatusReply = "🕹️ [Workshop Arcade]: Publish request processed.";
                    updateChatStatus('active');
                } else {
                    publishStatusReply = "🕹️ [Workshop Arcade]: Publish action detected.";
                    updateChatStatus('active');
                }

                addChatMessage('ai', publishStatusReply);
                arcadeChatHistory.push({ role: 'assistant', content: publishStatusReply });
                saveCurrentChat();
                return;
            }

            addChatMessage('ai', reply || "...");
            arcadeChatHistory.push({ role: 'assistant', content: reply });
            saveCurrentChat();
            updateChatStatus('active');

            // AUTO-REFINE: If AI requested a search, automatically fetch it and trigger a follow-up`;

if (!content.includes(oldBlock)) {
    console.error("Could not find the exact old arcade-chat.js block.");
    console.error("No changes were made.");
    process.exit(1);
}

content = content.replace(oldBlock, newBlock);

fs.writeFileSync(path, content, "utf8");

console.log("Fixed arcade-chat.js publish flow.");