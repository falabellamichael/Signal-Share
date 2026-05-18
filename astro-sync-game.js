/**
 * Astro Sync - Cosmic Color Match
 * A reaction-based color synchronization game.
 */

'use strict';

// --- Game State ---
const GAME_STATE = {
    isRunning: false,
    score: 0,
    timeLeft: 30, // seconds
    level: 1,
    targetHue: 0,
    currentHue: 0,
    speed: 2, // degrees per frame
    animationId: null,
    timerInterval: null,
    lastTime: 0,
    tolerance: 15, // degrees of tolerance for a match
};

// --- DOM Elements ---
const elements = {
    startButton: document.getElementById('startButton'),
    syncButton: document.getElementById('syncButton'),
    scoreDisplay: document.getElementById('scoreDisplay'),
    timerDisplay: document.getElementById('timerDisplay'),
    levelDisplay: document.getElementById('levelDisplay'),
    targetColorBox: document.getElementById('targetColorBox'),
    currentColorBox: document.getElementById('currentColorBox'),
    messageArea: document.getElementById('messageArea'),
    successSound: document.getElementById('successSound'),
    failSound: document.getElementById('failSound')
};

// --- Audio Helper ---
const playSound = (audioElement) => {
    if (audioElement) {
        audioElement.currentTime = 0;
        audioElement.play().catch(e => console.log("Audio play blocked or failed:", e));
    }
};

// --- Game Logic ---

/** Generates a random hue for the target */
const setRandomTarget = () => {
    GAME_STATE.targetHue = Math.floor(Math.random() * 360);
    elements.targetColorBox.style.backgroundColor = `hsl(${GAME_STATE.targetHue}, 80%, 50%)`;
};

/** Updates the UI text */
const updateUI = () => {
    elements.scoreDisplay.textContent = `Score: ${GAME_STATE.score}`;
    elements.timerDisplay.textContent = `Time: ${Math.ceil(GAME_STATE.timeLeft)}s`;
    elements.levelDisplay.textContent = `Level: ${GAME_STATE.level}`;
};

/** The main game loop for color cycling */
const gameLoop = (currentTime) => {
    if (!GAME_STATE.isRunning) return;

    // Calculate delta time if needed, but simple frame-based increment works fine for this arcade style
    GAME_STATE.currentHue = (GAME_STATE.currentHue + GAME_STATE.speed) % 360;
    
    // Update current color display
    elements.currentColorBox.style.backgroundColor = `hsl(${GAME_STATE.currentHue}, 80%, 50%)`;

    GAME_STATE.animationId = requestAnimationFrame(gameLoop);
};

/** Starts or restarts the game */
const startGame = () => {
    if (GAME_STATE.isRunning) return;

    // Reset State
    GAME_STATE.score = 0;
    GAME_STATE.timeLeft = 30;
    GAME_STATE.level = 1;
    GAME_STATE.speed = 2;
    GAME_STATE.isRunning = true;

    // UI Updates
    elements.startButton.textContent = 'Restart';
    elements.syncButton.disabled = false;
    elements.syncButton.classList.remove('disabled');
    elements.syncButton.textContent = 'Sync!';
    elements.messageArea.textContent = 'Match the colors and click Sync!';
    
    setRandomTarget();
    updateUI();

    // Start Loops
    GAME_STATE.animationId = requestAnimationFrame(gameLoop);
    
    if (GAME_STATE.timerInterval) clearInterval(GAME_STATE.timerInterval);
    GAME_STATE.timerInterval = setInterval(() => {
        GAME_STATE.timeLeft -= 1;
        updateUI();
        
        if (GAME_STATE.timeLeft <= 0) {
            endGame(false); // Time out
        }
    }, 1000);
};

/** Calculates the shortest distance between two hues */
const getHueDistance = (h1, h2) => {
    const diff = Math.abs(h1 - h2);
    return Math.min(diff, 360 - diff);
};

/** Handles the sync attempt */
const handleSync = () => {
    if (!GAME_STATE.isRunning) return;

    const distance = getHueDistance(GAME_STATE.currentHue, GAME_STATE.targetHue);
    
    if (distance <= GAME_STATE.tolerance) {
        // Success!
        playSound(elements.successSound);
        
        // Calculate points based on accuracy
        const accuracy = 1 - (distance / GAME_STATE.tolerance);
        const points = Math.floor(100 + (accuracy * 100));
        GAME_STATE.score += points;
        
        // Level up logic
        GAME_STATE.level += 1;
        GAME_STATE.speed += 0.5; // Increase speed
        GAME_STATE.timeLeft += 5; // Reward time
        
        // Visual feedback
        elements.currentColorBox.classList.add('success-pulse');
        setTimeout(() => elements.currentColorBox.classList.remove('success-pulse'), 300);
        
        elements.messageArea.textContent = `PERFECT SYNC! +${points} pts (Diff: ${Math.floor(distance)}°)`;
        
        // Setup next target
        setRandomTarget();
        updateUI();
    } else {
        // Failure
        playSound(elements.failSound);
        
        GAME_STATE.timeLeft -= 5; // Penalty
        
        // Visual feedback
        elements.currentColorBox.classList.add('fail-shake');
        setTimeout(() => elements.currentColorBox.classList.remove('fail-shake'), 500);
        
        elements.messageArea.textContent = `SYNC FAILED! -5s (Diff: ${Math.floor(distance)}°)`;
        updateUI();
    }
};

/** Ends the game */
const endGame = (completed = false) => {
    GAME_STATE.isRunning = false;
    cancelAnimationFrame(GAME_STATE.animationId);
    clearInterval(GAME_STATE.timerInterval);

    elements.syncButton.disabled = true;
    elements.syncButton.classList.add('disabled');
    elements.syncButton.textContent = 'Locked';
    
    if (completed) {
        elements.messageArea.textContent = `Mission Accomplished! Final Score: ${GAME_STATE.score}`;
    } else {
        elements.messageArea.textContent = `Game Over! Final Score: ${GAME_STATE.score}`;
    }
    
    elements.startButton.textContent = 'Play Again';
};

// --- Event Listeners ---
elements.startButton.addEventListener('click', startGame);
elements.syncButton.addEventListener('click', handleSync);

// Keyboard support
window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
        if (GAME_STATE.isRunning) {
            handleSync();
        } else {
            startGame();
        }
        e.preventDefault(); // Prevent page scroll on space
    }
});

// Initialize UI
updateUI();