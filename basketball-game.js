const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const scoreEl = document.getElementById('score');
const streakEl = document.getElementById('streak');
const timerValEl = document.getElementById('timer-val');
const levelValEl = document.getElementById('level-val');
const timerBox = document.getElementById('timer-box');
const levelBox = document.getElementById('level-box');
const menuTitle = document.getElementById('menu-title');
const menuSub = document.getElementById('menu-sub');

let width, height;
let score = 0;
let streak = 0;
let isPlaying = false;
let gameMode = 'classic';
let physicsMode = 'pro';
let timeLeft = 0;
let level = 1;
let targetScore = 0;
let timerInterval = null;
let bestScores = JSON.parse(localStorage.getItem('hoops-bests') || '{"classic":0,"timer":0,"playoff":0}');

let mouseX = 0;
let mouseY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartTime = 0;

// NEW DYNAMIC PHYSICS CONSTANTS
const GRAVITY = 1.0; 
const HOOP_Z = 0.35;

const hoop = {
    x: 0, y: 0,
    radius: 45,
    boardWidth: 160,
    boardHeight: 100
};

const ball = {
    x: 0, y: 0, z: 1,
    vx: 0, vy: 0, vz: 0,
    radiusBase: 70,
    state: 'idle',
    rotation: 0, vRot: 0,
    isOnFire: false,
    isPerfect: false
};

const particles = [];
const messages = [];

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    hoop.x = width / 2;
    hoop.y = height * 0.3;
    if (ball.state === 'idle') resetBall();
}
window.addEventListener('resize', resize);

function resetBall() {
    ball.x = width / 2;
    ball.y = height * 0.85;
    ball.z = 1;
    ball.vx = 0; ball.vy = 0; ball.vz = 0;
    ball.state = 'idle';
    ball.rotation = 0; ball.vRot = 0;
    ball.isOnFire = false;
    ball.isPerfect = false;
}

function showMessage(text, x, y, color = '#fff') {
    messages.push({ text, x, y, life: 1.0, color, vy: -2 });
}

function createParticles(x, y, color) {
    for (let i = 0; i < 30; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 12,
            vy: (Math.random() - 0.5) * 12,
            life: 1, color
        });
    }
}

function scoreShot(isPerfectShot) {
    let points = isPerfectShot ? 10 : (ball.isOnFire ? 3 : (1 + Math.floor(streak / 2)));
    
    if (isPerfectShot) {
        showMessage("PERFECT!", hoop.x, hoop.y - 40, "#ff00ff");
        createParticles(hoop.x, hoop.y, "#ff00ff");
        streak += 2;
    } else {
        streak++;
        createParticles(hoop.x, hoop.y, ball.isOnFire ? '#ff4400' : '#00ff9d');
    }

    score += points;
    scoreEl.textContent = score;
    streakEl.textContent = streak;
    
    ball.state = 'falling';
    ball.vx *= 0.5; ball.vy = 2;
    ball.isOnFire = false;
    ball.isPerfect = false;
    
    if (gameMode === 'playoff' && score >= targetScore) nextLevel();
}

function resetStreak() {
    if (ball.state === 'shooting') {
        streak = 0;
        streakEl.textContent = streak;
    }
}

function update() {
    if (!isPlaying) return;

    if (ball.state === 'shooting' || ball.state === 'falling') {
        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.z += ball.vz;
        ball.vy += GRAVITY;
        ball.rotation += ball.vRot;

        if (ball.isOnFire && Math.random() > 0.3) {
            particles.push({
                x: ball.x + (Math.random() - 0.5) * ball.radiusBase * ball.z * 0.5,
                y: ball.y + (Math.random() - 0.5) * ball.radiusBase * ball.z * 0.5,
                vx: (Math.random() - 0.5) * 5, vy: -Math.random() * 5 - 2,
                life: 0.8, color: Math.random() > 0.5 ? '#ff4400' : '#ffaa00'
            });
        }

        // KEEP BALL IN VIEW: Prevent it from flying too far horizontally
        if (ball.x < -100 || ball.x > width + 100) {
            resetBall();
            resetStreak();
        }

        if (ball.y > height + 200) {
            resetStreak();
            resetBall();
        }

        // DEPTH COLLISION
        if (ball.state === 'shooting' && ball.z <= HOOP_Z) {
            let dx = ball.x - hoop.x;
            let dy = ball.y - hoop.y;
            let dist = Math.sqrt(dx * dx + dy * dy);
            
            let swishRadius = physicsMode === 'arcade' ? hoop.radius * 1.5 : hoop.radius * 0.8;

            if (dist < swishRadius) {
                scoreShot(ball.isPerfect || dist < 12);
            } else {
                // BOUNCE OFF RIM/BACKBOARD
                ball.state = 'falling';
                ball.vz = 0.04; // Bounce forward
                ball.vy = -ball.vy * 0.4; // Bounce up
                ball.vx = dx * 0.1 + (Math.random() - 0.5) * 4;
                resetStreak();
            }
        }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx; p.y += p.vy; p.life -= 0.03;
        if (p.life <= 0) particles.splice(i, 1);
    }

    for (let i = messages.length - 1; i >= 0; i--) {
        let m = messages[i];
        m.y += m.vy; m.life -= 0.02;
        if (m.life <= 0) messages.splice(i, 1);
    }
}

