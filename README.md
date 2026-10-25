# FrameAnyPhoto MCP Server

**Let AI assistants find, price and order framed art prints.**

[FrameAnyPhoto](https://frameanyphoto.com) sells museum-quality framed prints of public-domain masterworks and NASA photography. This remote [Model Context Protocol](https://modelcontextprotocol.io) server lets Claude, ChatGPT, Cursor and any other MCP client search the catalog, compare sizes and frames, quote an order, and hand the buyer a secure Stripe Checkout link.

- **Endpoint:** `https://frameanyphoto.com/mcp`
- **Transport:** Streamable HTTP (JSON-RPC 2.0)
- **Auth:** none, no API key or account needed
- **Registry:** [`com.frameanyphoto/prints`](https://registry.modelcontextprotocol.io/v0/servers?search=com.frameanyphoto) in the official MCP Registry
- **Website:** https://frameanyphoto.com

Agents never see or handle card data. `create_checkout` returns a link and the buyer pays on Stripe.

## Quick start

### Claude Code

```bash
claude mcp add --transport http frameanyphoto https://frameanyphoto.com/mcp
```

### Claude (desktop and web)

Go to **Settings → Connectors → Add custom connector**, name it `FrameAnyPhoto` and paste `https://frameanyphoto.com/mcp`.

For older Claude Desktop builds without remote connectors, add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "frameanyphoto": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://frameanyphoto.com/mcp"]
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "frameanyphoto": {
      "url": "https://frameanyphoto.com/mcp"
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "frameanyphoto": {
      "type": "http",
      "url": "https://frameanyphoto.com/mcp"
    }
  }
}
```

### ChatGPT

With developer mode on, open **Settings → Apps & Connectors → Create**, name it `FrameAnyPhoto`, set the URL to `https://frameanyphoto.com/mcp` and choose **No authentication**.

### Any other client

Point it at `https://frameanyphoto.com/mcp` using the Streamable HTTP transport.

## Tools

| Tool | What it does | Read-only |
| --- | --- | --- |
| `search_works` | Search by title, artist, series, NASA ID or keyword. Results are sorted by scan resolution (PPI). | yes |
| `get_work` | One work by id, title, accession number or NASA ID. | yes |
| `list_series` | Collection rows (Landscapes, NASA Spaceflight, Sailing, …) with work counts. | yes |
| `get_policies` | Shipping, returns, payment, tax and contact policies as JSON. | yes |
| `get_print_options` | Sizes, frames and prices for one work. Sizes are capped by the scan's resolution (100 PPI minimum). | yes |
| `quote_order` | Unit price, subtotal, shipping and total before tax, plus a policy summary. | yes |
| `create_checkout` | Creates a Stripe Checkout link and returns `checkout_url` and `order_ref`. Never charges a card. Rate-limited. | no |
| `get_order_status` | Checkout, payment and shipping status for an `order_ref`. Returns no personal data. | yes |

Full input schemas are in [`tools.json`](tools.json) (the server's own `tools/list` response).

### Input schemas at a glance

```text
search_works      { query: string, limit?: 1-25 = 12 }
get_work          { query: string }
list_series       { }
get_policies      { }
get_print_options { work: string }
quote_order       { work: string, size?: string, frame?: string, quantity?: 1-6 = 1,
                    ship_to?: { country?: "US", state?: string, zip?: string } }
create_checkout   { work: string, size?: string, frame?: string, quantity?: 1-6 = 1, email?: string }
get_order_status  { order_ref: string }
```

`work` accepts the `ascii_id` slug from `search_works` (preferred), the work id, a `/w/` URL, the exact title, an accession number or a NASA ID. `size` accepts a `size_id` such as `24x24` or `Small`, `Medium`, `Large`. `frame` takes a `frame_id` from `get_print_options`.

## Typical agent flow

1. `search_works { "query": "Earthrise" }` finds the work and its `ascii_id`.
2. `get_print_options { "work": "earthrise" }` lists the sizes, frames and prices.
3. `quote_order { "work": "earthrise", "size": "Medium" }` gives the total before tax.
4. `create_checkout { "work": "earthrise", "size": "Medium" }` returns a Stripe Checkout link for the buyer.
5. `get_order_status { "order_ref": "…" }` follows up on payment and shipping.

## Example calls

Raw JSON-RPC with curl (see [`examples/curl.sh`](examples/curl.sh)):

```bash
curl -s -X POST https://frameanyphoto.com/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_works","arguments":{"query":"Earthrise","limit":1}}}'
```

```json
[{"id":"AP–as08-14-2383","ascii_id":"earthrise","title":"Earthrise","artist":"NASA / Bill Anders","year":"1968",
  "series":"spaceflight","ppi":2532,"pixels":"5584 × 5584 px",
  "image":"https://media.frameanyphoto.com/art/earthrise.jpg",
  "recordUrl":"https://images.nasa.gov/details/as08-14-2383","repositoryName":"NASA Image and Video Library"}]
```

`quote_order { "work": "earthrise", "size": "Medium" }` returns (trimmed):

```json
{"size":"Medium (24 × 24 in)","frame":"Black Metallic","unit_price_cents":15000,"shipping_cents":0,
 "total_before_tax_cents":15000,"ships_to":["US"],
 "tax":"Sales tax is added by Stripe Checkout from the shipping address."}
```

Node.js with the official SDK (see [`examples/client.mjs`](examples/client.mjs)):

```bash
cd examples && npm install && node client.mjs Venice
```

```text
Tools: search_works, get_work, list_series, get_policies, get_print_options, quote_order, create_checkout, get_order_status

Top matches for "Venice":
- The Entrance to the Grand Canal, Venice (Canaletto, c. 1730) -> https://frameanyphoto.com/w/ct-canaletto-grand-canal
- Venice with San Giorgio Maggiore in the Moonlight (Henry Pether, by 1865) -> https://frameanyphoto.com/w/hp-san-giorgio-maggiore-moonlight
...
```

## Example prompts

- "Find me a framed moonlit Venice print under $200."
- "What sizes does FrameAnyPhoto offer for Earthrise, and which frames?"
- "Get me a checkout link for a medium Apollo 11 print in a black frame."
- "Suggest nautical art for a beach house and quote two options."

## Store policies

- Free shipping to US addresses only, delivered in 14–21 days
- 30-day money-back returns by mail (buyer pays return shipping)
- Payment on Stripe Checkout; US sales tax added at checkout
- Prices include the frame and shipping

Machine-readable: https://frameanyphoto.com/.well-known/policies.json

## MCP Registry entry

[`server.json`](server.json) is the entry published to the official MCP Registry as `com.frameanyphoto/prints`.

## About this repository

This repository documents the hosted FrameAnyPhoto MCP server and includes small client examples. The server itself runs at `https://frameanyphoto.com/mcp`, so there is nothing to install or host.

## Contact

- Website: https://frameanyphoto.com
- Email: ceo@frameanyphoto.com
- Issues: open one in this repository

## License

[MIT](LICENSE)
