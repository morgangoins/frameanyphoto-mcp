#!/usr/bin/env bash
# Talk to the FrameAnyPhoto MCP server with plain JSON-RPC over HTTP.
# No API key or account is needed.
set -euo pipefail
URL="${FRAMEANYPHOTO_MCP_URL:-https://frameanyphoto.com/mcp}"

rpc() {
  curl -s -X POST "$URL" \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d "$1"
  echo
}

# 1. Handshake
rpc '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl-example","version":"1.0.0"}}}'

# 2. List tools
rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 3. Search the catalog
rpc '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_works","arguments":{"query":"Earthrise","limit":3}}}'

# 4. Sizes, frames and prices for one work
rpc '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_print_options","arguments":{"work":"earthrise"}}}'

# 5. Quote a framed print (before tax)
rpc '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"quote_order","arguments":{"work":"earthrise","size":"Medium"}}}'
