"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { login } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@sillyhub.local");
  const [password, setPassword] = useState("admin12345");
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
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-sm rounded-lg border bg-card p-6">
        <h1 className="text-center">登录</h1>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          使用管理员账号访问平台
        </p>

        <form className="mt-5 flex flex-col gap-3" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">邮箱</span>
            <input
              className="h-8 rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">密码</span>
            <input
              type="password"
              className="h-8 rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          {error && (
            <p className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={submitting} className="mt-1 w-full">
            {submitting ? "登录中…" : "登录"}
          </Button>
        </form>
      </section>
    </main>
  );
}
