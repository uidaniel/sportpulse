import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-accent text-on-brand shadow-[0_4px_16px_-4px_rgba(37,211,102,0.6)]">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12h3l2.5-6 4 13 2.5-7H21" />
        </svg>
      </span>
      <span className="text-[15px]">
        Sport<span className="text-brand">Pulse</span>
      </span>
    </Link>
  );
}
