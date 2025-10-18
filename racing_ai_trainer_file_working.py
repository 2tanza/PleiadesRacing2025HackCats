"""
racing_ai_trainer.py
Complete PyTorch training system for racing AI
Train on telemetry data, export model for Raspberry Pi deployment
Compatible with your JSON format: playerX, playerY, playerVelX, playerVelY, etc.
"""

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import json
import numpy as np
from pathlib import Path
import matplotlib.pyplot as plt
from datetime import datetime
import os

# ============================================================================
# NEURAL NETWORK ARCHITECTURE
# ============================================================================

class RacingPolicyNetwork(nn.Module):
    """
    Neural network that learns to control a racing car.
    Input: Game state (position, velocity, angle, ray distances)
    Output: Steering (-1 to 1) and Throttle (0 to 1)
    """
    def __init__(self, input_size=9, hidden_sizes=[128, 64, 32]):
        super(RacingPolicyNetwork, self).__init__()
        
        layers = []
        prev_size = input_size
        
        for hidden_size in hidden_sizes:
            layers.append(nn.Linear(prev_size, hidden_size))
            layers.append(nn.ReLU())
            layers.append(nn.Dropout(0.2))
            prev_size = hidden_size
        
        self.feature_extractor = nn.Sequential(*layers)
        
        # Separate heads for steering and throttle
        self.steering_head = nn.Sequential(
            nn.Linear(prev_size, 16),
            nn.ReLU(),
            nn.Linear(16, 1),
            nn.Tanh()  # Output: -1 to 1
        )
        
        self.throttle_head = nn.Sequential(
            nn.Linear(prev_size, 16),
            nn.ReLU(),
            nn.Linear(16, 1),
            nn.Sigmoid()  # Output: 0 to 1
        )
    
    def forward(self, x):
        features = self.feature_extractor(x)
        steering = self.steering_head(features)
        throttle = self.throttle_head(features)
        return steering, throttle


# ============================================================================
# DATASET LOADER
# ============================================================================

class TelemetryDataset(Dataset):
    """
    Loads telemetry JSON files exported from the Phaser game.
    Converts game state into neural network input features.
    """
    def __init__(self, json_files, canvas_width=1024, canvas_height=768):
        self.data = []
        self.canvas_width = canvas_width
        self.canvas_height = canvas_height
        self.max_speed = 300
        
        # Load all JSON files
        for json_file in json_files:
            try:
                with open(json_file, 'r') as f:
                    telemetry = json.load(f)
                    # Handle both single array and nested structure
                    if isinstance(telemetry, list):
                        self.data.extend(telemetry)
                    elif isinstance(telemetry, dict) and 'frames' in telemetry:
                        self.data.extend(telemetry['frames'])
                    print(f"✓ Loaded {json_file.name}: {len(telemetry)} frames")
            except Exception as e:
                print(f"✗ Failed to load {json_file}: {e}")
        
        print(f"\n📊 Total frames loaded: {len(self.data)}")
        
        if len(self.data) == 0:
            raise ValueError("No data loaded! Check your JSON files.")
    
    def __len__(self):
        return len(self.data)
    
    def __getitem__(self, idx):
        frame = self.data[idx]
        
        # Extract features
        features = self._extract_features(frame)
        
        # Extract labels (what the human player did)
        steering = self._calculate_steering(frame)
        throttle = 1.0 if frame.get('inputUp', False) else 0.0
        
        return (
            torch.FloatTensor(features),
            torch.FloatTensor([steering]),
            torch.FloatTensor([throttle])
        )
    
    def _extract_features(self, frame):
        """
        Convert raw game state into normalized neural network features.
        Your JSON format: playerX, playerY, playerVelX, playerVelY, playerAngle, playerRayDistances
        """
        # Get position (direct fields)
        pos_x = frame['playerX']
        pos_y = frame['playerY']
        
        # Get velocity (direct fields)
        vel_x = frame['playerVelX']
        vel_y = frame['playerVelY']
        
        # Get angle
        angle = frame['playerAngle']
        
        # Normalize position
        norm_x = pos_x / self.canvas_width
        norm_y = pos_y / self.canvas_height
        
        # Normalize velocity
        norm_vx = vel_x / self.max_speed
        norm_vy = vel_y / self.max_speed
        
        # Normalize angle to -1 to 1
        norm_angle = angle / np.pi
        
        # Speed magnitude
        speed = np.sqrt(vel_x**2 + vel_y**2) / self.max_speed
        
        # Use ray distances as features
        ray_distances = frame.get('playerRayDistances', [1, 1, 1, 1, 1])
        ray_features = ray_distances[:3]
        
        # Pad with zeros if needed
        while len(ray_features) < 3:
            ray_features.append(1.0)
        
        features = [
            norm_x, norm_y, norm_vx, norm_vy, 
            norm_angle, speed
        ] + ray_features[:3]
        
        return features
    
    def _calculate_steering(self, frame):
        """Convert keyboard input to steering value"""
        if frame.get('inputLeft', False):
            return -1.0
        elif frame.get('inputRight', False):
            return 1.0
        else:
            return 0.0


