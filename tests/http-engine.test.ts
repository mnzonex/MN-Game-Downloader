import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import crypto from "node:crypto";

async function waitFor(check: () => boolean, label: string, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for " + label);
}

async function main() {
  const dataDir = path.resolve(".test-data", "http-engine");
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.MN_DATA_DIR = dataDir;

  const payload = Buffer.from("MN-ZONEX-HTTP-ENGINE-TEST-CONTENT-0123456789");
  const requests: Record<string, number> = {};
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    requests[pathname] = (requests[pathname] || 0) + 1;
    if (pathname === "/missing.bin") { res.writeHead(404); res.end("not found"); return; }
    if (pathname === "/slow-delete.bin") {
      res.writeHead(200, {
        "Content-Length": payload.length * 100,
        "Accept-Ranges": "bytes",
        "Content-Type": "application/octet-stream",
      });
      res.write(payload);
      const hold = setTimeout(() => res.end(Buffer.alloc(payload.length * 99)), 30000);
      res.on("close", () => clearTimeout(hold));
      return;
    }
    if (pathname !== "/collision.bin" && pathname !== "/restore.bin") { res.writeHead(404); res.end(); return; }
    const range = req.headers.range;
    if (range) {
      const match = range.match(/^bytes=([0-9]+)-$/);
      if (!match) { res.writeHead(416); res.end(); return; }
      const start = Number(match[1]);
      if (start >= payload.length) { res.writeHead(416, { "Content-Range": "bytes */" + payload.length }); res.end(); return; }
      res.writeHead(206, {
        "Content-Range": "bytes " + start + "-" + (payload.length - 1) + "/" + payload.length,
        "Accept-Ranges": "bytes",
        "Content-Length": payload.length - start,
        "Content-Type": "application/octet-stream",
      });
      res.end(payload.subarray(start));
      return;
    }
    res.writeHead(200, { "Content-Length": payload.length, "Accept-Ranges": "bytes", "Content-Type": "application/octet-stream" });
    res.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  const base = "http://127.0.0.1:" + address.port;

  try {
    const { dbSetSetting, dbInsertTorrent, dbGetTorrent } = await import("../src/engine/db");
    const { httpEngine } = await import("../src/engine/HttpEngine");
    const { historyList } = await import("../src/engine/Library");
    const dest = path.join(dataDir, "downloads");
    const tempDir = path.join(dest, ".mn-temp");
    fs.mkdirSync(tempDir, { recursive: true });
    dbSetSetting("download_path", dest);

    const original = path.join(dest, "collision.bin");
    fs.writeFileSync(original, "KEEP-ORIGINAL-FILE");
    const first = await httpEngine.add(base + "/collision.bin", "collision.bin");
    await waitFor(() => dbGetTorrent(first.id)?.status === "completed", "HTTP completion with a colliding filename");
    const collisionCopy = path.join(dest, "collision (1).bin");
    if (fs.readFileSync(original, "utf8") !== "KEEP-ORIGINAL-FILE") throw new Error("Existing destination was overwritten");
    if (!fs.readFileSync(collisionCopy).equals(payload)) throw new Error("Downloaded file content mismatch");
    const history = historyList();
    if (!history.some((item: any) => item.id === first.id)) throw new Error("HTTP completion was not written to history");
    if (dbGetTorrent(first.id)?.name !== "collision (1).bin") throw new Error("Collision-safe filename was not stored in the DB");

    const missing = await httpEngine.add(base + "/missing.bin", "missing.bin");
    await waitFor(() => dbGetTorrent(missing.id)?.status === "error", "permanent HTTP 404 handling");
    if (requests["/missing.bin"] !== 1) throw new Error("HTTP 404 was retried instead of being marked permanent");

    const restoreUrl = base + "/restore.bin";
    const restoreId = crypto.createHash("md5").update(restoreUrl).digest("hex") + "00000000";
    const partialFile = path.join(tempDir, restoreId + ".part");
    fs.writeFileSync(partialFile, payload.subarray(0, 9));
    dbInsertTorrent({
      id: restoreId, name: "resume.bin", magnet: restoreUrl, save_path: tempDir, dest_path: dest,
      status: "downloading", error_msg: null, progress: 0.2, size: payload.length,
      speed_dl: 0, speed_ul: 0, peers: 0, seeds: 0, eta_secs: -1,
    });
    const restored = httpEngine.restoreInterruptedDownloads();
    if (restored < 1) throw new Error("Interrupted HTTP download was not restored");
    await waitFor(() => dbGetTorrent(restoreId)?.status === "completed", "startup HTTP range resume");
    if (!fs.readFileSync(path.join(dest, "resume.bin")).equals(payload)) throw new Error("Resumed file content mismatch");
    if (requests["/restore.bin"] !== 1) throw new Error("Restore should request one range continuation");

    // Deleting a new active download must remove its temporary .part file but
    // preserve a previously completed file with the same final destination name.
    const protectedFinal = path.join(dest, "previous-copy.bin");
    fs.writeFileSync(protectedFinal, "PREVIOUS-COMPLETED-COPY");
    const activeDelete = await httpEngine.add(base + "/slow-delete.bin", "previous-copy.bin");
    const activePart = path.join(tempDir, activeDelete.id + ".part");
    await waitFor(() => fs.existsSync(activePart) && fs.statSync(activePart).size > 0, "active HTTP partial file");
    await httpEngine.remove(activeDelete.id, true);
    if (dbGetTorrent(activeDelete.id)) throw new Error("Deleted active HTTP task remained in the database");
    if (fs.existsSync(activePart)) throw new Error("Deleting an active HTTP download left its .part file behind");
    if (fs.readFileSync(protectedFinal, "utf8") !== "PREVIOUS-COMPLETED-COPY") {
      throw new Error("Deleting an active HTTP download removed a previously completed file with the same name");
    }

    console.log("HTTP engine tests passed: resume restore, range validation, permanent 404, safe destination collision, download history, and active-delete preservation.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });