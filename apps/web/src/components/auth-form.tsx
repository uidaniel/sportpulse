"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Button, Input, Label, Spinner } from "@/components/ui-kit";
import { Logo } from "@/components/logo";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? (
        <>
          <Spinner /> Please wait…
        </>
      ) : (
        label
      )}
    </Button>
  );
}

interface AuthFormProps {
  mode: "login" | "signup";
  action: (formData: FormData) => Promise<void>;
  error?: string;
  message?: string;
}

export function AuthForm({ mode, action, error, message }: AuthFormProps) {
  const isLogin = mode === "login";

  return (
    <div className="w-full max-w-md">
      <div className="mb-8 flex justify-center">
        <Logo />
      </div>

      <div className="relative">
        <div className="absolute -inset-1 rounded-3xl bg-brand/10 blur-2xl" />
        <div className="relative rounded-2xl border border-line bg-surface/80 p-8 backdrop-blur-sm">
          <h1 className="text-2xl font-bold tracking-tight">{isLogin ? "Welcome back" : "Create your account"}</h1>
          <p className="mt-1.5 text-sm text-muted">
            {isLogin ? "Sign in to manage your channel." : "Start automating your WhatsApp Channel in minutes."}
          </p>

          <form action={action} className="mt-7 flex flex-col gap-4">
            {message ? (
              <p className="rounded-xl border border-brand/30 bg-brand-soft/50 px-3.5 py-2.5 text-sm text-brand">
                {message}
              </p>
            ) : null}
            {error ? (
              <p className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
                {error}
              </p>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="you@example.com" required autoComplete="email" />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
                minLength={6}
                autoComplete={isLogin ? "current-password" : "new-password"}
              />
            </div>

            <div className="mt-1">
              <SubmitButton label={isLogin ? "Sign in" : "Create account"} />
            </div>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            {isLogin ? (
              <>
                New to SportPulse?{" "}
                <Link href="/signup" className="font-medium text-brand hover:underline">
                  Create an account
                </Link>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <Link href="/login" className="font-medium text-brand hover:underline">
                  Sign in
                </Link>
              </>
            )}
          </p>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-faint">
        <Link href="/" className="hover:text-muted">← Back to home</Link>
      </p>
    </div>
  );
}
