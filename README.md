# filler-cut

A Chrome extension that removes filler and marks key sentences in the author's own words. Click an inline ··· to expand a removed stretch, or hold Shift to see the original.

Private. Built clean-room: no code from Osso (GPL-3.0) or any other GPL project.

## Development

Run `bun install`, then `bun run check` for type checking and unit tests.
Run `bun run build` to generate the unpacked MV3 extension in `dist/extension`.
Set `BRIDGE_URL` at build time to override `http://127.0.0.1:18931`.

Run `bun run bridge` to start the bridge on `127.0.0.1`. Use `PORT` to
override port `18931`, `FILLER_CUT_DATA` to override
`~/.pi/agent/filler-cut/data`, and `FILLER_CUT_RULES` to override the
reader-rules file at `~/.pi/agent/filler-cut/engine/reader-rules.txt`.
The bridge reads the rules at startup and writes `requests.jsonl`,
`events.jsonl`, and the selection cache under the data directory.
