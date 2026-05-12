/*
  Neon Hoops - Realistic Net Physics v2
  Replace your existing basketball-game.js with this file.
  Build marker: realistic-net-v2
*/

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

function vibrate(ms) {
    if (navigator.vibrate) navigator.vibrate(ms);
}


console.info('[Neon Hoops] realistic-net-v2 loaded');
window.__NEON_HOOPS_BUILD = 'realistic-net-v2';

let width = 0;
let height = 0;
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
let lastFrameTime = performance.now();
const keys = {};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const hypot = (x, y) => Math.sqrt(x * x + y * y);

// Pixel/second physics. This keeps the shot stable on every monitor refresh rate.
const GRAVITY = 1500;
const AIR_DRAG_PER_SECOND = 0.993;
const SPIN_DRAG_PER_SECOND = 0.985;
const FLOOR_BOUNCE = 0.52;
const RIM_RESTITUTION = 0.68;
const BACKBOARD_RESTITUTION = 0.62;

const hoop = {
    x: 0,
    y: 0,
    baseX: 0,
    baseY: 0,
    radius: 48,
    boardWidth: 178,
    boardHeight: 112,
    boardInsetY: 88,
};

const ball = {
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    vx: 0,
    vy: 0,
    scale: 1,
    targetScale: 0.64,
    scaleVelocity: 0,
    radiusBase: 54,
    state: 'idle',
    rotation: 0,
    vRot: 0,
    isOnFire: false,
    isPerfect: false,
    scoredThisShot: false,
    rimHits: 0,
    releaseQuality: 0,
    shotAge: 0,
    spinEnglish: 0,
};

const net = {
    rows: 6,
    cols: 10,
    points: [],
    lastPunchAt: 0,
};

const particles = [];
const messages = [];

function getBallRadius() {
    return ball.radiusBase * ball.scale;
}

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * window.devicePixelRatio);
    canvas.height = Math.floor(height * window.devicePixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

    hoop.baseX = width / 2;
    hoop.baseY = height * 0.285;
    hoop.x = hoop.baseX;
    hoop.y = hoop.baseY;
    hoop.radius = clamp(width * 0.031, 42, 54);
    hoop.boardWidth = hoop.radius * 3.8;
    hoop.boardHeight = hoop.radius * 2.45;
    hoop.boardInsetY = hoop.boardHeight * 0.78;

    setupNet();
    if (ball.state === 'idle') {
        const oldX = ball.x;
        resetBall();
        // Restore horizontal position relative to width after resize
        ball.x = clamp(oldX, 60, width - 60);
    }
}
window.addEventListener('resize', resize);

function resetBall() {
    ball.x = width / 2;
    ball.y = height * 0.84;
    ball.prevX = ball.x;
    ball.prevY = ball.y;
    ball.vx = 0;
    ball.vy = 0;
    ball.scale = 1;
    ball.targetScale = 0.64;
    ball.scaleVelocity = 0;
    ball.state = 'idle';
    ball.rotation = 0;
    ball.vRot = 0;
    ball.isOnFire = false;
    ball.isPerfect = false;
    ball.scoredThisShot = false;
    ball.rimHits = 0;
    ball.releaseQuality = 0;
    ball.shotAge = 0;
    ball.spinEnglish = 0;
}

function showMessage(text, x, y, color = '#fff') {
    messages.push({ text, x, y, life: 1, color, vy: -66 });
}

function createParticles(x, y, color, amount = 24) {
    for (let i = 0; i < amount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 90 + Math.random() * 430;
        particles.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1,
            color,
            size: 2 + Math.random() * 4,
        });
    }
}

function netRestPosition(row, col) {
    const rowT = row / (net.rows - 1);
    const angle = (col / net.cols) * Math.PI * 2;
    const topRadiusX = hoop.radius * 0.97;
    const topRadiusY = hoop.radius * 0.40;
    const bottomRadiusX = hoop.radius * 0.48;
    const bottomRadiusY = hoop.radius * 0.23;
    const radiusX = lerp(topRadiusX, bottomRadiusX, rowT);
    const radiusY = lerp(topRadiusY, bottomRadiusY, rowT);
    const drop = 13 + rowT * hoop.radius * 1.85;

    return {
        x: hoop.x + Math.cos(angle) * radiusX,
        y: hoop.y + drop + Math.sin(angle) * radiusY,
    };
}

