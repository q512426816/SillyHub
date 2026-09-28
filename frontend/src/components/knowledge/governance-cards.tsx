/**
 * GovernanceCards — 知识库健康卡（2026-09-27-knowledge-governance-cards 平台出口；
 * 2026-09-28-knowledge-gov-ux 人话改版）。
 *
 * 面向非开发者：每类信号用人话说清「这是什么 / 要不要紧 / 怎么处理」。能机械
 * 处理的给一键按钮（推荐去向预填 + Popconfirm 二次确认 + 完成反馈）；需要逐条
 * 内容判断的（收件箱归类 / rot 复核）不放假按钮，明说建议在 AI 会话里交给助手。
 *
 * 数据链与动作通道不变：GET /knowledge/governance（getKnowledgeGovernance）
 * + POST /knowledge/governance/actions（redomain / repair-paths 白名单）。
 * 分池数据从 pseudo-domain 信号的 detail（「auto-backend 73、…」格式，backend
 * service `_add` 拼装）解析；格式对不上时降级为整卡说明（不渲染分池按钮）。
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileSearch, FolderInput, Inbox, Wrench } from "lucide-react";
import { useState } from "react";

import {
  getKnowledgeGovernance,
  postKnowledgeGovernanceAction,
  type GovernanceSignal,
} from "@/lib/knowledge";
import { Button } from "@/components/ui/button";
import { Popconfirm } from "antd";
import { cn } from "@/lib/utils";

export const governanceQueryKey = (workspaceId: string) => [
  "workspaces",
  workspaceId,
  "knowledge",
  "governance",
];

const SIGNAL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  rot: FileSearch,
  inbox: Inbox,
  "pseudo-domain": FolderInput,
  "binding-unresolved": Wrench,
};

/** 各伪域池的人话名称与推荐归位目标（redomain 白名单动作，目标不存在则新建域文件）。 */
const POOL_META: Record<string, { label: string; target: string }> = {
  "auto-sillyhub-daemon": { label: "daemon 后台服务", target: "daemon" },
  "auto-backend": { label: "后端", target: "backend" },
  "auto-frontend": { label: "前端", target: "frontend" },
  "auto-sillyspec": { label: "SillySpec 集成", target: "sillyspec" },
};

/** 从伪域信号明细（「auto-backend 73、auto-frontend 72、unmapped 699」）解析分池。 */
function parsePools(detail: string): Array<{ domain: string; count: number }> {
  const pools: Array<{ domain: string; count: number }> = [];
  for (const m of detail.matchAll(/([a-z0-9-]+)\s+(\d+)/g)) {
    pools.push({ domain: m[1]!, count: Number(m[2]) });
  }
  return pools;
}

/**
 * 单张信号卡。三类「说明型」信号（rot / inbox / 伪域）统一人话文案；伪域卡在
 * actions_available 时按池渲染一键归位，binding-unresolved 渲染一键修复。
 */
