import Phaser from 'phaser';
import { TrackEditor } from './map.js'; 
import { PaceNoteAudio } from './audio.js';

/**
 * AIAgent Class
 */
class AIAgent {
    constructor(waypoints, acceleration, angularVelocity) {
        this.ACCELERATION_FORCE = acceleration;
        this.ANGULAR_VELOCITY = angularVelocity;
        this.latestAction = { thrust: 0, angularVelocity: 0 };
        const aiHost = 'ai-' + window.location.hostname;
        this.socket = new WebSocket('wss://' + aiHost);
        console.log('AI Agent: Connecting to', this.socket.url);
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
 */
class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
        this.MAX_SPEED = 600;
        this.ACCELERATION_FORCE = 0.01;
        this.ANGULAR_VELOCITY = 0.05;
        this.RAY_LENGTH = 200;
        
        // Lap tracking data
        this.lapData = {
            player: {
                count: -1,
                startTime: 0,
                lastLap: 0,
                bestLap: 0,
                canTrigger: true
            },
            ai: {
                count: -1,
                startTime: 0,
                lastLap: 0,
                bestLap: 0,
                canTrigger: true
            }
        };
        
        // Audio system
        this.paceNoteManager = null;
        this.raceStarted = false;
        
        // Turn detection cooldown (frame-based)
        this.lastTurnCheckFrame = 0;
        this.TURN_CHECK_COOLDOWN = 120; // ~2 seconds at 60fps

        this.showRays = true;
    }

    preload() {
        this.load.image('playerCarSprite', 'public/f1carorange.png');
        this.load.image('aiCarSprite', 'public/f1carblue.png');
    }

    create() {
        this.cameras.main.setBackgroundColor(0x222222);

        // Initialize track editor
        this.trackEditor = new TrackEditor(this);
        const loaded = this.trackEditor.loadTrack();
        if (!loaded) {
            this.trackEditor.createOvalTrack();
        }

        // Initialize pace note audio system
        // Using Cloudflare Tunnel - UPDATE THIS with your actual tunnel URL
        // Get this URL by running: cloudflared tunnel --url http://localhost:5000
        // It will look like: https://random-words-1234.trycloudflare.com, brought in.
        const CLOUDFLARE_TUNNEL_URL = 'https://bids-hudson-villa-capitol.trycloudflare.com';
        
        console.log('🌐 Connecting to audio server at:', CLOUDFLARE_TUNNEL_URL);
        this.paceNoteManager = new PaceNoteAudio(`${CLOUDFLARE_TUNNEL_URL}/mcp`);
        
        // Play "Start your engines!" after a short delay
        this.time.delayedCall(1500, () => {
            if (!this.raceStarted) {
                this.paceNoteManager.playStartMessage();
                this.raceStarted = true;
            }
        });

        // Initialize gamepad support
        this.gamepad = null;
        this.input.gamepad.once('connected', (pad) => {
            console.log('🎮 Controller connected:', pad.id);
            this.gamepad = pad;
        });

        // Create player car
        this.playerCar = this.add.sprite(150, 150, 'playerCarSprite');
        this.playerCar.displayWidth = 35;
        this.playerCar.displayHeight = 30;
    
        this.matter.add.gameObject(this.playerCar, {
            shape: { 
                type: 'rectangle', 
                width: 30, 
                height: 20 
            },
            mass: 10, 
            frictionAir: 0.1, 
            friction: 0.05,
            restitution: 0.3, 
            label: 'playerCar'
        });
        
        this.playerSpeed = 0;
        this.playerAngle = this.playerCar.rotation;
        this.crashCount = 0;

        // Raycasting for player
        this.rayDistances = [0, 0, 0, 0, 0, 0, 0];
        this.rayGraphics = this.add.graphics();
        
        // Create AI car
        this.aiCar = this.add.sprite(150, 200, 'aiCarSprite');
        this.aiCar.displayWidth = 42;
        this.aiCar.displayHeight = 32;

        this.matter.add.gameObject(this.aiCar, {
            shape: { 
                type: 'rectangle', 
                width: 30, 
                height: 20 
            },
            mass: 10, 
            frictionAir: 0.1, 
            friction: 0.01,
            restitution: 0.3, 
            label: 'aiCar'
        });
        
        // Raycasting for AI
        this.aiRayDistances = [0, 0, 0, 0, 0, 0, 0];
        this.aiRayGraphics = this.add.graphics();
        
        // AI waypoints (for AI agent only, not for pace notes)
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
        
        // Collision detection
        this.matter.world.on('collisionstart', (event, bodyA, bodyB) => {
            // Check for player hitting walls
            const isPlayerA = bodyA.gameObject === this.playerCar;
            const isPlayerB = bodyB.gameObject === this.playerCar;
            
            if ((isPlayerA && bodyB.label === 'wall') || (isPlayerB && bodyA.label === 'wall')) {
                this.onPlayerWallHit();
            }
            
            // Check for finish line crossings
            this.checkFinishLine(bodyA, bodyB, 'player');
            this.checkFinishLine(bodyA, bodyB, 'ai');
        });

        // Keyboard controls
        this.keys = this.input.keyboard.addKeys({
            up: 'UP', 
            down: 'DOWN', 
            left: 'LEFT', 
            right: 'RIGHT',
            space: 'SPACE', 
            e: 'E', 
            r: 'R',
            h: 'H'
        });

        // Telemetry recording
        this.telemetryData = [];
        this.isRecording = false;
        this.frameCount = 0;
               
        // --- Get references to HTML UI Elements ---
        this.recordingText = document.getElementById('recording-text');
        this.speedText = document.getElementById('speed-text');
        this.crashText = document.getElementById('crash-text');
        this.instructionsText = document.getElementById('instructions-text');
        
        // Player lap info
        this.playerLapText = document.getElementById('player-lap-text');
        this.playerCurrentText = document.getElementById('player-current-text');
        this.playerLastText = document.getElementById('player-last-text');
        this.playerBestText = document.getElementById('player-best-text');

        // AI lap info
        this.aiLapText = document.getElementById('ai-lap-text');
        this.aiCurrentText = document.getElementById('ai-current-text');
        this.aiLastText = document.getElementById('ai-last-text');
        this.aiBestText = document.getElementById('ai-best-text');

        // Initialize lap timers
        this.lapData.player.startTime = this.time.now;
        this.lapData.ai.startTime = this.time.now;
        this.updateLapUI();
    }

