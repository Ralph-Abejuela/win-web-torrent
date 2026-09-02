# pnpm + Node native TypeScript (no Bun)

Bun was tried first (ADR-0004) and abandoned: Bun blocks webtorrent's native postinstall scripts by default, and a transitive dependency (`ip-set`) enforces pnpm via a `preinstall: npx only-allow pnpm` script. We now use pnpm for installs, Node's built-in TypeScript type-stripping (Node 22.6+) for dev (`node src/cli.ts`, `node --test`), and esbuild to bundle `dist/cli.js` for the published package (keeps the Node 18 engines requirement honest). Users install with `npm i -g win-web-torrent` as planned.
