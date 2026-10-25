# Server source

These are the files that implement the hosted MCP server at `https://frameanyphoto.com/mcp`, copied from the FrameAnyPhoto web app.

| File | Role |
| --- | --- |
| `agent-protocol.ts` | JSON-RPC handler for MCP (`initialize`, `tools/list`, `tools/call`) and A2A, tool schemas, server card, CORS, client IP handling |
| `agent-commerce.ts` | Order tools: print options, quotes, Stripe Checkout creation (rate-limited), order status |
| `store-policies.ts` | Machine-readable shipping, returns, payment and tax policies |
| `site-policy.ts` | Policy constants shared with the website |
| `agent-brand.ts` | Public name and origin |

They import catalog, checkout and routing modules from the rest of the web app (`./collection`, `./checkout`, `./work-url`, etc.), which are not part of this repository, so this folder is a readable reference rather than a standalone package. To use the server, connect any MCP client to the hosted endpoint; nothing needs to be installed.

No secrets live in these files. Stripe keys and other credentials are read from the server environment by modules not published here.
