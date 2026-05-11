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
let lastFrameTime = performance.now();

// REALISTIC, TIME-BASED PHYSICS
// These values are pixels/second based so the shot feels consistent on every screen refresh rate.
const GRAVITY = 1450;
const AIR_DRAG = 0.992;
const SPIN_DRAG = 0.986;
const HOOP_Z = 0.36;
const RIM_THICKNESS = 7;
const BACKBOARD_RESTITUTION = 0.58;
const RIM_RESTITUTION = 0.42;
const GROUND_FRICTION = 0.72;
const MAX_DT = 1 / 30;

const hoop = {
    x: 0, y: 0,
    radius: 45,
    boardWidth: 160,
    boardHeight: 100,
    rimDepth: 20,
};

const ball = {
    x: 0, y: 0, z: 1,
    prevX: 0, prevY: 0, prevZ: 1,
    vx: 0, vy: 0, vz: 0,
    radiusBase: 70,
    state: 'idle',
    rotation: 0, vRot: 0,
    isOnFire: false,
    isPerfect: false,
    scoredThisShot: false,
    rimHits: 0,
    spinEnglish: 0,
    releaseQuality: 0,
};

const net = {
    cols: 14,
    rows: 7,
    points: [],
    lastPunchAt: 0,
};

const particles = [];
const messages = [];

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function distance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
}

function currentBallRadius() {
    return ball.radiusBase * Math.max(0.1, ball.z);
}

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    hoop.x = width / 2;
    hoop.y = height * 0.3;
    setupNet();
    if (ball.state === 'idle') resetBall();
}
window.addEventListener('resize', resize);

function resetBall() {
    ball.x = width / 2;
    ball.y = height * 0.85;
    ball.z = 1;
    ball.prevX = ball.x;
    ball.prevY = ball.y;
    ball.prevZ = ball.z;
    ball.vx = 0;
    ball.vy = 0;
    ball.vz = 0;
    ball.state = 'idle';
    ball.rotation = 0;
    ball.vRot = 0;
    ball.isOnFire = false;
    ball.isPerfect = false;
    ball.scoredThisShot = false;
    ball.rimHits = 0;
    ball.spinEnglish = 0;
    ball.releaseQuality = 0;
}

function showMessage(text, x, y, color = '#fff') {
    messages.push({ text, x, y, life: 1.0, color, vy: -60 });
}

function createParticles(x, y, color, amount = 30) {
    for (let i = 0; i < amount; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 520,
            vy: (Math.random() - 0.5) * 520,
            life: 1,
            color,
            size: 2 + Math.random() * 4,
        });
    }
}

function rimPoint(angle) {
    return {
        x: hoop.x + Math.cos(angle) * hoop.radius,
        y: hoop.y + Math.sin(angle) * (hoop.radius / 2.5),
    };
}

function netPointRestPosition(row, col) {
    const t = col / net.cols;
    const angle = Math.PI * 2 * t;
    const rowRatio = row / (net.rows - 1);
    const topRadius = hoop.radius * 0.92;
    const bottomRadius = hoop.radius * 0.48;
    const radiusX = lerp(topRadius, bottomRadius, rowRatio);
    const radiusY = lerp(topRadius / 2.5, bottomRadius / 2.9, rowRatio);
    const verticalDrop = 18 + rowRatio * 92;
    return {
        x: hoop.x + Math.cos(angle) * radiusX,
        y: hoop.y + verticalDrop + Math.sin(angle) * radiusY,
        angle,
    };
}

function setupNet() {
    const oldPoints = net.points;
    net.points = [];

    for (let row = 0; row < net.rows; row++) {
        const line = [];
        for (let col = 0; col < net.cols; col++) {
            const rest = netPointRestPosition(row, col);
            const old = oldPoints[row]?.[col];
            line.push({
                row,
                col,
                x: old ? old.x : rest.x,
                y: old ? old.y : rest.y,
                vx: old ? old.vx * 0.25 : 0,
                vy: old ? old.vy * 0.25 : 0,
                restX: rest.x,
                restY: rest.y,
                pinned: row === 0,
            });
        }
        net.points.push(line);
    }
}

function addSpringForce(a, b, restLength, stiffness, damping) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    const nx = dx / len;
    const ny = dy / len;
    const stretch = len - restLength;
    const relVx = b.vx - a.vx;
    const relVy = b.vy - a.vy;
    const relVel = relVx * nx + relVy * ny;
    const force = stretch * stiffness + relVel * damping;

    if (!a.pinned) {
        a.vx += force * nx;
        a.vy += force * ny;
    }
    if (!b.pinned) {
        b.vx -= force * nx;
        b.vy -= force * ny;
    }
}

