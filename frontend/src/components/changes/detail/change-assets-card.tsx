"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { message } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { FilePreview } from "@/components/explorer/file-preview";
import { DiffView, ScopeAuditRepoSeg } from "@/components/files/structured-views";
import { EntryCardList } from "@/components/knowledge/entry-card-list";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getChangeAssets, getChangePatchFile, syncChangeHits } from "@/lib/changes";
import { fetchSearch } from "@/lib/explorer";
import { getKnowledge, normalizeKnowledgeFileParam } from "@/lib/knowledge";

interface ChangeAssetsCardProps {
  workspaceId: string;
  changeId: string;
  /**
   * 变更 key（``2026-10-14-xxx`` 形态，详情页从 ChangeRead 透传）。FR/决策行的
   * 深链 anchor 用它拼「变更号#决策号」复合形态——聚合决策文件里多个变更各有
   * 同名决策号（decisions/unmapped.md 实证），裸 id 首卡误命中（
   * 2026-10-14-decision-anchor-change-qualified）。缺省退化为裸 id 旧路径。
   */
  changeKey?: string;
  /**
   * 变更是否已归档（页面层传 `isTerminalChange(change)`）。
   * 2026-10-15-change-detail-redesign / D-001@v1 + D-016@v1：两态互斥与「归档态
   * 归档留档保底渲染」需要归档判定在**首帧取数失败时同样可用**（失败时无
   * `query.data`，无法从响应推导）——缺省回退读响应的 `archived` 字段，兼容
   * 既有调用点与测试。
   */
  archived?: boolean;
}

/** 知识条目预览目标：file=spec 树相对路径（深链原样），anchor=条目 id（可选）。 */
interface KnowledgePreviewTarget {
  file: string;
  anchor?: string;
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
//
// 用例锚四形态剥锚（2026-09-30-assets-testfile-nodeid-anchor）：tests[] 条目
// 按 2026-09-26-binding-anchor-fidelity 契约带锚原样收录，锚共四形态（「」组 /
// ``::`` / ``#`` / ``>``），文件面消费须剥锚——「」沿用既有全局剥离（注解文本
// 可含锚界符字符，先剥防误切），``::``/``#``/``>`` 取首个界符前路径段；锚后
// 粘联的全角括号注解残段（flow done 按空白切 token 的截断形，实证
// ``…::test_x（documents``）与闭合形一并剥。不剥的后果：整串进 basename 必
// 零命中（本轮实证：2026-09-30-title-adopt-clobber-guard 归档件 pytest 节点
// ID 串全部误报未找到）。

/** 记录路径字符串归一（反斜杠→斜杠、去 ``./`` 前缀、剥「用例名」注解段与
 *  ``::``/``#``/``>`` 用例锚、去尾部粘联全角括号注解残段与首尾空白）。 */
export function normalizeTestFilePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/「[^」]*」/g, "")
    .split(/::|#|>/)[0]
    ?.replace(/（[^）]*）?$/, "")
    .trim() ?? "";
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
 * - 测试绑定行：测试文件路径可点，弹窗内走 explorer 的 FilePreview 读仓库内
 *   文件本体（测试文件在仓库里、不在 spec 镜像里，变更文件树读不到）；行首锚点
 *   标注「变更内」——它是该变更 requirements.md 的 FR 编号，与知识库 FR 索引
 *   条目（FR-<域>-NNN）不是同一套 id，原文只显示 row_id 片段时极易误认；
 * - 归档留档：除统计外列出 change-patch.json 的文件清单，点某文件看它在
 *   change.patch 中的红绿 diff 切片（后端切片，冻结在收尾时点——与范围对账的
 *   实时窗口锚不同源，故不复用范围对账的单文件比对弹窗）。
 *
 * 知识类条目弹窗预览（2026-10-14-assets-knowledge-popup-preview / FR-01~03）：
 * FR 索引 / 决策蒸馏 / 知识触达三组行点击不再整页跳知识库，改为弹窗展示条目
 * 具体内容（KnowledgePreviewBody：getKnowledge + EntryCardList + 锚点定位），
 * 弹窗头部「在知识库中打开」保留原 file+anchor 深链跳转能力。
 */
/** 每组默认直接显示的行数上限（超出折叠，见 GroupToggle）。 */
const GROUP_VISIBLE_LIMIT = 5;

/**
 * 分组卡片统一限高容器（2026-10-28-change-detail-side-assets-scroll / 用户裁决）：
 * 各组卡片固定最大高度（h-64=256px，2026-10-15-change-detail-redesign 改造前的
 * 历史高度值），内容超出在组内滚动——替代「自然高度 + 5 行 + 展开全部」把页面
 * 拉长的形态；标题行与展开按钮 shrink-0 钉在卡片上下边缘，仅中间列表滚动。
 */
const GROUP_CARD_CLS = "flex max-h-64 flex-col rounded border border-border/60 p-2";

/** 分组内容滚动区（与 GROUP_CARD_CLS 配套）：min-h-0 + flex-1 让滚动只发生在本区。 */
const GROUP_BODY_CLS = "mt-1 min-h-0 flex-1 overflow-y-auto pr-0.5";

/**
 * hits-sync 回执 reason → 用户可读文案（2026-10-27-knowledge-hits-flush-button /
 * FR-04）。机读短码对齐 backend ChangeHitsSyncResult docstring 口径；in_flight
 * 单列（ok=true 的去重秒回，提示而非报错语义）。
 */
const HITS_SYNC_REASON_TEXT: Record<string, string> = {
  no_binding: "本工作区未绑定机器，无法读取本机遥测数据",
  daemon_offline: "绑定的机器不在线，开机联网后重试",
  rpc_timeout: "机器响应超时，可稍后重试",
  rpc_remote_error: "机器上的 daemon 版本过旧（不支持遥测同步），更新 daemon 后重试",
  runtime_offline: "机器运行时不在线，稍后重试",
  upload_failed: "本机上行失败（详情见 daemon 日志），稍后重试",
  bad_receipt: "机器返回了无法识别的回执",
  exception: "同步过程出现未知错误",
};

/** 分组折叠开关：超出上限时给「展开全部 N 条」，展开后给「收起」。 */
function GroupToggle({
  total,
  expanded,
  onToggle,
  unit = "条",
}: {
  total: number;
  expanded: boolean;
  onToggle: () => void;
  unit?: string;
}) {
  if (total <= GROUP_VISIBLE_LIMIT && !expanded) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid="change-assets-group-toggle"
      className="mt-1 shrink-0 self-start text-[10px] text-muted-foreground hover:underline"
    >
      {expanded ? "收起" : `展开全部 ${total} ${unit} ▾`}
    </button>
  );
}

