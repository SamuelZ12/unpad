# filler-cut

- Clean room: never open, fetch or copy code from Osso (github.com/Fars29/osso), `/tmp/osso`, or `~/.pi/agent/filler-cut/osso-fork/`, and no code from any GPL or AGPL project. Ideas and behaviours described in the research note are fine; the product may be sold closed-source.
- Research and decisions: `~/dev/agent-memory/building/ventures/longcut-desktop-app-idea-filler-cut.md` (read only; do not commit to agent-memory from this repo's work).
- Our own throwaway prototype (written before Osso was seen, safe to reuse): `~/.pi/agent/filler-cut/prototype/`. Selector benchmark and Pi prompt: `~/.pi/agent/filler-cut/engine/`.
- Never load test extensions into Samuel's own Chrome profiles; use isolated profiles under /tmp until he approves his install.
- The live specification is in `tests/live/README.md`. Run it with `bun run verify`. Planning prototypes and their numbers: `~/.pi/agent/filler-cut/v0-plan-proto/` (our own, safe to reuse).
- A build for Samuel's Chrome needs `BRIDGE_URL=https://mac-mini.tail26e02f.ts.net:18931 bun run build`. A plain build points at `127.0.0.1:18931`, which is dead on the MacBook (the 0.3.1 copy shipped that way, Nov 24 2026). Before copying, grep the build for the tailnet host.
