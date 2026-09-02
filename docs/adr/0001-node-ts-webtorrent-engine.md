# Node/TypeScript + webtorrent library as the engine

We picked Node/TypeScript with the `webtorrent` JS library as the torrent engine instead of Rust+libtorrent or Go+anacrolix. DHT, PEX, uTP, and streaming-oriented piece selection are already solved and battle-tested in webtorrent; a native rewrite would spend months re-solving them for a CLI whose real differentiator is correct Windows behavior. Cost accepted: not a self-contained exe unless we bundle the runtime later (see ADR-0003).
