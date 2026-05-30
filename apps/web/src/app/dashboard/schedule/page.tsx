import { createClient } from "@/lib/supabase/server";
import { ScheduleSettings } from "@/components/schedule-settings";

export default async function SchedulePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone, schedule_enabled, schedule_start, schedule_end")
    .eq("id", userId)
    .maybeSingle();

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("tier")
    .eq("user_id", userId)
    .maybeSingle();
  const tier = sub?.tier ?? "free";
  const { data: limit } = await supabase
    .from("plan_limits")
    .select("allow_scheduling")
    .eq("tier", tier)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
        <p className="text-sm text-muted">Control the hours when posts are delivered to your channel.</p>
      </div>
      <ScheduleSettings
        userId={userId}
        allowScheduling={limit?.allow_scheduling ?? false}
        initial={{
          enabled: profile?.schedule_enabled ?? false,
          timezone: profile?.timezone ?? "UTC",
          start: profile?.schedule_start ?? "00:00",
          end: profile?.schedule_end ?? "23:59",
        }}
      />
    </div>
  );
}
