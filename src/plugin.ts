import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { evmOutputSchema, proposeEvm, proposeX402, x402OutputSchema } from "./paybox.js";

const PROTOCOL_VERSION = "2026-07-28";
const COINGECKO = "https://api.coingecko.com/api/v3";

const SYMBOL_TO_ID: Record<string, string> = {
  btc: "bitcoin",
  eth: "ethereum",
  sol: "solana",
  usdc: "usd-coin",
  usdt: "tether",
};

const tokenId = z.string().min(1).max(64).transform((s) => {
  const key = s.toLowerCase().trim();
  return SYMBOL_TO_ID[key] ?? key;
});

const marketSchema = z.object({
  id: z.string(),
  price_usd: z.number().nullable(),
  market_cap_usd: z.number().nullable(),
  volume_24h_usd: z.number().nullable(),
  change_24h_pct: z.number().nullable(),
  last_updated_at: z.number().nullable(),
  source: z.literal("coingecko"),
}).strict();

async function fetchMarket(ids: string[]) {
  const url = new URL(`${COINGECKO}/simple/price`);
  url.searchParams.set("ids", ids.join(","));
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_market_cap", "true");
  url.searchParams.set("include_24hr_vol", "true");
  url.searchParams.set("include_24hr_change", "true");
  url.searchParams.set("include_last_updated_at", "true");

  const res = await fetch(url, {
    signal: AbortSignal.timeout(4000),
    redirect: "error",
    headers: { Accept: "application/json" },
  });

  if (res.status === 429) throw new Error("CoinGecko rate limit. Retry later.");
  if (!res.ok) throw new Error(`CoinGecko request failed (${res.status}).`);

  const data = await res.json() as Record<string, any>;
  return ids.map((id) => {
    const row = data[id];
    if (!row) return null;
    return {
      id,
      price_usd: typeof row.usd === "number" ? row.usd : null,
      market_cap_usd: typeof row.usd_market_cap === "number" ? row.usd_market_cap : null,
      volume_24h_usd: typeof row.usd_24h_vol === "number" ? row.usd_24h_vol : null,
      change_24h_pct: typeof row.usd_24h_change === "number" ? row.usd_24h_change : null,
      last_updated_at: typeof row.last_updated_at === "number" ? row.last_updated_at : null,
      source: "coingecko" as const,
    };
  });
}

function createServer() {
  const server = new McpServer(
    { name: "tokenpulse", version: "0.1.0" },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  server.registerTool(
    "get_token_data",
    {
      title: "Get token market data",
      description: "Free public market data for one cryptocurrency (price, market cap, 24h volume, 24h change). Not financial advice.",
      inputSchema: z.object({ token: tokenId }).strict(),
      outputSchema: marketSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ token }) => {
      try {
        const rows = await fetchMarket([token]);
        const row = rows[0];
        if (!row) {
          return { isError: true, content: [{ type: "text", text: `Unknown token: ${token}. Use CoinGecko ID or common symbol (btc, eth, sol).` }] };
        }
        return {
          content: [{ type: "text", text: `${row.id}: $${row.price_usd ?? "n/a"} USD` }],
          structuredContent: row,
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: (e as Error).message }] };
      }
    },
  );

  server.registerTool(
    "compare_tokens",
    {
      title: "Compare tokens",
      description: "Free side-by-side comparison of up to three tokens using the same public metrics.",
      inputSchema: z.object({ tokens: z.array(tokenId).min(2).max(3) }).strict(),
      outputSchema: z.object({ tokens: z.array(marketSchema), source: z.literal("coingecko") }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ tokens }) => {
      try {
        const unique = [...new Set(tokens)];
        const rows = (await fetchMarket(unique)).filter(Boolean) as z.infer<typeof marketSchema>[];
        if (rows.length === 0) {
          return { isError: true, content: [{ type: "text", text: "No valid tokens found." }] };
        }
        return {
          content: [{ type: "text", text: `Compared ${rows.length} tokens.` }],
          structuredContent: { tokens: rows, source: "coingecko" },
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: (e as Error).message }] };
      }
    },
  );

  server.registerTool(
    "create_market_brief",
    {
      title: "Create market brief",
      description: "Free concise structured market brief from public data. Not personalized financial advice.",
      inputSchema: z.object({ tokens: z.array(tokenId).min(1).max(3) }).strict(),
      outputSchema: z.object({
        summary: z.string(),
        tokens: z.array(marketSchema),
        currency: z.literal("USD"),
        generated_at: z.string(),
        source: z.literal("coingecko"),
        disclaimer: z.string(),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ tokens }) => {
      try {
        const unique = [...new Set(tokens)];
        const rows = (await fetchMarket(unique)).filter(Boolean) as z.infer<typeof marketSchema>[];
        if (rows.length === 0) {
          return { isError: true, content: [{ type: "text", text: "No data available for the requested tokens." }] };
        }
        const lines = rows.map((r) =>
          `${r.id}: $${r.price_usd ?? "n/a"} | 24h ${r.change_24h_pct?.toFixed(2) ?? "n/a"}% | vol $${r.volume_24h_usd?.toLocaleString() ?? "n/a"}`
        );
        const summary = lines.join("; ");
        return {
          content: [{ type: "text", text: summary }],
          structuredContent: {
            summary,
            tokens: rows,
            currency: "USD",
            generated_at: new Date().toISOString(),
            source: "coingecko",
            disclaimer: "Public market data only. Not financial advice. Not a recommendation to buy or sell.",
          },
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: (e as Error).message }] };
      }
    },
  );

  server.registerTool(
    "propose_premium_brief",
    {
      title: "Propose premium market brief (x402)",
      description: "Proposes a paid x402 request for a richer market brief. Free tools remain available. Nothing is paid until the user approves in PayBox. For testing, use a small maxAmount.",
      inputSchema: z.object({
        tokens: z.array(tokenId).min(1).max(5),
        maxAmountAtomicUsdc: z.string().regex(/^[1-9][0-9]{0,19}$/).default("50000"),
      }).strict(),
      outputSchema: x402OutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ tokens, maxAmountAtomicUsdc }) => {
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(tokens.join(","))}&order=market_cap_desc&per_page=5&page=1&sparkline=true`;
      return proposeX402({
        chain: "eip155:8453",
        url,
        method: "GET",
        maxAmount: maxAmountAtomicUsdc,
      });
    },
  );

  server.registerTool(
    "propose_trade_from_research",
    {
      title: "Propose trade from research",
      description: "Builds an unsigned Base transaction proposal informed by prior research. Default amount is 0 wei for safe testing. PayBox handles approval and signing. Not financial advice.",
      inputSchema: z.object({
        recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        amountWei: z.string().regex(/^(0|[1-9][0-9]{0,77})$/).default("0"),
        note: z.string().max(200).optional(),
      }).strict(),
      outputSchema: evmOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ recipient, amountWei, note }) => {
      return proposeEvm({
        chain: "eip155:8453",
        to: recipient,
        value: amountWei,
        data: "0x",
      });
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
