#!/usr/bin/env python3
"""
BowieLaser Standalone Backend Server.
Provides WebSocket & REST endpoints for Pan/Tilt laser control and calibration.
PCA9685 Channels: 5 = Pan, 6 = Tilt.
"""

import asyncio
import datetime
import json
import logging
import math
import os
import random
import sys
from pathlib import Path
from typing import Dict, List, Optional, Set

import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Add parent directory to path
BASE_DIR = Path(__file__).resolve().parent.parent
SERVER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from server.hardware import ServoDriver

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("BowieLaser.Server")


class LaserApplication:
    """Core application state, calibration manager, pattern runner, and hardware coordinator."""

    def __init__(self):
        self.config_path = SERVER_DIR / "config.json"
        self.calibration_path = SERVER_DIR / "calibration.json"

        self.config = self._load_json(self.config_path, default={})
        self.calibration = self._load_json(
            self.calibration_path,
            default={
                "limits": {"pan_min": 35.0, "pan_max": 127.0, "tilt_min": 15.0, "tilt_max": 65.0},
                "center": {"pan": 81.0, "tilt": 40.0},
                "corners": {
                    "top_left": {"pan": 127.0, "tilt": 65.0},
                    "top_right": {"pan": 35.0, "tilt": 65.0},
                    "bottom_left": {"pan": 127.0, "tilt": 15.0},
                    "bottom_right": {"pan": 35.0, "tilt": 15.0},
                },
                "enforce_limits": True,
                "invert_pan": False,
                "invert_tilt": False,
                "calibrated": True,
            },
        )

        self.driver = ServoDriver(self.config)
        self.active_clients: Set[WebSocket] = set()

        # Active background pattern task
        self.current_pattern: Optional[str] = None
        self.pattern_task: Optional[asyncio.Task] = None
        self.pattern_speed: float = 1.0
        self.pattern_dwell: float = 1.0

        # Calibration mode allows stepping outside limits to test mechanical stops
        self.calibration_mode: bool = not self.calibration.get("calibrated", False)

        # Initialize servos to center position gently
        center_pan = self.calibration.get("center", {}).get("pan", 81.0)
        center_tilt = self.calibration.get("center", {}).get("tilt", 81.0)
        self.driver.move(center_pan, center_tilt)

    def _load_json(self, path: Path, default: Dict) -> Dict:
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error("Error reading %s: %s", path, e)
        return default

    def save_calibration(self) -> bool:
        """Persist current calibration to disk."""
        try:
            self.calibration["updated_at"] = datetime.datetime.now().isoformat()
            with open(self.calibration_path, "w", encoding="utf-8") as f:
                json.dump(self.calibration, f, indent=2)
            logger.info("Saved calibration to %s", self.calibration_path)
            return True
        except Exception as e:
            logger.error("Failed to save calibration: %s", e)
            return False

    def get_clamp_limits(self, manual: bool = False) -> tuple:
        """
        Return limits tuple (pan_min, pan_max, tilt_min, tilt_max).
        Hardware limits (0.0, 162.0, 0.0, 162.0) are always enforced to protect servo gears.
        Manual movements (D-pad, sliders, canvas) are unconstrained [0.0, 162.0] unless lock_manual is True,
        enabling the user to freely reach and set corner extremes.
        Automated patterns always strictly respect floor play area limits.
        """
        if manual and not self.calibration.get("lock_manual", False):
            return (0.0, 162.0, 0.0, 162.0)

        if self.calibration.get("enforce_limits", True) and not self.calibration_mode:
            lims = self.calibration.get("limits", {})
            return (
                lims.get("pan_min", 0.0),
                lims.get("pan_max", 162.0),
                lims.get("tilt_min", 0.0),
                lims.get("tilt_max", 162.0),
            )
        return (0.0, 162.0, 0.0, 162.0)

    def get_state(self) -> Dict:
        """Full system state representation."""
        return {
            "type": "state",
            "pan": self.driver.current_pan,
            "tilt": self.driver.current_tilt,
            "is_released": self.driver.is_released,
            "is_simulation": self.driver.is_simulation,
            "calibration_mode": self.calibration_mode,
            "calibration": self.calibration,
            "active_pattern": self.current_pattern,
            "pattern_speed": self.pattern_speed,
            "pattern_dwell": self.pattern_dwell,
            "channels": {
                "pan": self.driver.pan_channel,
                "tilt": self.driver.tilt_channel,
            },
        }

    async def broadcast_state(self):
        """Send state to all connected WebSocket clients."""
        if not self.active_clients:
            return
        state_msg = json.dumps(self.get_state())
        dead = set()
        for ws in self.active_clients:
            try:
                await ws.send_text(state_msg)
            except Exception:
                dead.add(ws)
        self.active_clients -= dead

    async def move(self, pan: float, tilt: float, smooth: bool = False, manual: bool = True):
        """Move to position with optional smooth interpolation."""
        # Stop pattern if manual move is commanded
        if self.current_pattern:
            await self.stop_pattern()

        clamp = self.get_clamp_limits(manual=manual)
        if smooth:
            await self.driver.move_smooth(pan, tilt, clamp_limits=clamp)
        else:
            self.driver.move(pan, tilt, clamp_limits=clamp)

        await self.broadcast_state()

    async def step(self, axis: str, delta: float):
        """Nudge pan or tilt by delta degrees."""
        if self.current_pattern:
            await self.stop_pattern()

        curr_p = self.driver.current_pan if self.driver.current_pan is not None else 90.0
        curr_t = self.driver.current_tilt if self.driver.current_tilt is not None else 90.0

        if axis == "pan":
            if self.calibration.get("invert_pan", False):
                delta = -delta
            curr_p += delta
        elif axis == "tilt":
            if self.calibration.get("invert_tilt", False):
                delta = -delta
            curr_t += delta

        clamp = self.get_clamp_limits(manual=True)
        self.driver.move(curr_p, curr_t, clamp_limits=clamp)
        await self.broadcast_state()

    async def dpad_move(self, direction: str, step_size: float = 2.0):
        """Handle 8-way directional pad command."""
        if self.current_pattern:
            await self.stop_pattern()

        curr_p = self.driver.current_pan if self.driver.current_pan is not None else 81.0
        curr_t = self.driver.current_tilt if self.driver.current_tilt is not None else 81.0

        d = direction.upper().strip().replace("-", "_")
        if d in ("C", "CENTER"):
            await self.center()
            return

        # Direction factors: (pan_factor, tilt_factor)
        # Note: Left is +pan, Right is -pan (swapped to match physical mounting)
        DIR_MAP = {
            "N": (0, 1),
            "UP": (0, 1),
            "S": (0, -1),
            "DOWN": (0, -1),
            "W": (1, 0),         # Left (+pan)
            "LEFT": (1, 0),
            "E": (-1, 0),        # Right (-pan)
            "RIGHT": (-1, 0),
            "NW": (1, 1),        # Upper-Left: Left (+pan), Up (+tilt)
            "UPLEFT": (1, 1),
            "UP_LEFT": (1, 1),
            "NE": (-1, 1),       # Upper-Right: Right (-pan), Up (+tilt)
            "UPRIGHT": (-1, 1),
            "UP_RIGHT": (-1, 1),
            "SW": (1, -1),       # Lower-Left: Left (+pan), Down (-tilt)
            "DOWNLEFT": (1, -1),
            "DOWN_LEFT": (1, -1),
            "SE": (-1, -1),      # Lower-Right: Right (-pan), Down (-tilt)
            "DOWNRIGHT": (-1, -1),
            "DOWN_RIGHT": (-1, -1),
        }

        factors = DIR_MAP.get(d)
        if not factors:
            logger.warning("Unrecognized D-Pad direction: %s", direction)
            return

        d_pan = factors[0] * step_size
        d_tilt = factors[1] * step_size

        if self.calibration.get("invert_pan", False):
            d_pan = -d_pan
        if self.calibration.get("invert_tilt", False):
            d_tilt = -d_tilt

        target_p = curr_p + d_pan
        target_t = curr_t + d_tilt

        clamp = self.get_clamp_limits(manual=True)
        self.driver.move(target_p, target_t, clamp_limits=clamp)
        await self.broadcast_state()

    async def center(self):
        """Move to calibrated center."""
        if self.current_pattern:
            await self.stop_pattern()

        cp = self.calibration.get("center", {}).get("pan", 81.0)
        ct = self.calibration.get("center", {}).get("tilt", 40.0)
        clamp = self.get_clamp_limits(manual=True)
        await self.driver.move_smooth(cp, ct, steps=10, clamp_limits=clamp)
        await self.broadcast_state()

    async def move_to_corner(self, corner_name: str):
        """Move to one of the 4 calibrated corners (top_left, top_right, bottom_left, bottom_right, or floor aliases)."""
        if self.current_pattern:
            await self.stop_pattern()

        alias_map = {
            "far_left": "top_left",
            "far_right": "top_right",
            "near_left": "bottom_left",
            "near_right": "bottom_right",
            "top_left": "top_left",
            "top_right": "top_right",
            "bottom_left": "bottom_left",
            "bottom_right": "bottom_right",
        }
        corner_key = alias_map.get(corner_name, corner_name)
        corners = self.calibration.get("corners", {})
        if corner_key in corners:
            pt = corners[corner_key]
            clamp = self.get_clamp_limits(manual=True)
            await self.driver.move_smooth(pt["pan"], pt["tilt"], steps=15, clamp_limits=clamp)
            await self.broadcast_state()

    async def release(self):
        """Emergency stop & PWM release."""
        if self.current_pattern:
            await self.stop_pattern()
        self.driver.release()
        await self.broadcast_state()

    def record_limit(self, target: str) -> Dict:
        """Record current servo angle into calibration (supports independent 4-corner capture and floor limits)."""
        curr_p = self.driver.current_pan if self.driver.current_pan is not None else 81.0
        curr_t = self.driver.current_tilt if self.driver.current_tilt is not None else 40.0

        # Absolute hardware clamping [0.0, 162.0]
        curr_p = round(max(0.0, min(curr_p, 162.0)), 1)
        curr_t = round(max(0.0, min(curr_t, 162.0)), 1)

        lims = self.calibration.setdefault("limits", {})
        cntr = self.calibration.setdefault("center", {})
        corners = self.calibration.setdefault("corners", {
            "top_left": {"pan": 127.0, "tilt": 65.0},
            "top_right": {"pan": 35.0, "tilt": 65.0},
            "bottom_left": {"pan": 127.0, "tilt": 15.0},
            "bottom_right": {"pan": 35.0, "tilt": 15.0},
        })

        target_norm = target.lower().strip().replace("-", "_")

        # Independent 4-Corner capture: modifies ONLY the target corner!
        if target_norm in ("top_left", "set_top_left", "tl", "far_left"):
            corners["top_left"] = {"pan": curr_p, "tilt": curr_t}
        elif target_norm in ("top_right", "set_top_right", "tr", "far_right"):
            corners["top_right"] = {"pan": curr_p, "tilt": curr_t}
        elif target_norm in ("bottom_left", "set_bottom_left", "bl", "near_left"):
            corners["bottom_left"] = {"pan": curr_p, "tilt": curr_t}
        elif target_norm in ("bottom_right", "set_bottom_right", "br", "near_right"):
            corners["bottom_right"] = {"pan": curr_p, "tilt": curr_t}
        # Single-axis boundary setters (Card 2)
        elif target_norm in ("pan_min", "pan_right", "floor_right", "right"):
            lims["pan_min"] = curr_p
        elif target_norm in ("pan_max", "pan_left", "floor_left", "left"):
            lims["pan_max"] = curr_p
        elif target_norm in ("tilt_min", "tilt_bottom", "tilt_near", "floor_near", "near", "bottom"):
            lims["tilt_min"] = curr_t
        elif target_norm in ("tilt_max", "tilt_top", "tilt_far", "floor_far", "far", "top"):
            lims["tilt_max"] = curr_t
        elif target_norm in ("center", "floor_center"):
            cntr["pan"] = curr_p
            cntr["tilt"] = curr_t

        # If a 4-corner setter was triggered, update bounding envelope & centroid from corners
        if target_norm in ("top_left", "set_top_left", "tl", "far_left",
                           "top_right", "set_top_right", "tr", "far_right",
                           "bottom_left", "set_bottom_left", "bl", "near_left",
                           "bottom_right", "set_bottom_right", "br", "near_right"):
            all_p = [c["pan"] for c in corners.values()]
            all_t = [c["tilt"] for c in corners.values()]
            lims["pan_min"] = round(min(all_p), 1)
            lims["pan_max"] = round(max(all_p), 1)
            lims["tilt_min"] = round(min(all_t), 1)
            lims["tilt_max"] = round(max(all_t), 1)
            cntr["pan"] = round(sum(all_p) / len(all_p), 1)
            cntr["tilt"] = round(sum(all_t) / len(all_t), 1)

        self.calibration["calibrated"] = True
        self.save_calibration()
        return self.calibration

    def update_calibration_data(self, cal_data: Dict) -> Dict:
        """Update calibration parameters, validate floor boundaries, clamp, and save."""
        if not cal_data:
            return self.calibration

        lims = self.calibration.setdefault("limits", {})
        corners = self.calibration.setdefault("corners", {})

        # If explicit corners are provided, update each corner without collapsing into a square!
        if "corners" in cal_data and isinstance(cal_data["corners"], dict):
            for ckey in ("top_left", "top_right", "bottom_left", "bottom_right"):
                if ckey in cal_data["corners"]:
                    cp = float(cal_data["corners"][ckey].get("pan", corners.get(ckey, {}).get("pan", 81.0)))
                    ct = float(cal_data["corners"][ckey].get("tilt", corners.get(ckey, {}).get("tilt", 40.0)))
                    corners[ckey] = {
                        "pan": round(max(0.0, min(cp, 162.0)), 1),
                        "tilt": round(max(0.0, min(ct, 162.0)), 1),
                    }
            # Update limits envelope from the corners
            all_p = [c["pan"] for c in corners.values()]
            all_t = [c["tilt"] for c in corners.values()]
            lims["pan_min"] = round(min(all_p), 1)
            lims["pan_max"] = round(max(all_p), 1)
            lims["tilt_min"] = round(min(all_t), 1)
            lims["tilt_max"] = round(max(all_t), 1)
        elif "limits" in cal_data:
            new_lims = cal_data["limits"]
            p_min = float(new_lims.get("pan_min", lims.get("pan_min", 35.0)))
            p_max = float(new_lims.get("pan_max", lims.get("pan_max", 127.0)))
            t_min = float(new_lims.get("tilt_min", lims.get("tilt_min", 15.0)))
            t_max = float(new_lims.get("tilt_max", lims.get("tilt_max", 65.0)))

            # Absolute hardware clamping [0.0, 162.0]
            p_min = max(0.0, min(p_min, 162.0))
            p_max = max(0.0, min(p_max, 162.0))
            t_min = max(0.0, min(t_min, 162.0))
            t_max = max(0.0, min(t_max, 162.0))

            lims["pan_min"] = round(min(p_min, p_max), 1)
            lims["pan_max"] = round(max(p_min, p_max), 1)
            lims["tilt_min"] = round(min(t_min, t_max), 1)
            lims["tilt_max"] = round(max(t_min, t_max), 1)

            # Only initialize corners from limits if corners is empty
            if not corners or len(corners) < 4:
                self.calibration["corners"] = {
                    "top_left": {"pan": lims["pan_max"], "tilt": lims["tilt_max"]},
                    "top_right": {"pan": lims["pan_min"], "tilt": lims["tilt_max"]},
                    "bottom_left": {"pan": lims["pan_max"], "tilt": lims["tilt_min"]},
                    "bottom_right": {"pan": lims["pan_min"], "tilt": lims["tilt_min"]},
                }

        if "center" in cal_data:
            cntr = self.calibration.setdefault("center", {})
            cntr["pan"] = round(float(cal_data["center"].get("pan", cntr.get("pan", 81.0))), 1)
            cntr["tilt"] = round(float(cal_data["center"].get("tilt", cntr.get("tilt", 40.0))), 1)
        elif "corners" in cal_data and corners:
            cntr = self.calibration.setdefault("center", {})
            all_p = [c["pan"] for c in corners.values()]
            all_t = [c["tilt"] for c in corners.values()]
            cntr["pan"] = round(sum(all_p) / len(all_p), 1)
            cntr["tilt"] = round(sum(all_t) / len(all_t), 1)

        if "enforce_limits" in cal_data:
            self.calibration["enforce_limits"] = bool(cal_data["enforce_limits"])
        if "lock_manual" in cal_data:
            self.calibration["lock_manual"] = bool(cal_data["lock_manual"])
        if "invert_pan" in cal_data:
            self.calibration["invert_pan"] = bool(cal_data["invert_pan"])
        if "invert_tilt" in cal_data:
            self.calibration["invert_tilt"] = bool(cal_data["invert_tilt"])

        self.calibration["calibrated"] = True
        self.save_calibration()

        # If lock_manual is active and not in calibration mode, bring current servos into floor play area envelope
        if self.calibration.get("lock_manual", False) and not self.calibration_mode:
            curr_p = self.driver.current_pan
            curr_t = self.driver.current_tilt
            if curr_p is not None and curr_t is not None:
                p_min = lims.get("pan_min", 0.0)
                p_max = lims.get("pan_max", 162.0)
                t_min = lims.get("tilt_min", 0.0)
                t_max = lims.get("tilt_max", 162.0)
                clamped_p = max(p_min, min(curr_p, p_max))
                clamped_t = max(t_min, min(curr_t, t_max))
                if abs(clamped_p - curr_p) > 0.05 or abs(clamped_t - curr_t) > 0.05:
                    self.driver.move(clamped_p, clamped_t)

        return self.calibration

    def _interpolate_quad(self, u: float, v: float) -> tuple:
        """Bilinearly interpolate inside the calibrated 4-corner floor quadrilateral.
        u in [0, 1] maps BL/TL -> BR/TR (Left to Right)
        v in [0, 1] maps BL/BR -> TL/TR (Near/Bottom to Far/Top)
        """
        corners = self.calibration.get("corners", {})
        bl = corners.get("bottom_left", {"pan": 112.4, "tilt": 21.5})
        br = corners.get("bottom_right", {"pan": 54.5, "tilt": 21.5})
        tr = corners.get("top_right", {"pan": 54.5, "tilt": 46.2})
        tl = corners.get("top_left", {"pan": 112.4, "tilt": 46.2})

        p = (
            (1.0 - u) * (1.0 - v) * bl["pan"]
            + u * (1.0 - v) * br["pan"]
            + u * v * tr["pan"]
            + (1.0 - u) * v * tl["pan"]
        )
        t = (
            (1.0 - u) * (1.0 - v) * bl["tilt"]
            + u * (1.0 - v) * br["tilt"]
            + u * v * tr["tilt"]
            + (1.0 - u) * v * tl["tilt"]
        )
        return round(p, 1), round(t, 1)

    # --- Background Pattern Generators (Perimeter Trace, Cat Play) ---

    async def start_pattern(self, pattern: str, speed: float = 1.0, dwell: float = 1.0):
        """Start an automated pattern inside the safe calibration floor area."""
        await self.stop_pattern()
        pat_norm = pattern.lower().strip()
        if pat_norm in ("smooth_random", "glide", "stalk", "smooth_stalk"):
            self.current_pattern = "smooth_random"
        else:
            self.current_pattern = pat_norm

        self.pattern_speed = max(0.2, min(speed, 10.0))
        self.pattern_dwell = max(0.1, min(dwell, 5.0))

        if self.current_pattern == "perimeter":
            self.pattern_task = asyncio.create_task(self._pattern_perimeter_loop())
        elif self.current_pattern == "random":
            self.pattern_task = asyncio.create_task(self._pattern_random_loop())
        elif self.current_pattern == "wander":
            self.pattern_task = asyncio.create_task(self._pattern_wander_loop())
        elif self.current_pattern == "smooth_random":
            self.pattern_task = asyncio.create_task(self._pattern_smooth_random_loop())

        await self.broadcast_state()

    async def stop_pattern(self):
        """Halt running pattern task."""
        if self.pattern_task and not self.pattern_task.done():
            self.pattern_task.cancel()
            try:
                await self.pattern_task
            except asyncio.CancelledError:
                pass
        self.pattern_task = None
        self.current_pattern = None
        await self.broadcast_state()

    async def _pattern_perimeter_loop(self):
        """Trace the 4 corners of the floor play area quadrilateral smoothly."""
        try:
            corners = self.calibration.get("corners", {})
            seq = [
                corners.get("bottom_left", {"pan": 112.4, "tilt": 21.5}),
                corners.get("bottom_right", {"pan": 54.5, "tilt": 21.5}),
                corners.get("top_right", {"pan": 54.5, "tilt": 46.2}),
                corners.get("top_left", {"pan": 112.4, "tilt": 46.2}),
            ]
            clamp = self.get_clamp_limits()

            while True:
                for pt in seq:
                    steps = max(2, int(30 / self.pattern_speed))
                    interval = max(0.01, 0.02 / min(self.pattern_speed, 2.0))
                    await self.driver.move_smooth(
                        pt["pan"], pt["tilt"], steps=steps, interval_sec=interval, clamp_limits=clamp
                    )
                    await self.broadcast_state()
                    # Pause at each corner
                    await asyncio.sleep(self.pattern_dwell)
        except asyncio.CancelledError:
            pass

    async def _pattern_random_loop(self):
        """Random darting motion loved by cats strictly inside the floor quadrilateral."""
        try:
            clamp = self.get_clamp_limits()

            while True:
                # Random u, v with safe margin [0.08, 0.92] so dot stays inside calibrated floor
                u = random.uniform(0.08, 0.92)
                v = random.uniform(0.08, 0.92)
                target_p, target_t = self._interpolate_quad(u, v)

                # Rapid dart or smooth glide depending on speed
                steps = max(1, int(15 / self.pattern_speed))
                interval = max(0.01, 0.015 / min(self.pattern_speed, 2.0))
                await self.driver.move_smooth(
                    target_p, target_t, steps=steps, interval_sec=interval, clamp_limits=clamp
                )
                await self.broadcast_state()

                # Dwell time for cat to react and stalk the dot
                await asyncio.sleep(self.pattern_dwell * random.uniform(0.6, 1.4))
        except asyncio.CancelledError:
            pass

    async def _pattern_smooth_random_loop(self):
        """Cross between Random Dart and Smooth Wander:
        Smoothly glides through curved ease-in-out trajectories to unpredictable random floor targets.
        """
        try:
            clamp = self.get_clamp_limits()

            # Start at current position or center
            curr_p = self.driver.current_pan if self.driver.current_pan is not None else 81.0
            curr_t = self.driver.current_tilt if self.driver.current_tilt is not None else 40.0

            while True:
                # Pick a random target within safe floor area (safe margin [0.10, 0.90])
                u = random.uniform(0.10, 0.90)
                v = random.uniform(0.10, 0.90)
                target_p, target_t = self._interpolate_quad(u, v)

                # Distance between current and target
                dp = target_p - curr_p
                dt = target_t - curr_t
                dist = math.hypot(dp, dt)

                # If distance is too small, pick another target
                if dist < 6.0:
                    continue

                # Normal vector perpendicular to the straight line direction
                nx = -dt / dist
                ny = dp / dist

                # Random arc curvature: gentle curve deflection of up to 10 degrees
                # giving it the flowing organic feel of Smooth Wander
                curvature = random.uniform(-0.25, 0.25) * min(dist, 25.0)

                # Calculate number of smooth interpolation steps based on speed and distance
                base_steps = int((dist * 1.5 + 20) / self.pattern_speed)
                steps = max(3, min(base_steps, 80))
                interval = max(0.01, 0.025 / min(self.pattern_speed, 2.0))

                for step_idx in range(1, steps + 1):
                    # Progress tau in [0.0, 1.0]
                    tau = step_idx / float(steps)

                    # Smooth S-curve easing (sinusoidal ease-in-out)
                    ease = (1.0 - math.cos(math.pi * tau)) / 2.0

                    # Base straight-line interpolated position
                    base_p = curr_p + ease * dp
                    base_t = curr_t + ease * dt

                    # Add sinusoidal arc deflection perpendicular to travel direction
                    arc_deflection = math.sin(math.pi * tau) * curvature

                    p_interp = base_p + arc_deflection * nx
                    t_interp = base_t + arc_deflection * ny

                    self.driver.move(p_interp, t_interp, clamp_limits=clamp)
                    await self.broadcast_state()
                    await asyncio.sleep(interval)

                # Ensure exact arrival at target
                curr_p, curr_t = target_p, target_t
                self.driver.move(curr_p, curr_t, clamp_limits=clamp)
                await self.broadcast_state()

                # Natural feline stalk & pounce dwell pause
                dwell_time = self.pattern_dwell * random.uniform(0.6, 1.4)

                # Subtle micro-prey twitch during pause (makes cats stalk intently!)
                if dwell_time > 0.6 and random.random() < 0.6:
                    pause_part = dwell_time * 0.45
                    await asyncio.sleep(pause_part)

                    # Tiny jitter of ~0.4°
                    jit_p = curr_p + random.uniform(-0.4, 0.4)
                    jit_t = curr_t + random.uniform(-0.4, 0.4)
                    self.driver.move(jit_p, jit_t, clamp_limits=clamp)
                    await self.broadcast_state()
                    await asyncio.sleep(0.08)

                    self.driver.move(curr_p, curr_t, clamp_limits=clamp)
                    await self.broadcast_state()
                    await asyncio.sleep(dwell_time - pause_part - 0.08)
                else:
                    await asyncio.sleep(dwell_time)

        except asyncio.CancelledError:
            pass

    async def _pattern_wander_loop(self):
        """Smooth harmonic Lissajous curve inside the floor quadrilateral."""
        try:
            clamp = self.get_clamp_limits()
            time_val = 0.0
            while True:
                u = 0.5 + 0.42 * math.sin(time_val * 1.0)
                v = 0.5 + 0.42 * math.sin(time_val * 1.618 + 0.5)
                target_p, target_t = self._interpolate_quad(u, v)

                self.driver.move(target_p, target_t, clamp_limits=clamp)
                await self.broadcast_state()

                time_val += 0.05 * self.pattern_speed
                await asyncio.sleep(0.03)
        except asyncio.CancelledError:
            pass


