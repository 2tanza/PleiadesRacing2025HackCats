import Phaser from 'phaser';
import { TrackEditor } from './map.js'; // Import the editor

/**
 * AIAgent Class
 * (This class is completely unchanged)
 */
class AIAgent {
    constructor(waypoints, acceleration, angularVelocity) {
        this.ACCELERATION_FORCE = acceleration;
        this.ANGULAR_VELOCITY = angularVelocity;
        this.latestAction = { thrust: 0, angularVelocity: 0 };
        this.socket = new WebSocket('ws://localhost:8765');
        this.socket.onopen = () => console.log('🤖 AI Agent: Connected.');
        this.socket.onclose = () => {
            console.error('🤖 AI Agent: Disconnected.');
            this.latestAction = { thrust: 0, angularVelocity: 0 };
        };
        this.socket.onerror = (error) => console.error('🤖 AI Agent: WebSocket Error: ', error);
        this.socket.onmessage = (event) => {
            const modelOutput = JSON.parse(event.data);
            this.latestAction = {
                thrust: modelOutput.throttle * this.ACCELERATION_FORCE,
                angularVelocity: modelOutput.steering * this.ANGULAR_VELOCITY
            };
        };
    }
    update(state) {
        if (this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(state));
        }
        return this.latestAction;
    }
}

/**
 * GameScene
 * This is now ONLY for playing the game.
 */
