import Phaser from 'phaser';

// Define and EXPORT dimensions for our preset track pieces
export const PIECE_WIDTH = 100; // e.g., a straight piece is 100x100
const WALL_THICKNESS = 10;
const GRID_WIDTH = 12; // 1200px canvas / 100px pieces
const GRID_HEIGHT = 12; // 1200px canvas / 100px pieces

/**
 * Manages creating and editing the race track.
 */
export class TrackEditor {
    constructor(scene) {
        this.scene = scene;
        this.geomWalls = []; // For raycasting
        this.wallBodies = []; // To hold Matter.js bodies
        this.graphics = this.scene.add.graphics();

        this.mapGrid = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(null));
        
        this.PIECE_WIDTH = PIECE_WIDTH;
    }

    /**
     * Creates the default oval track.
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
     */
    addWall(x, y, w, h) {
        const wallOptions = { isStatic: true, friction: 0.0, restitution: 0.1, label: 'wall' };
        const body = this.scene.matter.add.rectangle(x, y, w, h, wallOptions);
        this.wallBodies.push(body);
        const geomRect = new Phaser.Geom.Rectangle(x - w / 2, y - h / 2, w, h);
        this.geomWalls.push(geomRect);
    }

    /**
     * Updates the data grid and triggers a full redraw.
     */
    addTrackPiece(pieceType, x, y) {
        const gridX = Math.floor((x - PIECE_WIDTH / 2) / PIECE_WIDTH);
        const gridY = Math.floor((y - PIECE_WIDTH / 2) / PIECE_WIDTH);

        if (gridY >= 0 && gridY < GRID_HEIGHT && gridX >= 0 && gridX < GRID_WIDTH) {
            if (pieceType === 'road') {
                this.mapGrid[gridY][gridX] = null;
            } else {
                this.mapGrid[gridY][gridX] = pieceType;
            }
        } else {
            console.error("Attempted to place piece outside grid");
            return;
        }

        this.redrawAllFromGrid();
    }

    /**
     * Clears all visuals/physics and redraws the track
     * based on the current mapGrid data.
     */
    redrawAllFromGrid() {
        this.graphics.clear();
        this.scene.matter.world.remove(this.wallBodies);
        this.wallBodies = [];
        this.geomWalls = [];
        
        this.graphics.fillStyle(0x222222, 1);
        this.graphics.fillRect(0, 0, this.scene.cameras.main.width, this.scene.cameras.main.height);

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
     * This function contains the logic for drawing a single piece.
     */
    drawPiece(pieceType, x, y) {
        this.graphics.fillStyle(0x333333, 1);
        this.graphics.fillRect(x - PIECE_WIDTH / 2, y - PIECE_WIDTH / 2, PIECE_WIDTH, PIECE_WIDTH);
        
        const topWall    = { x: x, y: y - PIECE_WIDTH / 2 + WALL_THICKNESS / 2, w: PIECE_WIDTH, h: WALL_THICKNESS };
        const bottomWall = { x: x, y: y + PIECE_WIDTH / 2 - WALL_THICKNESS / 2, w: PIECE_WIDTH, h: WALL_THICKNESS };
        const leftWall   = { x: x - PIECE_WIDTH / 2 + WALL_THICKNESS / 2, y: y, w: WALL_THICKNESS, h: PIECE_WIDTH };
        const rightWall  = { x: x + PIECE_WIDTH / 2 - WALL_THICKNESS / 2, y: y, w: WALL_THICKNESS, h: PIECE_WIDTH };

        switch (pieceType) {
            case 'road':
                break;
            case 'straight-h':
                this.addWall(topWall.x, topWall.y, topWall.w, topWall.h);
                this.addWall(bottomWall.x, bottomWall.y, bottomWall.w, bottomWall.h);
                break;
            case 'straight-v':
                this.addWall(leftWall.x, leftWall.y, leftWall.w, leftWall.h);
                this.addWall(rightWall.x, rightWall.y, rightWall.w, rightWall.h);
                break;
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
            case 'turn-l': // Top-left
                this.addWall(topWall.x, topWall.y, topWall.w, topWall.h);
                this.addWall(leftWall.x, leftWall.y, leftWall.w, leftWall.h);
                break;
            case 'turn-r': // Top-right
                this.addWall(topWall.x, topWall.y, topWall.w, topWall.h);
                this.addWall(rightWall.x, rightWall.y, rightWall.w, rightWall.h); 
                break;
            case 'turn-bl': // Bottom-left
                this.addWall(bottomWall.x, bottomWall.y, bottomWall.w, bottomWall.h);
                this.addWall(leftWall.x, leftWall.y, leftWall.w, leftWall.h);
                break;
            case 'turn-br': // Bottom-right
                this.addWall(bottomWall.x, bottomWall.y, bottomWall.w, bottomWall.h);
                this.addWall(rightWall.x, rightWall.y, rightWall.w, rightWall.h);
                break;
        }
    }

    /**
     * Returns the list of geometry walls for raycasting.
     */
    getGeomWalls() {
        return this.geomWalls;
    }

    /**
     * Clears the track by resetting the grid
     */
    clearTrack() {
        this.mapGrid = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(null));
        this.redrawAllFromGrid();
        localStorage.removeItem('customMap');
        console.log('Track cleared and storage erased.');
    }
    
    /**
     * Saves the current map grid to local storage.
     */
    saveTrack() {
        localStorage.setItem('customMap', JSON.stringify(this.mapGrid));
        alert('Track Saved!');
        console.log('Track saved to localStorage.');
    }
    
    /**
     * Loads track from local storage and
     * builds it by triggering a full redraw.
     */
    loadTrack() {
        const savedGrid = localStorage.getItem('customMap');
        if (!savedGrid) {
            console.log('No custom map found in storage.');
            this.redrawAllFromGrid();
            return false;
        }
        
        console.log('Loading custom map from storage...');
        let loadedMapGrid;
        try {
            loadedMapGrid = JSON.parse(savedGrid);
        } catch (e) {
            console.error("Failed to parse map from localStorage. Clearing it.", e);
            localStorage.removeItem('customMap');
            this.redrawAllFromGrid();
            return false;
        }

        // Validation check for 12x12
        if (!loadedMapGrid || !Array.isArray(loadedMapGrid) || loadedMapGrid.length !== GRID_HEIGHT || (loadedMapGrid[0] && loadedMapGrid[0].length !== GRID_WIDTH)) {
            console.warn(`Loaded map has wrong dimensions (or is invalid). Discarding map.`);
            localStorage.removeItem('customMap'); 
            this.redrawAllFromGrid(); 
            return false; 
        }
        
        this.mapGrid = loadedMapGrid;
        this.redrawAllFromGrid();
        return true;
    }
}