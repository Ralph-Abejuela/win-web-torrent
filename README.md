# wstream

A minimal torrent streaming CLI, built and tested on Windows. It downloads one file from a torrent sequentially, serves it over local HTTP, and can launch your player against the stream URL.

wstream is built on the [webtorrent](https://github.com/webtorrent/webtorrent) library — the same engine used by [webtorrent-cli](https://github.com/webtorrent/webtorrent-cli). All torrent protocol work (DHT, trackers, piece selection, HTTP serving with range requests) is done by that library. wstream itself is a small CLI layer on top of it.

Compared to webtorrent-cli, wstream is deliberately narrower: it streams one file and cleans up after itself. webtorrent-cli has more features (download/seed commands, Chromecast, AirPlay) and is actively maintained — if it works for you, use it. What wstream tries to get right, primarily on Windows:

- Temp files go to `%TEMP%\win-web-torrent\<infohash>` and are deleted on exit. Folders left by a crash are swept at the next startup.
- No player is launched unless you ask for it with `--player <cmd>`. The player is invoked as `<cmd> <stream-url>` with no per-player special cases, which sidesteps the player-spawn bugs those tools have had on Windows.
- One in-place status line showing progress, speed, and peer count — no dashboard, no hidden failures.

## Install

Requires Node 18+ (the published bundle) or Node 22.6+ to run from source.

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
wstream movie.torrent --file 2                   # stream the 2nd media file, skip the prompt
```

Subtitle files (`.srt`, `.ass`, `.ssa`, `.vtt`, `.sub`) found in the same torrent are also downloaded and served; their URLs are printed so your player can load them.

## Flags

| Flag | Meaning |
| --- | --- |
| `--player <cmd>` | Spawn this command with the stream URL. Omit to just serve. |
| `--player-args "<args>"` | Extra arguments for the player. |
| `--file <n>` | Pick the nth media file, skipping the prompt. |
| `--port <n>` | Pin the HTTP port (default: random free port). |
| `--dir <path>` | Download location (default: `%TEMP%\win-web-torrent`). |
| `--keep` | Keep downloaded files after the stream ends. |

## Behavior and limits

- The picked file's pieces are prioritized for sequential download; pieces needed by the player are fetched on demand, so seeking works before the download completes. How far ahead of playback this keeps you depends on swarm speed.
- On player exit or Ctrl+C, the torrent is destroyed and temp files are deleted. Nothing is seeded.
- One stream at a time. No download manager, no resume, no Chromecast/AirPlay, no media search.
- Tested on Windows 11 with Node 24 and with mpv. Other setups and players should work — the player interface is just `<cmd> <url>` — but are untested.

## Development

Requires Node 22.6+ (native TypeScript) and pnpm.

```sh
pnpm install
pnpm dev -- <magnet>       # run from source
pnpm build                 # bundle dist/cli.js for publishing
```

Design decisions live in [docs/adr/](docs/adr/), domain language in [CONTEXT.md](CONTEXT.md).

## License

MIT
