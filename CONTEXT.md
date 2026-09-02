# wstream

A Windows-first torrent streaming CLI. Downloads one file from a torrent sequentially, serves it over local HTTP, and optionally launches an external player.

## Language

**Stream**:
A session: one file from one torrent being downloaded sequentially and served over HTTP. `wstream` runs one Stream at a time.
_Avoid_: download, session, transfer

**Player**:
Any external program invoked as `<command> <stream-url>`. wstream knows nothing about specific Players.
_Avoid_: video player, media player, client

**Cleanup**:
Deleting the Stream's temp files and shutting down the HTTP server. Happens on player exit or Ctrl+C.
_Avoid_: teardown, purge, garbage collection

**Subtitle files**:
Subtitle files (.srt, .ass, .vtt, ...) found in the same torrent as the Stream. Downloaded and served automatically; not shown in the file picker. Their URLs are printed so the Player can load them.
_Avoid_: sidecar, captions

**Playable**:
The moment a Stream has buffered enough data that a player can start rendering it. The CLI serves the URL before this; the Player decides when playback actually starts.
_Avoid_: ready, buffered, complete
