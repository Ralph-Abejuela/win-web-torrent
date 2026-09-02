# Local HTTP server + spawned player (no stdin pipes)

The CLI serves the stream on `127.0.0.1:<port>` and spawns the player pointed at that URL, instead of piping bytes to the player's stdin. Pipes are fragile on Windows (console encoding, quoting, per-player quirks) and lock us to players that accept stdin. Any HTTP-capable player works (mpv, VLC, MPC-HC); the player process exiting is the signal to shut down and clean up.
