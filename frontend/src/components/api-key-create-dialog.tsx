"use client";

import { useState } from "react";
import { Check, ClipboardCopy, KeyRound, ShieldAlert } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errMessage } from "@/lib/errors";
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
      setError(errMessage(err, "签发失败"));
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
      setError("复制失败，请手动选择明文复制");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl">
        {phase === "form" && (
          <>
            <DialogHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                <KeyRound className="h-5 w-5" />
              </div>
              <DialogTitle>签发 API 密钥</DialogTitle>
              <DialogDescription>
                为守护进程签发长期凭证。明文仅在签发后显示一次，请妥善保存。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  名称
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如 my-macbook-daemon"
                  className="mt-1"
                  maxLength={100}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  过期天数
                </label>
                <Input
                  type="number"
                  min={1}
                  value={expiresDays}
                  onChange={(e) => setExpiresDays(e.target.value)}
                  placeholder="留空表示永不过期，例如 90"
                  className="mt-1"
                />
              </div>
              {error && (
                <div className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={issuing}>
                取消
              </Button>
              <Button onClick={handleSubmit} disabled={issuing || !name.trim()}>
                {issuing ? "签发中..." : "签发"}
              </Button>
            </DialogFooter>
          </>
        )}

        {phase === "plaintext" && issued && (
          <>
            <DialogHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <DialogTitle>API 密钥已签发</DialogTitle>
              <DialogDescription>
                这是该 Key 的唯一一次明文展示。关闭后将无法再次查看。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                请立即复制并保存到安全位置，不要把明文写入日志、聊天或代码仓库。
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  明文密钥
                </label>
                <div className="mt-1 flex gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted px-3 py-2 text-xs">
                    {issued.plaintext}
                  </code>
                  <Button variant="outline" onClick={handleCopy} className="shrink-0 gap-1">
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <ClipboardCopy className="h-4 w-4" />
                    )}
                    {copied ? "已复制" : "复制"}
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-xs sm:grid-cols-3">
                <MetaItem label="名称" value={issued.name} />
                <MetaItem label="前缀" value={`${issued.key_prefix}...`} code />
                <MetaItem
                  label="过期"
                  value={
                    issued.expires_at
                      ? new Date(issued.expires_at).toLocaleString("zh-CN")
                      : "永不过期"
                  }
                />
              </div>

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button onClick={onClose}>我已保存，关闭</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MetaItem({
  label,
  value,
  code = false,
}: {
  label: string;
  value: string;
  code?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground">{label}</div>
      {code ? (
        <code className="mt-0.5 block truncate text-foreground">{value}</code>
      ) : (
        <div className="mt-0.5 truncate font-medium text-foreground">{value}</div>
      )}
    </div>
  );
}
