const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const concurrentlyEntry = path.join(projectRoot, "node_modules", "concurrently", "dist", "bin", "index.js");
if (!fs.existsSync(concurrentlyEntry)) {
  console.error("[Dev] concurrently executable not found. Run npm install first.");
  process.exit(1);
}

// Both the local API server and Electron main process inherit the same per-run
// secret, so development mode exercises the same API authentication as packaged mode.
const dataDir = process.env.MN_DATA_DIR || path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "mn-game-downloader"
);
fs.mkdirSync(dataDir, { recursive: true });

const env = {
  ...process.env,
  MN_API_TOKEN: crypto.randomBytes(32).toString("hex"),
  MN_DATA_DIR: dataDir,
  PORT: "3000",
};

const child = spawn(process.execPath, [
  concurrentlyEntry,
  "--kill-others-on-fail",
  "-n", "DEV,APP",
  "npm run dev",
  "wait-on tcp:3000 && electron main.cjs",
], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("error", (error) => {
  console.error("[Dev] Failed to launch development services:", error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});