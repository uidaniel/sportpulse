import { createClient } from "@/lib/supabase/server";
import { WhatsAppConnect } from "@/components/whatsapp-connect";
import { ChannelsManager } from "@/components/channels-manager";

type Status = "disconnected" | "connecting" | "connected" | "logged_out";

export default async function WhatsAppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const { data: session } = await supabase
    .from("whatsapp_sessions")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  const { data: channels } = await supabase
    .from("whatsapp_channels")
    .select("id, channel_jid, channel_name")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  const { data: sub } = await supabase.from("subscriptions").select("tier").eq("user_id", userId).maybeSingle();
  const tier = sub?.tier ?? "free";
  const { data: limit } = await supabase.from("plan_limits").select("max_channels").eq("tier", tier).maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp</h1>
        <p className="text-sm text-muted">Connect your account and manage the channels you post to.</p>
      </div>
      <WhatsAppConnect initialStatus={(session?.status as Status) ?? "disconnected"} />
      <ChannelsManager initialChannels={channels ?? []} maxChannels={limit?.max_channels ?? 1} tier={tier} />
    </div>
  );
}