function punchNet(centerX, centerY, forceX = 0, forceY = 0, radius = 95, strength = 1) {
    net.lastPunchAt = performance.now();
    for (const row of net.points) {
        for (const p of row) {
            if (p.pinned) continue;
            const d = distance(centerX, centerY, p.x, p.y);
            if (d > radius) continue;
            const influence = (1 - d / radius) * strength;
            const awayX = p.x - centerX;
            const awayY = p.y - centerY;
            const awayLen = Math.sqrt(awayX * awayX + awayY * awayY) || 1;
            p.vx += (awayX / awayLen) * 120 * influence + forceX * 0.42 * influence;
            p.vy += (awayY / awayLen) * 120 * influence + forceY * 0.42 * influence;
        }
    }
}

function updateNet(dt) {
    if (!net.points.length) return;

    // Re-pin the top ring to the rim every frame, while allowing lower rows to swing.
    for (let col = 0; col < net.cols; col++) {
        const top = net.points[0][col];
        const rest = netPointRestPosition(0, col);
        top.restX = rest.x;
        top.restY = rest.y;
        top.x = rest.x;
        top.y = rest.y;
        top.vx = 0;
        top.vy = 0;
    }

    for (let row = 1; row < net.rows; row++) {
        for (let col = 0; col < net.cols; col++) {
            const p = net.points[row][col];
            const rest = netPointRestPosition(row, col);
            p.restX = rest.x;
            p.restY = rest.y;

            const returnStrength = physicsMode === 'arcade' ? 7.5 : 5.5;
            p.vx += (p.restX - p.x) * returnStrength * dt;
            p.vy += (p.restY - p.y) * returnStrength * dt;
            p.vy += 90 * dt; // rope weight
        }
    }

    // Rope mesh springs: vertical, horizontal ring, and diagonal diamond pattern.
    for (let row = 0; row < net.rows; row++) {
        for (let col = 0; col < net.cols; col++) {
            const p = net.points[row][col];
            const next = net.points[row][(col + 1) % net.cols];
            addSpringForce(p, next, distance(p.restX, p.restY, next.restX, next.restY), 0.24, 0.12);

            if (row < net.rows - 1) {
                const down = net.points[row + 1][col];
                addSpringForce(p, down, distance(p.restX, p.restY, down.restX, down.restY), 0.35, 0.16);

                const diag = net.points[row + 1][(col + 1) % net.cols];
                addSpringForce(p, diag, distance(p.restX, p.restY, diag.restX, diag.restY), 0.18, 0.10);
            }
        }
    }

    // Let the ball physically drag the net when it passes through or hits it.
    if (ball.state === 'shooting' || ball.state === 'falling') {
        const radius = currentBallRadius() * 0.62;
        const nearNetPlane = ball.z < 0.72 && ball.y > hoop.y - 6 && ball.y < hoop.y + 130;
        if (nearNetPlane) {
            for (const row of net.points) {
                for (const p of row) {
                    if (p.pinned) continue;
                    const dx = p.x - ball.x;
                    const dy = p.y - ball.y;
                    const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
                    const hitRange = radius + 22;
                    if (d > hitRange) continue;
                    const influence = (1 - d / hitRange);
                    p.vx += (dx / d) * 180 * influence + ball.vx * 0.13 * influence;
                    p.vy += (dy / d) * 180 * influence + ball.vy * 0.13 * influence;
                }
            }
        }
    }

    for (let row = 1; row < net.rows; row++) {
        for (let col = 0; col < net.cols; col++) {
            const p = net.points[row][col];
            p.vx *= 0.965;
            p.vy *= 0.965;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
        }
    }
}

