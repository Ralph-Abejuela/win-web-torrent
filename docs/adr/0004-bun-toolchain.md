---
status: deprecated
superseded by ADR-0005
---

# Bun toolchain

~~Build, run, and test with Bun (`bun run`, `bun test`, `bun build`)~~. Deprecating after one session of use: Bun blocked webtorrent's native postinstalls (`node-datachannel`), and a transitive dep (`ip-set`) enforces pnpm via a preinstall script. Superseded by ADR-0005.
