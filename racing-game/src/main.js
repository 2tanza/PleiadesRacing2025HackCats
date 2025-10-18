import Phaser from 'phaser';

/**
 * A simple AI Agent that follows a set of waypoints.
 * This version is refactored to output Player-style controls
 * { thrust, angularVelocity }
 * to match the ML-refactored GameScene.update()
 */
class AIAgent {
    constructor(waypoints, acceleration, angularVelocity) {
        this.waypoints = waypoints;
        this.currentWaypointIndex = 0;
        
        // Store the car's physics capabilities
        this.ACCELERATION_FORCE = acceleration;
        this.ANGULAR_VELOCITY = angularVelocity;
    }

/**
     * The main decision-making function.
     * @param {object} state - The current state of the AI car.
     * @param {number} state.x - The car's x position.
     * @param {number} state.y - The car's y position.
     * @param {number} state.rotation - The car's current angle.
     * @param {number[]} state.rayDistances - The car's 5 sensor readings.
     * @returns {object} An action object: { thrust, angularVelocity }
     */
    update(state) {
        // --- Waypoint-following logic ---
        const waypoint = this.waypoints[this.currentWaypointIndex];
        const dx = waypoint.x - state.x;
        const dy = waypoint.y - state.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 75) { 
            this.currentWaypointIndex = (this.currentWaypointIndex + 1) % this.waypoints.length;
        }

        // --- Action Logic ---

        // 1. Find the target angle
        const targetAngle = Math.atan2(dy, dx);
        
        // 2. Find the shortest angle difference
        // angleDiff > 0 means we need to turn Clockwise (Right)
        // angleDiff < 0 means we need to turn Counter-Clockwise (Left)
        const angleDiff = Phaser.Math.Angle.ShortestBetween(state.rotation, targetAngle);
        const absAngleDiff = Math.abs(angleDiff);

        // 3. *** THE CORRECTED STEERING LOGIC ***
        let angularVelocity = 0;
        
        if (angleDiff > 0.03) { 
            // Need to turn CW (Right)
            angularVelocity = this.ANGULAR_VELOCITY;  // POSITIVE velocity
        } else if (angleDiff < -0.03) {
            // Need to turn CCW (Left)
            angularVelocity = -this.ANGULAR_VELOCITY; // NEGATIVE velocity
        }
        
        // 4. *** SIMPLIFIED THRUST LOGIC ***
        let thrust = this.ACCELERATION_FORCE; // Default to accelerating

        // If we have to make a sharp turn (more than ~57 degrees),
        // cut the engine and just focus on steering.
        // This prevents spinning out.
        if (absAngleDiff > 1.0) { 
            thrust = 0; // Coast
        }

        // At the start, absAngleDiff is 1.57, so thrust will be 0,
        // but angularVelocity will be POSITIVE, making it turn correctly to the right.
        // As it turns, absAngleDiff will drop below 1.0, and thrust will kick in.

        return {
            thrust: thrust,
            angularVelocity: angularVelocity
        };
    }
}


