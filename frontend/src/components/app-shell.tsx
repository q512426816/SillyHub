"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useSession } from "@/stores/session";

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, accessToken, refreshToken, clear } = useSession();

  const displayName = useMemo(() => {
    if (!user) return "用户";
    return user.displayName || user.email;
  }, [user]);

  const onLogout = async () => {
    // Best-effort logout; regardless of response we clear client state.
    try {
      if (refreshToken) {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: accessToken ? `Bearer ${accessToken}` : "",
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      }
    } finally {
      clear();
      router.replace("/login");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="font-semibold">Multi-Agent Platform</div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">{displayName}</div>
          <Button variant="outline" onClick={onLogout}>
            退出
          </Button>
        </div>
      </header>
      {children}
    </div>
  );
}

