#!/bin/bash
# BowieLaser Start Script
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PID_FILE="$DIR/server.pid"
LOG_FILE="$DIR/bowielaser.log"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "BowieLaser server is already running (PID: $PID)."
        exit 0
    else
        rm -f "$PID_FILE"
    fi
fi

echo "Starting BowieLaser backend server on port 8765..."
setsid python3 "$DIR/server/laser_server.py" > "$LOG_FILE" 2>&1 &
PID=$!
echo $PID > "$PID_FILE"
sleep 1.5

if ps -p "$PID" > /dev/null 2>&1; then
    echo "BowieLaser started successfully with PID $PID."
    IP=$(hostname -I | awk '{print $1}')
    echo "Web interface: http://$IP/dev/bowielaser/ or http://$IP:8765/"
else
    echo "Failed to start BowieLaser server. Check $LOG_FILE:"
    cat "$LOG_FILE"
    exit 1
fi
