"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { login } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("Admin123!@#");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace("/workspaces");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="container mx-auto flex min-h-screen max-w-md items-center justify-center px-4 py-12">
      <section className="w-full rounded-lg border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">登录</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          使用管理员账号访问平台 API（task-04a）。
        </p>

        <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1 text-sm">
            邮箱
            <input
              className="h-9 rounded-md border bg-background px-3"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            密码
            <input
              type="password"
              className="h-9 rounded-md border bg-background px-3"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={submitting}>
            {submitting ? "登录中…" : "登录"}
          </Button>
        </form>
      </section>
    </main>
  );
}
