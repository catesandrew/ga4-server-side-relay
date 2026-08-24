import http, { type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

export interface CapturedMpRequest {
  url: string;
  query: URLSearchParams;
  body: unknown;
  headers: IncomingMessage["headers"];
}

export interface MockMpServer {
  url: string;
  requests: CapturedMpRequest[];
  debugRequests: CapturedMpRequest[];
  close: () => Promise<void>;
}

/**
 * Starts a local HTTP server that mimics GA4 Measurement Protocol's
 * /mp/collect (always 204, no processing feedback — matches real MP)
 * and /debug/mp/collect (echoes a validationMessages array) endpoints,
 * so tests never depend on network access to Google's real servers.
 */
export async function startMockMpServer(options?: {
  validationMessages?: unknown[];
}): Promise<MockMpServer> {
  const requests: CapturedMpRequest[] = [];
  const debugRequests: CapturedMpRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = undefined;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      const reqUrl = new URL(req.url ?? "/", "http://localhost");
      const captured: CapturedMpRequest = {
        url: reqUrl.pathname,
        query: reqUrl.searchParams,
        body,
        headers: req.headers,
      };

      if (reqUrl.pathname === "/debug/mp/collect") {
        debugRequests.push(captured);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ validationMessages: options?.validationMessages ?? [] }),
        );
        return;
      }

      // Real MP: 204 regardless of payload validity — no error surfaced.
      requests.push(captured);
      res.writeHead(204);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    debugRequests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
