import os
import uvicorn
from fastapi import FastAPI, WebSocket
from elevenlabs.client import ElevenLabs


os.environ["ELEVEN_API_KEY"] = "b00bc89038aa2637a4c3ab0c88dc51c6"

try:
    # Initialize the ElevenLabs client
    client = ElevenLabs()
except Exception as e:
    print(f"Error initializing ElevenLabs client: {e}")
    print("Please ensure the ELEVEN_API_KEY environment variable is set correctly.")
    client = None

app = FastAPI()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("🔊 Voice client connected.")
    if not client:
        print("ElevenLabs client not initialized. Cannot generate audio.")
        await websocket.close(code=1008, reason="Server-side API key error")
        return

    try:
        while True:
            # 1. Receive text message from the website (audio.js)
            text_to_speak = await websocket.receive_text()
            print(f"Received text to speak: '{text_to_speak}'")

            # 2. Generate the MP3 audio from ElevenAI
            audio_stream = client.generate(
                text=text_to_speak,
                voice="Rachel",  # You can change the voice name
                model="eleven_multilingual_v2",
                stream=True
            )

            # 3. Stream the audio data back to the website
            # We send the data in chunks as it arrives
            print("Streaming audio to client...")
            for chunk in audio_stream:
                if chunk:
                    await websocket.send_bytes(chunk)

            # Send a final "end" message to let the client know we're done
            await websocket.send_text("AUDIO_END")
            print("Audio stream finished.")

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        print("🔊 Voice client disconnected.")

if __name__ == "__main__":
    print("🚀 Starting MCP Voice Server on ws://localhost:8766")
    uvicorn.run(app, host="0.0.0.0", port=8766)