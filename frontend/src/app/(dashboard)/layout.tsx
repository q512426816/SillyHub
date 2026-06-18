"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { fetchMe } from "@/lib/auth";
import { useSession } from "@/stores/session";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { hydrated, accessToken } = useSession();

  useEffect(() => {
    if (!hydrated) return;
    if (!accessToken) router.replace("/login");
  }, [hydrated, accessToken, router]);

  useEffect(() => {
    if (!hydrated || !accessToken) return;
    let cancelled = false;
    fetchMe()
      .then(() => {
        if (cancelled) return;
      })
      .catch(() => {
        // Best-effort refresh; if it fails the next API call will handle auth.
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, accessToken]);

  if (!hydrated) return null;
  if (!accessToken) return null;

  return <AppShell>{children}</AppShell>;
}