function drawNet(layer = 'back') {
    if (!net.points.length) return;

    const drawBack = layer === 'back';
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255,255,255,0.32)';
    ctx.shadowBlur = drawBack ? 2 : 4;
    ctx.strokeStyle = drawBack ? 'rgba(235, 245, 255, 0.36)' : 'rgba(255, 255, 255, 0.82)';
    ctx.lineWidth = drawBack ? 1.15 : 1.65;

    function shouldDrawSegment(a, b) {
        const midY = (a.y + b.y) * 0.5;
        return drawBack ? midY < hoop.y + 60 : midY >= hoop.y + 18;
    }

    function drawSegment(a, b) {
        if (!shouldDrawSegment(a, b)) return;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    }

    for (let row = 0; row < net.rows; row++) {
        for (let col = 0; col < net.cols; col++) {
            const p = net.points[row][col];
            const next = net.points[row][(col + 1) % net.cols];
            drawSegment(p, next);

            if (row < net.rows - 1) {
                const down = net.points[row + 1][col];
                const diagRight = net.points[row + 1][(col + 1) % net.cols];
                const diagLeft = net.points[row + 1][(col + net.cols - 1) % net.cols];
                drawSegment(p, down);
                if ((row + col) % 2 === 0) drawSegment(p, diagRight);
                else drawSegment(p, diagLeft);
            }
        }
    }

    // Slight bottom knot ring.
    if (!drawBack) {
        ctx.strokeStyle = 'rgba(255,255,255,0.72)';
        ctx.lineWidth = 2;
        const bottom = net.points[net.rows - 1];
        for (let col = 0; col < net.cols; col += 2) {
            const p = bottom[col];
            const next = bottom[(col + 1) % net.cols];
            drawSegment(p, next);
        }
    }

    ctx.restore();
}

