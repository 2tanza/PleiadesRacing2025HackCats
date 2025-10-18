import Phaser from 'phaser';

/**
 * A simple AI Agent that follows a set of waypoints.
 * This is the "brain" that can be replaced by a machine learning model.
 */
class AIAgent {
    constructor(waypoints, aiSpeed) {
        this.waypoints = waypoints;
        this.currentWaypointIndex = 0;
        this.aiSpeed = aiSpeed;
    }

    /**
     * The main decision-making function.
     * @param {object} state - The current state of the AI car.
     * @param {number} state.x - The car's x position.
     * @param {number} state.y - The car's y position.
     * @param {number} state.rotation - The car's current angle.
     * @param {number[]} state.rayDistances - The car's 5 sensor readings.
     * @returns {object} An action object with force and angle.
     * @returns {object} action.force - {x, y} force to apply.
     * @returns {number} action.angle - The angle the car should face.
     */
    update(state) {
        // --- This is the simple waypoint-following logic ---
        // An ML model would replace this section with its own logic,
        // using the 'state' (especially state.rayDistances) to make a decision.
        
        const waypoint = this.waypoints[this.currentWaypointIndex];
        const dx = waypoint.x - state.x;
        const dy = waypoint.y - state.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 50) {
            this.currentWaypointIndex = (this.currentWaypointIndex + 1) % this.waypoints.length;
        }

        // Calculate normalized direction vector
        const targetAngle = Math.atan2(dy, dx);
        const aiForceX = Math.cos(targetAngle) * this.aiSpeed / 1000;
        const aiForceY = Math.sin(targetAngle) * this.aiSpeed / 1000;

        // Return the chosen action
        return {
            force: { x: aiForceX, y: aiForceY },
            angle: targetAngle
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
        const aiSpeed = 10;
        this.aiAgent = new AIAgent(this.waypoints, aiSpeed);
        
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
       
       
        // --- AI Movement (REFACTORED) ---
        // 1. Get the current state for the AI
        const aiState = {
            x: this.aiCar.x,
            y: this.aiCar.y,
            rotation: this.aiCar.rotation,
            rayDistances: this.aiRayDistances
        };

        // 2. Ask the "brain" for an action
        const aiAction = this.aiAgent.update(aiState);
        
        // 3. Apply the action to the "body"
        this.aiCar.applyForce(aiAction.force);
        this.aiCar.setRotation(aiAction.angle);

       
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