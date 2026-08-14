import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const buildDirectory = join(appDirectory, "build");
const publicAssetsDirectory = join(appDirectory, "public", "assets");
const iconsetDirectory = join(buildDirectory, "icon.iconset");
const appIconSvg = join(buildDirectory, "icon.svg");
const appIconPng = join(buildDirectory, "icon.png");
const trayTemplateSvg = join(publicAssetsDirectory, "trayTemplate.svg");
const trayWindowsSvg = join(publicAssetsDirectory, "trayWindows.svg");

if (process.platform !== "darwin") {
  throw new Error("Icon generation currently requires macOS sips and iconutil. Generated assets are committed for Windows packaging.");
}

mkdirSync(buildDirectory, { recursive: true });
mkdirSync(publicAssetsDirectory, { recursive: true });
rmSync(iconsetDirectory, { recursive: true, force: true });
mkdirSync(iconsetDirectory);

rasterizeSvg(appIconSvg, appIconPng, 1024);

const iconsetEntries = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"]
];

for (const [size, filename] of iconsetEntries) resizePng(appIconPng, join(iconsetDirectory, filename), size);
execFileSync("iconutil", ["-c", "icns", iconsetDirectory, "-o", join(buildDirectory, "icon.icns")]);

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoPngs = icoSizes.map((size) => {
  const outputPath = join(buildDirectory, `.icon-${size}.png`);
  resizePng(appIconPng, outputPath, size);
  return { size, data: readFileSync(outputPath), path: outputPath };
});
writeFileSync(join(buildDirectory, "icon.ico"), createIco(icoPngs));
for (const image of icoPngs) rmSync(image.path, { force: true });

copyFileSync(appIconPng, join(publicAssetsDirectory, "app-icon.png"));
rasterizeSvg(trayTemplateSvg, join(publicAssetsDirectory, "trayTemplate.png"), 16);
rasterizeSvg(trayTemplateSvg, join(publicAssetsDirectory, "trayTemplate@2x.png"), 32);

const trayIcoPngs = [16, 24, 32, 48, 64].map((size) => {
  const outputPath = join(buildDirectory, `.tray-${size}.png`);
  rasterizeSvg(trayWindowsSvg, outputPath, size);
  return { size, data: readFileSync(outputPath), path: outputPath };
});
writeFileSync(join(publicAssetsDirectory, "tray.ico"), createIco(trayIcoPngs));
for (const image of trayIcoPngs) rmSync(image.path, { force: true });

rmSync(iconsetDirectory, { recursive: true, force: true });
console.log("Generated app icons and tray icons.");

function rasterizeSvg(inputPath, outputPath, size) {
  execFileSync("sips", ["-s", "format", "png", "-z", String(size), String(size), inputPath, "--out", outputPath], { stdio: "ignore" });
}

function resizePng(inputPath, outputPath, size) {
  execFileSync("sips", ["-z", String(size), String(size), inputPath, "--out", outputPath], { stdio: "ignore" });
}

function createIco(images) {
  const headerSize = 6;
  const directoryEntrySize = 16;
  let dataOffset = headerSize + directoryEntrySize * images.length;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(directoryEntrySize);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(dataOffset, 12);
    dataOffset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]);
}
