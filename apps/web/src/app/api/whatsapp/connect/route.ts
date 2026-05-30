import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gatewayFetch } from "@/lib/gateway";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Optional: link via phone number (pairing code) instead of QR.
  const { phoneNumber } = await request.json().catch(() => ({}));

  try {
    const res = await gatewayFetch(`/sessions/${user.id}/connect`, {
      method: "POST",
      body: JSON.stringify({ phoneNumber: typeof phoneNumber === "string" ? phoneNumber : undefined }),
    });
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ error: "gateway unreachable" }, { status: 502 });
  }
}
