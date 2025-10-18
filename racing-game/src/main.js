import Phaser from 'phaser';

// comment to switch branches?

class GameScene extends Phaser.Scene {

    constructor() {

        super({ key: 'GameScene' });

        // Define common constants

        this.MAX_SPEED = 300;

        this.ACCELERATION_FORCE = 0.005;

        this.ANGULAR_VELOCITY = 0.05;

        this.RAY_LENGTH = 150;

    }

    getCarPolygon(car) {
        // Safety check
        if (!car || !car.body || !car.body.vertices) {
            return new Phaser.Geom.Polygon(); 
        }
        
        // Just return a new polygon straight from the body's vertices.
        // These vertices are already in world-space, which is what we want.
        return new Phaser.Geom.Polygon(car.body.vertices);
    }


    create() {

        this.cameras.main.setBackgroundColor(0x222222);



        // --- Visual Track ---

        const graphics = this.add.graphics();

        graphics.fillStyle(0x333333, 1);

        graphics.fillRect(150, 200, 700, 400);

        graphics.lineStyle(2, 0xffff00, 1);

        graphics.strokeRect(150, 200, 700, 400);

       

        // --- Matter.js Track Boundaries ---

        const wallOptions = { isStatic: true, friction: 0.0, restitution: 0.1, label: 'wall' };

        // Top Wall

        this.matter.add.rectangle(512, 195, 700, 10, wallOptions);

        // Bottom Wall

        this.matter.add.rectangle(512, 605, 700, 10, wallOptions);

        // Left Wall

        this.matter.add.rectangle(145, 400, 10, 400, wallOptions);

        // Right Wall

        this.matter.add.rectangle(855, 400, 10, 400, wallOptions);

       

        // --- Player Car (Matter Body) ---

        this.playerCar = this.add.rectangle(300, 400, 30, 20, 0xff0000);

        this.matter.add.gameObject(this.playerCar, {

            mass: 10,

            frictionAir: 0.1,

            friction: 0.05,

            restitution: 0.3,

            label: 'playerCar'

        });

       

        this.playerSpeed = 0;

        this.playerAngle = this.playerCar.rotation; // Get angle from Matter body

        this.crashCount = 0;

       

        // --- Ray sensors ---

        this.rayDistances = [0, 0, 0, 0, 0];

        this.rayGraphics = this.add.graphics();

        
        // --- Ray sensors (AI) ---
        this.aiRayDistances = [0, 0, 0, 0, 0];
        this.aiRayGraphics = this.add.graphics();

       

        // --- AI car (Matter Body) ---

        this.aiCar = this.add.rectangle(700, 400, 30, 20, 0x0000ff);

        this.matter.add.gameObject(this.aiCar, {

            mass: 10,

            frictionAir: 0.1,

            friction: 0.01,

            restitution: 0.3,

            label: 'aiCar'

        });

        this.aiSpeed = 5; // AI speed constant used for application of force

        this.waypoints = [

            { x: 200, y: 250 },

            { x: 800, y: 250 },

            { x: 800, y: 550 },

            { x: 200, y: 550 }

        ];

        this.currentWaypointIndex = 0;

       

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



        // Define walls for simplified ray casting logic (same as before)

        this.geomWalls = [
            // Top Wall: { x: 512, y: 195, w: 700, h: 10 }
            new Phaser.Geom.Rectangle(512 - 350, 195 - 5, 700, 10),
            // Bottom Wall: { x: 512, y: 605, w: 700, h: 10 }
            new Phaser.Geom.Rectangle(512 - 350, 605 - 5, 700, 10),
            // Left Wall: { x: 145, y: 400, w: 10, h: 400 }
            new Phaser.Geom.Rectangle(145 - 5, 400 - 200, 10, 400),
            // Right Wall: { x: 855, y: 400, w: 10, h: 400 }
            new Phaser.Geom.Rectangle(855 - 5, 400 - 200, 10, 400)
        ];

    }


/**
     * Casts 5 rays from a car and checks for intersections against walls and other dynamic polygons.
     * @param {Phaser.GameObjects.GameObject} car The car to cast rays from (this.playerCar or this.aiCar)
     * @param {Phaser.GameObjects.Graphics} graphics The graphics object to draw rays on
     * @param {number[]} distances The array to store the resulting distances in
     * @param {Phaser.Geom.Rectangle[]} walls An array of static wall Rectangles
     * @param {Phaser.Geom.Polygon[]} otherPolygons An array of dynamic polygons to check against (e.g., the other car)
     * @param {number} rayColor The color to draw the rays (e.g., 0x00ff00)
     */
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
            // Define the ray as a Phaser.Geom.Line
            const endX = carX + Math.cos(angle) * this.RAY_LENGTH;
            const endY = carY + Math.sin(angle) * this.RAY_LENGTH;
            const rayLine = new Phaser.Geom.Line(carX, carY, endX, endY);

            let closestDistance = this.RAY_LENGTH;
            let closestHitPoint = { x: endX, y: endY }; // Default to end of ray
           
            // 1. Check intersection against EACH static wall
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