# Initialize FastAPI application
app = FastAPI(title="BowieLaser Control Server", version="1.0.0")
laser_app = LaserApplication()

# Enable CORS for browser UI access from any host
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/status")
async def get_status():
    """Return full state and calibration."""
    return laser_app.get_state()


@app.post("/api/move")
async def post_move(data: Dict):
    """Move to absolute pan/tilt."""
    pan = float(data.get("pan", 90))
    tilt = float(data.get("tilt", 90))
    smooth = bool(data.get("smooth", False))
    await laser_app.move(pan, tilt, smooth=smooth)
    return {"status": "ok", "pan": laser_app.driver.current_pan, "tilt": laser_app.driver.current_tilt}


@app.post("/api/step")
async def post_step(data: Dict):
    """Nudge pan or tilt."""
    axis = data.get("axis", "pan")
    delta = float(data.get("delta", 1.0))
    await laser_app.step(axis, delta)
    return {"status": "ok"}


@app.post("/api/center")
async def post_center():
    """Center the laser."""
    await laser_app.center()
    return {"status": "ok"}


@app.post("/api/release")
async def post_release():
    """Release servo torque."""
    await laser_app.release()
    return {"status": "ok"}


@app.get("/api/calibration")
async def get_calibration():
    """Get current calibration."""
    return laser_app.calibration