function setupNet() {
    const old = net.points;
    const next = [];

    for (let row = 0; row < net.rows; row++) {
        const rowPoints = [];
        for (let col = 0; col < net.cols; col++) {
            const rest = netRestPosition(row, col);
            const previous = old[row]?.[col];
            rowPoints.push({
                row,
                col,
                x: previous ? previous.x : rest.x,
                y: previous ? previous.y : rest.y,
                vx: previous ? previous.vx * 0.2 : 0,
                vy: previous ? previous.vy * 0.2 : 0,
                restX: rest.x,
                restY: rest.y,
                pinned: row === 0,
            });
        }
        next.push(rowPoints);
    }

    net.points = next;
}

function addSpring(a, b, restLength, stiffness, damping) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = hypot(dx, dy) || 0.0001;
    const nx = dx / len;
    const ny = dy / len;
    const stretch = len - restLength;
    const relVx = b.vx - a.vx;
    const relVy = b.vy - a.vy;
    const relSpeed = relVx * nx + relVy * ny;
    const force = stretch * stiffness + relSpeed * damping;

    if (!a.pinned) {
        a.vx += force * nx;
        a.vy += force * ny;
    }
    if (!b.pinned) {
        b.vx -= force * nx;
        b.vy -= force * ny;
    }
}

function punchNet(centerX, centerY, forceX = 0, forceY = 0, radius = 110, strength = 1) {
    net.lastPunchAt = performance.now();
    for (const row of net.points) {
        for (const p of row) {
            if (p.pinned) continue;
            const dx = p.x - centerX;
            const dy = p.y - centerY;
            const dist = hypot(dx, dy) || 0.001;
            if (dist > radius) continue;
            const influence = (1 - dist / radius) * strength;
            p.vx += (dx / dist) * 150 * influence + forceX * 0.18 * influence;
            p.vy += (dy / dist) * 150 * influence + forceY * 0.18 * influence;
        }
    }
}

function updateNet(dt) {
    if (!net.points.length) return;

    for (let col = 0; col < net.cols; col++) {
        const p = net.points[0][col];
        const rest = netRestPosition(0, col);
        p.restX = rest.x;
        p.restY = rest.y;
        p.x = rest.x;
        p.y = rest.y;
        p.vx = 0;
        p.vy = 0;
    }

    for (let row = 1; row < net.rows; row++) {
        for (let col = 0; col < net.cols; col++) {
            const p = net.points[row][col];
            const rest = netRestPosition(row, col);
            p.restX = rest.x;
            p.restY = rest.y;

            p.vx += (p.restX - p.x) * 8.5 * dt;
            p.vy += (p.restY - p.y) * 8.5 * dt;
            p.vy += 76 * dt;
        }
    }

    for (let row = 0; row < net.rows; row++) {
        for (let col = 0; col < net.cols; col++) {
            const p = net.points[row][col];
            const right = net.points[row][(col + 1) % net.cols];
            addSpring(p, right, hypot(p.restX - right.restX, p.restY - right.restY), 0.28, 0.12);

            if (row < net.rows - 1) {
                const down = net.points[row + 1][col];
                const diagRight = net.points[row + 1][(col + 1) % net.cols];
                const diagLeft = net.points[row + 1][(col + net.cols - 1) % net.cols];
                addSpring(p, down, hypot(p.restX - down.restX, p.restY - down.restY), 0.42, 0.14);
                addSpring(p, diagRight, hypot(p.restX - diagRight.restX, p.restY - diagRight.restY), 0.20, 0.08);
                addSpring(p, diagLeft, hypot(p.restX - diagLeft.restX, p.restY - diagLeft.restY), 0.18, 0.08);
            }
        }
    }

    // Ball/net contact. This makes the mesh visibly move while the ball passes through.
    if (ball.state === 'shooting' || ball.state === 'falling') {
        const radius = getBallRadius() * 0.85;
        // Only interact if moving downward (avoids hitting the net while rising)
        const inNetArea = ball.vy > 0 && Math.abs(ball.x - hoop.x) < hoop.radius * 1.7 && ball.y > hoop.y - 8 && ball.y < hoop.y + hoop.radius * 2.8;
        if (inNetArea) {
            for (const row of net.points) {
                for (const p of row) {
                    if (p.pinned) continue;
                    const dx = p.x - ball.x;
                    const dy = p.y - ball.y;
                    const dist = hypot(dx, dy) || 0.001;
                    const contactRange = radius + 18;
                    if (dist > contactRange) continue;
                    const influence = 1 - dist / contactRange;
                    p.vx += (dx / dist) * 190 * influence + ball.vx * 0.10 * influence;
                    p.vy += (dy / dist) * 190 * influence + ball.vy * 0.10 * influence;
                }
            }
        }
    }

    for (let row = 1; row < net.rows; row++) {
        for (let col = 0; col < net.cols; col++) {
            const p = net.points[row][col];
            p.vx *= Math.pow(0.955, dt * 60);
            p.vy *= Math.pow(0.955, dt * 60);
            p.x += p.vx * dt;
            p.y += p.vy * dt;
        }
    }
}

