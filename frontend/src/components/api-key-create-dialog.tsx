"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { createApiKey, type ApiKeyCreated } from "@/lib/api-keys";

type Phase = "form" | "plaintext";

interface Props {
  onCreated: () => void;
  onClose: () => void;
}

export function ApiKeyCreateDialog({ onCreated, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("form");
  const [name, setName] = useState("");
  const [expiresDays, setExpiresDays] = useState<string>("");
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<ApiKeyCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("名称必填");
      return;
    }
    setIssuing(true);
    setError(null);
    try {
      const days = expiresDays ? Number(expiresDays) : null;
      const expiresAt =
        days && Number.isFinite(days) && days > 0
          ? new Date(Date.now() + days * 86_400_000).toISOString()
          : null;
      const created = await createApiKey({ name: name.trim(), expires_at: expiresAt });
      setIssued(created);
      setPhase("plaintext");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "签发失败");
    } finally {
      setIssuing(false);
    }
  };

  const handleCopy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API 在非 HTTPS 不可用，忽略
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-background p-5 shadow-lg">
        {phase === "form" && (
          <>
            <h2 className="text-base font-semibold">签发 API Key</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              为 daemon 进程签发长期凭证。Plaintext 仅在签发后显示一次，请妥善保存。
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[11px] text-muted-foreground">名称（便于识别用途）</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如 my-macbook-daemon"
                  className="mt-0.5"
                  maxLength={100}
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">
                  过期天数（留空 = 永不过期）
                </label>
                <Input
                  type="number"
                  min={1}
                  value={expiresDays}
                  onChange={(e) => setExpiresDays(e.target.value)}
                  placeholder="例如 90"
                  className="mt-0.5"
                />
              </div>
              {error && (
                <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={issuing}>
                取消
              </Button>
              <Button size="sm" onClick={handleSubmit} disabled={issuing || !name.trim()}>
                {issuing ? "签发中…" : "签发"}
              </Button>
            </div>
          </>
        )}

        {phase === "plaintext" && issued && (
          <>
            <h2 className="text-base font-semibold">API Key 已签发</h2>
            <div className="mt-3 rounded border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              ⚠️ 这是该 Key 的唯一一次明文显示。关闭后将无法再次查看，请立即复制保存。
            </div>

            <div className="mt-3">
              <label className="text-[11px] text-muted-foreground">Plaintext（一次性）</label>
              <div className="mt-1 flex gap-2">
                <code className="flex-1 overflow-x-auto rounded border bg-muted px-2 py-1.5 text-xs">
                  {issued.plaintext}
                </code>
                <Button size="sm" onClick={handleCopy}>
                  {copied ? "已复制" : "复制"}
                </Button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">名称：</span>
                {issued.name}
              </div>
              <div>
                <span className="text-muted-foreground">前缀：</span>
                <code>{issued.key_prefix}…</code>
              </div>
              <div>
                <span className="text-muted-foreground">过期：</span>
                {issued.expires_at
                  ? new Date(issued.expires_at).toLocaleString("zh-CN")
                  : "永不过期"}
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <Button size="sm" onClick={onClose}>
                我已保存，关闭
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
