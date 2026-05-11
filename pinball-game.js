/**
 * Professional Pinball Engine - Ultra-Realistic Physics Build v5 (Newtonian Edition)
 * Developed by your Apprentice.
 */
window.__NEON_PINBALL_BUILD = 'pro-physics-v5-newtonian';
console.log('[Pro Pinball] Engine Initialized:', window.__NEON_PINBALL_BUILD);

const canvas = document.getElementById('pinballCanvas');
const ctx = canvas.getContext('2d');
const particleCanvas = document.getElementById('particle-canvas');
const pCtx = particleCanvas.getContext('2d');

const W = 400;
const H = 700;
const DPR_LIMIT = 2.5;

const ui = {
    score: document.getElementById('score'),
    balls: document.getElementById('balls'),
    multi: document.getElementById('multi'),
    highScore: document.getElementById('highScore'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlayTitle'),
    overlaySub: document.getElementById('overlaySub')
};

const COLORS = {
    bgDark: '#0f172a',       
    bgLight: '#1e293b',      
    primary: '#3b82f6',      
    secondary: '#8b5cf6',    
    accent: '#f59e0b',       
    danger: '#ef4444',       
    success: '#10b981',      
    wall: '#94a3b8',         
    wallGlow: 'rgba(59, 130, 246, 0.4)',
    white: '#f8fafc',
    metallic: '#cbd5e1'
};

// Pure Newtonian Physics Settings
const CFG = {
    gravity: 0.35,
    friction: 0.994,         
    restitution: 0.58,       
    ballRadius: 9.2,         
    maxSpeed: 28,            
    bumperKick: 12.0,        
    flipperSnap: 0.45,       
    tableTilt: 0.015,
    collisionSlop: 0.03,        
    substepsMin: 12,          
    slingshotForce: 13.0,
    wallFriction: 0.08,      
    flipperFriction: 0.25    
};

let savedHighScore = 0;
try {
    savedHighScore = Number(localStorage.getItem('pinball-pro-best') || 0);
} catch (e) {
    console.warn("localStorage not available.");
}

const state = {
    running: false,
    score: 0,
    balls: 3,
    multiplier: 1,
    combo: 0,
    highScore: savedHighScore,
    lastTime: 0,
    launchHolding: false,
    launchCharge: 0,
    launchReady: true,
    screenShake: 0,
    tiltWarnings: 0,
    tilted: false,
    nudgeCooldown: 0,
    message: '',
    messageTimer: 0
};

const keys = Object.create(null);
const particles = [];
const floatingText = [];

const ball = {
    x: 384, // Centered perfectly in the 370-398 shooter lane gap
    y: 628,
    vx: 0,
    vy: 0,
    r: CFG.ballRadius,
    spin: 0,
    inShooter: true,
    active: true,
    flipperCooldown: 0,
    trail: []
};

// Restored missing boundary logic in object initialization for exact physics rest/up calculation
const leftFlipper = { side: 'left', x: 130, y: 645, angle: 0.5, rest: 0.5, up: -0.5, length: 65, width: 14, color: COLORS.primary, pressed: false };
const rightFlipper = { side: 'right', x: 260, y: 645, angle: Math.PI - 0.5, rest: Math.PI - 0.5, up: Math.PI + 0.5, length: 65, width: 14, color: COLORS.secondary, pressed: false };

// Bumpers repositioned higher and spread for better playfield flow
const bumpers = [
    { x: 195, y: 160, r: 30, color: COLORS.secondary, points: 500, pulse: 0 },
    { x: 120, y: 240, r: 28, color: COLORS.primary, points: 300, pulse: 0 },
    { x: 270, y: 240, r: 28, color: COLORS.primary, points: 300, pulse: 0 }
];

// Reconfigured to spell "SHARE" spaced perfectly along the radial trajectory of the top arc
const rollovers = [
    { x: 78, y: 115, r: 12, label: 'S', lit: false, points: 250 },
    { x: 130, y: 71, r: 12, label: 'H', lit: false, points: 250 },
    { x: 195, y: 55, r: 12, label: 'A', lit: false, points: 250 },
    { x: 260, y: 71, r: 12, label: 'R', lit: false, points: 250 },
    { x: 312, y: 115, r: 12, label: 'E', lit: false, points: 250 }
];

const targets = [
    { x: 30, y: 340, w: 10, h: 40, color: COLORS.accent, lit: false, points: 180 },
    { x: 30, y: 390, w: 10, h: 40, color: COLORS.accent, lit: false, points: 180 },
    { x: 350, y: 340, w: 10, h: 40, color: COLORS.success, lit: false, points: 180 },
    { x: 350, y: 390, w: 10, h: 40, color: COLORS.success, lit: false, points: 180 }
];

const loop = {
    cx: 195,
    cy: 370,
    innerR: 45,
    midR: 62,
    outerR: 78,
    gap: 35,
    color: COLORS.accent,
    pulse: 0,
    gateCooldown: 0,
    gates: [
        { label: 'LEFT', angle: -2.2, lit: false, points: 650 },
        { label: 'RIGHT', angle: -0.4, lit: false, points: 650 }
    ]
};

const loopTilt = 0;

function createArc(cx, cy, r, startAngle, endAngle, segments, color, thick) {
    const arcWalls = [];
    const step = (endAngle - startAngle) / segments;
    for (let i = 0; i < segments; i++) {
        const a1 = startAngle + i * step;
        const a2 = startAngle + (i + 1) * step;
        arcWalls.push({
            x1: cx + Math.cos(a1) * r,
            y1: cy + Math.sin(a1) * r,
            x2: cx + Math.cos(a2) * r,
            y2: cy + Math.sin(a2) * r,
            color,
            thick
        });
    }
    return arcWalls;
}

const walls = [
    // Vertical side rails bounding the playfield 
    { x1: 20, y1: 688, x2: 20, y2: 200, color: COLORS.wall, thick: 8 }, 
    { x1: 398, y1: 688, x2: 398, y2: 200, color: COLORS.wall, thick: 8 }, 
    { x1: 0, y1: 695, x2: 400, y2: 695, color: COLORS.danger, thick: 12 }, 

    // Shooter lane inner barrier
    { x1: 370, y1: 688, x2: 370, y2: 200, color: COLORS.wall, thick: 6 }, 

    // Perfect symmetrical top arc covering the playfield (Center: 195, 200)
    ...createArc(195, 200, 175, Math.PI, Math.PI * 2, 24, COLORS.wall, 6), 
    
    // Outer upper-right arc smoothly guiding the launched ball into the top playfield
    ...createArc(195, 200, 203, Math.PI * 1.5, Math.PI * 2, 12, COLORS.wall, 8),

    // Slanted One-Way Plunger Lock Gate. Forces ball left into playfield if it falls back.
    { x1: 398, y1: 170, x2: 370, y2: 200, color: COLORS.accent, thick: 4, isGate: true },

    // Centered Slingshots
    { x1: 70, y1: 515, x2: 120, y2: 575, color: COLORS.success, thick: 6, slingshot: true },
    { x1: 120, y1: 575, x2: 70, y2: 575, color: COLORS.wall, thick: 4 },
    { x1: 70, y1: 575, x2: 70, y2: 515, color: COLORS.wall, thick: 4 },

    { x1: 320, y1: 515, x2: 270, y2: 575, color: COLORS.success, thick: 6, slingshot: true },
    { x1: 270, y1: 575, x2: 320, y2: 575, color: COLORS.wall, thick: 4 },
    { x1: 320, y1: 575, x2: 320, y2: 515, color: COLORS.wall, thick: 4 },

    // Bottom lane returns
    { x1: 20, y1: 530, x2: 130, y2: 625, color: COLORS.wall, thick: 5 },
    { x1: 370, y1: 530, x2: 260, y2: 625, color: COLORS.wall, thick: 5 },

    // Loop Crescents
    ...createArc(195 - 35/2, loop.cy, 62, Math.PI * 0.7, Math.PI * 1.3, 12, COLORS.accent, 4),
    ...createArc(195 + 35/2, loop.cy, 62, Math.PI * 1.7, Math.PI * 2.3, 12, COLORS.accent, 4)
];

function setupCanvas() {
    const dpr = Math.min(DPR_LIMIT, window.devicePixelRatio || 1);
    [canvas, particleCanvas].forEach((c) => {
        c.width = Math.floor(W * dpr);
        c.height = Math.floor(H * dpr);
        c.style.width = '100%';
        c.style.height = '100%';
        const context = c.getContext('2d');
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
}

window.addEventListener('resize', setupCanvas);
setupCanvas();
ui.highScore.textContent = formatScore(state.highScore);

function formatScore(value) {
    return Number(value).toLocaleString('en-US');
}

function updateUI() {
    ui.score.textContent = formatScore(state.score);
    ui.balls.textContent = state.balls;
    ui.multi.textContent = `${state.multiplier}x`;
    if (state.score > state.highScore) {
        state.highScore = state.score;
        try {
            localStorage.setItem('pinball-pro-best', String(state.highScore));
        } catch (e) {}
        ui.highScore.textContent = formatScore(state.highScore);
    }
}

function resetBall() {
    ball.x = 384; // Lock directly within the new tight shooter lane bounds
    ball.y = 628;
    ball.vx = 0;
    ball.vy = 0;
    ball.spin = 0;
    ball.inShooter = true;
    ball.active = true;
    ball.flipperCooldown = 0;
    
    leftFlipper.angle = leftFlipper.rest;
    rightFlipper.angle = rightFlipper.rest;
    
    state.launchReady = true;
    state.launchCharge = 0;
    ball.trail = [];
}

function startGame() {
    ui.overlay.classList.add('hidden');
    state.running = true;
    state.score = 0;
    state.balls = 3;
    state.multiplier = 1;
    state.combo = 0;
    state.message = '';
    state.messageTimer = 0;
    state.tiltWarnings = 0;
    state.tilted = false;
    state.nudgeCooldown = 0;
    state.launchHolding = false;
    state.launchCharge = 0;
    particles.length = 0;
    floatingText.length = 0;
    bumpers.forEach((b) => { b.pulse = 0; });
    rollovers.forEach((r) => { r.lit = false; });
    targets.forEach((t) => { t.lit = false; });
    resetBall();
    updateUI();
    state.lastTime = performance.now();
}
window.startGame = startGame;

function gameOver() {
    state.running = false;
    ui.overlay.classList.remove('hidden');
    ui.overlayTitle.innerHTML = `SESSION COMPLETE`;
    ui.overlayTitle.style.fontSize = '2.5rem';
    ui.overlayTitle.style.color = COLORS.white;
    ui.overlaySub.innerHTML = `Final Score: <span style="color:${COLORS.accent}">${formatScore(state.score)}</span><br>Best: ${formatScore(state.highScore)}`;
}

function loseBall() {
    state.screenShake = Math.max(state.screenShake, 12);
    spawnText('BALL LOST', 195, 564, COLORS.danger);
    explode(ball.x, Math.min(ball.y, 665), COLORS.danger, 30);
    state.balls -= 1;
    state.combo = 0;
    state.multiplier = 1;
    state.tilted = false;
    state.tiltWarnings = 0;
    updateUI();
    if (state.balls <= 0) {
        setTimeout(gameOver, 800);
    } else {
        setTimeout(resetBall, 400);
    }
}

function addScore(points, x, y, color = COLORS.white, label = '') {
    const value = Math.round(points * state.multiplier);
    state.score += value;
    state.combo += 1;
    if (state.combo > 0 && state.combo % 10 === 0) {
        state.multiplier = Math.min(8, state.multiplier + 1);
        spawnText(`MULTIPLIER ${state.multiplier}x`, 195, 160, COLORS.accent);
    }
    updateUI();
    spawnText(label || `+${value}`, x, y, color);
}

function spawnText(text, x, y, color) {
    floatingText.push({ text, x, y, color, life: 1, vy: -1.2 });
}

function nudge(direction = 0) {
    if (!state.running || state.tilted || state.nudgeCooldown > 0) return;
    state.nudgeCooldown = 30;
    state.tiltWarnings++;
    state.screenShake = Math.max(state.screenShake, 10);
    
    const forceX = direction === 0 ? (Math.random() - 0.5) * 5 : (direction * 4);
    const forceY = -2.0;
    ball.vx += forceX;
    ball.vy += forceY;
    
    if (state.tiltWarnings > 4) {
        state.tilted = true;
        spawnText("TILT FAULT", 195, 350, COLORS.danger);
    } else if (state.tiltWarnings > 2) {
        spawnText("WARNING", 195, 350, COLORS.accent);
    }
}

function explode(x, y, color, count = 20) {
    for (let i = 0; i < count; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const speed = 2.0 + Math.random() * 6.0;
        particles.push({
            x, y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            r: 1.5 + Math.random() * 2.5,
            color,
            life: 1,
            decay: 0.02 + Math.random() * 0.02
        });
    }
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function length(x, y) { return Math.hypot(x, y); }

function capSpeed() {
    const speed = length(ball.vx, ball.vy);
    if (speed > CFG.maxSpeed) {
        const scale = CFG.maxSpeed / speed;
        ball.vx *= scale;
        ball.vy *= scale;
    }
}

function beginLaunchCharge() {
    if (!state.running || !state.launchReady) return;
    state.launchHolding = true;
}

function releaseLaunchCharge() {
    if (!state.running || !ball.inShooter || !state.launchReady) {
        state.launchHolding = false;
        return;
    }
    const power = clamp(state.launchCharge, 0.3, 1.0);
    ball.vx = 0.2; // Slight right-lean to hug the outer rail for a smooth arc
    ball.vy = -22.0 - power * 12.0;
    ball.spin = -power * 0.3; 
    state.launchHolding = false;
    state.launchReady = false;
    state.launchCharge = 0;
    explode(384, 648, COLORS.accent, 25);
}

window.addEventListener('keydown', (event) => {
    if (['Space', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'KeyT', 'ShiftLeft', 'ShiftRight'].includes(event.code)) event.preventDefault();
    if (event.repeat && event.code !== 'Space') return;
    keys[event.code] = true;
    if (event.code === 'Space') beginLaunchCharge();
    if (event.code === 'KeyT' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        const dir = event.code === 'ShiftLeft' ? -1 : event.code === 'ShiftRight' ? 1 : 0;
        nudge(dir);
    }
    if (!state.running && event.code === 'Enter') startGame();
}, { passive: false });

window.addEventListener('keyup', (event) => {
    keys[event.code] = false;
    if (event.code === 'Space') releaseLaunchCharge();
});

function update(dt) {
    if (!state.running) return;

    const leftPressed = state.tilted ? false : Boolean(keys.KeyA || keys.ArrowLeft || keys.TouchLeft);
    const rightPressed = state.tilted ? false : Boolean(keys.KeyD || keys.ArrowRight || keys.TouchRight);

    updateFlipper(leftFlipper, leftPressed, dt);
    updateFlipper(rightFlipper, rightPressed, dt);

    if (state.launchHolding) state.launchCharge = clamp(state.launchCharge + 0.02 * dt, 0, 1);

    const speed = length(ball.vx, ball.vy);
    const maxMovePerSubstep = ball.r * 0.3; 
    const requiredSteps = Math.ceil((speed * dt) / maxMovePerSubstep);
    const steps = clamp(Math.max(requiredSteps, CFG.substepsMin), CFG.substepsMin, 30);
    const subDt = dt / steps;

    for (let i = 0; i < steps; i += 1) stepBall(subDt);

    bumpers.forEach((b) => { b.pulse = Math.max(0, b.pulse - 0.05 * dt); });
    walls.forEach((w) => { if (w.pulse) w.pulse = Math.max(0, w.pulse - 0.1 * dt); });
    updateParticles(dt);
    
    if (length(ball.vx, ball.vy) > 2) {
        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > 10) ball.trail.shift();
    } else if (ball.trail.length > 0) {
        ball.trail.shift();
    }

    state.screenShake = Math.max(0, state.screenShake - 0.5 * dt);
    if (state.nudgeCooldown > 0) state.nudgeCooldown -= dt;

    checkLoopScoring();
}

function updateFlipper(f, pressed, dt) {
    f.pressed = pressed;
    f.target = pressed ? f.up : f.rest;
    f.prevAngle = f.angle;
    const diff = f.target - f.angle;
    f.angle += diff * clamp(CFG.flipperSnap * dt, 0, 1);
}

function stepBall(dt) {
    if (!ball.active) return;

    ball.flipperCooldown = Math.max(0, ball.flipperCooldown - dt);
    ball.vy += CFG.gravity * dt;
    ball.vx += CFG.tableTilt * dt;
    
    ball.vx *= Math.pow(CFG.friction, dt);
    ball.vy *= Math.pow(CFG.friction, dt);
    
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    
    ball.spin *= Math.pow(0.95, dt);

    if (ball.x > 365 && ball.y > 450) {
        if (!ball.inShooter) ball.inShooter = true;
        if (Math.abs(ball.vy) < 0.2 && Math.abs(ball.vx) < 0.2) state.launchReady = true;
    } else if (ball.inShooter && ball.y < 185) {
        // Exit shooter mode as soon as the ball clears the inner wall (y=200)
        ball.inShooter = false;
        state.launchReady = false; 
    }

    for (const wall of walls) checkSegmentCollision(wall, CFG.restitution);
    for (const bumper of bumpers) checkBumperCollision(bumper);
    for (const rollover of rollovers) checkRollover(rollover);
    for (const target of targets) checkTargetCollision(target);
    checkFlipperCollision(leftFlipper, dt);
    checkFlipperCollision(rightFlipper, dt);

    if (!ball.inShooter && ball.y > 720) {
        loseBall();
        return;
    }

    if (ball.inShooter) {
        ball.x = clamp(ball.x, 378, 390); // Keep heavily constrained inside the physical rails
        if (ball.y > 640) {
            ball.y = 640;
            if (ball.vy > 0) ball.vy *= -0.3;
        }
    }
    capSpeed();
}

function checkSegmentCollision(seg, restitution) {
    // If it's the plunger lock gate, and the ball is still shooting, let it ghost through
    if (seg.isGate && ball.inShooter) return; 

    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return;
    
    const t = clamp(((ball.x - seg.x1) * dx + (ball.y - seg.y1) * dy) / lenSq, 0, 1);
    const cx = seg.x1 + dx * t;
    const cy = seg.y1 + dy * t;
    
    let nx = ball.x - cx;
    let ny = ball.y - cy;
    let dist = length(nx, ny);
    const radius = ball.r + (seg.thick || 2) * 0.5;
    
    if (dist >= radius) return;

    if (dist < 0.0001) {
        const segLen = Math.sqrt(lenSq);
        nx = -dy / segLen;
        ny = dx / segLen;
        dist = 1;
    } else {
        nx /= dist;
        ny /= dist;
    }

    const dot = ball.vx * nx + ball.vy * ny;
    if (dot > 0 && dist < radius * 0.8) {
        nx = -nx;
        ny = -ny;
    }

    const penetration = radius - dist + CFG.collisionSlop;
    ball.x += nx * penetration;
    ball.y += ny * penetration;
    
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
        ball.vx -= (1 + restitution) * vn * nx;
        ball.vy -= (1 + restitution) * vn * ny;
        
        const tx = -ny, ty = nx;
        const vt = ball.vx * tx + ball.vy * ty;
        ball.vx -= vt * CFG.wallFriction * tx;
        ball.vy -= vt * CFG.wallFriction * ty;
        
        ball.spin += (vt * CFG.wallFriction) / ball.r;

        if (seg.slingshot && Math.abs(vn) > 1.5) {
            ball.vx += nx * CFG.slingshotForce;
            ball.vy += ny * CFG.slingshotForce;
            seg.pulse = 1;
            explode(ball.x, ball.y, seg.color, 15);
            state.screenShake = Math.max(state.screenShake, 8);
            addScore(50, ball.x, ball.y, seg.color, 'KICK');
        } else if (Math.abs(vn) > 4.0) {
            explode(ball.x, ball.y, COLORS.white, 4);
        }
    }
}

function checkBumperCollision(b) {
    let nx = ball.x - b.x;
    let ny = ball.y - b.y;
    const dist = length(nx, ny);
    const radius = ball.r + b.r;
    if (dist >= radius) return;
    
    if (dist < 0.001) { nx = 0; ny = -1; } 
    else { nx /= dist; ny /= dist; }
    
    ball.x = b.x + nx * radius;
    ball.y = b.y + ny * radius;
    
    ball.vx = nx * CFG.bumperKick + ball.vx * 0.15;
    ball.vy = ny * CFG.bumperKick + ball.vy * 0.15;
    b.pulse = 1;
    state.screenShake = Math.max(state.screenShake, 6);
    addScore(b.points, b.x, b.y - b.r - 10, b.color);
    explode(b.x, b.y, b.color, 30);
}

function checkRollover(r) {
    if (length(ball.x - r.x, ball.y - r.y) > ball.r + r.r) return;
    if (!r.lit) {
        r.lit = true;
        addScore(r.points, r.x, r.y - 18, COLORS.accent, r.label);
        explode(r.x, r.y, COLORS.accent, 20);
        if (rollovers.every((item) => item.lit)) {
            rollovers.forEach((item) => { item.lit = false; });
            state.multiplier = Math.min(8, state.multiplier + 1);
            updateUI();
            spawnText('LANE BONUS', 195, 130, COLORS.success);
            explode(195, 120, COLORS.success, 50);
        }
    }
}

function checkTargetCollision(t) {
    const closestX = clamp(ball.x, t.x, t.x + t.w);
    const closestY = clamp(ball.y, t.y, t.y + t.h);
    let nx = ball.x - closestX;
    let ny = ball.y - closestY;
    const dist = length(nx, ny);
    if (dist >= ball.r) return;
    
    if (dist < 0.001) { nx = ball.x < t.x + t.w / 2 ? -1 : 1; ny = 0; } 
    else { nx /= dist; ny /= dist; }
    
    ball.x += nx * (ball.r - dist + 0.1);
    ball.y += ny * (ball.r - dist + 0.1);
    
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
        ball.vx -= 1.6 * vn * nx;
        ball.vy -= 1.6 * vn * ny;
    }
    
    if (!t.lit) {
        t.lit = true;
        addScore(t.points, t.x + t.w / 2, t.y, t.color, 'HIT');
        explode(t.x + t.w / 2, t.y + t.h / 2, t.color, 18);
    }
}

function checkFlipperCollision(f, dt) {
    const tipX = f.x + Math.cos(f.angle) * f.length;
    const tipY = f.y + Math.sin(f.angle) * f.length;
    const dx = tipX - f.x, dy = tipY - f.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return;
    
    const t = clamp(((ball.x - f.x) * dx + (ball.y - f.y) * dy) / lenSq, 0, 1);
    const cx = f.x + dx * t;
    const cy = f.y + dy * t;
    let nx = ball.x - cx, ny = ball.y - cy;
    let dist = length(nx, ny);
    const contactRadius = ball.r + f.width * 0.5;

    if (dist >= contactRadius) return;
    if (dist < 0.001) { nx = f.side === 'left' ? 0.35 : -0.35; ny = -0.94; dist = 1; } 
    else { nx /= dist; ny /= dist; }

    const crossProductSign = (ball.x - f.x) * dy - (ball.y - f.y) * dx;
    if ((f.side === 'left' && crossProductSign > 0) || (f.side === 'right' && crossProductSign < 0)) {
        nx = -nx; ny = -ny;
    }

    ball.x += nx * (contactRadius - dist + CFG.collisionSlop);
    ball.y += ny * (contactRadius - dist + CFG.collisionSlop);

    const omega = ((f.angle - f.prevAngle) / (dt || 1)) * 1.1;
    const vfx = -omega * (cy - f.y), vfy = omega * (cx - f.x);
    
    const vrx = ball.vx - vfx, vry = ball.vy - vfy;
    const vrn = vrx * nx + vry * ny;

    if (vrn < 0) {
        const isHitting = (f.side === 'left' && omega < -0.01) || (f.side === 'right' && omega > 0.01);
        const e = isHitting ? 0.65 : 0.4;
        const j = -(1 + e) * vrn;

        ball.vx += j * nx;
        ball.vy += j * ny;

        const tx = -ny, ty = nx;
        const vrt = vrx * tx + vry * ty;
        ball.vx -= vrt * CFG.flipperFriction * tx;
        ball.vy -= vrt * CFG.flipperFriction * ty;
        
        ball.spin += (vrt * CFG.flipperFriction) / ball.r;

        if (isHitting && ball.flipperCooldown <= 0 && j > 5) {
            ball.flipperCooldown = 2;
            state.screenShake = Math.max(state.screenShake, clamp(j * 0.2, 0, 7));
            explode(cx, cy, f.color, clamp(j * 0.6, 8, 35));
        }
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.pow(0.96, dt);
        p.vy *= Math.pow(0.96, dt);
        p.life -= p.decay * dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floatingText.length - 1; i >= 0; i--) {
        const ft = floatingText[i];
        ft.y += ft.vy * dt;
        ft.life -= 0.02 * dt;
        if (ft.life <= 0) floatingText.splice(i, 1);
    }
}

function draw() {
    const shakeX = (Math.random() - 0.5) * state.screenShake;
    const shakeY = (Math.random() - 0.5) * state.screenShake;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.translate(shakeX, shakeY);

    drawBackground();
    drawPlayfieldArt();
    drawLoopObstacle();
    drawWalls();
    drawRollovers();
    drawTargets();
    drawBumpers();
    drawShooterLane();
    drawFlipper(leftFlipper);
    drawFlipper(rightFlipper);
    drawBall();
    drawPlungerMeter();

    ctx.restore();
    drawParticles(shakeX, shakeY);
}

function normalizeAngle(a) {
    while (a < -Math.PI) a += Math.PI * 2;
    while (a > Math.PI) a -= Math.PI * 2;
    return a;
}

function checkLoopScoring() {
    if (loop.gateCooldown > 0) {
        loop.gateCooldown -= 1;
        return;
    }
    const dx = ball.x - loop.cx;
    const dy = ball.y - loop.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > loop.innerR && dist < loop.outerR) {
        const angle = Math.atan2(dy, dx);
        for (const gate of loop.gates) {
            if (Math.abs(normalizeAngle(angle - gate.angle)) < 0.25) {
                gate.lit = true;
                loop.gateCooldown = 15;
                loop.pulse = 1.0;
                addScore(gate.points, ball.x, ball.y, loop.color, `LOOP ${gate.label}`);
                explode(ball.x, ball.y, loop.color, 15);
                
                if (loop.gates.every(g => g.lit)) {
                    loop.gates.forEach(g => g.lit = false);
                    state.multiplier = Math.min(5, state.multiplier + 1);
                    addScore(2000, loop.cx, loop.cy, COLORS.success, 'DOUBLE LOOP!');
                    explode(loop.cx, loop.cy, COLORS.success, 40);
                }
                break;
            }
        }
    }
}

