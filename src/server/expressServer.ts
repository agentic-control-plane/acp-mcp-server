// src/server/expressServer.ts
import express from "express";
import rateLimit from "express-rate-limit";
import { toolGatewayImpl } from "../gateway/toolGateway.js";

const PORT = parseInt(process.env.PORT || "3000", 10);

const app = express();

// Body parsing
app.use(express.json({ limit: "2mb" }));
app.use(
  express.text({
    type: (req) => {
      const ct = req.headers["content-type"] || "";
      return !ct.includes("application/json");
    },
    limit: "2mb",
  })
);

// Rate limiting: 100 req/min per IP (global)
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 100,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  })
);

// Stricter rate limit on the OAuth/auth surface
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 30, // generous: legitimate clients do 1-2 exchanges per connection
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
app.use(
  ["/authorize", "/auth/code", "/token", "/oauth/token", "/register"],
  authLimiter
);

// Favicon — inline SVG so Google's favicon fetcher (used by MCP directories)
// renders the ACP logo instead of a generic globe.
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#0f0f1a"/></linearGradient></defs><rect width="300" height="300" fill="url(#bg)"/><text x="150" y="190" text-anchor="middle" font-family="'SF Pro Display','Inter','Helvetica Neue',Arial,sans-serif" font-size="120" font-weight="700" letter-spacing="-2" fill="#7c7ce0">ACP</text></svg>`;
app.get(["/favicon.svg", "/favicon.ico", "/favicon.png"], (_, res) => {
  res.set("Content-Type", "image/svg+xml");
  res.set("Cache-Control", "public, max-age=86400");
  res.status(200).send(FAVICON_SVG);
});

// Everything → tool gateway
app.all("*", (req, res) => toolGatewayImpl(req, res));

app.listen(PORT, () => {
  console.log(`ACP Governance MCP Server listening on http://0.0.0.0:${PORT}`);
  console.log(`MCP endpoint: POST /mcp`);
  console.log(`OAuth discovery: GET /.well-known/oauth-protected-resource`);
});
