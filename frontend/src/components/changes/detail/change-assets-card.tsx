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
import { fetchSearch } from "@/lib/explorer";

interface ChangeAssetsCardProps {
  workspaceId: string;
  changeId: string;
}

// ── 测试文件路径解析（2026-09-26-assets-testfile-path-resolve / FR-01~02）────
// test-trace 记录的测试文件路径可能是短路径（缺仓库内目录前缀，如
// ``tests/x.py`` 实为 ``backend/app/modules/<m>/tests/x.py``）或反斜杠/``./``
// 写法，归一照知识库页 normalizeKnowledgeFileParam 先例；解析决策是纯函数，
// 由弹窗用 explorer search 的同名命中集驱动。
// 「用例名」注解粘联（2026-09-27-assets-testfile-bracket-note）：sillyspec CLI
// flow done 补全的 tests[] 可能把绑定槽「路径＋用例名」整串收录（如
// ``test/x.mjs「某用例」``，注解在「」内可多段）——归一时剥离，否则 basename
// 连注解进 explorer search 必零命中，恒显「未在仓库中找到」。

/** 记录路径字符串归一（反斜杠→斜杠、去 ``./`` 前缀、剥「用例名」注解段与首尾空白）。 */
export function normalizeTestFilePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/「[^」]*」/g, "")
    .trim();
}

/** 解析决策：resolved=唯一确定路径（redirected=与记录路径不同，需标注）；
 *  candidates=多候选需用户点选；notfound=仓库内无同名命中。 */
export type TestFileResolution =
  | { kind: "resolved"; path: string; redirected: boolean }
  | { kind: "candidates"; paths: string[] }
  | { kind: "notfound" };

/** sillyspec 会话工作树副本前缀——basename 命中时的已知噪音源，排除后再判唯一。 */
const WORKTREE_COPY_PREFIX = ".sillyspec/.runtime/";

/**
 * 归一记录路径 × 同名命中集 → 解析决策。优先级：等值命中（路径原样存在）→
 * 唯一后缀命中（短路径是真实路径的后缀）→ 排除工作树副本后的唯一后缀 → 候选
 * 列表（含命中但结构完全不匹配的场景）。命中集元素同样归一后比较。
 */
export function resolveTestFilePath(
  rawPath: string,
  searchPaths: readonly string[],
): TestFileResolution {
  const norm = normalizeTestFilePath(rawPath);
  if (norm === "") return { kind: "notfound" };
  const hits = searchPaths.map((p) => normalizeTestFilePath(p));
  if (hits.includes(norm)) {
    return { kind: "resolved", path: norm, redirected: false };
  }
  const suffix = hits.filter((p) => p.endsWith(`/${norm}`));
  const pickSingle = (arr: string[]): string | null =>
    arr.length === 1 ? (arr[0] ?? null) : null;
  const onlySuffix = pickSingle(suffix);
  if (onlySuffix !== null) {
    return { kind: "resolved", path: onlySuffix, redirected: true };
  }
  if (suffix.length > 1) {
    const real = suffix.filter((p) => !p.startsWith(WORKTREE_COPY_PREFIX));
    const onlyReal = pickSingle(real);
    if (onlyReal !== null) {
      return { kind: "resolved", path: onlyReal, redirected: true };
    }
    return { kind: "candidates", paths: real.length > 0 ? real : suffix };
  }
  // 无后缀命中：仍有同名命中（路径结构完全不同）→ 交用户选；零命中 → 未找到。
  if (hits.length > 0) {
    const real = hits.filter((p) => !p.startsWith(WORKTREE_COPY_PREFIX));
    return { kind: "candidates", paths: real.length > 0 ? real : hits };
  }
  return { kind: "notfound" };
}