function scoreShot(isPerfectShot) {
    if (ball.scoredThisShot) return;
    ball.scoredThisShot = true;

    const cleanBonus = ball.rimHits === 0 ? 1 : 0;
    const perfect = isPerfectShot || cleanBonus && ball.releaseQuality > 0.82;
    let points = perfect ? 10 : (ball.isOnFire ? 3 : (1 + Math.floor(streak / 2)));

    if (perfect) {
        showMessage('PERFECT!', hoop.x, hoop.y - 42, '#ff00ff');
        createParticles(hoop.x, hoop.y, '#ff00ff', 38);
        streak += 2;
    } else {
        streak++;
        createParticles(hoop.x, hoop.y, ball.isOnFire ? '#ff4400' : '#00ff9d', 28);
    }

    score += points;
    scoreEl.textContent = score;
    streakEl.textContent = streak;

    punchNet(ball.x, hoop.y + 35, ball.vx, Math.abs(ball.vy) + 260, 125, perfect ? 1.35 : 1.0);

    ball.state = 'falling';
    ball.vx *= 0.38;
    ball.vy = Math.max(230, Math.abs(ball.vy) * 0.38);
    ball.vz = 0.08;
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

function handleRimAndBackboardCollisions() {
    if (ball.state !== 'shooting' || ball.scoredThisShot) return;

    const visualRadius = currentBallRadius();
    const rimBallRadius = visualRadius * 0.38;
    const rimYRadius = hoop.radius / 2.5;
    const dx = ball.x - hoop.x;
    const dy = ball.y - hoop.y;
    const rimEllipse = Math.sqrt((dx * dx) / (hoop.radius * hoop.radius) + (dy * dy) / (rimYRadius * rimYRadius));
    const nearRimDepth = Math.abs(ball.z - HOOP_Z) < 0.13;

    // Backboard hit: realistic glass deflection when the shot comes in too high/deep.
    const boardLeft = hoop.x - hoop.boardWidth / 2;
    const boardRight = hoop.x + hoop.boardWidth / 2;
    const boardTop = hoop.y - hoop.boardHeight;
    const boardBottom = hoop.y;
    const hitBackboard = nearRimDepth && ball.y - rimBallRadius < boardBottom && ball.y > boardTop && ball.x > boardLeft && ball.x < boardRight && ball.vy < 80;
    if (hitBackboard && ball.prevY > hoop.y - 14) {
        ball.vy = Math.abs(ball.vy) * BACKBOARD_RESTITUTION + 120;
        ball.vx += (ball.x - hoop.x) * 2.2;
        ball.vRot += ball.vx * 0.015;
        ball.rimHits++;
        punchNet(ball.x, hoop.y, ball.vx, 80, 80, 0.45);
        return;
    }

    // Rim collision: graze the orange rim instead of instantly missing.
    const rimContactBand = Math.abs(rimEllipse - 1) < 0.22;
    if (nearRimDepth && rimContactBand && ball.y < hoop.y + rimYRadius + rimBallRadius) {
        const nx = dx / (Math.abs(dx) || 1);
        const ny = dy / (Math.abs(dy) || 1);
        ball.vx = ball.vx * 0.52 + nx * 280;
        ball.vy = Math.abs(ball.vy) * RIM_RESTITUTION + ny * 95;
        ball.vz += 0.045;
        ball.vRot += nx * 8;
        ball.rimHits++;
        ball.releaseQuality *= 0.55;
        punchNet(ball.x, hoop.y + 18, ball.vx, ball.vy, 95, 0.7);
    }
}

function handleScoreWindow() {
    if (ball.state !== 'shooting' || ball.scoredThisShot) return;

    const crossedHoopDepth = ball.prevZ > HOOP_Z && ball.z <= HOOP_Z;
    const descending = ball.vy > 0;
    if (!crossedHoopDepth || !descending) return;

    const centerDx = ball.x - hoop.x;
    const centerDy = ball.y - hoop.y;
    const rimYRadius = hoop.radius / 2.5;
    const ellipseDistance = Math.sqrt((centerDx * centerDx) / (hoop.radius * hoop.radius) + (centerDy * centerDy) / (rimYRadius * rimYRadius));
    const scoreWindow = physicsMode === 'arcade' ? 1.22 : 0.88;
    const cleanWindow = physicsMode === 'arcade' ? 0.52 : 0.34;

    if (ellipseDistance < scoreWindow) {
        const clean = ellipseDistance < cleanWindow && Math.abs(ball.vx) < 240 && ball.rimHits === 0;
        scoreShot(ball.isPerfect || clean);
    } else {
        resetStreak();
        ball.state = 'falling';
        ball.vx += centerDx * 1.8;
        ball.vy = Math.max(180, Math.abs(ball.vy) * 0.36);
        ball.vz = 0.08;
        punchNet(ball.x, hoop.y + 24, ball.vx, ball.vy, 70, 0.32);
    }
}

function update(dt) {
    if (!isPlaying) {
        updateNet(dt);
        return;
    }

    updateNet(dt);

    if (ball.state === 'shooting' || ball.state === 'falling') {
        ball.prevX = ball.x;
        ball.prevY = ball.y;
        ball.prevZ = ball.z;

        const drag = Math.pow(AIR_DRAG, dt * 60);
        ball.vx *= drag;
        ball.vy += GRAVITY * dt;
        ball.vz *= drag;
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
        ball.z += ball.vz * dt;
        ball.rotation += ball.vRot * dt;
        ball.vRot *= Math.pow(SPIN_DRAG, dt * 60);

        if (ball.isOnFire && Math.random() > 0.3) {
            particles.push({
                x: ball.x + (Math.random() - 0.5) * currentBallRadius() * 0.5,
                y: ball.y + (Math.random() - 0.5) * currentBallRadius() * 0.5,
                vx: (Math.random() - 0.5) * 250,
                vy: -Math.random() * 250 - 70,
                life: 0.8,
                color: Math.random() > 0.5 ? '#ff4400' : '#ffaa00',
                size: 2 + Math.random() * 3,
            });
        }

        handleRimAndBackboardCollisions();
        handleScoreWindow();

        // Soft floor bounce after the ball falls out of the hoop/miss.
        if (ball.y > height - currentBallRadius() * 0.35 && ball.state === 'falling') {
            ball.y = height - currentBallRadius() * 0.35;
            ball.vy = -Math.abs(ball.vy) * 0.36;
            ball.vx *= GROUND_FRICTION;
            ball.vRot += ball.vx * 0.012;
            if (Math.abs(ball.vy) < 90) resetBall();
        }

        if (ball.x < -240 || ball.x > width + 240 || ball.y > height + 500 || ball.z < -0.1 || ball.z > 1.45) {
            resetStreak();
            resetBall();
        }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 240 * dt;
        p.life -= 1.9 * dt;
        if (p.life <= 0) particles.splice(i, 1);
    }

    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        m.y += m.vy * dt;
        m.life -= 1.25 * dt;
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
        ctx.moveTo(i, 0);
        ctx.lineTo(width / 2 + (i - width / 2) * 2, height);
    }
    for (let i = 0; i < height; i += 40) {
        ctx.moveTo(0, i);
        ctx.lineTo(width, i + (height - i) * 0.2);
    }
    ctx.stroke();

    drawBackboard();

    const ballScale = Math.max(0.1, ball.z);
    const radius = ball.radiusBase * ballScale;

    drawHoopRimBack();
    drawNet('back');

    if (ball.z < HOOP_Z) {
        drawBall(radius);
        drawNet('front');
        drawHoopRimFront();
    } else {
        drawBall(radius);
        drawNet('front');
        drawHoopRimFront();
    }

    particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = clamp(p.life, 0, 1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    });

    messages.forEach(m => {
        ctx.fillStyle = m.color;
        ctx.globalAlpha = clamp(m.life, 0, 1);
        ctx.font = `bold ${24 + (1 - m.life) * 20}px Inter`;
        ctx.textAlign = 'center';
        ctx.shadowColor = m.color;
        ctx.shadowBlur = 15;
        ctx.fillText(m.text, m.x, m.y);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
    });

    if (isDragging && ball.state === 'idle') {
        drawShotGuide();
    }
}

