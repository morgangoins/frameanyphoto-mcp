import { randomUUID } from "node:crypto";
import { series, workOnSite, works, type Work } from "./collection";
import { hiddenWorkIds, withoutHidden } from "./review";
import { normalizeWorkKey, workBySlugOrUrl, workSlug } from "./work-url";
import { buildHubs } from "./hubs";
import { GIFT_GUIDES, giftGuideWorks } from "./gift-guides";
import { workContentEntry } from "./work-content";
import { POLICIES_API_PATH, POLICIES_PATH, policySummary, storePolicies } from "./store-policies";
import { SUPPORT_EMAIL } from "./site-policy";
import { STORE_PAGES } from "./store-pages";
import { FEED_FILES, FEEDS_DIR } from "./feed-paths";
import { recordAgentCall, type AgentSurface } from "./agent-metrics";

import { AGENT_NAME, AGENT_ORIGIN, AGENT_SUMMARY } from "./agent-brand";
import { WEB_BOT_AUTH_PATH, webBotAuthDirectory } from "./web-bot-auth";

export { AGENT_NAME, AGENT_ORIGIN, AGENT_SUMMARY };
export const AGENT_VERSION = "1.1.0";
export const MCP_PATH = "/mcp";
export const A2A_PATH = "/a2a";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, MCP-Protocol-Version, Authorization",
};

type AgentContext = { ip: string; surface?: AgentSurface };

function isLoopback(ip: string) {
  return ip === "127.0.0.1" || ip === "::1" || ip.startsWith("::ffff:127.");
}

/** Cloudflare's client IP through the tunnel; the socket address when someone hits the origin directly. */
export function agentClientIp(request: Request) {
  const real = request.headers.get("x-real-ip")?.trim() || "";
  if (real && !isLoopback(real)) return real;
  return request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || real
    || "unknown";
}

function commerce() {
  return import("./agent-commerce");
}

type Json = Record<string, unknown>;

function abs(value: string) {
  return new URL(value, AGENT_ORIGIN).toString();
}

function compactWork(work: Work) {
  return {
    id: work.id,
    ascii_id: workSlug(work),
    title: work.title,
    artist: work.artist,
    year: work.year,
    series: work.series,
    ppi: work.ppi,
    pixels: work.pixels,
    dimensions: work.dimensions,
    image: abs(work.image),
    recordUrl: work.recordUrl,
    repositoryName: work.repositoryName,
  };
}

function haystack(work: Work) {
  return [work.id, workSlug(work), work.title, work.artist, work.year, work.series, work.accessionNumber, work.nasaId, work.tone, work.medium, work.repositoryName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function liveWorks() {
  return withoutHidden(works, hiddenWorkIds()).filter((work) => workOnSite(work));
}

export function searchWorks(query: string, limit = 12) {
  const catalog = liveWorks();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const cap = Math.min(Math.max(limit, 1), 25);
  if (!terms.length) return catalog.slice(0, cap).map(compactWork);
  return catalog
    .filter((work) => terms.every((term) => haystack(work).includes(term)))
    .sort((left, right) => right.ppi - left.ppi)
    .slice(0, cap)
    .map(compactWork);
}

export function findWork(query: string) {
  const needle = normalizeWorkKey(query);
  if (!needle) return null;
  const live = liveWorks();
  const bySlug = workBySlugOrUrl(needle);
  const match = live.find((work) =>
    [work.id, work.accessionNumber, work.nasaId, work.title].some((value) => value && normalizeWorkKey(value) === needle)
  ) ?? (bySlug ? live.find((work) => work.id === bySlug.id) : undefined);
  return match ? compactWork(match) : searchWorks(query, 1)[0] || null;
}

export function listSeries() {
  const hidden = hiddenWorkIds();
  return series.flatMap((row) => {
    const count = row.works.filter((work) => workOnSite(work) && !hidden.has(work.id)).length;
    if (!count) return [];
    return [{
      id: row.id,
      title: row.italic ? `${row.title} ${row.italic}` : row.title,
      count,
    }];
  });
}

export function mcpServerCard() {
  const endpoint = `${AGENT_ORIGIN}${MCP_PATH}`;
  return {
    serverInfo: { name: "frameanyphoto", title: AGENT_NAME, version: AGENT_VERSION },
    description: AGENT_SUMMARY,
    url: endpoint,
    endpoint,
    transport: { type: "streamable-http", endpoint },
    capabilities: { tools: true, resources: false, prompts: false },
    authentication: { required: false, schemes: [] },
    tools: mcpTools.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description })),
  };
}

