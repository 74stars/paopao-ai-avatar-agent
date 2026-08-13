import { readFile, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const [basePath, editPath, maskPath, outputPath, featherArg = "20"] = process.argv.slice(2);
if (!basePath || !editPath || !maskPath || !outputPath) {
  throw new Error("Usage: node composite-image-edit.mjs <base.png> <edit.png> <mask.png> <output.png> [feather-px]");
}

const feather = Number(featherArg);
if (!Number.isFinite(feather) || feather < 0) throw new Error(`Invalid feather radius: ${featherArg}`);

const [base, edit, mask] = await Promise.all([basePath, editPath, maskPath].map(readPng));
assertSameSize(base, edit, "base", "edit");
assertSameSize(base, mask, "base", "mask");

const pixelCount = base.width * base.height;
const distance = new Float32Array(pixelCount);
const infinity = base.width + base.height;

for (let index = 0; index < pixelCount; index += 1) {
  distance[index] = mask.data[index * 4 + 3] === 0 ? infinity : 0;
}

distancePass(distance, base.width, base.height, true);
distancePass(distance, base.width, base.height, false);

const output = new PNG({ width: base.width, height: base.height, colorType: 6 });
for (let index = 0; index < pixelCount; index += 1) {
  const offset = index * 4;
  const editable = mask.data[offset + 3] === 0;
  const weight = editable ? (feather === 0 ? 1 : Math.min(1, distance[index] / feather)) : 0;
  for (let channel = 0; channel < 4; channel += 1) {
    output.data[offset + channel] = Math.round(base.data[offset + channel] * (1 - weight) + edit.data[offset + channel] * weight);
  }
}

await writeFile(outputPath, PNG.sync.write(output));

async function readPng(path) {
  return PNG.sync.read(await readFile(path));
}

function assertSameSize(left, right, leftName, rightName) {
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(`${leftName} and ${rightName} dimensions differ: ${left.width}x${left.height} vs ${right.width}x${right.height}`);
  }
}

function distancePass(values, width, height, forward) {
  const yStart = forward ? 0 : height - 1;
  const yEnd = forward ? height : -1;
  const yStep = forward ? 1 : -1;
  const xStart = forward ? 0 : width - 1;
  const xEnd = forward ? width : -1;
  const xStep = forward ? 1 : -1;

  for (let y = yStart; y !== yEnd; y += yStep) {
    for (let x = xStart; x !== xEnd; x += xStep) {
      const index = y * width + x;
      if (values[index] === 0) continue;
      let nearest = values[index];
      if (x - xStep >= 0 && x - xStep < width) nearest = Math.min(nearest, values[index - xStep] + 1);
      if (y - yStep >= 0 && y - yStep < height) nearest = Math.min(nearest, values[index - yStep * width] + 1);
      if (x - xStep >= 0 && x - xStep < width && y - yStep >= 0 && y - yStep < height) {
        nearest = Math.min(nearest, values[index - yStep * width - xStep] + Math.SQRT2);
      }
      values[index] = nearest;
    }
  }
}
