import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { humanBytes, isMedia, isSubtitle, parseArgs } from './cli.ts'

describe('parseArgs', () => {
  it('input only', () => {
    const a = parseArgs(['magnet:?xt=urn:btih:abc'])
    assert.equal(a.input, 'magnet:?xt=urn:btih:abc')
    assert.deepEqual(a.playerArgs, [])
    assert.equal(a.keep, false)
  })
  it('all flags', () => {
    const a = parseArgs(['x.torrent', '--player', 'mpv', '--player-args', '--fullscreen --volume=50', '--file', '2', '--port', '8888', '--keep', '--dir', 'C:\\tmp\\x'])
    assert.equal(a.player, 'mpv')
    assert.deepEqual(a.playerArgs, ['--fullscreen', '--volume=50'])
    assert.equal(a.file, 2)
    assert.equal(a.port, 8888)
    assert.equal(a.keep, true)
    assert.equal(a.dir, 'C:\\tmp\\x')
  })
  it('missing --player value does not swallow input', () => {
    const a = parseArgs(['--player'])
    assert.equal(a.player, undefined)
    assert.equal(a.input, undefined)
  })
})

describe('file classification', () => {
  it('media', () => {
    assert.equal(isMedia('Movie.2020.1080p.mkv'), true)
    assert.equal(isMedia('song.MP3'), true)
    assert.equal(isMedia('notes.txt'), false)
    assert.equal(isMedia('noext'), false)
  })
  it('subtitles', () => {
    assert.equal(isSubtitle('movie.en.srt'), true)
    assert.equal(isSubtitle('subs.ass'), true)
    assert.equal(isSubtitle('movie.mkv'), false)
  })
})

describe('humanBytes', () => {
  it('scales', () => {
    assert.equal(humanBytes(0), '0 B')
    assert.equal(humanBytes(512), '512 B')
    assert.equal(humanBytes(1024), '1.0 KB')
    assert.equal(humanBytes(2.1 * 1024 ** 3), '2.1 GB')
  })
})