function scoreShot(isPerfectShot) {
    if (ball.scoredThisShot) return;
    ball.scoredThisShot = true;

    const clean = ball.rimHits === 0;
    // Tightened perfect threshold from 0.86 to 0.93
    const perfect = isPerfectShot || (clean && ball.releaseQuality > 0.93);
    
    // Rebalanced scoring: Perfect = 3, Average/Normal = 2
    const points = perfect ? 3 : 2;

    if (perfect) {
        showMessage('PERFECT!', hoop.x, hoop.y - 46, '#ff00ff');
        createParticles(hoop.x, hoop.y, '#ff00ff', 38);
        streak += 2;
    } else {
        streak += 1;
        createParticles(hoop.x, hoop.y, ball.isOnFire ? '#ff4400' : '#00ff9d', 28);
    }

    score += points;
    scoreEl.textContent = score;
    streakEl.textContent = streak;

    ball.state = 'falling';
    ball.vx *= 0.42;
    ball.vy = Math.max(ball.vy, 360);
    ball.isOnFire = false;
    ball.isPerfect = false;
    vibrate(perfect ? 45 : 25);
    punchNet(ball.x, hoop.y + hoop.radius * 0.65, ball.vx, Math.abs(ball.vy) + 260, hoop.radius * 2.25, perfect ? 1.35 : 1.0);


    if (gameMode === 'playoff' && score >= targetScore) nextLevel();
}

function resetStreak() {
    if (ball.state === 'shooting') {
        streak = 0;
        streakEl.textContent = streak;
    }
}

function hitBackboard() {
    const r = getBallRadius();
    const boardLeft = hoop.x - hoop.boardWidth / 2;
    const boardRight = hoop.x + hoop.boardWidth / 2;
    const boardTop = hoop.y - hoop.boardHeight;
    const boardBottom = hoop.y - 8;

    // Only collide when the ball is visually near the hoop depth.
    if (ball.scale > 0.78 || ball.scale < 0.52) return false;
    if (ball.y + r * 0.35 < boardTop || ball.y - r * 0.35 > boardBottom) return false;
    if (ball.x + r * 0.22 < boardLeft || ball.x - r * 0.22 > boardRight) return false;
    if (ball.prevY < boardBottom && ball.y >= boardBottom && ball.vy > 0) {
        ball.vy = -Math.abs(ball.vy) * BACKBOARD_RESTITUTION;
        ball.vx += (ball.x - hoop.x) * 0.8;
        ball.rimHits += 1;
        vibrate(12);
        punchNet(ball.x, hoop.y + 18, ball.vx, 110, hoop.radius * 1.55, 0.38);

        return true;
    }
    return false;
}