function drawBackboard() {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.strokeStyle = '#00d2ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00d2ff';
    ctx.shadowBlur = 10;
    ctx.fillRect(hoop.x - hoop.boardWidth / 2, hoop.y - hoop.boardHeight, hoop.boardWidth, hoop.boardHeight);
    ctx.strokeRect(hoop.x - hoop.boardWidth / 2, hoop.y - hoop.boardHeight, hoop.boardWidth, hoop.boardHeight);
    ctx.strokeRect(hoop.x - 30, hoop.y - 45, 60, 45);
    ctx.shadowBlur = 0;

    // Backboard glass sheen.
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hoop.x - hoop.boardWidth / 2 + 18, hoop.y - hoop.boardHeight + 12);
    ctx.lineTo(hoop.x + hoop.boardWidth / 2 - 24, hoop.y - hoop.boardHeight + 48);
    ctx.stroke();
    ctx.restore();
}

function drawHoopRimBack() {
    ctx.strokeStyle = 'rgba(255, 50, 0, 0.5)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(hoop.x, hoop.y, hoop.radius, hoop.radius / 2.5, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
}

function drawHoopRimFront() {
    ctx.strokeStyle = '#ff3e3e';
    ctx.lineWidth = 6;
    ctx.shadowColor = '#ff3e3e';
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.ellipse(hoop.x, hoop.y, hoop.radius, hoop.radius / 2.5, 0, 0, Math.PI);
    ctx.stroke();
    ctx.shadowBlur = 0;
}

