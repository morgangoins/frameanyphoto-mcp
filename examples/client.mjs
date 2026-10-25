// Minimal MCP client for the FrameAnyPhoto remote server.
// Usage: cd examples && npm install && node client.mjs Venice
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.FRAMEANYPHOTO_MCP_URL ?? "https://frameanyphoto.com/mcp");
const query = process.argv.slice(2).join(" ") || "Earthrise";

const client = new Client({ name: "frameanyphoto-example", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(url));

const { tools } = await client.listTools();
console.log("Tools:", tools.map((t) => t.name).join(", "));

const search = await client.callTool({ name: "search_works", arguments: { query, limit: 3 } });
const works = JSON.parse(search.content[0].text);
console.log(`\nTop matches for "${query}":`);
for (const w of works) console.log(`- ${w.title} (${w.artist}, ${w.year}) -> https://frameanyphoto.com/w/${w.ascii_id}`);

if (works[0]) {
  const quote = await client.callTool({ name: "quote_order", arguments: { work: works[0].ascii_id } });
  const q = JSON.parse(quote.content[0].text);
  console.log(`\nQuote: ${q.size}, ${q.frame}: $${(q.total_before_tax_cents / 100).toFixed(2)} before tax, free US shipping`);
}

await client.close();
