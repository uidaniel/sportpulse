import { createClient } from "@/lib/supabase/server";

export async function authorizeInternalOrUser(request: Request): Promise<boolean> {
  const expected = process.env.SCRAPER_API_TOKEN;
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  if (expected && token && token === expected) return true;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return Boolean(user);
}
