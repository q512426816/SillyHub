"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { FilePreview } from "@/components/explorer/file-preview";
import { DiffView } from "@/components/files/structured-views";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getChangeAssets, getChangePatchFile } from "@/lib/changes";

interface ChangeAssetsCardProps {
  workspaceId: string;
  changeId: string;
}

/**
 * 变更详情页 aside「沉淀资产」折叠卡（2026-09-25-change-precipitated-assets /
 * D-001@v1 方案 a）。
 *
 * 本变更经归档沉淀的项目资产只读聚合：FR 索引条目 / 决策蒸馏条目 / 测试绑定
 * 行 / patch 留档统计 / delta 摘要。useQuery 自取数（ChangeEventsCard 同款
 * 范式）+ 失败静默隐藏；四组逐组「有数据才渲染」（design fail-open）；
 * 在途变更（archived=false）显示引导空态（design R-03 对应展示面）。
 * 纯展示零业务逻辑，无 mutation。
 *
 * 可用性修复（2026-09-25-change-detail-assets-usability / FR-01~04）——三处
 * 「点了看不到东西」各自补齐落点：
 * - FR/决策索引行：href 带 `?file=&anchor=`（file 为 spec 树相对路径，知识库页
 *   做前缀归一后选中文件并滚动到该条目卡）；
 * - 测试绑定行：测试文件路径可点，弹窗内走 explorer 的 FilePreview 读仓库内
 *   文件本体（测试文件在仓库里、不在 spec 镜像里，变更文件树读不到）；行首锚点
 *   标注「变更内」——它是该变更 requirements.md 的 FR 编号，与知识库 FR 索引
 *   条目（FR-<域>-NNN）不是同一套 id，原文只显示 row_id 片段时极易误认；
 * - 归档留档：除统计外列出 change-patch.json 的文件清单，点某文件看它在
 *   change.patch 中的红绿 diff 切片（后端切片，冻结在收尾时点——与范围对账的
 *   实时窗口锚不同源，故不复用范围对账的单文件比对弹窗）。
 */
