"use client";

/**
 * 2026-10-30-provider-user-share：供应商属主侧共享弹窗。
 *
 * 按 username / email 精确添加 grantee（不做模糊搜索，避免用户枚举），列出当前
 * 共享并支持撤销。只出现在设置页「我的供应商」卡片，被共享方看不到本入口；
 * 其会话页只能从 /usable 列表选择（只读）。
 */

import { useCallback, useEffect, useState } from "react";
import { Trash2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  listProviderShares,
  shareProvider,
  unshareProvider,
  type LlmProviderRead,
  type LlmProviderShareRead,
} from "@/lib/api/llm-providers";
import { errMessage, useNotify } from "@/lib/errors";

function granteeLabel(share: LlmProviderShareRead): string {
  return share.display_name || share.username || share.user_id;
}

export function ShareProviderDialog({
  provider,
  onOpenChange,
}: {
  provider: LlmProviderRead | null;
  onOpenChange: (_open: boolean) => void;
}) {
  const notify = useNotify();
  const open = provider !== null;
  const [shares, setShares] = useState<LlmProviderShareRead[]>([]);
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!provider) return;
    setLoading(true);
    setError(null);
    try {
      setShares(await listProviderShares(provider.id));
    } catch (err) {
      setError(errMessage(err, "加载共享列表失败"));
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    if (!open) return;
    setIdentifier("");
    setShares([]);
    void load();
  }, [open, load]);

  const handleAdd = async () => {
    const value = identifier.trim();
    if (!provider || !value || busy) return;
    setBusy(true);
    try {
      const created = await shareProvider(provider.id, value);
      setShares((prev) =>
        prev.some((s) => s.user_id === created.user_id) ? prev : [...prev, created],
      );
      setIdentifier("");
      notify.success("已共享");
    } catch (err) {
      notify.error(err, "共享失败");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!provider || busy) return;
    setBusy(true);
    try {
      await unshareProvider(provider.id, userId);
      setShares((prev) => prev.filter((s) => s.user_id !== userId));
      notify.success("已撤销共享");
    } catch (err) {
      notify.error(err, "撤销共享失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>共享供应商{provider ? ` · ${provider.name}` : ""}</DialogTitle>
          <DialogDescription>
            被共享用户只能在会话配置条中选择该供应商，不能编辑、删除、设默认或查看额度。
            注意：共享后，该供应商的访问密钥会以解密形式下发到会话实际运行的守护进程（包括对方自己的机器），请仅共享给可信用户。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="用户名或邮箱（精确匹配）"
            aria-label="共享目标用户名或邮箱"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAdd();
              }
            }}
          />
          <Button
            size="sm"
            className="h-9 shrink-0 gap-1"
            disabled={busy || identifier.trim().length === 0}
            onClick={() => void handleAdd()}
          >
            <UserPlus className="h-3.5 w-3.5" />
            共享
          </Button>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="max-h-64 space-y-1.5 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-muted-foreground">加载中…</p>
          ) : shares.length === 0 ? (
            <p className="text-xs text-muted-foreground">尚未共享给任何用户。</p>
          ) : (
            shares.map((share) => (
              <div
                key={share.user_id}
                className="flex items-center gap-2 rounded border bg-card px-2 py-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 truncate">
                  {granteeLabel(share)}
                  {share.username && share.display_name && (
                    <span className="ml-1 text-muted-foreground">
                      @{share.username}
                    </span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={busy}
                  onClick={() => void handleRemove(share.user_id)}
                >
                  <Trash2 className="h-3 w-3" />
                  撤销
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
