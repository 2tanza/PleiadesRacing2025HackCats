import Phaser from 'phaser';
import { TrackEditor } from './map.js';

/**
 * CreatorScene
 * This scene is ONLY for building and saving maps.
 */
class CreatorScene extends Phaser.Scene {
    constructor() {
        super({ key: 'CreatorScene' });
    }

    create() {
        this.cameras.main.setBackgroundColor(0x222222);

        this.trackEditor = new TrackEditor(this);
        
        this.trackEditor.loadTrack();

        // --- ADDED ---
        // Add red dots for the hardcoded spawn points from game.js
        const spawnPointColor = 0xff0000;
        const spawnPointRadius = 5;
        const spawnPointDepth = 101; // On top of preview rect

        // Player 1 spawn (from game.js)
        this.add.circle(150, 150, spawnPointRadius, spawnPointColor)
            .setDepth(spawnPointDepth);
            
        // AI Car spawn (from game.js)
        this.add.circle(150, 200, spawnPointRadius, spawnPointColor)
            .setDepth(spawnPointDepth);
        // --- END ADDED ---

        this.previewRect = this.add.rectangle(
            0, 0, 
            this.trackEditor.PIECE_WIDTH, this.trackEditor.PIECE_WIDTH, 
            0xffffff, 0.3
        )
        .setVisible(false)
        .setDepth(100);

        this.game.events.on('addTrackPiece', this.handleDrop, this);
        this.game.events.on('clearTrack', this.handleClear, this);
        this.game.events.on('updatePreview', this.handlePreview, this);
        this.game.events.on('hidePreview', this.handleHidePreview, this);
        this.game.events.on('saveTrack', this.handleSave, this);
    }

    /**
     * Helper function to calculate grid-snapped coordinates.
     */
    getSnappedCoordinates(worldX, worldY) {
        const PIECE_WIDTH = this.trackEditor.PIECE_WIDTH;
        const gridX = Math.floor(worldX / PIECE_WIDTH) * PIECE_WIDTH;
        const gridY = Math.floor(worldY / PIECE_WIDTH) * PIECE_WIDTH;
        const snappedX = gridX + PIECE_WIDTH / 2;
        const snappedY = gridY + PIECE_WIDTH / 2;
        return { x: snappedX, y: snappedY };
    }

    /**
     * Handles the 'updatePreview' event from the UI.
     */
    handlePreview(data) {
        const worldPoint = this.cameras.main.getWorldPoint(data.x, data.y);
        const snapped = this.getSnappedCoordinates(worldPoint.x, worldPoint.y);
        this.previewRect.setPosition(snapped.x, snapped.y).setVisible(true);
    }

    /**
     * Handles the 'hidePreview' event from the UI.
     */
    handleHidePreview() {
        this.previewRect.setVisible(false);
    }

    /**
     * Handles the 'addTrackPiece' event from the UI.
     */
    handleDrop(data) {
        const worldPoint = this.cameras.main.getWorldPoint(data.x, data.y);
        const snapped = this.getSnappedCoordinates(worldPoint.x, worldPoint.y);
        
        this.trackEditor.addTrackPiece(data.pieceType, snapped.x, snapped.y);
        this.handleHidePreview();
    }

    /**
     * Handles the 'clearTrack' event from the UI.
     */
    handleClear() {
        this.trackEditor.clearTrack();
        this.handleHidePreview();
        console.log('Track cleared!');
    }
    
    /**
     * Handles the 'saveTrack' event from the UI.
     */
    handleSave() {
        this.trackEditor.saveTrack();
    }
}

// --- Config for the Creator Scene ---
const config = {
    type: Phaser.AUTO,
    width: 1200, // 1200x1200
    height: 1200, // 1200x1200
    physics: {
        default: 'matter',
        matter: {
            gravity: { y: 0 },
            debug: true 
        }
    },
    scene: CreatorScene, 
    parent: 'game-container'
};

const game = new Phaser.Game(config);
window.game = game;