import Phaser from 'phaser';
import { TrackEditor } from './map.js'; // <-- Import is unchanged

/**
 * AIAgent Class
 * (This class is unchanged)
 */
class AIAgent {
    // ... (AIAgent class remains completely unchanged) ...
    constructor(waypoints, acceleration, angularVelocity) {
        // Store the car's physics capabilities
        this.ACCELERATION_FORCE = acceleration;
        this.ANGULAR_VELOCITY = angularVelocity;

        // This will store the latest action from the Python server
        this.latestAction = {
            thrust: 0,
            angularVelocity: 0
        };

        // --- WebSocket Connection ---
        this.socket = new WebSocket('ws://localhost:8765');

        this.socket.onopen = () => {
            console.log('🤖 AI Agent: Connected to Python server.');
        };

        this.socket.onclose = () => {
            console.error('🤖 AI Agent: Disconnected from Python server.');
            // Stop the car if connection is lost
            this.latestAction = { thrust: 0, angularVelocity: 0 };
        };

        this.socket.onerror = (error) => {
            console.error('🤖 AI Agent: WebSocket Error: ', error);
        };

        /**
         * This is the most important part.
         * It listens for messages from the Python server.
         */
        this.socket.onmessage = (event) => {
            // 1. Get the model's output (e.g., {'steering': -0.5, 'throttle': 1.0})
            const modelOutput = JSON.parse(event.data);

            // 2. ***Translate model output into game physics***
            //    - 'throttle' (0 to 1) becomes 'thrust'
            //    - 'steering' (-1 to 1) becomes 'angularVelocity'
            this.latestAction = {
                thrust: modelOutput.throttle * this.ACCELERATION_FORCE,
                angularVelocity: modelOutput.steering * this.ANGULAR_VELOCITY
            };
        };
    }

    /**
     * The main decision-making function, called every frame by the game.
     * @param {object} state - The current state of the AI car.
     */
    update(state) {
        // 1. Send the current game state to the Python server
        //    We only send if the socket is open and ready.
        if (this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(state));
        }

        // 2. Return the *most recent action* we received from the server
        //    The onmessage listener updates this.latestAction in the background.
        return this.latestAction;
    }
}


class GameScene extends Phaser.Scene {
    // ... (Constructor is unchanged) ...
    constructor() {
        super({ key: 'GameScene' });

        // Define common constants
        this.MAX_SPEED = 600;
        this.ACCELERATION_FORCE = 0.01;
        this.ANGULAR_VELOCITY = 0.05;
        this.RAY_LENGTH = 200;
    }

    create() {
        this.cameras.main.setBackgroundColor(0x222222);

        // --- Create the Track Editor ---
        this.trackEditor = new TrackEditor(this);
        this.trackEditor.createOvalTrack();

        // --- Player Car (Matter Body) ---
        // ... (Player Car creation is unchanged) ...
        this.playerCar = this.add.rectangle(650, 250, 30, 20, 0xff0000); 
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
        // ... (Ray sensor creation is unchanged) ...
        this.rayDistances = [0, 0, 0, 0, 0];
        this.rayGraphics = this.add.graphics();
        this.aiRayDistances = [0, 0, 0, 0, 0];
        this.aiRayGraphics = this.add.graphics();
        
        // --- AI Car & Waypoints ---
        // ... (AI Car & Waypoint creation is unchanged) ...
        this.aiCar = this.add.rectangle(650, 300, 30, 20, 0x0000ff);
        this.matter.add.gameObject(this.aiCar, {
            mass: 10,
            frictionAir: 0.1,
            friction: 0.01,
            restitution: 0.3,
            label: 'aiCar'
        });

        this.waypoints = [
            { x: 650, y: 650 }, 
            { x: 150, y: 650 },
            { x: 150, y: 150 },
            { x: 650, y: 150 } 
        ];
        this.aiAgent = new AIAgent(
            this.waypoints, 
            this.ACCELERATION_FORCE,
            this.ANGULAR_VELOCITY
        );
        
        // --- Collision Listener ---
        // ... (Collision listener is unchanged) ...
        this.matter.world.on('collisionstart', (event, bodyA, bodyB) => {
            const isPlayerA = bodyA.gameObject === this.playerCar;
            const isPlayerB = bodyB.gameObject === this.playerCar;
            
            if ((isPlayerA && bodyB.label === 'wall') || (isPlayerB && bodyA.label === 'wall')) {
                this.onPlayerWallHit();
            }
        });

        // --- Input ---
        // ... (Input keys are unchanged) ...
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
        // ... (Telemetry UI is unchanged) ...
        this.telemetryData = [];
        this.isRecording = false;
        this.frameCount = 0;
        
        this.recordingText = this.add.text(10, 10, 'Press SPACE to record', { fontSize: '14px', fill: '#fff' });
        this.speedText = this.add.text(10, 40, 'Speed: 0', { fontSize: '14px', fill: '#fff' });
        this.crashText = this.add.text(10, 70, 'Crashes: 0', { fontSize: '14px', fill: '#fff' });
        this.instructionsText = this.add.text(10, 100, 'Arrows: Drive | SPACE: Record | E: Export | R: Reset', { fontSize: '12px', fill: '#aaa' });
    
        // --- NEW: Grid Snapping Preview ---
        // Create a semi-transparent rectangle to show where the piece will land
        this.previewRect = this.add.rectangle(0, 0, this.trackEditor.PIECE_WIDTH, this.trackEditor.PIECE_WIDTH, 0xffffff, 0.3)
            .setVisible(false)
            .setDepth(100); // Ensure it's drawn on top of other game elements

        // --- MODIFIED: Listen for UI events from index.html ---
        this.game.events.on('addTrackPiece', this.handleDrop, this);
        this.game.events.on('clearTrack', this.handleClear, this);
        this.game.events.on('updatePreview', this.handlePreview, this); // <-- NEW
        this.game.events.on('hidePreview', this.handleHidePreview, this); // <-- NEW
    }

