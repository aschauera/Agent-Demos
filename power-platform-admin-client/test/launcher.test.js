import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const launcher = fileURLToPath(new URL("../start-client.ps1", import.meta.url));

test("launcher returns with a healthy independent server and rejects an occupied port", {
  skip: process.platform !== "win32",
  timeout: 30000
}, async (t) => {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));

  const args = ["-NoProfile", "-File", launcher, "-Port", String(port)];
  const { stdout } = await execute(process.env.ComSpec, [
    "/d", "/s", "/c", `npm start -- -Port ${port}`
  ], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    timeout: 15000
  });
  const pidMatch = stdout.match(/PID: (\d+)/);
  assert.ok(pidMatch, stdout);
  const pid = Number(pidMatch[1]);
  t.after(() => process.kill(pid));

  assert.match(stdout, /Startup complete/);
  assert.match(stdout, new RegExp(`Stop-Process -Id ${pid}`));
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { service: "power-platform-admin-client" });

  await assert.rejects(execute("powershell", args, { timeout: 5000 }), (error) => {
    assert.match(error.stderr, /already in use/);
    return true;
  });
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
});