export function ChangeAssetsCard({
  workspaceId,
  changeId,
  changeKey,
  archived: archivedProp,
}: ChangeAssetsCardProps) {
  const query = useQuery({
    queryKey: ["changeAssets", workspaceId, changeId],
    queryFn: () => getChangeAssets(workspaceId, changeId),
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 2026-09-28-change-ux-detail-batch：默认展开（用户裁决）——卡随本变更移入
  // 详情页主栏宽列，折叠态默认值不再是侧栏窄列的防噪手段。
  const [open, setOpen] = useState(true);
  // 归档判定：显式 prop 优先（首帧失败也可判定），否则回退响应字段（兼容既有调用点）。
  const isArchived = archivedProp ?? query.data?.archived === true;

  // 2026-10-15-change-detail-redesign / FR-06 / D-001@v1：分组由「固定高度 + 组内
  // 滚动」改为「自然高度 + 每组最多直接显示 5 行 + 展开全部」——多个内滚小窗是原卡片
  // 「乱」的主要来源（每个分组自带滚动条，扫读要逐个滚）。
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  const isExpanded = (key: string) => expandedGroups[key] === true;
  const cap = <T,>(list: T[] | undefined, key: string): T[] => {
    const items = list ?? [];
    return isExpanded(key) ? items : items.slice(0, GROUP_VISIBLE_LIMIT);
  };
  /** 测试文件预览目标（null = 关）。 */
  const [testPath, setTestPath] = useState<string | null>(null);
  /** 归档留档 diff 目标（null = 关）。repo 在场 = 跨仓切片（2026-10-19-cross-repo-patch-slicing）。 */
  const [patchFile, setPatchFile] = useState<{ path: string; repo?: string } | null>(null);
  /** 模块文档预览目标（镜像内相对路径，null = 关）。 */
  const [moduleDoc, setModuleDoc] = useState<string | null>(null);
  // 知识条目预览目标（2026-10-14-assets-knowledge-popup-preview）：FR 索引 /
  // 决策蒸馏 / 知识触达三组行点击在此弹出内容预览（不再整页跳知识库），弹窗头
  // 部保留原深链跳转。null = 关。
  const [knowledgeTarget, setKnowledgeTarget] =
    useState<KnowledgePreviewTarget | null>(null);
  // FR/决策行深链 anchor：变更号#决策号 复合形态（changeKey 缺省退裸 id）——
  // 聚合决策文件里同 id 跨变更重复，裸 id 首卡误命中
  // （2026-10-14-decision-anchor-change-qualified）。
  const qualifiedAnchor = (id: string) => (changeKey ? `${changeKey}#${id}` : id);

  const patchQ = useQuery({
    queryKey: ["changePatchFile", workspaceId, changeId, patchFile?.path, patchFile?.repo ?? null],
    queryFn: () =>
      getChangePatchFile(workspaceId, changeId, patchFile!.path, patchFile!.repo),
    enabled: patchFile !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 「同步变更」按钮（2026-10-27-knowledge-hits-flush-button / FR-04）：触发绑定
  // daemon 强制上行一轮本机注入命中遥测（sillyspec_hits_flush）——「知识触达」
  // 数据源 knowledge_hits 断流后的手动补数入口。回执全形态结构化（HTTP 恒 200），
  // 网络层异常才走 catch；成功后 invalidate 与主查询同 key，沉淀资产卡整体刷新。
  const queryClient = useQueryClient();
  const [hitsSyncing, setHitsSyncing] = useState(false);
  const onSyncHits = async () => {
    if (hitsSyncing) return;
    setHitsSyncing(true);
    try {
      const r = await syncChangeHits(workspaceId, changeId);
      if (r.triggered && r.ok) {
        message.success(
          r.reason === "in_flight"
            ? "同步已在进行中（已防重复触发）"
            : "同步完成：本机知识遥测已上报，沉淀资产已刷新",
        );
        await queryClient.invalidateQueries({
          queryKey: ["changeAssets", workspaceId, changeId],
        });
      } else if (r.triggered) {
        message.error(
          HITS_SYNC_REASON_TEXT[r.reason ?? ""] ?? `同步失败：${r.reason ?? "未知原因"}`,
        );
      } else {
        message.warning(
          HITS_SYNC_REASON_TEXT[r.reason ?? ""] ?? `未触发同步：${r.reason ?? "未知原因"}`,
        );
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "同步请求失败");
    } finally {
      setHitsSyncing(false);
    }
  };

  // 2026-10-15-change-detail-redesign / D-016@v1（Grill B-3）：主查询失败不再整卡
  // `return null`（那会让归档态的降级路径「产出 → 归档留档」无解释地断掉），改为
  // **卡头保留 + 分区级错误说明**；归档态额外渲染「归档留档」分区壳与重试入口。
  // 说明：归档留档的 patch 摘要与文件清单与主查询同源（同一端点），失败时无法凭空
  // 呈现数据；故保底语义落为「分区在场 + 明示不可用 + 可重试」，不留静默空白。
  if (query.isError) {
    return (
      <section data-testid="change-assets-card" className="rounded-md border bg-card">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <h2 className="text-xs font-medium">📦 沉淀资产</h2>
        </div>
        <div className="flex flex-col gap-2 px-3 py-2">
          <p data-testid="change-assets-error" className="text-[11px] text-destructive">
            沉淀资产暂不可用。
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="ml-2 text-[11px] text-primary hover:underline"
            >
              重试
            </button>
          </p>
          {isArchived ? (
            <div
              data-testid="change-assets-audit-fallback"
              className="rounded border border-border/60 p-2 text-[11px] text-muted-foreground"
            >
              <div className="text-[11px] font-medium">归档留档</div>
              <p className="mt-1">
                改动面数据暂不可用（与沉淀资产同一数据源）；点上方「重试」重新拉取，
                或到「变更文件」查看改动文件树。
              </p>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  const data = query.data;
  const frCount = data?.fr_entries?.length ?? 0;
  const decCount = data?.decisions?.length ?? 0;
  const rowCount = data?.test_rows?.length ?? 0;
  const hasAudit = Boolean(data?.patch || data?.delta);
  // 资产透明面（2026-09-26-change-asset-transparency）：知识触达（执行期
  // inject 遥测命中，在途/归档同源——2026-10-09-knowledge-touch-marker-sunset
  // 统一口径）与模块触达（file_list × 模块图）两组，计数并入卡头统计。
  const touchList = data?.knowledge_touch ?? [];
  // 触达分形（2026-10-09-knowledge-touch-marker-sunset）：整文件路由（id==file
  // 裸条目）收拢为 chip 行；锚点条目按文件分组——48 行平铺噪声的主要来源。
  const touchFileChips = touchList.filter((e) => !e.id || e.id === e.file);
  const touchByFile = new Map<string, typeof touchList>();
  for (const e of touchList) {
    if (!e.id || e.id === e.file) continue;
    const key = e.file ?? "";
    const bucket = touchByFile.get(key);
    if (bucket) bucket.push(e);
    else touchByFile.set(key, [e]);
  }
  const touchGroups = [...touchByFile.entries()];
  const moduleList = data?.touched_modules ?? [];
  const total =
    frCount + decCount + rowCount + (hasAudit ? 1 : 0) + (touchList.length > 0 ? 1 : 0) +
    (moduleList.length > 0 ? 1 : 0);
  const patchFileList = data?.patch?.file_list ?? [];
  // 跨仓冻结面（2026-10-19-change-assets-cross-repo-repos）：空面跨仓冻结只落
  // change-patch.json（无 change.patch），主仓 files 为 0——真实交付面在这组元数据；
  // 完整 diff 正文不进资产卡（可达数 MB），指路全屏预览。
  const crossRepos = data?.patch?.repos ?? [];

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
        <>
        {/* 同步变更操作行（2026-10-27-knowledge-hits-flush-button / FR-04）：
            卡头整块是折叠按钮（button 不能嵌 button），操作位落展开区顶部
            右对齐独立行——知识触达断流时的手动补数入口，常驻不随分组空态
            隐藏（归档变更 total>0 但知识触达空的断流形态无空态文案可挂）。 */}
        <div className="flex justify-end px-3 pt-2">
          <button
            type="button"
            onClick={() => void onSyncHits()}
            disabled={hitsSyncing}
            data-testid="change-assets-hits-sync"
            title="把本机执行期的知识注入命中遥测上报平台，补齐「知识触达」（需绑定的机器在线）"
            className="shrink-0 rounded-full border border-border/60 px-2.5 py-0.5 text-[10px] text-muted-foreground hover:border-brand-300 hover:bg-brand-50/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {hitsSyncing ? "同步中…" : "同步变更"}
          </button>
        </div>
        {/* 2026-09-28-change-ux-detail-batch：分组改网格（md 两列对齐）+ 每组
           固定高度 h-64（超出组内滚动）——主栏宽列下的可扫读形态，替代侧栏
           窄列的纵向长堆叠。空态段跨满两列。 */}
        <div className="grid grid-cols-1 gap-2 px-3 py-2 md:grid-cols-2">
          {/* 知识图谱已改由「产出」面板独立挂载（2026-10-15-change-detail-redesign /
              D-003@v1：图谱脱离资产卡内嵌，画布高度不再受卡内网格挤压）。 */}

          {data && !data.archived && total === 0 ? (
            <p
              data-testid="change-assets-inflight"
              className="py-3 text-center text-[11px] text-muted-foreground md:col-span-2"
            >
              执行中的知识注入命中会实时出现在「知识触达」；FR / 决策 / 测试绑定与留档在归档后汇总。
            </p>
          ) : null}

          {data && data.archived && total === 0 ? (
            <p className="py-3 text-center text-[11px] text-muted-foreground md:col-span-2">
              本变更暂无沉淀资产记录。
            </p>
          ) : null}

          {frCount > 0 ? (
            <div className={GROUP_CARD_CLS} data-testid="change-assets-fr">
              <div className="flex shrink-0 items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>需求规则（FR 索引）</span>
                <span className="text-[10px] text-muted-foreground/70">knowledge/fr</span>
              </div>
              <div className={GROUP_BODY_CLS}>
              {cap(data?.fr_entries, "fr").map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() =>
                    setKnowledgeTarget({ file: e.file, anchor: qualifiedAnchor(e.id) })
                  }
                  title={`查看 ${e.id} 条目内容（弹窗内可再跳知识库）`}
                  className="flex w-full items-baseline gap-2 border-b border-dashed py-1 text-left text-xs last:border-b-0 hover:underline"
                >
                  <span className="font-mono text-[10px] text-brand-700">{e.id}</span>
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  {e.status ? (
                    <span className="rounded-full bg-emerald-50 px-1.5 text-[10px] text-emerald-700">
                      {e.status}
                    </span>
                  ) : null}
                </button>
              ))}
              </div>
              <GroupToggle
                total={frCount}
                expanded={isExpanded("fr")}
                onToggle={() => toggleGroup("fr")}
              />
            </div>
          ) : null}

          {decCount > 0 ? (
            <div className={GROUP_CARD_CLS} data-testid="change-assets-decisions">
              <div className="flex shrink-0 items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>决策蒸馏</span>
                <span className="text-[10px] text-muted-foreground/70">
                  knowledge/decisions
                </span>
              </div>
              <div className={GROUP_BODY_CLS}>
              {cap(data?.decisions, "decisions").map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() =>
                    setKnowledgeTarget({ file: d.file, anchor: qualifiedAnchor(d.id) })
                  }
                  title={`查看 ${d.id} 条目内容（弹窗内可再跳知识库）`}
                  className="flex w-full items-baseline gap-2 border-b border-dashed py-1 text-left text-xs last:border-b-0 hover:underline"
                >
                  <span className="font-mono text-[10px] text-cyan-700">{d.id}</span>
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  {d.status ? (
                    <span className="rounded-full bg-emerald-50 px-1.5 text-[10px] text-emerald-700">
                      {d.status}
                    </span>
                  ) : null}
                </button>
              ))}
              </div>
              <GroupToggle
                total={decCount}
                expanded={isExpanded("decisions")}
                onToggle={() => toggleGroup("decisions")}
              />
            </div>
          ) : null}

          {/* 知识触达（2026-09-26-change-asset-transparency / FR-01；2026-10-09-
              knowledge-touch-marker-sunset 口径统一）：本变更执行期 CLI 知识注入
              命中的知识库条目（knowledge_hits inject 遥测），在途/归档同源同文案
              （在途随执行增长、归档后定格）。整文件路由收拢 chip 行、锚点条目按
              文件分组；行点击弹窗预览条目内容（2026-10-14-assets-knowledge-popup-
              preview），弹窗内可再跳知识库。 */}
          {touchList.length > 0 ? (
            <div className={GROUP_CARD_CLS} data-testid="change-assets-knowledge-touch">
              <div className="flex shrink-0 items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span title="本变更执行期 CLI 知识注入的命中留痕：在途变更随执行增长，归档后定格（唯一口径——注入命中即留痕，不另设标记复核面）">
                  知识触达（本变更注入命中的知识）
                </span>
                <span className="text-[10px] text-muted-foreground/70">
                  {touchList.length} 条
                </span>
              </div>
              <div className={GROUP_BODY_CLS}>
                {touchFileChips.length > 0 ? (
                  <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 border-b border-dashed pb-1.5">
                    <span className="text-[10px] text-muted-foreground/70">整文件</span>
                    {touchFileChips.map((e) => (
                      <button
                        key={`chip-${e.file}`}
                        type="button"
                        onClick={() => setKnowledgeTarget({ file: e.file ?? "" })}
                        title={`查看文件 ${e.file}（整文件路由注入）`}
                        className="rounded-full border border-border/60 bg-muted/40 px-1.5 py-px font-mono text-[10px] hover:border-brand-300 hover:bg-brand-50/60"
                      >
                        {e.file}
                      </button>
                    ))}
                  </div>
                ) : null}
                {cap(touchGroups, "touch").map(([file, entries]) => (
                  <div
                    key={file}
                    data-testid={`change-assets-touch-group-${file}`}
                    className="border-b border-dashed py-1 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => setKnowledgeTarget({ file })}
                      title={`查看文件 ${file}`}
                      className="font-mono text-[10px] text-muted-foreground hover:underline"
                    >
                      {file}
                      <span className="ml-1 font-sans text-[9px] text-muted-foreground/70">
                        （{entries.length}）
                      </span>
                    </button>
                    {entries.map((e) => (
                      <button
                        key={`${e.file}#${e.id}`}
                        type="button"
                        onClick={() =>
                          setKnowledgeTarget({ file: e.file ?? "", anchor: e.id || undefined })
                        }
                        title={`查看 ${e.id} 条目内容（弹窗内可再跳知识库）`}
                        className="flex w-full items-baseline gap-2 py-0.5 pl-2 text-left text-xs hover:underline"
                      >
                        {/* 同 slug 只显示一份（2026-10-09：live 行 id==title，双栏连排两遍是噪声） */}
                        {e.id === e.title ? (
                          <span className="min-w-0 flex-1 truncate">{e.title}</span>
                        ) : (
                          <>
                            <span className="font-mono text-[10px] text-violet-700">{e.id}</span>
                            <span className="min-w-0 flex-1 truncate">{e.title}</span>
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <GroupToggle
                total={touchGroups.length}
                expanded={isExpanded("touch")}
                onToggle={() => toggleGroup("touch")}
                unit="个文件分组"
              />
            </div>
          ) : null}

          {rowCount > 0 ? (
            <div className={GROUP_CARD_CLS} data-testid="change-assets-tests">
              <div className="flex shrink-0 items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>测试绑定</span>
                <span className="text-[10px] text-muted-foreground/70">test-trace</span>
              </div>
              <div className={GROUP_BODY_CLS}>
              {cap(data?.test_rows, "tests").map((r) => (
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
              <GroupToggle
                total={rowCount}
                expanded={isExpanded("tests")}
                onToggle={() => toggleGroup("tests")}
              />
            </div>
          ) : null}

          {/* 模块触达（FR-02）：交付文件清单 × 镜像模块图匹配的模块；chip 点击
              打开模块文档预览（explorer 读仓库文件，路径确定不走搜索解析）。 */}
          {moduleList.length > 0 ? (
            <div className={GROUP_CARD_CLS} data-testid="change-assets-touched-modules">
              <div className="flex shrink-0 items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>模块触达</span>
                <span className="text-[10px] text-muted-foreground/70">
                  {moduleList.length} 个模块
                </span>
              </div>
              <div className={`${GROUP_BODY_CLS} flex flex-wrap content-start gap-1.5`}>
                {cap(moduleList, "modules").map((m) => (
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
              <GroupToggle
                total={moduleList.length}
                expanded={isExpanded("modules")}
                onToggle={() => toggleGroup("modules")}
                unit="个模块"
              />
            </div>
          ) : null}

          {hasAudit && data && isArchived ? (
            <div className={`${GROUP_CARD_CLS} text-[11px] text-muted-foreground`} data-testid="change-assets-audit">
              <div className="shrink-0 text-[11px] font-medium">归档留档</div>
              <div className="mt-1 flex shrink-0 flex-wrap gap-x-3 gap-y-1">
                {data.patch ? (
                  <span>
                    {/* 跨仓条目在场时显式标「主仓」，避免与各仓计数并读成同一口径。 */}
                    {crossRepos.length > 0 ? "主仓 " : ""}patch{" "}
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
              {/* 限高滚动区（2026-10-28-change-detail-side-assets-scroll）：跨仓
                  区与文件清单一并滚，标题与统计行钉在卡片上部。 */}
              <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
              {crossRepos.length > 0 ? (
                <div
                  className="mt-1.5 flex flex-col gap-1.5 border-t border-dashed pt-1.5"
                  data-testid="change-assets-cross-repos"
                >
                  <div className="flex shrink-0 items-center justify-between gap-2 text-[10px] text-muted-foreground/70">
                    <span>跨仓冻结面（完整 diff 见 change-patch.json 全屏预览）</span>
                  </div>
                  {crossRepos.map((r) => (
                    <ScopeAuditRepoSeg
                      key={r.key}
                      repoKey={r.key}
                      repo={{
                        key: r.key,
                        anchor: r.anchor
                          ? {
                              source: r.anchor.source ?? null,
                              base: r.anchor.base ?? null,
                              head: r.anchor.head ?? null,
                              label: r.anchor.label ?? null,
                            }
                          : null,
                        totals: r.totals
                          ? {
                              files: r.totals.files ?? 0,
                              additions: r.totals.additions ?? 0,
                              deletions: r.totals.deletions ?? 0,
                              planned: r.totals.planned ?? 0,
                              unplanned: r.totals.unplanned ?? 0,
                              untouched: r.totals.untouched ?? 0,
                            }
                          : null,
                        degraded: r.degraded,
                        degradedReason: r.degraded_reason ?? null,
                        patchSha256: r.patch_sha256 ?? null,
                      }}
                    />
                  ))}
                  {/* 仓内文件清单（2026-10-19-cross-repo-patch-slicing FR-02）：
                      后端从 repos[].patch 头解析投影——点开走 patch-file?repo=… 切片。 */}
                  {crossRepos.some((r) => (r.file_list?.length ?? 0) > 0) ? (
                    <ul data-testid="change-assets-cross-repo-files" className="mt-1 space-y-1">
                      {crossRepos.map((r) =>
                        (r.file_list?.length ?? 0) > 0 ? (
                          <li key={r.key}>
                            <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground/70">
                              <span>{r.key} 改动文件（点开看该仓冻结 diff）</span>
                              {r.files_truncated ? (
                                <span className="shrink-0 text-warning">清单已截断</span>
                              ) : null}
                            </div>
                            <ul>
                              {cap(r.file_list ?? [], `cross-${r.key}`).map((p) => (
                                <li key={p} className="border-b border-dashed last:border-b-0">
                                  <button
                                    type="button"
                                    data-testid={`change-assets-cross-repo-file-${r.key}-${p}`}
                                    onClick={() => setPatchFile({ path: p, repo: r.key })}
                                    title={`查看 ${p} 在跨仓 ${r.key} 冻结 patch 中的 diff`}
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
                            <GroupToggle
                              total={r.file_list?.length ?? 0}
                              expanded={isExpanded(`cross-${r.key}`)}
                              onToggle={() => toggleGroup(`cross-${r.key}`)}
                              unit="个文件"
                            />
                          </li>
                        ) : null,
                      )}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {patchFileList.length > 0 ? (
                <div className="mt-1.5 flex min-h-0 flex-1 flex-col overflow-hidden border-t border-dashed pt-1.5">
                  <div className="mb-1 flex shrink-0 items-center justify-between gap-2 text-[10px] text-muted-foreground/70">
                    <span>改动文件（点开看该文件在 change.patch 中的 diff）</span>
                    {data.patch?.files_truncated ? (
                      <span className="shrink-0 text-warning">清单已截断</span>
                    ) : null}
                  </div>
                  <ul
                    data-testid="change-assets-patch-files"
                    className="mt-1"
                  >
                    {cap(patchFileList, "audit").map((p) => (
                      <li key={p} className="border-b border-dashed last:border-b-0">
                        <button
                          type="button"
                          data-testid={`change-assets-patch-file-${p}`}
                          onClick={() => setPatchFile({ path: p })}
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
                  {/* 2026-10-19-assets-audit-expand-toggle：六组统一「最多 5 行 +
                      展开全部」形态漏了本组——大清单被钉死在前 5 条且无展开。 */}
                  <GroupToggle
                    total={patchFileList.length}
                    expanded={isExpanded("audit")}
                    onToggle={() => toggleGroup("audit")}
                    unit="个文件"
                  />
                </div>
              ) : null}
              </div>
            </div>
          ) : null}
        </div>
        </>
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
      <Dialog open={patchFile !== null} onOpenChange={(v) => !v && setPatchFile(null)}>
        <DialogContent className="flex h-[80vh] max-w-5xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="text-sm">归档留档 · 单文件 diff</DialogTitle>
            <DialogDescription className="truncate font-mono text-[11px]">
              {patchFile?.repo ? `跨仓 ${patchFile.repo} · ${patchFile.path}` : patchFile?.path} ·
              {patchFile?.repo
                ? " change-patch.json scopeAudit.repos[]（收尾时点冻结）"
                : " change.patch（收尾时点冻结）"}
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
      {/* 知识条目预览弹窗（2026-10-14-assets-knowledge-popup-preview / FR-01~03）：
          FR 索引 / 决策蒸馏 / 知识触达三组行点击在此展示条目具体内容——getKnowledge
          取全文 + EntryCardList 条目卡渲染 + 锚点定位，与知识库页卡片视图同源同
          渲染器；头部「在知识库中打开」保留原 file+anchor 深链（弹窗内可跳转）。 */}
      <Dialog
        open={knowledgeTarget !== null}
        onOpenChange={(v) => !v && setKnowledgeTarget(null)}
      >
        <DialogContent className="flex h-[80vh] max-w-4xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3">
            <div className="flex items-center justify-between gap-3 pr-6">
              <DialogTitle className="text-sm">知识条目</DialogTitle>
              {knowledgeTarget !== null ? (
                <Link
                  href={`/workspaces/${workspaceId}/knowledge?file=${encodeURIComponent(
                    knowledgeTarget.file,
                  )}${
                    knowledgeTarget.anchor
                      ? `&anchor=${encodeURIComponent(knowledgeTarget.anchor)}`
                      : ""
                  }`}
                  title="在知识库页打开并定位到该条目"
                  className="shrink-0 text-[11px] text-brand-600 hover:underline"
                >
                  在知识库中打开
                </Link>
              ) : null}
            </div>
            <DialogDescription className="truncate font-mono text-[11px]">
              {knowledgeTarget?.file}
              {knowledgeTarget?.anchor ? `#${knowledgeTarget.anchor}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
            {knowledgeTarget !== null ? (
              <KnowledgePreviewBody
                workspaceId={workspaceId}
                file={knowledgeTarget.file}
                anchor={knowledgeTarget.anchor}
                onJumpToEntry={(jumpFile, jumpAnchor) =>
                  setKnowledgeTarget({ file: jumpFile, anchor: jumpAnchor })
                }
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/**
 * 知识条目预览弹窗主体（2026-10-14-assets-knowledge-popup-preview / FR-01~02）——
 * file 先经 normalizeKnowledgeFileParam 归一（lib 单一源，与知识库页深链落位同
 * 一套前缀容错），再 getKnowledge 取全文交 EntryCardList 渲染（zone 取自响应，
 * 缺省 top）；带锚点时内容落定后按 data-entry-anchor 滚到目标条目卡，查无该卡
 * 静默落文件级顶部（降级兼容旧锚/改名小节，同知识库页深链口径）。取数失败就
 * 近展示错误文案（不吞），弹窗头部深链不受影响。onJumpToEntry 承接条目卡互跳
 * （依据决策 / INDEX 路由行），由调用方切换预览目标。
 */
function KnowledgePreviewBody({
  workspaceId,
  file,
  anchor,
  onJumpToEntry,
}: {
  workspaceId: string;
  file: string;
  anchor?: string;
  onJumpToEntry?: (filename: string, anchor?: string) => void;
}) {
  const filename = normalizeKnowledgeFileParam(file);
  const q = useQuery({
    queryKey: ["changeAssetsKnowledgePreview", workspaceId, filename],
    queryFn: () => getKnowledge(workspaceId, filename),
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 锚点条目卡定位：effect 在内容渲染提交后执行，DOM 已就绪，单次查询即可
  // （无需知识库页深链的有界 rAF 重试——那是外部入口跨提交时序的防抖）。
  // anchor 带「变更号#决策号」复合形态（FR/决策行）时优先按复合属性精确匹配
  // （聚合决策文件同 id 跨变更重复，裸锚首卡误命中）；查无退裸锚——兜底键必须
  // 剥掉变更号前缀（裸属性值域恒为 文件#id，带前缀查等于死选择器，评审 P1 实证
  // 2026-10-14-decision-anchor-change-qualified）。
  useEffect(() => {
    if (!q.isSuccess || !anchor) return;
    const key = `${filename}#${anchor}`;
    const bareKey = anchor.includes("#")
      ? `${filename}#${anchor.split("#").slice(1).join("#")}`
      : key;
    const el =
      (anchor.includes("#")
        ? document.querySelector(`[data-entry-anchor-qualified="${CSS.escape(key)}"]`)
        : null) ?? document.querySelector(`[data-entry-anchor="${CSS.escape(bareKey)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [q.isSuccess, anchor, filename]);

  if (q.isPending) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        正在加载知识条目…
      </p>
    );
  }
  if (q.isError) {
    return (
      <p className="py-6 text-center text-xs text-destructive">
        {q.error instanceof Error ? q.error.message : "加载失败"}
      </p>
    );
  }
  return (
    <EntryCardList
      filename={filename}
      zone={q.data.zone || "top"}
      content={q.data.content ?? ""}
      // 弹窗内条目卡互跳（依据决策 / INDEX 路由行）：经回调切换预览目标，
      // 不留空操作死链。
      onJumpToEntry={onJumpToEntry}
      className="max-h-full overflow-y-auto pr-1"
    />
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