# ============================================================================
# TRAINING LOOP
# ============================================================================

class RacingAITrainer:
    def __init__(self, canvas_width=1024, canvas_height=768, 
                 device='cuda' if torch.cuda.is_available() else 'cpu'):
        self.device = device
        self.canvas_width = canvas_width
        self.canvas_height = canvas_height
        
        # Input size: 9 features (6 base + 3 ray distances)
        input_size = 9
        
        self.model = RacingPolicyNetwork(input_size=input_size).to(device)
        self.optimizer = optim.Adam(self.model.parameters(), lr=0.001)
        self.steering_loss_fn = nn.MSELoss()
        self.throttle_loss_fn = nn.BCELoss()
        
        self.training_history = {
            'loss': [],
            'steering_loss': [],
            'throttle_loss': [],
            'val_loss': []
        }
        
        print(f"🧠 Model initialized with {sum(p.numel() for p in self.model.parameters())} parameters")
        print(f"🖥️  Training on: {device}")
    
    def train(self, train_loader, val_loader, epochs=50, patience=10):
        """Train the racing AI model with early stopping"""
        print(f"\n{'='*60}")
        print(f"🏁 Starting Training")
        print(f"{'='*60}")
        print(f"Epochs: {epochs}")
        print(f"Batch size: {train_loader.batch_size}")
        print(f"Training samples: {len(train_loader.dataset)}")
        print(f"Validation samples: {len(val_loader.dataset)}")
        print(f"{'='*60}\n")
        
        best_val_loss = float('inf')
        patience_counter = 0
        
        for epoch in range(epochs):
            # Training phase
            self.model.train()
            train_loss = 0
            train_steering_loss = 0
            train_throttle_loss = 0
            
            for batch_idx, (features, steering_target, throttle_target) in enumerate(train_loader):
                features = features.to(self.device)
                steering_target = steering_target.to(self.device)
                throttle_target = throttle_target.to(self.device)
                
                self.optimizer.zero_grad()
                
                steering_pred, throttle_pred = self.model(features)
                
                s_loss = self.steering_loss_fn(steering_pred, steering_target)
                t_loss = self.throttle_loss_fn(throttle_pred, throttle_target)
                
                loss = s_loss + t_loss
                loss.backward()
                self.optimizer.step()
                
                train_loss += loss.item()
                train_steering_loss += s_loss.item()
                train_throttle_loss += t_loss.item()
            
            # Validation phase
            self.model.eval()
            val_loss = 0
            
            with torch.no_grad():
                for features, steering_target, throttle_target in val_loader:
                    features = features.to(self.device)
                    steering_target = steering_target.to(self.device)
                    throttle_target = throttle_target.to(self.device)
                    
                    steering_pred, throttle_pred = self.model(features)
                    
                    s_loss = self.steering_loss_fn(steering_pred, steering_target)
                    t_loss = self.throttle_loss_fn(throttle_pred, throttle_target)
                    
                    val_loss += (s_loss + t_loss).item()
            
            # Calculate averages
            avg_train_loss = train_loss / len(train_loader)
            avg_val_loss = val_loss / len(val_loader)
            avg_steering_loss = train_steering_loss / len(train_loader)
            avg_throttle_loss = train_throttle_loss / len(train_loader)
            
            # Record metrics
            self.training_history['loss'].append(avg_train_loss)
            self.training_history['val_loss'].append(avg_val_loss)
            self.training_history['steering_loss'].append(avg_steering_loss)
            self.training_history['throttle_loss'].append(avg_throttle_loss)
            
            # Print progress
            print(f"Epoch {epoch+1:3d}/{epochs} | "
                  f"Train: {avg_train_loss:.4f} | "
                  f"Val: {avg_val_loss:.4f} | "
                  f"Steer: {avg_steering_loss:.4f} | "
                  f"Throttle: {avg_throttle_loss:.4f}")
            
            # Early stopping check
            if avg_val_loss < best_val_loss:
                best_val_loss = avg_val_loss
                patience_counter = 0
                self.save_model('best_model.pth')
            else:
                patience_counter += 1
                if patience_counter >= patience:
                    print(f"\n⚠️  Early stopping triggered after {epoch+1} epochs")
                    print(f"Best validation loss: {best_val_loss:.4f}")
                    break
        
        print(f"\n{'='*60}")
        print(f"✅ Training Complete!")
        print(f"{'='*60}\n")
    
    def save_model(self, path='racing_ai_model.pth'):
        """Save trained model"""
        save_dict = {
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'canvas_width': self.canvas_width,
            'canvas_height': self.canvas_height,
            'training_history': self.training_history,
            'timestamp': datetime.now().isoformat()
        }
        
        torch.save(save_dict, path)
        if 'best' not in path:
            print(f"💾 Model saved to {path}")
    
    def plot_training_history(self, save_path='training_history.png'):
        """Visualize training progress"""
        fig, axes = plt.subplots(2, 2, figsize=(12, 8))
        
        # Total Loss
        axes[0, 0].plot(self.training_history['loss'], label='Train Loss')
        axes[0, 0].plot(self.training_history['val_loss'], label='Val Loss')
        axes[0, 0].set_title('Total Loss')
        axes[0, 0].set_xlabel('Epoch')
        axes[0, 0].set_ylabel('Loss')
        axes[0, 0].legend()
        axes[0, 0].grid(True)
        
        # Steering Loss
        axes[0, 1].plot(self.training_history['steering_loss'])
        axes[0, 1].set_title('Steering Loss')
        axes[0, 1].set_xlabel('Epoch')
        axes[0, 1].set_ylabel('Loss')
        axes[0, 1].grid(True)
        
        # Throttle Loss
        axes[1, 0].plot(self.training_history['throttle_loss'])
        axes[1, 0].set_title('Throttle Loss')
        axes[1, 0].set_xlabel('Epoch')
        axes[1, 0].set_ylabel('Loss')
        axes[1, 0].grid(True)
        
        # Learning curve comparison
        axes[1, 1].plot(self.training_history['loss'], label='Train')
        axes[1, 1].plot(self.training_history['val_loss'], label='Validation')
        axes[1, 1].set_title('Learning Curves')
        axes[1, 1].set_xlabel('Epoch')
        axes[1, 1].set_ylabel('Loss')
        axes[1, 1].legend()
        axes[1, 1].grid(True)
        
        plt.tight_layout()
        plt.savefig(save_path)
        print(f"📊 Training plots saved to {save_path}")
        plt.close()


