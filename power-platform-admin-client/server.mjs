import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const reportingClient = fileURLToPath(new URL("../pp-reporting-api-demo/reporting-client.mjs", import.meta.url));
const allowedFiles = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "consumption.js",
  "app-management.js",
  "app-management-api.js",
  "session-mode.js",
  "application-inventory.js",
  "module-summary.js",
  "local-settings.js",
  "agent-details.js",
  "pp-reporting-api-demo/reporting-client.mjs",
  "auth.js",
  "api-client.js",
  "api-catalog.js",
  "api-catalog.generated.js",
  "config.local.js"
]);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8"
};
const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self' https://api.powerplatform.com https://login.microsoftonline.com https://preview.api.flow.microsoft.com",
    "form-action 'self' https://login.microsoftonline.com",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'"
  ].join("; "),
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

export function createServer({ webRoot = root } = {}) {
  return createHttpServer(async (request, response) => {
    try {
      if (!["GET", "HEAD"].includes(request.method ?? "")) {
        response.writeHead(405, { ...securityHeaders, Allow: "GET, HEAD" }).end();
        return;
      }

      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      if (requestUrl.pathname === "/health") {
        response.writeHead(200, {
          ...securityHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "X-PP-Admin-Client": "local"
        }).end('{"service":"power-platform-admin-client"}');
        return;
      }

      const requestedPath = requestUrl.pathname === "/"
        ? "index.html"
        : decodeURIComponent(requestUrl.pathname).replace(/^[/\\]+/, "");
      if (!allowedFiles.has(requestedPath)) {
        response.writeHead(404, securityHeaders).end("Not found");
        return;
      }

      const isReportingClient = requestedPath === "pp-reporting-api-demo/reporting-client.mjs";
      const filePath = isReportingClient ? reportingClient : normalize(join(webRoot, requestedPath));
      const pathFromRoot = relative(webRoot, filePath);
      if (!isReportingClient && (pathFromRoot.startsWith("..") || pathFromRoot.includes(":"))) {
        response.writeHead(403, securityHeaders).end("Forbidden");
        return;
      }

      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch (error) {
        if (error?.code === "ENOENT" && requestedPath === "config.local.js") {
          response.writeHead(200, {
            ...securityHeaders,
            "Content-Type": contentTypes[".js"]
          }).end("window.PP_ADMIN_CONFIG = {};");
          return;
        }
        throw error;
      }
      if (!fileStat.isFile()) {
        response.writeHead(404, securityHeaders).end("Not found");
        return;
      }

      response.writeHead(200, {
        ...securityHeaders,
        "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream"
      });
      if (request.method === "HEAD") {
        response.end();
      } else {
        createReadStream(filePath).pipe(response);
      }
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(500, securityHeaders).end("Local client server error");
      }
      console.error("Local client server error:", error?.message ?? error);
    }
  });
}

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`The Bridge: http://localhost:${port}`);
  });
}