function drawLoopObstacle() {
    ctx.save();
    loop.pulse = Math.max(0, loop.pulse - 0.05);
    const glow = 5 + loop.pulse * 15;
    
    ctx.shadowBlur = glow;
    ctx.shadowColor = loop.color;
    ctx.strokeStyle = loop.color;
    ctx.lineWidth = 4 + loop.pulse * 2;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.arc(loop.cx - loop.gap/2, loop.cy, loop.midR, Math.PI * 0.7 + loopTilt, Math.PI * 1.3 + loopTilt);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(loop.cx + loop.gap/2, loop.cy, loop.midR, Math.PI * 1.7 + loopTilt, Math.PI * 2.3 + loopTilt);
    ctx.stroke();
    
    ctx.textAlign = 'center';
    ctx.font = '900 12px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('SPLIT LOOP', loop.cx, loop.cy);
    
    const drawMarkers = (cx, startA, endA) => {
        const steps = 5;
        for (let i = 0; i <= steps; i++) {
            const a = startA + (endA - startA) * (i / steps);
            const mx = cx + Math.cos(a) * (loop.midR + 8);
            const my = loop.cy + Math.sin(a) * (loop.midR + 8);
            
            ctx.fillStyle = COLORS.accent;
            ctx.shadowBlur = 4;
            ctx.beginPath();
            ctx.arc(mx, my, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    };
    
    drawMarkers(loop.cx - loop.gap/2, Math.PI * 0.7, Math.PI * 1.3);
    drawMarkers(loop.cx + loop.gap/2, Math.PI * 1.7, Math.PI * 2.3);
    
    ctx.restore();
}

function drawBackground() {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, COLORS.bgDark);
    grad.addColorStop(1, COLORS.bgLight);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let i = 0; i < W; i += 40) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke();
    }
    for (let i = 0; i < H; i += 40) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke();
    }
    ctx.restore();
}

