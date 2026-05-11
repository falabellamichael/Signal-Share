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

function scoreShot(isPerfectShot, isBankShot = false) {
    let points = isPerfectShot ? 10 : (ball.isOnFire ? 3 : (1 + Math.floor(streak / 2)));
    
    if (isPerfectShot) {
        showMessage("PERFECT!", hoop.x, hoop.y - 40, "#ff00ff");
        createParticles(hoop.x, hoop.y, "#ff00ff");
        streak += 2;
    } else if (isBankShot) {
        showMessage("BANK SHOT!", hoop.x, hoop.y - 40, "#00d2ff");
        createParticles(hoop.x, hoop.y, "#00d2ff");
        streak++;
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
    if (ball.state === 'shooting') streak = 0;
    streakEl.textContent = streak;
}

function update() {
    if (!isPlaying) return;

    if (ball.state === 'shooting' || ball.state === 'falling') {
        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.z += ball.vz;
        ball.vy += 1.0; // gravity (slower for more natural arc)
        ball.rotation += ball.vRot;

        if (ball.isOnFire && Math.random() > 0.3) {
            particles.push({
                x: ball.x + (Math.random() - 0.5) * ball.radiusBase * 0.5,
                y: ball.y + (Math.random() - 0.5) * ball.radiusBase * 0.5,
                vx: (Math.random() - 0.5) * 5, vy: -Math.random() * 5 - 2,
                life: 0.8, color: Math.random() > 0.5 ? '#ff4400' : '#ffaa00'
            });
        }

        if (ball.y > height + ball.radiusBase * 2 && ball.vy > 0) {
            resetStreak();
            resetBall();
        }

        // Magnetic Hoop Effect
        if (ball.state === 'shooting' && ball.z <= 0.4 && ball.z >= 0.25) {
            let dx = ball.x - hoop.x;
            let pullStrength = (physicsMode === 'arcade' ? 0.1 : 0.03);
            ball.vx -= dx * pullStrength;
        }

        // Depth Collision Logic
        if (ball.state === 'shooting' && ball.z <= 0.35) {
            ball.vz = 0;
            
            let dx = ball.x - hoop.x;
            let dy = ball.y - hoop.y;
            let dist = Math.sqrt(dx * dx + dy * dy);
            
            // Hoop & Board Metrics
            let boardTop = hoop.y - hoop.boardHeight;
            let boardBottom = hoop.y;
            let boardLeft = hoop.x - hoop.boardWidth / 2;
            let boardRight = hoop.x + hoop.boardWidth / 2;

            let isSwish = dist < hoop.radius * 1.2; // tighter swish window
            let hitRim = dist >= hoop.radius * 1.2 && dist < hoop.radius * 2.5;
            let hitBackboard = ball.x > boardLeft && ball.x < boardRight && ball.y > boardTop && ball.y < boardBottom;

            if (ball.isPerfect || isSwish) {
                scoreShot(ball.isPerfect);
            } else if (hitRim) {
                if (physicsMode === 'arcade' && Math.random() > 0.5) {
                    // Forgiving Rim Bounce (Rolls in)
                    scoreShot(false);
                } else {
                    // Bounce Out
                    ball.state = 'falling';
                    ball.vy = -ball.vy * 0.4;
                    ball.vx = (Math.random() - 0.5) * 8;
                    ball.vz = 0.05;
                    resetStreak();
                }
            } else if (hitBackboard) {
                if (physicsMode === 'arcade' && Math.abs(dx) < hoop.radius * 1.5 && dy < 0) {
                    // Bank Shot
                    scoreShot(false, true);
                } else {
                    // Brick
                    ball.state = 'falling';
                    ball.vy = -ball.vy * 0.5;
                    ball.vx = -ball.vx * 0.6 + (Math.random() - 0.5) * 3;
                    ball.vz = 0.05;
                    ball.z = 0.36; 
                    resetStreak();
                }
            } else {
                // Airball
                ball.state = 'falling';
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
    
    // Draw Background Grid
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

    // Draw Backboard
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.strokeStyle = '#00d2ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00d2ff'; ctx.shadowBlur = 10;
    ctx.fillRect(hoop.x - hoop.boardWidth / 2, hoop.y - hoop.boardHeight, hoop.boardWidth, hoop.boardHeight);
    ctx.strokeRect(hoop.x - hoop.boardWidth / 2, hoop.y - hoop.boardHeight, hoop.boardWidth, hoop.boardHeight);
    ctx.strokeRect(hoop.x - 30, hoop.y - 45, 60, 45);
    ctx.shadowBlur = 0;

    let currentRadius = Math.max(ball.radiusBase * 0.3, ball.radiusBase * (0.3 + 0.7 * ball.z));
    if (ball.z < 0.35) {
        drawBall(currentRadius); drawHoopRimBack();
    } else {
        drawHoopRimBack(); drawBall(currentRadius);
    }
    drawHoopRimFront();

    // Draw Particles
    particles.forEach(p => {
        ctx.fillStyle = p.color; ctx.globalAlpha = p.life;
        ctx.beginPath(); ctx.arc(p.x, p.y, 4 * p.life, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
    });

    // Draw Messages
    messages.forEach(m => {
        ctx.fillStyle = m.color;
        ctx.globalAlpha = m.life;
        ctx.font = `bold ${24 + (1 - m.life) * 20}px Inter`;
        ctx.textAlign = 'center';
        ctx.shadowColor = m.color;
        ctx.shadowBlur = 15;
        ctx.fillText(m.text, m.x, m.y);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
    });

    // Draw Aim Line
    if (isDragging && ball.state === 'idle') {
        ctx.strokeStyle = 'rgba(255, 119, 0, 0.5)';
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
    
    // Draw Net
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); 
    ctx.moveTo(hoop.x - hoop.radius, hoop.y);
    ctx.lineTo(hoop.x - hoop.radius / 2, hoop.y + 45); 
    ctx.lineTo(hoop.x + hoop.radius / 2, hoop.y + 45);
    ctx.lineTo(hoop.x + hoop.radius, hoop.y);
    for (let i = -hoop.radius; i <= hoop.radius; i += 15) {
        ctx.moveTo(hoop.x + i, hoop.y); ctx.lineTo(hoop.x + i * 0.5, hoop.y + 45);
    }
    ctx.stroke();
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
    
    // Ball Lines
    ctx.strokeStyle = '#331100'; ctx.lineWidth = Math.max(1, 4 * ball.z);
    ctx.beginPath(); 
    ctx.moveTo(0, -radius); ctx.lineTo(0, radius); 
    ctx.moveTo(-radius, 0); ctx.lineTo(radius, 0);
    ctx.moveTo(-radius, 0); ctx.quadraticCurveTo(-radius / 2, -radius / 2, 0, -radius);
    ctx.moveTo(radius, 0); ctx.quadraticCurveTo(radius / 2, radius / 2, 0, radius);
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
        let dx = dragStartX - mouseX; // positive means swipe left
        let dy = dragStartY - mouseY; // positive means swipe up
        
        if (dy > 20) {
            ball.state = 'shooting';
            let dragDuration = Math.max((Date.now() - dragStartTime) / 1000, 0.02);
            
            // Physics Mechanics: 
            // - Swipe Distance (dy) controls base power
            // - Swipe Speed (dy/duration) scales the power 
            let swipeSpeed = dy / dragDuration;
            
            // Normalize relative to screen height
            let screenFactor = dy / (height * 0.4); 
            let speedFactor = Math.min(Math.max(swipeSpeed / 1000, 0.5), 2.5);
            
            // Combined Power
            let power = screenFactor * speedFactor * 1.5;
            
            // "Perfect" shot window
            let isPerfectRelease = Math.abs(power - 1.0) < 0.12 && Math.abs(dx) < 30;

            if (isPerfectRelease) {
                power = 1.0;
                ball.isPerfect = true;
                ball.isOnFire = true;
            } else if (power > 0.88 && power < 1.12) {
                // Soft assist for close shots
                power = (power + 1.0) / 2;
            }

            // Map power to Target Z depth
            let targetZ = 1.0 - (0.65 * power);
            targetZ = Math.max(0.05, Math.min(0.95, targetZ));

            // Map horizontal direction
            let targetX = hoop.x - (dx * 1.8);
            if (physicsMode === 'arcade') {
                // Aim assist
                let correction = ball.isPerfect ? 1.0 : 0.4;
                targetX += (hoop.x - targetX) * correction;
            }

            // Flight Time depends on the visual arc we want. Slower for more human feel.
            let t = 1.4 + dragDuration * 0.5;
            t = Math.max(1.2, Math.min(2.2, t));

            let gravity = 1.0; // matching update gravity
            let targetY = hoop.y;

            // Apply Projectile Motion
            ball.vx = (targetX - ball.x) / t;
            ball.vy = (targetY - ball.y - 0.5 * gravity * t * t) / t;
            ball.vz = (targetZ - 1.0) / t;
            ball.vRot = dx * 0.05;

            if (!ball.isPerfect && Math.abs(dx) > 100) {
                ball.isOnFire = true; // Fun visual for crazy wide shots
            }
        }
    }
}

// Event Listeners
window.addEventListener('mousedown', (e) => handleStart(e.clientX, e.clientY));
window.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
window.addEventListener('mouseup', handleEnd);
window.addEventListener('touchstart', (e) => handleStart(e.touches[0].clientX, e.touches[0].clientY), { passive: false });
window.addEventListener('touchmove', (e) => { e.preventDefault(); handleMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
window.addEventListener('touchend', handleEnd);

// Game State Management
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

// Initialize
resize(); 
loop();

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode'), physics = params.get('physics');
    if (physics) setPhysics(physics);
    if (mode) startGame(mode);
});
