"""
racing_ai_trainer.py
Complete PyTorch training system for racing AI
Train on telemetry data, export model for Raspberry Pi deployment
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
    Input: Game state (position, velocity, angle, checkpoint info)
    Output: Steering (-1 to 1) and Throttle (0 to 1)
    """
    def __init__(self, input_size=12, hidden_sizes=[128, 64, 32]):
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
    def __init__(self, json_files, checkpoint_positions, canvas_width=1024, canvas_height=768):
        self.data = []
        self.checkpoint_positions = checkpoint_positions
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
        steering = self._calculate_steering(frame['input'])
        throttle = 1.0 if frame['input'].get('forward', False) else 0.0
        
        return (
            torch.FloatTensor(features),
            torch.FloatTensor([steering]),
            torch.FloatTensor([throttle])
        )
    
    def _extract_features(self, frame):
        """
        Convert raw game state into normalized neural network features.
        Features include: position, velocity, angle, checkpoint distances
        """
        pos = frame['playerPos']
        vel = frame['playerVel']
        angle = frame['playerAngle']
        
        # Normalize position
        norm_x = pos['x'] / self.canvas_width
        norm_y = pos['y'] / self.canvas_height
        
        # Normalize velocity
        norm_vx = vel['x'] / self.max_speed
        norm_vy = vel['y'] / self.max_speed
        
        # Normalize angle to -1 to 1
        norm_angle = angle / np.pi
        
        # Speed magnitude
        speed = np.sqrt(vel['x']**2 + vel['y']**2) / self.max_speed
        
        # Calculate distances to next 3 checkpoints
        nearest_cp_idx = frame.get('nearestCheckpoint', 0)
        cp_features = []
        
        for i in range(3):
            cp_idx = (nearest_cp_idx + i) % len(self.checkpoint_positions)
            cp = self.checkpoint_positions[cp_idx]
            
            # Relative position to checkpoint (normalized)
            dx = (cp['x'] - pos['x']) / self.canvas_width
            dy = (cp['y'] - pos['y']) / self.canvas_height
            
            cp_features.extend([dx, dy])
        
        features = [
            norm_x, norm_y, norm_vx, norm_vy, 
            norm_angle, speed
        ] + cp_features
        
        return features
    
    def _calculate_steering(self, input_state):
        """Convert keyboard input to steering value"""
        if input_state.get('left', False):
            return -1.0
        elif input_state.get('right', False):
            return 1.0
        else:
            return 0.0


# ============================================================================
# TRAINING LOOP
# ============================================================================

class RacingAITrainer:
    def __init__(self, checkpoint_positions, canvas_width=1024, canvas_height=768, 
                 device='cuda' if torch.cuda.is_available() else 'cpu'):
        self.device = device
        self.checkpoint_positions = checkpoint_positions
        self.canvas_width = canvas_width
        self.canvas_height = canvas_height
        
        # Calculate input size based on features
        # 6 base features + 6 checkpoint features (3 checkpoints * 2 coords)
        input_size = 12
        
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
            val_steering_loss = 0
            val_throttle_loss = 0
            
            with torch.no_grad():
                for features, steering_target, throttle_target in val_loader:
                    features = features.to(self.device)
                    steering_target = steering_target.to(self.device)
                    throttle_target = throttle_target.to(self.device)
                    
                    steering_pred, throttle_pred = self.model(features)
                    
                    s_loss = self.steering_loss_fn(steering_pred, steering_target)
                    t_loss = self.throttle_loss_fn(throttle_pred, throttle_target)
                    
                    val_loss += (s_loss + t_loss).item()
                    val_steering_loss += s_loss.item()
                    val_throttle_loss += t_loss.item()
            
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
                # Save best model
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
            'checkpoint_positions': self.checkpoint_positions,
            'canvas_width': self.canvas_width,
            'canvas_height': self.canvas_height,
            'training_history': self.training_history,
            'timestamp': datetime.now().isoformat()
        }
        
        torch.save(save_dict, path)
        print(f"💾 Model saved to {path}")
    
    def load_model(self, path='racing_ai_model.pth'):
        """Load pre-trained model"""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        self.checkpoint_positions = checkpoint['checkpoint_positions']
        self.training_history = checkpoint.get('training_history', {})
        print(f"📂 Model loaded from {path}")
    
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
        plt.show()


