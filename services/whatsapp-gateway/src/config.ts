import { config as loadEnv } from "dotenv";
import { z } from "zod";

// Load .env from the service dir, then fall back to the repo root .env.
loadEnv();
loadEnv({ path: "../../.env" });

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // HTTP control API
  PORT: z.coerce.number().default(8080),
  GATEWAY_API_TOKEN: z.string().min(16, "GATEWAY_API_TOKEN must be set (>=16 chars)"),

  // Supabase (service role — bypasses RLS; server only)
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Redis / BullMQ
  REDIS_URL: z.string().url().or(z.string().startsWith("redis")),

  // Anti-ban throttle window (ms) for sends to a single channel (§7)
  WA_SEND_MIN_DELAY_MS: z.coerce.number().default(3000),
  WA_SEND_MAX_DELAY_MS: z.coerce.number().default(5000),

  // Print QR to the terminal in dev so the gateway is testable without the dashboard
  WA_PRINT_QR_TERMINAL: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast with a readable message rather than crashing deep in a socket.
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid gateway environment:\n${issues}`);
}

export const config = parsed.data;
export type Config = typeof config;
