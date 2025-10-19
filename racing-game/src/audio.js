/**
 * PaceNoteAudio Class
 *
 * This class manages all audio for pace notes and game events.
 * It connects to the "mcp server" (FastAPI/ElevenAI) via a WebSocket
 * to dynamically generate and stream pacenote audio.
 */
export class PaceNoteAudio {
    
    /**
     * @param {string} url - The URL provided by game.js (which we will ignore)
     */
    constructor(url) {
        // We IGNORE the 'url' parameter from game.js because it's hardcoded.
        // Instead, we build the correct dynamic URL based on the window's location,
        // matching the "voice-" subdomain from our config.yml.
        const voiceHost = 'wss://' + 'voice-' + window.location.hostname + '/ws';
        
        console.log('🎤 PaceNoteAudio: Connecting to', voiceHost);
        this.socket = new WebSocket(voiceHost);

        this.audioQueue = [];
        this.isPlaying = false;
        
        // Cooldowns to prevent spamming pace notes
        this.cooldowns = new Map();
        this.DEFAULT_COOLDOWN = 3000; // 3 seconds

        // --- WebSocket Event Handlers ---

        this.socket.onopen = () => {
            console.log('🎤 PaceNoteAudio: Connection established.');
        };

        this.socket.onmessage = (event) => {
            if (event.data instanceof Blob) {
                // We received a chunk of MP3 data
                this.playAudioBlob(event.data);
            } else if (event.data === 'AUDIO_END') {
                // Server finished sending audio for one request
                console.log('🎤 PaceNoteAudio: Audio stream finished.');
            }
        };

        this.socket.onerror = (error) => {
            console.error('🎤 PaceNoteAudio: WebSocket error:', error);
        };

        this.socket.onclose = () => {
            console.log('🎤 PaceNoteAudio: Connection closed.');
        };

        // --- Static Sound Effects ---
        // Crash sound is a static file, not TTS.
        // We assume it's in the 'public/' folder alongside the car sprites.
        try {
            this.crashSound = new Audio('public/crash.mp3');
            this.crashSound.load();
        } catch (e) {
            console.error("Could not load crash.mp3. Make sure it's in the /public folder.", e);
            this.crashSound = null;
        }
    }

    /**
     * Queues and plays an audio blob (MP3 chunk) from the WebSocket.
     * This ensures audio clips play sequentially.
     * @param {Blob} audioBlob - The audio data chunk.
     */
    playAudioBlob(audioBlob) {
        const audioURL = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioURL);
        
        audio.onended = () => {
            URL.revokeObjectURL(audioURL);
            this.isPlaying = false;
            this.playNextInQueue(); // Play next item
        };
        
        this.audioQueue.push(audio);
        this.playNextInQueue();
    }
    
    /**
     * Helper function to play the next audio in the queue.
     */
    playNextInQueue() {
        if (!this.isPlaying && this.audioQueue.length > 0) {
            this.isPlaying = true;
            const audioToPlay = this.audioQueue.shift();
            audioToPlay.play().catch(e => {
                console.warn("Audio play failed (likely browser policy):", e);
                this.isPlaying = false; // Allow next item
            });
        }
    }

    /**
     * The core function to send text to the MCP server for TTS.
     * @param {string} text - The text to be spoken.
     * @param {string} noteType - A category for cooldown, e.g., "turn" or "start".
     */
    async playPacenote(text, noteType) {
        // Check if this note type is on cooldown
        if (noteType && this.shouldSkipNote(noteType)) {
            console.log(`🎤 PaceNoteAudio: Skipping note [${noteType}] (cooldown).`);
            return;
        }

        // Send the text to the WebSocket
        if (this.socket.readyState === WebSocket.OPEN) {
            console.log(`🎤 PaceNoteAudio: Sending text: "${text}"`);
            this.socket.send(text);
            if (noteType) {
                this.updateCooldown(noteType);
            }
        } else {
            console.error('🎤 PaceNoteAudio: WebSocket not open. Cannot send text.');
        }
    }

    /**
     * Checks if a note type is on cooldown.
     * @param {string} noteType - The category of the note.
     * @returns {boolean} - True if the note should be skipped.
     */
    shouldSkipNote(noteType) {
        const now = Date.now();
        const lastPlayed = this.cooldowns.get(noteType) || 0;
        if (now - lastPlayed < this.DEFAULT_COOLDOWN) {
            return true; // Skip, on cooldown
        }
        return false;
    }

    /**
     * Updates the cooldown timestamp for a note type.
     * @param {string} noteType - The category of the note.
     */
    updateCooldown(noteType) {
        this.cooldowns.set(noteType, Date.now());
    }

    /**
     * This function is preserved but deprecated in favor of playPacenote.
     */
    async playAudioFile(filePath) {
        console.warn(`playAudioFile is deprecated. Using playCrashSound() for static audio.`);
        if (filePath.includes('crash')) {
            this.playCrashSound();
        }
    }

    // --- Public API Functions (Called by game.js) ---

    async playStartMessage() {
        this.playPacenote("Start your engines!", "start");
    }

    async playTurnLeft() {
        this.playPacenote("Left turn", "turn");
    }

    async playTurnRight() {
        this.playPacenote("Right turn", "turn");
    }

    async playLapComplete() {
        this.playPacenote("Lap complete", "lap");
    }

    async playCrashSound() {
        // This is a static sound effect, not TTS. We play it directly.
        if (this.crashSound) {
            this.crashSound.currentTime = 0; // Rewind
            this.crashSound.play().catch(e => console.warn("Crash sound failed to play:", e));
        } else {
            console.error("Crash sound is not loaded.");
        }
    }
}