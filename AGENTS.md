# Unpad

- Clean room: never open, fetch, or copy code from Osso (github.com/Fars29/osso). Use no code from other GPL or AGPL projects or the OpenAI Sign in with ChatGPT devkit. Use public protocol documentation and write the implementation here.
- Use isolated Chrome profiles under `/tmp` for extension tests. Keep personal Chrome profiles out of test runs.
- Run `bun install`, `bun run build`, and `bun run check` from the repo root. Load `dist/extension` as an unpacked extension. A plain build opens setup. Set `BRIDGE_URL` to an origin at build time to preset a connection.
- The live specification and commands are in [tests/live/README.md](tests/live/README.md).
