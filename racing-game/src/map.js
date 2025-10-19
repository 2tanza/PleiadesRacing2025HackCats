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
        this.finishLine = null; 

        this.mapGrid = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(null));
        
        this.PIECE_WIDTH = PIECE_WIDTH;
    }

    // ... (createOvalTrack, addWall, addTrackPiece, redrawAllFromGrid, drawPiece, getGeomWalls, clearTrack methods remain unchanged) ...

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
        this.graphics.fillStyle(0x999999); // A visible gray color
        this.graphics.fillRect(geomRect.x, geomRect.y, geomRect.width, geomRect.height);
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
        if (this.finishLine) { // <-- ADD THIS BLOCK
            this.scene.matter.world.remove(this.finishLine);
            this.finishLine = null;
        }
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
            case 'finish-line-h':
                // Draw visual road
                this.graphics.fillStyle(0x333333, 1);
                this.graphics.fillRect(x - PIECE_WIDTH / 2, y - PIECE_WIDTH / 2, PIECE_WIDTH, PIECE_WIDTH);

                // Draw visual finish line (a white rectangle)
                this.graphics.fillStyle(0xffffff, 0.8);
                this.graphics.fillRect(x - 5, y - PIECE_WIDTH / 2, 10, PIECE_WIDTH);

                // Add the SENSOR body
                this.finishLine = this.scene.matter.add.rectangle(x, y, 10, PIECE_WIDTH, {
                    isStatic: true,
                    isSensor: true, // <-- This makes it a sensor
                    label: 'finishLine' // <-- We use this label in game.js
                });
                this.addWall(topWall.x, topWall.y, topWall.w, topWall.h);
                this.addWall(bottomWall.x, bottomWall.y, bottomWall.w, bottomWall.h);
                break;
            case 'finish-line-v':
                // Draw visual road
                this.graphics.fillStyle(0x333333, 1);
                this.graphics.fillRect(x - PIECE_WIDTH / 2, y - PIECE_WIDTH / 2, PIECE_WIDTH, PIECE_WIDTH);
                
                // Draw visual finish line (a horizontal white rectangle)
                this.graphics.fillStyle(0xffffff, 0.8);
                this.graphics.fillRect(x - PIECE_WIDTH / 2, y - 5, PIECE_WIDTH, 10);

                // Add the SENSOR body (horizontal)
                this.finishLine = this.scene.matter.add.rectangle(x, y, PIECE_WIDTH, 10, {
                    isStatic: true,
                    isSensor: true, 
                    label: 'finishLine' // Use the *same* label
                });

                // Add the solid left and right walls
                this.addWall(leftWall.x, leftWall.y, leftWall.w, leftWall.h);
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
        alert('Track Saved to Local Storage!');
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
        if (!this._isValidMapGrid(loadedMapGrid)) {
            console.warn(`Loaded map has wrong dimensions (or is invalid). Discarding map.`);
            localStorage.removeItem('customMap'); 
            this.redrawAllFromGrid(); 
            return false; 
        }
        
        this.mapGrid = loadedMapGrid;
        this.redrawAllFromGrid();
        return true;
    }

    // --- NEW METHODS ---

    /**
     * Validates if the loaded grid is a 12x12 array.
     * @param {Array} gridData - The parsed map data.
     */
    _isValidMapGrid(gridData) {
        if (!gridData || !Array.isArray(gridData) || gridData.length !== GRID_HEIGHT) {
            return false;
        }
        for (let row of gridData) {
            if (!Array.isArray(row) || row.length !== GRID_WIDTH) {
                return false;
            }
        }
        return true;
    }

    /**
     * Triggers a browser download for the current mapGrid.
     */
    exportTrackToFile() {
        try {
            const dataStr = JSON.stringify(this.mapGrid);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = 'my_track.json';
            document.body.appendChild(a);
            a.click();
            
            // Cleanup
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            console.log('Track exported successfully.');
        } catch (e) {
            console.error('Failed to export track:', e);
            alert('Error exporting track. See console for details.');
        }
    }

    /**
     * Loads a track from a user-provided JSON file.
     * @param {File} file - The file object from the <input type="file">
     */
    importTrackFromFile(file) {
        if (!file) {
            alert('No file selected.');
            return;
        }
        
        if (file.type !== 'application/json') {
            alert('Invalid file type. Please select a .json file.');
            return;
        }

        const reader = new FileReader();

        reader.onload = (event) => {
            try {
                const fileContent = event.target.result;
                const loadedMapGrid = JSON.parse(fileContent);

                // Validate the loaded data
                if (!this._isValidMapGrid(loadedMapGrid)) {
                    alert('Invalid map file. The map must be a 12x12 grid.');
                    return;
                }

                // If valid, load it
                this.mapGrid = loadedMapGrid;
                this.redrawAllFromGrid();
                
                // Also save it to local storage for convenience
                this.saveTrack(); 
                
                alert('Track imported successfully!');
                console.log('Track loaded from file and saved to local storage.');

            } catch (e) {
                console.error('Failed to read or parse imported file:', e);
                alert('Error importing file. Is it a valid track JSON? See console for details.');
            }
        };

        reader.onerror = (event) => {
            console.error('File reading error:', event);
            alert('An error occurred while reading the file.');
        };

        reader.readAsText(file);
    }
    // --- END NEW METHODS ---
}