export function ChangeAssetsCard({ workspaceId, changeId }: ChangeAssetsCardProps) {
  const query = useQuery({
    queryKey: ["changeAssets", workspaceId, changeId],
    queryFn: () => getChangeAssets(workspaceId, changeId),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const [open, setOpen] = useState(false);
  /** 测试文件预览目标（null = 关）。 */
  const [testPath, setTestPath] = useState<string | null>(null);
  /** 归档留档 diff 目标（null = 关）。 */
  const [patchPath, setPatchPath] = useState<string | null>(null);

  const patchQ = useQuery({
    queryKey: ["changePatchFile", workspaceId, changeId, patchPath],
    queryFn: () => getChangePatchFile(workspaceId, changeId, patchPath!),
    enabled: patchPath !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 失败静默：区块隐藏（不影响详情主内容）。
  if (query.isError) return null;

  const data = query.data;
  const frCount = data?.fr_entries?.length ?? 0;
  const decCount = data?.decisions?.length ?? 0;
  const rowCount = data?.test_rows?.length ?? 0;
  const hasAudit = Boolean(data?.patch || data?.delta);
  const total = frCount + decCount + rowCount + (hasAudit ? 1 : 0);
  const patchFileList = data?.patch?.file_list ?? [];

  return (
    <section
      data-testid="change-assets-card"
      className="rounded-md border bg-card"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-state={open ? "open" : "closed"}
        className="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left"
      >
        <h2 className="flex items-center gap-1.5 text-xs font-medium">
          📦 沉淀资产
          {total > 0 && (
            <span className="rounded-full border border-brand-300 bg-brand-50 px-2 py-px text-[10px] font-medium text-brand-700">
              FR {frCount} · 决策 {decCount}
            </span>
          )}
        </h2>
        <span className="text-[10px] text-muted-foreground">
          {open ? "收起 ▲" : "展开 ▼"}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 px-3 py-2">
          {data && !data.archived && total === 0 ? (
            <p
              data-testid="change-assets-inflight"
              className="py-3 text-center text-[11px] text-muted-foreground"
            >
              变更归档后，此处会汇总其沉淀的 FR / 决策 / 测试绑定与留档。
            </p>
          ) : null}

          {data && data.archived && total === 0 ? (
            <p className="py-3 text-center text-[11px] text-muted-foreground">
              本变更暂无沉淀资产记录。
            </p>
          ) : null}

          {frCount > 0 ? (
            <div className="rounded border-border/60 border p-2" data-testid="change-assets-fr">
              <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>需求规则（FR 索引）</span>
                <span className="text-[10px] text-muted-foreground/70">knowledge/fr</span>
              </div>
              {data?.fr_entries?.map((e) => (
                <Link
                  key={e.id}
                  href={`/workspaces/${workspaceId}/knowledge?file=${encodeURIComponent(
                    e.file,
                  )}&anchor=${encodeURIComponent(e.id)}`}
                  title={`打开知识库并定位到 ${e.id}`}
                  className="flex items-baseline gap-2 border-b border-dashed py-1 text-xs last:border-b-0 hover:underline"
                >
                  <span className="font-mono text-[10px] text-brand-700">{e.id}</span>
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  {e.status ? (
                    <span className="rounded-full bg-emerald-50 px-1.5 text-[10px] text-emerald-700">
                      {e.status}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          ) : null}

          {decCount > 0 ? (
            <div className="rounded border-border/60 border p-2" data-testid="change-assets-decisions">
              <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>决策蒸馏</span>
                <span className="text-[10px] text-muted-foreground/70">
                  knowledge/decisions
                </span>
              </div>
              {data?.decisions?.map((d) => (
                <Link
                  key={d.id}
                  href={`/workspaces/${workspaceId}/knowledge?file=${encodeURIComponent(
                    d.file,
                  )}&anchor=${encodeURIComponent(d.id)}`}
                  title={`打开知识库并定位到 ${d.id}`}
                  className="flex items-baseline gap-2 border-b border-dashed py-1 text-xs last:border-b-0 hover:underline"
                >
                  <span className="font-mono text-[10px] text-cyan-700">{d.id}</span>
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  {d.status ? (
                    <span className="rounded-full bg-emerald-50 px-1.5 text-[10px] text-emerald-700">
                      {d.status}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          ) : null}

          {rowCount > 0 ? (
            <div className="rounded border-border/60 border p-2" data-testid="change-assets-tests">
              <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>测试绑定</span>
                <span className="text-[10px] text-muted-foreground/70">test-trace</span>
              </div>
              {data?.test_rows?.map((r) => (
                <div
                  key={r.row_id}
                  className="flex items-baseline gap-2 border-b border-dashed py-1 text-xs last:border-b-0"
                >
                  <span
                    className="shrink-0 font-mono text-[10px] text-muted-foreground"
                    title="变更内锚点：对应本变更 requirements.md 的 FR 编号（与知识库 FR 索引条目 FR-<域>-NNN 不是同一套 id）"
                  >
                    变更内{" "}
                    {r.anchor ??
                      (r.row_id.split(":").slice(1, 3).join(":") || r.row_id)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left">
                    {(r.tests ?? []).map((t, i) => (
                      <span key={t}>
                        {i > 0 ? <span className="text-muted-foreground/50"> ｜ </span> : null}
                        <button
                          type="button"
                          data-testid={`change-assets-test-file-${t}`}
                          onClick={() => setTestPath(t)}
                          title={`查看测试文件内容：${t}`}
                          className="rounded text-muted-foreground underline-offset-2 hover:text-brand-700 hover:underline"
                        >
                          {t}
                        </button>
                      </span>
                    ))}
                  </span>
                  {r.state ? (
                    <span className="shrink-0 rounded-full bg-amber-50 px-1.5 text-[10px] text-amber-700">
                      {r.state}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {hasAudit && data ? (
            <div className="rounded border-border/60 border p-2 text-[11px] text-muted-foreground" data-testid="change-assets-audit">
              <div className="mb-1 text-[11px] font-medium">归档留档</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {data.patch ? (
                  <span>
                    patch{" "}
                    <b className="text-foreground">
                      {data.patch.files ?? "?"} 文件 +{data.patch.additions ?? "?"}/−
                      {data.patch.deletions ?? "?"}
                    </b>
                  </span>
                ) : null}
                {data.delta ? (
                  <span>
                    delta{" "}
                    <b className="text-foreground">
                      Before {data.delta.before_lines ?? "?"} 行 / Delta{" "}
                      {data.delta.delta_lines ?? "?"} 行
                    </b>
                  </span>
                ) : null}
              </div>
              {patchFileList.length > 0 ? (
                <div className="mt-1.5 border-t border-dashed pt-1.5">
                  <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground/70">
                    <span>改动文件（点开看该文件在 change.patch 中的 diff）</span>
                    {data.patch?.files_truncated ? (
                      <span className="shrink-0 text-warning">清单已截断</span>
                    ) : null}
                  </div>
                  <ul
                    data-testid="change-assets-patch-files"
                    className="max-h-40 overflow-auto"
                  >
                    {patchFileList.map((p) => (
                      <li key={p} className="border-b border-dashed last:border-b-0">
                        <button
                          type="button"
                          data-testid={`change-assets-patch-file-${p}`}
                          onClick={() => setPatchPath(p)}
                          title={`查看 ${p} 在 change.patch 中的 diff`}
                          className="flex w-full items-baseline gap-2 py-1 text-left hover:underline"
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-foreground">
                            {p}
                          </span>
                          <span className="shrink-0 text-[10px] text-brand-700">看 diff</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {/* 测试文件预览弹窗（FR-03）：explorer 取数（仓库文件），与变更文件树同款只读预览。 */}
      <Dialog open={testPath !== null} onOpenChange={(v) => !v && setTestPath(null)}>
        <DialogContent className="flex h-[80vh] max-w-4xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="text-sm">测试文件</DialogTitle>
            <DialogDescription className="truncate font-mono text-[11px]">
              {testPath}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
              {testPath !== null ? (
                <FilePreview workspaceId={workspaceId} filePath={testPath} />
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 归档留档单文件 diff 弹窗（FR-04）：冻结 patch 切片，非实时窗口。 */}
      <Dialog open={patchPath !== null} onOpenChange={(v) => !v && setPatchPath(null)}>
        <DialogContent className="flex h-[80vh] max-w-5xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="text-sm">归档留档 · 单文件 diff</DialogTitle>
            <DialogDescription className="truncate font-mono text-[11px]">
              {patchPath} · change.patch（收尾时点冻结）
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
            {patchQ.isPending ? (
              <p className="py-6 text-center text-xs text-muted-foreground">读取中…</p>
            ) : patchQ.isError ? (
              <p className="py-6 text-center text-xs text-destructive">
                {patchQ.error instanceof Error ? patchQ.error.message : "读取失败"}
              </p>
            ) : patchQ.data?.note ? (
              <p
                data-testid="change-assets-patch-note"
                className="py-6 text-center text-xs text-muted-foreground"
              >
                {patchQ.data.note}
              </p>
            ) : patchQ.data?.diff ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                {patchQ.data.truncated ? (
                  <p className="mb-1 shrink-0 text-[11px] text-warning">
                    该文件 diff 过大，仅显示前 200k 字符。
                  </p>
                ) : null}
                <DiffView content={patchQ.data.diff} />
              </div>
            ) : (
              <p className="py-6 text-center text-xs text-muted-foreground">
                该文件在 change.patch 中无 diff。
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
