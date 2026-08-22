"use client";

/**
 * NewSessionForm — 新建会话四选择器联动表单（2026-08-14-sessions-portal task-12）。
 *
 * 依据：
 *   - tasks/task-12.md（allowed_paths / implementation / acceptance）
 *   - design.md §2 FR-01、§5 Wave3 NewSessionForm 段、D-005 / D-010 / D-013
 *   - prototype-sessions-portal.html renderNewForm（视觉/交互语义）
 *   - FRONTEND_PAGE_STYLE.md（antd 组件 + tailwind 变量、Badge/Tag、空值 —）
 *
 * 四选择器联动（D-010）：
 *   ① 守护进程（必选，仅在线）：useDaemonMachines；默认=localStorage 上次选择
 *      → 最近会话的在线机器 → 最新心跳（D-005）。
 *   ② 智能体（必选）：选中机器 runtimes 过滤在线 + provider∈{claude,codex}；
 *      默认 Claude Code；不支持的 provider 置灰「暂不支持会话」；切机器重置选择。
 *   ③ 供应商（可选）：listProviders + 「不指定（本机默认）」；engine≠claude 锁定
 *      （Codex 引擎无会话级供应商）。
 *   ④ 档案（可选）：useMineAgentProfiles 跨工作区聚合，不做引擎过滤（D-013）；
 *      Codex 智能体下选项标注「人格暂不支持」。
 *
 * 提交：createSession({ runtime_id, agent_profile_id?, llm_provider_id?, prompt,
 * manual_approval: true, ask_user_only: true })；未选项不进请求体（task-16 契约，
 * daemon.ts createSession 对 undefined 字段不下发）。成功后经 props 回调交给父层
 * （页面组装归 task-10，本组件不管路由/SSE）。
 *
 * 锁定绑定（2026-08-22-workspace-sessions-portal task-05 / FR-02 / FR-03）：
 *   - 可选 bindWorkspaceId：传入即锁定工作区——第⓪区不渲染
 *     WorkspaceSessionPicker（换锁定提示条），workspaceId 直接初始为绑定值且
 *     不存在被改写的路径（不走 handleWsChange 用户选择链路）；
 *   - 可选 bindChangeId：createSession 在 workspace_id 之外加 change_id 双传
 *     （change 级隐含 workspace 双传，先例 daemon/session-panel.tsx:2347）；
 *   - 缺省（两参均不传）表单行为零变化，四选择器联动与默认机器三级回退保留。
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Button, Input, Select, Spin, Tag } from "antd";
import { ApiError } from "@/lib/api";
import { NO_PROFILE_VALUE, useMineAgentProfiles } from "@/lib/agent-profiles";
import { listProviders } from "@/lib/api/llm-providers";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import {
  createSession,
  PROVIDER_META,
  type AgentSessionRead,
  type DaemonMachineRead,
  type DaemonRuntimeRead,
  type SessionCreateResponse,
} from "@/lib/daemon";
import { WorkspaceSessionPicker } from "./workspace-session-picker";

/** 默认机器记住上次选择（D-005 第一级回退）的 localStorage key。 */
export const NEW_SESSION_MACHINE_LS_KEY = "sillyhub.sessions.new.machineId";

/** 支持交互式会话的引擎（provider）白名单。 */
const SESSION_SUPPORTED_PROVIDERS = new Set(["claude", "codex"]);

/** 供应商 Select「不指定（本机默认）」占位值（不进请求体）。 */
export const NO_PROVIDER_VALUE = "";

/** task-12 provides 契约：表单当前四选择器 + 消息值（随 onCreated 回调透出）。 */
export interface NewSessionFormValues {
  workspaceId: string | null;
  machineId: string | null;
  agentId: string | null;
  providerId: string;
  profileId: string;
  prompt: string;
}

export interface NewSessionFormProps {
  /** 会话创建成功回调（父层接手 SSE/页面切换，本组件不感知路由）。 */
  onCreated?: (_session: SessionCreateResponse, _values: NewSessionFormValues) => void;
  /**
   * task-05（2026-08-22-workspace-sessions-portal / FR-02）：锁定绑定工作区。
   * 传入即隐藏 WorkspaceSessionPicker，createSession 的 workspace_id 恒传绑定值。
   */
  bindWorkspaceId?: string;
  /**
   * task-05（FR-03）：锁定绑定变更。传入即 createSession 加 change_id，且
   * change 级隐含 workspace 双传（调用方须同时给 bindWorkspaceId）。
   */
  bindChangeId?: string;
}

/* ────────────────────── 纯辅助（组件外便于单测推理） ────────────────────── */