# ============================================================================
# INFERENCE CLASS (for testing and deployment)
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
        self.checkpoint_positions = checkpoint['checkpoint_positions']
        self.canvas_width = checkpoint.get('canvas_width', 1024)
        self.canvas_height = checkpoint.get('canvas_height', 768)
        self.max_speed = 300
        
        # Initialize model
        self.model = RacingPolicyNetwork(input_size=12).to(device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.model.eval()
        
        print(f"🤖 Inference model loaded")
        print(f"   Device: {device}")
        print(f"   Checkpoints: {len(self.checkpoint_positions)}")
    
    def predict(self, game_state):
        """
        Given current game state, predict steering and throttle.
        
        Args:
            game_state: dict with keys: x, y, vx, vy, angle, nearestCheckpoint
        
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
        
        nearest_cp_idx = game_state.get('nearestCheckpoint', 0)
        cp_features = []
        
        for i in range(3):
            cp_idx = (nearest_cp_idx + i) % len(self.checkpoint_positions)
            cp = self.checkpoint_positions[cp_idx]
            
            dx = (cp['x'] - game_state['x']) / self.canvas_width
            dy = (cp['y'] - game_state['y']) / self.canvas_height
            
            cp_features.extend([dx, dy])
        
        return [norm_x, norm_y, norm_vx, norm_vy, norm_angle, speed] + cp_features


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def auto_detect_checkpoints(json_files, num_checkpoints=4):
    """
    Automatically detect checkpoint positions from telemetry data.
    Uses simple clustering to find common positions (corners/waypoints).
    """
    print("🔍 Auto-detecting checkpoint positions...")
    
    all_positions = []
    for json_file in json_files[:3]:  # Use first 3 files only
        with open(json_file, 'r') as f:
            telemetry = json.load(f)
            if isinstance(telemetry, list):
                for frame in telemetry[::10]:  # Sample every 10th frame
                    pos = frame['playerPos']
                    all_positions.append([pos['x'], pos['y']])
    
    if len(all_positions) == 0:
        print("⚠️  No position data found, using default checkpoints")
        return [
            {'x': 200, 'y': 300},
            {'x': 800, 'y': 300},
            {'x': 800, 'y': 600},
            {'x': 200, 'y': 600}
        ]
    
    # Simple clustering without sklearn (k-means from scratch)
    positions = np.array(all_positions)
    
    # Initialize centroids randomly
    np.random.seed(42)
    indices = np.random.choice(len(positions), num_checkpoints, replace=False)
    centroids = positions[indices].copy()
    
    # Run k-means for 20 iterations
    for _ in range(20):
        # Assign points to nearest centroid
        distances = np.sqrt(((positions[:, np.newaxis] - centroids) ** 2).sum(axis=2))
        labels = np.argmin(distances, axis=1)
        
        # Update centroids
        for i in range(num_checkpoints):
            cluster_points = positions[labels == i]
            if len(cluster_points) > 0:
                centroids[i] = cluster_points.mean(axis=0)
    
    checkpoints = [{'x': float(c[0]), 'y': float(c[1])} for c in centroids]
    print(f"✓ Detected {len(checkpoints)} checkpoints")
    for i, cp in enumerate(checkpoints):
        print(f"   Checkpoint {i}: ({cp['x']:.1f}, {cp['y']:.1f})")
    
    return checkpoints


def validate_telemetry_data(json_files):
    """
    Validate telemetry data to ensure it's in the correct format.
    Returns True if valid, False otherwise.
    """
    print("\n🔍 Validating telemetry data...")
    
    required_fields = ['playerPos', 'playerVel', 'playerAngle', 'input']
    issues_found = False
    
    for json_file in json_files[:3]:  # Check first 3 files
        try:
            with open(json_file, 'r') as f:
                telemetry = json.load(f)
                
                # Get first frame
                if isinstance(telemetry, list):
                    if len(telemetry) == 0:
                        print(f"   ⚠️  {json_file.name}: Empty file")
                        issues_found = True
                        continue
                    frame = telemetry[0]
                elif isinstance(telemetry, dict) and 'frames' in telemetry:
                    frame = telemetry['frames'][0]
                else:
                    print(f"   ❌ {json_file.name}: Unknown format")
                    issues_found = True
                    continue
                
                # Check required fields
                missing = [field for field in required_fields if field not in frame]
                if missing:
                    print(f"   ❌ {json_file.name}: Missing fields: {missing}")
                    issues_found = True
                else:
                    print(f"   ✓ {json_file.name}: Valid")
        
        except Exception as e:
            print(f"   ❌ {json_file.name}: {e}")
            issues_found = True
    
    if issues_found:
        print("\n⚠️  Some telemetry files have issues. Training may fail.")
        print("   Make sure your game exports data in the correct format.")
        return False
    else:
        print("\n✅ All telemetry files are valid!")
        return True


def analyze_dataset(dataset):
    """
    Analyze the dataset and print statistics.
    Helps identify potential issues before training.
    """
    print("\n📊 Dataset Analysis")
    print("=" * 60)
    
    # Sample some data
    sample_size = min(1000, len(dataset))
    steering_values = []
    throttle_values = []
    
    for i in range(0, len(dataset), len(dataset) // sample_size):
        _, steering, throttle = dataset[i]
        steering_values.append(float(steering[0]))
        throttle_values.append(float(throttle[0]))
    
    steering_values = np.array(steering_values)
    throttle_values = np.array(throttle_values)
    
    # Steering statistics
    print(f"Steering Statistics:")
    print(f"   Mean: {steering_values.mean():.3f}")
    print(f"   Std:  {steering_values.std():.3f}")
    print(f"   Min:  {steering_values.min():.3f}")
    print(f"   Max:  {steering_values.max():.3f}")
    print(f"   Left turns:  {(steering_values < -0.5).sum() / len(steering_values) * 100:.1f}%")
    print(f"   Straight:    {(np.abs(steering_values) < 0.5).sum() / len(steering_values) * 100:.1f}%")
    print(f"   Right turns: {(steering_values > 0.5).sum() / len(steering_values) * 100:.1f}%")
    
    # Throttle statistics
    print(f"\nThrottle Statistics:")
    print(f"   Mean:      {throttle_values.mean():.3f}")
    print(f"   Std:       {throttle_values.std():.3f}")
    print(f"   Full gas:  {(throttle_values > 0.9).sum() / len(throttle_values) * 100:.1f}%")
    print(f"   Coasting:  {(throttle_values < 0.1).sum() / len(throttle_values) * 100:.1f}%")
    
    # Data balance warnings
    print(f"\n⚠️  Warnings:")
    if (np.abs(steering_values) < 0.5).sum() / len(steering_values) > 0.8:
        print(f"   • Dataset is mostly straight driving (>80%)")
        print(f"     AI may not learn to turn well. Drive more corners!")
    
    if (throttle_values > 0.9).sum() / len(throttle_values) > 0.9:
        print(f"   • Throttle is almost always full (>90%)")
        print(f"     AI may not learn speed control. Try braking more!")
    
    left_pct = (steering_values < -0.5).sum() / len(steering_values)
    right_pct = (steering_values > 0.5).sum() / len(steering_values)
    if abs(left_pct - right_pct) > 0.3:
        print(f"   • Unbalanced turns: {left_pct*100:.0f}% left vs {right_pct*100:.0f}% right")
        print(f"     Try driving both directions on the track!")
    
    print("=" * 60)


def test_model_predictions(model_path, num_tests=5):
    """
    Test the trained model with some sample predictions.
    Useful for sanity checking before deployment.
    """
    print("\n🧪 Testing Model Predictions")
    print("=" * 60)
    
    try:
        inference = RacingAIInference(model_path)
        
        # Test scenarios
        scenarios = [
            {
                'name': 'Straight road, high speed',
                'state': {'x': 512, 'y': 384, 'vx': 200, 'vy': 0, 'angle': 0.0, 'nearestCheckpoint': 0}
            },
            {
                'name': 'Approaching left turn',
                'state': {'x': 700, 'y': 300, 'vx': 150, 'vy': 50, 'angle': 0.5, 'nearestCheckpoint': 1}
            },
            {
                'name': 'Sharp right turn',
                'state': {'x': 800, 'y': 500, 'vx': 80, 'vy': -80, 'angle': -0.8, 'nearestCheckpoint': 2}
            },
            {
                'name': 'Slow corner exit',
                'state': {'x': 300, 'y': 600, 'vx': 60, 'vy': 20, 'angle': 0.2, 'nearestCheckpoint': 3}
            },
            {
                'name': 'High speed straight',
                'state': {'x': 400, 'y': 400, 'vx': 250, 'vy': 10, 'angle': 0.1, 'nearestCheckpoint': 0}
            }
        ]
        
        for scenario in scenarios[:num_tests]:
            pred = inference.predict(scenario['state'])
            print(f"\n{scenario['name']}:")
            print(f"   Input:    vx={scenario['state']['vx']:.0f}, vy={scenario['state']['vy']:.0f}, angle={scenario['state']['angle']:.2f}")
            print(f"   Output:   steering={pred['steering']:+.3f}, throttle={pred['throttle']:.3f}")
            
            # Interpret output
            if pred['steering'] < -0.3:
                direction = "⬅️  Turn LEFT"
            elif pred['steering'] > 0.3:
                direction = "➡️  Turn RIGHT"
            else:
                direction = "⬆️  Go STRAIGHT"
            
            if pred['throttle'] > 0.7:
                speed = "🟢 Full throttle"
            elif pred['throttle'] > 0.3:
                speed = "🟡 Moderate speed"
            else:
                speed = "🔴 Slow/brake"
            
            print(f"   Action:   {direction}, {speed}")
        
        print("\n✅ Model predictions look reasonable!")
        
    except Exception as e:
        print(f"❌ Model testing failed: {e}")
    
    print("=" * 60)


def export_for_deployment(model_path, output_dir='deployment'):
    """
    Package the model for easy deployment to Raspberry Pi.
    Creates a deployment folder with all necessary files.
    """
    print(f"\n📦 Preparing deployment package...")
    
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)
    
    # Copy model file
    import shutil
    shutil.copy(model_path, output_path / 'racing_ai_model.pth')
    print(f"   ✓ Copied model to {output_path}/racing_ai_model.pth")
    
    # Create README
    readme_content = """# Racing AI Deployment Package

## Files Included:
- racing_ai_model.pth: Trained PyTorch model
- README.txt: This file

## Deployment Steps:

### 1. Copy to Raspberry Pi
```bash
scp -r deployment/* pi@raspberrypi:~/racing_ai/
```

### 2. On Raspberry Pi, install dependencies:
```bash
pip install torch websockets numpy
```

### 3. Run the MCP server:
```bash
python mcp_racing_server.py
```

### 4. Get Pi's IP address:
```bash
hostname -I
```

### 5. Connect game to Pi:
In your Phaser game, use:
```javascript
const mcpClient = new MCPClient('ws://PI_IP_HERE:5000');
```

## Model Info:
- Training date: {timestamp}
- Checkpoints: {num_checkpoints}
- Model size: {model_size} MB

## Testing:
To test the model locally:
```python
from racing_ai_trainer import RacingAIInference

inference = RacingAIInference('racing_ai_model.pth')
prediction = inference.predict({
    'x': 512, 'y': 384,
    'vx': 150, 'vy': 0,
    'angle': 0.0,
    'nearestCheckpoint': 0
})
print(prediction)
```

## Troubleshooting:
- If WebSocket won't connect, check Pi's firewall
- Make sure port 5000 is open
- Verify Pi and game are on same network
- Check Pi's IP hasn't changed (use static IP if possible)
"""
    
    # Get model info
    checkpoint = torch.load(model_path, map_location='cpu')
    timestamp = checkpoint.get('timestamp', 'Unknown')
    num_checkpoints = len(checkpoint.get('checkpoint_positions', []))
    model_size = os.path.getsize(model_path) / (1024 * 1024)
    
    readme_content = readme_content.format(
        timestamp=timestamp,
        num_checkpoints=num_checkpoints,
        model_size=f"{model_size:.2f}"
    )
    
    with open(output_path / 'README.txt', 'w') as f:
        f.write(readme_content)
    print(f"   ✓ Created README.txt")
    
    # Create quick start script
    quickstart = """#!/bin/bash
# Quick start script for Raspberry Pi

echo "Starting Racing AI Server..."
echo "Make sure you have installed: pip install torch websockets numpy"
echo ""

# Check if model exists
if [ ! -f "racing_ai_model.pth" ]; then
    echo "ERROR: racing_ai_model.pth not found!"
    exit 1
fi

# Get IP address
IP=$(hostname -I | awk '{print $1}')
echo "Raspberry Pi IP: $IP"
echo "Connect your game to: ws://$IP:5000"
echo ""

# Run server (assuming mcp_racing_server.py is in same directory)
python3 mcp_racing_server.py
"""
    
    with open(output_path / 'start_server.sh', 'w') as f:
        f.write(quickstart)
    os.chmod(output_path / 'start_server.sh', 0o755)
    print(f"   ✓ Created start_server.sh")
    
    print(f"\n✅ Deployment package ready in '{output_dir}/' folder")
    print(f"   Copy entire folder to Raspberry Pi and run: ./start_server.sh")


# ============================================================================
# MAIN TRAINING SCRIPT
# ============================================================================

def main():
    print("=" * 70)
    print("🏎️  RACING AI TRAINER")
    print("=" * 70)
    print()
    
    # CONFIGURATION - UPDATE THESE FOR YOUR TRACK
    CHECKPOINT_POSITIONS = [
        {'x': 200, 'y': 300},
        {'x': 800, 'y': 300},
        {'x': 800, 'y': 600},
        {'x': 200, 'y': 600}
    ]
    
    CANVAS_WIDTH = 1024
    CANVAS_HEIGHT = 768
    
    # Training parameters
    BATCH_SIZE = 64
    EPOCHS = 50
    LEARNING_RATE = 0.001
    TRAIN_SPLIT = 0.8
    AUTO_DETECT_CHECKPOINTS = False  # Set to True to auto-detect
    
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
        print(f"\n💡 Expected file format:")
        print(f"   telemetry_data/telemetry_2025-10-18_14-30.json")
        return
    
    print(f"📁 Found {len(json_files)} telemetry files:")
    for f in json_files:
        size_kb = f.stat().st_size / 1024
        print(f"   • {f.name} ({size_kb:.1f} KB)")
    print()
    
    # Validate data
    if not validate_telemetry_data(json_files):
        response = input("\n⚠️  Continue anyway? (y/n): ")
        if response.lower() != 'y':
            print("Training cancelled.")
            return
    
    # Auto-detect checkpoints if enabled
    if AUTO_DETECT_CHECKPOINTS:
        CHECKPOINT_POSITIONS = auto_detect_checkpoints(json_files)
    else:
        print(f"📍 Using {len(CHECKPOINT_POSITIONS)} predefined checkpoints:")
        for i, cp in enumerate(CHECKPOINT_POSITIONS):
            print(f"   Checkpoint {i}: ({cp['x']:.0f}, {cp['y']:.0f})")
        print()
    
    # Create dataset
    try:
        dataset = TelemetryDataset(
            json_files, 
            CHECKPOINT_POSITIONS,
            CANVAS_WIDTH,
            CANVAS_HEIGHT
        )
    except ValueError as e:
        print(f"❌ {e}")
        return
    
    # Analyze dataset
    analyze_dataset(dataset)
    
    # Ask user if they want to continue
    print(f"\n📊 Ready to train on {len(dataset)} frames")
    response = input("Continue with training? (y/n): ")
    if response.lower() != 'y':
        print("Training cancelled.")
        return
    
    # Split into train/validation
    train_size = int(TRAIN_SPLIT * len(dataset))
    val_size = len(dataset) - train_size
    train_dataset, val_dataset = torch.utils.data.random_split(
        dataset, [train_size, val_size]
    )
    
    print(f"\n📊 Dataset split:")
    print(f"   Training: {train_size} frames ({TRAIN_SPLIT*100:.0f}%)")
    print(f"   Validation: {val_size} frames ({(1-TRAIN_SPLIT)*100:.0f}%)")
    print()
    
    # Create data loaders
    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE, shuffle=False, num_workers=0)
    
    # Initialize trainer
    trainer = RacingAITrainer(
        CHECKPOINT_POSITIONS,
        CANVAS_WIDTH,
        CANVAS_HEIGHT
    )
    
    # Train model
    start_time = datetime.now()
    trainer.train(train_loader, val_loader, epochs=EPOCHS)
    training_time = (datetime.now() - start_time).total_seconds()
    
    # Save final model
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    model_path = f'racing_ai_model_{timestamp}.pth'
    trainer.save_model(model_path)
    
    # Also save as default name for easy deployment
    trainer.save_model('racing_ai_model.pth')
    
    # Save best model with clear name
    if Path('best_model.pth').exists():
        import shutil
        shutil.copy('best_model.pth', f'best_model_{timestamp}.pth')
        print(f"💾 Best model also saved as: best_model_{timestamp}.pth")
    
    # Plot results
    trainer.plot_training_history(f'training_history_{timestamp}.png')
    
    # Test model
    test_model_predictions('racing_ai_model.pth')
    
    # Export deployment package
    export_for_deployment('racing_ai_model.pth')
    
    # Final summary
    print("\n" + "=" * 70)
    print("✅ TRAINING COMPLETE!")
    print("=" * 70)
    print(f"\n⏱️  Training time: {training_time/60:.1f} minutes")
    print(f"\n📦 Models saved:")
    print(f"   • racing_ai_model.pth (for deployment)")
    print(f"   • {model_path} (timestamped backup)")
    print(f"   • best_model_{timestamp}.pth (best validation loss)")
    print(f"\n📊 Outputs:")
    print(f"   • training_history_{timestamp}.png")
    print(f"   • deployment/ folder (ready for Raspberry Pi)")
    print(f"\n🚀 Next steps:")
    print(f"   1. Review training_history_{timestamp}.png")
    print(f"   2. Test predictions above - do they make sense?")
    print(f"   3. Copy deployment/ folder to Raspberry Pi:")
    print(f"      scp -r deployment/* pi@raspberrypi:~/racing_ai/")
    print(f"   4. On Pi, run: cd racing_ai && ./start_server.sh")
    print(f"   5. Connect game to Pi's IP address")
    print(f"\n💡 Tips:")
    print(f"   • If AI doesn't drive well, collect MORE data (aim for 10k+ frames)")
    print(f"   • Drive smoothly - AI learns from your style!")
    print(f"   • Try different tracks to make AI more general")
    print("=" * 70)


if __name__ == "__main__":
    main()
