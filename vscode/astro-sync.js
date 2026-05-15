// --- Game State Management ---
const GAME_STATE = {
    isRunning: false,
    score: 0,
    timeLeft: 30, // seconds
    targetColor: null,
    startTime: null,
    timerInterval: null,
};

// --- DOM Elements ---
const elements = {
    startButton: document.getElementById('startButton'),
    syncButton: document.getElementById('syncButton'),
    scoreDisplay: document.getElementById('scoreDisplay'),
    timerDisplay: document.getElementById('timerDisplay'),
    targetColorBox: document.getElementById('targetColorBox'),
    messageArea: document.getElementById('messageArea')
};

// --- Utility Functions ---

/** Generates a random hex color string (e.g., #A3B1C2) */
const getRandomColor = () => {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
};

/** Updates the UI based on current game state */
const updateUI = () => {
    elements.scoreDisplay.textContent = `Score: ${GAME_STATE.score}`;
    elements.timerDisplay.textContent = `Time Left: ${Math.max(0, Math.floor(GAME_STATE.timeLeft))}s`;

    // Button state logic
    if (GAME_STATE.isRunning && GAME_STATE.targetColor) {
        elements.syncButton.disabled = false;
        elements.syncButton.classList.remove('disabled');
        elements.syncButton.textContent = 'Sync!';
    } else if (!GAME_STATE.isRunning) {
        elements.syncButton.disabled = true;
        elements.syncButton.classList.add('disabled');
        elements.syncButton.textContent = 'Wait for Start';
    }

    // Color display update
    if (GAME_STATE.targetColor) {
        elements.targetColorBox.style.backgroundColor = GAME_STATE.targetColor;
        elements.targetColorBox.textContent = ''; // Clear text when color is active
    } else if (!GAME_STATE.isRunning && !GAME_STATE.targetColor) {
         elements.targetColorBox.style.backgroundColor = '#333';
         elements.targetColorBox.textContent = 'Waiting...';
    }
};

// --- Game Logic Functions ---

/** Starts the game loop and initial state */
const startGame = () => {
    if (GAME_STATE.isRunning) return;

    // Reset State
    GAME_STATE.score = 0;
    GAME_STATE.timeLeft = 30;
    GAME_STATE.targetColor = null;
    GAME_STATE.startTime = Date.now();
    GAME_STATE.isRunning = true;

    elements.startButton.disabled = true;
    elements.messageArea.textContent = 'Find the color and click Sync!';

    // Start Timer
    GAME_STATE.timerInterval = setInterval(updateTimer, 1000);

    // Initial round setup (after a short delay for user to read instructions)
    setTimeout(startNewRound, 2000);
    updateUI();
};

/** Updates the countdown timer */
const updateTimer = () => {
    GAME_STATE.timeLeft -= 1;
    if (GAME_STATE.timeLeft <= 0) {
        endGame();
    }
    updateUI();
};

/** Sets up and displays a new color target for the player */
const startNewRound = () => {
    // Ensure game is running before starting round
    if (!GAME_STATE.isRunning) return;

    // 1. Generate a random color
    const newColor = getRandomColor();
    GAME_STATE.targetColor = newColor;

    // 2. Update the visual target box
    elements.targetColorBox.style.backgroundColor = newColor;
    
    // 3. Enable sync button and update UI
    updateUI();
};


/** Handles player interaction (the click) */
const handleSyncClick = () => {
    if (!GAME_STATE.isRunning || !GAME_STATE.targetColor) return;

    const reactionTimeMs = Date.now() - GAME_STATE.startTime;

    // 1. Check if the clicked color matches the target color (Simulated check: The button itself is always "Sync" but we simulate a successful match for simplicity in this pure JS environment, as there's no second clickable element to compare against.)
    // In a real scenario, the player would click an element *of* that color. Here, clicking the Sync button means they are attempting to sync with the displayed targetColorBox.

    const isMatch = true; // Assume success for this simple implementation structure

    if (isMatch) {
        GAME_STATE.score += 1;
        elements.messageArea.textContent = `Success! Reaction time: ${(reactionTimeMs / 1000).toFixed(2)}s`;
        // Reset start time and immediately move to the next round
        GAME_STATE.startTime = Date.now();
        updateUI();

        setTimeout(startNewRound, 500); // Short delay before next round
    } else {
        // Failure state (not implemented in this simplified click model)
        elements.messageArea.textContent = 'Miss! Try again.';
        GAME_STATE.isRunning = false;
        endGame();
    }
};

/** Stops the game and displays final results */
const endGame = () => {
    if (!GAME_STATE.isRunning) return;

    clearInterval(GAME_STATE.timerInterval);
    GAME_STATE.isRunning = false;
    GAME_STATE.targetColor = null;

    elements.messageArea.textContent = `Game Over! Final Score: ${GAME_STATE.score}. Thanks for playing!`;
    elements.startButton.disabled = false; // Allow restart
    updateUI();
};


// --- Event Listeners and Initialization ---
elements.startButton.addEventListener('click', startGame);
elements.syncButton.addEventListener('click', handleSyncClick);

// Initial UI setup when the page loads
document.addEventListener('DOMContentLoaded', updateUI);