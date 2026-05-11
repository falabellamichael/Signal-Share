class SnakeGame {
    constructor(canvasId, scoreEl, bestEl, overlay, messageEl, submessageEl, startBtn) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.scoreEl = scoreEl;
        this.bestEl = bestEl;
        this.overlay = overlay;
        this.messageEl = messageEl;
        this.submessageEl = submessageEl;
        this.startBtn = startBtn;

        // Constants & Configuration
        this.gridSize = 20;
        this.tileCount = this.canvas.width / this.gridSize;
        this.snake = [];
        this.food = { x: 5, y: 5 };
        this.dx = 0;
        this.dy = 0;
        this.nextDx = 0;
        this.nextDy = 0;
        this.score = 0;
        this.bestScore = parseInt(localStorage.getItem('snake-best') || '0');
        this.gameLoop = null;
        this.isRunning = false;

        this.setupControls();
    }

    init() {
        this.snake = [
            { x: 10, y: 10 },
            { x: 9, y: 10 },
            { x: 8, y: 10 }
        ];
        this.dx = 1; this.dy = 0;
        this.nextDx = 1; this.nextDy = 0;
        this.score = 0;
        this.updateScoreDisplay();
        this.placeFood();
    }

    placeFood() {
        this.food = {
            x: Math.floor(Math.random() * this.tileCount),
            y: Math.floor(Math.random() * this.tileCount)
        };
        // Don't spawn on snake
        if (this.snake.some(s => s.x === this.food.x && s.y === this.food.y)) {
            this.placeFood();
        }
    }

    updateScoreDisplay() {
        this.scoreEl.textContent = this.score;
        this.bestEl.textContent = this.bestScore;
    }

    draw() {
        // Background
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Grid Lines (Optional but looks cool)
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
        this.ctx.lineWidth = 1;
        for(let i=0; i<this.canvas.width; i+=this.gridSize) {
            this.ctx.beginPath(); this.ctx.moveTo(i, 0); this.ctx.lineTo(i, this.canvas.height); this.ctx.stroke();
            this.ctx.beginPath(); this.ctx.moveTo(0, i); this.ctx.lineTo(this.canvas.width, i); this.ctx.stroke();
        }

        // Food Drawing (Red Neon)
        this.ctx.shadowBlur = 15;
        this.ctx.shadowColor = '#ff3e3e';
        this.ctx.fillStyle = '#ff3e3e';
        this.ctx.beginPath();
        this.ctx.arc(this.food.x * this.gridSize + this.gridSize/2, this.food.y * this.gridSize + this.gridSize/2, this.gridSize/2.5, 0, Math.PI * 2);
        this.ctx.fill();

        // Snake Drawing (Green Neon)
        this.ctx.shadowBlur = 10;
        const snakeColor = '#00ff9d';
        this.ctx.shadowColor = snakeColor;

        this.snake.forEach((segment, i) => {
            // Head is white, body is neon green
            this.ctx.fillStyle = (i === 0) ? '#fff' : snakeColor;
            const padding = 2;
            this.ctx.fillRect(
                segment.x * this.gridSize + padding, 
                segment.y * this.gridSize + padding, 
                this.gridSize - padding * 2, 
                this.gridSize - padding * 2
            );
        });
        this.ctx.shadowBlur = 0; // Reset shadow
    }

    update() {
        this.dx = this.nextDx;
        this.dy = this.nextDy;

        const head = { x: this.snake[0].x + this.dx, y: this.snake[0].y + this.dy };

        // Wall Collision
        if (head.x < 0 || head.x >= this.tileCount || head.y < 0 || head.y >= this.tileCount) {
            this.gameOver();
            return;
        }

        // Self Collision
        if (this.snake.some(s => s.x === head.x && s.y === head.y)) {
            this.gameOver();
            return;
        }

        this.snake.unshift(head);

        if (head.x === this.food.x && head.y === this.food.y) {
            this.score += 10;
            this.updateScoreDisplay();
            if (this.score > this.bestScore) {
                this.bestScore = this.score;
                localStorage.setItem('snake-best', this.bestScore);
                this.bestEl.textContent = this.bestScore;
            }
            this.placeFood();
        } else {
            this.snake.pop();
        }
    }

    gameStep() {
        this.update();
        this.draw();
    }

    startGame() {
        this.init(); // Re-initialize game state on start
        this.isRunning = true;
        this.overlay.classList.add('hidden');
        if (this.gameLoop) clearInterval(this.gameLoop);
        // Game speed remains 100ms
        this.gameLoop = setInterval(() => this.gameStep(), 100);
    }

    gameOver() {
        this.isRunning = false;
        clearInterval(this.gameLoop);
        this.messageEl.textContent = "Game Over";
        this.submessageEl.textContent = `You scored ${this.score} points`;
        this.startBtn.textContent = "Try Again";
        this.overlay.classList.remove('hidden');
    }

    setupControls() {
        // Keyboard Controls
        window.addEventListener('keydown', e => {
            switch(e.key) {
                case 'ArrowUp': case 'w': case 'W': this.setDirection(0, -1); break;
                case 'ArrowDown': case 's': case 'S': this.setDirection(0, 1); break;
                case 'ArrowLeft': case 'a': case 'A': this.setDirection(-1, 0); break;
                case 'ArrowRight': case 'd': case 'D': this.setDirection(1, 0); break;
                case 'Enter': if (!this.isRunning) this.startGame(); break;
            }
        });

        this.startBtn.addEventListener('click', () => {
            if (!this.isRunning) this.startGame();
        });


        // Mobile Controls (Touch events)
        document.getElementById('ctrl-up').addEventListener('touchstart', e => { e.preventDefault(); this.setDirection(0, -1); });
        document.getElementById('ctrl-down').addEventListener('touchstart', e => { e.preventDefault(); this.setDirection(0, 1); });
        document.getElementById('ctrl-left').addEventListener('touchstart', e => { e.preventDefault(); this.setDirection(-1, 0); });
        document.getElementById('ctrl-right').addEventListener('touchstart', e => { e.preventDefault(); this.setDirection(1, 0); });
        
        // Mouse Fallbacks for dev testing
        document.getElementById('ctrl-up').addEventListener('mousedown', () => this.setDirection(0, -1));
        document.getElementById('ctrl-down').addEventListener('mousedown', () => this.setDirection(0, 1));
        document.getElementById('ctrl-left').addEventListener('mousedown', () => this.setDirection(-1, 0));
        document.getElementById('ctrl-right').addEventListener('mousedown', () => this.setDirection(1, 0));
    }

    setDirection(newDx, newDy) {
        if (!this.isRunning) return;
        // Prevent 180 turns
        if (newDx !== 0 && this.dx === -newDx) return;
        if (newDy !== 0 && this.dy === -newDy) return;
        this.nextDx = newDx;
        this.nextDy = newDy;
    }

    // Initial setup call to run the game when loaded
    this.startGame();
}

// Initialization: Run the game when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const scoreEl = document.getElementById('scoreVal');
    const bestEl = document.getElementById('bestVal');
    const overlay = document.getElementById('overlay');
    const messageEl = document.getElementById('message');
    const submessageEl = document.getElementById('submessage');
    const startBtn = document.getElementById('startButton');

    // Instantiate the game logic with necessary DOM elements
    new SnakeGame(
        'gameCanvas', 
        scoreEl, 
        bestEl, 
        overlay, 
        messageEl, 
        submessageEl, 
        startBtn
    );
});