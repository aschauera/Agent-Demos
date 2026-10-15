import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number.parseInt(process.env.PORT ?? "8080", 10);
let bootstrapToken = process.env.REPORTING_ACCESS_TOKEN;
let bootstrapNonce = process.env.REPORTING_BOOTSTRAP_NONCE;
delete process.env.REPORTING_ACCESS_TOKEN;
delete process.env.REPORTING_BOOTSTRAP_NONCE;
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8"
};

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");

    if (requestUrl.pathname === "/health") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Reporting-Client": "pp-reporting-api-demo"
      }).end('{"service":"pp-reporting-api-demo"}');
      return;
    }

    if (requestUrl.pathname === "/session-token") {
      if (request.method !== "POST") {
        response.writeHead(405, { Allow: "POST" }).end();
        return;
      }

      const suppliedNonce = request.headers["x-bootstrap-nonce"];
      if (!bootstrapToken || !bootstrapNonce) {
        response.writeHead(204, { "Cache-Control": "no-store" }).end();
        return;
      }
      if (suppliedNonce !== bootstrapNonce) {
        response.writeHead(403, { "Cache-Control": "no-store" }).end("Forbidden");
        return;
      }

      const responseBody = JSON.stringify({ accessToken: bootstrapToken });
      bootstrapToken = undefined;
      bootstrapNonce = undefined;
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      }).end(responseBody);
      return;
    }

    const requestedPath = requestUrl.pathname === "/"
      ? "index.html"
      : decodeURIComponent(requestUrl.pathname).replace(/^[/\\]+/, "");
    const filePath = normalize(join(root, requestedPath));
    const pathFromRoot = relative(root, filePath);

    if (pathFromRoot.startsWith("..") || pathFromRoot.includes(":")) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    const status = error?.code === "ENOENT" ? 404 : 500;
    response.writeHead(status).end(status === 404 ? "Not found" : "Server error");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Reporting client: http://localhost:${port}`);
});
