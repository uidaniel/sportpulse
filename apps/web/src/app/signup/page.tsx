import { AuthForm } from "@/components/auth-form";
import { signUp } from "@/app/auth/actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <AuthForm mode="signup" action={signUp} error={error} message={message} />
    </main>
  );
}
