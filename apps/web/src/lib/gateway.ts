// Server-only helper to call the WhatsApp gateway's control API with the shared
// bearer token. Never import this into a Client Component.
export async function gatewayFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = process.env.GATEWAY_URL;
  const token = process.env.GATEWAY_API_TOKEN;
  if (!base || !token) {
    throw new Error("GATEWAY_URL / GATEWAY_API_TOKEN are not configured");
  }

  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}
