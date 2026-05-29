import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";
import type { Database } from "./types/database.types";

// Service-role client: bypasses RLS so the scraper can read every tenant's
// feed configs and write handle polling state. Server-only; never shipped to a client.
export const supabase: SupabaseClient<Database> = createClient<Database>(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
