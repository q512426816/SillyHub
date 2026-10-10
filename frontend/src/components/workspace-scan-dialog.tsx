"use client";

import { Alert, Modal } from "antd";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkspacePathPicker } from "@/components/workspace-path-picker";
import { normalizeClientPath } from "@/lib/client-path";
import {
  listDaemonInstances,
  PROVIDER_META,
  type DaemonInstanceRead,
} from "@/lib/daemon";
import { errMessage, useNotify } from "@/lib/errors";
import { initDispatch, type SpecStrategy } from "@/lib/spec-workspaces";
import {
  createWorkspace,
  slugifyWorkspaceName,
} from "@/lib/workspaces";
// task-06 / 2026-08-18-workspace-role-type / FR-02 / D-002@v1：
// 创建路径接 8 值受控词表（task-05 产物，禁止组件内重复硬编码）。
import {
  WORKSPACE_TYPE_OPTIONS,
  type WorkspaceType,
} from "@/lib/workspace-types";
// 2026-10-09-workspace-init-skill-gate task-04 / FR-04 / D-003@v1：创建成功后
// 轮询本机绑定 init_synced_at 判定初始化完成（与 config-card handleInit 同源字段）。
import { fetchMyBinding } from "@/lib/workspace-binding";

// 两步状态机：idle → creating → initializing → done | init_failed。
// 「初始化失败不回滚创建」——工作区行已落库，失败态明示可稍后在详情页重试
// （失败不回写 init_synced_at 由后端成败门保证，task-03 / D-006@v1）。
type Phase = "idle" | "creating" | "initializing" | "done" | "init_failed";

// 轮询节律与超时对齐 config-card handleInit（D-003@v1：2s 轮询 / 5min 超时）。
const INIT_POLL_INTERVAL_MS = 2_000;
const INIT_POLL_TIMEOUT_MS = 5 * 60 * 1000;

// spec 同步策略选项（2026-10-09-ws-create-spec-default-collapse）：默认
// repo-native（源项目即真理），前两个低频选项收进「更多选项」展开后才渲染
// （条件渲染非 CSS 隐藏）；shortLabel 供收起态摘要行使用。
const SPEC_STRATEGY_OPTIONS: Array<{
  value: SpecStrategy;
  shortLabel: string;
  label: string;
}> = [
  { value: "platform-managed", shortLabel: "平台托管", label: "平台托管（不碰源项目，从零扫描）" },
  { value: "repo-mirrored", shortLabel: "单次导入", label: "单次导入（复制源项目 .sillyspec 快照，不污染源项目）" },
  { value: "repo-native", shortLabel: "源项目即真理", label: "源项目即真理（软链接，扫描直接写源项目）" },
];

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

