import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

checkPng("build/icon.png", 1024, 1024);
checkPng("public/assets/app-icon.png", 1024, 1024);
checkPng("public/assets/trayTemplate.png", 16, 16);
checkPng("public/assets/trayTemplate@2x.png", 32, 32);
checkIcns("build/icon.icns");
checkIco("build/icon.ico", [16, 24, 32, 48, 64, 128, 256]);
checkIco("public/assets/tray.ico", [16, 24, 32, 48, 64]);
checkPackagingIdentity();

console.log("Application and tray icon assets are valid.");

function readAsset(relativePath) {
  try {
    return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)));
  } catch (error) {
    throw new Error(`Missing packaging asset: ${relativePath}`, { cause: error });
  }
}

function checkPng(relativePath, expectedWidth, expectedHeight) {
  const data = readAsset(relativePath);
  const signature = data.subarray(0, 8).toString("hex");
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const colorType = data.readUInt8(25);
  if (signature !== "89504e470d0a1a0a" || width !== expectedWidth || height !== expectedHeight || colorType !== 6) {
    throw new Error(`${relativePath} must be an ${expectedWidth}x${expectedHeight} RGBA PNG.`);
  }
}

function checkIcns(relativePath) {
  const data = readAsset(relativePath);
  if (data.length < 8 || data.subarray(0, 4).toString("ascii") !== "icns") {
    throw new Error(`${relativePath} is not a valid ICNS container.`);
  }
}

function checkIco(relativePath, expectedSizes) {
  const data = readAsset(relativePath);
  if (data.length < 6 || data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) {
    throw new Error(`${relativePath} is not a valid ICO container.`);
  }
  const imageCount = data.readUInt16LE(4);
  const sizes = Array.from({ length: imageCount }, (_, index) => {
    const size = data.readUInt8(6 + index * 16);
    return size === 0 ? 256 : size;
  });
  if (imageCount !== expectedSizes.length || expectedSizes.some((size) => !sizes.includes(size))) {
    throw new Error(`${relativePath} does not contain the required sizes: ${expectedSizes.join(", ")}.`);
  }
}

function checkPackagingIdentity() {
  const packageJson = JSON.parse(readAsset("package.json").toString("utf8"));
  if (packageJson.productName !== "泡泡" || packageJson.build?.productName !== "泡泡") {
    throw new Error("Top-level and Electron Builder productName must both be 泡泡.");
  }
  if (packageJson.build?.appId !== "com.paopao.desktop") {
    throw new Error("Electron Builder appId must be com.paopao.desktop.");
  }
}