function machineLabel(m: DaemonMachineRead): string {
  return m.display_alias?.trim() || m.hostname;
}

function runtimeLabel(r: DaemonRuntimeRead): string {
  // ql-20260815-001：智能体=引擎维度（FR-01），主显引擎名（Claude Code/Codex/…）。
  // 不用 runtime.name——它默认是机器主机名（如 DESKTOP-2BN7FDC），会把智能体显示成机器名。
  // 用户自定义了 runtime 别名时以「别名 · 引擎名」并呈，既保留个性化又始终可辨引擎。
  const engine = PROVIDER_META[r.provider ?? ""]?.label ?? r.provider ?? r.id;
  const alias = r.display_alias?.trim();
  return alias ? `${alias} · ${engine}` : engine;
}

/** ISO → "MM-DD HH:mm"；空/非法 → —（FRONTEND_PAGE_STYLE 空值统一）。 */
function formatHeartbeat(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function parseTs(v: string | null | undefined): number {
  if (!v) return 0;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * D-005 默认机器三级回退：
 * localStorage 上次选择（且仍在线）→ 最近会话（last_active_at 优先）所在的
 * 在线机器 → 最新心跳的在线机器。全部不命中返回 null。
 */
export function resolveDefaultMachineId(
  machines: DaemonMachineRead[],
  sessions: AgentSessionRead[],
): string | null {
  const online = machines.filter((m) => m.status === "online");
  if (online.length === 0) return null;
  const onlineIds = new Set(online.map((m) => m.id));

  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(NEW_SESSION_MACHINE_LS_KEY);
    if (saved && onlineIds.has(saved)) return saved;
  }

  const runtimeToMachine = new Map<string, string>();
  for (const m of machines) {
    for (const r of m.runtimes ?? []) runtimeToMachine.set(r.id, m.id);
  }
  const recent = [...sessions]
    .filter((s) => s.runtime_id)
    .sort(
      (a, b) =>
        parseTs(b.last_active_at ?? b.created_at) -
        parseTs(a.last_active_at ?? a.created_at),
    );
  for (const s of recent) {
    const mid = runtimeToMachine.get(s.runtime_id as string);
    if (mid && onlineIds.has(mid)) return mid;
  }

  const byHeartbeat = [...online].sort(
    (a, b) => parseTs(b.last_heartbeat_at) - parseTs(a.last_heartbeat_at),
  );
  return byHeartbeat[0]?.id ?? null;
}

/* ────────────────────── 组件 ────────────────────── */

export function NewSessionForm({
  onCreated,
  bindWorkspaceId,
  bindChangeId,
}: NewSessionFormProps) {
  const {
    items: machines,
    sessions,
    isLoading,
    isError,
    error,
    refetch,
  } = useDaemonMachines({});
  const { profiles } = useMineAgentProfiles();
  const providersQ = useQuery({
    queryKey: ["llmProviders", "sessions-new-form"],
    queryFn: listProviders,
    staleTime: 30_000,
  });
  const providers = useMemo(() => providersQ.data ?? [], [providersQ.data]);

  const [machineId, setMachineId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string>(NO_PROVIDER_VALUE);
  const [profileId, setProfileId] = useState<string>(NO_PROFILE_VALUE);
  const [prompt, setPrompt] = useState("");
  // task-05：锁定绑定——workspaceId 直接初始为绑定值；锁定期间选择器不渲染、
  // handleWsChange 不触达，state 不存在被改写的路径（父层按 scope key 重挂载换绑定）。
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    bindWorkspaceId ?? null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const machine = useMemo(
    () => machines.find((m) => m.id === machineId) ?? null,
    [machines, machineId],
  );

  // D-005：未手选机器时自动回退默认（数据到达后只补一次，不打断用户选择）。
  useEffect(() => {
    if (machineId || isLoading) return;
    const pick = resolveDefaultMachineId(machines, sessions);
    if (pick) setMachineId(pick);
  }, [machineId, isLoading, machines, sessions]);

  // ② 智能体：所选机器在线 + 会话支持的引擎。
  const supportedRuntimes = useMemo(() => {
    const rs = machine?.runtimes ?? [];
    return rs.filter(
      (r) =>
        r.status === "online" && SESSION_SUPPORTED_PROVIDERS.has(r.provider ?? ""),
    );
  }, [machine]);

  // 默认 Claude Code（provider=claude 优先，否则首个可会话智能体）；
  // 切机器后 agentId 不在新机器 runtimes 中 → 自动落回默认（联动重置）。
  const agentRuntime = useMemo(() => {
    if (agentId) {
      const hit = supportedRuntimes.find((r) => r.id === agentId);
      if (hit) return hit;
    }
    return (
      supportedRuntimes.find((r) => r.provider === "claude") ??
      supportedRuntimes[0] ??
      null
    );
  }, [agentId, supportedRuntimes]);

  const engine = agentRuntime?.provider ?? null;
  // D-010：Codex 引擎无会话级供应商 → 锁定，一律本机默认（不进请求体）。
  const providerLocked = engine !== "claude";
  const effectiveProviderId = providerLocked ? NO_PROVIDER_VALUE : providerId;

  const canStart = Boolean(machineId && agentRuntime && prompt.trim());

  const pickMachine = (id: string) => {
    if (id === machineId) return;
    setMachineId(id);
    setAgentId(null); // D-010：切机器重置智能体选择（落回新机器默认 Claude）
  };

  const handleWsChange = (wsId: string | null, boundMachineId: string | null) => {
    setWorkspaceId(wsId);
    if (boundMachineId && machines.some((m) => m.id === boundMachineId && m.status === "online")) {
      setMachineId(boundMachineId);
      setAgentId(null);
    }
    // 否则机器选择不动
  };

  const handleStart = async () => {
    if (!canStart || !agentRuntime || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const resp = await createSession({
        runtime_id: agentRuntime.id,
        prompt: prompt.trim(),
        manual_approval: true,
        ask_user_only: true,
        ...(effectiveProviderId
          ? { llm_provider_id: effectiveProviderId }
          : {}),
        ...(profileId ? { agent_profile_id: profileId } : {}),
        // task-05：change 锁定绑定时 change_id 与 workspace_id 双传（change 级
        // 隐含 workspace，先例 daemon/session-panel.tsx:2347 同体展开）。
        ...(bindChangeId ? { change_id: bindChangeId } : {}),
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
      });
      // D-005：记住本次机器选择（下次打开表单的默认第一级）。
      if (typeof window !== "undefined" && machineId) {
        window.localStorage.setItem(NEW_SESSION_MACHINE_LS_KEY, machineId);
      }
      onCreated?.(resp, {
        workspaceId,
        machineId,
        agentId: agentRuntime.id,
        providerId: effectiveProviderId,
        profileId,
        prompt: prompt.trim(),
      });
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : "创建会话失败，请重试",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5" aria-label="新建会话表单">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">新建会话</h2>
        <span className="text-xs text-muted-foreground">
          配置可随时在会话内切换（当前轮完成后）
        </span>
      </div>

      {/* ⓪ 工作区（可选；task-05 锁定绑定时不可换） */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-foreground">⓪ 工作区</span>
          <span className="text-xs text-muted-foreground">
            {bindWorkspaceId
              ? "已锁定 · 会话将在绑定工作区的项目目录中运行"
              : "可选 · 选中后会话将在工作区项目目录中运行"}
          </span>
        </div>
        {bindWorkspaceId ? (
          // task-05：锁定绑定——第⓪区不渲染 WorkspaceSessionPicker，换锁定
          // 提示条（运行确认由下方既有绿色提示条承接）。
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            🔒 已锁定绑定工作区，不可更换
          </div>
        ) : (
          <WorkspaceSessionPicker
            value={workspaceId}
            onChange={handleWsChange}
            machines={machines}
            disabled={submitting}
          />
        )}
        {workspaceId && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
            ✓ 会话将在该项目目录中运行，自动加载其规范文档
          </div>
        )}
      </section>

      {/* ① 守护进程（必选，仅在线） */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-foreground">① 守护进程</span>
          <span className="text-destructive">*</span>
          <span className="text-xs text-muted-foreground">只能选择在线机器</span>
        </div>
        {isError ? (
          <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
            加载守护进程失败：{error?.message ?? "未知错误"}
            <Button className="ml-3" size="small" onClick={() => void refetch()}>
              重新加载
            </Button>
          </div>
        ) : isLoading ? (
          <Spin data-testid="machines-loading" />
        ) : machines.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无守护进程</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {machines.map((m) => {
              const online = m.status === "online";
              const selected = m.id === machineId;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={!online}
                  aria-pressed={selected}
                  aria-label={`选择机器 ${machineLabel(m)}`}
                  onClick={() => pickMachine(m.id)}
                  className={`flex flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/60"
                  } ${online ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                >
                  <span className="flex items-center gap-2">
                    <Badge status={online ? "success" : "default"} />
                    <span className="text-sm font-medium text-foreground">
                      {machineLabel(m)}
                    </span>
                    {!online && <Tag>离线</Tag>}
                  </span>
                  <span className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {m.os ?? "—"} · {m.runtime_count} 个智能体
                    </span>
                    <span>心跳 {formatHeartbeat(m.last_heartbeat_at)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ② 智能体（必选） */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-foreground">② 智能体</span>
          <span className="text-destructive">*</span>
          <span className="text-xs text-muted-foreground">
            所选机器的在线智能体 · 默认 Claude Code
          </span>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="智能体列表">
          {(machine?.runtimes ?? []).length === 0 && (
            <span className="text-xs text-muted-foreground">
              {machine ? "该机器暂无智能体" : "请先选择守护进程"}
            </span>
          )}
          {(machine?.runtimes ?? []).map((r) => {
            const online = r.status === "online";
            const supported = SESSION_SUPPORTED_PROVIDERS.has(r.provider ?? "");
            const selectable = online && supported;
            const selected = agentRuntime?.id === r.id;
            return (
              <button
                key={r.id}
                type="button"
                disabled={!selectable}
                aria-pressed={selected}
                aria-label={`选择智能体 ${runtimeLabel(r)}`}
                onClick={() => setAgentId(r.id)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  selected
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border bg-card text-foreground"
                } ${selectable ? "cursor-pointer hover:border-primary/60" : "cursor-not-allowed opacity-60"}`}
              >
                <span>{engineIcon(r.provider)}</span>
                <span>{runtimeLabel(r)}</span>
                {r.provider === "claude" && <Tag>默认</Tag>}
                {!supported && <Tag>暂不支持会话</Tag>}
                {!online && supported && <Tag>离线</Tag>}
              </button>
            );
          })}
        </div>
      </section>

      {/* ③ 供应商（可选；engine≠claude 锁定） */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-foreground">③ 供应商</span>
          <span className="text-xs text-muted-foreground">
            可选 · 不选则用守护进程本机的供应商配置
          </span>
        </div>
        <Select
          id="nsf-provider"
          className="w-full"
          value={effectiveProviderId}
          disabled={providerLocked}
          onChange={(v) => setProviderId(v)}
          notFoundContent={providersQ.isLoading ? <Spin size="small" /> : null}
          options={[
            { value: NO_PROVIDER_VALUE, label: "不指定（本机默认）" },
            ...providers.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {providerLocked
            ? "Codex 引擎暂不支持会话级供应商，将使用本机默认供应商配置"
            : "选择后，本会话用所选供应商的 API 配置发起调用（仅影响本会话）"}
        </p>
      </section>

      {/* ④ 智能体档案（可选，跨工作区，不做引擎过滤 D-013） */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-foreground">④ 智能体档案</span>
          <span className="text-xs text-muted-foreground">
            可选 · 档案 = 提示词 + 身份
          </span>
        </div>
        <Select
          id="nsf-profile"
          className="w-full"
          value={profileId}
          onChange={(v) => setProfileId(v)}
          notFoundContent={<Spin size="small" />}
          options={[
            { value: NO_PROFILE_VALUE, label: "不指定" },
            ...profiles.map((p) => ({
              value: p.id,
              // D-013：不做引擎过滤；Codex 下仅标注人格不注入（原 D-003）。
              label:
                engine === "codex" ? `${p.name}（人格暂不支持）` : p.name,
            })),
          ]}
        />
        <p className="text-xs text-muted-foreground">
          选择后本会话以该档案的人格身份对话；列出你的全部档案（跨工作区）
          {engine === "codex" ? "；Codex 智能体暂不支持人格注入" : ""}
        </p>
      </section>

      {/* 消息 + 开始会话 */}
      <section className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">消息</span>
        <Input.TextArea
          rows={3}
          value={prompt}
          placeholder="输入第一条消息…"
          onChange={(e) => setPrompt(e.target.value)}
          aria-label="会话消息输入"
        />
        <div className="flex items-center justify-end gap-3">
          <span className="text-xs text-muted-foreground">
            机器、智能体必选并输入消息后「开始会话」可点击{workspaceId ? " · 已选择工作区" : ""}
          </span>
          <Button
            type="primary"
            disabled={!canStart}
            loading={submitting}
            onClick={() => void handleStart()}
          >
            开始会话
          </Button>
        </div>
        {submitError && (
          <Alert type="error" showIcon title={submitError} aria-label="创建会话错误" />
        )}
      </section>
    </div>
  );
}

/** 引擎图标（原型语义：claude ⚡ / codex ◎ / 其它 ✦）。 */
function engineIcon(provider: string | null): string {
  if (provider === "claude") return "⚡";
  if (provider === "codex") return "◎";
  return "✦";
}
