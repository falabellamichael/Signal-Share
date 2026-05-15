/**
 * Chatbot Optimization
 * Optimizes chatbot resource usage
 */
class ChatbotOptimizer {
  constructor() {
    this.messageCache = new Map();
    this.maxMessages = 50;
  }

  optimizeMessageHistory(messages) {
    // Limit message history to prevent memory overload
    if (messages.length > this.maxMessages) {
      return messages.slice(-this.maxMessages);
    }

    // Remove duplicate messages
    const uniqueMessages = [...new Set(messages)];
    return uniqueMessages;
  }
}

export default new ChatbotOptimizer();