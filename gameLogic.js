class SnakeGame {
    vibrate(ms) {
        if (navigator.vibrate) navigator.vibrate(ms);
    }

    constructor(canvasId, opts = {}) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        // DOM references
        this.scoreEl     = opts.scoreEl;
        this.bestEl      = opts.bestEl;
        this.overlay     = opts.overlay;
        this.messageEl   = opts.messageEl;
        this.submessageEl= opts.submessageEl;
        this.startBtn    = opts.startBtn;

        // Extended stat elements (optional)
        this.foodEatenEl  = opts.foodEatenEl;
        this.timeEl       = opts.timeEl;
        this.movesEl      = opts.movesEl;
        this.speedLvlEl   = opts.speedLvlEl;
        this.streakEl     = opts.streakEl;

        // Settings from URL params (launcher) or defaults
        const p = new URLSearchParams(window.location.search);
        this.gridSize      = parseInt(p.get('grid')      || '20');
        this.gameSpeed     = parseInt(p.get('speed')     || '100');
        this.neonIntensity = parseInt(p.get('neon')      || '10');
        this.obstacleMode  = p.get('obstacles')          || 'none';   // none | static | dynamic
        this.obstacleCount = parseInt(p.get('obstCount') || '5');
        this.wallWrap      = p.get('wallwrap') === '1';               // wrap-around walls

        this.tileCount = Math.floor(this.canvas.width / this.gridSize);
        this.center    = Math.floor(this.tileCount / 2);

        // Runtime state
        this.snake     = [];
        this.food      = { x: 5, y: 5 };
        this.obstacles = [];
        this.dx = 0; this.dy = 0;
        this.nextDx = 0; this.nextDy = 0;
        this.score      = 0;
        this.bestScore  = parseInt(localStorage.getItem('snake-best') || '0');
        this.foodEaten  = 0;
        this.moves      = 0;
        this.gameLoop   = null;
        this.timerLoop  = null;
        this.elapsedSec = 0;
        this.isRunning  = false;
        this.speedLevel = 1;

        // Streak tracking (consecutive games without dying from obstacles)
        this.sessionStreak = parseInt(sessionStorage.getItem('snake-streak') || '0');

        this.setupControls();
        this._applySettingsFromURL();
    }

    // Sync UI toggles/selects to whatever URL params were passed in
    _applySettingsFromURL() {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        set('opt-speed',      this.gameSpeed);
        set('opt-grid',       this.gridSize);
        set('opt-neon',       this.neonIntensity);
        set('opt-obstacles',  this.obstacleMode);
        set('opt-obst-count', this.obstacleCount);
        const wallEl = document.getElementById('opt-wallwrap');
        if (wallEl) wallEl.checked = this.wallWrap;

        const neonDisp = document.getElementById('neon-display');
        if (neonDisp) neonDisp.textContent = this.neonIntensity;
    }

    readSettingsFromUI() {
        const g = id => document.getElementById(id);
        if (g('opt-speed'))      this.gameSpeed      = parseInt(g('opt-speed').value);
        if (g('opt-grid'))       { this.gridSize = parseInt(g('opt-grid').value); this.tileCount = this.canvas.width / this.gridSize; }
        if (g('opt-neon'))       this.neonIntensity  = parseInt(g('opt-neon').value);
        if (g('opt-obstacles'))  this.obstacleMode   = g('opt-obstacles').value;
        if (g('opt-obst-count')) this.obstacleCount  = parseInt(g('opt-obst-count').value);
        if (g('opt-wallwrap'))   this.wallWrap       = g('opt-wallwrap').checked;
    }

    // ─── Game Lifecycle ──────────────────────────────────────────────────

    init() {
        this.snake = [
            { x: this.center,     y: this.center },
            { x: this.center - 1, y: this.center },
            { x: this.center - 2, y: this.center }
        ];
        this.dx = 1; this.dy = 0;
        this.nextDx = 1; this.nextDy = 0;
        this.score     = 0;
        this.foodEaten = 0;
        this.moves     = 0;
        this.elapsedSec= 0;
        this.speedLevel= 1;
        this.updateStats();
        this.placeFood();
        this.generateObstacles();
        this.draw(); // Draw initial state immediately
    }

    startGame() {
        this.readSettingsFromUI();
        this.init();
        this.isRunning = true;
        this.overlay.classList.add('hidden');

        if (this.gameLoop)  clearInterval(this.gameLoop);
        if (this.timerLoop) clearInterval(this.timerLoop);

        this.gameLoop  = setInterval(() => this.gameStep(), this.gameSpeed);
        this.timerLoop = setInterval(() => { this.elapsedSec++; this.updateStats(); }, 1000);
    }

    gameOver(cause = 'wall') {
        this.isRunning = false;
        clearInterval(this.gameLoop);
        clearInterval(this.timerLoop);

        if (cause === 'obstacle') {
            this.sessionStreak = 0;
        } else {
            this.sessionStreak++;
        }
        sessionStorage.setItem('snake-streak', this.sessionStreak);

        // Smart Stats: Accumulate lifetime data
        const totalFood = parseInt(localStorage.getItem('snake-food-total') || '0') + this.foodEaten;
        const gamesPlayed = parseInt(localStorage.getItem('snake-games-played') || '0') + 1;
        localStorage.setItem('snake-food-total', totalFood);
        localStorage.setItem('snake-games-played', gamesPlayed);

        const time = this.formatTime(this.elapsedSec);
        this.messageEl.textContent   = 'Game Over';
        this.submessageEl.textContent = `Score ${this.score} · ${this.foodEaten} food · ${time}`;
        this.startBtn.textContent    = 'Try Again';
        this.overlay.classList.remove('hidden');
        this.updateStats();
        this.vibrate(40);
    }


    // ─── Core Loop ──────────────────────────────────────────────────────

    gameStep() {
        this.dx = this.nextDx;
        this.dy = this.nextDy;

        let head = { x: this.snake[0].x + this.dx, y: this.snake[0].y + this.dy };

        if (this.wallWrap) {
            head.x = (head.x + this.tileCount) % this.tileCount;
            head.y = (head.y + this.tileCount) % this.tileCount;
        } else {
            if (head.x < 0 || head.x >= this.tileCount || head.y < 0 || head.y >= this.tileCount) {
                this.gameOver('wall');
                return;
            }
        }

        if (this.snake.some(s => s.x === head.x && s.y === head.y)) {
            this.gameOver('self');
            return;
        }

        if (this.obstacles.some(o => o.x === head.x && o.y === head.y)) {
            this.gameOver('obstacle');
            return;
        }

        this.snake.unshift(head);
        this.moves++;

        if (head.x === this.food.x && head.y === this.food.y) {
            this.score += 10;
            this.foodEaten++;
            if (this.score > this.bestScore) {
                this.bestScore = this.score;
                localStorage.setItem('snake-best', this.bestScore);
            }
            // Speed up every 5 food eaten
            if (this.foodEaten % 5 === 0 && this.gameSpeed > 40) {
                this.speedLevel++;
                clearInterval(this.gameLoop);
                this.gameSpeed = Math.max(40, this.gameSpeed - 10);
                this.gameLoop = setInterval(() => this.gameStep(), this.gameSpeed);
            }
            this.vibrate(10);
            this.placeFood();

            if (this.obstacleMode === 'dynamic') this.generateObstacles();
        } else {
            this.snake.pop();
        }

        this.updateStats();
        this.draw();
    }

    // ─── Food & Obstacles ───────────────────────────────────────────────

    placeFood() {
        do {
            this.food = {
                x: Math.floor(Math.random() * this.tileCount),
                y: Math.floor(Math.random() * this.tileCount)
            };
        } while (
            this.snake.some(s => s.x === this.food.x && s.y === this.food.y) ||
            this.obstacles.some(o => o.x === this.food.x && o.y === this.food.y)
        );
    }

    generateObstacles() {
        if (this.obstacleMode === 'none') { this.obstacles = []; return; }

        const count = this.obstacleCount;
        const occupied = new Set(this.snake.map(s => `${s.x},${s.y}`));
        occupied.add(`${this.food.x},${this.food.y}`);

        this.obstacles = [];
        let attempts = 0;
        while (this.obstacles.length < count && attempts < 500) {
            attempts++;
            const x = Math.floor(Math.random() * this.tileCount);
            const y = Math.floor(Math.random() * this.tileCount);
            // Keep a safety zone around starting position (center)
            if (Math.abs(x - this.center) < 3 && Math.abs(y - this.center) < 3) continue;
            if (!occupied.has(`${x},${y}`)) {
                this.obstacles.push({ x, y });
                occupied.add(`${x},${y}`);
            }
        }
    }

    // ─── Drawing ────────────────────────────────────────────────────────

    draw() {
        const ctx  = this.ctx;
        const gs   = this.gridSize;
        const ni   = this.neonIntensity;

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.025)';
        ctx.lineWidth = 1;
        for (let i = 0; i < this.canvas.width; i += gs) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, this.canvas.height); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(this.canvas.width, i); ctx.stroke();
        }

        // Obstacles
        this.obstacles.forEach(o => {
            ctx.shadowBlur  = ni * 0.8;
            ctx.shadowColor = '#ff6b35';
            ctx.fillStyle   = '#ff6b35';
            const pad = 3;
            ctx.fillRect(o.x * gs + pad, o.y * gs + pad, gs - pad * 2, gs - pad * 2);
        });

        // Food
        ctx.shadowBlur  = ni * 1.5;
        ctx.shadowColor = '#ff3e3e';
        ctx.fillStyle   = '#ff3e3e';
        ctx.beginPath();
        ctx.arc(this.food.x * gs + gs / 2, this.food.y * gs + gs / 2, gs / 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Snake
        ctx.shadowBlur = ni;
        const snakeColor = '#00ff9d';
        ctx.shadowColor  = snakeColor;

        this.snake.forEach((seg, i) => {
            ctx.fillStyle = (i === 0) ? '#fff' : snakeColor;
            const pad = 2;
            ctx.fillRect(seg.x * gs + pad, seg.y * gs + pad, gs - pad * 2, gs - pad * 2);
        });

        ctx.shadowBlur = 0;
    }

    // ─── Stats ──────────────────────────────────────────────────────────

    updateStats() {
        if (this.scoreEl)    this.scoreEl.textContent    = this.score;
        if (this.bestEl)     this.bestEl.textContent     = this.bestScore;
        if (this.foodEatenEl)this.foodEatenEl.textContent= this.foodEaten;
        if (this.timeEl)     this.timeEl.textContent     = this.formatTime(this.elapsedSec);
        if (this.movesEl)    this.movesEl.textContent    = this.moves;
        if (this.speedLvlEl) this.speedLvlEl.textContent = this.speedLevel;
        if (this.streakEl)   this.streakEl.textContent   = this.sessionStreak;
    }

    formatTime(secs) {
        const m = Math.floor(secs / 60).toString().padStart(2, '0');
        const s = (secs % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    // ─── Controls ───────────────────────────────────────────────────────

    setupControls() {
        window.addEventListener('keydown', e => {
            switch (e.key) {
                case 'ArrowUp':    case 'w': case 'W': this.setDirection(0, -1);  break;
                case 'ArrowDown':  case 's': case 'S': this.setDirection(0,  1);  break;
                case 'ArrowLeft':  case 'a': case 'A': this.setDirection(-1, 0);  break;
                case 'ArrowRight': case 'd': case 'D': this.setDirection(1,  0);  break;
                case 'Enter': if (!this.isRunning) this.startGame(); break;
            }
        });

        this.startBtn.addEventListener('click', () => { if (!this.isRunning) this.startGame(); });

        const bind = (id, dx, dy) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('touchstart', e => { e.preventDefault(); this.setDirection(dx, dy); }, { passive: false });
            el.addEventListener('mousedown',  () => this.setDirection(dx, dy));
        };
        bind('ctrl-up',    0, -1);
        bind('ctrl-down',  0,  1);
        bind('ctrl-left',  -1, 0);
        bind('ctrl-right',  1, 0);
    }

    setDirection(newDx, newDy) {
        if (!this.isRunning) return;
        if (newDx !== 0 && this.dx === -newDx) return;
        if (newDy !== 0 && this.dy === -newDy) return;
        this.nextDx = newDx;
        this.nextDy = newDy;
    }
}

