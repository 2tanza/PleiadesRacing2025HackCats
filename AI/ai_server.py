import asyncio
import websockets
import json
import torch

# Import the inference class from your training script
from racing_ai_trainer_file_working import RacingAIInference

# --- CONFIGURATION ---
MODEL_PATH = "best_model.pth"  # Or "racing_ai_model.pth"
HOST = "localhost"
PORT = 8765
# ---------------------

print("Loading model...")
# Load the inference model on the CPU
inference_model = RacingAIInference(model_path=MODEL_PATH, device='cpu')
print(f"✅ Model '{MODEL_PATH}' loaded.")


async def handler(websocket, path):
    """
    Handles incoming WebSocket connections and messages.
    """
    print(f"Client connected!")
    try:
        async for message in websocket:
            try:
                # 1. Receive game state from JS client
                #    The data will be in the format {x, y, vx, vy, angle, rayDistances}
                game_state = json.loads(message)

                # 2. Ask the model for a prediction
                #    This uses the .predict() method from your RacingAIInference class
                action = inference_model.predict(game_state)

                # 3. Send the action back to the JS client
                #    This will be in the format {'steering': float, 'throttle': float}
                await websocket.send(json.dumps(action))

            except json.JSONDecodeError:
                print("Error: Received invalid JSON")
            except Exception as e:
                print(f"An error occurred: {e}")

    except websockets.exceptions.ConnectionClosed:
        print("Client disconnected.")


async def main():
    print(f"🚀 WebSocket AI Server starting on ws://{HOST}:{PORT}")
    async with websockets.serve(handler, HOST, PORT):
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())