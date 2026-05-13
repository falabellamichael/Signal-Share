/**
 * Sudoku Game - Complete Implementation
 * 
 * Features:
 * - Generate new puzzles with difficulty levels
 * - Input validation and move highlighting
 * - Undo/Redo functionality
 * - Hint system with error marking
 * - Timer and move tracking
 * - Win detection
 * - Responsive design
 * 
 * @author Sudoku Game Developer
 */

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const CONSTANTS = {
    GRID_SIZE: 9,
    BOX_SIZE: 3,
    NUMBERS: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    
    // Difficulty configurations (number of cells to fill initially)
    DIFFICULTY_CONFIGS: {
        easy: { filledCells: 30, maxRemovals: 1 },
        medium: { filledCells: 25, maxRemovals: 3 },
        hard: { filledCells: 22, maxRemovals: 5 }
    },
    
    // Timer settings
    DEFAULT_TIME_LIMIT: 600, // seconds for default mode
    
    // Storage keys
    STORAGE_KEYS: {
        HISTORY: 'sudoku_history',
        DIFFICULTY: 'sudoku_difficulty',
        ERROR_MARKS: 'sudoku_error_marks'
    }
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

/**
 * Game state - holds all current game information
 */
class GameState {
    constructor() {
        this.initialGrid = []; // Original puzzle configuration
        this.currentGrid = []; // Current playable grid with user inputs
        this.solutionGrid = []; // Complete solved puzzle
        this.selectedCell = null;
        this.history = []; // For undo functionality
        this.moveCount = 0;
        this.startTime = null;
        this.timerInterval = null;
        this.difficulty = 'medium';
        this.errorMarks = new Map(); // Track error marks by cell index
    }

    saveState() {
        const state = {
            grid: [...this.currentGrid],
            history: this.history,
            moveCount: this.moveCount,
            startTime: this.startTime,
            difficulty: this.difficulty
        };
        localStorage.setItem(CONSTANTS.STORAGE_KEYS.HISTORY, JSON.stringify(state));
    }

    loadState() {
        const saved = localStorage.getItem(CONSTANTS.STORAGE_KEYS.HISTORY);
        if (saved) {
            try {
                const state = JSON.parse(saved);
                this.currentGrid = state.grid;
                this.history = state.history || [];
                this.moveCount = state.moveCount || 0;
                this.difficulty = state.difficulty || 'medium';
            } catch (e) {
                console.error('Failed to load saved state:', e);
            }
        }
    }

    reset() {
        localStorage.removeItem(CONSTANTS.STORAGE_KEYS.HISTORY);
    }

    clearHistory() {
        this.history = [];
    }
}

// ============================================================================
// PULZZLE GENERATOR
// ============================================================================

/**
 * PuzzleGenerator - Creates and validates Sudoku puzzles
 */
class PuzzleGenerator {
    static createEmptyGrid() {
        return Array.from({ length: 9 }, () => 
            Array.from({ length: 9 }, () => 0)
        );
    }

    /**
     * Generate a valid complete Sudoku solution
     */
    static generateSolution() {
        const grid = this.createEmptyGrid();
        
        // Fill diagonal boxes (independent, so any order works)
        for (let i = 0; i < 3; i++) {
            let row, col;
            do {
                row = Math.floor(Math.random() * 3) + i * 3;
                col = Math.floor(Math.random() * 3) + i * 3;
            } while (row === col);
            
            this.fillBox(grid, row, col);
        }

        // Fill remaining cells
        const emptyCells = [];
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (grid[r][c] === 0) {
                    emptyCells.push({ row: r, col: c });
                }
            }
        }

        // Shuffle and fill remaining cells
        this.shuffle(emptyCells);
        for (const cell of emptyCells) {
            const validNumber = this.findValidNumber(grid, cell.row, cell.col);
            if (validNumber) {
                grid[cell.row][cell.col] = validNumber;
            } else {
                break; // Backtrack not implemented for simplicity
            }
        }

        return grid;
    }

    /**
     * Fill a 3x3 box with valid numbers
     */
    static fillBox(grid, startRow, startCol) {
        const nums = [...CONSTANTS.NUMBERS].sort(() => Math.random() - 0.5);
        let row, col;
        
        for (let i = 0; i < 9; i++) {
            do {
                row = startRow + Math.floor(i / 3);
                col = startCol + (i % 3);
            } while (this.boxContains(grid, startRow, startCol, row, col));
            
            grid[row][col] = nums[i];
        }

        // Sort box for consistency
        const rows = [startRow, startRow + 1, startRow + 2];
        const cols = [startCol, startCol + 1, startCol + 2];
        const cells = [];
        for (let r of rows) {
            for (let c of cols) {
                cells.push({ row: r, col: c, value: grid[r][c] });
            }
        }
        cells.sort((a, b) => a.value - b.value);
        
        const sortedCells = cells.map(c => ({ row: c.row, col: c.col }));
        for (let i = 0; i < 9; i++) {
            grid[sortedCells[i].row][sortedCells[i].col] = cells[i].value;
        }
    }

    /**
     * Check if a number is valid to place in the given cell
     */
    static findValidNumber(grid, row, col) {
        const nums = CONSTANTS.NUMBERS.sort(() => Math.random() - 0.5);
        
        for (const num of nums) {
            if (!this.isSafe(grid, row, col, num)) {
                continue;
            }
            grid[row][col] = num;
            
            // Backtrack
            const valid = this.solveRecursively(grid);
            if (valid) return num;
            
            grid[row][col] = 0;
        }
        
        return null;
    }

    /**
     * Check if a number can be placed safely in the given cell
     */
    static isSafe(grid, row, col, num) {
        // Check row and column
        for (let i = 0; i < 9; i++) {
            if (grid[row][i] === num || grid[i][col] === num) {
                return false;
            }
        }

        // Check 3x3 box
        const boxRow = Math.floor(row / 3) * 3;
        const boxCol = Math.floor(col / 3) * 3;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                if (grid[boxRow + i][boxCol + j] === num) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Solve puzzle recursively with backtracking
     */
    static solveRecursively(grid) {
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                if (grid[row][col] === 0) {
                    for (const num of CONSTANTS.NUMBERS) {
                        if (this.isSafe(grid, row, col, num)) {
                            grid[row][col] = num;
                            if (this.solveRecursively(grid)) {
                                return true;
                            }
                            grid[row][col] = 0;
                        }
                    }
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Create puzzle from solution by removing numbers
     */
    static createPuzzle(solution, difficulty) {
        const config = CONSTANTS.DIFFICULTY_CONFIGS[difficulty];
        
        // Deep copy the solution
        let puzzle = JSON.parse(JSON.stringify(solution));

        // Remove cells to create puzzle
        const cellsToRemove = Math.random() * config.maxRemovals;
        const removalCount = Math.floor(cellsToRemove) + 1;
        
        const emptyCells = [];
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (puzzle[r][c] !== 0) {
                    emptyCells.push({ row: r, col: c });
                }
            }
        }

        // Shuffle and remove cells
        this.shuffle(emptyCells);
        const cellsToRemoveCount = Math.min(removalCount, emptyCells.length);
        
        for (let i = 0; i < cellsToRemoveCount; i++) {
            if (emptyCells[i]) {
                puzzle[emptyCells[i].row][emptyCells[i].col] = 0;
            }
        }

        return puzzle;
    }

    /**
     * Shuffle array in place using Fisher-Yates algorithm
     */
    static shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    /**
     * Check if a box contains a specific number at any position
     */
    static boxContains(grid, startRow, startCol, row, col) {
        const boxRow = Math.floor(row / 3) * 3;
        const boxCol = Math.floor(col / 3) * 3;
        
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                if (grid[boxRow + i][boxCol + j] > 0 && 
                    grid[boxRow + i][boxCol + j] === grid[row][col]) {
                    return true;
                }
            }
        }
        
        return false;
    }

    /**
     * Get cells from a specific box
     */
    static getBoxCells(row, col) {
        const startRow = Math.floor(row / 3) * 3;
        const startCol = Math.floor(col / 3) * 3;
        
        const cells = [];
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                cells.push({ row: startRow + i, col: startCol + j });
            }
        }
        
        return cells;
    }

    /**
     * Check if a number is valid at a position
     */
    static isValidMove(grid, row, col, num) {
        // Check row
        for (let c = 0; c < 9; c++) {
            if (c !== col && grid[row][c] === num) return false;
        }

        // Check column
        for (let r = 0; r < 9; r++) {
            if (r !== row && grid[r][col] === num) return false;
        }

        // Check box
        const startRow = Math.floor(row / 3) * 3;
        const startCol = Math.floor(col / 3) * 3;
        
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const r = startRow + i;
                const c = startCol + j;
                if ((r !== row || c !== col) && grid[r][c] === num) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Check if puzzle is valid (no duplicate numbers in rows/cols/boxes)
     */
    static isValidPuzzle(grid) {
        // Check each row
        for (let r = 0; r < 9; r++) {
            const rowNumbers = new Set();
            for (let c = 0; c < 9; c++) {
                if (grid[r][c] !== 0) {
                    if (rowNumbers.has(grid[r][c])) return false;
                    rowNumbers.add(grid[r][c]);
                }
            }
        }

        // Check each column
        for (let c = 0; c < 9; c++) {
            const colNumbers = new Set();
            for (let r = 0; r < 9; r++) {
                if (grid[r][c] !== 0) {
                    if (colNumbers.has(grid[r][c])) return false;
                    colNumbers.add(grid[r][c]);
                }
            }
        }

        // Check each box
        for (let br = 0; br < 3; br++) {
            for (let bc = 0; bc < 3; bc++) {
                const boxNumbers = new Set();
                for (let i = 0; i < 3; i++) {
                    for (let j = 0; j < 3; j++) {
                        const r = br * 3 + i;
                        const c = bc * 3 + j;
                        if (grid[r][c] !== 0) {
                            if (boxNumbers.has(grid[r][c])) return false;
                            boxNumbers.add(grid[r][c]);
                        }
                    }
                }
            }
        }

        return true;
    }
}