function draw() {
    ctx.clearRect(0, 0, width, height);
    
    // Background Grid
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < width; i += 40) {
        ctx.moveTo(i, 0); ctx.lineTo(width / 2 + (i - width / 2) * 2, height);
    }
    for (let i = 0; i < height; i += 40) {
        ctx.moveTo(0, i); ctx.lineTo(width, i + (height - i) * 0.2);
    }
    ctx.stroke();

    // Backboard
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.strokeStyle = '#00d2ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00d2ff'; ctx.shadowBlur = 10;
    ctx.fillRect(hoop.x - hoop.boardWidth / 2, hoop.y - hoop.boardHeight, hoop.boardWidth, hoop.boardHeight);
    ctx.strokeRect(hoop.x - hoop.boardWidth / 2, hoop.y - hoop.boardHeight, hoop.boardWidth, hoop.boardHeight);
    ctx.strokeRect(hoop.x - 30, hoop.y - 45, 60, 45);
    ctx.shadowBlur = 0;

    let ballScale = Math.max(0.1, ball.z);
    let currentRadius = ball.radiusBase * ballScale;

    if (ball.z < HOOP_Z) {
        drawBall(currentRadius); drawHoopRimBack(); drawHoopRimFront();
    } else {
        drawHoopRimBack(); drawBall(currentRadius); drawHoopRimFront();
    }

    particles.forEach(p => {
        ctx.fillStyle = p.color; ctx.globalAlpha = p.life;
        ctx.beginPath(); ctx.arc(p.x, p.y, 4 * p.life, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
    });

    messages.forEach(m => {
        ctx.fillStyle = m.color;
        ctx.globalAlpha = m.life;
        ctx.font = `bold ${24 + (1 - m.life) * 20}px Inter`;
        ctx.textAlign = 'center';
        ctx.shadowColor = m.color; ctx.shadowBlur = 15;
        ctx.fillText(m.text, m.x, m.y);
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    });

    if (isDragging && ball.state === 'idle') {
        ctx.strokeStyle = 'rgba(255, 119, 0, 0.4)';
        ctx.lineWidth = 4; ctx.setLineDash([10, 10]);
        ctx.beginPath(); ctx.moveTo(ball.x, ball.y);
        let dx = dragStartX - mouseX; let dy = dragStartY - mouseY;
        ctx.lineTo(ball.x - dx, ball.y - dy); ctx.stroke();
        ctx.setLineDash([]);
    }
}

function drawHoopRimBack() {
    ctx.strokeStyle = 'rgba(255, 50, 0, 0.5)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(hoop.x, hoop.y, hoop.radius, hoop.radius / 2.5, 0, Math.PI, Math.PI * 2); ctx.stroke();
}

function drawHoopRimFront() {
    ctx.strokeStyle = '#ff3e3e'; ctx.lineWidth = 6;
    ctx.shadowColor = '#ff3e3e'; ctx.shadowBlur = 15;
    ctx.beginPath(); ctx.ellipse(hoop.x, hoop.y, hoop.radius, hoop.radius / 2.5, 0, 0, Math.PI); ctx.stroke();
    ctx.shadowBlur = 0;
}

function drawBall(radius) {
    ctx.save(); ctx.translate(ball.x, ball.y); ctx.rotate(ball.rotation);
    ctx.shadowColor = ball.isOnFire ? '#ff4400' : '#ff7700';
    ctx.shadowBlur = (ball.isOnFire ? 40 : 20) * ball.z;
    let grad = ctx.createRadialGradient(-radius / 3, -radius / 3, radius / 10, 0, 0, radius);
    if (ball.isOnFire) {
        grad.addColorStop(0, '#fff'); grad.addColorStop(0.5, '#ffcc00'); grad.addColorStop(1, '#ff4400');
    } else {
        grad.addColorStop(0, '#ffaa00'); grad.addColorStop(1, '#cc4400');
    }
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; 
    ctx.strokeStyle = '#331100'; ctx.lineWidth = Math.max(1, 4 * ball.z);
    ctx.beginPath(); 
    ctx.moveTo(0, -radius); ctx.lineTo(0, radius); 
    ctx.stroke(); ctx.restore();
}