    /**
     * Creates a polygon from a car's body vertices
     */
    getCarPolygon(car) {
        if (!car || !car.body || !car.body.vertices) {
            return new Phaser.Geom.Polygon(); 
        }
        return new Phaser.Geom.Polygon(car.body.vertices);
    }

    /**
     * Casts rays from a car to detect nearby walls and objects
     */
    castRays(car, graphics, distances, walls, otherPolygons, rayColor) {
        graphics.clear();

        const rayAngles = [
            car.rotation,                    // [0] Front
            car.rotation - Math.PI / 4,      // [1] Front-Left
            car.rotation + Math.PI / 4,      // [2] Front-Right
            car.rotation - Math.PI / 2,      // [3] Left
            car.rotation + Math.PI / 2,       // [4] Right
            car.rotation - (3 * Math.PI / 4), // [5] Rear-Left
            car.rotation + (3 * Math.PI / 4)  // [6] Rear-Right
        ];
        
        if (this.showRays) {
            graphics.lineStyle(1, rayColor, 0.5);
        }
        const carX = car.x;
        const carY = car.y;

        rayAngles.forEach((angle, index) => {
            const endX = carX + Math.cos(angle) * this.RAY_LENGTH;
            const endY = carY + Math.sin(angle) * this.RAY_LENGTH;
            const rayLine = new Phaser.Geom.Line(carX, carY, endX, endY);
            
            let closestDistance = this.RAY_LENGTH;
            let closestHitPoint = { x: endX, y: endY };
            
            // Check intersections with walls
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

            // Check intersections with other car polygons
            otherPolygons.forEach(polygon => {
                const points = polygon.points;
                if (points.length < 2) return;
                
                for (let i = 0; i < points.length; i++) {
                    const p1 = points[i];
                    const p2 = points[(i + 1) % points.length];
                    const segmentLine = new Phaser.Geom.Line(p1.x, p1.y, p2.x, p2.y);
                    const intersectionPoint = new Phaser.Geom.Point();
                    
                    if (Phaser.Geom.Intersects.LineToLine(rayLine, segmentLine, intersectionPoint)) {
                        const distance = Phaser.Math.Distance.Between(
                            carX, carY, 
                            intersectionPoint.x, intersectionPoint.y
                        );
                        if (distance < closestDistance) {
                            closestDistance = distance;
                            closestHitPoint = { x: intersectionPoint.x, y: intersectionPoint.y };
                        }
                    }
                }
            });
            
            // Store normalized distance (0 to 1)
            distances[index] = closestDistance / this.RAY_LENGTH;
            
            // Draw the ray
            if (this.showRays){
                graphics.lineBetween(carX, carY, closestHitPoint.x, closestHitPoint.y);
                graphics.fillStyle(0xff0000);
                graphics.fillCircle(closestHitPoint.x, closestHitPoint.y, 3);
            }
        });
    }

