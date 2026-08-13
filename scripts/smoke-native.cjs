const { app } = require("electron");

app.whenReady().then(() => {
  const Database = require("better-sqlite3");
  const database = new Database(":memory:");

  try {
    const row = database.prepare("select sqlite_version() as version").get();
    if (!row?.version) throw new Error("SQLite did not return a version");
    console.log(`better-sqlite3 native smoke passed (SQLite ${row.version})`);
  } finally {
    database.close();
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