@app.post("/api/calibration")
async def post_calibration(data: Dict):
    """Update calibration and save to disk."""
    laser_app.update_calibration_data(data)
    await laser_app.broadcast_state()
    return {"status": "ok", "calibration": laser_app.calibration}


@app.post("/api/calibration/record")
async def post_record_limit(data: Dict):
    """Record current angle for target boundary (pan_min, pan_max, tilt_min, tilt_max, center)."""
    target = data.get("target")
    if not target:
        raise HTTPException(status_code=400, detail="Missing target")
    cal = laser_app.record_limit(target)
    await laser_app.broadcast_state()
    return {"status": "ok", "target": target, "calibration": cal}


@app.post("/api/pattern/start")
async def post_pattern_start(data: Dict):
    """Start pattern."""
    pattern = data.get("pattern", "perimeter")
    speed = float(data.get("speed", 1.0))
    dwell = float(data.get("dwell", 1.0))
    await laser_app.start_pattern(pattern, speed=speed, dwell=dwell)
    return {"status": "ok", "pattern": pattern}


@app.post("/api/pattern/stop")
async def post_pattern_stop():
    """Stop running pattern."""
    await laser_app.stop_pattern()
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Real-time bidirectional WebSocket handler."""
    await websocket.accept()
    laser_app.active_clients.add(websocket)
    logger.info("Client connected via WebSocket. Active: %d", len(laser_app.active_clients))

    # Send initial state immediately upon connection
    await websocket.send_text(json.dumps(laser_app.get_state()))

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type", "")

            if msg_type == "move":
                pan = float(msg.get("pan", 90))
                tilt = float(msg.get("tilt", 90))
                smooth = bool(msg.get("smooth", False))
                await laser_app.move(pan, tilt, smooth=smooth)

            elif msg_type == "step":
                axis = msg.get("axis", "pan")
                delta = float(msg.get("delta", 1.0))
                await laser_app.step(axis, delta)

            elif msg_type == "dpad":
                direction = msg.get("direction", "C")
                step_size = float(msg.get("step", 2.0))
                if direction == "C" or direction == "CENTER":
                    await laser_app.center()
                else:
                    await laser_app.dpad_move(direction, step_size)

            elif msg_type == "center":
                await laser_app.center()

            elif msg_type == "corner":
                corner_name = msg.get("corner", "bottom_left")
                await laser_app.move_to_corner(corner_name)

            elif msg_type == "release":
                await laser_app.release()

            elif msg_type == "record_limit":
                target = msg.get("target")
                if target:
                    laser_app.record_limit(target)
                    await laser_app.broadcast_state()

            elif msg_type == "set_calibration_mode":
                laser_app.calibration_mode = bool(msg.get("enabled", False))
                await laser_app.broadcast_state()

            elif msg_type == "set_calibration":
                cal_data = msg.get("calibration", {})
                laser_app.update_calibration_data(cal_data)
                await laser_app.broadcast_state()

            elif msg_type == "set_play_area":
                laser_app.update_calibration_data({
                    "limits": {
                        "pan_min": float(msg.get("pan_min", 35.0)),
                        "pan_max": float(msg.get("pan_max", 127.0)),
                        "tilt_min": float(msg.get("tilt_min", 15.0)),
                        "tilt_max": float(msg.get("tilt_max", 65.0)),
                    }
                })
                await laser_app.broadcast_state()

            elif msg_type == "start_pattern":
                pattern = msg.get("pattern", "perimeter")
                speed = float(msg.get("speed", 1.0))
                dwell = float(msg.get("dwell", 1.0))
                await laser_app.start_pattern(pattern, speed, dwell)

            elif msg_type == "stop_pattern":
                await laser_app.stop_pattern()

            elif msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("WebSocket exception: %s", e)
    finally:
        laser_app.active_clients.discard(websocket)
        logger.info("Client disconnected. Active: %d", len(laser_app.active_clients))


# Mount web frontend root for direct access on port 8765
if BASE_DIR.exists():
    app.mount("/", StaticFiles(directory=str(BASE_DIR), html=True), name="static")


def main():
    """Server entry point."""
    host = laser_app.config.get("server", {}).get("host", "0.0.0.0")
    port = laser_app.config.get("server", {}).get("port", 8765)
    logger.info("Starting BowieLaser Server on %s:%d", host, port)
    logger.info("Web interface accessible at: http://%s:%d/ or via Apache at /dev/bowielaser/", host, port)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