function drawPlayfieldArt() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '900 38px Inter, sans-serif';

    // INNOVATION: Dynamic Multiplier Glow on central decal elements
    const glowIntensity = Math.min(1.0, (state.multiplier - 1) / 7);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.04 + glowIntensity * 0.1})`;
    
    if (glowIntensity > 0) {
        ctx.shadowColor = COLORS.accent;
        ctx.shadowBlur = glowIntensity * 20;
    }

    ctx.fillText('SIGNAL', 195, 420);
    ctx.fillText('SHARE', 195, 460);
    
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(59, 130, 246, ${0.15 + glowIntensity * 0.35})`;
    ctx.lineWidth = 2 + glowIntensity * 3;
    ctx.beginPath();
    ctx.arc(195, 360, 140, Math.PI, 0);
    ctx.stroke();
    
    ctx.restore();
}

function drawWalls() {
    walls.forEach((w) => {
        ctx.save();
        const pulse = w.pulse || 0;
        
        if (w.isGate) {
            // Visualize the plunger lock gate dynamically
            ctx.lineCap = 'round';
            if (ball.inShooter) {
                ctx.strokeStyle = 'rgba(16, 185, 129, 0.3)'; // Green/open logic
                ctx.setLineDash([6, 6]);
                ctx.lineWidth = w.thick;
            } else {
                ctx.strokeStyle = COLORS.danger; // Red/Locked
                ctx.shadowColor = COLORS.danger;
                ctx.shadowBlur = 12;
                ctx.lineWidth = w.thick + 2;
            }
        } else {
            ctx.strokeStyle = w.color;
            ctx.lineWidth = w.thick + pulse * 2;
            ctx.lineCap = 'round';
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 4;
        }
        
        ctx.beginPath();
        ctx.moveTo(w.x1, w.y1);
        ctx.lineTo(w.x2, w.y2);
        ctx.stroke();

        if (!w.isGate) {
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
            ctx.strokeStyle = pulse > 0 ? COLORS.white : 'rgba(255,255,255,0.3)';
            ctx.lineWidth = w.thick * 0.4;
            ctx.stroke();
        }
        ctx.restore();
    });
}

