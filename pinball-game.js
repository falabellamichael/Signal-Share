        window.__NEON_PINBALL_BUILD = 'revamped-functional-v1';
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
            gravity: 0.28,
            friction: 0.995,
            restitution: 0.85,
            ballRadius: 8.8,
            maxSpeed: 24,
            bumperKick: 12.8,
            flipperKick: 10.5,
            flipperSnap: 0.38,
            tableTilt: 0.015,
            collisionSlop: 0.15,
            substepsMin: 4,
            substepsMax: 12,
            slingshotForce: 14.5
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
            messageTimer: 0
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
            trail: []
        };

        const leftFlipper = {
            side: 'left',
            x: 125,
            y: 626,
            length: 65,
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
            length: 65,
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
            // Outer boundaries
            { x1: 20, y1: 688, x2: 20, y2: 120, color: COLORS.cyan, thick: 6 }, // Left wall
            { x1: 398, y1: 688, x2: 398, y2: 100, color: COLORS.cyan, thick: 6 }, // Right outer wall
            { x1: 0, y1: 688, x2: 400, y2: 688, color: COLORS.magenta, thick: 8 }, // Bottom drain

            // Shooter Lane inner wall
            { x1: 372, y1: 688, x2: 372, y2: 140, color: COLORS.cyan, thick: 5 },

            // Top curves (replaces diagonal walls)
            ...createArc(100, 120, 80, Math.PI, Math.PI * 1.5, 12, COLORS.cyan, 5), // Top-left curve
            { x1: 100, y1: 40, x2: 300, y2: 40, color: COLORS.cyan, thick: 5 }, // Top flat
            ...createArc(300, 140, 98, Math.PI * 1.5, Math.PI * 2, 12, COLORS.cyan, 5), // Top-right curve

            // Slingshots (triangular bumpers above flippers)
            { x1: 50, y1: 540, x2: 100, y2: 590, color: COLORS.green, thick: 6, slingshot: true },
            { x1: 100, y1: 590, x2: 50, y2: 590, color: COLORS.green, thick: 4 },
            { x1: 50, y1: 590, x2: 50, y2: 540, color: COLORS.green, thick: 4 },

            { x1: 350, y1: 540, x2: 300, y2: 590, color: COLORS.green, thick: 6, slingshot: true },
            { x1: 300, y1: 590, x2: 350, y2: 590, color: COLORS.green, thick: 4 },
            { x1: 350, y1: 590, x2: 350, y2: 540, color: COLORS.green, thick: 4 },

            // Flipper guide walls
            { x1: 20, y1: 570, x2: 100, y2: 615, color: COLORS.blue, thick: 4 },
            { x1: 380, y1: 570, x2: 300, y2: 615, color: COLORS.blue, thick: 4 }
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
            ui.overlayTitle.innerHTML = `GAME OVER<br><span style="font-size:0.34em;color:var(--neon-cyan);letter-spacing:0;">${formatScore(state.score)}</span>`;
            ui.overlaySub.textContent = `Best: ${formatScore(state.highScore)} â€¢ Press Start Session to replay`;
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
            ball.vx = -1.2 - power * 0.8;
            ball.vy = -18.5 - power * 9.5;
            ball.spin = -0.25;
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
            updateParticles(dt);
            
            // Update ball trail
            ball.trail.push({ x: ball.x, y: ball.y });
            if (ball.trail.length > 8) ball.trail.shift();

            state.screenShake = Math.max(0, state.screenShake - 0.45 * dt);
            if (state.messageTimer > 0) state.messageTimer -= dt;
            if (state.nudgeCooldown > 0) state.nudgeCooldown -= dt;
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
            if (ball.x > 368 && ball.y > 500) {
                if (!ball.inShooter) {
                    ball.inShooter = true;
                }
                // Always ready to launch if ball is essentially stopped in the lane
                if (Math.abs(ball.vy) < 0.2 && Math.abs(ball.vx) < 0.2) {
                    state.launchReady = true;
                }
            } else if (ball.y < 120) {
                if (ball.inShooter) {
                    ball.inShooter = false;
                    state.launchReady = false; 
                    // Give a significant horizontal boost when exiting to ensure it clears the lane
                    if (ball.vy < 0) ball.vx -= 2.8;
                }
            }

            for (const wall of walls) checkSegmentCollision(wall, CFG.restitution);
            for (const bumper of bumpers) checkBumperCollision(bumper);
            for (const rollover of rollovers) checkRollover(rollover);
            for (const target of targets) checkTargetCollision(target);
            checkFlipperCollision(leftFlipper, dt);
            checkFlipperCollision(rightFlipper, dt);

            // Explicit floor boundary constraint
            const floorY = 688;
            const floorCollideRadius = ball.r + 4;
            if (ball.y + floorCollideRadius > floorY) {
                ball.y = floorY - floorCollideRadius;
                if (ball.vy > 0) {
                    ball.vy *= -CFG.restitution;
                    ball.vx *= 0.98;
                }
            }

            if (!ball.inShooter && ball.y > 710) {
                loseBall();
                return;
            }

            if (ball.inShooter) {
                ball.x = clamp(ball.x, 379, 393);
                if (ball.y > 642) {
                    ball.y = 642;
                    if (ball.vy > 0) ball.vy *= -0.25;
                }
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

        function checkFlipperCollision(f, dt) {
            const tip = flipperTip(f);
            const dx = tip.x - f.x;
            const dy = tip.y - f.y;
            const lenSq = dx * dx + dy * dy;
            if (lenSq <= 0.001) return;
            const t = clamp(((ball.x - f.x) * dx + (ball.y - f.y) * dy) / lenSq, 0, 1);
            const cx = f.x + dx * t;
            const cy = f.y + dy * t;
            let nx = ball.x - cx;
            let ny = ball.y - cy;
            let dist = length(nx, ny);
            const contactRadius = ball.r + f.width * 0.5;

            if (dist >= contactRadius) return;

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
            const vfx = -omega * (cy - f.y);
            const vfy = omega * (cx - f.x);

            const vrx = ball.vx - vfx;
            const vry = ball.vy - vfy;
            const vrn = vrx * nx + vry * ny;

            if (vrn < 0) {
                const isHitting = (f.side === 'left' && omega < -0.02) || (f.side === 'right' && omega > 0.02);
                const e = isHitting ? 0.65 : 0.35;
                
                const j = -(1 + e) * vrn;

                ball.vx += j * nx;
                ball.vy += j * ny;

                // Horizontal boost for flipper tips
                const tipFactor = t; // t is 0..1 from base to tip
                if (isHitting) {
                    ball.vx += dx * 0.12 * tipFactor;
                }

                const tx = -ny;
                const ty = nx;
                const vrt = vrx * tx + vry * ty;
                
                ball.vx -= vrt * 0.18 * tx;
                ball.vy -= vrt * 0.18 * ty;
                ball.spin += vrt * 0.12;

                if (isHitting && ball.flipperCooldown <= 0 && j > 6) {
                    ball.flipperCooldown = 2;
                    state.screenShake = Math.max(state.screenShake, clamp(j * 0.15, 0, 5));
                    explode(cx, cy, f.color, Math.floor(clamp(j * 0.5, 5, 30)));
                }
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

        function drawBackground() {
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, '#09091a');
            grad.addColorStop(0.48, '#070915');
            grad.addColorStop(1, '#03040a');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            ctx.save();
            ctx.strokeStyle = 'rgba(0,255,255,0.035)';
            ctx.lineWidth = 1;
            for (let y = 38; y < H; y += 28) {
                ctx.beginPath();
                ctx.moveTo(18, y);
                ctx.lineTo(W - 18, y + Math.sin(y * 0.02) * 8);
                ctx.stroke();
            }
            for (let x = 34; x < W; x += 28) {
                ctx.beginPath();
                ctx.moveTo(x, 34);
                ctx.lineTo(x + Math.sin(x * 0.04) * 10, H - 30);
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
                const pulse = w.pulse || 0;
                const color = w.color || COLORS.rail;
                glowStroke(color, (w.thick || 3) + pulse * 4, 10 + pulse * 15);
                if (pulse > 0) {
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
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.lineWidth = ball.r * 1.2;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke();
                ctx.restore();
            }

            ctx.save();
            ctx.translate(ball.x, ball.y);
            ctx.rotate(ball.spin);
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 14;
            const grad = ctx.createRadialGradient(-4, -5, 1, 0, 0, ball.r + 2);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.28, '#dff7ff');
            grad.addColorStop(0.74, '#7fb7ff');
            grad.addColorStop(1, '#13244f');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(0, 0, ball.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(0,255,255,0.54)';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(-ball.r * 0.68, 0);
            ctx.lineTo(ball.r * 0.68, 0);
            ctx.moveTo(0, -ball.r * 0.68);
            ctx.lineTo(0, ball.r * 0.68);
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