// ─── Boot ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const game = new SnakeGame('gameCanvas', {
        scoreEl:      document.getElementById('scoreVal'),
        bestEl:       document.getElementById('bestVal'),
        overlay:      document.getElementById('overlay'),
        messageEl:    document.getElementById('message'),
        submessageEl: document.getElementById('submessage'),
        startBtn:     document.getElementById('startButton'),
        // Extended stats
        foodEatenEl:  document.getElementById('statFood'),
        timeEl:       document.getElementById('statTime'),
        movesEl:      document.getElementById('statMoves'),
        speedLvlEl:   document.getElementById('statSpeed'),
        streakEl:     document.getElementById('statStreak'),
    });

    // Wire neon slider display
    const neonSlider = document.getElementById('opt-neon');
    if (neonSlider) {
        neonSlider.addEventListener('input', e => {
            const d = document.getElementById('neon-display');
            if (d) d.textContent = e.target.value;
            game.neonIntensity = parseInt(e.target.value);
        });
    }

    // Wire obstacle count display
    const obstSlider = document.getElementById('opt-obst-count');
    if (obstSlider) {
        obstSlider.addEventListener('input', e => {
            const d = document.getElementById('obst-count-display');
            if (d) d.textContent = e.target.value;
        });
    }

    // Auto-start if launched from library with ?autostart
    const p = new URLSearchParams(window.location.search);
    if (p.has('autostart')) game.startGame();
});