// ============================================================================
// UI MANAGER
// ============================================================================

/**
 * UIManager - Handles all UI interactions and updates
 */
class UIManager {
    constructor(game) {
        this.game = game;
        this.gridElement = document.getElementById('grid');
        this.modalOverlay = document.getElementById('modalOverlay');
        
        this.init();
    }

    init() {
        // Setup difficulty buttons
        ['easy', 'medium', 'hard'].forEach(diff => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary';
            btn.textContent = diff.charAt(0).toUpperCase() + diff.slice(1);
            btn.dataset.difficulty = diff;
            btn.addEventListener('click', (e) => this.selectDifficulty(e.target.dataset.difficulty));
            document.getElementById('difficultyButtons').appendChild(btn);
        });

        // Setup action buttons
        document.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => this.handleAction(btn.dataset.action));
        });

        // Setup special buttons
        document.getElementById('checkBtn').addEventListener('click', () => this.checkPuzzle());
        document.getElementById('undoBtn').addEventListener('click', () => this.undo());
        document.getElementById('newGameBtn').addEventListener('click', () => this.newGame());
        document.getElementById('giveUpBtn').addEventListener('click', () => this.giveUp());
        document.getElementById('solveBtn').addEventListener('click', () => this.solvePuzzle());

        // Number pad
        for (const num of CONSTANTS.NUMBERS) {
            const btn = document.createElement('button');
            btn.className = 'num-btn';
            btn.textContent = num;
            btn.addEventListener('click', () => this.enterNumber(num));
            document.querySelector('.number-pad')?.appendChild(btn);
        }

        // Keyboard support
        document.addEventListener('keydown', (e) => this.handleKeydown(e));
    }

    selectDifficulty(difficulty) {
        document.querySelectorAll('.difficulty-buttons .btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        const btn = Array.from(document.querySelectorAll('.difficulty-buttons .btn'))
            .find(b => b.dataset.difficulty === difficulty);
        if (btn) btn.classList.add('active');
        
        this.game.state.difficulty = difficulty;
        localStorage.setItem(CONSTANTS.STORAGE_KEYS.DIFFICULTY, difficulty);
    }

    renderGrid() {
        this.gridElement.innerHTML = '';
        this.game.state.currentGrid.forEach((row, rowIndex) => {
            row.forEach((value, colIndex) => {
                const cell = document.createElement('div');
                cell.className = 'cell';
                
                // Add cell index for selection tracking
                cell.dataset.row = rowIndex;
                cell.dataset.col = colIndex;

                if (value !== 0) {
                    cell.textContent = value;
                    
                    if (this.game.state.initialGrid[rowIndex][colIndex] !== 0) {
                        cell.classList.add('fixed');
                    } else {
                        // Check for error marks
                        const hasErrorMark = this.game.state.errorMarks.has(`${rowIndex},${colIndex}`);
                        if (hasErrorMark) {
                            cell.style.background = '#ffcdd2';
                        }
                        
                        // Highlight same number in grid
                        const selectedCell = this.game.state.selectedCell;
                        if (selectedCell && value === this.game.state.currentGrid[selectedCell.row][selectedCell.col]) {
                            cell.classList.add('same-number');
                        }
                    }
                } else {
                    cell.textContent = '';
                }

                cell.addEventListener('click', () => this.selectCell(rowIndex, colIndex));
                cell.addEventListener('touchstart', (e) => {
                    e.preventDefault(); // Prevent text selection
                });
                
                this.gridElement.appendChild(cell);
            });
        });

        // Add box borders using CSS pseudo-elements would be cleaner,
        // but we'll keep it simple for now
    }

    selectCell(row, col) {
        // Remove previous selection
        document.querySelectorAll('.cell.selected').forEach(cell => {
            cell.classList.remove('selected');
        });

        // Select new cell
        const allCells = this.gridElement.children;
        const index = row * 9 + col;
        if (allCells[index]) {
            allCells[index].classList.add('selected');
            
            // Store selected cell info
            this.game.state.selectedCell = { row, col };

            // Highlight same numbers
            this.highlightSameNumbers(this.game.state.currentGrid[row][col]);
        }
    }

    highlightSameNumbers(number) {
        document.querySelectorAll('.cell').forEach(cell => {
            const rowIndex = parseInt(cell.dataset.row);
            const colIndex = parseInt(cell.dataset.col);
            
            if (number !== 0 && this.game.state.currentGrid[rowIndex][colIndex] === number) {
                cell.classList.add('same-number');
            } else {
                cell.classList.remove('same-number');
            }
        });
    }

    highlightRelatedCells(row, col) {
        document.querySelectorAll('.cell').forEach(cell => {
            const rowIndex = parseInt(cell.dataset.row);
            const colIndex = parseInt(cell.dataset.col);
            
            // Highlight row, column, and box
            if (rowIndex === row || colIndex === col || 
                Math.floor(rowIndex / 3) === Math.floor(row / 3) && 
                Math.floor(colIndex / 3) === Math.floor(col / 3)) {
                
                cell.classList.add('highlighted');
            } else {
                cell.classList.remove('highlighted');
            }
        });
    }

    highlightInvalidNumbers(number, rowIndex, colIndex) {
        document.querySelectorAll('.cell').forEach(cell => {
            const r = parseInt(cell.dataset.row);
            const c = parseInt(cell.dataset.col);
            
            if (this.game.state.currentGrid[r][c] === number && this.game.state.initialGrid[r][c] === 0) {
                cell.classList.add('error');
            } else {
                cell.classList.remove('error');
            }
        });
    }

    handleAction(action) {
        switch (action) {
            case 'hint':
                this.showHint();
                break;
            case 'error-mark':
                this.toggleErrorMark();
                break;
            case 'erase':
                this.eraseCell();
                break;
        }
    }

    showHint() {
        const { row, col } = this.game.state.selectedCell;
        if (!row) return;

        const possibleNumbers = PuzzleGenerator.getValidMoves(this.game.state.initialGrid, row, col);
        
        if (possibleNumbers.length > 0) {
            // Pick a random valid number
            const hintNum = possibleNumbers[Math.floor(Math.random() * possibleNumbers.length)];
            
            // Add to history
            this.game.history.push({
                type: 'hint',
                row, col, number: hintNum
            });
            
            this.updateGrid();
            this.saveState();
        }
    }

    toggleErrorMark() {
        const { row, col } = this.game.state.selectedCell;
        if (!row) return;

        const key = `${row},${col}`;
        
        if (this.game.state.errorMarks.has(key)) {
            this.game.state.errorMarks.delete(key);
        } else {
            this.game.state.errorMarks.set(key, true);
        }
        
        localStorage.setItem(CONSTANTS.STORAGE_KEYS.ERROR_MARKS, 
            JSON.stringify(Array.from(this.game.state.errorMarks.entries())));
        
        // Re-render to show/hide error mark
        this.renderGrid();
    }

    eraseCell() {
        const { row, col } = this.game.state.selectedCell;
        if (!row || this.game.state.initialGrid[row][col] !== 0) return;

        this.game.history.push({
            type: 'erase',
            row, col, oldValue: this.game.state.currentGrid[row][col],
            newValue: null
        });
        
        this.game.state.currentGrid[row][col] = 0;
        this.updateGrid();
        this.saveState();
    }

    enterNumber(number) {
        const { row, col } = this.game.state.selectedCell;
        if (!row || this.game.state.initialGrid[row][col] !== 0) return;

        // Save previous state for undo
        this.game.history.push({
            type: 'number',
            row, col, number
        });

        // Update grid
        this.game.state.currentGrid[row][col] = number;
        
        // Highlight related cells
        this.highlightRelatedCells(row, col);
        
        // Check for invalid numbers visually
        this.highlightInvalidNumbers(number, row, col);
        
        this.updateGrid();
        this.saveState();
    }

    checkPuzzle() {
        const { row, col } = this.game.state.selectedCell;
        if (!row) return;

        const cellValue = this.game.state.currentGrid[row][col];
        if (cellValue === 0) return; // Only check filled cells
        
        if (PuzzleGenerator.isValidMove(this.game.state.initialGrid, row, col, cellValue)) {
            // Valid move - mark as solved
            this.game.history.push({
                type: 'check',
                row, col, number: cellValue, valid: true
            });
            
            const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
            if (cell) cell.classList.add('solved');
        } else {
            // Invalid move - show error
            this.game.history.push({
                type: 'check',
                row, col, number: cellValue, valid: false
            });
            
            const allCells = document.querySelectorAll('.cell');
            allCells.forEach(cell => {
                const r = parseInt(cell.dataset.row);
                const c = parseInt(cell.dataset.col);
                
                if (this.game.state.currentGrid[r][c] === cellValue && this.game.state.initialGrid[r][c] === 0) {
                    cell.classList.add('error');
                } else {
                    cell.classList.remove('error');
                }
            });
        }
        
        this.saveState();
    }

    undo() {
        if (this.game.history.length === 0) return;

        const lastAction = this.game.history.pop();
        
        switch (lastAction.type) {
            case 'number':
                this.game.state.currentGrid[lastAction.row][lastAction.col] = 0;
                break;
            case 'erase':
                this.game.state.currentGrid[lastAction.row][lastAction.col] = lastAction.oldValue;
                break;
            case 'hint':
                this.game.state.currentGrid[lastAction.row][lastAction.col] = lastAction.number;
                break;
            case 'check':
                // Revert the check marker
                const cell = document.querySelector(`.cell[data-row="${lastAction.row}"][data-col="${lastAction.col}"]`);
                if (cell) cell.classList.remove('solved');
                break;
        }

        this.updateGrid();
        this.saveState();
    }

    solvePuzzle() {
        // Create a deep copy of the solution
        const solution = PuzzleGenerator.createPuzzle(
            JSON.parse(JSON.stringify(PuzzleGenerator.solutionGrid)),
            this.game.state.difficulty
        );
        
        this.game.history.push({ type: 'solve' });
        this.game.state.currentGrid = JSON.parse(JSON.stringify(solution));
        
        // Clear error marks
        this.game.state.errorMarks.clear();
        localStorage.removeItem(CONSTANTS.STORAGE_KEYS.ERROR_MARKS);
        
        this.updateGrid();
        this.saveState();
    }

    giveUp() {
        // Show solution
        const solution = PuzzleGenerator.createPuzzle(
            JSON.parse(JSON.stringify(PuzzleGenerator.solutionGrid)),
            this.game.state.difficulty
        );
        
        this.game.history.push({ type: 'giveup' });
        this.game.state.currentGrid = JSON.parse(JSON.stringify(solution));
        this.game.state.errorMarks.clear();
        
        this.updateGrid();
        this.saveState();
        
        // Show modal
        this.showModal('Game Over', 'You gave up! Check out the solution.');
    }

    newGame() {
        if (this.game.state.timerInterval) {
            clearInterval(this.game.state.timerInterval);
        }
        
        const difficulty = document.querySelector('.difficulty-buttons .btn.active')?.dataset.difficulty || 
                        localStorage.getItem(CONSTANTS.STORAGE_KEYS.DIFFICULTY) || 'medium';
        
        this.generateNewPuzzle(difficulty);
    }

    generateNewPuzzle(difficulty) {
        // Generate complete solution
        PuzzleGenerator.solutionGrid = PuzzleGenerator.generateSolution();
        
        // Create puzzle from solution
        const config = CONSTANTS.DIFFICULTY_CONFIGS[difficulty];
        
        // Remove cells to create puzzle
        let puzzle = JSON.parse(JSON.stringify(PuzzleGenerator.solutionGrid));
        const cellsToRemove = Math.random() * config.maxRemovals;
        const removalCount = Math.floor(cellsToRemove) + 1;
        
        const emptyCells = [];
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (puzzle[r][c] !== 0) {
                    emptyCells.push({ row: r, col: c });
                }
            }
        }

        PuzzleGenerator.shuffle(emptyCells);
        const cellsToRemoveCount = Math.min(removalCount, emptyCells.length);
        
        for (let i = 0; i < cellsToRemoveCount; i++) {
            if (emptyCells[i]) {
                puzzle[emptyCells[i].row][emptyCells[i].col] = 0;
            }
        }

        // Set initial state
        this.game.state.initialGrid = JSON.parse(JSON.stringify(puzzle));
        this.game.state.currentGrid = JSON.parse(JSON.stringify(puzzle));
        this.game.state.history = [];
        this.game.state.moveCount = 0;
        this.game.state.selectedCell = null;
        this.game.state.errorMarks.clear();
        
        // Start timer
        this.game.state.startTime = Date.now();
        
        // Render
        this.renderGrid();
        this.updateInfoBar();
        localStorage.removeItem(CONSTANTS.STORAGE_KEYS.HISTORY);
    }

    updateInfoBar() {
        const now = Date.now();
        const elapsedSeconds = Math.floor((now - this.game.state.startTime) / 1000);
        const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
        const seconds = String(elapsedSeconds % 60).padStart(2, '0');
        
        document.getElementById('timeDisplay').textContent = `${minutes}:${seconds}`;
        document.getElementById('moveDisplay').textContent = this.game.state.moveCount;
    }

    updateGrid() {
        // Clear all classes first
        document.querySelectorAll('.cell').forEach(cell => {
            cell.className = 'cell';
            const index = parseInt(cell.dataset.row) * 9 + parseInt(cell.dataset.col);
            if (cell.style.background === '') {
                // Remove background if it's the default
            }
        });

        this.renderGrid();
    }

    showModal(title, message) {
        document.querySelector('.modal h2').textContent = title;
        document.querySelector('.modal p').textContent = message;
        this.modalOverlay.classList.add('visible');
        
        // Close modal when clicking overlay
        this.modalOverlay.addEventListener('click', (e) => {
            if (e.target === this.modalOverlay) {
                this.modalOverlay.classList.remove('visible');
            }
        });
    }

    handleKeydown(e) {
        const { row, col } = this.game.state.selectedCell;
        
        // Number keys
        if (e.key >= '1' && e.key <= '9') {
            this.enterNumber(parseInt(e.key));
            return;
        }
        
        // Delete/Backspace
        if (e.key === 'Backspace' || e.key === 'Delete') {
            this.eraseCell();
            return;
        }
        
        // Arrow keys for navigation
        if (row !== null && col !== null) {
            const rowStep = parseInt(e.key[0]); // 1-9
            let newRow, newCol;

            switch (e.key) {
                case 'ArrowUp': newRow = Math.max(0, row - 1); break;
                case 'ArrowDown': newRow = Math.min(8, row + 1); break;
                case 'ArrowLeft': newCol = Math.max(0, col - 1); break;
                case 'ArrowRight': newCol = Math.min(8, col + 1); break;
            }

            if (rowStep) {
                // Number keys in grid (1-9 for first row)
                const num = parseInt(e.key) - 1;
                this.enterNumber(num);
            } else if (newRow !== undefined || newCol !== undefined) {
                this.selectCell(newRow, newCol);
                
                // Move to next empty cell automatically
                const cellValue = this.game.state.currentGrid[newRow][newCol];
                if (cellValue === 0 && this.game.state.initialGrid[newRow][newCol] === 0) {
                    setTimeout(() => {
                        for (let i = 1; i < 9; i++) {
                            const nextRow = newRow + Math.floor(i / 3); // Move to next row/box
                            const nextCol = newCol % 3; // Same column in that row
                            
                            if (this.game.state.initialGrid[nextRow][nextCol] === 0) {
                                this.selectCell(nextRow, nextCol);
                                break;
                            }
                        }
                    }, 100);
                }
            }
        }

        // V - Validate/Check
        if (e.key.toLowerCase() === 'v') {
            this.checkPuzzle();
        }

        // N - New Game
        if (e.key.toLowerCase() === 'n') {
            this.newGame();
        }

        // U - Undo
        if (e.key.toLowerCase() === 'u' || e.key.toLowerCase() === 'z') {
            this.undo();
        }
    }
}

