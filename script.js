document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // --- Game Assets (Basic Shapes as Sprites for POC) ---
    const playerSprite = { color: 'lime', width: 22, height: 16 };
    const invaderSprites = [
        { color: 'yellow', width: 18, height: 14 },
        { color: 'pink', width: 20, height: 14 } // Example of multiple invader types
    ];
    const playerLaserSprite = { color: 'lime', width: 3, height: 10 };
    const invaderLaserSprite = { color: 'red', width: 3, height: 10 };
    const explosionSprite = { color: 'orange', width: 20, height: 20 }; // Basic explosion effect

    // --- Game Sounds (Placeholder - Replace with actual sound loading if you have files) ---
    const sounds = {
        shoot: new Audio(), // Replace with actual sound file path if you have sounds
        invaderShoot: new Audio(),
        explosion: new Audio(),
        playerExplosion: new Audio()
    };
    // You would load sound files here if you had them:
    // sounds.shoot.src = 'shoot.wav'; // Example

    // --- Game Objects ---
    const player = {
        x: canvas.width / 2 - playerSprite.width / 2,
        y: canvas.height - 60,
        sprite: playerSprite,
        speed: 4,
        lives: 3,
        isAlive: true,
        lastHitTime: 0 // To prevent rapid hits
    };

    const invaders = [];
    const invaderRowCount = 5;
    const invaderColumnCount = 10;
    const invaderGridSpacingX = 35;
    const invaderGridSpacingY = 30;
    const invaderOffsetTop = 50;
    const invaderOffsetLeft = 50;
    let invaderDirection = 1; // 1 = right, -1 = left
    let invaderMoveTimer = 0;
    const invaderMoveInterval = 1000; // Move invaders every 1 second
    let invaderShootTimer = 0;
    const invaderShootInterval = 2000; // Invaders shoot every 2 seconds (randomly)
    let invadersAliveCount = invaderRowCount * invaderColumnCount;

    function createInvaders() {
        for (let row = 0; row < invaderRowCount; row++) {
            for (let col = 0; col < invaderColumnCount; col++) {
                invaders.push({
                    x: col * invaderGridSpacingX + invaderOffsetLeft,
                    y: row * invaderGridSpacingY + invaderOffsetTop,
                    sprite: invaderSprites[row % invaderSprites.length], // Cycle through invader sprites
                    status: 1, // 1 = alive, 0 = dead
                    isShooting: false // Flag for shooting animation later
                });
            }
        }
    }
    createInvaders();

    let playerLaser = null;
    const invaderLasers = [];
    let score = 0;
    let rightPressed = false;
    let leftPressed = false;
    let gameRunning = true;
    let gameOver = false;
    let gameWin = false;

    document.addEventListener('keydown', keyDownHandler, false);
    document.addEventListener('keyup', keyUpHandler, false);
    canvas.addEventListener('click', shootPlayerLaser, false); // Shoot on click for mobile

    function keyDownHandler(e) {
        if (e.key === 'Right' || e.key === 'ArrowRight') {
            rightPressed = true;
        } else if (e.key === 'Left' || e.key === 'ArrowLeft') {
            leftPressed = true;
        } else if (e.code === 'Space') {
            shootPlayerLaser();
        }
    }

    function keyUpHandler(e) {
        if (e.key === 'Right' || e.key === 'ArrowRight') {
            rightPressed = false;
        } else if (e.key === 'Left' || e.key === 'ArrowLeft') {
            leftPressed = false;
        }
    }

    function shootPlayerLaser() {
        if (!playerLaser && player.isAlive) {
            playerLaser = {
                x: player.x + player.sprite.width / 2 - playerLaserSprite.width / 2,
                y: player.y,
                sprite: playerLaserSprite,
                speed: -8
            };
            // sounds.shoot.play(); // Play sound when shooting - uncomment if you have sounds
        }
    }

    function invaderShootLaser(invader) {
        if (invader.status === 1) {
            invaderLasers.push({
                x: invader.x + invader.sprite.width / 2 - invaderLaserSprite.width / 2,
                y: invader.y + invader.sprite.height,
                sprite: invaderLaserSprite,
                speed: 4
            });
            // sounds.invaderShoot.play(); // Play sound for invader shooting - uncomment if you have sounds
        }
    }

    function checkCollisions() {
        // Player Laser vs. Invaders
        if (playerLaser) {
            for (let invader of invaders) {
                if (invader.status === 1) {
                    if (playerLaser.x < invader.x + invader.sprite.width &&
                        playerLaser.x + playerLaser.sprite.width > invader.x &&
                        playerLaser.y < invader.y + invader.sprite.height &&
                        playerLaser.y + playerLaser.sprite.height > invader.y) {
                        invader.status = 0;
                        playerLaser = null;
                        score += 100;
                        invadersAliveCount--;
                        // sounds.explosion.play(); // Play explosion sound - uncomment if you have sounds
                        if (invadersAliveCount === 0) {
                            gameWin = true;
                            gameRunning = false;
                        }
                        break; // Only hit one invader per laser
                    }
                }
            }
        }

        // Invader Lasers vs. Player
        for (let i = invaderLasers.length - 1; i >= 0; i--) {
            const laser = invaderLasers[i];
            if (player.isAlive && laser.x < player.x + player.sprite.width &&
                laser.x + laser.sprite.width > player.x &&
                laser.y < player.y + player.sprite.height &&
                laser.y + laser.sprite.height > player.y) {

                invaderLasers.splice(i, 1); // Remove laser
                let currentTime = new Date().getTime();
                if (currentTime - player.lastHitTime > 1000) { // 1 second invulnerability
                    player.lives--;
                    player.lastHitTime = currentTime;
                    // sounds.playerExplosion.play(); // Player explosion sound - uncomment if you have sounds
                    if (player.lives <= 0) {
                        player.isAlive = false;
                        gameRunning = false;
                        gameOver = true;
                    }
                }

            } else if (laser.y > canvas.height) {
                invaderLasers.splice(i, 1); // Remove laser if off-screen
            }
        }
    }

    function updateInvaders(deltaTime) {
        invaderMoveTimer += deltaTime;
        if (invaderMoveTimer > invaderMoveInterval) {
            invaderMoveTimer = 0;
            let reachedEdge = false;
            for (let invader of invaders) {
                if (invader.status === 1) {
                    invader.x += 20 * invaderDirection;
                    if (invaderDirection === 1 && invader.x + invader.sprite.width > canvas.width - 20) {
                        reachedEdge = true;
                    } else if (invaderDirection === -1 && invader.x < 20) {
                        reachedEdge = true;
                    }
                }
            }
            if (reachedEdge) {
                invaderDirection *= -1;
                for (let invader of invaders) {
                    if (invader.status === 1) {
                        invader.y += 20; // Move down
                    }
                }
            }
        }

        invaderShootTimer += deltaTime;
        if (invaderShootTimer > invaderShootInterval) {
            invaderShootTimer = 0;
            const aliveInvaders = invaders.filter(invader => invader.status === 1);
            if (aliveInvaders.length > 0) {
                const shootingInvader = aliveInvaders[Math.floor(Math.random() * aliveInvaders.length)];
                invaderShootLaser(shootingInvader);
            }
        }
    }

    function updateLasers() {
        if (playerLaser) {
            playerLaser.y += playerLaser.speed;
            if (playerLaser.y < 0) {
                playerLaser = null;
            }
        }
        for (let laser of invaderLasers) {
            laser.y += laser.speed;
        }
        // Clean up off-screen lasers (already done in collision check for invader lasers)
    }

    function update(deltaTime) {
        if (!gameRunning) return;

        if (rightPressed && player.x < canvas.width - player.sprite.width) {
            player.x += player.speed;
        } else if (leftPressed && player.x > 0) {
            player.x -= player.speed;
        }

        updateInvaders(deltaTime);
        updateLasers();
        checkCollisions();
    }

    function drawPlayer() {
        if (player.isAlive) {
            ctx.fillStyle = player.sprite.color;
            ctx.fillRect(player.x, player.y, player.sprite.width, player.sprite.height);
        } else {
            // Basic player explosion effect when dead
            ctx.fillStyle = explosionSprite.color;
            ctx.fillRect(player.x - explosionSprite.width/2, player.y - explosionSprite.height/2, explosionSprite.width, explosionSprite.height);
        }
    }

    function drawInvaders() {
        for (let invader of invaders) {
            if (invader.status === 1) {
                ctx.fillStyle = invader.sprite.color;
                ctx.fillRect(invader.x, invader.y, invader.sprite.width, invader.sprite.height);
            } else if (invader.status === 0) {
                // Basic invader explosion effect
                ctx.fillStyle = explosionSprite.color;
                ctx.fillRect(invader.x, invader.y, explosionSprite.width, explosionSprite.height);
            }
        }
    }

    function drawLasers() {
        if (playerLaser) {
            ctx.fillStyle = playerLaser.sprite.color;
            ctx.fillRect(playerLaser.x, playerLaser.y, playerLaser.sprite.width, playerLaser.sprite.height);
        }
        for (let laser of invaderLasers) {
            ctx.fillStyle = laser.sprite.color;
            ctx.fillRect(laser.x, laser.y, laser.sprite.width, laser.sprite.height);
        }
    }

    function drawScore() {
        ctx.font = '16px 'Press Start 2P''; // Retro font - you might need to include it in CSS or use a web font
        ctx.fillStyle = 'white';
        ctx.fillText('Score: ' + score, 8, 20);
        ctx.fillText('Lives: ' + player.lives, canvas.width - 80, 20); // Display lives
    }

    function drawGameOver() {
        ctx.font = '30px 'Press Start 2P'';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText('Game Over', canvas.width / 2, canvas.height / 2);
        ctx.font = '16px 'Press Start 2P'';
        ctx.fillText('Press Space to Restart', canvas.width / 2, canvas.height / 2 + 50);
        ctx.textAlign = 'left'; // Reset text alignment
    }

    function drawGameWin() {
        ctx.font = '30px 'Press Start 2P'';
        ctx.fillStyle = 'lime';
        ctx.textAlign = 'center';
        ctx.fillText('You Win!', canvas.width / 2, canvas.height / 2);
        ctx.font = '16px 'Press Start 2P'';
        ctx.fillText('Press Space to Restart', canvas.width / 2, canvas.height / 2 + 50);
        ctx.textAlign = 'left'; // Reset text alignment
    }


    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000'; // Black background
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        drawInvaders();
        drawPlayer();
        drawLasers();
        drawScore();

        if (gameOver) {
            drawGameOver();
        } else if (gameWin) {
            drawGameWin();
        }
    }

    let lastTime = 0;
    function gameLoop(timeStamp) {
        let deltaTime = timeStamp - lastTime;
        lastTime = timeStamp;

        update(deltaTime);
        draw();
        requestAnimationFrame(gameLoop);
    }

    // Restart Game Function (call when game over or win and space is pressed)
    function restartGame() {
        player.lives = 3;
        player.isAlive = true;
        gameOver = false;
        gameWin = false;
        gameRunning = true;
        score = 0;
        invaders.length = 0; // Clear existing invaders
        createInvaders();      // Recreate invaders
        invadersAliveCount = invaderRowCount * invaderColumnCount;
        playerLaser = null;
        invaderLasers.length = 0;
        invaderDirection = 1;
        invaderMoveTimer = 0;
        invaderShootTimer = 0;
        lastTime = 0; // Reset lastTime for smooth deltaTime calculation at start
        requestAnimationFrame(gameLoop); // Start game loop again
    }

    document.addEventListener('keydown', (e) => {
        if ((gameOver || gameWin) && e.code === 'Space') {
            restartGame();
        }
    });


    // Initial Game Start
    restartGame(); // Start the game for the first time
});