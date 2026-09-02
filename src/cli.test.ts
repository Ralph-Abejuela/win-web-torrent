// Tests for the wstream CLI layer only (src/cli.ts).
// webtorrent itself is faked at its public v3 API boundary via main()'s deps.
import { describe, it, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { EventEmitter } from "node:events";

// ---- fakes matching webtorrent v3's public API ----

function makeFile(name: string, path = name, length = 1000) {
  return {
    name,
    path,
    length,
    selectCalls: 0,
    deselectCalls: 0,
    select() {
      this.selectCalls++;
    },
    deselect() {
      this.deselectCalls++;
    },
  };
}

class FakeTorrent extends EventEmitter {
  ready = true;
  infoHash = "aaaa1111bbbb2222cccc3333dddd4444eeee5555";
  files: ReturnType<typeof makeFile>[] = [];
  progress = 0.5;
  downloaded = 500;
  length = 1000;
  downloadSpeed = 1024;
  numPeers = 3;
}

class FakeServer {
  port = 4242;
  listenArgs: unknown[] = [];
  listen(...a: unknown[]) {
    this.listenArgs = a;
    queueMicrotask(() => (a[2] as (() => void) | undefined)?.());
  }
  address() {
    return { port: this.port };
  }
}

class FakeClient extends EventEmitter {
  static instances: FakeClient[] = [];
  constructor() {
    super();
    FakeClient.instances.push(this);
  }
  static makeTorrent: () => FakeTorrent = () => new FakeTorrent();
  added: { id: string; opts: unknown } | undefined;
  destroyCount = 0;
  add(id: string, opts: unknown) {
    this.added = { id, opts };
    return FakeClient.makeTorrent();
  }
  createServer() {
    return new FakeServer();
  }
  destroy(cb: () => void) {
    this.destroyCount++;
    cb();
  }
}

interface Env {
  exits: number[];
  signals: Record<string, () => void>;
  writes: string[];
  rms: string[];
  spawned: { cmd: string; opts: unknown; child: EventEmitter }[];
}

// per-test env: mocks auto-restore via t.mock at test end
function testEnv(t: TestContext): Env {
  const env: Env = { exits: [], signals: {}, writes: [], rms: [], spawned: [] };
  FakeClient.instances = [];
  t.mock.method(process, "exit", ((code = 0) => {
    env.exits.push(code);
    throw new CliExitError(code);
  }) as never);
  const origOn = process.on.bind(process);
  t.mock.method(
    process,
    "on",
    ((ev: string, fn: (...a: unknown[]) => void) => {
      if (ev === "SIGINT" || ev === "SIGTERM") {
        env.signals[ev] = fn as () => void;
        return process;
      }
      return origOn(ev, fn);
    }) as never,
  );
  // record AND forward: swallowing stdout breaks the TAP reporter
  const origWrite = process.stdout.write.bind(process.stdout);
  t.mock.method(
    process.stdout,
    "write",
    ((chunk: unknown, ...rest: unknown[]) => {
      env.writes.push(String(chunk));
      return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as never,
  );
  const origRm = fs.promises.rm.bind(fs.promises);
  t.mock.method(
    fs.promises,
    "rm",
    ((p: fs.PathLike, o?: fs.RmOptions) => {
      env.rms.push(String(p));
      return origRm(p, o);
    }) as never,
  );
  return env;
}

// signal-driven cleanup completes real fs I/O — wait for the observable state,
// not a tick (setImmediate can fire before fs threadpool callbacks)
const waitUntil = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++)
    await new Promise((r) => setTimeout(r, 5));
};

const IMPORT = "../src/cli.ts";
const {
  main,
  parseArgs,
  humanBytes,
  isMedia,
  isSubtitle,
  ExitError: CliExitError,
} = await import(IMPORT);

const singleTorrent = () => {
  const tor = new FakeTorrent();
  tor.files = [
    makeFile("Sintel.mp4", "Sintel.mp4", 129_318_912), // 123.3 MB
    makeFile("Sintel.en.srt", "Sintel.en.srt", 300),
  ];
  return tor;
};

describe("happy path", () => {
  it("single-file torrent: streams, prints URLs, cleans up on Ctrl+C", async (t) => {
    const env = testEnv(t);
    const tor = singleTorrent();
    FakeClient.makeTorrent = () => tor;
    await main(["magnet:?xt=urn:btih:abc"], { TorrentClient: FakeClient as never });

    // picked media + subtitle both prioritized
    assert.equal(tor.files[0].selectCalls, 1);
    assert.equal(tor.files[1].selectCalls, 1);
    // no player spawned by default
    assert.equal(env.spawned.length, 0);
    // URLs follow webtorrent v3 file.path routing
    const out = env.writes.join("");
    assert.ok(
      out.includes(
        "Stream URL: http://127.0.0.1:4242/webtorrent/aaaa1111bbbb2222cccc3333dddd4444eeee5555/Sintel.mp4",
      ),
    );
    assert.ok(
      out.includes(
        "Subtitle URL: http://127.0.0.1:4242/webtorrent/aaaa1111bbbb2222cccc3333dddd4444eeee5555/Sintel.en.srt",
      ),
    );
    assert.ok(out.includes("Press Ctrl+C to stop."));

    // Ctrl+C: destroy + delete temp dir + exit 0
    env.signals.SIGINT();
    await waitUntil(() => env.exits.length > 0);
    assert.equal(FakeClient.instances[0].destroyCount, 1);
    assert.equal(env.rms.length, 2); // startup sweep + cleanup
    assert.equal(env.exits[0], 0);
  });
});

describe("pure helpers", () => {
  it("humanBytes scales", () => {
    assert.equal(humanBytes(0), "0 B");
    assert.equal(humanBytes(512), "512 B");
    assert.equal(humanBytes(1024), "1.0 KB");
    assert.equal(humanBytes(2.1 * 1024 ** 3), "2.1 GB");
  });

  it("media/subtitle classification", () => {
    assert.equal(isMedia("Movie.2020.1080p.mkv"), true);
    assert.equal(isMedia("song.MP3"), true);
    assert.equal(isMedia("notes.txt"), false);
    assert.equal(isMedia("noext"), false);
    assert.equal(isSubtitle("movie.en.srt"), true);
    assert.equal(isSubtitle("subs.ass"), true);
    assert.equal(isSubtitle("movie.mkv"), false);
  });

  it("parseArgs basics", () => {
    const a = parseArgs(["magnet:?xt=urn:btih:abc"]);
    assert.equal(a.input, "magnet:?xt=urn:btih:abc");
    assert.deepEqual(a.playerArgs, []);
    assert.equal(a.keep, false);
    assert.equal(a.help, false);
  });
});
