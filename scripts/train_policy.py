#!/usr/bin/env python3
"""
Jev Pilot - Neural Policy Behavior Cloning Trainer
Trains a lightweight 3-layer MLP policy on trajectory datasets exported from JevPilot.
Exports weights to `policy_weights.json` for zero-latency inference in the browser.

Usage:
    python train_policy.py --dataset jev-trajectory-city-250pts.json --epochs 50
"""

import argparse
import json
import math
import os
import sys

try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import DataLoader, TensorDataset
except ImportError:
    print("PyTorch not found. Run: pip install torch numpy")
    sys.exit(1)


class DrivingPolicyMLP(nn.Module):
    def __init__(self, in_dim=11, hidden1=24, hidden2=16, out_dim=2):
        super().__init__()
        self.fc1 = nn.Linear(in_dim, hidden1)
        self.relu1 = nn.ReLU()
        self.fc2 = nn.Linear(hidden1, hidden2)
        self.relu2 = nn.ReLU()
        self.fc3 = nn.Linear(hidden2, out_dim)

    def forward(self, x):
        h1 = self.relu1(self.fc1(x))
        h2 = self.relu2(self.fc2(h1))
        out = self.fc3(h2)
        # Dim 0: steering [-1, 1], Dim 1: target velocity ratio [0, 1.2]
        steer = torch.tanh(out[:, 0:1])
        speed = torch.sigmoid(out[:, 1:2]) * 1.2
        return torch.cat([steer, speed], dim=1)


def parse_dataset(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    samples = data.get("samples", [])
    if not samples:
        raise ValueError("No samples found in dataset file.")

    X, Y = [], []
    for s in samples:
        st = s["state"]
        act = s["action"]

        # Feature normalization
        speed_norm = st["speed"] / 25.0
        heading_err_norm = st.get("heading_error", 0.0) / math.pi
        steer_norm = st.get("wheel_steer", 0.0)
        friction_norm = st.get("road_friction", 0.9)
        speed_limit_norm = st.get("speed_limit", 16.6) / 25.0
        adv_ahead_norm = max(-1.0, min(1.0, st.get("adv_rel_ahead", 99.0) / 50.0))
        adv_right_norm = max(-1.0, min(1.0, st.get("adv_rel_right", 0.0) / 4.0))
        adv_ttc_norm = min(1.0, st.get("adv_ttc", 9.9) / 5.0)
        adv_speed_norm = st.get("adv_speed", 0.0) / 25.0
        has_scenario = 1.0 if st.get("scenario", "cruising") != "cruising" else 0.0
        brake_active = 1.0 if act.get("brake", 0.0) > 0.1 else 0.0

        x_vec = [
            speed_norm,
            heading_err_norm,
            steer_norm,
            friction_norm,
            speed_limit_norm,
            adv_ahead_norm,
            adv_right_norm,
            adv_ttc_norm,
            adv_speed_norm,
            has_scenario,
            brake_active,
        ]

        target_steer = act["steering"]
        speed_ratio = act["target_velocity"] / max(1.0, st.get("speed_limit", 16.6))
        y_vec = [target_steer, max(0.0, min(1.2, speed_ratio))]

        X.append(x_vec)
        Y.append(y_vec)

    print(f"Loaded {len(X)} trajectory frames from {file_path}")
    return torch.tensor(X, dtype=torch.float32), torch.tensor(Y, dtype=torch.float32)


def export_weights_to_json(model, output_path="policy_weights.json"):
    weights = {
        "name": "Trained-MLP-Policy (11x24x16x2)",
        "w1": model.fc1.weight.detach().cpu().numpy().tolist(),
        "b1": model.fc1.bias.detach().cpu().numpy().tolist(),
        "w2": model.fc2.weight.detach().cpu().numpy().tolist(),
        "b2": model.fc2.bias.detach().cpu().numpy().tolist(),
        "w3": model.fc3.weight.detach().cpu().numpy().tolist(),
        "b3": model.fc3.bias.detach().cpu().numpy().tolist(),
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(weights, f, indent=2)
    print(f"Exported browser-ready policy weights to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Train Jev Pilot MLP Behavior Cloning Policy")
    parser.add_argument("--dataset", type=str, required=True, help="Path to exported trajectory JSON")
    parser.add_argument("--epochs", type=int, default=60, help="Number of training epochs")
    parser.add_argument("--lr", type=float, default=0.003, help="Learning rate")
    parser.add_argument("--output", type=str, default="policy_weights.json", help="Output weights path")
    args = parser.parse_args()

    X, Y = parse_dataset(args.dataset)
    dataset = TensorDataset(X, Y)
    loader = DataLoader(dataset, batch_size=32, shuffle=True)

    model = DrivingPolicyMLP()
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=args.lr, weight_decay=1e-5)

    print("\nStarting Behavior Cloning Training Loop...")
    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        for batch_x, batch_y in loader:
            optimizer.zero_grad()
            preds = model(batch_x)
            loss = criterion(preds, batch_y)
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * len(batch_x)

        avg_loss = total_loss / len(dataset)
        if epoch % 10 == 0 or epoch == 1:
            print(f"Epoch [{epoch:03d}/{args.epochs:03d}] - Loss: {avg_loss:.6f}")

    export_weights_to_json(model, args.output)
    print("\nTraining Complete! You can now load these weights in Jev Pilot Reflex.")


if __name__ == "__main__":
    main()