function drawRollovers() {
    rollovers.forEach((r) => {
        ctx.save();
        const color = r.lit ? COLORS.accent : 'rgba(255,255,255,0.1)';
        ctx.fillStyle = r.lit ? color : 'rgba(0,0,0,0.3)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        
        if (r.lit) {
            ctx.shadowColor = color;
            ctx.shadowBlur = 12;
        }
        
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        
        ctx.fillStyle = r.lit ? '#000' : 'rgba(255,255,255,0.5)';
        ctx.font = '800 12px Inter, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(r.label, r.x, r.y + 1);
        ctx.restore();
    });
}

function drawTargets() {
    targets.forEach((t) => {
        ctx.save();
        ctx.fillStyle = t.lit ? t.color : 'rgba(255,255,255,0.1)';
        ctx.shadowColor = t.color;
        ctx.shadowBlur = t.lit ? 15 : 0;
        ctx.beginPath();
        ctx.roundRect(t.x, t.y, t.w, t.h, 3);
        ctx.fill();
        ctx.restore();
    });
}

function drawBumpers() {
    bumpers.forEach((b) => {
        const pulse = b.pulse;
        ctx.save();
        
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 5;
        
        ctx.fillStyle = COLORS.bgLight;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
        
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 15 + pulse * 20;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 4 + pulse * 3;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 4 + pulse * 2, 0, Math.PI * 2); ctx.stroke();
        
        ctx.fillStyle = COLORS.white;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    });
}

