"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { hasAdminPermission } from "@/lib/permission";
import { useSession } from "@/stores/session";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { hydrated, user, accessToken } = useSession();
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    if (!hasAdminPermission(user)) {
      setDenied(true);
      router.replace("/");
    }
  }, [hydrated, accessToken, user, router]);

  if (!hydrated) return null;
  if (!accessToken) return null;
  if (denied || !hasAdminPermission(user)) return null;

  return <AppShell>{children}</AppShell>;
}