    /**
     * NEW: Helper function to calculate grid-snapped coordinates.
     * Takes world coordinates and returns the CENTER of the nearest grid cell.
     * @param {number} worldX - The raw x-coordinate from the mouse
     * @param {number} worldY - The raw y-coordinate from the mouse
     * @returns {object} An object { x, y } with the snapped coordinates
     */
    getSnappedCoordinates(worldX, worldY) {
        const PIECE_WIDTH = this.trackEditor.PIECE_WIDTH;
        
        // 1. Find the top-left corner of the grid cell
        const gridX = Math.floor(worldX / PIECE_WIDTH) * PIECE_WIDTH;
        const gridY = Math.floor(worldY / PIECE_WIDTH) * PIECE_WIDTH;
        
        // 2. Calculate the center of that cell
        const snappedX = gridX + PIECE_WIDTH / 2;
        const snappedY = gridY + PIECE_WIDTH / 2;
        
        return { x: snappedX, y: snappedY };
    }

    /**
     * NEW: Handles the 'updatePreview' event from the UI (on dragover).
     * @param {object} data - Contains { x, y } screen coordinates
     */
    handlePreview(data) {
        // Convert screen coordinates to world coordinates
        const worldPoint = this.cameras.main.getWorldPoint(data.x, data.y);
        
        // Get the snapped coordinates
        const snapped = this.getSnappedCoordinates(worldPoint.x, worldPoint.y);
        
        // Move the preview rectangle to the snapped position and make it visible
        this.previewRect.setPosition(snapped.x, snapped.y).setVisible(true);
    }

    /**
     * NEW: Handles the 'hidePreview' event from the UI (on dragleave).
     */
    handleHidePreview() {
        this.previewRect.setVisible(false);
    }

    /**
     * MODIFIED: Handles the 'addTrackPiece' event from the UI (on drop).
     * @param {object} data - Contains { pieceType, x, y } screen coordinates
     */
    handleDrop(data) {
        // Convert screen coordinates to world coordinates
        const worldPoint = this.cameras.main.getWorldPoint(data.x, data.y);
        
        // --- MODIFIED: Use the snapping function ---
        const snapped = this.getSnappedCoordinates(worldPoint.x, worldPoint.y);
        
        // Tell the track editor to add the new piece at the SNAPPED location
        this.trackEditor.addTrackPiece(data.pieceType, snapped.x, snapped.y);

        // Hide the preview rect after dropping
        this.handleHidePreview();
    }

    /**
     * MODIFIED: Handles the 'clearTrack' event from the UI.
     */
    handleClear() {
        this.trackEditor.clearTrack();
        
        // Reset cars to a default position
        this.playerCar.setPosition(650, 250);
        this.playerCar.setVelocity(0, 0);
        this.playerCar.setRotation(0);
        
        this.aiCar.setPosition(650, 300);
        this.aiCar.setVelocity(0, 0);
        this.aiCar.setRotation(0);

        // Hide the preview if it was visible
        this.handleHidePreview();

        console.log('Track cleared!');
    }


    // --- (HELPER FUNCTIONS: No changes to these) ---
    
    getCarPolygon(car) {
        // ... (unchanged) ...
        if (!car || !car.body || !car.body.vertices) {
            return new Phaser.Geom.Polygon(); 
        }
        return new Phaser.Geom.Polygon(car.body.vertices);
    }

    castRays(car, graphics, distances, walls, otherPolygons, rayColor) {
        // ... (unchanged) ...
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
        // ... (unchanged) ...
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
        // ... (unchanged) ...
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
        // ... (Player input logic is unchanged) ...
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
       
        // ... (Speed limiter and telemetry update is unchanged) ...
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
        
        // Get the current walls from the track editor
        const currentGeomWalls = this.trackEditor.getGeomWalls();
        
        this.castRays(
            this.playerCar, 
            this.rayGraphics, 
            this.rayDistances, 
            currentGeomWalls, // <-- This remains correct
            [aiPolygon],
            0x00ff00 // Green rays
        );
        
        this.castRays(
            this.aiCar, 
            this.aiRayGraphics, 
            this.aiRayDistances, 
            currentGeomWalls, // <-- This remains correct
            [playerPolygon],
            0x00ffff // Cyan rays
        );
       
       
        // --- AI Update ---
        // ... (AI update logic is unchanged) ...
        const aiState = {
            x: this.aiCar.x,
            y: this.aiCar.y,
            vx: this.aiCar.body.velocity.x,
            vy: this.aiCar.body.velocity.y,
            angle: this.aiCar.rotation,
            rayDistances: this.aiRayDistances
        };
        const aiAction = this.aiAgent.update(aiState);
        this.aiCar.setAngularVelocity(aiAction.angularVelocity);
        if (aiAction.thrust !== 0) {
            const angle = this.aiCar.rotation;
            const forceX = Math.cos(angle) * aiAction.thrust;
            const forceY = Math.sin(angle) * aiAction.thrust;
            this.aiCar.applyForce({ x: forceX, y: forceY });
        }

       
        // --- Recording and Export ---
        // ... (Recording and export logic is unchanged) ...
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
        // ... (unchanged) ...
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
// ... (Config is unchanged) ...
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 800,
    physics: {
        default: 'matter',
        matter: {
            gravity: { y: 0 },
            debug: true
        }
    },
    scene: GameScene,
    parent: 'game-container' 
};

const game = new Phaser.Game(config);
window.game = game;