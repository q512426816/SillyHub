"use client";

/**
 * McpWorkspaceScanModal — workspace .mcp.json 扫描导入弹窗（变更
 * 2026-09-10-mcp-central-registry / task-12 / FR-07，照原型 ⑤ 弹窗段下半）。
 *
 * 两阶段（对齐后端 importer 两阶段）：scan 只读出候选（三色 verdict 徽标）→
 * 勾选 apply 落库。renamed 候选的最终落库名由后端在 apply 时重算
 * （(workspace, 原名) 确定性），前端用同口径 recomputeRenamedName 仅作展示
 * （与 importer.py 逐字对齐，见 mcp-registry.ts 注释）。
 *
 * workspace_id → 名称映射走既有 listWorkspaces（slug 重算需要 workspace 名）。
 * verdict 语义（对齐后端 dedup_key 判定）：new=导入（库中无同名锚）/
 * duplicate=跳过（同名同配置，cmd 归一化后等价）/ renamed=改名（同名异配置，
 * 新名 <名>-<workspace 短名>）。
 */
import { useEffect, useState } from "react";
import { Button, Checkbox, Modal, Select, Spin } from "antd";

import { McpImportResultView } from "@/components/mcp-registry/import-json-modal";
import { errMessage } from "@/lib/errors";
import {
  recomputeRenamedName,
  useApplyMcpWorkspaceImport,
  useScanMcpWorkspaces,
  type McpImportResult,
  type McpImportScope,
  type McpWorkspaceCandidate,
} from "@/lib/api/mcp-registry";
import { listWorkspaces } from "@/lib/workspaces";
import { useQuery } from "@tanstack/react-query";

export interface McpWorkspaceScanModalProps {
  open: boolean;
  isAdmin: boolean;
  onClose: () => void;
}

/** verdict → 徽标形态（对齐原型 .v-import/.v-skip/.v-rename）。 */
const VERDICT_META: Record<
  McpWorkspaceCandidate["dedup_verdict"],
  { label: string; className: string }
> = {
  new: {
    label: "导入",
    className: "border-emerald-300 bg-emerald-50 text-emerald-700",
  },
  duplicate: {
    label: "跳过 · 同名同配置",
    className: "border-border bg-muted text-muted-foreground",
  },
  renamed: {
    label: "改名 · 同名不同配置",
    className: "border-amber-300 bg-amber-50 text-amber-700",
  },
};

export function McpWorkspaceScanModal({ open, isAdmin, onClose }: McpWorkspaceScanModalProps) {
  // workspace 名映射（renamed 展示重算需要；失败不阻断——slug 回退 id 前 6 位）。
  const namesQuery = useQuery({
    queryKey: ["workspaces", "id-name-map"],
    queryFn: async () => {
      const resp = await listWorkspaces({ limit: 500 });
      const map = new Map<string, string>();
      for (const w of resp.items) map.set(String(w.id), w.name);
      return map;
    },
    enabled: open,
    staleTime: 60_000,
  });

  const scan = useScanMcpWorkspaces();
  const apply = useApplyMcpWorkspaceImport();

  const [scope, setScope] = useState<McpImportScope>("mine");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<McpImportResult | null>(null);

  const candidates = scan.data ?? [];

  // 打开即扫描（重新扫描按钮重触发；关闭 reset 清态后再次打开会重扫）。
  useEffect(() => {
    if (open && !scan.data && !scan.isPending && !scan.isError) scan.mutate(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const workspaceName = (id: string): string =>
    namesQuery.data?.get(id) ?? "";

  const renamedDisplay = (c: McpWorkspaceCandidate): string =>
    recomputeRenamedName(c.name, workspaceName(c.workspace_id), c.workspace_id);

  const toggle = (idx: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(idx);
      else next.delete(idx);
      return next;
    });
  };

  const handleApply = () => {
    const picked = candidates.filter((_, i) => selected.has(i));
    if (picked.length === 0) return;
    apply.mutate(
      { candidates: picked, scope },
      {
        onSuccess: (r) => {
          setResult(r);
          setSelected(new Set());
        },
      },
    );
  };

  const close = () => {
    scan.reset();
    apply.reset();
    setResult(null);
    setSelected(new Set());
    onClose();
  };

  return (
    <Modal
      open={open}
      title="从 Workspace 扫描导入"
      onCancel={close}
      width={640}
      destroyOnHidden
      footer={
        result ? (
          <Button type="primary" onClick={close}>
            完成
          </Button>
        ) : (
          <>
            <Button onClick={() => scan.mutate(undefined)} loading={scan.isPending}>
              重新扫描
            </Button>
            <Button
              type="primary"
              disabled={selected.size === 0}
              loading={apply.isPending}
              onClick={handleApply}
            >
              导入所选（{selected.size}）
            </Button>
          </>
        )
      }
    >
      {result ? (
        <McpImportResultView
          result={result}
          extraAction={
            <Button size="small" onClick={() => setResult(null)}>
              返回候选列表
            </Button>
          }
        />
      ) : scan.isPending ? (
        <div className="py-10 text-center" data-testid="mcp-scan-loading">
          <Spin />
          <p className="mt-2 text-xs text-muted-foreground">正在扫描各 workspace 的 .mcp.json…</p>
        </div>
      ) : scan.isError ? (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">
          {errMessage(scan.error, "扫描失败")}
          <Button className="ml-3" size="small" onClick={() => scan.mutate(undefined)}>
            重试
          </Button>
        </div>
      ) : candidates.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          各 workspace 的 .mcp.json 中未发现可导入的 server（或已全部导入）。
        </p>
      ) : (
        <div data-testid="mcp-scan-candidates">
          <p className="mb-2 text-xs text-muted-foreground">
            发现 {candidates.length} 个 server；勾选后导入到
            <Select
              className="mx-2 w-32"
              size="small"
              value={scope}
              disabled={!isAdmin}
              onChange={(v) => setScope(v)}
              options={[
                { value: "mine", label: "我的库（私有）" },
                ...(isAdmin ? [{ value: "platform" as const, label: "平台共享库" }] : []),
              ]}
            />
            。同名判定在 cmd 归一化（剥 cmd /c 包装）后进行。
          </p>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {candidates.map((c, i) => {
              const meta = VERDICT_META[c.dedup_verdict];
              return (
                <div
                  key={`${c.workspace_id}:${c.name}`}
                  className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                  data-testid="mcp-scan-row"
                >
                  <Checkbox
                    checked={selected.has(i)}
                    onChange={(e) => toggle(i, e.target.checked)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {c.name}
                      {c.dedup_verdict === "renamed" && (
                        <span className="text-amber-700"> → {renamedDisplay(c)}</span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      来自 workspace {workspaceName(c.workspace_id) || c.workspace_id.slice(0, 8)}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${meta.className}`}
                  >
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