function hitRimAndScore() {
    if (ball.state !== 'shooting' || ball.scoredThisShot) return;
    if (ball.scale > 0.80 || ball.scale < 0.50) return;

    const dx = ball.x - hoop.x;
    const dy = ball.y - hoop.y;
    const rimRx = hoop.radius;
    const rimRy = hoop.radius * 0.41;
    const normalized = Math.sqrt((dx / rimRx) ** 2 + (dy / rimRy) ** 2);
    const crossedRimPlane = ball.prevY <= hoop.y - 4 && ball.y >= hoop.y - 7 && ball.vy > 0;
    const centerInsideOpening = Math.abs(dx) < hoop.radius * 0.58;

    if (crossedRimPlane && centerInsideOpening) {
        // Tightened physical perfect threshold from 0.17 to 0.11
        const perfect = Math.abs(dx) < hoop.radius * 0.11 && ball.rimHits === 0;
        scoreShot(perfect);
        return;
    }

    // Rim body collision: close to ellipse border but not inside the basket opening.
    const nearRim = normalized > 0.78 && normalized < 1.38 && Math.abs(dy) < hoop.radius * 0.64;
    if (!nearRim) return;

    const contactSpeed = hypot(ball.vx, ball.vy);
    if (contactSpeed < 120) return;

    ball.rimHits += 1;
    resetStreak();

    const nx = dx / (Math.abs(dx) || 1);
    ball.vx = ball.vx * 0.35 + nx * (180 + Math.abs(dx) * 6) + ball.spinEnglish * 90;
    ball.vy = -Math.abs(ball.vy) * RIM_RESTITUTION;
    ball.scaleVelocity += 0.08;
    ball.isOnFire = false;
    ball.isPerfect = false;
    vibrate(15);
    punchNet(ball.x, hoop.y + 12, ball.vx, 130, hoop.radius * 1.45, 0.42);

}

function updateBall(dt) {
    if (ball.state !== 'shooting' && ball.state !== 'falling') return;

    ball.prevX = ball.x;
    ball.prevY = ball.y;
    ball.shotAge += dt;

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.vy += GRAVITY * dt;

    const drag = Math.pow(AIR_DRAG_PER_SECOND, dt * 60);
    ball.vx *= drag;
    ball.vy *= drag;

    ball.scale += ball.scaleVelocity * dt;
    ball.scaleVelocity += (ball.targetScale - ball.scale) * 8.5 * dt;
    ball.scaleVelocity *= Math.pow(0.86, dt * 60);
    ball.scale = clamp(ball.scale, 0.50, 1.12);

    ball.rotation += ball.vRot * dt;
    ball.vRot *= Math.pow(SPIN_DRAG_PER_SECOND, dt * 60);

    if (ball.isOnFire && Math.random() > 0.35) {
        particles.push({
            x: ball.x + (Math.random() - 0.5) * getBallRadius() * 0.75,
            y: ball.y + (Math.random() - 0.5) * getBallRadius() * 0.75,
            vx: (Math.random() - 0.5) * 150,
            vy: -60 - Math.random() * 160,
            life: 0.75,
            color: Math.random() > 0.5 ? '#ff4400' : '#ffaa00',
            size: 2 + Math.random() * 4,
        });
    }

    hitBackboard();
    hitRimAndScore();

    // Ground bounce after misses/scores.
    const r = getBallRadius();
    const floorY = height + r * 0.1;
    if (ball.y + r > floorY) {
        ball.y = floorY - r;
        if (Math.abs(ball.vy) > 140) {
            ball.vy = -Math.abs(ball.vy) * FLOOR_BOUNCE;
            ball.vx *= 0.78;
        } else {
            resetBall();
        }
    }

    if (ball.x < -220 || ball.x > width + 220 || ball.y > height + 360 || ball.shotAge > 5.5) {
        if (!ball.scoredThisShot) resetStreak();
        resetBall();
    }
}

function updateIdle(dt) {
    if (ball.state !== 'idle') return;

    const moveSpeed = 450;
    if (keys['ArrowLeft'] || keys['a'] || keys['A']) {
        ball.x -= moveSpeed * dt;
    }
    if (keys['ArrowRight'] || keys['d'] || keys['D']) {
        ball.x += moveSpeed * dt;
    }

    const margin = getBallRadius() + 20;
    ball.x = clamp(ball.x, margin, width - margin);
    ball.prevX = ball.x; // Keep previous in sync for drag start
}