function drawShooterLane() {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(370, 200, 28, 500); // perfectly scaled inside wall boundaries
    
    if (state.launchReady && ball.inShooter) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.2)';
        ctx.beginPath(); ctx.arc(384, 628, 16, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
}

function drawFlipper(f) {
    const tipX = f.x + Math.cos(f.angle) * f.length;
    const tipY = f.y + Math.sin(f.angle) * f.length;
    ctx.save();
    
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 4;
    
    ctx.strokeStyle = COLORS.bgLight;
    ctx.lineWidth = f.width + 2;
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(tipX, tipY); ctx.stroke();
    
    ctx.shadowBlur = f.pressed ? 12 : 0;
    ctx.shadowColor = f.color;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = f.width - 4;
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(tipX, tipY); ctx.stroke();
    
    ctx.fillStyle = COLORS.white;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.width * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}

function drawBall() {
    if (ball.trail.length > 1) {
        ctx.save();
        ctx.beginPath(); ctx.moveTo(ball.trail[0].x, ball.trail[0].y);
        for (let i = 1; i < ball.trail.length; i++) ctx.lineTo(ball.trail[i].x, ball.trail[i].y);
        ctx.strokeStyle = 'rgba(203, 213, 225, 0.2)';
        ctx.lineWidth = ball.r * 1.5;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
    }

    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.spin);
    
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    
    const grad = ctx.createRadialGradient(-ball.r*0.3, -ball.r*0.3, ball.r*0.1, 0, 0, ball.r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, '#94a3b8');
    grad.addColorStop(0.8, '#334155');
    grad.addColorStop(1, '#0f172a');
    
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, ball.r, 0, Math.PI * 2); ctx.fill();
    
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, ball.r * 0.5, 0, Math.PI * 0.5); ctx.stroke();
    
    ctx.restore();
}

