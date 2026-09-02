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
    // model real listen(): an explicit port wins, 0 means OS-assigned
    if (typeof a[0] === "number" && a[0] > 0) this.port = a[0];
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

describe("arg and exit paths", () => {
  it("--help prints usage and exits 0", async (t) => {
    const env = testEnv(t);
    await assert.rejects(
      () => main(["--help"]),
      (e: unknown) => e instanceof CliExitError && e.code === 0,
    );
    assert.equal(env.exits[0], 0);
    assert.ok(env.writes.join("").includes("Usage: wstream"));
    assert.equal(FakeClient.instances.length, 0); // no client created
  });

  it("-h exits 0", async (t) => {
    const env = testEnv(t);
    await assert.rejects(
      () => main(["-h"]),
      (e: unknown) => e instanceof CliExitError && e.code === 0,
    );
    assert.equal(env.exits[0], 0);
  });

  it("no input exits 1", async (t) => {
    const env = testEnv(t);
    await assert.rejects(
      () => main([]),
      (e: unknown) => e instanceof CliExitError && e.code === 1,
    );
    assert.equal(env.exits[0], 1);
    assert.equal(FakeClient.instances.length, 0);
  });

  it("--dir and --port are honored", async (t) => {
    const env = testEnv(t);
    FakeClient.makeTorrent = () => singleTorrent();
    await main(["x.torrent", "--dir", "C:\\tmp\\ws-test", "--port", "8888"], {
      TorrentClient: FakeClient as never,
    });
    assert.equal(env.rms[0], "C:\\tmp\\ws-test"); // sweep targeted the override
    assert.deepEqual(FakeClient.instances[0].added?.opts, {
      path: "C:\\tmp\\ws-test",
    });
    assert.ok(
      env.writes.join("").includes("http://127.0.0.1:8888/webtorrent/"),
    );
    env.signals.SIGINT();
    await waitUntil(() => env.exits.length > 0);
  });
});

describe("file selection", () => {
  const multiTorrent = () => {
    const tor = new FakeTorrent();
    tor.files = [
      makeFile("Sintel.en.srt", "subs/Sintel.en.srt", 300),
      makeFile("Movie 1080p.mkv", "Movie 1080p.mkv", 2_255_458_304), // 2.1 GB
      makeFile("sample.mp4", "sample.mp4", 34_000_000),
      makeFile("notes.txt", "notes.txt", 10),
    ];
    return tor;
  };
  const pickViaPrompt = (t: TestContext, answer: string) => {
    const env = testEnv(t);
    return {
      env,
      deps: {
        TorrentClient: FakeClient as never,
        createInterfaceFn: (() => ({
          question: async () => answer,
          close() {},
        })) as never,
      },
    };
  };

  it("multi-file: picker lists media files with sizes, pick 2", async (t) => {
    const tor = multiTorrent();
    FakeClient.makeTorrent = () => tor;
    const { env, deps } = pickViaPrompt(t, "2");
    await main(["magnet:?x"], deps);
    const out = env.writes.join("");
    assert.ok(out.includes("1. Movie 1080p.mkv  (2.1 GB)"));
    assert.ok(out.includes("2. sample.mp4  (32.4 MB)"));
    assert.ok(!out.includes("Sintel.en.srt  (")); // subtitles are not listed
    // picked file selected, others deselected; srt is not media so untouched by media loop
    assert.equal(tor.files[2].selectCalls, 1); // sample.mp4 = media #2
    assert.equal(tor.files[0].selectCalls, 1); // subtitle still selected
    assert.equal(tor.files[1].deselectCalls, 1); // Movie not picked
    assert.equal(tor.files[3].selectCalls, 0); // non-media never selected at all
    // URL encodes the full file.path
    assert.ok(
      out.includes(
        "/webtorrent/aaaa1111bbbb2222cccc3333dddd4444eeee5555/sample.mp4",
      ),
    );
    env.signals.SIGINT();
    await waitUntil(() => env.exits.length > 0);
  });

  it("multi-file: non-numeric pick exits 1", async (t) => {
    FakeClient.makeTorrent = () => multiTorrent();
    const { env, deps } = pickViaPrompt(t, "abc");
    await assert.rejects(
      () => main(["magnet:?x"], deps),
      (e: unknown) => e instanceof CliExitError && e.code === 1,
    );
    assert.equal(env.exits[0], 1);
  });

  it("multi-file: out-of-range pick exits 1", async (t) => {
    FakeClient.makeTorrent = () => multiTorrent();
    const { env, deps } = pickViaPrompt(t, "99");
    await assert.rejects(
      () => main(["magnet:?x"], deps),
      (e: unknown) => e instanceof CliExitError && e.code === 1,
    );
    assert.equal(env.exits[0], 1);
  });

  it("--file skips the prompt and picks by media index", async (t) => {
    const env = testEnv(t);
    const tor = multiTorrent();
    FakeClient.makeTorrent = () => tor;
    // only 2 media files exist (srt/txt are not media) — sample.mp4 is #2
    await main(["magnet:?x", "--file", "2"], {
      TorrentClient: FakeClient as never,
    });
    assert.equal(tor.files[2].selectCalls, 1); // sample.mp4
    assert.ok(env.writes.join("").includes("sample.mp4"));
    env.signals.SIGINT();
    await waitUntil(() => env.exits.length > 0);
  });

  it("--file out of range exits 1", async (t) => {
    const env = testEnv(t);
    FakeClient.makeTorrent = () => multiTorrent();
    await assert.rejects(
      () => main(["magnet:?x", "--file", "9"], { TorrentClient: FakeClient as never }),
      (e: unknown) => e instanceof CliExitError && e.code === 1,
    );
    assert.equal(env.exits[0], 1);
  });

  it("--file 1 works on a single-file torrent", async (t) => {
    const env = testEnv(t);
    const tor = singleTorrent();
    FakeClient.makeTorrent = () => tor;
    await main(["magnet:?x", "--file", "1"], {
      TorrentClient: FakeClient as never,
    });
    assert.equal(tor.files[0].selectCalls, 1);
    env.signals.SIGINT();
    await waitUntil(() => env.exits.length > 0);
  });
});

describe("error paths", () => {
  it("torrent with no media files exits 1", async (t) => {
    const env = testEnv(t);
    const tor = new FakeTorrent();
    tor.files = [makeFile("readme.txt")];
    FakeClient.makeTorrent = () => tor;
    await assert.rejects(
      () => main(["magnet:?x"], { TorrentClient: FakeClient as never }),
      (e: unknown) => e instanceof CliExitError && e.code === 1,
    );
    assert.equal(env.exits[0], 1);
  });

  it("metadata error propagates", async (t) => {
    testEnv(t);
    FakeClient.makeTorrent = () => {
      const tor = new FakeTorrent();
      tor.ready = false;
      queueMicrotask(() => tor.emit("error", new Error("bad metadata")));
      return tor;
    };
    await assert.rejects(
      () => main(["magnet:?x"], { TorrentClient: FakeClient as never }),
      /bad metadata/,
    );
  });

  it("client error propagates when metadata is pending", async (t) => {
    testEnv(t);
    FakeClient.makeTorrent = () => {
      const tor = new FakeTorrent();
      tor.ready = false;
      return tor;
    };
    await assert.rejects(
      () =>
        main(["magnet:?x"], {
          TorrentClient: class extends FakeClient {
            constructor() {
              super();
              queueMicrotask(() => this.emit("error", new Error("client boom")));
            }
          } as never,
        }),
      /client boom/,
    );
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
