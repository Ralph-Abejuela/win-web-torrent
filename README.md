# wstream

Windows-first torrent streaming CLI. Download a file from a torrent sequentially, stream it over local HTTP, and play it in any player.

Born from frustration: peerflix is unmaintained and leaks `%TEMP%\torrent-stream` folders forever on Windows; webtorrent-cli's player spawning breaks on Windows. `wstream` does one thing correctly: it streams one file, cleans up after itself, and stays honest about what's happening.

## Install

```sh
npm i -g win-web-torrent
```

## Usage

```sh
wstream <magnet | .torrent path | .torrent URL> [flags]
```

Single-file torrents start streaming immediately. Multi-file torrents show a numbered list of media files.

```sh
wstream "magnet:?xt=urn:btih:..."                # print stream URL, Ctrl+C to stop
wstream "magnet:?..." --player mpv               # spawn mpv with the stream URL
wstream "magnet:?..." --player mpv --player-args "--fullscreen"
wstream movie.torrent --file 2                   # stream the 2nd media file, skip picker
```

Subtitles (`.srt`, `.ass`, `.ssa`, `.vtt`, `.sub`) found in the torrent are downloaded and served automatically — their URLs are printed for your player.

## Flags

| Flag | Meaning |
| --- | --- |
| `--player <cmd>` | Spawn this command with the stream URL. Omit to just serve. |
| `--player-args "<args>"` | Extra arguments for the player. |
| `--file <n>` | Pick the nth media file, skipping the prompt. |
| `--port <n>` | Pin the HTTP port (default: random free port). |
| `--dir <path>` | Download location (default: `%TEMP%\win-web-torrent`). |
| `--keep` | Keep downloaded files after the stream ends. |

## Behavior

- **Sequential download** prioritized for the picked file so playback starts fast and seeking stays ahead of the player.
- **Cleanup**: the torrent is destroyed and temp files deleted when the player exits or you press Ctrl+C. Folders orphaned by a crash are swept at the next startup.
- **No seeding**: uploads end when the stream ends.
- **Honest status**: one in-place line with percent, size, speed, and peer count. If peers are 0, it says so.

## Development

Requires Node 22.6+ (native TypeScript) and pnpm.

```sh
pnpm install
pnpm dev -- <magnet>       # run from source
pnpm test                  # unit tests (node:test)
pnpm build                 # bundle dist/cli.js for publishing
```

Design decisions live in [docs/adr/](docs/adr/), domain language in [CONTEXT.md](CONTEXT.md).

## License

MIT