function SignalCard({
  signal,
  workspaceId,
  actionsAvailable,
}: {
  signal: GovernanceSignal;
  workspaceId: string;
  actionsAvailable: boolean;
}) {
  const Icon = SIGNAL_ICONS[signal.kind] ?? AlertTriangle;
  const qc = useQueryClient();
  const [result, setResult] = useState<string | null>(null);
  const [pendingPool, setPendingPool] = useState<string | null>(null);
  const action = useMutation({
    mutationFn: (body: { kind: "repair-paths" | "redomain"; from_domain?: string; to_domain?: string }) =>
      postKnowledgeGovernanceAction(workspaceId, body),
    onSuccess: (r) => {
      setResult(`✅ 已完成。${r.output ? r.output.slice(-160) : ""}`.trim());
      void qc.invalidateQueries({ queryKey: governanceQueryKey(workspaceId) });
    },
    onError: (e: Error) => setResult(`❌ 没成功：${e.message}`),
  });

  const pools = signal.kind === "pseudo-domain" ? parsePools(signal.detail) : [];

  return (
    <div
      data-testid={`governance-card-${signal.kind}`}
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40"
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-medium">{signalTitle(signal.kind)}</span>
        <span className="ml-auto font-mono text-sm text-amber-700 dark:text-amber-300">
          {signal.count}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{signalBody(signal, pools)}</p>

      {signal.kind === "pseudo-domain" && pools.length > 0 ? (
        <div className="mt-2 space-y-1.5" data-testid="governance-pools">
          {pools.map((p) => {
            const meta = POOL_META[p.domain];
            if (p.domain === "unmapped") {
              return (
                <p key={p.domain} className="text-xs text-muted-foreground">
                  · 早期遗留 {p.count} 条 —— 内容跨多个模块、从未被查询用到，放着无害，可以不处理
                </p>
              );
            }
            if (!meta) {
              return (
                <p key={p.domain} className="text-xs text-muted-foreground">
                  · {p.domain} {p.count} 条（暂无推荐去向）
                </p>
              );
            }
            const busy = action.isPending && pendingPool === p.domain;
            return (
              <div key={p.domain} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span>
                  · {meta.label}知识 <b>{p.count}</b> 条 → 建议归入「{meta.target}」
                </span>
                {actionsAvailable ? (
                  <Popconfirm
                    title={`把 ${p.count} 条${meta.label}知识归入「${meta.target}」？`}
                    description="知识条目本身不变，只调整归属分类；改动会写入仓库文件。"
                    okText="确认归位"
                    cancelText="取消"
                    onConfirm={() => {
                      setPendingPool(p.domain);
                      action.mutate({ kind: "redomain", from_domain: p.domain, to_domain: meta.target });
                    }}
                  >
                    <Button data-testid={`redomain-go-${p.domain}`} size="sm" variant="outline" disabled={action.isPending}>
                      <FolderInput className="mr-1 size-3" />
                      {busy ? "归位中…" : "一键归位"}
                    </Button>
                  </Popconfirm>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {signal.kind === "binding-unresolved" && actionsAvailable ? (
        <div className="mt-2" data-testid="governance-actions-binding-unresolved">
          <Popconfirm
            title="自动修复失效的引用路径？"
            description="按当前文件位置重算条目路径，修复失败的不动。"
            okText="一键修复"
            cancelText="取消"
            onConfirm={() => action.mutate({ kind: "repair-paths" })}
          >
            <Button size="sm" variant="outline" disabled={action.isPending} data-testid="repair-paths-btn">
              <Wrench className="mr-1 size-3" />
              {action.isPending ? "修复中…" : "一键修复路径"}
            </Button>
          </Popconfirm>
        </div>
      ) : null}

      {!actionsAvailable && (signal.kind === "binding-unresolved" || signal.kind === "pseudo-domain") ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          一键操作需要该工作区的守护进程在线（当前只读展示）。
        </p>
      ) : null}

      {result ? (
        <p className="mt-1.5 font-mono text-[11px] text-muted-foreground" data-testid="governance-action-result">
          {result}
        </p>
      ) : null}
    </div>
  );
}

/** 人话标题（digest 的 kind → 用户语言；未知 kind 兜底原标题）。 */
function signalTitle(kind: string): string {
  switch (kind) {
    case "pseudo-domain":
      return "知识未归位";
    case "inbox":
      return "经验待归类";
    case "rot":
      return "规则待复核";
    case "binding-unresolved":
      return "引用路径失效";
    default:
      return kind;
  }
}

/** 人话正文：说清要不要紧 + 怎么处理；伪域卡的分池动作在卡片正文中单独渲染。 */
function signalBody(signal: GovernanceSignal, pools: Array<{ domain: string; count: number }>): string {
  switch (signal.kind) {
    case "pseudo-domain":
      return pools.length > 0
        ? `有 ${signal.count} 条知识没归入对应模块，按模块查资料时会漏掉它们。可以逐组归位：`
        : `有 ${signal.count} 条知识没归入对应模块，按模块查资料时会漏掉它们。`;
    case "inbox":
      return `有 ${signal.count} 条开发过程中攒下的经验记录（下方明细）还没归入知识手册。归类要逐条读内容判断，不适合一键完成——建议在 AI 会话里说「帮我把知识收件箱清账」交给助手处理。`;
    case "rot":
      return `有 ${signal.count} 条规则记录很久没被确认过，可能和当前代码有出入（下方为分布）。复核要逐条对照代码，建议分批交给 AI 助手处理，不影响日常使用。`;
    case "binding-unresolved":
      return `有 ${signal.count} 条知识指向的文件位置变了（下方明细），点按钮可自动修复。`;
    default:
      return signal.detail || signal.title;
  }
}

export function GovernanceCards({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: governanceQueryKey(workspaceId),
    queryFn: () => getKnowledgeGovernance(workspaceId),
  });

  if (isLoading) {
    return (
      <section data-testid="governance-cards" className="text-xs text-muted-foreground">
        知识库状态加载中…
      </section>
    );
  }
  if (isError || !data) {
    return (
      <section data-testid="governance-cards" className="text-xs text-muted-foreground">
        知识库状态暂不可用
      </section>
    );
  }

  if (data.healthy) {
    return (
      <section
        data-testid="governance-cards"
        className={cn(
          "rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-800",
          "dark:border-green-800 dark:bg-green-950/40 dark:text-green-300",
        )}
      >
        ✅ 知识库状态良好，无需整理
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">
          底数：待复核 {data.totals.rot ?? 0} · 待归类 {data.totals.inbox ?? 0} · 未归位 {data.totals.pseudo ?? 0}
          {data.totals.unmapped_pool ? ` · 早期遗留 ${data.totals.unmapped_pool}` : ""}
        </span>
      </section>
    );
  }

  return (
    <section data-testid="governance-cards" className="space-y-2">
      <p className="text-xs text-muted-foreground">
        📋 知识库有 {data.signals.length} 项可以整理（不影响日常使用，抽空处理即可）：
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.signals.map((s) => (
          <SignalCard key={s.kind} signal={s} workspaceId={workspaceId} actionsAvailable={data.actions_available ?? false} />
        ))}
      </div>
    </section>
  );
}
