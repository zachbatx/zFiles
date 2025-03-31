document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const player = {
        x: canvas.width / 2 - 20,
        y: canvas.height - 50,
        width: 40,
        height: 20,
        speed: 5,
        color: 'lime'
    };

    const invaders = [];
    const invaderRowCount = 3;
    const invaderColumnCount = 6;
    const invaderWidth = 30;
    const invaderHeight = 20;
    const invaderPadding = 10;
    const invaderOffsetTop = 30;
    const invaderOffsetLeft = 30;

    for (let c = 0; c < invaderColumnCount; c++) {
        invaders[c] = [];
        for (let r = 0; r < invaderRowCount; r++) {
            invaders[c][r] = {
                x: 0,
                y: 0,
                status: 1 // 1 = alive, 0 = dead
            };
        }
    }

    let playerLaser = null;
    let score = 0;
    let rightPressed = false;
    let leftPressed = false;

    document.addEventListener('keydown', keyDownHandler, false);
    document.addEventListener('keyup', keyUpHandler, false);
    canvas.addEventListener('click', shootLaser, false); // Shoot on click for mobile

    function keyDownHandler(e) {
        if (e.key === 'Right' || e.key === 'ArrowRight') {
            rightPressed = true;
        } else if (e.key === 'Left' || e.key === 'ArrowLeft') {
            leftPressed = true;
        } else if (e.code === 'Space') { // Spacebar for desktop shooting
            shootLaser();
        }
    }

    function keyUpHandler(e) {
        if (e.key === 'Right' || e.key === 'ArrowRight') {
            rightPressed = false;
        } else if (e.key === 'Left' || e.key === 'ArrowLeft') {
            leftPressed = false;
        }
    }

    function shootLaser() {
        if (!playerLaser) { // Only one laser at a time for simplicity
            playerLaser = {
                x: player.x + player.width / 2,
                y: player.y,
                width: 5,
                height: 15,
                speed: -7,
                color: 'red'
            };
        }
    }

    function collisionDetection() {
        if (!playerLaser) return;

        for (let c = 0; c < invaderColumnCount; c++) {
            for (let r = 0; r < invaderRowCount; r++) {
                const invader = invaders[c][r];
                if (invader.status === 1) {
                    if (playerLaser.x > invader.x && playerLaser.x < invader.x + invaderWidth &&
                        playerLaser.y > invader.y && playerLaser.y < invader.y + invaderHeight) {
                        invader.status = 0;
                        playerLaser = null; // Laser disappears on hit
                        score++;
                    }
                }
            }
        }
    }

    function drawPlayer() {
        ctx.fillStyle = player.color;
        ctx.fillRect(player.x, player.y, player.width, player.height);
    }

    function drawInvaders() {
        for (let c = 0; c < invaderColumnCount; c++) {
            for (let r = 0; r < invaderRowCount; r++) {
                if (invaders[c][r].status === 1) {
                    const invaderX = (c * (invaderWidth + invaderPadding)) + invaderOffsetLeft;
                    const invaderY = (r * (invaderHeight + invaderPadding)) + invaderOffsetTop;
                    invaders[c][r].x = invaderX;
                    invaders[c][r].y = invaderY;
                    ctx.fillStyle = 'yellow';
                    ctx.fillRect(invaderX, invaderY, invaderWidth, invaderHeight);
                }
            }
        }
    }

    function drawLaser() {
        if (playerLaser) {
            ctx.fillStyle = playerLaser.color;
            ctx.fillRect(playerLaser.x - playerLaser.width / 2, playerLaser.y, playerLaser.width, playerLaser.height);
        }
    }

    function drawScore() {
        ctx.font = '16px Arial';
        ctx.fillStyle = 'white';
        ctx.fillText('Score: ' + score, 8, 20);
    }

    function update() {
        if (rightPressed && player.x < canvas.width - player.width) {
            player.x += player.speed;
        } else if (leftPressed && player.x > 0) {
            player.x -= player.speed;
        }

        if (playerLaser) {
            playerLaser.y += playerLaser.speed;
            if (playerLaser.y < 0) {
                playerLaser = null; // Laser disappears when off-screen
            }
        }

        collisionDetection();
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas each frame
        drawInvaders();
        drawPlayer();
        drawLaser();
        drawScore();
    }

    function gameLoop() {
        update();
        draw();
        requestAnimationFrame(gameLoop);
    }

    // Initialize invaders positions
    drawInvaders(); // Initial draw to position them correctly at start

    gameLoop(); // Start the game loop
});