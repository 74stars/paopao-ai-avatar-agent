import { readFile, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const [regionsPath, regionId, outputPath] = process.argv.slice(2);
if (!regionsPath || !regionId || !outputPath) {
  throw new Error("Usage: node create-image-edit-mask.mjs <regions.json> <region-id> <output.png>");
}

const definition = JSON.parse(await readFile(regionsPath, "utf8"));
const region = definition.regions?.[regionId];
if (!region || region.shape !== "polygon" || !Array.isArray(region.points) || region.points.length < 3) {
  throw new Error(`Invalid polygon region: ${regionId}`);
}

const { width, height } = definition.canvas;
const png = new PNG({ width, height, colorType: 6 });

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    png.data[offset] = 255;
    png.data[offset + 1] = 255;
    png.data[offset + 2] = 255;
    png.data[offset + 3] = insidePolygon(x + 0.5, y + 0.5, region.points) ? 0 : 255;
  }
}

await writeFile(outputPath, PNG.sync.write(png));

function insidePolygon(x, y, points) {
  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current, current += 1) {
    const [currentX, currentY] = points[current];
    const [previousX, previousY] = points[previous];
    const crosses = currentY > y !== previousY > y;
    const boundaryX = ((previousX - currentX) * (y - currentY)) / (previousY - currentY || Number.EPSILON) + currentX;
    if (crosses && x < boundaryX) inside = !inside;
  }
  return inside;
}
