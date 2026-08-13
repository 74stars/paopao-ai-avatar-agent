const { app } = require("electron");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { mkdtempSync } = require("node:fs");

app.whenReady().then(async () => {
  const { createMainComposition } = await import("../desktop-app/dist-electron/composition.js");
  const root = process.cwd();
  const tempRoot = mkdtempSync(join(tmpdir(), "paopao-composition-"));
  const databasePath = join(tempRoot, "paopao.sqlite");
  const credentialsPath = join(tempRoot, "secrets", "credentials.v1.json");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (plainText) => Buffer.from(plainText, "utf8"),
    decryptString: (encrypted) => encrypted.toString("utf8")
  };
  const options = {
    databasePath,
    migrationsDirectory: join(root, "packages/infrastructure/src/database/migrations"),
    promptsDirectory: join(root, "prompts"),
    credentialsPath,
    safeStorage,
    publish: { publish() {} }
  };
  const command = {
    version: 1,
    requestId: "20000000-0000-4000-8000-000000000001",
    source: "desktop",
    modality: "text",
    rawText: "Electron composition persistence smoke",
    mode: "remember",
    receivedAt: "2026-08-06T00:00:00.000Z",
    sourceKey: "desktop:20000000-0000-4000-8000-000000000001"
  };

  const first = await createMainComposition(options);
  const receipt = await first.services.capture.capture(command);
  const listed = await first.services.entries.list({ version: 1, limit: 10 });
  const summary = await first.services.entries.summary();
  const initialBackups = await first.services.backups.list();
  await first.close();

  const second = await createMainComposition(options);
  const reopened = await second.services.entries.list({ version: 1, limit: 10 });
  const reopenedBackups = await second.services.backups.list();
  await second.close();
  app.quit();

  if (
    receipt.status !== "stored" ||
    listed.items.length !== 1 ||
    summary.total !== 1 ||
    reopened.items.length !== 1 ||
    initialBackups.backups.length !== 1 ||
    initialBackups.backups[0]?.reason !== "startup" ||
    reopenedBackups.backups.length !== 1
  ) {
    throw new Error(`composition persistence smoke failed: ${JSON.stringify({ receipt, listed, summary, reopened, initialBackups, reopenedBackups })}`);
  }
  console.log("Electron composition persistence smoke passed");
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