export function WorkspaceScanDialog({ onCreated, onCancel }: Props) {
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  // task-06 / FR-02 / D-002@v1：工作区类型必选——默认空=未选择，
  // 未选时禁提交 + 提交校验拦（acceptance：未选不可触发创建）。
  const [wsType, setWsType] = useState<WorkspaceType | "">("");
  // task-06 / FR-03：描述选填（≤2000 字符，全文留详情页展示）。
  const [description, setDescription] = useState("");
  // ql-20260826-007-8666：slug 默认从名称实时派生，允许手动改；手动编辑过
  // （slugEdited）后不再跟随名称。创建后后端锁定不可改，提交体只在非空时带。
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugDraft, setSlugDraft] = useState("");
  const effectiveSlug = slugEdited
    ? slugDraft
    : name
      ? slugifyWorkspaceName(name)
      : "";

  // daemon-entity-binding task-10/11 补遗：创建对话框从 runtime 维度改为 daemon 实体维度。
  // 下拉展示守护进程实体（含全部 provider），value=inst.id；不再按 runtime 一项一条。
  const [instances, setInstances] = useState<DaemonInstanceRead[]>([]);
  const [daemonId, setDaemonId] = useState<string>("");
  const [daemonRootPath, setDaemonRootPath] = useState("");
  // spec 同步策略（2026-06-28-daemon-client-spec-sync-strategy）：daemon-client workspace
  // 创建时用户可选源项目已有 .sillyspec 如何进入平台。默认 repo-native 源项目即真理
  // （2026-10-09-ws-create-spec-default-collapse 翻转，前两选项默认收进「更多选项」）。
  const [specStrategy, setSpecStrategy] = useState<SpecStrategy>("repo-native");
  const [specExpanded, setSpecExpanded] = useState(false);

  // quick ql-20260803-003-cb34：创建后如后端标记「复用/激活/复活」则提示用户，避免
  // 静默返回 201（同 root_path 已有工作区被复用）导致「创建成功却看不到/绑定没生效」的困惑。
  const notify = useNotify();

  // task-04 / FR-04：初始化轮询的定时器与超时句柄（卸载/终态清理，防孤儿轮询）。
  const initPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopInitPolling = () => {
    if (initPollRef.current) {
      clearInterval(initPollRef.current);
      initPollRef.current = null;
    }
    if (initDeadlineRef.current) {
      clearTimeout(initDeadlineRef.current);
      initDeadlineRef.current = null;
    }
  };
  useEffect(() => stopInitPolling, []);
  // 2026-10-10-ws-init-dialog-close-guard：超时钟与轮询的可见性暂停对齐
  // （D-005 钟同步）——后台标签页轮询 tick 被 document.hidden 短路，deadline
  // 到期同样不判死：hidden 时顺延一拍再探；回前台后重挂满窗再计（后台时段
  // 不累计超时，杜绝「后台初始化实际成功、回前台 ≤2s 即假失败」的竞态）。
  // fullWindow 标记区分两态：满窗到期且可见才判 init_failed；顺延拍到期且
  // 可见 = 刚从后台回来 → 重挂满窗。
  const armInitDeadline = (delayMs: number, fullWindow: boolean) => {
    initDeadlineRef.current = setTimeout(() => {
      if (document.hidden) {
        armInitDeadline(INIT_POLL_INTERVAL_MS, false);
        return;
      }
      if (!fullWindow) {
        armInitDeadline(INIT_POLL_TIMEOUT_MS, true);
        return;
      }
      stopInitPolling();
      setPhase("init_failed");
    }, delayMs);
  };

  useEffect(() => {
    void listDaemonInstances()
      .then(setInstances)
      .catch(() => setInstances([]));
  }, []);

  const handleCreateDaemonClient = async () => {
    // task-06 / FR-02：类型必选校验（按钮禁用为第一道，此处兜底拦路径调用）。
    if (!wsType || !daemonId || !daemonRootPath) return;
    const normalizedRoot = normalizeClientPath(daemonRootPath);
    setError(null);
    setPhase("creating");
    try {
      const ws = await createWorkspace({
        name: name.trim() || normalizedRoot.split(/[\\/]/).filter(Boolean).at(-1) || normalizedRoot,
        root_path: normalizedRoot,
        // ql-20260826-007-8666：非空才带（空 = 省略，后端从最终名称派生）。
        ...(effectiveSlug.trim() ? { slug: effectiveSlug.trim() } : {}),
        daemon_id: daemonId,
        spec_strategy: specStrategy,
        // task-06 / FR-02/FR-03：提交体带必选 type + 可选 description。
        type: wsType,
        description: description.trim() || null,
      });
      // quick ql-20260803-003-cb34：复用/激活/复活时后端返回 creation_notice，必须显式提示。
      if (ws.creation_notice) {
        notify.warning(ws.creation_notice);
      }

      // task-04 / FR-04 / D-003@v1：创建成功（daemonId 由入口必选校验保证非空）→
      // 串行派发初始化并轮询到 init_synced_at 非空。
      // initDispatch 失败不回滚创建（工作区已落库），直接进失败态明示可稍后重试。
      try {
        await initDispatch(ws.id);
      } catch {
        setPhase("init_failed");
        return;
      }
      setPhase("initializing");
      initPollRef.current = setInterval(async () => {
        if (document.hidden) return; // visibilitychange 暂停（对齐 config-card D-005）
        try {
          const binding = await fetchMyBinding(ws.id);
          if (binding?.init_synced_at) {
            stopInitPolling();
            setPhase("done");
            notify.success("工作区已创建并完成初始化");
          }
        } catch {
          // 单次轮询错误忽略，下一 tick 重试（超时兜底）
        }
      }, INIT_POLL_INTERVAL_MS);
      armInitDeadline(INIT_POLL_TIMEOUT_MS, true);
    } catch (err) {
      setError(errMessage(err, "创建失败"));
      setPhase("idle");
    }
  };

  // ql-20260821-007：内嵌展开块改为 antd Modal 弹窗（用户指定），
  // 表单内容/交互零改动，仅容器形态变化。
  // 2026-10-10-ws-init-dialog-close-guard：busy（creating/initializing）态
  // 三条默认关闭通道全禁（ESC=keyboard / 遮罩=maskClosable / 右上角 X=closable）
  // ——「初始化期间禁用取消」不能只堵 footer 按钮；idle/done/init_failed 保持默认。
  const busy = phase === "creating" || phase === "initializing";
  return (
    <Modal
      open
      title="添加工作区"
      onCancel={onCancel}
      footer={null}
      width={520}
      destroyOnHidden
      maskClosable={!busy}
      keyboard={!busy}
      closable={!busy}
    >
      <div className="space-y-4">
        <p className="text-[11px] text-muted-foreground">
          使用本机守护进程上的项目路径。
        </p>

        {/* task-04 / FR-04：创建后自动初始化的状态区（两步进度 + 终态 Alert）。
            creating 态沿用原按钮文案（无状态区），initializing/done/init_failed 渲染本区。 */}
        {(phase === "initializing" || phase === "done" || phase === "init_failed") && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-[11px] text-emerald-600"
                aria-label="创建工作区已完成"
              >
                ✓
              </span>
              <span className="text-muted-foreground">创建工作区</span>
              <span className="h-px flex-1 bg-border" />
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                  phase === "done"
                    ? "bg-emerald-500/15 text-emerald-600"
                    : phase === "init_failed"
                      ? "bg-destructive/15 text-destructive"
                      : "bg-primary/15 text-primary"
                }`}
                aria-label={
                  phase === "done"
                    ? "初始化已完成"
                    : phase === "init_failed"
                      ? "初始化失败"
                      : "初始化进行中"
                }
              >
                {phase === "done" ? "✓" : phase === "init_failed" ? "✕" : "…"}
              </span>
              <span
                className={
                  phase === "initializing" ? "text-foreground" : "text-muted-foreground"
                }
              >
                初始化工作区
              </span>
            </div>
            {phase === "initializing" && (
              <p className="rounded-md bg-muted px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                正在通过本机守护进程初始化：下发平台配置 → 拉取文档缓存 →
                按本机已有的 agent 写入对应 skill 文件。通常需要十几秒，请勿关闭弹窗。
              </p>
            )}
            {phase === "done" && (
              <Alert
                type="success"
                showIcon
                message="初始化完成，工作区可以使用了。"
              />
            )}
            {phase === "init_failed" && (
              <Alert
                type="error"
                showIcon
                message="工作区已创建成功，但初始化失败"
                description="守护进程可能离线或版本过旧（sillyspec 需 ≥3.32.2）。可稍后在工作区详情页重新初始化。"
              />
            )}
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              在线守护进程
            </label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={daemonId}
              onChange={(e) => setDaemonId(e.target.value)}
              disabled={phase === "creating" || phase === "initializing"}
            >
              <option value="">— 请选择在线守护进程 —</option>
              {instances.map((inst) => {
                const label =
                  inst.display_alias ?? inst.hostname;
                const providers = inst.providers
                  .map((p) => PROVIDER_META[p.provider]?.label ?? p.provider)
                  .join(" / ");
                const isOnline = inst.status === "online";
                return (
                  <option
                    key={inst.id}
                    value={inst.id}
                    // 离线 daemon 也展示但禁选（用户能看到，引导启动）
                    disabled={!isOnline}
                  >
                    {label} · {providers || "无 provider"} ·{" "}
                    {isOnline ? "在线" : "离线"}
                  </option>
                );
              })}
            </select>
            {instances.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                无在线守护进程，请先启动 sillyhub-daemon。
              </p>
            )}
          </div>
          <WorkspacePathPicker
            daemonId={daemonId}
            value={daemonRootPath}
            onChange={(p) => setDaemonRootPath(normalizeClientPath(p))}
            placeholder="C:\\path\\to\\repo"
            inputClassName="text-sm"
          />
          {daemonRootPath && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="ws-name-d">
                工作区名称
              </label>
              <Input
                id="ws-name-d"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-workspace"
                disabled={phase === "creating" || phase === "initializing"}
              />
            </div>
          )}
          {daemonRootPath && (
            <div className="space-y-1.5">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="ws-slug-d"
              >
                slug（创建后不可修改）
              </label>
              <Input
                id="ws-slug-d"
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugDraft(e.target.value);
                  setSlugEdited(true);
                }}
                placeholder="默认从工作区名称生成"
                maxLength={100}
                disabled={phase === "creating" || phase === "initializing"}
                className="font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                默认随名称自动生成，可手动修改；仅小写字母、数字、连字符。创建后不可再改。
              </p>
            </div>
          )}
          {daemonRootPath && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="ws-type">
                工作区类型
              </label>
              <select
                id="ws-type"
                className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                value={wsType}
                onChange={(e) => setWsType(e.target.value as WorkspaceType | "")}
                disabled={phase === "creating" || phase === "initializing"}
              >
                <option value="">— 请选择工作区类型 —</option>
                {WORKSPACE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {daemonRootPath && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="ws-desc">
                描述（选填）
              </label>
              <textarea
                id="ws-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="工作区用途说明，如「订单模块前端代码」"
                maxLength={2000}
                rows={3}
                disabled={phase === "creating" || phase === "initializing"}
                className="w-full resize-y rounded border bg-background px-2 py-1.5 text-sm"
              />
            </div>
          )}
          {daemonRootPath && (
            <div className="space-y-1.5">
              {specExpanded ? (
                <>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">
                      spec 同步策略（源项目已有 .sillyspec 如何进入平台）
                    </label>
                    <button
                      type="button"
                      className="text-[11px] text-primary underline-offset-2 hover:underline disabled:opacity-50"
                      onClick={() => setSpecExpanded(false)}
                      disabled={phase === "creating" || phase === "initializing"}
                    >
                      收起
                    </button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {SPEC_STRATEGY_OPTIONS.map(({ value, label }) => (
                      <label key={value} className="flex items-center gap-1.5 text-xs">
                        <input
                          type="radio"
                          checked={specStrategy === value}
                          onChange={() => setSpecStrategy(value)}
                          disabled={phase === "creating" || phase === "initializing"}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {`spec 同步策略：${
                      SPEC_STRATEGY_OPTIONS.find((o) => o.value === specStrategy)
                        ?.shortLabel ?? ""
                    }`}
                  </span>
                  <button
                    type="button"
                    className="text-[11px] text-primary underline-offset-2 hover:underline disabled:opacity-50"
                    onClick={() => setSpecExpanded(true)}
                    disabled={phase === "creating" || phase === "initializing"}
                  >
                    更多选项
                  </button>
                </div>
              )}
              {specStrategy === "repo-native" && (
                <p className="text-[11px] text-amber-600">
                  ⚠ 扫描产出会写入源项目 .sillyspec（若被 git 跟踪需自行 commit）。
                </p>
              )}
            </div>
          )}
          {daemonRootPath && phase !== "done" && phase !== "init_failed" && (
            <div className="flex justify-center">
              <Button
                size="sm"
                onClick={handleCreateDaemonClient}
                disabled={phase === "creating" || phase === "initializing" || !wsType}
              >
                {phase === "creating"
                  ? "创建中..."
                  : phase === "initializing"
                    ? "初始化中…"
                    : "创建工作区"}
              </Button>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <footer className="flex items-center justify-end gap-2 pt-1">
          {/* task-04 / FR-04：初始化期间禁用取消（防半途关窗状态不可见；关窗不中断
              后台 lease，但用户会失去进度反馈）；done/init_failed 提供出口按钮。 */}
          {phase === "done" && (
            <Button size="sm" onClick={onCreated}>
              打开工作区
            </Button>
          )}
          {phase === "init_failed" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={onCreated}
                title="工作区已创建，可稍后在详情页重新初始化"
              >
                稍后手动初始化
              </Button>
              <Button size="sm" onClick={onCreated}>
                打开工作区
              </Button>
            </>
          )}
          {(phase === "idle" || phase === "creating" || phase === "initializing") && (
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={phase === "creating" || phase === "initializing"}
            >
              取消
            </Button>
          )}
        </footer>
      </div>
    </Modal>
  );
}
