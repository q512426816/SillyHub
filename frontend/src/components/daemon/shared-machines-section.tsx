"use client";

/**
 * SharedMachinesSection —— 「共享给我的」区块（2026-08-28-daemon-agent-share
 * task-09 / FR-01 / FR-03 / D-004@v2）。
 *
 * 只读共享机器视图：workspace 成员共享（FR-02 grants 开关）打开后，同工作区
 * 业务成员在此看到 lender 的机器。对齐原型 prototype-daemon-agent-share.html
 * ④「共享给我的」：
 *   - 虚线边框机器卡（.machine.shared：border-dashed + accent 青边）；
 *   - 「共享」交互青徽标 + 在线/离线 Badge（在线取机器权威源）；
 *   - 共享人显示名 + 来源工作区名（page 侧 listWorkspaces 建 id→name map 传入）；
 *   - 操作**仅「会话」**——别名/可写目录/升级/禁用/移除等配置类操作仅所有者
 *     可见，此处一律不渲染（FR-03 红线，测试断言按钮不存在）；离线禁用。
 *
 * task-13（契约修复）：「会话」按 runtime 粒度放行——机器行携带 runtimes 明细
 * （runtime_id/provider/online），无在线 runtime 时按钮禁用（机器离线或全部
 * runtime 离线都不可会话）；onOpenSession 仍传整行 machine，锁定 id（第一个
 * 在线 runtime_id）由 page 处理器解析。
 *
 * 空数据不渲染整块（acceptance：无共享数据时页面与现状一致）。
 *
 * 样式：antd Tag/Badge/Button（FRONTEND_PAGE_STYLE §0/§7）+ tailwind brand/info
 * 语义阶（§0.5——info 即交互青 accent，随主题换肤），无硬编码 hex。
 */
import { Users } from "lucide-react";
import { Badge, Button, Tag } from "antd";

import type { SharedMachineView } from "@/lib/daemon";

export interface SharedMachinesSectionProps {
  /** 共享给我的机器行（/machines 响应 shared_to_me，五字段 + task-13 runtimes）。 */
  machines: SharedMachineView[];
  /** 来源工作区 id → 显示名（page 由 listWorkspaces 建_map；未知 id 回退 —）。 */
  workspaceNames?: Map<string, string>;
  /**
   * 「会话」入口——page 复用既有 openRuntimeSession 流（唤起全局悬浮会话
   * 助手，锁该机器第一个在线 runtime）。组件不感知悬浮 store，保持可独立单测。
   */
  onOpenSession: (_machine: SharedMachineView) => void;
}

/** 该机器第一个在线 runtime（后端按 provider 升序返回，取值确定可测）。 */
function firstOnlineRuntime(machine: SharedMachineView) {
  return (machine.runtimes ?? []).find((r) => r.online);
}

export function SharedMachinesSection({
  machines,
  workspaceNames,
  onOpenSession,
}: SharedMachinesSectionProps) {
  // acceptance：空数据不渲染整块（区块级 return null，非空态提示）。
  if (!machines || machines.length === 0) return null;

  return (
    <section
      aria-label="共享给我的"
      data-testid="shared-machines-section"
      className="space-y-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">共享给我的</h2>
        <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">
          新增
        </span>
        <span className="text-[11px] text-muted-foreground">
          来源：工作区成员共享（可用其守护进程开会话，配置仅所有者可改）
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {machines.map((machine) => {
          const workspaceName = machine.source_workspace_id
            ? workspaceNames?.get(machine.source_workspace_id)
            : undefined;
          // task-13：会话按 runtime 粒度——机器在线且存在在线 runtime 才可发起
          // （acceptance：无在线 runtime 时按钮禁用）。
          const sessionable = machine.online && firstOnlineRuntime(machine) != null;
          return (
            <article
              key={machine.machine_id}
              data-testid={`shared-machine-card-${machine.machine_id}`}
              className="rounded-lg border border-dashed border-info bg-card p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                  {machine.display_name}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Tag color="cyan">共享</Tag>
                  <Badge
                    status={machine.online ? "success" : "default"}
                    text={machine.online ? "在线" : "离线"}
                  />
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                共享人：{machine.lender_display_name ?? "—"} · 来自工作区：
                {workspaceName ?? "—"}
              </p>
              <div className="mt-3 flex items-center justify-between rounded-md bg-muted px-2.5 py-2">
                <span className="text-xs font-medium text-foreground">
                  共享守护进程
                </span>
                {/* FR-03：共享机器唯一操作——「会话」（唤起悬浮助手，锁第一个在线
                    runtime）；配置类按钮仅所有者机器卡渲染，此处不渲染。
                    机器离线 / 无在线 runtime 禁用（task-13）。 */}
                <Button
                  type="primary"
                  size="small"
                  disabled={!sessionable}
                  onClick={() => onOpenSession(machine)}
                  title={
                    sessionable
                      ? `用「${machine.display_name}」发起会话`
                      : machine.online
                        ? "该机器暂无在线引擎，不可发起会话"
                        : "共享机器离线，暂不可发起会话"
                  }
                >
                  会话
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
