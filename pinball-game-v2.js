        window.__NEON_PINBALL_BUILD = 'revamped-functional-v2.1-flipper-skill';
        console.log('[Neon Pinball] Build:', window.__NEON_PINBALL_BUILD);

        const canvas = document.getElementById('pinballCanvas');
        const ctx = canvas.getContext('2d');
        const particleCanvas = document.getElementById('particle-canvas');
        const pCtx = particleCanvas.getContext('2d');

        const W = 400;
        const H = 700;
        const DPR_LIMIT = 2;

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
            cyan: '#00ffff',
            magenta: '#ff00ff',
            blue: '#4d4dff',
            green: '#00ff9d',
            gold: '#ffd700',
            orange: '#ff8a00',
            white: '#ffffff',
            rail: 'rgba(180, 235, 255, 0.78)',
            dim: 'rgba(255,255,255,0.16)'
        };

        const CFG = {
            gravity: 0.25,
            friction: 0.992, // Increased friction (lower value = more resistance)
            restitution: 0.62,
            ballRadius: 8.8,
            maxSpeed: 32,
            bumperKick: 11.0,
            flipperKick: 10.5,
            flipperSnap: 0.48,
            tableTilt: 0.012,
            collisionSlop: 0.15,
            substepsMin: 4,
            substepsMax: 14,
            slingshotForce: 11.5,
            flipperCatchSpeed: 11.5,
            flipperHoldFriction: 0.86,
            flipperCradleGravity: 0.035,
            flipperShotBase: 3.8,
            flipperShotTipBonus: 12.8,
            flipperShotSpeedBonus: 0.28,
            flipperShotSwingBonus: 0.035
        };

        let savedHighScore = 0;
        try {
            savedHighScore = Number(localStorage.getItem('pinball-best') || 0);
        } catch (e) {
            console.warn("localStorage not available:", e);
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
            messageTimer: 0,
            lastFlipHit: null,
            hitMeterTimer: 0
        };

        const keys = Object.create(null);
        const particles = [];
        const floatingText = [];

        const ball = {
            x: 385,
            y: 628,
            vx: 0,
            vy: 0,
            r: CFG.ballRadius,
            spin: 0,
            inShooter: true,
            active: true,
            flipperCooldown: 0,
            heldByFlipper: '',
            trail: []
        };

        const leftFlipper = {
            side: 'left',
            x: 125,
            y: 626,
            length: 75,
            width: 16,
            rest: 0.35,
            up: -0.55,
            angle: 0.35,
            prevAngle: 0.35,
            target: 0.35,
            pressed: false,
            color: COLORS.cyan
        };

        const rightFlipper = {
            side: 'right',
            x: 275,
            y: 626,
            length: 75,
            width: 16,
            rest: Math.PI - 0.35,
            up: Math.PI + 0.55,
            angle: Math.PI - 0.35,
            prevAngle: Math.PI - 0.35,
            target: Math.PI - 0.35,
            pressed: false,
            color: COLORS.magenta
        };

        const bumpers = [
            { x: 200, y: 140, r: 34, color: COLORS.magenta, points: 500, pulse: 0 },
            { x: 125, y: 230, r: 30, color: COLORS.cyan, points: 300, pulse: 0 },
            { x: 275, y: 230, r: 30, color: COLORS.cyan, points: 300, pulse: 0 }
        ];

        const rollovers = [
            { x: 118, y: 82, r: 13, label: 'S', lit: false, points: 250 },
            { x: 166, y: 70, r: 13, label: 'H', lit: false, points: 250 },
            { x: 214, y: 70, r: 13, label: 'A', lit: false, points: 250 },
            { x: 262, y: 82, r: 13, label: 'R', lit: false, points: 250 }
        ];

        const targets = [
            { x: 38, y: 220, w: 12, h: 34, color: COLORS.magenta, lit: false, points: 180 },
            { x: 38, y: 264, w: 12, h: 34, color: COLORS.magenta, lit: false, points: 180 },
            { x: 350, y: 220, w: 12, h: 34, color: COLORS.cyan, lit: false, points: 180 },
            { x: 350, y: 264, w: 12, h: 34, color: COLORS.cyan, lit: false, points: 180 }
        ];

        const loop = {
            cx: 200,
            cy: 360,
            innerR: 42,
            midR: 58,
            outerR: 74,
            color: COLORS.gold,
            accent: COLORS.magenta,
            pulse: 0,
            gateCooldown: 0,
            gates: [
                { label: 'IN', angle: 1.82, lit: false, points: 450 },
                { label: 'ARC', angle: 2.92, lit: false, points: 550 },
                { label: 'TOP', angle: -1.58, lit: false, points: 650 },
                { label: 'OUT', angle: 0.16, lit: false, points: 750 }
            ]
        };

        function createArc(cx, cy, r, startAngle, endAngle, segments, color, thick, extras = {}) {
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
                    thick,
                    ...extras
                });
            }
            return arcWalls;
        }

        function createPolyline(points, color, thick, extras = {}) {
            const segments = [];
            for (let i = 0; i < points.length - 1; i += 1) {
                segments.push({
                    x1: points[i][0],
                    y1: points[i][1],
                    x2: points[i + 1][0],
                    y2: points[i + 1][1],
                    color,
                    thick,
                    ...extras
                });
            }
            return segments;
        }

        const loopWalls = [
            // Outer and inner rails leave a lower mouth so the ball can enter the loop channel.
            ...createArc(loop.cx, loop.cy, loop.outerR, -Math.PI, 1.10, 34, loop.color, 5, { loopRail: true }),
            ...createArc(loop.cx, loop.cy, loop.outerR, 2.02, Math.PI, 12, loop.color, 5, { loopRail: true }),
            ...createArc(loop.cx, loop.cy, loop.innerR, -Math.PI, 1.08, 32, loop.accent, 4, { loopRail: true }),
            ...createArc(loop.cx, loop.cy, loop.innerR, 2.04, Math.PI, 10, loop.accent, 4, { loopRail: true })
        ];

        const walls = [
            // Cleaner outer cabinet: proportional, mostly vertical, and mirrored around the playfield.
            ...createPolyline([[22, 688], [22, 144], [34, 103], [68, 64], [112, 42]], COLORS.cyan, 6),
            { x1: 112, y1: 42, x2: 284, y2: 42, color: COLORS.cyan, thick: 6 },
            ...createPolyline([[284, 42], [326, 64], [362, 105], [397, 130], [397, 688]], COLORS.cyan, 6),

            // Shooter lane is straighter and evenly spaced so it no longer looks pinched.
            { x1: 372, y1: 688, x2: 372, y2: 146, color: COLORS.cyan, thick: 5 },
            ...createArc(345, 145, 27, -0.1, Math.PI * 0.78, 12, COLORS.cyan, 5),

            // Smooth ball-return guides.
            ...createPolyline([[36, 490], [50, 525], [86, 560], [120, 594]], COLORS.blue, 4),
            ...createPolyline([[364, 490], [350, 525], [314, 560], [280, 594]], COLORS.blue, 4),

            // Symmetric slingshots above the flippers.
            { x1: 54, y1: 528, x2: 112, y2: 578, color: COLORS.green, thick: 6, slingshot: true },
            { x1: 112, y1: 578, x2: 68, y2: 602, color: COLORS.green, thick: 4 },
            { x1: 68, y1: 602, x2: 54, y2: 528, color: COLORS.green, thick: 4 },

            { x1: 346, y1: 528, x2: 288, y2: 578, color: COLORS.green, thick: 6, slingshot: true },
            { x1: 288, y1: 578, x2: 332, y2: 602, color: COLORS.green, thick: 4 },
            { x1: 332, y1: 602, x2: 346, y2: 528, color: COLORS.green, thick: 4 },

            // Lower guides feed the ball toward the flippers without the old stretched proportions.
            { x1: 24, y1: 596, x2: 116, y2: 626, color: COLORS.blue, thick: 4 },
            { x1: 376, y1: 596, x2: 284, y2: 626, color: COLORS.blue, thick: 4 },

            ...loopWalls
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
                    localStorage.setItem('pinball-best', String(state.highScore));
                } catch (e) {}
                ui.highScore.textContent = formatScore(state.highScore);
            }
        }

        function resetBall() {
            ball.x = 385;
            ball.y = 628;
            ball.vx = 0;
            ball.vy = 0;
            ball.spin = 0;
            ball.inShooter = true;
            ball.active = true;
            ball.flipperCooldown = 0;
            ball.heldByFlipper = '';
            state.launchReady = true;
            state.launchCharge = 0;
        }

        function startGame() {
            ui.overlay.classList.add('hidden');
            ui.overlayTitle.innerHTML = 'NEON<br>PINBALL';
            ui.overlaySub.textContent = 'Signal Share Arcade Edition';
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
            state.lastFlipHit = null;
            state.hitMeterTimer = 0;
            particles.length = 0;
            floatingText.length = 0;
            bumpers.forEach((b) => { b.pulse = 0; });
            rollovers.forEach((r) => { r.lit = false; });
            targets.forEach((t) => { t.lit = false; });
            loop.gates.forEach((g) => { g.lit = false; });
            loop.pulse = 0;
            loop.gateCooldown = 0;
            resetBall();
            updateUI();
            state.lastTime = performance.now();
        }
        window.startGame = startGame;

        function gameOver() {
            state.running = false;
            ui.overlay.classList.remove('hidden');
            ui.overlayTitle.innerHTML = `GAME OVER<br><span style="font-size:0.34em;color:var(--neon-cyan);letter-spacing:0;">${formatScore(state.score)}</span>`;
            ui.overlaySub.textContent = `Best: ${formatScore(state.highScore)} • Press Start Session to replay`;
        }

        function loseBall() {
            state.screenShake = Math.max(state.screenShake, 10);
            spawnText('BALL LOST', 200, 564, COLORS.magenta);
            explode(ball.x, Math.min(ball.y, 665), COLORS.magenta, 22);
            state.balls -= 1;
            state.combo = 0;
            state.multiplier = 1;
            state.tilted = false;
            state.tiltWarnings = 0;
            updateUI();
            if (state.balls <= 0) {
                setTimeout(gameOver, 350);
            } else {
                resetBall();
            }
        }

        function addScore(points, x, y, color = COLORS.white, label = '') {
            const value = Math.round(points * state.multiplier);
            state.score += value;
            state.combo += 1;
            if (state.combo > 0 && state.combo % 8 === 0) {
                state.multiplier = Math.min(5, state.multiplier + 1);
                spawnText(`${state.multiplier}x MULTI`, 200, 125, COLORS.green);
            }
            updateUI();
            spawnText(label || `+${value}`, x, y, color);
        }

        function spawnText(text, x, y, color) {
            floatingText.push({ text, x, y, color, life: 1, vy: -0.85 });
        }

        function nudge(direction = 0) {
            if (!state.running || state.tilted || state.nudgeCooldown > 0) return;
            
            state.nudgeCooldown = 30; // 30 frames
            state.tiltWarnings++;
            state.screenShake = Math.max(state.screenShake, 8);
            
            const forceX = direction === 0 ? (Math.random() - 0.5) * 4 : (direction * 3);
            const forceY = -1.5;
            
            ball.vx += forceX;
            ball.vy += forceY;
            
            if (state.tiltWarnings > 5) {
                state.tilted = true;
                state.message = "TILT!";
                state.messageTimer = 180;
                spawnText("TILT!", 200, 350, COLORS.magenta);
            } else if (state.tiltWarnings > 3) {
                spawnText("WARNING!", 200, 350, COLORS.orange);
            }
        }

        function explode(x, y, color, count = 16) {
            for (let i = 0; i < count; i += 1) {
                const a = Math.random() * Math.PI * 2;
                const speed = 1.4 + Math.random() * 5.8;
                particles.push({
                    x,
                    y,
                    vx: Math.cos(a) * speed,
                    vy: Math.sin(a) * speed,
                    r: 1.6 + Math.random() * 2.4,
                    color,
                    life: 1,
                    decay: 0.018 + Math.random() * 0.018
                });
            }
        }

        function clamp(value, min, max) {
            return Math.max(min, Math.min(max, value));
        }

        function length(x, y) {
            return Math.hypot(x, y);
        }

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
            const power = clamp(state.launchCharge, 0.25, 1);
            ball.vx = -1.0 - power * 0.7;
            ball.vy = -16.0 - power * 8.0;
            ball.spin = -0.22;
            state.launchHolding = false;
            state.launchReady = false;
            state.launchCharge = 0;
            explode(385, 648, COLORS.gold, 18);
        }

        window.addEventListener('keydown', (event) => {
            if (['Space', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'KeyT', 'KeyX', 'ShiftLeft', 'ShiftRight'].includes(event.code)) event.preventDefault();
            if (event.repeat && event.code !== 'Space') return;
            keys[event.code] = true;
            if (event.code === 'Space') beginLaunchCharge();
            if (event.code === 'KeyT' || event.code === 'KeyX' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
                const dir = (event.code === 'ShiftLeft' || event.code === 'KeyZ') ? -1 : (event.code === 'ShiftRight' || event.code === 'KeyX') ? 1 : 0;
                nudge(dir);
            }
            if (!state.running && event.code === 'Enter') startGame();
        }, { passive: false });

        window.addEventListener('keyup', (event) => {
            keys[event.code] = false;
            if (event.code === 'Space') releaseLaunchCharge();
        });

        function bindHoldButton(id, onDown, onUp) {
            const button = document.getElementById(id);
            if (!button) return;
            const down = (event) => { event.preventDefault(); onDown(); };
            const up = (event) => { event.preventDefault(); onUp(); };
            button.addEventListener('pointerdown', down, { passive: false });
            button.addEventListener('pointerup', up, { passive: false });
            button.addEventListener('pointercancel', up, { passive: false });
            button.addEventListener('pointerleave', up, { passive: false });
        }

        bindHoldButton('leftTouch', () => { keys.TouchLeft = true; }, () => { keys.TouchLeft = false; });
        bindHoldButton('rightTouch', () => { keys.TouchRight = true; }, () => { keys.TouchRight = false; });
        bindHoldButton('plungerTouch', beginLaunchCharge, releaseLaunchCharge);

        canvas.addEventListener('pointerdown', (event) => {
            const point = clientToGame(event.clientX, event.clientY);
            if (!state.running) return;
            if (point.x > 330 && point.y > 520) {
                beginLaunchCharge();
            } else if (point.y > 510 && point.x < 200) {
                keys.TouchLeft = true;
            } else if (point.y > 510 && point.x >= 200) {
                keys.TouchRight = true;
            }
        });

        window.addEventListener('pointerup', () => {
            keys.TouchLeft = false;
            keys.TouchRight = false;
            releaseLaunchCharge();
        });

        function clientToGame(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            return {
                x: ((clientX - rect.left) / rect.width) * W,
                y: ((clientY - rect.top) / rect.height) * H
            };
        }

        function update(dt) {
            if (!state.running) return;

            const leftPressed = state.tilted ? false : Boolean(keys.KeyA || keys.ArrowLeft || keys.TouchLeft);
            const rightPressed = state.tilted ? false : Boolean(keys.KeyD || keys.ArrowRight || keys.TouchRight);

            updateFlipper(leftFlipper, leftPressed, dt);
            updateFlipper(rightFlipper, rightPressed, dt);

            if (state.launchHolding) {
                state.launchCharge = clamp(state.launchCharge + 0.016 * dt, 0, 1);
            }

            const speed = length(ball.vx, ball.vy);
            const steps = clamp(Math.ceil(speed / 6.5), CFG.substepsMin, CFG.substepsMax);
            const subDt = dt / steps;
            for (let i = 0; i < steps; i += 1) {
                stepBall(subDt);
            }

            bumpers.forEach((b) => { b.pulse = Math.max(0, b.pulse - 0.05 * dt); });
            walls.forEach((w) => { if (w.pulse) w.pulse = Math.max(0, w.pulse - 0.08 * dt); });
            loop.pulse = Math.max(0, loop.pulse - 0.045 * dt);
            loop.gateCooldown = Math.max(0, loop.gateCooldown - dt);
            updateParticles(dt);
            
            // Update ball trail
            ball.trail.push({ x: ball.x, y: ball.y });
            if (ball.trail.length > 8) ball.trail.shift();

            state.screenShake = Math.max(0, state.screenShake - 0.45 * dt);
            if (state.messageTimer > 0) state.messageTimer -= dt;
            if (state.nudgeCooldown > 0) state.nudgeCooldown -= dt;
            if (state.hitMeterTimer > 0) state.hitMeterTimer -= dt;
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
            ball.spin += (ball.vx * 0.018 + ball.vy * 0.004) * dt;

            // Improved Shooter Gate Logic
            if (ball.inShooter) {
                // Always ready to launch if ball is in the bottom section of lane
                if (ball.y > 600) {
                    state.launchReady = true;
                    if (Math.abs(ball.vy) < 0.5) ball.vy = 0;
                }
                
                // Exit shooter lane at the top
                if (ball.y < 140) {
                    ball.inShooter = false;
                    state.launchReady = false; 
                    // Nudge it slightly left to ensure it clears the lane wall
                    if (ball.vy < 0) ball.vx -= 1.5;
                }
            } else {
                // ONLY enter shooter lane from the top (above the inner wall)
                if (ball.y < 140 && ball.x > 376) {
                    ball.inShooter = true;
                }
            }

            for (const wall of walls) checkSegmentCollision(wall, CFG.restitution);
            for (const bumper of bumpers) checkBumperCollision(bumper);
            for (const rollover of rollovers) checkRollover(rollover);
            checkLoopScoring();
            for (const target of targets) checkTargetCollision(target);
            checkFlipperCollision(leftFlipper, dt);
            checkFlipperCollision(rightFlipper, dt);

            // Explicit floor boundary constraint (only for shooter lane)
            const floorY = 688;
            const floorCollideRadius = ball.r + 4;
            if (ball.y + floorCollideRadius > floorY) {
                if (ball.inShooter || ball.x > 374) {
                    ball.y = floorY - floorCollideRadius;
                    if (ball.vy > 0) {
                        if (ball.inShooter) {
                            ball.vy = 0; // Solid stop in lane
                            state.launchReady = true;
                        } else {
                            ball.vy *= -CFG.restitution;
                        }
                        ball.vx *= 0.98;
                    }
                }
            }

            if (!ball.inShooter && ball.y > 710) {
                loseBall();
                return;
            }

            if (ball.inShooter && ball.y > 150) {
                ball.x = clamp(ball.x, 376, 396);
            }

            capSpeed();
        }

        function checkSegmentCollision(seg, restitution = 0.82) {
            const dx = seg.x2 - seg.x1;
            const dy = seg.y2 - seg.y1;
            const lenSq = dx * dx + dy * dy;
            if (lenSq <= 0.0001) return;
            const t = clamp(((ball.x - seg.x1) * dx + (ball.y - seg.y1) * dy) / lenSq, 0, 1);
            const cx = seg.x1 + dx * t;
            const cy = seg.y1 + dy * t;
            let nx = ball.x - cx;
            let ny = ball.y - cy;
            let dist = length(nx, ny);
            const radius = ball.r + (seg.thick || 2) * 0.5;
            if (dist >= radius) return;

            if (dist < 0.001) {
                const segLen = Math.sqrt(lenSq);
                nx = -dy / segLen;
                ny = dx / segLen;
                dist = 1;
            } else {
                nx /= dist;
                ny /= dist;
            }

            const penetration = radius - dist + CFG.collisionSlop;
            ball.x += nx * penetration;
            ball.y += ny * penetration;
            const vn = ball.vx * nx + ball.vy * ny;
            if (vn < 0) {
                ball.vx -= (1 + restitution) * vn * nx;
                ball.vy -= (1 + restitution) * vn * ny;
                
                // Add spin influence to bounce
                const tx = -ny;
                const ty = nx;
                const vrt = ball.vx * tx + ball.vy * ty;
                
                ball.vx += ny * ball.spin * 15;
                ball.vy -= nx * ball.spin * 15;
                ball.spin *= 0.85; // Friction on spin
                ball.spin += vrt * 0.008;

                // Slingshot logic
                if (seg.slingshot && Math.abs(vn) > 1.2) {
                    ball.vx += nx * CFG.slingshotForce;
                    ball.vy += ny * CFG.slingshotForce;
                    seg.pulse = 1;
                    explode(ball.x, ball.y, seg.color, 12);
                    state.screenShake = Math.max(state.screenShake, 6);
                    addScore(50, ball.x, ball.y, seg.color, 'SLINGSHOT');
                } else if (Math.abs(vn) > 3.8) {
                    explode(ball.x, ball.y, seg.color || COLORS.white, 5);
                }
            }
        }

        function checkBumperCollision(b) {
            let nx = ball.x - b.x;
            let ny = ball.y - b.y;
            const dist = length(nx, ny);
            const radius = ball.r + b.r;
            if (dist >= radius) return;
            if (dist < 0.001) {
                nx = 0;
                ny = -1;
            } else {
                nx /= dist;
                ny /= dist;
            }
            ball.x = b.x + nx * radius;
            ball.y = b.y + ny * radius;
            ball.vx = nx * CFG.bumperKick + ball.vx * 0.12;
            ball.vy = ny * CFG.bumperKick + ball.vy * 0.12;
            b.pulse = 1;
            state.screenShake = Math.max(state.screenShake, 5);
            addScore(b.points, b.x, b.y - b.r - 10, b.color);
            explode(b.x, b.y, b.color, 28);
        }

        function checkRollover(r) {
            const dist = length(ball.x - r.x, ball.y - r.y);
            if (dist > ball.r + r.r) return;
            if (!r.lit) {
                r.lit = true;
                addScore(r.points, r.x, r.y - 18, COLORS.gold, r.label);
                explode(r.x, r.y, COLORS.gold, 18);
                if (rollovers.every((item) => item.lit)) {
                    rollovers.forEach((item) => { item.lit = false; });
                    state.multiplier = Math.min(5, state.multiplier + 1);
                    updateUI();
                    spawnText('SIGNAL BONUS', 200, 110, COLORS.green);
                    explode(200, 100, COLORS.green, 44);
                }
            }
        }

        function normalizeAngle(angle) {
            let value = angle;
            while (value <= -Math.PI) value += Math.PI * 2;
            while (value > Math.PI) value -= Math.PI * 2;
            return value;
        }

        function angleDistance(a, b) {
            return Math.abs(normalizeAngle(a - b));
        }

        function checkLoopScoring() {
            if (loop.gateCooldown > 0) return;

            const dx = ball.x - loop.cx;
            const dy = ball.y - loop.cy;
            const dist = length(dx, dy);
            const inLoopLane = dist > loop.innerR - ball.r * 0.8 && dist < loop.outerR + ball.r * 0.8;
            if (!inLoopLane) return;

            const angle = Math.atan2(dy, dx);
            for (const gate of loop.gates) {
                if (gate.lit) continue;
                if (angleDistance(angle, gate.angle) > 0.17) continue;

                gate.lit = true;
                loop.gateCooldown = 10;
                loop.pulse = Math.max(loop.pulse, 0.85);
                const gx = loop.cx + Math.cos(gate.angle) * loop.midR;
                const gy = loop.cy + Math.sin(gate.angle) * loop.midR;
                addScore(gate.points, gx, gy, loop.color, `LOOP ${gate.label}`);
                explode(gx, gy, loop.color, 18);

                if (loop.gates.every((item) => item.lit)) {
                    loop.gates.forEach((item) => { item.lit = false; });
                    loop.pulse = 1.35;
                    state.multiplier = Math.min(5, state.multiplier + 1);
                    updateUI();
                    addScore(2500, loop.cx, loop.cy, COLORS.green, 'LOOPTY BONUS');
                    spawnText(`${state.multiplier}x MULTI`, loop.cx, loop.cy - 42, COLORS.green);
                    explode(loop.cx, loop.cy, COLORS.green, 54);
                }
                break;
            }
        }

        function checkTargetCollision(t) {
            const closestX = clamp(ball.x, t.x, t.x + t.w);
            const closestY = clamp(ball.y, t.y, t.y + t.h);
            let nx = ball.x - closestX;
            let ny = ball.y - closestY;
            const dist = length(nx, ny);
            if (dist >= ball.r) return;
            if (dist < 0.001) {
                nx = ball.x < t.x + t.w / 2 ? -1 : 1;
                ny = 0;
            } else {
                nx /= dist;
                ny /= dist;
            }
            ball.x += nx * (ball.r - dist + 0.5);
            ball.y += ny * (ball.r - dist + 0.5);
            const vn = ball.vx * nx + ball.vy * ny;
            if (vn < 0) {
                ball.vx -= 1.8 * vn * nx;
                ball.vy -= 1.8 * vn * ny;
            }
            t.lit = true;
            addScore(t.points, t.x + t.w / 2, t.y, t.color, 'TARGET');
            explode(t.x + t.w / 2, t.y + t.h / 2, t.color, 14);
        }

        function flipperTip(f) {
            return {
                x: f.x + Math.cos(f.angle) * f.length,
                y: f.y + Math.sin(f.angle) * f.length
            };
        }

        function recordFlipperHit(f, hitPower, contactT, impulse, contactX, contactY, incomingSpeed) {
            const pct = Math.round(clamp(hitPower, 0, 1) * 100);
            const zone = contactT > 0.78 ? 'TIP' : contactT > 0.42 ? 'MID' : 'BASE';
            const label = pct >= 86
                ? `${zone} RIP ${pct}%`
                : pct >= 64
                    ? `${zone} HARD ${pct}%`
                    : pct >= 38
                        ? `${zone} SHOT ${pct}%`
                        : `${zone} SOFT ${pct}%`;

            state.lastFlipHit = {
                power: clamp(hitPower, 0, 1),
                zone,
                impulse,
                incomingSpeed,
                color: f.color,
                life: 1
            };
            state.hitMeterTimer = 72;
            spawnText(label, contactX, contactY - 22, f.color);
        }

        function checkFlipperCollision(f, dt) {
            const tip = flipperTip(f);
            const dx = tip.x - f.x;
            const dy = tip.y - f.y;
            const segLen = Math.hypot(dx, dy);
            const lenSq = dx * dx + dy * dy;
            if (lenSq <= 0.001 || segLen <= 0.001) return;

            const axisX = dx / segLen;
            const axisY = dy / segLen;
            const t = clamp(((ball.x - f.x) * dx + (ball.y - f.y) * dy) / lenSq, 0, 1);
            const cx = f.x + dx * t;
            const cy = f.y + dy * t;
            let nx = ball.x - cx;
            let ny = ball.y - cy;
            let dist = length(nx, ny);
            const contactRadius = ball.r + f.width * 0.5;

            if (dist >= contactRadius) {
                if (ball.heldByFlipper === f.side) ball.heldByFlipper = '';
                return;
            }

            if (dist < 0.001) {
                nx = f.side === 'left' ? 0.35 : -0.35;
                ny = -0.94;
                dist = 1;
            } else {
                nx /= dist;
                ny /= dist;
            }

            const penetration = contactRadius - dist + CFG.collisionSlop;
            ball.x += nx * penetration;
            ball.y += ny * penetration;

            const omega = ((f.angle - f.prevAngle) / (dt || 1)) * 1.15;
            const contactArmX = cx - f.x;
            const contactArmY = cy - f.y;
            const contactDistance = Math.hypot(contactArmX, contactArmY);
            const vfx = -omega * contactArmY;
            const vfy = omega * contactArmX;

            const vrx = ball.vx - vfx;
            const vry = ball.vy - vfy;
            const vrn = vrx * nx + vry * ny;
            const incomingSpeed = length(vrx, vry);
            const isSwingingUp = (f.side === 'left' && omega < -0.02) || (f.side === 'right' && omega > 0.02);
            const isRaised = Math.abs(f.angle - f.up) < 0.12;
            const isCatchable = f.pressed && isRaised && !isSwingingUp && incomingSpeed <= CFG.flipperCatchSpeed;

            if (isCatchable) {
                const tangentVelocity = ball.vx * axisX + ball.vy * axisY;
                const normalVelocity = ball.vx * nx + ball.vy * ny;
                const holdFriction = t < 0.62 ? 0.74 : CFG.flipperHoldFriction;
                const settledTangentVelocity = tangentVelocity * Math.pow(holdFriction, dt);
                const tangentDelta = settledTangentVelocity - tangentVelocity;

                ball.vx += tangentDelta * axisX;
                ball.vy += tangentDelta * axisY;

                if (normalVelocity < 0.6) {
                    ball.vx -= normalVelocity * nx;
                    ball.vy -= normalVelocity * ny;
                }

                // A tiny downhill component lets the ball roll naturally toward the flipper base,
                // while the damping makes it possible to trap/cradle the ball instead of bouncing it away.
                ball.vx += axisX * axisY * CFG.flipperCradleGravity * dt;
                ball.vy += axisY * axisY * CFG.flipperCradleGravity * dt;
                ball.spin *= Math.pow(0.90, dt);
                ball.heldByFlipper = f.side;
                return;
            }

            if (vrn < 0) {
                const tipFactor = Math.pow(t, 1.55);
                const baseDamping = 0.48 + tipFactor * 0.72;
                const e = isSwingingUp ? 0.48 + tipFactor * 0.28 : 0.18;
                const j = -(1 + e) * vrn * baseDamping;

                ball.vx += j * nx;
                ball.vy += j * ny;

                if (isSwingingUp) {
                    const flipperSurfaceSpeed = Math.abs(omega) * contactDistance;
                    const hitPower = clamp(
                        (flipperSurfaceSpeed * 0.038) +
                        (incomingSpeed * 0.026) +
                        (tipFactor * 0.48),
                        0.12,
                        1
                    );
                    const shotImpulse = (
                        CFG.flipperShotBase +
                        CFG.flipperShotTipBonus * tipFactor +
                        incomingSpeed * CFG.flipperShotSpeedBonus
                    ) * (0.58 + hitPower * 0.58);

                    ball.vx += nx * shotImpulse + vfx * CFG.flipperShotSwingBonus;
                    ball.vy += ny * shotImpulse + vfy * CFG.flipperShotSwingBonus;

                    // Tip hits get a sharper cross-table launch; base hits stay intentionally softer.
                    if (t > 0.68) {
                        const crossTable = f.side === 'left' ? 1 : -1;
                        ball.vx += crossTable * shotImpulse * 0.18 * tipFactor;
                        ball.vy -= shotImpulse * 0.08 * tipFactor;
                    }

                    if (ball.flipperCooldown <= 0) {
                        ball.flipperCooldown = 3;
                        state.screenShake = Math.max(state.screenShake, clamp(2 + hitPower * 6, 0, 8));
                        explode(cx, cy, f.color, Math.floor(clamp(8 + hitPower * 30, 8, 42)));
                        recordFlipperHit(f, hitPower, t, shotImpulse, cx, cy, incomingSpeed);
                    }
                }

                const tx = -ny;
                const ty = nx;
                const vrt = vrx * tx + vry * ty;

                ball.vx -= vrt * (isSwingingUp ? 0.14 : 0.24) * tx;
                ball.vy -= vrt * (isSwingingUp ? 0.14 : 0.24) * ty;
                ball.spin += vrt * (isSwingingUp ? 0.15 : 0.08);
                ball.heldByFlipper = '';
            }
        }

        function updateParticles(dt) {
            for (let i = particles.length - 1; i >= 0; i -= 1) {
                const p = particles[i];
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.vx *= Math.pow(0.985, dt);
                p.vy *= Math.pow(0.985, dt);
                p.life -= p.decay * dt;
                if (p.life <= 0) particles.splice(i, 1);
            }

            for (let i = floatingText.length - 1; i >= 0; i -= 1) {
                const ft = floatingText[i];
                ft.y += ft.vy * dt;
                ft.life -= 0.018 * dt;
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
            drawWalls();
            drawLoopObstacle();
            drawRollovers();
            drawTargets();
            drawBumpers();
            drawShooterLane();
            drawFlipper(leftFlipper);
            drawFlipper(rightFlipper);
            drawBall();
            drawPlungerMeter();
            drawFlipperHitMeter();

            ctx.restore();
            drawParticles(shakeX, shakeY);
        }

        function drawBackground() {
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, '#09091a');
            grad.addColorStop(0.48, '#070915');
            grad.addColorStop(1, '#03040a');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            const t = Date.now() * 0.001;
            ctx.save();
            ctx.strokeStyle = 'rgba(0,255,255,0.05)';
            ctx.lineWidth = 1;
            for (let y = 38; y < H; y += 28) {
                const wave = Math.sin(y * 0.02 + t) * 8;
                ctx.beginPath();
                ctx.moveTo(18, y + wave);
                ctx.lineTo(W - 18, y + wave);
                ctx.stroke();
            }
            for (let x = 34; x < W; x += 28) {
                const wave = Math.sin(x * 0.04 + t) * 10;
                ctx.beginPath();
                ctx.moveTo(x + wave, 34);
                ctx.lineTo(x + wave, H - 30);
                ctx.stroke();
            }
            ctx.restore();
        }

        function drawPlayfieldArt() {
            ctx.save();
            ctx.globalAlpha = 0.82;
            glowStroke(COLORS.blue, 2, 12);
            roundRect(42, 46, 316, 590, 26, false, true);
            ctx.restore();

            ctx.save();
            ctx.textAlign = 'center';
            ctx.font = '900 28px Inter, system-ui, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.05)';
            ctx.fillText('SIGNAL', 200, 444);
            ctx.fillText('SHARE', 200, 476);
            ctx.restore();
        }

        function glowStroke(color, width, blur) {
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.shadowColor = color;
            ctx.shadowBlur = blur;
        }

        function roundRect(x, y, w, h, r, fill = true, stroke = false) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
            if (fill) ctx.fill();
            if (stroke) ctx.stroke();
        }

        function drawWalls() {
            walls.forEach((w) => {
                ctx.save();
                const pulse = w.pulse || (w.loopRail ? loop.pulse * 0.75 : 0);
                const color = w.color || COLORS.rail;
                glowStroke(color, (w.thick || 3) + pulse * 4, 10 + pulse * 15);
                if (pulse > 0.95) {
                    ctx.shadowColor = '#ffffff';
                    ctx.strokeStyle = '#ffffff';
                }
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(w.x1, w.y1);
                ctx.lineTo(w.x2, w.y2);
                ctx.stroke();
                ctx.restore();
            });
        }

        function drawLoopObstacle() {
            const time = Date.now() * 0.004;
            ctx.save();
            ctx.globalAlpha = 0.9;

            const trackGrad = ctx.createRadialGradient(loop.cx, loop.cy, loop.innerR, loop.cx, loop.cy, loop.outerR + 12);
            trackGrad.addColorStop(0, 'rgba(255,0,255,0.025)');
            trackGrad.addColorStop(0.55, 'rgba(255,215,0,0.08)');
            trackGrad.addColorStop(1, 'rgba(0,255,255,0.035)');
            ctx.fillStyle = trackGrad;
            ctx.beginPath();
            ctx.arc(loop.cx, loop.cy, loop.outerR - 2, 0, Math.PI * 2);
            ctx.arc(loop.cx, loop.cy, loop.innerR + 2, Math.PI * 2, 0, true);
            ctx.fill();

            ctx.strokeStyle = `rgba(255, 215, 0, ${0.22 + loop.pulse * 0.28})`;
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 9]);
            ctx.lineDashOffset = -time * 8;
            ctx.beginPath();
            ctx.arc(loop.cx, loop.cy, loop.midR, 1.95, Math.PI * 2 + 1.05);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '950 12px Inter, system-ui, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.68)';
            ctx.shadowColor = loop.color;
            ctx.shadowBlur = 10 + loop.pulse * 18;
            ctx.fillText('LOOPTY', loop.cx, loop.cy - 5);
            ctx.fillText('LOOP', loop.cx, loop.cy + 11);

            loop.gates.forEach((gate) => {
                const gx = loop.cx + Math.cos(gate.angle) * loop.midR;
                const gy = loop.cy + Math.sin(gate.angle) * loop.midR;
                const color = gate.lit ? COLORS.green : loop.color;
                ctx.save();
                ctx.shadowColor = color;
                ctx.shadowBlur = gate.lit ? 18 : 9;
                ctx.fillStyle = gate.lit ? 'rgba(0,255,157,0.92)' : 'rgba(255,215,0,0.28)';
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(gx, gy, gate.lit ? 7.5 : 6.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            });

            ctx.restore();
        }

        function drawRollovers() {
            rollovers.forEach((r) => {
                ctx.save();
                const color = r.lit ? COLORS.gold : 'rgba(255,255,255,0.26)';
                ctx.shadowColor = color;
                ctx.shadowBlur = r.lit ? 18 : 5;
                ctx.fillStyle = r.lit ? 'rgba(255,215,0,0.92)' : 'rgba(255,255,255,0.08)';
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.fillStyle = r.lit ? '#160011' : 'rgba(255,255,255,0.7)';
                ctx.font = '900 11px Inter, system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(r.label, r.x, r.y + 0.5);
                ctx.restore();
            });
        }

        function drawTargets() {
            targets.forEach((t) => {
                ctx.save();
                ctx.shadowColor = t.color;
                ctx.shadowBlur = t.lit ? 15 : 7;
                ctx.fillStyle = t.lit ? t.color : 'rgba(255,255,255,0.12)';
                ctx.strokeStyle = t.color;
                ctx.lineWidth = 2;
                roundRect(t.x, t.y, t.w, t.h, 4, true, true);
                ctx.restore();
            });
        }

        function drawBumpers() {
            bumpers.forEach((b) => {
                const pulse = b.pulse;
                ctx.save();
                ctx.shadowColor = b.color;
                ctx.shadowBlur = 18 + pulse * 24;
                ctx.fillStyle = b.color;
                ctx.globalAlpha = 0.2 + pulse * 0.18;
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.r + 15 + pulse * 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;

                const grad = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.38, 3, b.x, b.y, b.r);
                grad.addColorStop(0, '#fff');
                grad.addColorStop(0.38, b.color);
                grad.addColorStop(1, '#15001f');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.r + pulse * 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.lineWidth = 4;
                ctx.strokeStyle = 'rgba(255,255,255,0.75)';
                ctx.stroke();
                ctx.restore();
            });
        }

        function drawShooterLane() {
            ctx.save();
            ctx.strokeStyle = 'rgba(255,215,0,0.22)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 10]);
            ctx.beginPath();
            ctx.moveTo(385, 140);
            ctx.lineTo(385, 660);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Lane highlight
            const grad = ctx.createLinearGradient(372, 600, 398, 688);
            grad.addColorStop(0, 'rgba(255,215,0,0)');
            grad.addColorStop(1, 'rgba(255,215,0,0.12)');
            ctx.fillStyle = grad;
            ctx.fillRect(372, 140, 26, 548);

            // Ready indicator
            if (state.launchReady && ball.inShooter) {
                ctx.fillStyle = 'rgba(0, 255, 255, 0.15)';
                ctx.beginPath();
                ctx.arc(385, 628, 15, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        function drawFlipper(f) {
            const tip = flipperTip(f);
            ctx.save();
            ctx.lineCap = 'round';
            ctx.shadowColor = f.color;
            ctx.shadowBlur = f.pressed ? 22 : 12;
            ctx.strokeStyle = f.color;
            ctx.lineWidth = f.width;
            ctx.beginPath();
            ctx.moveTo(f.x, f.y);
            ctx.lineTo(tip.x, tip.y);
            ctx.stroke();

            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(255,255,255,0.72)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(f.x, f.y);
            ctx.lineTo(tip.x, tip.y);
            ctx.stroke();

            ctx.fillStyle = '#fff';
            ctx.shadowColor = f.color;
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(f.x, f.y, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        function drawBall() {
            // Draw Trail
            if (ball.trail.length > 1) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(ball.trail[0].x, ball.trail[0].y);
                for (let i = 1; i < ball.trail.length; i++) {
                    ctx.lineTo(ball.trail[i].x, ball.trail[i].y);
                }
                const speed = length(ball.vx, ball.vy);
                ctx.strokeStyle = `rgba(0, 255, 255, ${Math.min(0.8, speed * 0.03)})`;
                ctx.lineWidth = ball.r * 1.5;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.shadowColor = COLORS.cyan;
                ctx.shadowBlur = 12;
                ctx.stroke();
                ctx.restore();
            }

            ctx.save();
            ctx.translate(ball.x, ball.y);
            ctx.rotate(ball.spin);
            ctx.shadowColor = '#00ffff';
            ctx.shadowBlur = 18;
            const grad = ctx.createRadialGradient(-3, -3, 1, 0, 0, ball.r + 1);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.3, '#88ffff');
            grad.addColorStop(0.8, '#0088ff');
            grad.addColorStop(1, '#000033');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(0, 0, ball.r, 0, Math.PI * 2);
            ctx.fill();
            
            // metallic reflection lines
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, ball.r * 0.6, Math.PI * 1.1, Math.PI * 1.4);
            ctx.stroke();
            
            ctx.restore();
        }

        function drawPlungerMeter() {
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            roundRect(358, 660, 16, 24, 6, true, false);
            const h = 82 * state.launchCharge;
            ctx.fillStyle = COLORS.gold;
            ctx.shadowColor = COLORS.gold;
            ctx.shadowBlur = 12;
            roundRect(386, 636 - h, 7, h + 14, 5, true, false);
            ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font = '800 8px Inter, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.save();
            ctx.translate(390, 626);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText('PLUNGER', 0, 0);
            ctx.restore();
            ctx.restore();
        }

        function drawFlipperHitMeter() {
            if (!state.lastFlipHit || state.hitMeterTimer <= 0) return;
            const hit = state.lastFlipHit;
            const alpha = clamp(state.hitMeterTimer / 72, 0, 1);
            const meterW = 124;
            const meterH = 10;
            const x = 138;
            const y = 654;
            const fillW = meterW * clamp(hit.power, 0, 1);
            const label = `${hit.zone} FLIP POWER ${Math.round(hit.power * 100)}%`;

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = 'rgba(0,0,0,0.34)';
            roundRect(x - 10, y - 24, meterW + 20, 42, 12, true, false);
            ctx.strokeStyle = 'rgba(255,255,255,0.22)';
            ctx.lineWidth = 1;
            roundRect(x - 10, y - 24, meterW + 20, 42, 12, false, true);

            ctx.font = '900 9px Inter, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(255,255,255,0.82)';
            ctx.shadowColor = hit.color;
            ctx.shadowBlur = 8;
            ctx.fillText(label, x + meterW / 2, y - 9);

            ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            roundRect(x, y, meterW, meterH, 5, true, false);
            ctx.fillStyle = hit.color;
            ctx.shadowColor = hit.color;
            ctx.shadowBlur = 12;
            roundRect(x, y, fillW, meterH, 5, true, false);
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
                pCtx.shadowBlur = 8;
                pCtx.beginPath();
                pCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                pCtx.fill();
            });

            floatingText.forEach((ft) => {
                pCtx.globalAlpha = clamp(ft.life, 0, 1);
                pCtx.fillStyle = ft.color;
                pCtx.shadowColor = ft.color;
                pCtx.shadowBlur = 14;
                pCtx.font = `900 ${14 + (1 - ft.life) * 8}px Inter, system-ui, sans-serif`;
                pCtx.textAlign = 'center';
                pCtx.fillText(ft.text, ft.x, ft.y);
            });
            pCtx.restore();
            pCtx.globalAlpha = 1;
        }

        function frame(now) {
            const rawDt = state.lastTime ? (now - state.lastTime) / 16.6667 : 1;
            const dt = clamp(rawDt, 0.5, 2);
            state.lastTime = now;
            update(dt);
            draw();
            requestAnimationFrame(frame);
        }

        requestAnimationFrame(frame);
