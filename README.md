# filler-cut

Working name. A Chrome extension that fades the filler on the page you are reading and keeps the key sentences in the author's own words. One key reveals the original.

Private. Built clean-room: no code from Osso (GPL-3.0) or any other GPL project.

## Development

Run `bun install`, then `bun run check` for type checking and unit tests.
Run `bun run build` to generate the unpacked MV3 extension in `dist/extension`.
Set `BRIDGE_URL` at build time to override `http://127.0.0.1:18931`.
