"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui-kit";
import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard/whatsapp", label: "WhatsApp" },
  { href: "/dashboard/feeds", label: "Feeds" },
  { href: "/dashboard/schedule", label: "Schedule" },
];

export function MobileNav({ email }: { email?: string | null }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => setMounted(true), []);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Portal to <body> so the fixed overlay isn't trapped by the header's
  // backdrop-filter (which would create a containing block for position:fixed).
  const drawer = (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="absolute left-0 top-0 flex h-full w-72 max-w-[80%] flex-col border-r border-line bg-surface p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <Logo href="/dashboard" />
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="mt-6 flex flex-col gap-1">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-2 hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-line pt-4">
          {email ? <p className="mb-3 truncate text-sm text-muted">{email}</p> : null}
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      {open && mounted ? createPortal(drawer, document.body) : null}
    </div>
  );
}
