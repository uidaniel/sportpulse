import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Supabase email verification & magic-link landing.
 *
 * Email link: https://<project>.supabase.co/auth/v1/verify?...&redirect_to=<origin>/auth/callback
 * Supabase verifies the token, then redirects back here with `?code=<...>` (PKCE)
 * which we exchange for a session cookie. On error we surface the message on the
 * login page so the user knows why.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const errorDescription = searchParams.get("error_description") ?? searchParams.get("error");

  if (errorDescription) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorDescription)}`,
    );
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // No code — likely a hash-fragment implicit flow link. Let the client pick up
  // the tokens; bounce to the dashboard and let middleware re-check auth.
  return NextResponse.redirect(`${origin}${next}`);
}