function drawBall(radius) {
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.rotation);
    ctx.shadowColor = ball.isOnFire ? '#ff4400' : '#ff7700';
    ctx.shadowBlur = (ball.isOnFire ? 40 : 20) * ball.z;

    const grad = ctx.createRadialGradient(-radius / 3, -radius / 3, radius / 10, 0, 0, radius);
    if (ball.isOnFire) {
        grad.addColorStop(0, '#fff');
        grad.addColorStop(0.5, '#ffcc00');
        grad.addColorStop(1, '#ff4400');
    } else {
        grad.addColorStop(0, '#ffb642');
        grad.addColorStop(0.65, '#e56d1a');
        grad.addColorStop(1, '#8d2c09');
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = '#331100';
    ctx.lineWidth = Math.max(1, 4 * ball.z);
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.lineTo(0, radius);
    ctx.moveTo(-radius, 0);
    ctx.lineTo(radius, 0);
    ctx.ellipse(0, 0, radius * 0.72, radius, Math.PI / 2, 0, Math.PI * 2);
    ctx.ellipse(0, 0, radius * 0.72, radius, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function drawShotGuide() {
    const dx = clamp(dragStartX - mouseX, -260, 260);
    const dy = clamp(dragStartY - mouseY, 35, height * 0.55);
    const power = clamp(dy / (height * 0.45), 0, 1);
    const accuracy = 1 - clamp(Math.abs(dx) / 260, 0, 1);

    ctx.strokeStyle = `rgba(255, 119, 0, ${0.18 + power * 0.34})`;
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y);

    const guideSteps = 24;
    const estimatedFlight = lerp(0.95, 1.65, power);
    const targetX = hoop.x - dx * 0.74;
    const targetY = lerp(ball.y - dy * 1.3, hoop.y, 0.72);
    for (let i = 1; i <= guideSteps; i++) {
        const t = i / guideSteps;
        const arc = Math.sin(t * Math.PI) * dy * 0.36;
        const x = lerp(ball.x, targetX, t);
        const y = lerp(ball.y, targetY + GRAVITY * estimatedFlight * estimatedFlight * 0.00008, t) - arc;
        ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = `rgba(0, 210, 255, ${0.16 + accuracy * 0.22})`;
    ctx.beginPath();
    ctx.arc(hoop.x, hoop.y, 6 + accuracy * 10, 0, Math.PI * 2);
    ctx.fill();
}

function loop(timestamp = performance.now()) {
    const dt = Math.min(MAX_DT, Math.max(0.001, (timestamp - lastFrameTime) / 1000));
    lastFrameTime = timestamp;
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
    if (isDragging) {
        mouseX = x;
        mouseY = y;
    }
}

function handleEnd() {
    if (isDragging && ball.state === 'idle') {
        isDragging = false;
        let dx = dragStartX - mouseX;
        let dy = dragStartY - mouseY;

        dx = clamp(dx, -260, 260);
        dy = clamp(dy, 35, height * 0.58);

        if (dy > 30) {
            releaseShot(dx, dy);
        }
    }
}

function releaseShot(dx, dy) {
    ball.state = 'shooting';
    ball.scoredThisShot = false;
    ball.rimHits = 0;

    const dragDuration = Math.max((performance.now() - dragStartTime) / 1000, 0.08);
    const pullPower = clamp(dy / (height * 0.46), 0, 1.18);
    const quickness = clamp(1 / dragDuration, 0.65, 4.2);

    // Flight time and target bias tuned to feel like a real set shot/flick:
    // weak pull = short/flat, hard pull = higher arc, fast flick = extra power.
    const flightTime = clamp(lerp(1.05, 1.72, pullPower) - (quickness - 1) * 0.055, 0.92, 1.82);
    const releaseArc = lerp(0.18, 0.42, pullPower);
    const targetZ = clamp(HOOP_Z - 0.03 + (1 - pullPower) * 0.2, 0.12, 0.56);

    const sideSensitivity = physicsMode === 'arcade' ? 0.42 : 0.74;
    const targetX = hoop.x - dx * sideSensitivity;
    const targetY = hoop.y - lerp(6, 18, releaseArc);

    ball.vx = (targetX - ball.x) / flightTime;
    ball.vy = (targetY - ball.y - 0.5 * GRAVITY * flightTime * flightTime) / flightTime;
    ball.vz = (targetZ - ball.z) / flightTime;

    const centered = 1 - clamp(Math.abs(targetX - hoop.x) / (hoop.radius * 1.45), 0, 1);
    const powerSweetSpot = 1 - clamp(Math.abs(pullPower - 0.84) / 0.42, 0, 1);
    const arcSweetSpot = 1 - clamp(Math.abs(flightTime - 1.32) / 0.45, 0, 1);
    ball.releaseQuality = clamp((centered * 0.5) + (powerSweetSpot * 0.3) + (arcSweetSpot * 0.2), 0, 1);

    if (physicsMode === 'arcade' && ball.releaseQuality > 0.76) {
        const assist = 0.72;
        ball.vx = lerp(ball.vx, (hoop.x - ball.x) / flightTime, assist);
        ball.vz = lerp(ball.vz, (HOOP_Z - ball.z) / flightTime, assist);
        ball.isPerfect = true;
        ball.isOnFire = true;
    }

    ball.spinEnglish = clamp(dx / 260, -1, 1);
    ball.vRot = -ball.vx * 0.025 + ball.spinEnglish * 4.5;
}

window.addEventListener('mousedown', (e) => handleStart(e.clientX, e.clientY));
window.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
window.addEventListener('mouseup', handleEnd);
window.addEventListener('touchstart', (e) => handleStart(e.touches[0].clientX, e.touches[0].clientY), { passive: false });
window.addEventListener('touchmove', (e) => {
    e.preventDefault();
    handleMove(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });
window.addEventListener('touchend', handleEnd);

function startGame(mode) {
    gameMode = mode;
    overlay.style.opacity = '0';
    score = 0;
    streak = 0;
    level = 1;
    scoreEl.textContent = '0';
    streakEl.textContent = '0';

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
    }, 300);
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
        timeLeft--;
        timerValEl.textContent = timeLeft;
        if (timeLeft <= 0) gameOver();
    }, 1000);
}

function nextLevel() {
    level++;
    levelValEl.textContent = level;
    targetScore = 5 + (level * 5);
    timeLeft += 15;
    createParticles(width / 2, height / 2, '#00ff9d', 42);
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

resize();
loop();
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    const physics = params.get('physics');
    if (physics) setPhysics(physics);
    if (mode) startGame(mode);
});
