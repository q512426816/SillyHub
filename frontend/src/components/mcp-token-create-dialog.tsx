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
import {
  createMcpToken,
  type McpTokenCreated,
  type McpScope,
} from "@/lib/mcp-tokens";

type Phase = "form" | "plaintext";

interface Props {
  workspaceId: string;
  onCreated: () => void;
  onClose: () => void;
}

/** scope 选项及其展示标签，顺序即提交时的规范顺序。 */
const SCOPE_OPTIONS: ReadonlyArray<{ value: McpScope; label: string }> = [
  { value: "read", label: "读取 (read)" },
  { value: "dispatch", label: "派发 (dispatch)" },
  { value: "converge", label: "汇聚 (converge)" },
];

export function McpTokenCreateDialog({ workspaceId, onCreated, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("form");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<McpScope[]>(["read", "dispatch"]);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<McpTokenCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const toggleScope = (s: McpScope) => {
    setScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };

  const canSubmit = name.trim().length >= 1 && scopes.length > 0 && !issuing;

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 100) {
      setError("名称长度需为 1 到 100 个字符");
      return;
    }
    if (scopes.length === 0) {
      setError("至少选择一个 scope");
      return;
    }
    setIssuing(true);
    setError(null);
    try {
      // 按规范顺序重组 scope，避免 toggle 顺序影响提交体。
      const orderedScope = SCOPE_OPTIONS.filter((o) =>
        scopes.includes(o.value),
      ).map((o) => o.value);
      const created = await createMcpToken(workspaceId, {
        name: trimmed,
        scope: orderedScope,
      });
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
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选择明文复制");
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        {phase === "form" && (
          <>
            <DialogHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <KeyRound className="h-5 w-5" />
              </div>
              <DialogTitle>签发 MCP 令牌</DialogTitle>
              <DialogDescription>
                为外部客户端签发访问本工作区 MCP 服务的凭据。明文令牌仅在签发后显示一次，请妥善保存。
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
                  placeholder="例如 ci-runner-token"
                  className="mt-1"
                  maxLength={100}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  授权范围（scope）
                </label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {SCOPE_OPTIONS.map((opt) => {
                    const selected = scopes.includes(opt.value);
                    return (
                      <Button
                        key={opt.value}
                        type="button"
                        variant={selected ? "default" : "outline"}
                        size="sm"
                        aria-pressed={selected}
                        onClick={() => toggleScope(opt.value)}
                      >
                        {opt.label}
                      </Button>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  可多选，默认勾选读取与派发。
                </p>
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
              <Button onClick={handleSubmit} disabled={!canSubmit}>
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
              <DialogTitle>MCP 令牌已签发</DialogTitle>
              <DialogDescription>
                这是该令牌的唯一一次明文展示。关闭后将无法再次查看。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                请立即复制并保存到安全位置，不要把明文写入日志、聊天或代码仓库。
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  明文令牌
                </label>
                <div className="mt-1 flex gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted px-3 py-2 text-xs">
                    {issued.token}
                  </code>
                  <Button
                    variant="outline"
                    onClick={handleCopy}
                    className="shrink-0 gap-1"
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <ClipboardCopy className="h-4 w-4" />
                    )}
                    {copied ? "已复制" : "复制"}
                  </Button>
                </div>
              </div>

              <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-xs">
                <MetaItem label="名称" value={issued.name} />
                <MetaItem
                  label="授权范围"
                  value={issued.scope.join("、")}
                />
                <MetaItem
                  label="创建时间"
                  value={new Date(issued.created_at).toLocaleString("zh-CN")}
                />
              </div>

              <div className="space-y-2 rounded-lg border border-border bg-background p-3 text-xs">
                <div className="font-medium text-foreground">连接信息</div>
                <div>
                  <span className="text-muted-foreground">MCP 服务地址</span>
                  <code className="mt-0.5 block truncate text-foreground">
                    http://&lt;后端地址&gt;/mcp
                  </code>
                </div>
                <div className="text-muted-foreground">
                  外部客户端连接时，在 HTTP 请求头里携带
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-foreground">
                    Authorization
                  </code>
                  ；其值的组成为 Bearer 加一个空格再加本令牌，例如把本令牌拼到 Bearer 之后作为该请求头的取值。
                </div>
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
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate font-medium text-foreground">{value}</span>
    </div>
  );
}
