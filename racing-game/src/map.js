import Phaser from 'phaser';

// Define and EXPORT dimensions for our preset track pieces
export const PIECE_WIDTH = 100; // e.g., a straight piece is 100x100
const WALL_THICKNESS = 10;

/**
 * Manages creating and editing the race track.
 * It handles the visual graphics, the physics bodies,
 * and the raycasting geometry.
 */
export class TrackEditor {
    constructor(scene) {
        this.scene = scene;
        this.geomWalls = []; // For raycasting
        this.wallBodies = []; // To hold Matter.js bodies
        this.graphics = this.scene.add.graphics();

        // Store the constant for easy access by other classes
        this.PIECE_WIDTH = PIECE_WIDTH;
    }

    /**
     * Creates the default oval track.
     */
    createOvalTrack() {
        // ... (rest of the function is unchanged) ...
        // --- Visual Road Surface ---
        // 1. Draw the outer road boundary
        this.graphics.fillStyle(0x333333, 1);
        this.graphics.fillRect(100, 100, 600, 600);
        // 2. "Cut out" the middle
        this.graphics.fillStyle(0x222222, 1); // Background color
        this.graphics.fillRect(200, 200, 400, 400);

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
        
        // --- Build Physics and Raycast Walls from Data ---
        trackData.forEach(wall => {
            this.addWall(wall.x, wall.y, wall.w, wall.h);
        });
    }

    /**
     * A generic function to add a wall piece.
     * (This function is unchanged)
     */
    addWall(x, y, w, h) {
        // ... (unchanged) ...
        const wallOptions = { isStatic: true, friction: 0.0, restitution: 0.1, label: 'wall' };

        // 1. Add Matter.js physics body (invisible)
        const body = this.scene.matter.add.rectangle(x, y, w, h, wallOptions);
        this.wallBodies.push(body);

        // 2. Add Phaser.Geom.Rectangle for raycasting (top-left based)
        const geomRect = new Phaser.Geom.Rectangle(x - w / 2, y - h / 2, w, h);
        this.geomWalls.push(geomRect);
    }

    /**
     * Adds a new track piece based on a type and world coordinates.
     * (This function is unchanged)
     */
    addTrackPiece(pieceType, x, y) {
        // ... (unchanged) ...
        // Draw the visual "road" part
        this.graphics.fillStyle(0x333333, 1);
        this.graphics.fillRect(x - PIECE_WIDTH / 2, y - PIECE_WIDTH / 2, PIECE_WIDTH, PIECE_WIDTH);

        // Add walls based on the piece type
        switch (pieceType) {
            case 'straight-h':
                // Top wall
                this.addWall(x, y - PIECE_WIDTH / 2 + WALL_THICKNESS / 2, PIECE_WIDTH, WALL_THICKNESS);
                // Bottom wall
                this.addWall(x, y + PIECE_WIDTH / 2 - WALL_THICKNESS / 2, PIECE_WIDTH, WALL_THICKNESS);
                break;
            
            case 'straight-v':
                // Left wall
                this.addWall(x - PIECE_WIDTH / 2 + WALL_THICKNESS / 2, y, WALL_THICKNESS, PIECE_WIDTH);
                // Right wall
                this.addWall(x + PIECE_WIDTH / 2 - WALL_THICKNESS / 2, y, WALL_THICKNESS, PIECE_WIDTH);
                break;
            
            case 'turn-l': // e.g., a top-left corner piece
                // Top wall
                this.addWall(x, y - PIECE_WIDTH / 2 + WALL_THICKNESS / 2, PIECE_WIDTH, WALL_THICKNESS);
                // Left wall
                this.addWall(x - PIECE_WIDTH / 2 + WALL_THICKNESS / 2, y, WALL_THICKNESS, PIECE_WIDTH);
                
                // Draw inner "cutout"
                this.graphics.fillStyle(0x222222, 1);
                this.graphics.fillRect(
                    x - PIECE_WIDTH / 2, 
                    y - PIECE_WIDTH / 2, 
                    PIECE_WIDTH - WALL_THICKNESS, 
                    PIECE_WIDTH - WALL_THICKNESS
                );
                break;
            
            // Add more cases for other turns (right, bottom-left, etc.)
        }
    }

    /**
     * Returns the list of geometry walls for raycasting.
     * (This function is unchanged)
     */
    getGeomWalls() {
        // ... (unchanged) ...
        return this.geomWalls;
    }

    /**
     * Clears the entire track.
     * (This function is unchanged)
     */
    clearTrack() {
        // ... (unchanged) ...
        // Clear graphics
        this.graphics.clear();
        
        // Remove physics bodies
        this.scene.matter.world.remove(this.wallBodies);
        
        // Clear arrays
        this.wallBodies = [];
        this.geomWalls = [];

        // Redraw background
        this.graphics.fillStyle(0x222222, 1);
        this.graphics.fillRect(0, 0, this.scene.cameras.main.width, this.scene.cameras.main.height);
    }
}