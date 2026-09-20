#!/usr/bin/env python3
"""
Automated WebSocket test for BowieLaser.
Tests:
1. Connection & state sync
2. Unconstrained manual movement by default (allows reaching all corners from 0° to 162°)
3. "Set Bottom Left", "Set Top Right", "Set Top Left", "Set Bottom Right" 4-corner calibration
4. Jumping to corners via Go buttons
5. Optional manual lock to floor area
6. Absolute hardware limit clamping to [0.0, 162.0]
7. Safe E-Stop PWM release
"""

import asyncio
import json
import websockets
import sys

async def test_bowielaser_websocket():
    url = "ws://127.0.0.1:8765/ws"
    print(f"Connecting to {url}...")

    async with websockets.connect(url) as ws:
        # 1. Initial state
        raw_state = await asyncio.wait_for(ws.recv(), timeout=5.0)
        state = json.loads(raw_state)
        assert state["type"] == "state"
        print(f"[PASS] Connected. Initial state: Pan={state['pan']}°, Tilt={state['tilt']}°, Real HW={not state['is_simulation']}")

        # 2. Ensure lock_manual is False (default) so manual steering is unconstrained
        await ws.send(json.dumps({
            "type": "set_calibration",
            "calibration": {"lock_manual": False}
        }))
        state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
        assert state["calibration"]["lock_manual"] is False
        print("[PASS] Manual movement is unconstrained by default to allow reaching corners.")

        # 3. Test that manual movement can explore beyond previous boundaries (e.g. 140° Pan, 80° Tilt)
        print("Testing unconstrained manual move to Pan=140.0°, Tilt=80.0°...")
        await ws.send(json.dumps({"type": "move", "pan": 140.0, "tilt": 80.0}))
        state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
        assert abs(state['pan'] - 140.0) < 0.1 and abs(state['tilt'] - 80.0) < 0.1
        print(f"[PASS] Manual steering reached outside target: Pan={state['pan']}°, Tilt={state['tilt']}°")

        # 4. Test "Set Top Left" at current position (140°, 80°)
        print("Testing 'Set Top Left' (should set Pan Left=140° and Tilt Top=80°)...")
        await ws.send(json.dumps({"type": "record_limit", "target": "top_left"}))
        state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
        lims = state["calibration"]["limits"]
        corners = state["calibration"]["corners"]
        assert abs(lims["pan_max"] - 140.0) < 0.1
        assert abs(lims["tilt_max"] - 80.0) < 0.1
        assert abs(corners["top_left"]["pan"] - 140.0) < 0.1
        assert abs(corners["top_left"]["tilt"] - 80.0) < 0.1
        print(f"[PASS] Set Top Left verified: Pan Left={lims['pan_max']}°, Tilt Top={lims['tilt_max']}°")

        # 5. Move to bottom-right corner (Pan=25.0°, Tilt=12.0°)
        print("Moving to Bottom-Right corner: Pan=25.0°, Tilt=12.0°...")
        await ws.send(json.dumps({"type": "move", "pan": 25.0, "tilt": 12.0}))
        state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
        assert abs(state['pan'] - 25.0) < 0.1 and abs(state['tilt'] - 12.0) < 0.1

        # 6. Test "Set Bottom Right"
        print("Testing 'Set Bottom Right' (should set Pan Right=25° and Tilt Bottom=12°)...")
        await ws.send(json.dumps({"type": "record_limit", "target": "bottom_right"}))
        state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
        lims = state["calibration"]["limits"]
        corners = state["calibration"]["corners"]
        assert abs(corners["bottom_right"]["pan"] - 25.0) < 0.1
        assert abs(corners["bottom_right"]["tilt"] - 12.0) < 0.1
        assert abs(lims["pan_min"] - min(c["pan"] for c in corners.values())) < 0.1
        assert abs(lims["tilt_min"] - min(c["tilt"] for c in corners.values())) < 0.1
        print(f"[PASS] Set Bottom Right verified: Pan Right={corners['bottom_right']['pan']}°, Tilt Bottom={corners['bottom_right']['tilt']}°")

        # 7. Test "Go to Top-Left" corner
        print("Testing Go to Top-Left corner...")
        await ws.send(json.dumps({"type": "corner", "corner": "top_left"}))
        state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
        assert abs(state['pan'] - 140.0) < 0.1 and abs(state['tilt'] - 80.0) < 0.1
        print(f"[PASS] Reached Top-Left corner: Pan={state['pan']}°, Tilt={state['tilt']}°")

        # 8. Test "Go to Bottom-Right" corner
        print("Testing Go to Bottom-Right corner...")
        await ws.send(json.dumps({"type": "corner", "corner": "bottom_right"}))
        state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
        assert abs(state['pan'] - 25.0) < 0.1 and abs(state['tilt'] - 12.0) < 0.1
        print(f"[PASS] Reached Bottom-Right corner: Pan={state['pan']}°, Tilt={state['tilt']}°")

        # 9. Test "Go to Center"
        print("Testing Go to Center...")
        await ws.send(json.dumps({"type": "center"}))
        state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
        expected_p = state["calibration"]["center"]["pan"]
        expected_t = state["calibration"]["center"]["tilt"]
        assert abs(state['pan'] - expected_p) < 0.2 and abs(state['tilt'] - expected_t) < 0.2
        print(f"[PASS] Reached floor center: Pan={state['pan']}°, Tilt={state['tilt']}°")

        # 10. Test Absolute Mechanical Hardware Limits 0.0° and 155.0°
        print("Testing hardware upper limit clamping (commanding 180°, 180°)...")
        await ws.send(json.dumps({"type": "move", "pan": 180.0, "tilt": 180.0}))
        state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
        assert state['pan'] == 155.0 and state['tilt'] == 155.0
        print(f"[PASS] Hard limit 155.0° enforced: Pan={state['pan']}°, Tilt={state['tilt']}°")

        print("Testing hardware lower limit clamping (commanding -20°, -20°)...")
        await ws.send(json.dumps({"type": "move", "pan": -20.0, "tilt": -20.0}))
        state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
        assert state['pan'] == 0.0 and state['tilt'] == 0.0
        print(f"[PASS] Hard limit 0.0° enforced: Pan={state['pan']}°, Tilt={state['tilt']}°")

        # 11. Test Optional lock_manual = True
        print("Testing lock_manual = True (clamps manual movement to floor box)...")
        await ws.send(json.dumps({
            "type": "set_calibration",
            "calibration": {"lock_manual": True}
        }))
        state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
        await ws.send(json.dumps({"type": "move", "pan": 160.0, "tilt": 160.0}))
        state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
        assert state['pan'] == 140.0 and state['tilt'] == 80.0
        print(f"[PASS] With lock_manual=True, manual movement clamped to floor box: Pan={state['pan']}°, Tilt={state['tilt']}°")

        # Reset lock_manual to False
        await ws.send(json.dumps({
            "type": "set_calibration",
            "calibration": {
                "lock_manual": False,
                "limits": {"pan_min": 35.0, "pan_max": 127.0, "tilt_min": 15.0, "tilt_max": 65.0},
                "center": {"pan": 81.0, "tilt": 40.0}
            }
        }))
        state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))

        # 12. E-Stop / Release Servos
        await ws.send(json.dumps({"type": "release"}))
        state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
        assert state['is_released'] is True
        print("[PASS] Servos safely released (PWM=0).")

    print("\n==========================================================================")
    print(" ALL TESTS PASSED: 4-CORNER SETTERS, UNCONSTRAINED MANUAL, HARDWARE 155°!")
    print("==========================================================================")

if __name__ == "__main__":
    asyncio.run(test_bowielaser_websocket())
