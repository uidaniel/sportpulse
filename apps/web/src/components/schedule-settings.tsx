"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Input, Label, Toggle, Spinner } from "@/components/ui-kit";

interface Props {
  userId: string;
  allowScheduling: boolean;
  initial: { enabled: boolean; timezone: string; start: string; end: string };
}

function detectedZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function zoneList(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

export function ScheduleSettings({ userId, allowScheduling, initial }: Props) {
  const [supabase] = useState(() => createClient());
  const [enabled, setEnabled] = useState(initial.enabled);
  const [timezone, setTimezone] = useState(initial.timezone === "UTC" ? detectedZone() : initial.timezone);
  const [start, setStart] = useState(initial.start.slice(0, 5));
  const [end, setEnd] = useState(initial.end.slice(0, 5));
  const [saving, setSaving] = useState(false);
  const zones = zoneList();

  if (!allowScheduling) {
    return (
      <Card className="p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-semibold">Scheduling is a Pro feature</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Set active hours so posts only go out when you want — overnight posts are held and
          delivered when your window reopens. Upgrade to Pro to unlock it.
        </p>
      </Card>
    );
  }

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ schedule_enabled: enabled, timezone, schedule_start: start, schedule_end: end })
      .eq("id", userId);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Schedule saved.");
  };

  return (
    <Card className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Active hours</h2>
          <p className="mt-1 text-sm text-muted">
            When on, posts only deliver inside your window. Off-hours posts are held and released
            when it reopens.
          </p>
        </div>
        <Toggle id="sched" checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div className={enabled ? "space-y-4" : "space-y-4 opacity-50 pointer-events-none"}>
        <div className="grid gap-2">
          <Label htmlFor="tz">Timezone</Label>
          <Input
            id="tz"
            list="tzlist"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="e.g. Europe/London"
          />
          <datalist id="tzlist">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="start">Start</Label>
            <Input id="start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="end">End</Label>
            <Input id="end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-faint">
          Example: 05:00 → 22:00 posts only during the day; anything from @handles overnight arrives
          at 05:00.
        </p>
      </div>

      <div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Spinner /> : null} Save schedule
        </Button>
      </div>
    </Card>
  );
}
