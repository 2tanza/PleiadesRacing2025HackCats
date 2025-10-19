/**
 * PaceNoteAudio - Manages audio pace notes via ElevenLabs through FastMCP
 * 
 * This class handles all audio announcements in the racing game:
 * - Race start ("Start your engines!")
 * - Turn warnings ("Turn left", "Turn right")
 * - Lap completion ("Lap complete")
 * - Crash sounds (crash sound effect)
 */
export class PaceNoteAudio {
    constructor(mcpServerUrl) {
        this.serverUrl = mcpServerUrl;
        
        // Cooldown system to prevent audio spam
        this.lastNoteTime = 0;
        this.MIN_NOTE_INTERVAL = 2000; // Minimum 2 seconds between most notes (in milliseconds)
        
        // Track which specific notes were recently played to allow different types simultaneously
        this.recentNotes = {
            turnLeft: 0,
            turnRight: 0,
            crash: 0,
            lapComplete: 0
        };
        
        // Currently playing audio (to prevent overlapping same sounds)
        this.currentAudio = null;
    }

    /**
     * Main method to play a pace note
     * @param {string} message - The text to be spoken by ElevenLabs
     * @param {string} noteType - Type of note (for cooldown tracking): 'turn', 'crash', 'lap', 'start'
     * @returns {Promise<void>}
     */
    async playPaceNote(message, noteType = 'general') {
        const now = Date.now();
        
        // Check cooldown for this specific note type
        if (this.shouldSkipNote(noteType, now)) {
            console.log(`⏸️ Skipping note "${message}" - still on cooldown`);
            return;
        }

        console.log(`🎙️ Requesting pace note: "${message}" [${noteType}]`);

        try {
            // Payload for FastMCP server
            const payload = {
                tool: "generate_pace_note",
                parameters: {
                    text: message,  // ElevenLabs expects 'text' parameter
                    filename: this.sanitizeFilename(message)  // Create a safe filename
                }
            };

            // Call the MCP server to generate the audio
            const response = await fetch(this.serverUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`MCP server responded with status: ${response.status}`);
            }

            const result = await response.json();
            
            // FastMCP returns the result in result.content[0].text
            // This should be a path like "Audio generated and saved as audio/turn_left.mp3"
            // Or it might directly return the path "/audio/turn_left.mp3"
            let audioPath = result.content?.[0]?.text;
            
            if (!audioPath) {
                console.error("No audio path returned from MCP server:", result);
                return;
            }

            // Extract the actual path if the response includes a message
            const pathMatch = audioPath.match(/audio\/[\w-]+\.mp3/);
            if (pathMatch) {
                audioPath = '/' + pathMatch[0];
            } else if (!audioPath.startsWith('/audio/')) {
                // Assume it's just the filename
                audioPath = `/audio/${audioPath}`;
                if (!audioPath.endsWith('.mp3')) {
                    audioPath += '.mp3';
                }
            }

            // Construct the full URL
            // For Cloudflare Tunnel, we use the base URL directly
            const baseUrl = this.serverUrl.replace('/mcp', '');
            const fullAudioUrl = `${baseUrl}${audioPath}`;
            
            console.log(`🔈 Playing audio from: ${fullAudioUrl}`);

            // Play the audio
            await this.playAudioFile(fullAudioUrl);
            
            // Update cooldown tracking
            this.updateCooldown(noteType, now);

        } catch (error) {
            console.error("🚫 Error generating or playing pace note:", error);
        }
    }

    /**
     * Checks if we should skip playing a note based on cooldown
     * @param {string} noteType - Type of note
     * @param {number} now - Current timestamp
     * @returns {boolean} - True if we should skip
     */
    shouldSkipNote(noteType, now) {
        // Start messages never skip
        if (noteType === 'start') return false;
        
        // For turn notes, check the specific turn direction
        if (noteType === 'turnLeft' || noteType === 'turnRight') {
            return (now - this.recentNotes[noteType]) < this.MIN_NOTE_INTERVAL;
        }
        
        // Crash sounds have a shorter cooldown (1 second)
        if (noteType === 'crash') {
            return (now - this.recentNotes.crash) < 1000;
        }
        
        // Lap complete has its own tracking
        if (noteType === 'lapComplete') {
            return (now - this.recentNotes.lapComplete) < 3000; // 3 second cooldown
        }
        
        // Default: check general cooldown
        return (now - this.lastNoteTime) < this.MIN_NOTE_INTERVAL;
    }

    /**
     * Updates cooldown timestamps after playing a note
     * @param {string} noteType - Type of note
     * @param {number} now - Current timestamp
     */
    updateCooldown(noteType, now) {
        this.lastNoteTime = now;
        
        if (noteType in this.recentNotes) {
            this.recentNotes[noteType] = now;
        }
    }

    /**
     * Plays an audio file from a URL
     * @param {string} url - Full URL to the audio file
     * @returns {Promise<void>}
     */
    async playAudioFile(url) {
        return new Promise((resolve, reject) => {
            // Stop current audio if playing
            if (this.currentAudio) {
                this.currentAudio.pause();
                this.currentAudio = null;
            }

            const audio = new Audio(url);
            this.currentAudio = audio;

            audio.onended = () => {
                this.currentAudio = null;
                resolve();
            };

            audio.onerror = (error) => {
                console.error("Error playing audio file:", error);
                this.currentAudio = null;
                reject(error);
            };

            audio.play().catch(reject);
        });
    }

    /**
     * Creates a safe filename from a message
     * @param {string} message - The message text
     * @returns {string} - Safe filename
     */
    sanitizeFilename(message) {
        return message
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    /**
     * Convenience methods for specific game events
     */
    
    async playStartMessage() {
        return this.playPaceNote("Start your engines!", 'start');
    }

    async playTurnLeft() {
        return this.playPaceNote("Turn left", 'turnLeft');
    }

    async playTurnRight() {
        return this.playPaceNote("Turn right", 'turnRight');
    }

    async playLapComplete() {
        return this.playPaceNote("Lap complete", 'lapComplete');
    }

    async playCrashSound() {
        // For crash, you might want a sound effect rather than speech
        // For now, we'll use a verbal announcement
        return this.playPaceNote("Crash!", 'crash');
    }
}