function loop() { update(); draw(); requestAnimationFrame(loop); }

function handleStart(x, y) {
    if (ball.state === 'idle') {
        isDragging = true; dragStartX = x; dragStartY = y; dragStartTime = Date.now();
        mouseX = x; mouseY = y;
    }
}

function handleMove(x, y) { if (isDragging) { mouseX = x; mouseY = y; } }

function handleEnd() {
    if (isDragging && ball.state === 'idle') {
        isDragging = false;
        let dx = dragStartX - mouseX;
        let dy = dragStartY - mouseY;
        
        if (dy > 30) {
            ball.state = 'shooting';
            let duration = Math.max((Date.now() - dragStartTime) / 1000, 0.05);
            
            // DYNAMIC PHYSICS ENGINE
            
            // 1. DYNAMIC POWER (Distance)
            // Based on how many pixels the mouse went
            let powerFactor = dy / (height * 0.45);
            
            // 2. DYNAMIC SPEED (Time)
            // Based on flick velocity
            let flickSpeed = dy / duration; 
            let t = 2.0 / (flickSpeed / 1000 + 0.4); 
            t = Math.max(0.6, Math.min(2.8, t)); // Clamped between fast and slow shots
            
            // 3. DYNAMIC ACCURACY (Centering)
            let targetX = hoop.x - (dx * 1.8);
            let targetZ = 1.0 - (0.75 * powerFactor);

            // Assist window (Tightened)
            if (Math.abs(targetZ - HOOP_Z) < 0.12 && Math.abs(targetX - hoop.x) < 45) {
                if (physicsMode === 'arcade') {
                    targetZ = HOOP_Z;
                    targetX = hoop.x;
                    ball.isPerfect = true;
                    ball.isOnFire = true;
                }
            }

            // Projectile Equations based on DYNAMIC T
            ball.vx = (targetX - ball.x) / t;
            ball.vz = (targetZ - 1.0) / t;
            ball.vy = (hoop.y - ball.y - 0.5 * GRAVITY * t * t) / t;
            
            ball.vRot = dx * 0.05;
        }
    }
}

window.addEventListener('mousedown', (e) => handleStart(e.clientX, e.clientY));
window.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
window.addEventListener('mouseup', handleEnd);
window.addEventListener('touchstart', (e) => handleStart(e.touches[0].clientX, e.touches[0].clientY), { passive: false });
window.addEventListener('touchmove', (e) => { e.preventDefault(); handleMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
window.addEventListener('touchend', handleEnd);

function startGame(mode) {
    gameMode = mode; overlay.style.opacity = '0';
    score = 0; streak = 0; level = 1;
    scoreEl.textContent = '0'; streakEl.textContent = '0';
    if (mode === 'timer') {
        timeLeft = 60; timerBox.style.display = 'block'; levelBox.style.display = 'none'; startCountdown();
    } else if (mode === 'playoff') {
        timeLeft = 30; targetScore = 5; timerBox.style.display = 'block'; levelBox.style.display = 'block'; levelValEl.textContent = '1'; startCountdown();
    } else {
        timerBox.style.display = 'none'; levelBox.style.display = 'none';
    }
    setTimeout(() => { overlay.style.display = 'none'; isPlaying = true; resize(); resetBall(); }, 300);
}

function setPhysics(mode) {
    physicsMode = mode;
    document.getElementById('physics-arcade').style.opacity = mode === 'arcade' ? '1' : '0.5';
    document.getElementById('physics-pro').style.opacity = mode === 'pro' ? '1' : '0.5';
}

function startCountdown() {
    if (timerInterval) clearInterval(timerInterval);
    timerValEl.textContent = timeLeft;
    timerInterval = setInterval(() => {
        if (!isPlaying) return;
        timeLeft--; timerValEl.textContent = timeLeft;
        if (timeLeft <= 0) gameOver();
    }, 1000);
}

function nextLevel() {
    level++; levelValEl.textContent = level; targetScore = 5 + (level * 5); timeLeft += 15;
    createParticles(width / 2, height / 2, '#00ff9d');
}

function gameOver() {
    isPlaying = false; clearInterval(timerInterval);
    if (score > bestScores[gameMode]) {
        bestScores[gameMode] = score; localStorage.setItem('hoops-bests', JSON.stringify(bestScores));
    }
    menuTitle.textContent = "GAME OVER";
    menuSub.textContent = `Mode: ${gameMode.toUpperCase()} | Score: ${score} | Best: ${bestScores[gameMode]}`;
    overlay.style.display = 'flex'; setTimeout(() => overlay.style.opacity = '1', 10);
}

resize(); loop();
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode'), physics = params.get('physics');
    if (physics) setPhysics(physics);
    if (mode) startGame(mode);
});