function drawPlungerMeter() {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(380, 640, 8, 50); // Slimmer to fit within optimized inner lane
    
    const h = 50 * state.launchCharge;
    ctx.fillStyle = COLORS.accent;
    ctx.shadowColor = COLORS.accent;
    ctx.shadowBlur = 8;
    ctx.fillRect(380, 690 - h, 8, h);
    ctx.restore();
}

function drawParticles(shakeX, shakeY) {
    pCtx.clearRect(0, 0, W, H);
    pCtx.save();
    pCtx.translate(shakeX, shakeY);
    
    particles.forEach((p) => {
        pCtx.globalAlpha = clamp(p.life, 0, 1);
        pCtx.fillStyle = p.color;
        pCtx.shadowColor = p.color;
        pCtx.shadowBlur = 6;
        pCtx.beginPath(); pCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2); pCtx.fill();
    });

    floatingText.forEach((ft) => {
        pCtx.globalAlpha = clamp(ft.life, 0, 1);
        pCtx.fillStyle = ft.color;
        pCtx.font = `900 ${14 + (1 - ft.life) * 6}px Inter, sans-serif`;
        pCtx.textAlign = 'center';
        pCtx.fillText(ft.text, ft.x, ft.y);
    });
    
    pCtx.restore();
}

function frame(now) {
    const rawDt = state.lastTime ? (now - state.lastTime) / 16.6667 : 1;
    const dt = clamp(rawDt, 0.1, 2.5); 
    state.lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);