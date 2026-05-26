"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { useSession } from "@/stores/session";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { hydrated, accessToken } = useSession();

  useEffect(() => {
    if (!hydrated) return;
    if (!accessToken) router.replace("/login");
  }, [hydrated, accessToken, router]);

  if (!hydrated) return null;
  if (!accessToken) return null;

  return <AppShell>{children}</AppShell>;
}
