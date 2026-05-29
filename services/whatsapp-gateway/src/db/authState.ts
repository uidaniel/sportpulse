import {
  initAuthCreds,
  BufferJSON,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "baileys";
import { supabase } from "../supabase";
import { logger } from "../logger";

// Baileys auth state persisted in Supabase (whatsapp_auth_state), replacing the
// file-based useMultiFileAuthState. Each Baileys "key" is one row:
//   key = 'creds'           -> the AuthenticationCreds
//   key = `${type}-${id}`   -> a signal key (pre-key, session, etc.)
// Values are round-tripped through BufferJSON so Buffers survive jsonb storage.
//
// IMPORTANT: writes are BATCHED. On connect Baileys persists dozens of keys at
// once; firing one request each saturates the Supabase connection pool and the
// requests time out. We coalesce each set() into a single upsert + single delete.

const log = logger.child({ module: "authState" });

function serialize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}
function deserialize<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), BufferJSON.reviver) as T;
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T | null> {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts) {
        log.error({ err, label }, "supabase auth op failed after retries");
        return null; // never throw: an unhandled rejection here crashes the gateway
      }
      await new Promise((r) => setTimeout(r, 250 * i));
    }
  }
  return null;
}

export interface SupabaseAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clear: () => Promise<void>;
}

export async function useSupabaseAuthState(sessionId: string): Promise<SupabaseAuthState> {
  type Row = { session_id: string; key: string; value: unknown; updated_at: string };

  const upsertRows = (rows: Row[]) =>
    withRetry("upsert", async () => {
      const { error } = await supabase
        .from("whatsapp_auth_state")
        .upsert(rows as never, { onConflict: "session_id,key" });
      if (error) throw error;
    });

  const deleteKeys = (keys: string[]) =>
    withRetry("delete", async () => {
      const { error } = await supabase
        .from("whatsapp_auth_state")
        .delete()
        .eq("session_id", sessionId)
        .in("key", keys);
      if (error) throw error;
    });

  // Read several keys at once -> { key: revivedValue }.
  const readMany = async (keys: string[]): Promise<Record<string, unknown>> => {
    if (keys.length === 0) return {};
    const result = await withRetry("read", async () => {
      const { data, error } = await supabase
        .from("whatsapp_auth_state")
        .select("key, value")
        .eq("session_id", sessionId)
        .in("key", keys);
      if (error) throw error;
      return data ?? [];
    });
    const out: Record<string, unknown> = {};
    for (const row of result ?? []) out[row.key] = deserialize(row.value);
    return out;
  };

  const now = () => new Date().toISOString();

  const credsRow = await readMany(["creds"]);
  const creds: AuthenticationCreds = (credsRow["creds"] as AuthenticationCreds) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const keyNames = ids.map((id) => `${type}-${id}`);
          const rows = await readMany(keyNames);
          const result: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          for (const id of ids) {
            let value = rows[`${type}-${id}`] as SignalDataTypeMap[typeof type] | undefined;
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value as object) as never;
            }
            if (value) result[id] = value;
          }
          return result;
        },
        set: async (data) => {
          const rows: Row[] = [];
          const dels: string[] = [];
          for (const type in data) {
            const category = data[type as keyof typeof data]!;
            for (const id in category) {
              const value = category[id];
              const key = `${type}-${id}`;
              if (value) rows.push({ session_id: sessionId, key, value: serialize(value), updated_at: now() });
              else dels.push(key);
            }
          }
          if (rows.length) await upsertRows(rows);
          if (dels.length) await deleteKeys(dels);
        },
      },
    },
    saveCreds: async () => {
      await upsertRows([{ session_id: sessionId, key: "creds", value: serialize(creds), updated_at: now() }]);
    },
    clear: async () => {
      await withRetry("clear", async () => {
        const { error } = await supabase.from("whatsapp_auth_state").delete().eq("session_id", sessionId);
        if (error) throw error;
      });
    },
  };
}
