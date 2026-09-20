#!/bin/bash
# BowieLaser Stop Script
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$DIR/server.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "Stopping BowieLaser server (PID: $PID)..."
        kill "$PID"
        sleep 1
        if ps -p "$PID" > /dev/null 2>&1; then
            kill -9 "$PID"
        fi
        rm -f "$PID_FILE"
        echo "BowieLaser stopped."
    else
        echo "PID file exists but process $PID is not running. Removing stale PID file."
        rm -f "$PID_FILE"
    fi
else
    # Fallback search
    PIDS=$(pgrep -f "server/laser_server.py")
    if [ -n "$PIDS" ]; then
        echo "Stopping BowieLaser process(es): $PIDS"
        kill $PIDS
    else
        echo "BowieLaser is not running."
    fi
fi
