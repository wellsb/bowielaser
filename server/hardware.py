#!/usr/bin/env python3
"""
Hardware Driver for BowieLaser Pan/Tilt Servos on Adafruit 16-channel PCA9685.
Channels: 5 = Pan, 6 = Tilt.
"""

import asyncio
import logging
from typing import Dict, Optional, Tuple

logger = logging.getLogger("BowieLaser.Hardware")

try:
    from adafruit_servokit import ServoKit
    HARDWARE_SUPPORTED = True
except ImportError:
    HARDWARE_SUPPORTED = False
    logger.warning("adafruit_servokit not installed. Running in simulation mode.")


class ServoDriver:
    """Manages PCA9685 hardware interactions for Pan (Ch 5) and Tilt (Ch 6)."""

    def __init__(self, config: Dict):
        hw_conf = config.get("hardware", {})
        self.pan_channel = hw_conf.get("pan_channel", 5)
        self.tilt_channel = hw_conf.get("tilt_channel", 6)
        self.channels_total = hw_conf.get("channels_total", 16)
        self.actuation_range = hw_conf.get("actuation_range", 180)
        self.min_angle = float(hw_conf.get("min_angle", 0.0))
        self.max_angle = float(hw_conf.get("max_angle", 162.0))
        self.pulse_min = hw_conf.get("pulse_width_range", {}).get("min", 500)
        self.pulse_max = hw_conf.get("pulse_width_range", {}).get("max", 2500)
        self.simulation_requested = hw_conf.get("simulation", False)

        self.kit = None
        self.is_simulation = True
        self.is_released = True

        # Current internal angles (None means servo PWM is released/unpowered)
        self.current_pan: Optional[float] = None
        self.current_tilt: Optional[float] = None

        self._init_hardware()

    def _init_hardware(self):
        """Initialize Adafruit ServoKit if available and requested."""
        if not self.simulation_requested and HARDWARE_SUPPORTED:
            try:
                logger.info(
                    "Initializing ServoKit(channels=%d) for Pan Ch%d, Tilt Ch%d...",
                    self.channels_total,
                    self.pan_channel,
                    self.tilt_channel,
                )
                self.kit = ServoKit(channels=self.channels_total)

                # Configure pulse width ranges for pan and tilt servos
                for ch in (self.pan_channel, self.tilt_channel):
                    servo_obj = self.kit.servo[ch]
                    servo_obj.set_pulse_width_range(self.pulse_min, self.pulse_max)
                    servo_obj.actuation_range = self.actuation_range

                self.is_simulation = False
                logger.info(
                    "ServoKit initialized successfully. Pulse range: %d-%d µs",
                    self.pulse_min,
                    self.pulse_max,
                )
            except Exception as e:
                logger.error("Failed to initialize ServoKit hardware: %s", e)
                logger.info("Falling back to simulation mode.")
                self.kit = None
                self.is_simulation = True
        else:
            self.is_simulation = True
            logger.info("Running in simulation mode (hardware disabled or not present).")

    def move(
        self,
        pan: float,
        tilt: float,
        clamp_limits: Optional[Tuple[float, float, float, float]] = None,
    ) -> Dict[str, float]:
        """
        Move servos to specified pan and tilt angles.
        clamp_limits: (pan_min, pan_max, tilt_min, tilt_max) if limit enforcement is active.
        """
        # Clamp to provided calibration limits or physical 0-180 range
        if clamp_limits:
            p_min, p_max, t_min, t_max = clamp_limits
            pan = max(p_min, min(pan, p_max))
            tilt = max(t_min, min(tilt, t_max))

        # Absolute physical clamping (protect gears: 0 to 170)
        pan = max(self.min_angle, min(float(pan), float(self.max_angle)))
        tilt = max(self.min_angle, min(float(tilt), float(self.max_angle)))

        # Send to hardware if active
        if self.kit and not self.is_simulation:
            try:
                self.kit.servo[self.pan_channel].angle = pan
                self.kit.servo[self.tilt_channel].angle = tilt
            except Exception as e:
                logger.error("Error writing to servos: %s", e)

        self.current_pan = round(pan, 2)
        self.current_tilt = round(tilt, 2)
        self.is_released = False

        return {"pan": self.current_pan, "tilt": self.current_tilt}

    def release(self):
        """
        Set PWM to 0 on both channels.
        This disables torque so servos stop buzzing and do not strain gears!
        """
        if self.kit and not self.is_simulation:
            try:
                self.kit.servo[self.pan_channel].angle = None
                self.kit.servo[self.tilt_channel].angle = None
            except Exception as e:
                logger.error("Error releasing servos: %s", e)

        self.is_released = True
        logger.info("Servos released (PWM disabled).")

    async def move_smooth(
        self,
        target_pan: float,
        target_tilt: float,
        steps: int = 15,
        interval_sec: float = 0.02,
        clamp_limits: Optional[Tuple[float, float, float, float]] = None,
    ):
        """Gently interpolate to target to avoid jerky movements that strip gears."""
        start_pan = self.current_pan if self.current_pan is not None else target_pan
        start_tilt = self.current_tilt if self.current_tilt is not None else target_tilt

        if steps <= 1:
            return self.move(target_pan, target_tilt, clamp_limits=clamp_limits)

        for i in range(1, steps + 1):
            t = i / steps
            # Smooth cosine easing
            # ease = (1 - math.cos(t * math.pi)) / 2
            curr_p = start_pan + (target_pan - start_pan) * t
            curr_t = start_tilt + (target_tilt - start_tilt) * t
            self.move(curr_p, curr_t, clamp_limits=clamp_limits)
            await asyncio.sleep(interval_sec)

        return {"pan": self.current_pan, "tilt": self.current_tilt}

    def get_status(self) -> Dict:
        """Return current hardware status."""
        return {
            "pan": self.current_pan,
            "tilt": self.current_tilt,
            "is_released": self.is_released,
            "is_simulation": self.is_simulation,
            "pan_channel": self.pan_channel,
            "tilt_channel": self.tilt_channel,
        }
