/**
 * Neon Sudoku - Logic Engine
 * Signal Share Mini Games Suite
 */

const CONSTANTS = {
    GRID_SIZE: 9,
    NUMBERS: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    DIFFICULTY_CONFIGS: {
        easy: { filledCells: 45 },
        medium: { filledCells: 35 },
        hard: { filledCells: 25 }
    }
};

class SudokuGame {
    constructor() {
        this.initialGrid = [];
        this.currentGrid = [];
        this.solutionGrid = [];
        this.selectedCell = null;
        this.history = [];
        this.moveCount = 0;
        this.startTime = null;
        this.timerInterval = null;
        this.difficulty = 'medium';
        this.isGameOver = false;

        this.gridElement = document.getElementById('grid');
        this.timeDisplay = document.getElementById('timeDisplay');
        this.moveDisplay = document.getElementById('moveDisplay');
        this.overlay = document.getElementById('overlay');
        this.difficultyDisplay = document.querySelector('#difficultyDisplay .stat-value');

        this.init();
    }

    init() {
        // Setup number pad
        const pad = document.getElementById('numberPad');
        CONSTANTS.NUMBERS.forEach(num => {
            const btn = document.createElement('button');
            btn.className = 'num-btn';
            btn.textContent = num;
            btn.onclick = () => this.enterNumber(num);
            pad.appendChild(btn);
        });

        // Action buttons
        document.querySelectorAll('[data-action]').forEach(btn => {
            btn.onclick = () => this.handleAction(btn.dataset.action);
        });

        document.getElementById('checkBtn').onclick = () => this.checkPuzzle();
        document.getElementById('newGameBtn').onclick = () => {
            this.overlay.style.display = 'flex';
            if (this.timerInterval) clearInterval(this.timerInterval);
        };

        // Keyboard support
        document.addEventListener('keydown', (e) => {
            if (this.isGameOver) return;
            if (e.key >= '1' && e.key <= '9') this.enterNumber(parseInt(e.key));
            if (e.key === 'Backspace' || e.key === 'Delete') this.enterNumber(0);
            if (e.key.startsWith('Arrow')) this.handleArrowKey(e.key);
        });
    }

