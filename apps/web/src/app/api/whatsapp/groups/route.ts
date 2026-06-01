import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gatewayFetch } from "@/lib/gateway";

/**
 * GET = pull the live group list from the gateway and upsert into whatsapp_groups,
 * then return the synced rows. Single endpoint so the dashboard always sees the
 * current state of the connected WhatsApp account's group memberships.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Pull from gateway. If the session isn't connected, fall back to what's
  // already in the DB so the page still renders.
  let groups: { id: string; name: string; isAdmin: boolean }[] = [];
  try {
    const res = await gatewayFetch(`/sessions/${user.id}/groups`);
    const body = (await res.json().catch(() => ({}))) as {
      groups?: { id: string; name: string; isAdmin: boolean }[];
      error?: string;
    };
    if (res.ok && Array.isArray(body.groups)) {
      groups = body.groups;
    }
  } catch {
    /* gateway unreachable — fall back to the persisted list below */
  }

  if (groups.length > 0) {
    // Upsert by (user_id, group_jid). One round-trip per group to keep types
    // simple; the group count per user is bounded by what WhatsApp shows.
    const rows = groups.map((g) => ({
      user_id: user.id,
      group_jid: g.id,
      group_name: g.name,
      is_admin: g.isAdmin,
    }));
    const { error } = await supabase
      .from("whatsapp_groups")
      .upsert(rows, { onConflict: "user_id,group_jid" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return the persisted list (post-sync) so the dashboard has the row UUIDs it
  // needs to wire channel_group_routes against.
  const { data: persisted, error } = await supabase
    .from("whatsapp_groups")
    .select("id, group_jid, group_name, is_admin")
    .eq("user_id", user.id)
    .order("group_name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ groups: persisted ?? [] });
}
