#!/usr/bin/env bun
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import WebTorrent from 'webtorrent'

// ---- pure helpers (tested in cli.test.ts) ----

export const MEDIA_EXT = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', 'ts', 'm2ts', 'mp3', 'flac', 'aac', 'wav', 'ogg', 'm4a', 'opus']
export const SUB_EXT = ['srt', 'ass', 'ssa', 'vtt', 'sub']

const ext = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase()

export const isMedia = (name: string) => MEDIA_EXT.includes(ext(name))
export const isSubtitle = (name: string) => SUB_EXT.includes(ext(name))

export function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export interface Args {
  input?: string
  player?: string
  playerArgs: string[]
  file?: number // 1-based index into the media picker list
  port?: number
  keep: boolean
  dir?: string
  help: boolean
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { playerArgs: [], keep: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--player') args.player = argv[++i]
    else if (a === '--player-args') args.playerArgs = (argv[++i] ?? '').split(/\s+/).filter(Boolean)
    else if (a === '--file') args.file = Number(argv[++i])
    else if (a === '--port') args.port = Number(argv[++i])
    else if (a === '--keep') args.keep = true
    else if (a === '--dir') args.dir = argv[++i]
    else if (a === '--help' || a === '-h') args.help = true
    else if (!args.input) args.input = a
  }
  return args
}

const USAGE = `wstream — stream a torrent

Usage: wstream <magnet | .torrent path | .torrent URL> [flags]

Flags:
  --player <cmd>       spawn this command with the stream URL (e.g. mpv, vlc)
  --player-args "<a>"  extra args passed to the player
  --file <n>           pick the nth media file, skip the prompt
  --port <n>           pin the HTTP server port (default: random free port)
  --dir <path>         download location (default: %TEMP%\\win-web-torrent)
  --keep               keep downloaded files after the Stream ends
  -h, --help           show this help
`

// ---- main ----

if (import.meta.main) main()

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.input) {
    console.log(USAGE)
    process.exit(args.help ? 0 : 1)
  }

  const base = args.dir ?? path.join(os.tmpdir(), 'win-web-torrent')
  // ponytail: sweep assumes a single running wstream; per-stream locks if concurrent streams ever matter
  await fs.promises.rm(base, { recursive: true, force: true })

  const client = new WebTorrent()
  const torrent = client.add(args.input, { path: base })

  // wait for metadata
  await new Promise<void>((resolve, reject) => {
    if (torrent.ready) return resolve()
    torrent.once('ready', resolve)
    client.once('error', reject)
    torrent.once('error', reject)
  })

  // pick file
  const media = torrent.files.filter((f) => isMedia(f.name))
  if (media.length === 0) {
    console.error('No media files found in this torrent.')
    await cleanup(1)
  }
  let pick = media[0]
  if (media.length > 1 && !args.file) {
    console.log('Files:')
    media.forEach((f, i) => console.log(`  ${i + 1}. ${f.name}  (${humanBytes(f.length)})`))
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question('Pick: ')
    rl.close()
    const n = Number(answer.trim())
    if (!Number.isInteger(n) || n < 1 || n > media.length) {
      console.error('Invalid pick.')
      await cleanup(1)
    }
    pick = media[n - 1]
  } else if (args.file) {
    if (!(args.file >= 1 && args.file <= media.length)) {
      console.error(`--file must be 1..${media.length}`)
      await cleanup(1)
    }
    pick = media[args.file - 1]
  }

  media.forEach((f) => f.deselect())
  pick.select()
  const subs = torrent.files.filter((f) => isSubtitle(f.name))
  subs.forEach((f) => f.select())

  // serve
  const server = client.createServer()
  await new Promise<void>((resolve) => server.listen(args.port ?? 0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const baseUrl = `http://127.0.0.1:${port}/webtorrent/${torrent.infoHash}`
  const url = `${baseUrl}/${torrent.files.indexOf(pick)}/${encodeURIComponent(pick.name)}`
  console.log(`Streaming: ${pick.name} (${humanBytes(pick.length)})`)
  console.log(`Stream URL: ${url}`)
  for (const s of subs) {
    console.log(`Subtitle URL: ${baseUrl}/${torrent.files.indexOf(s)}/${encodeURIComponent(s.name)}`)
  }

  let child: ReturnType<typeof spawn> | undefined
  if (args.player) {
    const cmd = [args.player, ...args.playerArgs, url].join(' ')
    child = spawn(cmd, { shell: true, stdio: 'ignore' })
    child.on('error', (err) => {
      console.error(`Could not spawn player: ${err.message}`)
      cleanup(1)
    })
    child.once('exit', () => cleanup(0))
    console.log(`Player spawned: ${cmd}`)
  } else {
    console.log('Press Ctrl+C to stop.')
  }

  // status line
  const tick = setInterval(() => {
    const pct = (torrent.progress * 100).toFixed(1)
    const line = `${pct}%  ${humanBytes(torrent.downloaded)}/${humanBytes(torrent.length)}  ${humanBytes(torrent.downloadSpeed)}/s  ${torrent.numPeers} peers`
    process.stdout.write(`\r${line}${' '.repeat(Math.max(0, 60 - line.length))}`)
    if (torrent.numPeers === 0) process.stdout.write('  (0 peers — waiting)')
  }, 1000)

  let cleaned = false
  async function cleanup(code: number): Promise<never> {
    if (cleaned) return process.exit(code)
    cleaned = true
    clearInterval(tick)
    console.log('\nCleaning up...')
    child?.removeAllListeners()
    await new Promise<void>((resolve) => client.destroy({ destroyStore: !args.keep }, resolve))
    if (!args.keep) await fs.promises.rm(base, { recursive: true, force: true })
    process.exit(code)
  }
  process.on('SIGINT', () => cleanup(0))
  process.on('SIGTERM', () => cleanup(0))
}
