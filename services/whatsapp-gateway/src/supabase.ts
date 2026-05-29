import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";
import type { Database } from "./types/database.types";

// Service-role client: bypasses RLS. This process is trusted infrastructure,
// never exposed to end users. The key must never reach the browser.
export const supabase: SupabaseClient<Database> = createClient<Database>(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
