# TokenPulse — PayBox Hackathon Plugin

Crypto market research plugin for PayBox agents.

## Tools
- `get_token_data` (free) — price, market cap, 24h volume, 24h change
- `compare_tokens` (free) — compare up to 3 tokens
- `create_market_brief` (free) — structured summary
- `propose_premium_brief` (x402) — paid richer brief proposal
- `propose_trade_from_research` — unsigned Base transfer proposal (defaults to 0 wei)

## Build (Codespaces or any Linux with Node 24)
```bash
corepack enable
corepack prepare pnpm@11.11.0 --activate
pnpm install --frozen-lockfile
pnpm test
```

Upload only `dist/plugin.mjs` to the PayBox developer portal.

Network host required: `api.coingecko.com`