export function a2aAgentCard() {
  const url = `${AGENT_ORIGIN}${A2A_PATH}`;
  return {
    name: AGENT_NAME,
    version: AGENT_VERSION,
    description: AGENT_SUMMARY,
    provider: { organization: AGENT_NAME, url: AGENT_ORIGIN },
    documentationUrl: `${AGENT_ORIGIN}/llms.txt`,
    url,
    protocolVersion: "0.3.0",
    // A2A 1.x clients read supportedInterfaces[].protocolBinding; 0.3 clients read preferredTransport/additionalInterfaces.
    supportedInterfaces: [{ url, protocolBinding: "JSONRPC", protocolVersion: "0.3.0" }],
    preferredTransport: "JSONRPC",
    additionalInterfaces: [{ url, transport: "JSONRPC" }],
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text", "application/json"],
    defaultOutputModes: ["text", "application/json"],
    skills: [
      { id: "search-works", name: "Search works", description: "Find works by title, artist, series, or keywords. Send text.", tags: ["collection", "search"] },
      { id: "get-work", name: "Get work", description: "One work’s id, size in pixels, PPI, image URL, and museum record.", tags: ["collection"] },
      { id: "list-series", name: "List series", description: "Collection rows and work counts.", tags: ["collection"] },
      { id: "get-print-options", name: "Print options", description: "Sizes, frames, and prices offered for one work.", tags: ["order", "price"] },
      { id: "quote-order", name: "Quote order", description: "Total for a work, size, frame, and quantity, with shipping. Tax is added at checkout.", tags: ["order", "price"] },
      { id: "create-checkout", name: "Create checkout", description: "Stripe Checkout link for the buyer to pay. Never charges a card.", tags: ["order", "checkout"] },
      { id: "get-order-status", name: "Order status", description: "Payment and shipping status for an order_ref from create-checkout. No personal data.", tags: ["order"] },
      { id: "get-policies", name: "Store policies", description: `Shipping, returns, payment, tax, and contact (${SUPPORT_EMAIL}) as JSON. Also at ${AGENT_ORIGIN}${POLICIES_PATH}.`, tags: ["order", "policy"] },
    ],
    examples: [
      "Ships to the US. For order skills send a data part: {\"skill\": \"quote-order\", \"arguments\": {\"work\": \"<id>\", \"size\": \"Large\"}}",
      `Store policies: {"skill": "get-policies"} or ${AGENT_ORIGIN}${POLICIES_PATH}`,
    ],
  };
}

