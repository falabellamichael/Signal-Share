/**
 * Calls the dedicated, highly optimized AI Inference Microservice via HTTP.
 * This offloads all VRAM and CPU heavy lifting from the main web application.
 * @param {string} prompt - The user's input text.
 * @returns {Promise<string>} The AI generated response or an error message.
 */
export async function handleAiGeneration(prompt) {
    // IMPORTANT: Ensure this URL matches the port you run inference_service.py on (5001 in our example).
    const INFERENCE_SERVICE_URL = 'http://localhost:5001/api/v3/generate'; 

    try {
        console.log("Sending request to optimized AI Inference Service...");
        
        // Use fetch API for asynchronous network call
        const response = await fetch(INFERENCE_SERVICE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt: prompt }),
        });

        // Error Handling Rule: Check HTTP status code first
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`AI Service failed with status ${response.status}: ${errorData.message || 'Unknown service error'}`);
        }

        const data = await response.json();
        
        // Check application-level success flag from the service
        if (data.status === 'success') {
            return data.response; // Return the clean, optimized result
        } else {
             throw new Error(data.message || "AI Service returned an unknown error.");
        }

    } catch (error) {
        console.error("🚨 Failed to communicate with AI Inference Service:", error);
        // Provide a clear, non-technical user-facing error message
        return "Sorry, the AI service is currently unavailable or encountered an internal error. Please try again later."; 
    }
}