function updateHoop(dt) {
    if (!isPlaying || level < 2) {
        hoop.x = hoop.baseX;
        hoop.y = hoop.baseY;
        return;
    }

    const time = performance.now() / 1000;
    
    // Procedural movement that scales with level for "infinite" progression
    const speedScale = 1 + (level * 0.25);
    const ampScale   = 1 + (level * 0.15);

    // Horizontal oscillation (Always present)
    const horizFreq = 1.2 * speedScale;
    const horizAmp  = Math.min(60 * ampScale, width * 0.4);
    hoop.x = hoop.baseX + Math.sin(time * horizFreq) * horizAmp;

    // Vertical oscillation (Starts at level 3, increases)
    if (level >= 3) {
        const vertFreq = 0.8 * (speedScale * 0.8);
        const vertAmp  = Math.min(20 * (level - 2) * ampScale * 0.3, 120);
        hoop.y = hoop.baseY + Math.cos(time * vertFreq) * vertAmp;
    }

    // High-frequency jitter/complex path (Starts at level 5)
    if (level >= 5) {
        const jitterFreq = 2.4 + (level * 0.1);
        const jitterAmp  = Math.min(level * 2, 30);
        hoop.x += Math.sin(time * jitterFreq) * jitterAmp;
        hoop.y += Math.cos(time * jitterFreq * 1.5) * (jitterAmp * 0.5);
    }

    // Sync net anchors to moving hoop
    const spacing = (Math.PI * 2) / net.cols;
    for (let i = 0; i < net.cols; i++) {
        const node = net.points[i];
        if (!node) continue;
        const angle = i * spacing;
        node.x = hoop.x + Math.cos(angle) * hoop.radius;
        node.y = hoop.y + Math.sin(angle) * hoop.radius;
    }
}

function update(dt) {
    if (!isPlaying) {
        updateNet(dt);
        updateParticles(dt);
        updateMessages(dt);
        return;
    }

    updateIdle(dt);
    updateHoop(dt);
    updateBall(dt);
    updateNet(dt);
    updateParticles(dt);
    updateMessages(dt);
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 340 * dt;
        p.vx *= Math.pow(0.97, dt * 60);
        p.vy *= Math.pow(0.97, dt * 60);
        p.life -= dt * 1.55;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function updateMessages(dt) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        m.y += m.vy * dt;
        m.life -= dt * 1.25;
        if (m.life <= 0) messages.splice(i, 1);
    }
}

function draw() {
    ctx.clearRect(0, 0, width, height);
    drawCourtGrid();
    drawBackboard();

    drawNet('back');
    drawHoopRimBack();

    const ballBehindRim = ball.scale < 0.69 && ball.y < hoop.y + hoop.radius * 1.1;
    if (ballBehindRim) {
        drawBall();
        drawHoopRimFront();
        drawNet('front');
    } else {
        drawHoopRimFront();
        drawNet('front');
        drawBall();
    }

    drawParticles();
    drawMessages();
    drawDragGuide();
}

function drawCourtGrid() {
    const horizon = height * 0.05;
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let i = -width; i <= width * 2; i += 56) {
        ctx.moveTo(width / 2 + (i - width / 2) * 0.22, horizon);
        ctx.lineTo(width / 2 + (i - width / 2) * 2.3, height);
    }
    for (let y = horizon; y <= height; y += 42) {
        const t = (y - horizon) / (height - horizon);
        const adjusted = horizon + (height - horizon) * Math.pow(t, 1.32);
        ctx.moveTo(0, adjusted);
        ctx.lineTo(width, adjusted);
    }
    ctx.stroke();
    ctx.restore();
}

function drawBackboard() {
    const x = hoop.x - hoop.boardWidth / 2;
    const y = hoop.y - hoop.boardInsetY;

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.055)';
    ctx.strokeStyle = '#00d2ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00d2ff';
    ctx.shadowBlur = 12;
    ctx.fillRect(x, y, hoop.boardWidth, hoop.boardHeight);
    ctx.strokeRect(x, y, hoop.boardWidth, hoop.boardHeight);

    ctx.strokeStyle = 'rgba(0, 210, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(hoop.x - hoop.radius * 0.72, hoop.y - hoop.radius * 1.05, hoop.radius * 1.44, hoop.radius * 0.98);

    // Board support glow.
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.25)';
    ctx.beginPath();
    ctx.moveTo(hoop.x, hoop.y - hoop.boardInsetY);
    ctx.lineTo(hoop.x, hoop.y - hoop.boardInsetY - hoop.radius * 0.72);
    ctx.stroke();
    ctx.restore();
}

