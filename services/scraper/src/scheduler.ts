import { Queue } from "bullmq";
import { bullConnection } from "./queue/connection";
import { supabase } from "./supabase";
import { logger } from "./logger";

const log = logger.child({ module: "scheduler" });

export const POLL_QUEUE = "x-poll";

export interface PollJobData {
  handleId: string;
  screenName: string;
}

export const pollQueue = new Queue<PollJobData>(POLL_QUEUE, { connection: bullConnection });

/**
 * FR-4.1 + §7: enqueue one poll job per UNIQUE handle that is DUE now. Each
 * handle's cadence is the fastest tier among its active subscribers (computed in
 * the due_handles() SQL function). jobId `poll-<id>` dedups, so a slow cycle never
 * lets the next tick pile up duplicate jobs for the same handle.
 */
export async function enqueueDueHandles(): Promise<number> {
  const { data, error } = await supabase.rpc("due_handles");
  if (error) {
    log.error({ err: error }, "due_handles failed");
    return 0;
  }

  const handles = (data ?? []).filter(
    (h): h is { id: string; screen_name: string; poll_interval_seconds: number } =>
      Boolean(h.id && h.screen_name),
  );

  for (const h of handles) {
    await pollQueue.add(
      "poll-handle",
      { handleId: h.id, screenName: h.screen_name },
      { jobId: `poll-${h.id}`, removeOnComplete: true, removeOnFail: 100 },
    );
  }

  return handles.length;
}