class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
        this.MAX_SPEED = 600;
        this.ACCELERATION_FORCE = 0.01;
        this.ANGULAR_VELOCITY = 0.05;
        this.RAY_LENGTH = 200;
    }

    create() {
        this.cameras.main.setBackgroundColor(0x222222);

        // --- Create the Track ---
        // This will load from localStorage OR create the default oval
        this.trackEditor = new TrackEditor(this);
        const loaded = this.trackEditor.loadTrack();
        if (!loaded) {
            this.trackEditor.createOvalTrack();
        }

        // --- Player Car ---
        this.playerCar = this.add.rectangle(650, 250, 30, 20, 0xff0000);
        this.matter.add.gameObject(this.playerCar, {
            mass: 10, frictionAir: 0.1, friction: 0.05,
            restitution: 0.3, label: 'playerCar'
        });
        this.playerSpeed = 0;
        this.playerAngle = this.playerCar.rotation;
        this.crashCount = 0;

        // --- Ray sensors ---
        this.rayDistances = [0, 0, 0, 0, 0];
        this.rayGraphics = this.add.graphics();
        this.aiRayDistances = [0, 0, 0, 0, 0];
        this.aiRayGraphics = this.add.graphics();
        
        // --- AI Car & Waypoints ---
        this.aiCar = this.add.rectangle(650, 300, 30, 20, 0x0000ff);
        this.matter.add.gameObject(this.aiCar, {
            mass: 10, frictionAir: 0.1, friction: 0.01,
            restitution: 0.3, label: 'aiCar'
        });
        this.waypoints = [
            { x: 650, y: 650 }, { x: 150, y: 650 },
            { x: 150, y: 150 }, { x: 650, y: 150 }
        ];
        this.aiAgent = new AIAgent(
            this.waypoints, this.ACCELERATION_FORCE, this.ANGULAR_VELOCITY
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
            up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT',
            space: 'SPACE', e: 'E', r: 'R'
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

    // --- (HELPER FUNCTIONS: All unchanged) ---
    
    getCarPolygon(car) {
        if (!car || !car.body || !car.body.vertices) {
            return new Phaser.Geom.Polygon(); 
        }
        return new Phaser.Geom.Polygon(car.body.vertices);
    }

    castRays(car, graphics, distances, walls, otherPolygons, rayColor) {
        const rayAngles = [
            car.rotation, car.rotation - Math.PI / 4, car.rotation + Math.PI / 4,
            car.rotation - Math.PI / 2, car.rotation + Math.PI / 2
        ];
        graphics.clear();
        graphics.lineStyle(1, rayColor, 0.5);
        const carX = car.x; const carY = car.y;

        rayAngles.forEach((angle, index) => {
            const endX = carX + Math.cos(angle) * this.RAY_LENGTH;
            const endY = carY + Math.sin(angle) * this.RAY_LENGTH;
            const rayLine = new Phaser.Geom.Line(carX, carY, endX, endY);
            let closestDistance = this.RAY_LENGTH;
            let closestHitPoint = { x: endX, y: endY };
            
            walls.forEach(wallRect => {
                const intersections = Phaser.Geom.Intersects.GetLineToRectangle(rayLine, wallRect);
                intersections.forEach(point => {
                    const distance = Phaser.Math.Distance.Between(carX, carY, point.x, point.y);
                    if (distance < closestDistance) {
                        closestDistance = distance;
                        closestHitPoint = point;
                    }
                });
            });

            otherPolygons.forEach(polygon => {
                const points = polygon.points; if (points.length < 2) return; 
                for (let i = 0; i < points.length; i++) {
                    const p1 = points[i]; const p2 = points[(i + 1) % points.length];
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
        this.crashText.setText('Crashes: ' + this.crashCount);
        const currentVel = this.playerCar.body.velocity;
        this.playerCar.setVelocity(currentVel.x * 0.5, currentVel.y * 0.5);
        if (this.isRecording) {
            this.telemetryData.push(this.createTelemetryFrame(true));
        }
    }

    createTelemetryFrame(crashed = false) {
        const playerVel = this.playerCar.body.velocity;
        const aiVel = this.aiCar.body.velocity;
        return {
            timestamp: Date.now(),
            playerX: this.playerCar.x, playerY: this.playerCar.y,
            playerVelX: playerVel.x, playerVelY: playerVel.y,
            playerAngle: this.playerCar.rotation, playerSpeed: this.playerSpeed,
            playerAngularVelocity: this.playerCar.body.angularVelocity,
            aiX: this.aiCar.x, aiY: this.aiCar.y,
            aiVelX: aiVel.x, aiVelY: aiVel.y,
            aiAngle: this.aiCar.rotation,
            inputUp: this.keys.up.isDown, inputDown: this.keys.down.isDown,
            inputLeft: this.keys.left.isDown, inputRight: this.keys.right.isDown,
            playerRayDistances: [...this.rayDistances],
            aiRayDistances: [...this.aiRayDistances],
            crashed: crashed
        };
    }
    
    // --- (END OF UNCHANGED HELPERS) ---

    update() {
        this.frameCount++;
       
        // --- Player Input (Unchanged) ---
        let thrust = 0; let angularVelocity = 0;
        if (this.keys.up.isDown) thrust = this.ACCELERATION_FORCE;
        else if (this.keys.down.isDown) thrust = -this.ACCELERATION_FORCE * 0.5;
        if (this.keys.left.isDown) angularVelocity = -this.ANGULAR_VELOCITY;
        if (this.keys.right.isDown) angularVelocity = this.ANGULAR_VELOCITY;
        this.playerCar.setAngularVelocity(angularVelocity);
        if (thrust !== 0) {
            const angle = this.playerCar.rotation;
            this.playerCar.applyForce({ x: Math.cos(angle) * thrust, y: Math.sin(angle) * thrust });
        }
       
        // Speed Limiter (Unchanged)
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

        
        // --- Cast rays (Unchanged, but uses loaded walls) ---
        const playerPolygon = this.getCarPolygon(this.playerCar);
        const aiPolygon = this.getCarPolygon(this.aiCar);
        const currentGeomWalls = this.trackEditor.getGeomWalls();
        
        this.castRays(
            this.playerCar, this.rayGraphics, this.rayDistances, 
            currentGeomWalls, [aiPolygon], 0x00ff00
        );
        this.castRays(
            this.aiCar, this.aiRayGraphics, this.aiRayDistances, 
            currentGeomWalls, [playerPolygon], 0x00ffff
        );
       
        // --- AI Update (Unchanged) ---
        const aiState = {
            x: this.aiCar.x, y: this.aiCar.y,
            vx: this.aiCar.body.velocity.x, vy: this.aiCar.body.velocity.y,
            angle: this.aiCar.rotation, rayDistances: this.aiRayDistances
        };
        const aiAction = this.aiAgent.update(aiState);
        this.aiCar.setAngularVelocity(aiAction.angularVelocity);
        if (aiAction.thrust !== 0) {
            const angle = this.aiCar.rotation;
            this.aiCar.applyForce({ x: Math.cos(angle) * aiAction.thrust, y: Math.sin(angle) * aiAction.thrust });
        }
       
        // --- Recording and Export (Unchanged) ---
        if (Phaser.Input.Keyboard.JustDown(this.keys.space)) {
            this.isRecording = !this.isRecording;
            this.recordingText.setText(this.isRecording ? 'REC - Recording...' : 'Press SPACE to record');
            this.recordingText.setColor(this.isRecording ? '#ff0000' : '#ffffff');
            if(this.isRecording) { this.crashCount = 0; this.crashText.setText('Crashes: 0'); }
        }
        if (this.isRecording && this.frameCount % 3 === 0) {
            this.telemetryData.push(this.createTelemetryFrame(false));
        }
        if (Phaser.Input.Keyboard.JustDown(this.keys.e)) this.exportTelemetry();
        if (Phaser.Input.Keyboard.JustDown(this.keys.r)) this.scene.restart();
    }

    exportTelemetry() {
        if (this.telemetryData.length === 0) {
            alert('No data to export!'); return;
        }
        const json = JSON.stringify(this.telemetryData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = 'telemetry.json'; link.click();
        URL.revokeObjectURL(url);
        console.log('Exported ' + this.telemetryData.length + ' frames');
        this.telemetryData = [];
    }
}

// --- Config (Unchanged, but for GameScene) ---
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 800,
    physics: {
        default: 'matter',
        matter: { gravity: { y: 0 }, debug: true }
    },
    scene: GameScene, // <-- Loads the GameScene
    parent: 'game-container'
};

const game = new Phaser.Game(config);
window.game = game; // Expose for any potential debug