class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });

        // Define common constants
        this.MAX_SPEED = 600;
        this.ACCELERATION_FORCE = 0.01;
        this.ANGULAR_VELOCITY = 0.05;
        this.RAY_LENGTH = 150;
    }

    create() {
        this.cameras.main.setBackgroundColor(0x222222);

       // --- Draw Visual Road Surface ---
        const graphics = this.add.graphics();
        
        // 1. Draw the outer road boundary
        graphics.fillStyle(0x333333, 1);
        graphics.fillRect(100, 100, 600, 600); // x, y, width, height

        // 2. "Cut out" the middle with the background color
        graphics.fillStyle(0x222222, 1); // Background color
        graphics.fillRect(200, 200, 400, 400);

        // --- Track & Wall Data (Oval) ---
        const trackData = [
            // Outer Walls
            { x: 400, y: 95,  w: 610, h: 10 },  // Top
            { x: 400, y: 705, w: 610, h: 10 },  // Bottom
            { x: 95,  y: 400, w: 10,  h: 610 },  // Left
            { x: 705, y: 400, w: 10,  h: 610 },  // Right
            
            // Inner Walls
            { x: 400, y: 205, w: 410, h: 10 },  // Inner Top
            { x: 400, y: 595, w: 410, h: 10 },  // Inner Bottom
            { x: 195, y: 400, w: 10,  h: 410 },  // Inner Left
            { x: 605, y: 400, w: 10,  h: 410 }   // Inner Right
        ];

        this.geomWalls = [];
        const wallOptions = { isStatic: true, friction: 0.0, restitution: 0.1, label: 'wall' };
        
        // --- Build Physics and Raycast Walls from Data ---
        trackData.forEach(wall => {
            // 1. Add Matter.js physics body (invisible)
            this.matter.add.rectangle(wall.x, wall.y, wall.w, wall.h, wallOptions);

            // 2. Add Phaser.Geom.Rectangle for raycasting (top-left based)
            this.geomWalls.push(
                new Phaser.Geom.Rectangle(wall.x - wall.w / 2, wall.y - wall.h / 2, wall.w, wall.h)
            );
        });

// --- Player Car (Matter Body) ---
        this.playerCar = this.add.rectangle(650, 250, 30, 20, 0xff0000); // Start pos
        this.matter.add.gameObject(this.playerCar, {
            mass: 10,
            frictionAir: 0.1,
            friction: 0.05,
            restitution: 0.3,
            label: 'playerCar'
        });
        
        this.playerSpeed = 0;
        this.playerAngle = this.playerCar.rotation;
        this.crashCount = 0;

        // --- Ray sensors (Player) ---
        this.rayDistances = [0, 0, 0, 0, 0];
        this.rayGraphics = this.add.graphics();
        
        // --- Ray sensors (AI) ---
        this.aiRayDistances = [0, 0, 0, 0, 0];
        this.aiRayGraphics = this.add.graphics();
        
// --- AI Car & Waypoints ---
        this.aiCar = this.add.rectangle(650, 300, 30, 20, 0x0000ff); // Start pos
        this.matter.add.gameObject(this.aiCar, {
            mass: 10,
            frictionAir: 0.1,
            friction: 0.01,
            restitution: 0.3,
            label: 'aiCar'
        });

        // New waypoints for the Oval track
        this.waypoints = [
            { x: 650, y: 650 }, // Go to bottom-right
            { x: 150, y: 650 }, // Go to bottom-left
            { x: 150, y: 150 }, // Go to top-left
            { x: 650, y: 150 }  // Go to top-right (completes loop)
        ];

        // --- Create the AI Agent "Brain" ---
        this.aiAgent = new AIAgent(
            this.waypoints, 
            this.ACCELERATION_FORCE, // Give the AI the player's acceleration
            this.ANGULAR_VELOCITY    // Give the AI the player's turn speed
        );
        
        // --- Collision Listener ---
        this.matter.world.on('collisionstart', (event, bodyA, bodyB) => {
            const isPlayerA = bodyA.gameObject === this.playerCar;
            const isPlayerB = bodyB.gameObject === this.playerCar;
            
            if ((isPlayerA && bodyB.label === 'wall') || (isPlayerB && bodyA.label === 'wall')) {
                this.onPlayerWallHit();
            }
        });

        // --- Input ---
        this.keys = this.input.keyboard.addKeys({
            up: Phaser.Input.Keyboard.KeyCodes.UP,
            down: Phaser.Input.Keyboard.KeyCodes.DOWN,
            left: Phaser.Input.Keyboard.KeyCodes.LEFT,
            right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
            space: Phaser.Input.Keyboard.KeyCodes.SPACE,
            e: Phaser.Input.Keyboard.KeyCodes.E,
            r: Phaser.Input.Keyboard.KeyCodes.R
        });

        // --- Telemetry & UI ---
        this.telemetryData = [];
        this.isRecording = false;
        this.frameCount = 0;
        
        this.recordingText = this.add.text(10, 10, 'Press SPACE to record', { fontSize: '14px', fill: '#fff' });
        this.speedText = this.add.text(10, 40, 'Speed: 0', { fontSize: '14px', fill: '#fff' });
        this.crashText = this.add.text(10, 70, 'Crashes: 0', { fontSize: '14px', fill: '#fff' });
        this.instructionsText = this.add.text(10, 100, 'Arrows: Drive | SPACE: Record | E: Export | R: Reset', { fontSize: '12px', fill: '#aaa' });
    }

    // --- (HELPER FUNCTIONS: No changes to these) ---
    
    getCarPolygon(car) {
        if (!car || !car.body || !car.body.vertices) {
            return new Phaser.Geom.Polygon(); 
        }
        return new Phaser.Geom.Polygon(car.body.vertices);
    }

    castRays(car, graphics, distances, walls, otherPolygons, rayColor) {
        const rayAngles = [
            car.rotation,                           // Front
            car.rotation - Math.PI / 4,             // Front-left
            car.rotation + Math.PI / 4,             // Front-right
            car.rotation - Math.PI / 2,             // Left
            car.rotation + Math.PI / 2              // Right
        ];
       
        graphics.clear();
        graphics.lineStyle(1, rayColor, 0.5);
       
        const carX = car.x;
        const carY = car.y;

        rayAngles.forEach((angle, index) => {
            const endX = carX + Math.cos(angle) * this.RAY_LENGTH;
            const endY = carY + Math.sin(angle) * this.RAY_LENGTH;
            const rayLine = new Phaser.Geom.Line(carX, carY, endX, endY);

            let closestDistance = this.RAY_LENGTH;
            let closestHitPoint = { x: endX, y: endY };
           
            // 1. Check vs Walls
            walls.forEach(wallRect => {
                const intersections = Phaser.Geom.Intersects.GetLineToRectangle(rayLine, wallRect);
                if (intersections.length > 0) {
                    intersections.forEach(point => {
                        const distance = Phaser.Math.Distance.Between(carX, carY, point.x, point.y);
                        if (distance < closestDistance) {
                            closestDistance = distance;
                            closestHitPoint = point;
                        }
                    });
                }
            });

            // 2. Check vs Other Polygons
            otherPolygons.forEach(polygon => {
                const points = polygon.points;
                if (points.length < 2) return; 

                for (let i = 0; i < points.length; i++) {
                    const p1 = points[i];
                    const p2 = points[(i + 1) % points.length];
                    const segmentLine = new Phaser.Geom.Line(p1.x, p1.y, p2.x, p2.y);
                    const intersectionPoint = new Phaser.Geom.Point();
                    
                    if (Phaser.Geom.Intersects.LineToLine(rayLine, segmentLine, intersectionPoint)) {
                        const distance = Phaser.Math.Distance.Between(carX, carY, intersectionPoint.x, intersectionPoint.y);
                        if (distance < closestDistance) {
                            closestDistance = distance;
                            closestHitPoint = { x: intersectionPoint.x, y: intersectionPoint.y };
                        }
                    }
                }
            });
           
            distances[index] = closestDistance / this.RAY_LENGTH;
            graphics.lineBetween(carX, carY, closestHitPoint.x, closestHitPoint.y);
            graphics.fillStyle(0xff0000);
            graphics.fillCircle(closestHitPoint.x, closestHitPoint.y, 3);
        });
    }

    onPlayerWallHit() {
        if (!this.playerCar.body) return;
        this.crashCount++;
        this.crashText.setText('Crashes: '
 + this.crashCount);
        const currentVel = this.playerCar.body.velocity;
        this.playerCar.setVelocity(currentVel.x * 0.5, currentVel.y * 0.5);
        if (this.isRecording) {
            const crashFrame = this.createTelemetryFrame(true);
            this.telemetryData.push(crashFrame);
        }
    }

    createTelemetryFrame(crashed = false) {
        const playerVel = this.playerCar.body.velocity;
        const aiVel = this.aiCar.body.velocity;
        
        return {
            timestamp: Date.now(),
            playerX: this.playerCar.x,
            playerY: this.playerCar.y,
            playerVelX: playerVel.x,
            playerVelY: playerVel.y,
            playerAngle: this.playerCar.rotation,
            playerSpeed: this.playerSpeed,
            playerAngularVelocity: this.playerCar.body.angularVelocity,
            aiX: this.aiCar.x,
            aiY: this.aiCar.y,
            aiVelX: aiVel.x,
            aiVelY: aiVel.y,
            aiAngle: this.aiCar.rotation,
            inputUp: this.keys.up.isDown,
            inputDown: this.keys.down.isDown,
            inputLeft: this.keys.left.isDown,
            inputRight: this.keys.right.isDown,
            playerRayDistances: [...this.rayDistances],
            aiRayDistances: [...this.aiRayDistances],
            crashed: crashed
        };
    }
    
    // --- (END OF UNCHANGED HELPER FUNCTIONS) ---


    update() {
        this.frameCount++;
       
        // --- Player Input (Matter.js) ---
        let thrust = 0;
        let angularVelocity = 0;
       
        if (this.keys.up.isDown) {
            thrust = this.ACCELERATION_FORCE;
        } else if (this.keys.down.isDown) {
            thrust = -this.ACCELERATION_FORCE * 0.5;
        }
        if (this.keys.left.isDown) {
            angularVelocity = -this.ANGULAR_VELOCITY;
        }
        if (this.keys.right.isDown) {
            angularVelocity = this.ANGULAR_VELOCITY;
        }
        this.playerCar.setAngularVelocity(angularVelocity);
        if (thrust !== 0) {
            const angle = this.playerCar.rotation;
            const forceX = Math.cos(angle) * thrust;
            const forceY = Math.sin(angle) * thrust;
            this.playerCar.applyForce({ x: forceX, y: forceY });
        }
       
        // Speed Limiter and Telemetry Update
        const velocity = this.playerCar.body.velocity;
        const currentSpeed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
        if (currentSpeed > this.MAX_SPEED) {
            this.playerCar.setVelocity(
                (velocity.x / currentSpeed) * this.MAX_SPEED,
                (velocity.y / currentSpeed) * this.MAX_SPEED
            );
        }
        this.playerSpeed = currentSpeed;
        this.speedText.setText('Speed: ' + Math.round(currentSpeed));
        this.playerAngle = this.playerCar.rotation;

        
        // --- Cast rays ---
        const playerPolygon = this.getCarPolygon(this.playerCar);
        const aiPolygon = this.getCarPolygon(this.aiCar);
        
        this.castRays(
            this.playerCar, 
            this.rayGraphics, 
            this.rayDistances, 
            this.geomWalls, 
            [aiPolygon],
            0x00ff00 // Green rays
        );
        
        this.castRays(
            this.aiCar, 
            this.aiRayGraphics, 
            this.aiRayDistances, 
            this.geomWalls, 
            [playerPolygon],
            0x00ffff // Cyan rays
        );
       
       
        // --- AI Movement (REFACTORED for ML) ---
        // 1. Get the current state for the AI
        const aiState = {
            x: this.aiCar.x,
            y: this.aiCar.y,
            rotation: this.aiCar.rotation,
            // Pass in other useful state info
            speed: Math.sqrt(this.aiCar.body.velocity.x**2 + this.aiCar.body.velocity.y**2),
            angularVelocity: this.aiCar.body.angularVelocity,
            rayDistances: this.aiRayDistances
        };

        // 2. Ask the "brain" for an action
        // The ML-based agent will return { thrust, angularVelocity }
        const aiAction = this.aiAgent.update(aiState);
        
        // 3. Apply the action to the "body" (Player-style)
        this.aiCar.setAngularVelocity(aiAction.angularVelocity);
        if (aiAction.thrust !== 0) {
            const angle = this.aiCar.rotation;
            const forceX = Math.cos(angle) * aiAction.thrust;
            const forceY = Math.sin(angle) * aiAction.thrust;
            this.aiCar.applyForce({ x: forceX, y: forceY });
        }

       
        // --- Recording and Export ---
        if (Phaser.Input.Keyboard.JustDown(this.keys.space)) {
            this.isRecording = !this.isRecording;
            if (this.isRecording) {
                this.recordingText.setText('REC - Recording...');
                this.recordingText.setColor('#ff0000');
                this.crashCount = 0;
                this.crashText.setText('Crashes: 0');
            } else {
                this.recordingText.setText('Press SPACE to record');
                this.recordingText.setColor('#ffffff');
            }
        }
       
        if (this.isRecording && this.frameCount % 3 === 0) {
            const frame = this.createTelemetryFrame(false);
            this.telemetryData.push(frame);
        }
       
        if (Phaser.Input.Keyboard.JustDown(this.keys.e)) {
            this.exportTelemetry();
        }
       
        if (Phaser.Input.Keyboard.JustDown(this.keys.r)) {
            this.scene.restart();
        }
    }

    exportTelemetry() {
        if (this.telemetryData.length === 0) {
            alert('No data to export! Record some gameplay first.');
            return;
        }
        const json = JSON.stringify(this.telemetryData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'telemetry.json';
        link.click();
        URL.revokeObjectURL(url);
        console.log('Exported ' + this.telemetryData.length + ' frames');
        this.telemetryData = [];
    }
}

// --- Config (No change) ---
const config = {
    type: Phaser.AUTO,
    width: 800, // Changed width for the new track
    height: 800, // Changed height for the new track
    physics: {
        default: 'matter',
        matter: {
            gravity: { y: 0 },
            debug: true
        }
    },
    scene: GameScene
};

const game = new Phaser.Game(config);