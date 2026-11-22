const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, ".test-data", "settings-api-" + Date.now());
const token = "settings-test-token-" + Date.now();

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: route,
      method,
      headers: {
        "X-MN-API-Token": token,
        ...(payload ? { "Content-Type": "application/json", "Content-Length": String(payload.length) } : {}),
      },
      timeout: 3000,
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => text += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on("timeout", () => req.destroy(new Error("Settings API timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer(port, child) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error("Settings test server exited early");
    try {
      const result = await request(port, "GET", "/api/settings");
      if (result.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Settings test server did not start");
}

async function run() {
  fs.mkdirSync(dataDir, { recursive: true });
  const port = await freePort();
  const child = spawn(process.execPath, [
    path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(root, "server.ts"),
  ], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      MN_DATA_DIR: dataDir,
      MN_API_TOKEN: token,
      MN_TEST_SKIP_ENGINE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => output += chunk.toString());
  child.stderr.on("data", (chunk) => output += chunk.toString());

  try {
    await waitForServer(port, child);
    const initial = await request(port, "GET", "/api/settings");
    assert.equal(initial.status, 200);

    const pathSave = await request(port, "POST", "/api/settings", { download_path: dataDir });
    assert.equal(pathSave.status, 200, "download location should accept an existing absolute folder");
    const systemHealth = await request(port, "GET", "/api/system/health");
    assert.equal(systemHealth.status, 200, "system health should be available to the authenticated app");
    assert.ok(systemHealth.body.downloadDisk?.totalBytes > 0, "disk total must come from the selected download volume");
    assert.ok(systemHealth.body.downloadDisk?.freeBytes > 0, "disk free space must be a real available byte count");
    assert.equal(
      systemHealth.body.downloadDisk.usedBytes,
      systemHealth.body.downloadDisk.totalBytes - systemHealth.body.downloadDisk.freeBytes,
      "disk used bytes must be calculated from the same volume sample"
    );

    const themeSave = await request(port, "POST", "/api/settings", { appearance: "dark" });
    assert.equal(themeSave.status, 200);
    const themeRead = await request(port, "GET", "/api/settings");
    assert.equal(themeRead.body.appearance, "dark", "appearance must persist in local settings database");

    const lightSave = await request(port, "POST", "/api/settings", { appearance: "light" });
    assert.equal(lightSave.status, 200);
    assert.equal((await request(port, "GET", "/api/settings")).body.appearance, "light");

    const speedSave = await request(port, "POST", "/api/settings", { speed_limit: "5242880" });
    assert.equal(speedSave.status, 200);
    const combined = await request(port, "GET", "/api/settings");
    assert.equal(combined.body.speed_limit, "5242880", "speed settings must persist");
    assert.equal(combined.body.appearance, "light", "partial updates must preserve unrelated settings");

    const analyticsSettings = await request(port, "GET", "/api/settings");
    assert.equal(analyticsSettings.body.analytics_enabled, undefined, "analytics is not a user-editable setting");
    const legacyAnalyticsToggle = await request(port, "POST", "/api/settings", { analytics_enabled: "0" });
    assert.equal(legacyAnalyticsToggle.status, 400, "the retired analytics toggle must be rejected");

    const invalidAppearance = await request(port, "POST", "/api/settings", { appearance: "blue" });
    assert.equal(invalidAppearance.status, 400, "unknown theme values must be rejected");

    const invalidPath = await request(port, "POST", "/api/settings", { download_path: "relative-folder" });
    assert.equal(invalidPath.status, 400, "download path must be absolute");

    console.log("Settings API tests passed: real download-volume stats, appearance persistence, partial updates, speed limits and validation.");
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    if (child.exitCode !== 0 && child.exitCode !== null) console.log(output.slice(-3000));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});