# ============================================================================
# INFERENCE CLASS
# ============================================================================

class RacingAIInference:
    """
    Lightweight inference class for running trained model.
    Use this in your WebSocket server on Raspberry Pi.
    """
    def __init__(self, model_path, device='cpu'):
        self.device = device
        
        # Load model checkpoint
        checkpoint = torch.load(model_path, map_location=device)
        self.canvas_width = checkpoint.get('canvas_width', 1024)
        self.canvas_height = checkpoint.get('canvas_height', 768)
        self.max_speed = 300
        
        # Initialize model
        self.model = RacingPolicyNetwork(input_size=9).to(device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.model.eval()
        
        print(f"🤖 Inference model loaded on {device}")
    
    def predict(self, game_state):
        """
        Given current game state, predict steering and throttle.
        
        Args:
            game_state: dict with keys: x, y, vx, vy, angle, rayDistances
        
        Returns:
            dict: {'steering': float, 'throttle': float}
        """
        features = self._extract_features(game_state)
        features_tensor = torch.FloatTensor(features).unsqueeze(0).to(self.device)
        
        with torch.no_grad():
            steering, throttle = self.model(features_tensor)
        
        return {
            'steering': float(steering[0][0]),
            'throttle': float(throttle[0][0])
        }
    
    def _extract_features(self, game_state):
        """Same feature extraction as training"""
        norm_x = game_state['x'] / self.canvas_width
        norm_y = game_state['y'] / self.canvas_height
        norm_vx = game_state['vx'] / self.max_speed
        norm_vy = game_state['vy'] / self.max_speed
        norm_angle = game_state['angle'] / np.pi
        speed = np.sqrt(game_state['vx']**2 + game_state['vy']**2) / self.max_speed
        
        ray_distances = game_state.get('rayDistances', [1, 1, 1, 1, 1])
        ray_features = ray_distances[:3]
        
        while len(ray_features) < 3:
            ray_features.append(1.0)
        
        return [norm_x, norm_y, norm_vx, norm_vy, norm_angle, speed] + ray_features[:3]


# ============================================================================
# MAIN TRAINING SCRIPT
# ============================================================================

def main():
    print("=" * 70)
    print("🏎️  RACING AI TRAINER")
    print("=" * 70)
    print()
    
    # Configuration
    CANVAS_WIDTH = 1024
    CANVAS_HEIGHT = 768
    BATCH_SIZE = 64
    EPOCHS = 50
    TRAIN_SPLIT = 0.8
    
    # Load telemetry data
    data_folder = Path('telemetry_data')
    
    if not data_folder.exists():
        print(f"❌ Error: '{data_folder}' folder not found!")
        print(f"   Creating it now...")
        data_folder.mkdir()
        print(f"   Add your telemetry JSON files to this folder and run again.")
        return
    
    json_files = list(data_folder.glob('*.json'))
    
    if not json_files:
        print(f"❌ Error: No JSON files found in '{data_folder}'")
        print(f"   Play the game and export telemetry data first.")
        return
    
    print(f"📁 Found {len(json_files)} telemetry file(s):")
    for f in json_files:
        size_kb = f.stat().st_size / 1024
        print(f"   • {f.name} ({size_kb:.1f} KB)")
    print()
    
    # Create dataset
    try:
        dataset = TelemetryDataset(json_files, CANVAS_WIDTH, CANVAS_HEIGHT)
    except ValueError as e:
        print(f"❌ {e}")
        return
    
    # Split into train/validation
    train_size = int(TRAIN_SPLIT * len(dataset))
    val_size = len(dataset) - train_size
    train_dataset, val_dataset = torch.utils.data.random_split(
        dataset, [train_size, val_size]
    )
    
    print(f"📊 Dataset split:")
    print(f"   Training: {train_size} frames ({TRAIN_SPLIT*100:.0f}%)")
    print(f"   Validation: {val_size} frames ({(1-TRAIN_SPLIT)*100:.0f}%)")
    print()
    
    # Create data loaders
    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE, shuffle=False)
    
    # Initialize trainer
    trainer = RacingAITrainer(CANVAS_WIDTH, CANVAS_HEIGHT)
    
    # Train model
    start_time = datetime.now()
    trainer.train(train_loader, val_loader, epochs=EPOCHS)
    training_time = (datetime.now() - start_time).total_seconds()
    
    # Save models
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    model_path = f'racing_ai_model_{timestamp}.pth'
    trainer.save_model(model_path)
    trainer.save_model('racing_ai_model.pth')
    
    # Plot results
    trainer.plot_training_history(f'training_history_{timestamp}.png')
    
    # Final summary
    print("\n" + "=" * 70)
    print("✅ TRAINING COMPLETE!")
    print("=" * 70)
    print(f"\n⏱️  Training time: {training_time/60:.1f} minutes")
    print(f"\n📦 Models saved:")
    print(f"   • racing_ai_model.pth (for deployment)")
    print(f"   • {model_path} (timestamped backup)")
    print(f"\n📊 Training plot: training_history_{timestamp}.png")
    print(f"\n🚀 Next steps:")
    print(f"   1. Review the training plot")
    print(f"   2. Copy racing_ai_model.pth to Raspberry Pi")
    print(f"   3. Run MCP server on Pi")
    print(f"   4. Connect your game!")
    print("=" * 70)


if __name__ == "__main__":
    main()
