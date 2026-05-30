import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gatewayFetch } from "@/lib/gateway";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const res = await gatewayFetch(`/sessions/${user.id}/state`);
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ error: "gateway unreachable" }, { status: 502 });
  }
}
