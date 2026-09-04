---
author: qinyi
created_at: 2026-09-04 22:06:01
---

# 提案书（Proposal）

## 动机

多端（本机 + 平台服务器 + 其他机器）使用 sillyspec 后，同步冲突（spec 树版本不匹配 / 进度 base_ts 乐观锁）与 ghost 残留（平台有记录、本地目录已不存在）目前只能上机器手敲 CLI 处理。检测数据早已通过 daemon 心跳（`sillyspec_status`）汇聚到平台并在前端展示红灯，但「处理」动作没有页面入口——看到红灯的人必须 SSH/开终端执行 `sillyspec platform resolve` / `sillyspec doctor --cleanup-ghosts --confirm`，链路断裂。本变更在变更中心页补上处理入口，一次闭环。

## 关键问题

1. **看到问题的人处理不了问题**：工作台「活跃变更总览」卡已展示 conflict/ghost 红灯（2026-09-02-changes-overview-card），但当时明确 Non-goal「不做写操作」——卡片只能显示 CLI 命令文案让用户抄命令上机器执行，多端用户（手机/他机看板）根本够不到机器终端。
2. **冲突阻塞推进且高频发生**：进度乐观锁（base_ts）在多机并发推进同一变更时必然偶发 409；当前本机就有 6 条未决冲突挂着，其中 2 条卡着活跃变更（agent-provider-abstraction、provider-pi-onboarding）无法归档收尾。
3. **ghost 残留无收敛入口**：本地目录已删但平台/本地 DB 有记录的变更行，只能靠人记得跑 `doctor --cleanup-ghosts`；忘跑则变更中心永远显示僵尸行。

## 变更范围

- **Backend**：两条机器级即时 WS 指令（`daemon:sillyspec_resolve` 带 change+strategy、`daemon:sillyspec_ghost_cleanup`），两个 POST 端点（权限=RuntimeAdminUser + 机器归属，照 sillyspec-update 先例）；心跳新字段 `sillyspec_command_result` 落 `daemon_instances` 新 JSON 列（两态语义：对象=直写/键不出现=置 NULL，register 恒清）。
- **Daemon**：`_handleWsMessage` 两个直连 case；sillyspec-manager 新增 runResolve / runGhostCleanup（execFile sillyspec CLI，超时 config 化默认 120s，in-flight 串行）；结果内存槽 10 分钟终态窗随心跳捎带。
- **Frontend**：变更中心页新增「平台同步」处理区卡片（冲突行保本地/取平台按钮 + 危险确认弹窗 + 活跃警示、ghost 一键清理、下发后 15s 级结果回显、150s 无回报恢复重试）；权限=机器所有者+平台管理员可操作他人只读；总览卡 CLI 指引文案改为跳转变更中心。

## 不在范围内（显式清单）

- 不做 abort 裁决上页面（活跃变更误弃风险，留 CLI）——D-002@v1
- 不建命令队列表、不做离线补拉/ack 重试（机器级 fire-and-forget，同 self_update/cleanup/sillyspec_update 先例）——D-001@v1
- 不改 control_commands 六类可靠投递通道与 run/lease 状态机
- 不做冲突 diff 对比视图（弹窗只描述策略后果）
- 不覆盖变更总览卡的跨机器监控定位（只改指引文案）

## 成功标准（可验证）

- 未配置/无绑定的 workspace：变更中心页行为与现状完全一致（卡片不渲染）
- 机器在线时：页面点「保本地/取平台」→ daemon 执行 `sillyspec platform resolve` → 约 15s 内心跳回显成功/失败 → 冲突行 ≤60-75s 随 sillyspec_status 刷新消失
- 机器离线时：端点返回 504，前端提示机器离线
- 非机器所有者且非平台管理员：看不到操作按钮（只读清单），直调端点 404
- 旧版本 daemon 收到新指令：warn 后忽略，无副作用，前端 150s 后恢复按钮可重试
- 三端相关测试全绿：backend 新增端点/心跳用例、daemon 新增命令执行用例、前端组件用例；`pnpm gen:types` 再生成提交
