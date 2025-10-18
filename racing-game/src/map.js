import Phaser from 'phaser';

// Define and EXPORT dimensions for our preset track pieces
export const PIECE_WIDTH = 100; // e.g., a straight piece is 100x100
const WALL_THICKNESS = 10;
const GRID_WIDTH = 8; // 800px canvas / 100px pieces
const GRID_HEIGHT = 8; // 800px canvas / 100px pieces

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

        // This is our new data model for the map
        this.mapGrid = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(null));
        
        this.PIECE_WIDTH = PIECE_WIDTH;
    }

    /**
     * Creates the default oval track.
     * This now just populates the wallBodies and geomWalls directly,
     * as it's not grid-based.
     */
    createOvalTrack() {
        this.graphics.fillStyle(0x333333, 1);
        this.graphics.fillRect(100, 100, 600, 600);
        this.graphics.fillStyle(0x222222, 1);
        this.graphics.fillRect(200, 200, 400, 400);
        const trackData = [
            { x: 400, y: 95,  w: 610, h: 10 }, { x: 400, y: 705, w: 610, h: 10 },
            { x: 95,  y: 400, w: 10,  h: 610 }, { x: 705, y: 400, w: 10,  h: 610 },
            { x: 400, y: 205, w: 410, h: 10 }, { x: 400, y: 595, w: 410, h: 10 },
            { x: 195, y: 400, w: 10,  h: 410 }, { x: 605, y: 400, w: 10,  h: 410 }
        ];
        trackData.forEach(wall => {
            this.addWall(wall.x, wall.y, wall.w, wall.h);
        });
    }

    /**
     * A generic function to add a wall piece.
     * (This function is unchanged)
     */
    addWall(x, y, w, h) {
        const wallOptions = { isStatic: true, friction: 0.0, restitution: 0.1, label: 'wall' };
        const body = this.scene.matter.add.rectangle(x, y, w, h, wallOptions);
        this.wallBodies.push(body);
        const geomRect = new Phaser.Geom.Rectangle(x - w / 2, y - h / 2, w, h);
        this.geomWalls.push(geomRect);
    }

    /**
     * MODIFIED: This function now just updates the data grid
     * and triggers a full redraw.
     */
    addTrackPiece(pieceType, x, y) {
        // 1. Update the grid data structure
        const gridX = Math.floor((x - PIECE_WIDTH / 2) / PIECE_WIDTH);
        const gridY = Math.floor((y - PIECE_WIDTH / 2) / PIECE_WIDTH);

        if (gridY >= 0 && gridY < GRID_HEIGHT && gridX >= 0 && gridX < GRID_WIDTH) {
            // NEW: "road" piece sets the grid cell to null (empty)
            if (pieceType === 'road') {
                this.mapGrid[gridY][gridX] = null;
            } else {
                this.mapGrid[gridY][gridX] = pieceType;
            }
        } else {
            console.error("Attempted to place piece outside grid");
            return;
        }

        // 2. Redraw the entire map from the grid
        this.redrawAllFromGrid();
    }

    /**
     * NEW: Clears all visuals/physics and redraws the track
     * based on the current mapGrid data.
     */
    redrawAllFromGrid() {
        // 1. Clear all existing graphics and physics
        this.graphics.clear();
        this.scene.matter.world.remove(this.wallBodies);
        this.wallBodies = [];
        this.geomWalls = [];
        
        // 2. Redraw background
        this.graphics.fillStyle(0x222222, 1);
        this.graphics.fillRect(0, 0, this.scene.cameras.main.width, this.scene.cameras.main.height);

        // 3. Loop through the grid and draw each piece
        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                const pieceType = this.mapGrid[y][x];
                if (pieceType) {
                    const worldX = x * PIECE_WIDTH + PIECE_WIDTH / 2;
                    const worldY = y * PIECE_WIDTH + PIECE_WIDTH / 2;
                    this.drawPiece(pieceType, worldX, worldY);
                }
            }
        }
    }

    /**
     * NEW: This function contains the logic for drawing a
     * single piece. (Extracted from old addTrackPiece)
     */
    drawPiece(pieceType, x, y) {
        // Draw the base road tile for all pieces first
        this.graphics.fillStyle(0x333333, 1);
        this.graphics.fillRect(x - PIECE_WIDTH / 2, y - PIECE_WIDTH / 2, PIECE_WIDTH, PIECE_WIDTH);
        
        // Define wall coordinates
        const topWall    = { x: x, y: y - PIECE_WIDTH / 2 + WALL_THICKNESS / 2, w: PIECE_WIDTH, h: WALL_THICKNESS };
        const bottomWall = { x: x, y: y + PIECE_WIDTH / 2 - WALL_THICKNESS / 2, w: PIECE_WIDTH, h: WALL_THICKNESS };
        const leftWall   = { x: x - PIECE_WIDTH / 2 + WALL_THICKNESS / 2, y: y, w: WALL_THICKNESS, h: PIECE_WIDTH };
        const rightWall  = { x: x + PIECE_WIDTH / 2 - WALL_THICKNESS / 2, y: y, w: WALL_THICKNESS, h: PIECE_WIDTH };

        switch (pieceType) {
            case 'road':
                // Handled by "road" being null in the grid,
                // but if it's called, just draw the road (already done).
                break;
            
            // Straights
            case 'straight-h':
                this.addWall(topWall.x, topWall.y, topWall.w, topWall.h);
                this.addWall(bottomWall.x, bottomWall.y, bottomWall.w, bottomWall.h);
                break;
            
            case 'straight-v':
                this.addWall(leftWall.x, leftWall.y, leftWall.w, leftWall.h);
                this.addWall(rightWall.x, rightWall.y, rightWall.w, rightWall.h);
                break;
            
            // Single Walls
            case 'wall-t':
                this.addWall(topWall.x, topWall.y, topWall.w, topWall.h);
                break;
            case 'wall-b':
                this.addWall(bottomWall.x, bottomWall.y, bottomWall.w, bottomWall.h);
                break;
            case 'wall-l':
                this.addWall(leftWall.x, leftWall.y, leftWall.w, leftWall.h);
                break;
            case 'wall-r':
                this.addWall(rightWall.x, rightWall.y, rightWall.w, rightWall.h);
                break;

            // Turns
            case 'turn-l': // Top-left corner
                this.addWall(topWall.x, topWall.y, topWall.w, topWall.h);
                this.addWall(leftWall.x, leftWall.y, leftWall.w, leftWall.h);
                this.graphics.fillStyle(0x222222, 1);
                this.graphics.fillRect(
                    x + PIECE_WIDTH / 2 - (PIECE_WIDTH - WALL_THICKNESS),
                    y + PIECE_WIDTH / 2 - (PIECE_WIDTH - WALL_THICKNESS),
                    PIECE_WIDTH - WALL_THICKNESS, 
                    PIECE_WIDTH - WALL_THICKNESS
                );
                break;
            
            case 'turn-r': // Top-right corner
                this.addWall(topWall.x, topWall.y, topWall.w, topWall.h);
                this.addWall(rightWall.x, rightWall.y, rightWall.w, rightWall.h);
                this.graphics.fillStyle(0x222222, 1);
                this.graphics.fillRect(
                    x - PIECE_WIDTH / 2,
                    y + PIECE_WIDTH / 2 - (PIECE_WIDTH - WALL_THICKNESS),
                    PIECE_WIDTH - WALL_THICKNESS, 
                    PIECE_WIDTH - WALL_THICKNESS
                );
                break;

            case 'turn-bl': // Bottom-left corner
                this.addWall(bottomWall.x, bottomWall.y, bottomWall.w, bottomWall.h);
                this.addWall(leftWall.x, leftWall.y, leftWall.w, leftWall.h);
                this.graphics.fillStyle(0x222222, 1);
                this.graphics.fillRect(
                    x + PIECE_WIDTH / 2 - (PIECE_WIDTH - WALL_THICKNESS),
                    y - PIECE_WIDTH / 2,
                    PIECE_WIDTH - WALL_THICKNESS, 
                    PIECE_WIDTH - WALL_THICKNESS
                );
                break;

            case 'turn-br': // Bottom-right corner
                this.addWall(bottomWall.x, bottomWall.y, bottomWall.w, bottomWall.h);
                this.addWall(rightWall.x, rightWall.y, rightWall.w, rightWall.h);
                this.graphics.fillStyle(0x222222, 1);
                this.graphics.fillRect(
                    x - PIECE_WIDTH / 2,
                    y - PIECE_WIDTH / 2,
                    PIECE_WIDTH - WALL_THICKNESS, 
                    PIECE_WIDTH - WALL_THICKNESS
                );
                break;
        }
    }

    /**
     * Returns the list of geometry walls for raycasting.
     * (This function is unchanged)
     */
    getGeomWalls() {
        return this.geomWalls;
    }

    /**
     * MODIFIED: Clears the track by resetting the grid
     * and redrawing the empty state.
     */
    clearTrack() {
        // 1. Reset the data grid
        this.mapGrid = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(null));
        
        // 2. Redraw the (now empty) grid
        this.redrawAllFromGrid();
        
        // 3. Clear from storage
        localStorage.removeItem('customMap');
        console.log('Track cleared and storage erased.');
    }
    
    /**
     * Saves the current map grid to local storage.
     * (This function is unchanged)
     */
    saveTrack() {
        localStorage.setItem('customMap', JSON.stringify(this.mapGrid));
        alert('Track Saved!');
        console.log('Track saved to localStorage.');
    }
    
    /**
     * MODIFIED: Loads track from local storage and
     * builds it by triggering a full redraw.
     */
    loadTrack() {
        const savedGrid = localStorage.getItem('customMap');
        if (!savedGrid) {
            console.log('No custom map found in storage.');
            // Draw the empty background
            this.redrawAllFromGrid();
            return false;
        }
        
        console.log('Loading custom map from storage...');
        this.mapGrid = JSON.parse(savedGrid);
        
        // Redraw the entire map from the loaded grid data
        this.redrawAllFromGrid();
        
        return true;
    }
}