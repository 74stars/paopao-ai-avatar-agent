import { readFile, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const [leftPath, rightPath, outputPath] = process.argv.slice(2);
if (!leftPath || !rightPath || !outputPath) {
  throw new Error("Usage: node create-image-comparison.mjs <left.png> <right.png> <output.png>");
}

const [left, right] = await Promise.all([leftPath, rightPath].map(readPng));
if (left.height !== right.height) {
  throw new Error(`Image heights differ: ${left.height} vs ${right.height}`);
}

const output = new PNG({ width: left.width + right.width, height: left.height, colorType: 6 });
copyImage(left, output, 0);
copyImage(right, output, left.width);
await writeFile(outputPath, PNG.sync.write(output));

async function readPng(path) {
  return PNG.sync.read(await readFile(path));
}

function copyImage(source, target, offsetX) {
  for (let y = 0; y < source.height; y += 1) {
    const sourceStart = y * source.width * 4;
    const targetStart = (y * target.width + offsetX) * 4;
    source.data.copy(target.data, targetStart, sourceStart, sourceStart + source.width * 4);
  }
}
