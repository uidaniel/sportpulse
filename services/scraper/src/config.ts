import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();
loadEnv({ path: "../../.env" });

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HEALTH_PORT: z.coerce.number().default(8081),

  // Supabase (service role — bypasses RLS; server only)
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Redis / BullMQ (same instance the gateway uses; we enqueue to its wa-send queue)
  REDIS_URL: z.string().startsWith("redis"),

  // Which X source to use. "rapidapi" hits twitter241 via x/client.ts; "custom"
  // hits the no-auth scraper route in apps/web via x/client-custom.ts.
  X_SOURCE: z.enum(["rapidapi", "custom"]).default("rapidapi"),
  // Required when X_SOURCE=custom. Points at the web app base URL
  // (e.g. https://app.sportpulse.com).
  CUSTOM_SCRAPER_URL: z.string().url().optional(),
  // Optional bearer token sent to /api/twitter. Set this to match SCRAPER_API_TOKEN
  // in the web server for internal worker access.
  CUSTOM_SCRAPER_TOKEN: z.string().optional(),

  // RapidAPI X scraper. Required when X_SOURCE=rapidapi; optional otherwise so
  // a custom-only deploy can omit the keys entirely.
  RAPIDAPI_KEY: z.string().optional(),
  RAPIDAPI_HOST: z.string().optional(),
  RAPIDAPI_BASE_URL: z.string().url().optional(),
  // {handle} is substituted with the screen name.
  RAPIDAPI_TWEETS_PATH: z.string().default("/user/tweets?username={handle}"),

  // How often the scheduler checks which handles are DUE to poll. Per-handle
  // cadence itself comes from plan_limits.poll_interval_seconds (fastest tier).
  SCRAPER_TICK_INTERVAL_MS: z.coerce.number().default(60_000),
  // Per-handle poll job concurrency.
  SCRAPER_POLL_CONCURRENCY: z.coerce.number().default(2),
  // §7 cost control: cap outbound RapidAPI calls (max requests per window).
  SCRAPER_RATE_MAX: z.coerce.number().default(5),
  SCRAPER_RATE_DURATION_MS: z.coerce.number().default(1_000),
  // Safety cap: don't fan out more than N tweets per handle per cycle.
  SCRAPER_MAX_TWEETS_PER_CYCLE: z.coerce.number().default(5),
});

const refined = schema.superRefine((env, ctx) => {
  if (env.X_SOURCE === "rapidapi") {
    for (const key of ["RAPIDAPI_KEY", "RAPIDAPI_HOST", "RAPIDAPI_BASE_URL"] as const) {
      if (!env[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "required when X_SOURCE=rapidapi" });
    }
  } else if (env.X_SOURCE === "custom" && !env.CUSTOM_SCRAPER_URL) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["CUSTOM_SCRAPER_URL"], message: "required when X_SOURCE=custom" });
  }
});

const parsed = refined.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid scraper environment:\n${issues}`);
}

export const config = parsed.data;
export type Config = typeof config;
