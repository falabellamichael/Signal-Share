/**
 * AI Chatbot Integration Module
 * 
 * This module handles sending messages to your AI backend and displaying responses.
 * You can easily plug in any AI service (Supabase, Node.js/Python API, local model, etc.)
 */

// Configuration - Customize these values based on your AI backend
const CONFIG = {
  // Your AI endpoint URL (e.g., Supabase REST API, Flask API, Node.js API)
  aiEndpoint: 'http://localhost:5000/api/chat', 
  
  // Optional: Custom prompt template for the AI
  customPromptTemplate: null, 
  
  // Optional: Custom response format (JSON, plain text, etc.)
  customResponseFormat: null,
};

// Mock data to simulate AI responses based on user input length
const MOCK_RESPONSES = {
  short: "Here's a helpful answer to your question:",
  medium: `Here's a helpful answer to your question: ${text.substring(0, 50)}...`,
  long: `Here's a comprehensive answer to your question about ${text}: \n\n${text.replace(/\s+/g, ' ')}. This is a detailed response that covers the topic thoroughly. The AI assistant can provide more information based on this context.\n\nHope this helps!`,
};

/**
 * Send message to AI backend and display response
 */
async function sendMessage(message) {
  const text = message.trim();
  
  if (!text) return;

  // Add user message to UI
  addMessage('user', text);
  hideLoading();

  // Simulate network delay (mock)
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Get mock response based on input length
  const responseText = MOCK_RESPONSES[Object.keys(MOCK_RESPONSES).length](text);

  // Add AI message to UI
  addMessage('ai', responseText);
  
  // Store the current response for typing indicator
  currentAiResponse = responseText;
}

/**
 * Start a simulated "typing" effect
 */
function startTyping() {
  isTyping = true;
  typingIndicator.classList.add('active');
  hideLoading();

  // Simulate AI response delay (mock)
  setTimeout(() => {
    isTyping = false;
    typingIndicator.classList.remove('active');
    
    if (currentAiResponse) {
      addMessage('ai', currentAiResponse);
      currentAiResponse = null;
    } else {
      // Fallback to mock response
      const text = message.trim();
      addMessage('ai', MOCK_RESPONSES[Object.keys(MOCK_RESPONSES).length](text));
    }
  }, 1500);
}

/**
 * Show loading indicator
 */
function showLoading() {
  loadingIndicator.classList.add('active');
  typingIndicator.classList.remove('active');
}

/**
 * Hide loading indicator
 */
function hideLoading() {
  loadingIndicator.classList.remove('active');
  typingIndicator.classList.remove('active');
}

/**
 * Update GPU usage display (mock implementation)
 */
function updateGpuUsage() {
  // Simulate GPU/VRAM usage based on message length
  const mockVramUsage = Math.floor(Math.random() * 1024);
  gpuUsageEl.innerHTML = `GPU: ${Math.round((mockVramUsage / 512) * 100)}% | VRAM: ${mockVramUsage}MB`;
}

/**
 * Add a message to the chat history
 */
function addMessage(role, text) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  
  // Create role label if needed
  let roleLabel = '';
  if (role === 'ai') {
    roleLabel = `<span class="role-label">AI Assistant</span>`;
  } else {
    roleLabel = `<span class="role-label">${role}</span>`;
  }

  messageDiv.innerHTML = `${roleLabel}${text.replace(/\n/g, '<br>')}</span>`;
  
  messagesContainer.appendChild(messageDiv);

  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Show typing indicator
 */
function showTyping() {
  isTyping = true;
  typingIndicator.classList.add('active');
  hideLoading();
}

/**
 * Hide typing indicator
 */
function hideTyping() {
  isTyping = false;
  typingIndicator.classList.remove('active');
}

// Export functions for use in other modules
export { sendMessage, startTyping, showLoading, hideLoading };
export { addMessage, updateGpuUsage };
export { CONFIG, MOCK_RESPONSES };