// ============================================================================
// GAME CONTROLLER
// ============================================================================

/**
 * GameController - Main game controller that coordinates everything
 */
class GameController {
    constructor() {
        this.state = new GameState();
        this.uiManager = null;
        this.init();
    }

    init() {
        // Load saved state or generate new puzzle
        if (localStorage.getItem(CONSTANTS.STORAGE_KEYS.HISTORY)) {
            this.state.loadState();
        } else {
            this.generateNewPuzzle('medium');
        }
        
        // Initialize UI manager
        this.uiManager = new UIManager(this);
    }

    generateNewPuzzle(difficulty) {
        const config = CONSTANTS.DIFFICULTY_CONFIGS[difficulty];
        
        // Generate complete solution
        PuzzleGenerator.solutionGrid = PuzzleGenerator.generateSolution();
        
        // Remove cells to create puzzle
        let puzzle = JSON.parse(JSON.stringify(PuzzleGenerator.solutionGrid));
        const cellsToRemove = Math.random() * config.maxRemovals;
        const removalCount = Math.floor(cellsToRemove) + 1;
        
        const emptyCells = [];
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (puzzle[r][c] !== 0) {
                    emptyCells.push({ row: r, col: c });
                }
            }
        }

        PuzzleGenerator.shuffle(emptyCells);
        const cellsToRemoveCount = Math.min(removalCount, emptyCells.length);
        
        for (let i = 0; i < cellsToRemoveCount; i++) {
            if (emptyCells[i]) {
                puzzle[emptyCells[i].row][emptyCells[i].col] = 0;
            }
        }

        // Set initial state
        this.state.initialGrid = JSON.parse(JSON.stringify(puzzle));
        this.state.currentGrid = JSON.parse(JSON.stringify(puzzle));
        this.state.history = [];
        this.state.moveCount = 0;
        this.state.selectedCell = null;
        this.state.errorMarks.clear();
        
        // Start timer
        this.state.startTime = Date.now();
        
        // Update UI
        this.uiManager.renderGrid();
        this.updateInfoBar();
        
        // Load difficulty from saved state or use default
        const difficultyButton = document.querySelector('.difficulty-buttons .btn.active');
        if (difficultyButton) {
            this.state.difficulty = difficultyButton.dataset.difficulty;
        } else {
            this.state.difficulty = localStorage.getItem(CONSTANTS.STORAGE_KEYS.DIFFICULTY) || 'medium';
        }
        
        // Update difficulty button selection
        document.querySelectorAll('.difficulty-buttons .btn').forEach(btn => {
            if (btn.dataset.difficulty === this.state.difficulty) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Load error marks from storage
        const savedErrorMarks = localStorage.getItem(CONSTANTS.STORAGE_KEYS.ERROR_MARKS);
        if (savedErrorMarks) {
            this.state.errorMarks = new Map(JSON.parse(savedErrorMarks));
        }
    }

    updateInfoBar() {
        const now = Date.now();
        const elapsedSeconds = Math.floor((now - this.state.startTime) / 1000);
        const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
        const seconds = String(elapsedSeconds % 60).padStart(2, '0');
        
        document.getElementById('timeDisplay').textContent = `${minutes}:${seconds}`;
        document.getElementById('moveDisplay').textContent = this.state.moveCount;
    }

    checkForWin() {
        let movesMade = 0;
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (this.state.currentGrid[r][c] !== this.state.initialGrid[r][c]) {
                    movesMade++;
                }
            }
        }

        if (movesMade === 0) {
            clearInterval(this.state.timerInterval);
            this.uiManager.showModal('Congratulations!', 'You solved the Sudoku puzzle! Great job!');
            
            // Show difficulty button to continue or restart
            const currentBtn = document.querySelector('.difficulty-buttons .btn.active');
            if (currentBtn) {
                setTimeout(() => {
                    if (confirm('Puzzle complete! Start a new game?')) {
                        this.generateNewPuzzle(currentBtn.dataset.difficulty);
                    }
                }, 1000);
            } else {
                setTimeout(() => {
                    if (confirm('Puzzle complete! Start a new game?')) {
                        this.generateNewPuzzle(this.state.difficulty);
                    }
                }, 1000);
            }
        }
    }

    startTimer() {
        this.state.timerInterval = setInterval(() => {
            if (this.state.startTime) {
                this.updateInfoBar();
                this.checkForWin();
            }
        }, 1000);
    }

    handleAction(action) {
        switch (action) {
            case 'hint':
                this.uiManager.showHint();
                break;
            case 'error-mark':
                this.uiManager.toggleErrorMark();
                break;
            case 'erase':
                this.uiManager.eraseCell();
                break;
        }
    }

    checkPuzzle() {
        this.uiManager.checkPuzzle();
        
        // Check all cells for valid moves
        let errors = 0;
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const value = this.state.currentGrid[r][c];
                if (value !== 0 && !PuzzleGenerator.isValidMove(this.state.initialGrid, r, c, value)) {
                    errors++;
                }
            }
        }

        if (errors > 0) {
            console.log(`Found ${errors} error(s)`);
        }
    }

    undo() {
        this.uiManager.undo();
    }

    solvePuzzle() {
        this.uiManager.solvePuzzle();
    }

    giveUp() {
        this.uiManager.giveUp();
    }

    newGame() {
        // Clear timer first if running
        if (this.state.timerInterval) {
            clearInterval(this.state.timerInterval);
        }
        
        const difficultyButton = document.querySelector('.difficulty-buttons .btn.active');
        const difficulty = difficultyButton ? difficultyButton.dataset.difficulty : 
                          localStorage.getItem(CONSTANTS.STORAGE_KEYS.DIFFICULTY) || 'medium';
        
        this.generateNewPuzzle(difficulty);
    }

    selectCell(row, col) {
        this.uiManager.selectCell(row, col);
    }

    highlightSameNumbers(number) {
        this.uiManager.highlightSameNumbers(number);
    }

    handleKeydown(e) {
        // Number keys for new game cells
        if (e.key >= '1' && e.key <= '9') {
            const selectedCell = this.state.selectedCell;
            if (selectedCell && this.state.initialGrid[selectedCell.row][selectedCell.col] === 0) {
                this.enterNumber(parseInt(e.key));
            } else {
                // Focus on first empty cell
                for (let r = 0; r < 9; r++) {
                    for (let c = 0; c < 9; c++) {
                        if (this.state.initialGrid[r][c] === 0) {
                            this.selectCell(r, c);
                            this.enterNumber(parseInt(e.key));
                            return;
                        }
                    }
                }
            }
        }

        // Delete/Backspace
        if (e.key === 'Backspace' || e.key === 'Delete') {
            const selectedCell = this.state.selectedCell;
            if (selectedCell && this.state.initialGrid[selectedCell.row][selectedCell.col] === 0) {
                this.eraseCell();
            }
        }

        // Arrow keys for navigation
        if (e.key.startsWith('Arrow')) {
            const { row, col } = this.state.selectedCell;
            if (row !== null && col !== null) {
                const rowStep = parseInt(e.key[0]); // 1-9
                let newRow, newCol;

                switch (e.key) {
                    case 'ArrowUp': newRow = Math.max(0, row - 1); break;
                    case 'ArrowDown': newRow = Math.min(8, row + 1); break;
                    case 'ArrowLeft': newCol = Math.max(0, col - 1); break;
                    case 'ArrowRight': newCol = Math.min(8, col + 1); break;
                }

                if (newRow !== undefined || newCol !== undefined) {
                    this.selectCell(newRow, newCol);
                }
            }
        }

        // V - Validate/Check
        if (e.key.toLowerCase() === 'v') {
            this.checkPuzzle();
        }

        // N - New Game
        if (e.key.toLowerCase() === 'n') {
            this.newGame();
        }

        // U - Undo
        if (e.key.toLowerCase() === 'u' || e.key.toLowerCase() === 'z') {
            this.undo();
        }
    }

    enterNumber(number) {
        const { row, col } = this.state.selectedCell;
        if (!row) return;

        // Save previous state for undo
        this.state.history.push({
            type: 'number',
            row, col, number
        });

        // Update grid
        this.state.currentGrid[row][col] = number;
        
        // Highlight related cells
        this.highlightRelatedCells(row, col);
        
        // Check for invalid numbers visually
        this.highlightInvalidNumbers(number, row, col);
        
        this.saveState();
    }

    highlightRelatedCells(row, col) {
        this.uiManager.highlightRelatedCells(row, col);
    }

    highlightInvalidNumbers(number, rowIndex, colIndex) {
        this.uiManager.highlightInvalidNumbers(number, rowIndex, colIndex);
    }

    saveState() {
        // Add current state to history (excluding timer which we don't want to persist)
        const stateToSave = {
            grid: JSON.parse(JSON.stringify(this.state.currentGrid)),
            history: this.state.history,
            moveCount: this.state.moveCount,
            startTime: this.state.startTime,
            difficulty: this.state.difficulty
        };
        
        // Limit history to last 50 moves for performance
        if (stateToSave.history.length > 50) {
            stateToSave.history = stateToSave.history.slice(-50);
        }
        
        localStorage.setItem(CONSTANTS.STORAGE_KEYS.HISTORY, JSON.stringify(stateToSave));
    }

    // Helper methods
    getSelectedCell() {
        return this.state.selectedCell;
    }

    clearSelection() {
        this.state.selectedCell = null;
        document.querySelectorAll('.cell.selected').forEach(cell => {
            cell.classList.remove('selected');
        });
        this.uiManager.highlightRelatedCells(null, null);
    }

    getErrorMarks() {
        return this.state.errorMarks;
    }

    // Static methods for puzzle generation
    static generateSolution() {
        PuzzleGenerator.solutionGrid = PuzzleGenerator.generateSolution();
        return PuzzleGenerator.solutionGrid;
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Wait for DOM to be ready then start game
document.addEventListener('DOMContentLoaded', () => {
    // Create game controller
    const game = new GameController();
    
    // Attach instance to window for debugging
    window.game = game;
    
    console.log('Sudoku Game initialized!');
    console.log('Keyboard shortcuts: 1-9 (numbers), Delete (erase), V (check), N (new game), U (undo)');
});

// Export for potential use in other files
export { GameController, CONSTANTS, PuzzleGenerator };
