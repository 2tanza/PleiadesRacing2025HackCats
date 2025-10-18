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

        // --- Create the Track Editor ---
        this.trackEditor = new TrackEditor(this);
        
        // --- Load existing map ---
        // This will draw any map found in local storage
        this.trackEditor.loadTrack();

        // --- Grid Snapping Preview ---
        this.previewRect = this.add.rectangle(
            0, 0, 
            this.trackEditor.PIECE_WIDTH, this.trackEditor.PIECE_WIDTH, 
            0xffffff, 0.3
        )
        .setVisible(false)
        .setDepth(100);

        // --- Listen for UI events from create.html ---
        this.game.events.on('addTrackPiece', this.handleDrop, this);
        this.game.events.on('clearTrack', this.handleClear, this);
        this.game.events.on('updatePreview', this.handlePreview, this);
        this.game.events.on('hidePreview', this.handleHidePreview, this);
        this.game.events.on('saveTrack', this.handleSave, this); // <-- NEW
    }

    /**
     * Helper function to calculate grid-snapped coordinates.
     * (Copied from old main.js)
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
     * (Copied from old main.js)
     */
    handlePreview(data) {
        const worldPoint = this.cameras.main.getWorldPoint(data.x, data.y);
        const snapped = this.getSnappedCoordinates(worldPoint.x, worldPoint.y);
        this.previewRect.setPosition(snapped.x, snapped.y).setVisible(true);
    }

    /**
     * Handles the 'hidePreview' event from the UI.
     * (Copied from old main.js)
     */
    handleHidePreview() {
        this.previewRect.setVisible(false);
    }

    /**
     * Handles the 'addTrackPiece' event from the UI.
     * (Copied from old main.js)
     */
    handleDrop(data) {
        const worldPoint = this.cameras.main.getWorldPoint(data.x, data.y);
        const snapped = this.getSnappedCoordinates(worldPoint.x, worldPoint.y);
        
        // Tell the track editor to add the new piece
        // This will draw it AND update the internal mapGrid
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
     * NEW: Handles the 'saveTrack' event from the UI.
     */
    handleSave() {
        this.trackEditor.saveTrack();
    }
}

// --- Config for the Creator Scene ---
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 800,
    physics: {
        default: 'matter',
        matter: {
            gravity: { y: 0 },
            // Debug is useful for seeing wall hitboxes
            debug: true 
        }
    },
    scene: CreatorScene, // <-- Loads the CreatorScene
    parent: 'game-container'
};

const game = new Phaser.Game(config);
window.game = game; // Expose for the HTML script block