export function oauthProtectedResource() {
  return {
    resource: `${AGENT_ORIGIN}/`,
    authorization_servers: [AGENT_ORIGIN],
    scopes_supported: ["collection.read", "checkout.create"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${AGENT_ORIGIN}/auth.md`,
  };
}

export function oauthAuthorizationServer() {
  return {
    issuer: AGENT_ORIGIN,
    authorization_endpoint: `${AGENT_ORIGIN}/api/agent/register`,
    token_endpoint: `${AGENT_ORIGIN}/api/agent/claim`,
    registration_endpoint: `${AGENT_ORIGIN}/api/agent/register`,
    grant_types_supported: ["none"],
    response_types_supported: ["none"],
    scopes_supported: ["collection.read", "checkout.create"],
    token_endpoint_auth_methods_supported: ["none"],
    agent_auth: {
      skill: `${AGENT_ORIGIN}/auth.md`,
      register_uri: `${AGENT_ORIGIN}/api/agent/register`,
      identity_types_supported: ["anonymous"],
      anonymous: {
        credential_types_supported: ["none"],
        claim_uri: `${AGENT_ORIGIN}/api/agent/claim`,
      },
    },
  };
}

export function openidConfiguration() {
  return {
    ...oauthAuthorizationServer(),
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["none"],
  };
}

export function authMarkdown() {
  return `# auth.md

${AGENT_NAME} is public. Agents need no account or credential to search, price, or create a checkout link.

## Registration

- Method: anonymous
- Register: \`${AGENT_ORIGIN}/api/agent/register\`
- Claim: \`${AGENT_ORIGIN}/api/agent/claim\`
- Credential: none. Send no \`Authorization\` header.

\`POST\` either URL to receive \`{ "ok": true, "identity_type": "anonymous", "scope": "collection.read checkout.create" }\`. That is a confirmation, not a login.

## Use

- MCP: \`${AGENT_ORIGIN}/mcp\`
- A2A: \`${AGENT_ORIGIN}/a2a\`
- REST: \`${AGENT_ORIGIN}/openapi.json\`
- Catalog JSON: \`${AGENT_ORIGIN}/api/catalog\` (read-only, no auth)

## Payment

\`create_checkout\` returns a Stripe Checkout URL. The buyer opens it, enters the shipping address, and pays. Agents never send or see card data. Checkout creation is rate-limited per IP.

Human Google login at \`/api/auth/google\` is for people saving prints. Do not use it as agent registration.
`;
}

export function anonymousGrant() {
  return {
    ok: true,
    identity_type: "anonymous",
    token_type: "none",
    scope: "collection.read checkout.create",
    resource: `${AGENT_ORIGIN}/`,
  };
}

const workArg = { type: "string", maxLength: 200, description: "Prefer ascii_id (the slug) from search_works or get_work; the id with or without its en dash, a /w/ URL, exact title, accession, or NASA ID also work" };
const sizeArg = { type: "string", maxLength: 40, description: "size_id from get_print_options, or Small, Medium, Large. Default: the site default (Large when the scan allows)" };
const frameArg = { type: "string", maxLength: 120, description: "frame_id from get_print_options. Default: the work's default frame" };
const quantityArg = { type: "integer", minimum: 1, maximum: 6, default: 1 };
const readOnly = { readOnlyHint: true, openWorldHint: false };

const mcpToolDefs = [
  {
    name: "search_works",
    title: "Search works",
    description: "Search works by title, artist, series, NASA ID, or keywords. Returns compact records sorted by PPI.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text, for example Bierstadt or Earthrise" },
        limit: { type: "integer", minimum: 1, maximum: 25, default: 12 },
      },
      required: ["query"],
    },
    annotations: readOnly,
  },
  {
    name: "get_work",
    title: "Get work",
    description: "Return one work by id, title, accession number, or NASA ID.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Exact id, title, accession, or NASA ID" },
      },
      required: ["query"],
    },
    annotations: readOnly,
  },
  {
    name: "list_series",
    title: "List series",
    description: "List collection rows and how many works each contains.",
    inputSchema: { type: "object", properties: {} },
    annotations: readOnly,
  },
  {
    name: "get_policies",
    title: "Store policies",
    description: "Store policies as JSON: shipping (free, US only, 14–21 days), returns (30-day money back by mail; buyer pays return shipping), payment (Stripe Checkout), sales tax, and contact.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "get_print_options",
    title: "Print options",
    description: "Sizes, frames, and prices the site offers for one work. Sizes respect the scan's resolution (100 PPI minimum). Prices include the frame and shipping; tax is added at checkout.",
    inputSchema: { type: "object", properties: { work: workArg }, required: ["work"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "quote_order",
    title: "Quote order",
    description: "Price a framed print: unit price, subtotal, shipping, and total before tax, with a summary of the store policies. Ships to the US only; tax is calculated by Stripe at checkout.",
    inputSchema: {
      type: "object",
      properties: {
        work: workArg,
        size: sizeArg,
        frame: frameArg,
        quantity: quantityArg,
        ship_to: {
          type: "object",
          description: "Optional. Checks that we ship there.",
          properties: {
            country: { type: "string", description: "ISO country code. Only US is accepted." },
            state: { type: "string", description: "2-letter state code" },
            zip: { type: "string", description: "US ZIP code" },
          },
          additionalProperties: false,
        },
      },
      required: ["work"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "create_checkout",
    title: "Create checkout link",
    description: "Create a Stripe Checkout link for this order and return checkout_url, order_ref, and a summary of the store policies. Give the link to the buyer; they enter the address and pay on Stripe. This never charges a card. Rate-limited.",
    inputSchema: {
      type: "object",
      properties: {
        work: workArg,
        size: sizeArg,
        frame: frameArg,
        quantity: quantityArg,
        email: { type: "string", maxLength: 254, description: "Optional buyer email to prefill" },
      },
      required: ["work"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "get_order_status",
    title: "Order status",
    description: "Checkout, payment, and shipping status for an order_ref from create_checkout. Returns no personal data.",
    inputSchema: {
      type: "object",
      properties: { order_ref: { type: "string", maxLength: 255, description: "order_ref from create_checkout" } },
      required: ["order_ref"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

const mcpTools = mcpToolDefs.map((tool) => ({ ...tool, annotations: { title: tool.title, ...tool.annotations } }));

const ORDER_TOOLS = new Set(["get_policies", "get_print_options", "quote_order", "create_checkout", "get_order_status"]);
const TOOL_NAMES = new Set(mcpTools.map((tool) => tool.name));
const MCP_METHODS = new Set(["initialize", "notifications/initialized", "ping", "tools/list", "tools/call"]);
const A2A_METHODS = new Set(["message/send", "tasks/send", "agent/getAuthenticatedExtendedCard"]);

async function runOrderTool(name: string, args: Json, context: AgentContext) {
  if (name === "get_policies") return storePolicies();
  const shop = await commerce();
  if (name === "get_print_options") return shop.printOptions(args);
  if (name === "cart_item") return shop.cartItemDraft(args);
  if (name === "quote_order") return shop.quoteOrder(args);
  if (name === "create_checkout") return shop.createAgentCheckout(args, context.ip, undefined, context.surface);
  return shop.orderStatus(args);
}

function toolResult(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

async function callTool(name: string, args: Json, context: AgentContext) {
  if (ORDER_TOOLS.has(name)) {
    try {
      const result = await runOrderTool(name, args, context);
      if (result && typeof result === "object" && "error" in result) {
        return { content: [{ type: "text", text: String((result as { error: unknown }).error) }], isError: true };
      }
      return toolResult(result);
    } catch (error) {
      console.error("Agent order tool failed", name, error);
      return { content: [{ type: "text", text: "Ordering is unavailable right now." }], isError: true };
    }
  }
  if (name === "search_works") return toolResult(searchWorks(String(args.query || ""), Number(args.limit) || 12));
  if (name === "get_work") {
    const work = findWork(String(args.query || ""));
    if (!work) return { content: [{ type: "text", text: "Not found" }], isError: true };
    return toolResult(work);
  }
  if (name === "list_series") return toolResult(listSeries());
  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
}

function mcpResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function mcpError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export async function handleMcpRpc(body: Json, context: AgentContext = { ip: "unknown" }) {
  const id = body.id;
  const method = String(body.method || "");
  const params = (body.params && typeof body.params === "object") ? body.params as Json : {};
  if (method === "tools/call") {
    const name = String(params.name || "");
    recordAgentCall("mcp", TOOL_NAMES.has(name) ? name : "unknown");
  } else {
    recordAgentCall("mcp", MCP_METHODS.has(method) ? method : "unknown_method");
  }
  if (method === "initialize") {
    return mcpResult(id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: mcpServerCard().serverInfo,
    });
  }
  if (method === "notifications/initialized" || method === "ping") return mcpResult(id, {});
  if (method === "tools/list") return mcpResult(id, { tools: mcpTools });
  if (method === "tools/call") {
    const args = params.arguments ?? {};
    if (typeof args !== "object" || Array.isArray(args)) return mcpError(id, -32602, "arguments must be an object");
    return mcpResult(id, await callTool(String(params.name || ""), args as Json, context));
  }
  return mcpError(id, -32601, `Method not found: ${method}`);
}

function a2aText(query: string) {
  const hits = searchWorks(query, 8);
  if (!hits.length) return `No works matched “${query}”.`;
  return hits.map((work) => `${work.title} (${work.year}) — ${work.artist} — ${work.ppi} PPI — ${work.image}`).join("\n");
}

function messageText(message: Json | undefined) {
  const parts = Array.isArray(message?.parts) ? message.parts as Json[] : [];
  return parts.map((part) => String(part.text || part.value || "")).filter(Boolean).join(" ").trim();
}

const A2A_ORDER_SKILLS: Record<string, string> = {
  "get-print-options": "get_print_options",
  "quote-order": "quote_order",
  "create-checkout": "create_checkout",
  "get-order-status": "get_order_status",
  "get-policies": "get_policies",
};

/** A data part like { skill: "quote-order", arguments: {...} } runs that skill; plain text searches. */
function a2aSkillCall(message: Json | undefined, params: Json) {
  const parts = Array.isArray(message?.parts) ? message.parts as Json[] : [];
  for (const part of parts) {
    const data = part.data && typeof part.data === "object" ? part.data as Json : null;
    if (!data) continue;
    const skill = String(data.skill || data.tool || "");
    const tool = A2A_ORDER_SKILLS[skill] ?? (ORDER_TOOLS.has(skill) ? skill : null);
    if (tool) return { tool, args: (data.arguments && typeof data.arguments === "object" ? data.arguments : data) as Json };
  }
  const meta = params.metadata && typeof params.metadata === "object" ? params.metadata as Json : null;
  const skill = meta ? A2A_ORDER_SKILLS[String(meta.skill || "")] : null;
  if (skill) return { tool: skill, args: (meta?.arguments && typeof meta.arguments === "object" ? meta.arguments : {}) as Json };
  return null;
}

function a2aMessage(id: unknown, parts: Json[]) {
  return { jsonrpc: "2.0", id: id ?? null, result: { kind: "message", role: "agent", messageId: randomUUID(), parts } };
}

export async function handleA2aRpc(body: Json, context: AgentContext = { ip: "unknown" }) {
  const id = body.id;
  const method = String(body.method || "");
  const params = (body.params && typeof body.params === "object") ? body.params as Json : {};
  if (method === "message/send" || method === "tasks/send") {
    const message = params.message as Json | undefined;
    const call = a2aSkillCall(message, params);
    recordAgentCall("a2a", call ? call.tool : "search_works");
    if (call) {
      const result = await runOrderTool(call.tool, call.args, context).catch((error) => {
        console.error("Agent order skill failed", call.tool, error);
        return { error: "Ordering is unavailable right now.", status: 500 };
      });
      if (result && typeof result === "object" && "error" in result) {
        return a2aMessage(id, [{ kind: "text", text: String((result as { error: unknown }).error) }]);
      }
      return a2aMessage(id, [{ kind: "data", data: result as Json }]);
    }
    const query = messageText(message) || String(params.message || params.text || "collection");
    return a2aMessage(id, [{ kind: "text", text: a2aText(query) }]);
  }
  recordAgentCall("a2a", A2A_METHODS.has(method) ? method : "unknown_method");
  if (method === "agent/getAuthenticatedExtendedCard") {
    return { jsonrpc: "2.0", id: id ?? null, result: a2aAgentCard() };
  }
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message: `Method not found: ${method}` } };
}

const REST_ROUTES: Record<string, { tool: string; method: "GET" | "POST" }> = {
  "/api/agent/print-options": { tool: "get_print_options", method: "GET" },
  "/api/agent/cart-item": { tool: "cart_item", method: "GET" },
  "/api/agent/quote": { tool: "quote_order", method: "POST" },
  "/api/agent/checkout": { tool: "create_checkout", method: "POST" },
  "/api/agent/policies": { tool: "get_policies", method: "GET" },
  [POLICIES_API_PATH]: { tool: "get_policies", method: "GET" },
};

function jsonResponse(body: unknown, contentType = "application/json; charset=utf-8", status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": contentType, "Cache-Control": "no-store", ...cors },
  });
}

export async function handleAgentRequest(request: Request) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (url.pathname === WEB_BOT_AUTH_PATH) return webBotAuthDirectory(request);

  if (url.pathname === "/api/agent/register" || url.pathname === "/api/agent/claim" || url.pathname === "/api/agent/auth") {
    recordAgentCall("rest", "register");
    return jsonResponse(anonymousGrant());
  }

  const ip = agentClientIp(request);
  const rest = REST_ROUTES[url.pathname];
  if (rest || url.pathname.startsWith("/api/agent/orders/")) {
    const context: AgentContext = { ip, surface: "rest" };
    const tool = rest?.tool ?? "get_order_status";
    const method = rest?.method ?? "GET";
    if (request.method !== method) return jsonResponse({ error: `Use ${method}` }, undefined, 405);
    recordAgentCall("rest", tool);
    let args: Json;
    if (method === "GET") {
      args = rest ? Object.fromEntries(url.searchParams) : { order_ref: decodeURIComponent(url.pathname.slice("/api/agent/orders/".length)) };
    } else {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) return jsonResponse({ error: "Send a JSON object" }, undefined, 400);
      args = body as Json;
    }
    try {
      const result = await runOrderTool(tool, args, context);
      if (result && typeof result === "object" && "error" in result) {
        const failed = result as { error: string; status?: number };
        return jsonResponse({ error: failed.error }, undefined, failed.status ?? 400);
      }
      return jsonResponse(result);
    } catch (error) {
      console.error("Agent order route failed", tool, error);
      return jsonResponse({ error: "Ordering is unavailable right now." }, undefined, 503);
    }
  }

  if (url.pathname === MCP_PATH) {
    if (request.method === "GET") {
      recordAgentCall("mcp", "card");
      return jsonResponse(mcpServerCard());
    }
    if (request.method !== "POST") return jsonResponse({ error: "POST JSON-RPC" }, "application/json; charset=utf-8");
    const body = await request.json().catch(() => ({}));
    return jsonResponse(await handleMcpRpc(body as Json, { ip, surface: "mcp" }));
  }

  if (url.pathname === A2A_PATH) {
    if (request.method === "GET") {
      recordAgentCall("a2a", "card");
      return jsonResponse(a2aAgentCard());
    }
    if (request.method !== "POST") return jsonResponse({ error: "POST JSON-RPC" });
    const body = await request.json().catch(() => ({}));
    return jsonResponse(await handleA2aRpc(body as Json, { ip, surface: "a2a" }));
  }

  return jsonResponse({ error: "Not found" }, "application/json; charset=utf-8", 404);
}

/** Category, series, and artist pages (same review gate as the site). */
function hubPagesText() {
  const pool = liveWorks();
  const hubs = buildHubs(pool);
  const guides = GIFT_GUIDES.map((guide) => ({ name: guide.name, url: `https://frameanyphoto.com${guide.path}`, works: giftGuideWorks(guide, pool) })).filter((guide) => guide.works.length);
  const line = (hub: { name: string; url: string; works: unknown[] }) => `- [${hub.name}](${hub.url}): ${hub.works.length} works`;
  return `## Browse pages

### Categories

${hubs.categories.map(line).join("\n")}

### Series

${hubs.series.map(line).join("\n")}

### Artists

${hubs.artists.map(line).join("\n")}

### Guides

${guides.map(line).join("\n")}`;
}

/** Opening sentence of a work's About text (two when the first is short), for llms-full.txt. */
function aboutLead(about: string) {
  const text = about.replace(/\s+/g, " ").trim();
  // A sentence ends at . ! or ? before a capitalised word, but not after an initial or a short abbreviation.
  const pattern = /(?<!\b(?:[A-Z]|St|Mt|Dr|Mr|Mrs|Jr|Sr|No|c|ca))[.!?]["\u201d\u2019)]?\s+(?=[A-Z\u00c0-\u00de][a-z\u00df-\u00ff])/g;
  for (const match of text.matchAll(pattern)) {
    const end = (match.index ?? 0) + match[0].trimEnd().length;
    if (end >= 100) return text.slice(0, end);
  }
  return text;
}

/** Live work pages that carry a written About section, grouped by category. full adds a one-sentence summary. */
function writtenWorksText(full: boolean) {
  const hubs = buildHubs(liveWorks());
  const groups = hubs.categories
    .map((hub) => ({ hub, works: hub.works.filter((work) => workContentEntry(work.id)).sort((a, b) => a.title.localeCompare(b.title)) }))
    .filter((group) => group.works.length);
  if (!groups.length) return "";
  const line = (work: Work) => {
    const credit = [work.artist, work.year].filter(Boolean).join(", ");
    const lead = full ? ` ${aboutLead(workContentEntry(work.id)?.about ?? "")}` : "";
    return `- [${work.title}](${AGENT_ORIGIN}/w/${workSlug(work)}): ${credit}.${lead}`;
  };
  return `\n\n## Work pages with written guides

Each page has the history of the work, its sources, the print sizes, and related works.

${groups.map((group) => `### [${group.hub.name}](${group.hub.url})\n\n${group.works.map(line).join("\n")}`).join("\n\n")}`;
}

/** ratings: approved buyer ratings (lib/customer-reviews workRatings), passed in so this file stays sqlite-free. */
type LlmsRating = { slug: string; title: string; value: number; count: number };

function ratedWorksText(ratings: LlmsRating[]) {
  if (!ratings.length) return "";
  return `\n\n## Rated works\n\nAverage of approved verified-buyer reviews:\n\n${ratings.map((row) => `- [${row.title}](${AGENT_ORIGIN}/api/reviews?work=${encodeURIComponent(row.slug)}): ${row.value} of 5 from ${row.count} review${row.count === 1 ? "" : "s"}`).join("\n")}`;
}

export function llmsText(ratings: LlmsRating[] = []) {
  return llmsBody(ratings, false);
}

function llmsBody(ratings: LlmsRating[], full: boolean) {
  return `# ${AGENT_NAME}

> ${AGENT_SUMMARY} Ships to the US. The buyer pays on Stripe; agents never handle card data.

## Order a print

1. \`search_works\` to find a work id.
2. \`get_print_options\` for its sizes, frames, and prices.
3. \`quote_order\` for the total. Shipping is included; tax is added at checkout.
4. \`create_checkout\` returns \`checkout_url\`. Send it to the buyer to pay.
5. \`get_order_status\` with the \`order_ref\`.

## Policies

${Object.entries(policySummary()).filter(([key]) => key !== "details").map(([key, line]) => `- ${key[0].toUpperCase()}${key.slice(1)}: ${line}`).join("\n")}

Machine-readable: [${POLICIES_PATH}](${AGENT_ORIGIN}${POLICIES_PATH}) (also \`GET ${POLICIES_API_PATH}\`, MCP \`get_policies\`, A2A skill \`get-policies\`). \`quote_order\` and \`create_checkout\` include the same summary.

## Store pages

${STORE_PAGES.map((page) => `- [${page.title}](${AGENT_ORIGIN}${page.path}): ${page.description}`).join("\n")}

## Product feeds

Rebuilt on each release from the public catalog, one item per work and print size, same prices as checkout:
[Google Merchant XML](${AGENT_ORIGIN}/${FEEDS_DIR}/${FEED_FILES.google_xml}), [Google TSV](${AGENT_ORIGIN}/${FEEDS_DIR}/${FEED_FILES.google_tsv}), [OpenAI JSONL](${AGENT_ORIGIN}/${FEEDS_DIR}/${FEED_FILES.openai_jsonl}), [Stripe CSV](${AGENT_ORIGIN}/${FEEDS_DIR}/${FEED_FILES.stripe_csv}), [Shopify CSV](${AGENT_ORIGIN}/${FEEDS_DIR}/${FEED_FILES.shopify_csv}), [index](${AGENT_ORIGIN}/${FEEDS_DIR}/${FEED_FILES.index}).

## Catalog JSON

- [All public works](${AGENT_ORIGIN}/api/catalog): \`q\`, \`category\`, \`series\`, \`artist\`, \`size\`, \`min_price\`, \`max_price\` (USD), \`sort\` (relevance, title, artist, newest, resolution), \`limit\` (max 200), \`cursor\` or \`offset\`. Returns \`total\` and \`next\`. Aliases: /api/works, /api/browse.
- [One work](${AGENT_ORIGIN}/api/catalog/cdf-wanderer): \`/api/catalog/{slug}\`, with sizes, frames, prices, and credit.
- [Categories](${AGENT_ORIGIN}/api/catalog/categories): names, ids, counts, and page URLs.
- [Buyer reviews](${AGENT_ORIGIN}/api/reviews): approved reviews from verified buyers only; \`?work={slug}\` for one work. Works with reviews carry \`rating\` (\`value\`, \`count\`) in catalog results.${ratedWorksText(ratings)}
${hubPagesText()}${writtenWorksText(full)}

## Interfaces

- [MCP](${AGENT_ORIGIN}${MCP_PATH}): Streamable HTTP JSON-RPC. No auth.
- [A2A](${AGENT_ORIGIN}${A2A_PATH}): Agent card at [/.well-known/agent-card.json](${AGENT_ORIGIN}/.well-known/agent-card.json).
- [OpenAPI](${AGENT_ORIGIN}/openapi.json): REST for the same tools.
- [auth.md](${AGENT_ORIGIN}/auth.md): Anonymous access.
- [Collection JSON](${AGENT_ORIGIN}/api/collection): Every work with image, pixels, PPI, and source record.
- [Site as Markdown](${AGENT_ORIGIN}/): Request with \`Accept: text/markdown\`.

## Optional

- [Image source catalog](${AGENT_ORIGIN}/.well-known/image-sources.json)
- [Agent skill index](${AGENT_ORIGIN}/.well-known/agent-skills/index.json)
- [Full context](${AGENT_ORIGIN}/llms-full.txt)
`;
}

export function llmsFullText(ratings: LlmsRating[] = []) {
  const tools = mcpTools.map((tool) => {
    const props = Object.keys((tool.inputSchema as { properties?: Json }).properties ?? {});
    return `### ${tool.name}(${props.join(", ")})\n\n${tool.description}`;
  }).join("\n\n");
  const rows = listSeries().map((row) => `- ${row.title} (${row.count})`).join("\n");
  return `${llmsBody(ratings, true)}
## Tools

The MCP tools, A2A skills, and REST endpoints share these inputs and outputs.

${tools}

## Rules

- Prices are in US cents and match the website for the same work, size, and frame.
- Sizes below 100 PPI for a scan are not offered.
- Quantity is 1 to 6 per checkout.
- Checkout links expire after 24 hours. Creating one never charges a card.
- create_checkout is rate-limited per IP.
- Order status returns no buyer name, email, or address.

## Collection rows

${rows}
`;
}

export function openApiSpec() {
  const error = { description: "Error", content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } } };
  const ok = (description: string) => ({ description, content: { "application/json": { schema: { type: "object" } } } });
  const body = (tool: string) => {
    const found = mcpTools.find((entry) => entry.name === tool);
    return { required: true, content: { "application/json": { schema: found?.inputSchema } } };
  };
  return {
    openapi: "3.1.0",
    info: { title: `${AGENT_NAME} API`, version: AGENT_VERSION, description: AGENT_SUMMARY },
    servers: [{ url: AGENT_ORIGIN }],
    paths: {
      "/api/catalog": {
        get: {
          operationId: "listCatalog",
          summary: "Public works with sizes, frames, prices, and credit. Aliases: /api/works, /api/browse",
          parameters: [
            { name: "q", in: "query", schema: { type: "string", maxLength: 200 }, description: "Search title, artist, and category" },
            { name: "category", in: "query", schema: { type: "string" }, description: "Category slug or id, as on /browse (see /api/catalog/categories)" },
            { name: "series", in: "query", schema: { type: "string" }, description: "Series id (see /api/catalog/categories)" },
            { name: "artist", in: "query", schema: { type: "string" } },
            { name: "size", in: "query", schema: { type: "string" }, description: "Small, Medium, Large, or a size id like 24x36" },
            { name: "min_price", in: "query", schema: { type: "number", minimum: 0 }, description: "USD" },
            { name: "max_price", in: "query", schema: { type: "number", minimum: 0 }, description: "USD" },
            { name: "sort", in: "query", schema: { type: "string", enum: ["relevance", "title", "artist", "newest", "resolution"] }, description: "Default: relevance with q, else title. newest = latest artwork date" },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
            { name: "cursor", in: "query", schema: { type: "string" }, description: "next_cursor from the previous page" },
            { name: "offset", in: "query", schema: { type: "integer", minimum: 0 } },
          ],
          responses: { 200: ok("{ total, offset, limit, count, next_cursor, next, works[] }"), 400: error, 429: error },
        },
      },
      "/api/catalog/{slug}": {
        get: {
          operationId: "getCatalogWork",
          summary: "One public work",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: ok("Work"), 404: error },
        },
      },
      "/api/catalog/categories": { get: { operationId: "listCatalogCategories", summary: "Categories with ids, names, and counts", responses: { 200: ok("Categories") } } },
      "/api/collection": { get: { operationId: "getCollection", summary: "All works with image, pixels, PPI, and source record", responses: { 200: ok("Collection") } } },
      "/api/agent/print-options": {
        get: {
          operationId: "getPrintOptions",
          summary: "Sizes, frames, and prices for one work",
          parameters: [{ name: "work", in: "query", required: true, schema: { type: "string", maxLength: 200 } }],
          responses: { 200: ok("Print options"), 400: error, 404: error },
        },
      },
      "/api/agent/quote": { post: { operationId: "quoteOrder", summary: "Price a framed print with shipping; tax is added at checkout", requestBody: body("quote_order"), responses: { 200: ok("Quote"), 400: error, 404: error, 422: error } } },
      "/api/agent/checkout": { post: { operationId: "createCheckout", summary: "Stripe Checkout link for the buyer to pay", requestBody: body("create_checkout"), responses: { 200: ok("checkout_url and order_ref"), 400: error, 404: error, 429: error } } },
      "/api/agent/orders/{order_ref}": {
        get: {
          operationId: "getOrderStatus",
          summary: "Payment and shipping status; no personal data",
          parameters: [{ name: "order_ref", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: ok("Status"), 404: error },
        },
      },
      [POLICIES_API_PATH]: {
        get: {
          operationId: "getPolicies",
          summary: `Shipping, returns, payment, tax, and contact policies (same JSON as ${POLICIES_PATH}). Alias: /api/agent/policies`,
          responses: { 200: ok("Store policies") },
        },
      },
      [MCP_PATH]: { post: { operationId: "mcp", summary: "MCP JSON-RPC (Streamable HTTP)", responses: { 200: ok("JSON-RPC response") } } },
      [A2A_PATH]: { post: { operationId: "a2a", summary: "A2A JSON-RPC", responses: { 200: ok("JSON-RPC response") } } },
    },
  };
}

/** Agentic Resource Discovery manifest (ARD v0.91, served at ard.json and the older ai-catalog.json path). */
export function ardManifest() {
  const host = new URL(AGENT_ORIGIN).host;
  const urn = (ns: string, name: string) => `urn:air:${host}:${ns}:${name}`;
  const queries = ["find a framed art print", "framed print of a famous painting", "buy a framed vintage space photo", "price a framed print with shipping"];
  return {
    specVersion: "0.91",
    host: { displayName: AGENT_NAME, identifier: host, url: AGENT_ORIGIN, documentationUrl: `${AGENT_ORIGIN}/llms.txt` },
    entries: [
      { identifier: urn("mcp", "frameanyphoto"), displayName: `${AGENT_NAME} MCP server`, description: AGENT_SUMMARY, type: "application/mcp-server-card+json", url: `${AGENT_ORIGIN}/.well-known/mcp/server-card.json`, version: AGENT_VERSION, tags: ["art", "prints", "framing", "shopping"], capabilities: mcpTools.map((tool) => tool.name), representativeQueries: queries },
      { identifier: urn("a2a", "frameanyphoto"), displayName: `${AGENT_NAME} A2A agent`, description: AGENT_SUMMARY, type: "application/a2a-agent-card+json", url: `${AGENT_ORIGIN}/.well-known/agent-card.json`, version: AGENT_VERSION, tags: ["art", "prints", "framing", "shopping"], representativeQueries: queries },
      { identifier: urn("api", "openapi"), displayName: `${AGENT_NAME} REST API`, description: "Catalog search, print options, quotes, and Stripe Checkout links.", type: "application/vnd.oai.openapi+json", url: `${AGENT_ORIGIN}/openapi.json`, version: AGENT_VERSION, representativeQueries: queries },
      { identifier: urn("skills", "index"), displayName: `${AGENT_NAME} agent skills`, description: "Agent skills index for this site.", type: "application/json", url: `${AGENT_ORIGIN}/.well-known/agent-skills/index.json` },
    ],
  };
}

export function agentDiscoveryFiles(ratings: LlmsRating[] = []) {
  return {
    "llms.txt": llmsText(ratings),
    "llms-full.txt": llmsFullText(ratings),
    "openapi.json": `${JSON.stringify(openApiSpec(), null, 2)}\n`,
    "auth.md": authMarkdown(),
    ".well-known/mcp/server-card.json": `${JSON.stringify(mcpServerCard(), null, 2)}\n`,
    ".well-known/mcp.json": `${JSON.stringify(mcpServerCard(), null, 2)}\n`,
    ".well-known/agent-card.json": `${JSON.stringify(a2aAgentCard(), null, 2)}\n`,
    ".well-known/policies.json": `${JSON.stringify(storePolicies(), null, 2)}\n`,
    ".well-known/oauth-protected-resource": `${JSON.stringify(oauthProtectedResource(), null, 2)}\n`,
    ".well-known/oauth-authorization-server": `${JSON.stringify(oauthAuthorizationServer(), null, 2)}\n`,
    ".well-known/openid-configuration": `${JSON.stringify(openidConfiguration(), null, 2)}\n`,
    ".well-known/ard.json": `${JSON.stringify(ardManifest(), null, 2)}\n`,
    ".well-known/ai-catalog.json": `${JSON.stringify(ardManifest(), null, 2)}\n`,
  };
}
