import { createServer } from "node:http";
import { config } from "./config.mjs";
import { getItem, listItems } from "./items.mjs";

// Routes: GET /items, GET /items/:id.
export function handle(req, res) {
  const m = new URL(req.url, "http://x").pathname.match(/^\/items(?:\/(\d+))?$/);
  if (req.method !== "GET" || !m) return send(res, 404, { error: "not found" });
  const body = m[1] ? getItem(Number(m[1])) : listItems();
  return body ? send(res, 200, body) : send(res, 404, { error: "not found" });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

if (process.argv[1]?.endsWith("server.mjs")) createServer(handle).listen(config.port);