    /**
     * Handles player car hitting a wall
     */
    onPlayerWallHit() {
        if (!this.playerCar.body) return;
        
        this.crashCount++;
        this.crashText.textContent = 'Crashes: ' + this.crashCount;
        
        // Reduce velocity on crash
        const currentVel = this.playerCar.body.velocity;
        this.playerCar.setVelocity(currentVel.x * 0.5, currentVel.y * 0.5);
        
        // Play crash sound
        if (this.paceNoteManager) {
            this.paceNoteManager.playCrashSound();
        }
        
        // Record crash in telemetry if recording
        if (this.isRecording) {
            this.telemetryData.push(this.createTelemetryFrame(true));
        }
    }

    /**
     * Creates a telemetry data frame for recording
     */
    createTelemetryFrame(crashed = false) {
        const playerVel = this.playerCar.body.velocity;
        const aiVel = this.aiCar.body.velocity;
        
        let inputState = {
            inputUp: this.keys.up.isDown,
            inputDown: this.keys.down.isDown,
            inputLeft: this.keys.left.isDown,
            inputRight: this.keys.right.isDown,
            gamepadStickX: 0,
            gamepadGas: 0,
            gamepadBrake: 0
        };

        // Capture gamepad input if connected
        if (this.gamepad && this.gamepad.connected) {
            inputState.inputUp = false;
            inputState.inputDown = false;
            inputState.inputLeft = false;
            inputState.inputRight = false;
            inputState.gamepadStickX = this.gamepad.axes[0].value;
            inputState.gamepadGas = this.gamepad.buttons[7].value;
            inputState.gamepadBrake = this.gamepad.buttons[6].value;
        }

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
            ...inputState,
            playerRayDistances: [...this.rayDistances],
            aiRayDistances: [...this.aiRayDistances],
            crashed: crashed
        };
    }

    /**
     * Checks for upcoming turns using raycasting data and announces them
     * This is called every frame but has built-in cooldown to prevent spam
     */
    checkForTurns() {
        // Only check if race has started and we have the audio system
        if (!this.raceStarted || !this.paceNoteManager) return;
        
        // Cooldown check (frame-based)
        if (this.frameCount - this.lastTurnCheckFrame < this.TURN_CHECK_COOLDOWN) {
            return;
        }
        
        // Configuration for turn detection
        const TURN_THRESHOLD = 0.25;  // How much shorter one side must be
        const MAX_DISTANCE = 0.7;     // Max distance to consider (closer = imminent turn)
        const MIN_SPEED = 50;          // Only announce turns if moving
        
        // Only check turns if we're moving
        if (this.playerSpeed < MIN_SPEED) return;
        
        // Get the front-left and front-right ray distances
        const frontLeft = this.rayDistances[1];   // Front-Left ray
        const frontRight = this.rayDistances[2];  // Front-Right ray
        
        // Only trigger if at least one side is relatively close
        // (we're approaching a wall/turn)
        if (frontLeft > MAX_DISTANCE && frontRight > MAX_DISTANCE) {
            return; // Open space ahead, no turn needed
        }
        
        // Calculate the difference
        const difference = frontLeft - frontRight;
        
        // Determine turn direction
        if (difference < -TURN_THRESHOLD) {
            // Front-Right is much shorter = RIGHT TURN ahead
            console.log(`🏁 Turn detected: RIGHT (FL: ${frontLeft.toFixed(2)}, FR: ${frontRight.toFixed(2)})`);
            this.paceNoteManager.playTurnRight();
            this.lastTurnCheckFrame = this.frameCount;
        } 
        else if (difference > TURN_THRESHOLD) {
            // Front-Left is much shorter = LEFT TURN ahead
            console.log(`🏁 Turn detected: LEFT (FL: ${frontLeft.toFixed(2)}, FR: ${frontRight.toFixed(2)})`);
            this.paceNoteManager.playTurnLeft();
            this.lastTurnCheckFrame = this.frameCount;
        }
    }

    /**
     * Main update loop - called every frame
     */
    update() {
        this.frameCount++;

        // Update lap timers
        const now = this.time.now;
        const playerCurrentTime = (now - this.lapData.player.startTime) / 1000.0;
        this.playerCurrentText.textContent = `Current: ${playerCurrentTime.toFixed(2)}s`;
        
        const aiCurrentTime = (now - this.lapData.ai.startTime) / 1000.0;
        this.aiCurrentText.textContent = `Current: ${aiCurrentTime.toFixed(2)}s`;
       
        // --- PLAYER INPUT HANDLING ---
        let thrust = 0; 
        let angularVelocity = 0;

        // Prioritize gamepad if connected
        if (this.gamepad && this.gamepad.connected) {
            const steer = this.gamepad.axes[0].value;
            if (Math.abs(steer) > 0.1) {
                angularVelocity = steer * this.ANGULAR_VELOCITY;
            }

            const gas = this.gamepad.buttons[7].value;
            const brake = this.gamepad.buttons[6].value;

            if (gas > 0.05) {
                thrust = gas * this.ACCELERATION_FORCE;
            } else if (brake > 0.05) {
                thrust = -brake * this.ACCELERATION_FORCE * 0.5;
            }
        } 
        // Keyboard fallback
        else {
            if (this.keys.up.isDown) thrust = this.ACCELERATION_FORCE;
            else if (this.keys.down.isDown) thrust = -this.ACCELERATION_FORCE * 0.5;

            if (this.keys.left.isDown) angularVelocity = -this.ANGULAR_VELOCITY;
            else if (this.keys.right.isDown) angularVelocity = this.ANGULAR_VELOCITY;
        }

        // Apply player car physics
        this.playerCar.setAngularVelocity(angularVelocity);
        if (thrust !== 0) {
            const angle = this.playerCar.rotation;
            this.playerCar.applyForce({
                x: Math.cos(angle) * thrust,
                y: Math.sin(angle) * thrust
            });
        }
       
        // Speed limiting
        const velocity = this.playerCar.body.velocity;
        const currentSpeed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
        if (currentSpeed > this.MAX_SPEED) {
            this.playerCar.setVelocity(
                (velocity.x / currentSpeed) * this.MAX_SPEED,
                (velocity.y / currentSpeed) * this.MAX_SPEED
            );
        }
        
        this.playerSpeed = currentSpeed;
        this.speedText.textContent = 'Speed: ' + Math.round(currentSpeed);
        this.playerAngle = this.playerCar.rotation;

        // --- RAYCASTING ---
        const playerPolygon = this.getCarPolygon(this.playerCar);
        const aiPolygon = this.getCarPolygon(this.aiCar);
        const currentGeomWalls = this.trackEditor.getGeomWalls();
        
        // Cast rays for player (green rays)
        this.castRays(
            this.playerCar,
            this.rayGraphics,
            this.rayDistances,
            currentGeomWalls,
            [aiPolygon],
            0x00ff00
        );
        
        // Cast rays for AI (cyan rays)
        this.castRays(
            this.aiCar,
            this.aiRayGraphics,
            this.aiRayDistances,
            currentGeomWalls,
            [playerPolygon],
            0x00ffff
        );

        // --- CHECK FOR TURNS (PACE NOTES) ---
        this.checkForTurns();
       
        // --- AI CAR CONTROL ---
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
            this.aiCar.applyForce({
                x: Math.cos(angle) * aiAction.thrust,
                y: Math.sin(angle) * aiAction.thrust
            });
        }
       
        // --- TELEMETRY RECORDING ---
        if (Phaser.Input.Keyboard.JustDown(this.keys.space)) {
            this.isRecording = !this.isRecording;
            this.recordingText.textContent = 
                this.isRecording ? 'REC - Recording...' : 'Press SPACE to record';
            this.recordingText.style.color = this.isRecording ? '#ff0000' : '#ffffff';
            
            if (this.isRecording) {
                this.crashCount = 0;
                this.crashText.textContent = 'Crashes: 0';
            }
        }
        
        if (Phaser.Input.Keyboard.JustDown(this.keys.h)) {
            this.showRays = !this.showRays;
            // If we just hid them, clear the graphics one last time
            if (!this.showRays) {
                this.rayGraphics.clear();
                this.aiRayGraphics.clear();
            }
        }

        if (this.isRecording && this.frameCount % 3 === 0) {
            this.telemetryData.push(this.createTelemetryFrame(false));
        }
        
        // Export telemetry
        if (Phaser.Input.Keyboard.JustDown(this.keys.e)) {
            this.exportTelemetry();
        }
        
        // Reset game
        if (Phaser.Input.Keyboard.JustDown(this.keys.r)) {
            this.scene.restart();
        }
    }

    /**
     * Exports telemetry data as JSON file
     */
    exportTelemetry() {
        if (this.telemetryData.length === 0) {
            alert('No data to export!');
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

    /**
     * Checks if a collision involves the finish line and a specific car
     */
    checkFinishLine(bodyA, bodyB, carType) {
        const carLabel = (carType === 'player') ? 'playerCar' : 'aiCar';
        let carBody = null;
        let finishBody = null;

        if (bodyA.label === carLabel) carBody = bodyA;
        else if (bodyB.label === carLabel) carBody = bodyB;

        if (bodyA.label === 'finishLine') finishBody = bodyA;
        else if (bodyB.label === 'finishLine') finishBody = bodyB;

        if (carBody && finishBody) {
            this.completeLap(carType);
        }
    }

    /**
     * Handles the logic for completing a lap
     */
    completeLap(carType) {
        const data = this.lapData[carType];
        
        // Debounce to prevent multiple triggers
        if (!data.canTrigger) return;

        const now = this.time.now;
        data.canTrigger = false;

        // Don't record the first pass (lap 0)
        if (data.count >= 0) {
            const lapTime = (now - data.startTime) / 1000.0;
            data.lastLap = lapTime;
            
            if (lapTime < data.bestLap || data.bestLap === 0) {
                data.bestLap = lapTime;
            }
            
            // Play "Lap complete" announcement for player only
            if (carType === 'player' && this.paceNoteManager) {
                this.paceNoteManager.playLapComplete();
            }
        }

        data.count++;
        data.startTime = now; // Start timer for the next lap
        this.updateLapUI();

        // Set a 5-second cooldown before the line can be triggered again
        this.time.delayedCall(5000, () => {
            data.canTrigger = true;
        });
    }

    /**
     * Updates all the lap-related UI text
     */
    updateLapUI() {
        const p = this.lapData.player;
        this.playerLapText.textContent = `Laps: ${Math.max(0, p.count)}`;
        this.playerLastText.textContent = `Last: ${p.lastLap.toFixed(2)}s`;
        this.playerBestText.textContent = `Best: ${p.bestLap.toFixed(2)}s`;

        const a = this.lapData.ai;
        this.aiLapText.textContent = `Laps: ${Math.max(0, a.count)}`;
        this.aiLastText.textContent = `Last: ${a.lastLap.toFixed(2)}s`;
        this.aiBestText.textContent = `Best: ${a.bestLap.toFixed(2)}s`;
    }
}

// --- Phaser Game Configuration ---
const config = {
    type: Phaser.AUTO,
    width: 1200,
    height: 1200,
    physics: {
        default: 'matter',
        matter: {
            gravity: { y: 0 },
            debug: false
        }
    },
    input: {
        gamepad: true
    },
    scene: GameScene,
    parent: 'game-container'
};


const game = new Phaser.Game(config);
window.game = game;