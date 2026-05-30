import { AuthForm } from "@/components/auth-form";
import { signIn } from "@/app/auth/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <AuthForm mode="login" action={signIn} error={error} message={message} />
    </main>
  );
}
