#!/usr/bin/env python3
"""
Diagnostic test script for BowieLaser.
Verifies I2C, PCA9685 connection, channels 5 & 6 initialization, and safe release.
"""

import sys
import time
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server.hardware import ServoDriver
import json

def run_diagnostics():
    print("=" * 60)
    print("   BowieLaser Diagnostics & Hardware Verification")
    print("=" * 60)

    config_path = Path(__file__).resolve().parent / "config.json"
    with open(config_path) as f:
        conf = json.load(f)

    print(f"Hardware Config:")
    print(f" - PCA9685 I2C Address: 0x{conf['hardware']['pca9685_address']:02x}")
    print(f" - Pan Channel: {conf['hardware']['pan_channel']}")
    print(f" - Tilt Channel: {conf['hardware']['tilt_channel']}")
    print(f" - Pulse Range: {conf['hardware']['pulse_width_range']['min']} - {conf['hardware']['pulse_width_range']['max']} µs")

    driver = ServoDriver(conf)
    status = driver.get_status()
    print(f"\nInitial Driver Status:")
    for k, v in status.items():
        print(f"  {k}: {v}")

    if status["is_simulation"]:
        print("\n[WARNING] Running in SIMULATION mode. Real PCA9685 board was not accessed.")
    else:
        print("\n[SUCCESS] Real PCA9685 hardware connected on channels 5 & 6.")

    print("\nTesting safe release (PWM=0 / Duty=0 to prevent gear strain)...")
    driver.release()
    print("[SUCCESS] Servos released safely.")
    print("=" * 60)

if __name__ == "__main__":
    run_diagnostics()
