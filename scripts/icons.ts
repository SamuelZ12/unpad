import { mkdir } from "node:fs/promises";
import { PNG } from "pngjs";

await mkdir(new URL("../src/icons/", import.meta.url), { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let alpha = 0;
      let dots = 0;
      for (let sy = 0; sy < 8; sy++) {
        for (let sx = 0; sx < 8; sx++) {
          const px = (x + (sx + 0.5) / 8) / size;
          const py = (y + (sy + 0.5) / 8) / size;
          const dx = Math.max(0.23 - px, px - 0.77, 0);
          const dy = Math.max(0.23 - py, py - 0.77, 0);
          if (Math.hypot(dx, dy) > 0.2) continue;
          alpha++;
          if ([0.27, 0.5, 0.73].some((cx) => Math.hypot(px - cx, py - 0.5) < 0.08)) dots++;
        }
      }
      const i = (y * size + x) * 4;
      const mix = alpha ? dots / alpha : 0;
      png.data[i] = Math.round(255 - 213 * mix);
      png.data[i + 1] = Math.round(214 - 175 * mix);
      png.data[i + 2] = Math.round(10 + 15 * mix);
      png.data[i + 3] = Math.round(255 * alpha / 64);
    }
  }
  await Bun.write(new URL(`../src/icons/icon-${size}.png`, import.meta.url), PNG.sync.write(png));
}