            // 2. Check intersection against EACH dynamic polygon (NEW LOGIC)
            otherPolygons.forEach(polygon => {
                const points = polygon.points;
                if (points.length < 2) return; // Not a valid polygon

                // We must manually check each segment of the polygon
                for (let i = 0; i < points.length; i++) {
                    // Get the start point (current point)
                    const p1 = points[i];
                    
                    // Get the end point (next point, wrapping around to the start)
                    const p2 = points[(i + 1) % points.length];

                    // Create a line segment for this side of the polygon
                    const segmentLine = new Phaser.Geom.Line(p1.x, p1.y, p2.x, p2.y);
                    
                    // Use the more reliable LineToLine intersection check
                    const intersectionPoint = new Phaser.Geom.Point();
                    
                    if (Phaser.Geom.Intersects.LineToLine(rayLine, segmentLine, intersectionPoint)) {
                        // An intersection was found
                        const distance = Phaser.Math.Distance.Between(carX, carY, intersectionPoint.x, intersectionPoint.y);
                        
                        if (distance < closestDistance) {
                            closestDistance = distance;
                            closestHitPoint = { x: intersectionPoint.x, y: intersectionPoint.y };
                        }
                    }
                }
            });
           
            // Store the normalized distance for this ray
            distances[index] = closestDistance / this.RAY_LENGTH;
           
            // Draw the ray from the car to the actual hit point
            graphics.lineBetween(carX, carY, closestHitPoint.x, closestHitPoint.y);
           
            // Draw the hit point (always red)
            graphics.fillStyle(0xff0000);
            graphics.fillCircle(closestHitPoint.x, closestHitPoint.y, 3);
        });
    }





    onPlayerWallHit() {

        if (!this.playerCar.body) return; // Safety check

       

        this.crashCount++;

        this.crashText.setText('Crashes: ' + this.crashCount);

       

        // Reduce the Matter body's velocity by 50% on impact

        const currentVel = this.playerCar.body.velocity;

        this.playerCar.setVelocity(currentVel.x * 0.5, currentVel.y * 0.5);

       

        // Log crash data

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
            
            // Player Data
            playerX: this.playerCar.x,
            playerY: this.playerCar.y,
            playerVelX: playerVel.x,
            playerVelY: playerVel.y,
            playerAngle: this.playerCar.rotation,
            playerSpeed: this.playerSpeed,
            playerAngularVelocity: this.playerCar.body.angularVelocity,
            
            // AI Data
            aiX: this.aiCar.x,
            aiY: this.aiCar.y,
            aiVelX: aiVel.x,
            aiVelY: aiVel.y,
            aiAngle: this.aiCar.rotation,
            aiSpeed: this.aiSpeed,
            aiAngularVelocity: this.aiCar.body.angularVelocity,
            
            // Input Data
            inputUp: this.keys.up.isDown,
            inputDown: this.keys.down.isDown,
            inputLeft: this.keys.left.isDown,
            inputRight: this.keys.right.isDown,
            
            // Sensor Data
            playerRayDistances: [...this.rayDistances],
            aiRayDistances: [...this.aiRayDistances], // Add AI rays
            
            // State
            crashed: crashed
        };
    }

    update() {

        this.frameCount++;

       

        // --- Player Input (Matter.js) ---

        let thrust = 0;

        let angularVelocity = 0;

       

        if (this.keys.up.isDown) {

            thrust = this.ACCELERATION_FORCE;

        } else if (this.keys.down.isDown) {

            thrust = -this.ACCELERATION_FORCE * 0.5; // Reverse is weaker

        }



        if (this.keys.left.isDown) {

            angularVelocity = -this.ANGULAR_VELOCITY;

        }

        if (this.keys.right.isDown) {

            angularVelocity = this.ANGULAR_VELOCITY;

        }



        // Apply Angular Velocity for Steering

        this.playerCar.setAngularVelocity(angularVelocity);

       

        // Apply Forward/Backward Force

        if (thrust !== 0) {

            const angle = this.playerCar.rotation;

            const forceX = Math.cos(angle) * thrust;

            const forceY = Math.sin(angle) * thrust;

           

            // Apply force to the center of the body

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

        this.playerAngle = this.playerCar.rotation; // Update angle for ray casting



        // --- Cast rays ---
        
        // Get the current polygon boundaries for both cars
        const playerPolygon = this.getCarPolygon(this.playerCar);
        const aiPolygon = this.getCarPolygon(this.aiCar);
        
        // Cast rays for Player (sees walls and AI car)
        this.castRays(
            this.playerCar, 
            this.rayGraphics, 
            this.rayDistances, 
            this.geomWalls, 
            [aiPolygon],    // Pass AI car as a target
            0x00ff00          // Green rays
        );
        
        // Cast rays for AI (sees walls and Player car)
        this.castRays(
            this.aiCar, 
            this.aiRayGraphics, 
            this.aiRayDistances, 
            this.geomWalls, 
            [playerPolygon],  // Pass Player car as a target
            0x00ffff          // Cyan rays
        );

       

        // --- AI Movement (Matter.js - Simple Force-Based) ---

        const waypoint = this.waypoints[this.currentWaypointIndex];

        const dx = waypoint.x - this.aiCar.x;

        const dy = waypoint.y - this.aiCar.y;

        const distance = Math.sqrt(dx * dx + dy * dy);

       

        if (distance < 50) {

            this.currentWaypointIndex = (this.currentWaypointIndex + 1) % this.waypoints.length;

        }

       

        // Calculate normalized direction vector

        const targetAngle = Math.atan2(dy, dx);

        const aiForceX = Math.cos(targetAngle) * this.aiSpeed / 1000;

        const aiForceY = Math.sin(targetAngle) * this.aiSpeed / 1000;

       

        this.aiCar.applyForce({ x: aiForceX, y: aiForceY });

        this.aiCar.setRotation(targetAngle);

       

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

       

        // Record telemetry (at ~20 FPS)

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



const config = {

    type: Phaser.AUTO,

    width: 1024,

    height: 768,

    physics: {

        default: 'matter', // Changed to Matter.js

        matter: {

            gravity: { y: 0 },

            debug: true // Set to false when done testing

        }

    },

    scene: GameScene

};



const game = new Phaser.Game(config);