    start(difficulty) {
        this.difficulty = difficulty;
        this.difficultyDisplay.textContent = difficulty.toUpperCase();
        this.overlay.style.display = 'none';
        this.isGameOver = false;
        this.moveCount = 0;
        this.history = [];
        this.selectedCell = null;
        this.moveDisplay.textContent = '0';
        
        this.generatePuzzle();
        this.render();
        
        this.startTime = Date.now();
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => this.updateTimer(), 1000);
    }

    updateTimer() {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = (elapsed % 60).toString().padStart(2, '0');
        this.timeDisplay.textContent = `${mins}:${secs}`;
    }

    generatePuzzle() {
        // Step 1: Generate valid full solution using backtracking
        this.solutionGrid = Array(9).fill().map(() => Array(9).fill(0));
        this.solve(this.solutionGrid);

        // Step 2: Remove cells based on difficulty
        this.initialGrid = this.solutionGrid.map(row => [...row]);
        const targetFilled = CONSTANTS.DIFFICULTY_CONFIGS[this.difficulty].filledCells;
        let removed = 0;
        const totalToRemove = 81 - targetFilled;

        while (removed < totalToRemove) {
            const r = Math.floor(Math.random() * 9);
            const c = Math.floor(Math.random() * 9);
            if (this.initialGrid[r][c] !== 0) {
                this.initialGrid[r][c] = 0;
                removed++;
            }
        }

        this.currentGrid = this.initialGrid.map(row => [...row]);
    }

    solve(grid) {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (grid[r][c] === 0) {
                    const nums = [...CONSTANTS.NUMBERS].sort(() => Math.random() - 0.5);
                    for (let num of nums) {
                        if (this.isValid(grid, r, c, num)) {
                            grid[r][c] = num;
                            if (this.solve(grid)) return true;
                            grid[r][c] = 0;
                        }
                    }
                    return false;
                }
            }
        }
        return true;
    }

    isValid(grid, row, col, num) {
        for (let i = 0; i < 9; i++) {
            if (grid[row][i] === num || grid[i][col] === num) return false;
        }
        const startRow = Math.floor(row / 3) * 3;
        const startCol = Math.floor(col / 3) * 3;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                if (grid[startRow + i][startCol + j] === num) return false;
            }
        }
        return true;
    }

    render() {
        this.gridElement.innerHTML = '';
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                if (this.initialGrid[r][c] !== 0) cell.classList.add('fixed');
                
                const val = this.currentGrid[r][c];
                cell.textContent = val === 0 ? '' : val;
                
                if (this.selectedCell && this.selectedCell.r === r && this.selectedCell.c === c) {
                    cell.classList.add('selected');
                } else if (this.selectedCell && (this.selectedCell.r === r || this.selectedCell.c === c)) {
                    cell.classList.add('highlighted');
                }

                if (val !== 0 && this.selectedCell && this.currentGrid[this.selectedCell.r][this.selectedCell.c] === val) {
                    cell.classList.add('same-number');
                }

                cell.onclick = () => {
                    this.selectedCell = { r, c };
                    this.render();
                };
                this.gridElement.appendChild(cell);
            }
        }
    }

    enterNumber(num) {
        if (!this.selectedCell || this.isGameOver) return;
        const { r, c } = this.selectedCell;
        if (this.initialGrid[r][c] !== 0) return;

        if (this.currentGrid[r][c] !== num) {
            this.history.push({ r, c, old: this.currentGrid[r][c], new: num });
            this.currentGrid[r][c] = num;
            this.moveCount++;
            this.moveDisplay.textContent = this.moveCount;
            this.render();
            this.checkWin();
        }
    }

    handleAction(action) {
        if (this.isGameOver) return;
        switch (action) {
            case 'undo':
                if (this.history.length > 0) {
                    const last = this.history.pop();
                    this.currentGrid[last.r][last.c] = last.old;
                    this.render();
                }
                break;
            case 'erase':
                this.enterNumber(0);
                break;
            case 'hint':
                this.provideHint();
                break;
        }
    }

    provideHint() {
        if (!this.selectedCell) return;
        const { r, c } = this.selectedCell;
        if (this.initialGrid[r][c] !== 0) return;
        this.enterNumber(this.solutionGrid[r][c]);
    }

    checkPuzzle() {
        const cells = this.gridElement.querySelectorAll('.cell');
        let index = 0;
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const cell = cells[index++];
                if (this.currentGrid[r][c] !== 0 && this.initialGrid[r][c] === 0) {
                    if (this.currentGrid[r][c] !== this.solutionGrid[r][c]) {
                        cell.classList.add('error');
                    } else {
                        cell.classList.add('solved');
                    }
                }
            }
        }
    }

    checkWin() {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (this.currentGrid[r][c] !== this.solutionGrid[r][c]) return;
            }
        }
        this.isGameOver = true;
        clearInterval(this.timerInterval);
        
        // Notify parent of high score
        const score = Math.max(1000 - Math.floor((Date.now() - this.startTime) / 1000), 100);
        window.parent.postMessage({
            type: 'GAME_SCORE',
            gameId: 'sudoku',
            score: score,
            metadata: { difficulty: this.difficulty, moves: this.moveCount }
        }, '*');

        alert(`Simulation Success! You solved it in ${this.moveCount} moves.`);
    }

    handleArrowKey(key) {
        if (!this.selectedCell) {
            this.selectedCell = { r: 0, c: 0 };
        } else {
            switch (key) {
                case 'ArrowUp': this.selectedCell.r = Math.max(0, this.selectedCell.r - 1); break;
                case 'ArrowDown': this.selectedCell.r = Math.min(8, this.selectedCell.r + 1); break;
                case 'ArrowLeft': this.selectedCell.c = Math.max(0, this.selectedCell.c - 1); break;
                case 'ArrowRight': this.selectedCell.c = Math.min(8, this.selectedCell.c + 1); break;
            }
        }
        this.render();
    }
}

// Global start function for overlay
window.startGame = (difficulty) => {
    if (!window.sudokuGame) window.sudokuGame = new SudokuGame();
    window.sudokuGame.start(difficulty);
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    window.sudokuGame = new SudokuGame();
});