function drawHoopRimBack() {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 62, 62, 0.55)';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#ff3e3e';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.ellipse(hoop.x, hoop.y, hoop.radius, hoop.radius * 0.41, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function drawHoopRimFront() {
    ctx.save();
    ctx.strokeStyle = '#ff3e3e';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#ff3e3e';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.ellipse(hoop.x, hoop.y, hoop.radius, hoop.radius * 0.41, 0, 0, Math.PI);
    ctx.stroke();
    ctx.restore();
}

function drawNet(layer = 'front') {
    if (!net.points.length) return;

    const isFront = layer === 'front';
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255,255,255,0.55)';
    ctx.shadowBlur = isFront ? 6 : 3;
    ctx.strokeStyle = isFront ? 'rgba(255, 255, 255, 0.88)' : 'rgba(220, 242, 255, 0.42)';
    ctx.lineWidth = isFront ? 2.1 : 1.35;

    const drawSegment = (a, b, frontSegment) => {
        if (isFront !== frontSegment) return;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    };

    for (let row = 0; row < net.rows; row++) {
        for (let col = 0; col < net.cols; col++) {
            const p = net.points[row][col];
            const right = net.points[row][(col + 1) % net.cols];
            const isFrontRing = row > 0 || Math.sin((col / net.cols) * Math.PI * 2) > -0.1;
            drawSegment(p, right, isFrontRing);

            if (row < net.rows - 1) {
                const down = net.points[row + 1][col];
                const diagRight = net.points[row + 1][(col + 1) % net.cols];
                const diagLeft = net.points[row + 1][(col + net.cols - 1) % net.cols];
                const frontColumn = Math.sin((col / net.cols) * Math.PI * 2) >= -0.16 || row > net.rows * 0.43;
                drawSegment(p, down, frontColumn);
                if ((row + col) % 2 === 0) drawSegment(p, diagRight, frontColumn);
                else drawSegment(p, diagLeft, frontColumn);
            }
        }
    }

    // Extra visible bottom knots.
    if (isFront) {
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineWidth = 2.35;
        const bottom = net.points[net.rows - 1];
        for (let col = 0; col < net.cols; col += 2) {
            const a = bottom[col];
            const b = bottom[(col + 1) % net.cols];
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
    }

    ctx.restore();
}

function drawBall() {
    const radius = getBallRadius();
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.rotation);

    ctx.shadowColor = ball.isOnFire ? '#ff4400' : '#ff7700';
    ctx.shadowBlur = ball.isOnFire ? 42 : 22;
    const grad = ctx.createRadialGradient(-radius * 0.35, -radius * 0.42, radius * 0.08, 0, 0, radius);
    if (ball.isOnFire) {
        grad.addColorStop(0, '#fff2a0');
        grad.addColorStop(0.45, '#ffb000');
        grad.addColorStop(1, '#de3f00');
    } else {
        grad.addColorStop(0, '#ffbe1c');
        grad.addColorStop(0.62, '#f07800');
        grad.addColorStop(1, '#9c3300');
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(44, 16, 0, 0.92)';
    ctx.lineWidth = Math.max(2, radius * 0.075);
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.lineTo(0, radius);
    ctx.moveTo(-radius, 0);
    ctx.lineTo(radius, 0);
    ctx.stroke();

    ctx.lineWidth = Math.max(1.5, radius * 0.045);
    ctx.beginPath();
    ctx.arc(-radius * 0.60, 0, radius * 0.70, -Math.PI / 2, Math.PI / 2);
    ctx.arc(radius * 0.60, 0, radius * 0.70, Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();

    ctx.restore();
}

function drawParticles() {
    for (const p of particles) {
        ctx.save();
        ctx.globalAlpha = clamp(p.life, 0, 1);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function drawMessages() {
    for (const m of messages) {
        ctx.save();
        ctx.fillStyle = m.color;
        ctx.globalAlpha = clamp(m.life, 0, 1);
        ctx.font = `900 ${24 + (1 - m.life) * 18}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.shadowColor = m.color;
        ctx.shadowBlur = 15;
        ctx.fillText(m.text, m.x, m.y);
        ctx.restore();
    }
}

function drawDragGuide() {
    if (!isDragging || ball.state !== 'idle') return;

    const dx = dragStartX - mouseX;
    const dy = dragStartY - mouseY;
    const duration = (performance.now() - dragStartTime) / 1000;
    const idealDuration = 0.62;
    const timingMultiplier = clamp(1.0 - Math.abs(duration - idealDuration) * 1.6, 0.45, 1.0);
    
    const pull = clamp(hypot(dx, dy), 0, 520);
    const power = (pull / 520) * timingMultiplier;

    ctx.save();
    // Guide color shifts if the shot is getting "stale" or too fast
    const colorAlpha = 0.35 + power * 0.45;
    ctx.strokeStyle = timingMultiplier < 0.8 ? `rgba(255, 62, 62, ${colorAlpha})` : `rgba(255, 119, 0, ${colorAlpha})`;
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y);
    ctx.quadraticCurveTo(
        ball.x - dx * 0.25,
        ball.y - dy * 0.85 - 120 * power,
        ball.x - dx * 0.70,
        ball.y - dy * 1.55,
    );
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.font = '700 12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(power * 100)}%`, ball.x, ball.y - getBallRadius() - 14);
    ctx.restore();
}

function loop(now = performance.now()) {
    const dt = clamp((now - lastFrameTime) / 1000, 0, 1 / 30);
    lastFrameTime = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
}

function handleStart(x, y) {
    if (ball.state === 'idle') {
        isDragging = true;
        dragStartX = x;
        dragStartY = y;
        dragStartTime = performance.now();
        mouseX = x;
        mouseY = y;
    }
}

function handleMove(x, y) {
    if (!isDragging) return;
    mouseX = x;
    mouseY = y;
}

function releaseShot() {
    let dx = dragStartX - mouseX;
    let dy = dragStartY - mouseY;
    const duration = Math.max((performance.now() - dragStartTime) / 1000, 0.045);
    
    // Timing Sweet Spot: ~0.6 seconds. Before or after this, the shot gets weaker.
    const idealDuration = 0.62;
    const timingMultiplier = clamp(1.0 - Math.abs(duration - idealDuration) * 1.6, 0.45, 1.0);

    dx = clamp(dx, -260, 260);
    dy = clamp(dy, 0, 560);

    if (dy < 38) return;

    const pull = clamp(hypot(dx, dy), 50, 620);
    const power = clamp((pull / 520) * timingMultiplier, 0, 1.15);
    const flickSpeed = dy / duration;
    const idealSpeed = 1180;
    const speedQuality = 1 - clamp(Math.abs(flickSpeed - idealSpeed) / 1250, 0, 1);
    const timingQuality = timingMultiplier;
    const straightQuality = 1 - clamp(Math.abs(dx) / 250, 0, 1);

    ball.state = 'shooting';
    ball.scoredThisShot = false;
    ball.rimHits = 0;
    ball.shotAge = 0;
    ball.isPerfect = false;
    ball.isOnFire = false;
    vibrate(10);
    ball.releaseQuality = clamp(speedQuality * 0.4 + straightQuality * 0.3 + timingQuality * 0.3, 0, 1);


    // Flight time and target bias tuned to feel like a real set shot/flick.
    const flightTime = lerp(1.15, 1.65, power);
    const targetX = hoop.x - dx * (physicsMode === 'arcade' ? 0.22 : 0.45);
    const targetY = hoop.y - 8;

    // Small pro-mode release error. Arcade keeps it forgiving.
    const errorScale = physicsMode === 'arcade' ? 0.18 : 1;
    const releaseError = (1 - ball.releaseQuality) * 42 * errorScale;
    const randomError = (Math.random() - 0.5) * releaseError;

    const finalX = targetX + randomError;
    const finalY = targetY + (Math.random() - 0.5) * releaseError * 0.35;

    ball.prevX = ball.x;
    ball.prevY = ball.y;
    ball.vx = (finalX - ball.x) / flightTime;
    ball.vy = (finalY - ball.y - 0.5 * GRAVITY * flightTime * flightTime) / flightTime;
    ball.targetScale = lerp(0.70, 0.58, power);
    ball.scaleVelocity = (ball.targetScale - ball.scale) / flightTime;
    ball.spinEnglish = clamp(-dx / 260, -1, 1);
    ball.vRot = -ball.vx * 0.032 + dy * 0.010;

    if (physicsMode === 'arcade' && ball.releaseQuality > 0.72 && Math.abs(dx) < 80) {
        ball.isPerfect = true;
        ball.isOnFire = true;
    }
}

function handleEnd() {
    if (!isDragging || ball.state !== 'idle') return;
    isDragging = false;
    releaseShot();
}

window.addEventListener('mousedown', (e) => handleStart(e.clientX, e.clientY));
window.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
window.addEventListener('mouseup', handleEnd);
window.addEventListener('mouseleave', handleEnd);

window.addEventListener('keydown', (e) => {
    keys[e.key] = true;
});

window.addEventListener('keyup', (e) => {
    keys[e.key] = false;
});

window.addEventListener('touchstart', (e) => {
    if (!e.touches.length) return;
    e.preventDefault();
    handleStart(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

window.addEventListener('touchmove', (e) => {
    if (!e.touches.length) return;
    e.preventDefault();
    handleMove(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

window.addEventListener('touchend', (e) => {
    e.preventDefault();
    handleEnd();
}, { passive: false });

function startGame(mode) {
    gameMode = mode;
    overlay.style.opacity = '0';
    score = 0;
    streak = 0;
    level = 1;
    scoreEl.textContent = '0';
    streakEl.textContent = '0';

    if (timerInterval) clearInterval(timerInterval);

    if (mode === 'timer') {
        timeLeft = 60;
        timerBox.style.display = 'block';
        levelBox.style.display = 'none';
        startCountdown();
    } else if (mode === 'playoff') {
        timeLeft = 30;
        targetScore = 5;
        timerBox.style.display = 'block';
        levelBox.style.display = 'block';
        levelValEl.textContent = '1';
        startCountdown();
    } else {
        timerBox.style.display = 'none';
        levelBox.style.display = 'none';
    }

    setTimeout(() => {
        overlay.style.display = 'none';
        isPlaying = true;
        resize();
        resetBall();
        punchNet(hoop.x, hoop.y + hoop.radius, 0, 220, hoop.radius * 2.2, 0.45);
    }, 300);
}

function setPhysics(mode) {
    physicsMode = mode === 'arcade' ? 'arcade' : 'pro';
    const arcadeBtn = document.getElementById('physics-arcade');
    const proBtn = document.getElementById('physics-pro');
    if (arcadeBtn) arcadeBtn.style.opacity = physicsMode === 'arcade' ? '1' : '0.5';
    if (proBtn) proBtn.style.opacity = physicsMode === 'pro' ? '1' : '0.5';
}

// Ensure functions are global for HTML button onclick handlers
window.startGame = startGame;
window.setPhysics = setPhysics;

function startCountdown() {
    if (timerInterval) clearInterval(timerInterval);
    timerValEl.textContent = timeLeft;
    timerInterval = setInterval(() => {
        if (!isPlaying) return;
        timeLeft -= 1;
        timerValEl.textContent = timeLeft;
        if (timeLeft <= 0) gameOver();
    }, 1000);
}

function nextLevel() {
    level += 1;
    levelValEl.textContent = level;
    targetScore = 5 + level * 5;
    timeLeft += 15;
    createParticles(width / 2, height / 2, '#00ff9d', 48);
    punchNet(hoop.x, hoop.y + hoop.radius, 0, 320, hoop.radius * 2.4, 0.8);
}

function gameOver() {
    isPlaying = false;
    clearInterval(timerInterval);
    if (score > bestScores[gameMode]) {
        bestScores[gameMode] = score;
        localStorage.setItem('hoops-bests', JSON.stringify(bestScores));
    }
    menuTitle.textContent = 'GAME OVER';
    menuSub.textContent = `Mode: ${gameMode.toUpperCase()} | Score: ${score} | Best: ${bestScores[gameMode]}`;
    overlay.style.display = 'flex';
    setTimeout(() => overlay.style.opacity = '1', 10);
}

document.addEventListener('DOMContentLoaded', () => {
    console.info('[Neon Hoops] DOM ready, initializing...');
    resize();
    setPhysics(physicsMode);
    loop();

    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    const physics = params.get('physics');
    if (physics) setPhysics(physics);
    if (mode) startGame(mode);
});
