import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gatewayFetch } from "@/lib/gateway";

// Sends a one-off test message to one of the user's OWN channels.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { text, channelJid } = await request.json().catch(() => ({}));
  if (!text || typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Message text is required." }, { status: 400 });
  }
  if (!channelJid || typeof channelJid !== "string") {
    return NextResponse.json({ error: "Channel is required." }, { status: 400 });
  }

  // Verify the channel belongs to this user (don't trust the client).
  const { data: owned } = await supabase
    .from("whatsapp_channels")
    .select("id")
    .eq("user_id", user.id)
    .eq("channel_jid", channelJid)
    .maybeSingle();
  if (!owned) {
    return NextResponse.json({ error: "That channel isn't one of yours." }, { status: 403 });
  }

  try {
    const res = await gatewayFetch(`/sessions/${user.id}/test-send`, {
      method: "POST",
      body: JSON.stringify({ channelJid, text }),
    });
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ error: "gateway unreachable" }, { status: 502 });
  }
}