/**
 * 变更详情页 aside「沉淀资产」折叠卡（2026-09-25-change-precipitated-assets /
 * D-001@v1 方案 a）。
 *
 * 本变更经归档沉淀的项目资产只读聚合：FR 索引条目 / 决策蒸馏条目 / 测试绑定
 * 行 / patch 留档统计 / delta 摘要。useQuery 自取数（QuicklogLinkedCard 同款
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
  /** 模块文档预览目标（镜像内相对路径，null = 关）。 */
  const [moduleDoc, setModuleDoc] = useState<string | null>(null);

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
  // 资产透明面（2026-09-26-change-asset-transparency）：知识触达（待复核标记
  // 反查）与模块触达（file_list × 模块图）两组，计数并入卡头统计。
  const touchList = data?.knowledge_touch ?? [];
  const moduleList = data?.touched_modules ?? [];
  const total =
    frCount + decCount + rowCount + (hasAudit ? 1 : 0) + (touchList.length > 0 ? 1 : 0) +
    (moduleList.length > 0 ? 1 : 0);
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

          {/* 知识触达（2026-09-26-change-asset-transparency / FR-01）：本变更知识
              注入命中的知识库条目——按条目内「待复核：<变更名>」标记反查（flow
              done 对触达域打标），覆盖面以标记为准，行点击跳知识库深链。 */}
          {touchList.length > 0 ? (
            <div className="rounded border-border/60 border p-2" data-testid="change-assets-knowledge-touch">
              <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>知识触达（注入命中 · 待复核标记反查）</span>
                <span className="text-[10px] text-muted-foreground/70">
                  {touchList.length} 条
                </span>
              </div>
              {touchList.map((e) => (
                <Link
                  key={`${e.file}#${e.id}`}
                  href={`/workspaces/${workspaceId}/knowledge?file=${encodeURIComponent(
                    e.file ?? "",
                  )}&anchor=${encodeURIComponent(e.id ?? "")}`}
                  title={`打开知识库并定位到 ${e.id}`}
                  className="flex items-baseline gap-2 border-b border-dashed py-1 text-xs last:border-b-0 hover:underline"
                >
                  <span className="font-mono text-[10px] text-violet-700">{e.id}</span>
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
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
                  className="border-b border-dashed py-1 text-xs last:border-b-0"
                >
                  <div className="flex items-baseline gap-2">
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
                  {/* 绑定原文（2026-09-26-assets-test-binding-raw-text / FR-03）：
                      test-trace 摘录截断了 ::用例 后缀，此处显示 requirements 测试
                      绑定槽的手写原文（用例级锚点 + 描述）；原文与 tests 列表等价
                      （纯文件级、无附加信息）时不渲染，避免重复行。 */}
                  {r.raw_binding &&
                  r.raw_binding.trim() !== (r.tests ?? []).join(" ") &&
                  !(r.tests ?? []).some((t) => r.raw_binding?.trim() === t) ? (
                    <p
                      data-testid={`change-assets-test-raw-${r.row_id}`}
                      title={r.raw_binding}
                      className="mt-0.5 truncate pl-1 text-[10px] text-muted-foreground/80"
                    >
                      原文：{r.raw_binding}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {/* 模块触达（FR-02）：交付文件清单 × 镜像模块图匹配的模块；chip 点击
              打开模块文档预览（explorer 读仓库文件，路径确定不走搜索解析）。 */}
          {moduleList.length > 0 ? (
            <div className="rounded border-border/60 border p-2" data-testid="change-assets-touched-modules">
              <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>模块触达</span>
                <span className="text-[10px] text-muted-foreground/70">
                  {moduleList.length} 个模块
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {moduleList.map((m) => (
                  <button
                    key={`${m.project}/${m.id}`}
                    type="button"
                    data-testid={`change-assets-module-${m.id}`}
                    onClick={() => setModuleDoc(m.doc ?? null)}
                    title={m.doc ? `查看模块文档：${m.doc}` : `${m.project}/${m.id}（模块图未登记 doc）`}
                    className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] hover:border-brand-300 hover:bg-brand-50/60"
                  >
                    {m.name || m.id}
                    <span className="ml-1 text-[9px] text-muted-foreground/70">
                      {m.project}
                    </span>
                  </button>
                ))}
              </div>
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

      {/* 测试文件预览弹窗（FR-03）：explorer 取数（仓库文件），与变更文件树同款只读预览。
          路径解析兜底（2026-09-26-assets-testfile-path-resolve / FR-01~02）：记录路径
          先归一，再按文件名走 explorer search 同名命中集驱动 resolveTestFilePath——
          等值/唯一后缀自动用真实路径，多候选列清单点选，零命中中性文案。 */}
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
                <TestFileBody workspaceId={workspaceId} rawPath={testPath} />
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 模块文档预览弹窗（2026-09-26-change-asset-transparency / FR-02）：
          路径确定（镜像内相对 docs/…），explorer 读仓库文件需补 .sillyspec/
          前缀；无 doc 模块 chip 不开弹窗（title 已说明未登记）。 */}
      <Dialog open={moduleDoc !== null} onOpenChange={(v) => !v && setModuleDoc(null)}>
        <DialogContent className="flex h-[80vh] max-w-4xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="text-sm">模块文档</DialogTitle>
            <DialogDescription className="truncate font-mono text-[11px]">
              {moduleDoc}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
              {moduleDoc !== null ? (
                <FilePreview
                  workspaceId={workspaceId}
                  filePath={`.sillyspec/${moduleDoc}`}
                />
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

/**
 * 测试文件弹窗主体（2026-09-26-assets-testfile-path-resolve / FR-01~02）——
 * 按文件名调 explorer search 取同名命中集，resolveTestFilePath 决策后渲染：
 * resolved → FilePreview（真实路径；redirected 时在预览上方标注原记录路径）；
 * candidates → 候选清单点选（选中后转 FilePreview）；notfound / 搜索失败
 * 兜底用原路径直开（FilePreview 展示 explorer 侧真实错误，不吞）。
 */
function TestFileBody({
  workspaceId,
  rawPath,
}: {
  workspaceId: string;
  rawPath: string;
}) {
  const norm = normalizeTestFilePath(rawPath);
  const basename = norm.split("/").filter(Boolean).pop() ?? norm;
  const [chosen, setChosen] = useState<string | null>(null);

  const searchQ = useQuery({
    queryKey: ["changeAssetsTestSearch", workspaceId, basename],
    queryFn: () => fetchSearch(workspaceId, basename),
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (chosen !== null) {
    return <FilePreview workspaceId={workspaceId} filePath={chosen} />;
  }
  if (searchQ.isPending) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        正在仓库中定位测试文件…
      </p>
    );
  }
  if (searchQ.isError) {
    // 搜索通道不可用（daemon 离线/权限等）：退回原路径直开，让 FilePreview
    // 呈现 explorer 侧的真实错误——比「未找到」更诚实（文件可能就在）。
    return <FilePreview workspaceId={workspaceId} filePath={norm} />;
  }

  const resolution = resolveTestFilePath(
    rawPath,
    searchQ.data?.matches.map((m) => m.path) ?? [],
  );
  if (resolution.kind === "resolved") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {resolution.redirected ? (
          <p
            data-testid="change-assets-test-redirect-note"
            className="shrink-0 border-b border-dashed px-2 py-1 text-[10px] text-muted-foreground"
          >
            记录路径「{norm}」未直接命中，已定位到仓库内同名文件：
            <span className="font-mono">{resolution.path}</span>
          </p>
        ) : null}
        <div className="min-h-0 flex-1">
          <FilePreview workspaceId={workspaceId} filePath={resolution.path} />
        </div>
      </div>
    );
  }
  if (resolution.kind === "candidates") {
    return (
      <div className="overflow-auto p-3" data-testid="change-assets-test-candidates">
        <p className="mb-2 text-[11px] text-muted-foreground">
          仓库内有 {resolution.paths.length} 个同名测试文件，请选择要查看的路径：
        </p>
        <ul className="space-y-1">
          {resolution.paths.map((p) => (
            <li key={p}>
              <button
                type="button"
                data-testid={`change-assets-test-candidate-${p}`}
                onClick={() => setChosen(p)}
                className="w-full truncate rounded border px-2 py-1 text-left font-mono text-[11px] hover:border-brand-300 hover:bg-brand-50/60"
                title={p}
              >
                {p}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <p
      data-testid="change-assets-test-notfound"
      className="py-6 text-center text-xs text-muted-foreground"
    >
      未在仓库中找到该测试文件（{rawPath}）——记录路径可能不完整，或文件已被移动/删除。
    </p>
  );
}
