# Market Rewind — macOS Tools & Startup Daemons

This directory contains scripts to manage **Market Rewind** on macOS, including setting it up as an automatic background service that starts whenever your Mac boots or logs in.

---

## 🚀 Quick Reference

| Action | Command | Description |
|---|---|---|
| **Install Auto-Startup** | `./tools/mac/install-startup.sh` | Registers macOS LaunchAgents to start backend & frontend automatically at login / boot. |
| **Uninstall Auto-Startup** | `./tools/mac/uninstall-startup.sh` | Disables automatic startup and removes LaunchAgents. |
| **Start Services** | `./tools/mac/start-services.sh` | Manually starts both backend (8765) and frontend (3000) in the background. |
| **Stop Services** | `./tools/mac/stop-services.sh` | Stops all running Market Rewind processes cleanly. |
| **Restart Services** | `./tools/mac/restart-services.sh` | Cleanly stops and restarts all services. |
| **Check Status** | `./tools/mac/status-services.sh` | Shows live health, PIDs, memory, port status, and network access URLs. |

---

## 📱 Granular Control

If you only need to run or debug a specific service:

* **Backend Only (Python + DuckDB Tick Lake)**:
  * `./tools/mac/start-backend.sh` — Starts Python streaming service on port `8765`.
  * `./tools/mac/start-backend.sh --foreground` — Runs backend in foreground for debugging.
  * `./tools/mac/stop-backend.sh` — Stops backend process.

* **Frontend Only (React UI)**:
  * `./tools/mac/start-frontend.sh` — Starts Vite web server on port `3000`.
  * `./tools/mac/start-frontend.sh --foreground` — Runs Vite in foreground for debugging.
  * `./tools/mac/stop-frontend.sh` — Stops frontend process.

---

## ⚙️ How Automatic Startup Works (Launchd)

When you run `./tools/mac/install-startup.sh`, it configures standard macOS **LaunchAgents**:

1. **Backend Agent**: `~/Library/LaunchAgents/com.marketrewind.backend.plist`
2. **Frontend Agent**: `~/Library/LaunchAgents/com.marketrewind.frontend.plist`

These LaunchAgents:
* Run in the background under your user account with `RunAtLoad = true`.
* Automatically restart if they crash (`KeepAlive = true`).
* Automatically wake up and start whenever you turn on or open your Mac.

---

## 🪵 Log Files

All logs are written to macOS's standard user logging directory:

* **Backend Standard Output**: `~/Library/Logs/MarketRewind/backend.log`
* **Backend Error Log**: `~/Library/Logs/MarketRewind/backend.error.log`
* **Frontend Standard Output**: `~/Library/Logs/MarketRewind/frontend.log`
* **Frontend Error Log**: `~/Library/Logs/MarketRewind/frontend.error.log`

To watch live logs in real time:
```bash
tail -f ~/Library/Logs/MarketRewind/*.log
```

---

## 📱 Accessing from a Tablet (iPad / Galaxy Tab)

Once services are running, you can connect from any tablet on your local Wi-Fi or Tailscale:

* **Home Wi-Fi**: Check `./tools/mac/status-services.sh` for your local IP (e.g. `http://192.168.100.34:3000`).
* **Tailscale**: Access via your Mac's Tailscale IP (e.g. `http://100.74.225.109:3000`).
