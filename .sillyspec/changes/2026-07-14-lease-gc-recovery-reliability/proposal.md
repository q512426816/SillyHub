---
author: qinyi
created_at: 2026-07-14 10:32:29
---

# 提案书（Proposal）— lease/GC/恢复机制可靠性提升

## 动机
SillyHub 面向千人规模，daemon 长时间断开后任务基本丢失——batch 被卡死/一刀切判死且重跑不保留进度，对话式 session 在 daemon 不回来时永久悬空。可靠性不足以支撑产品化。本次抬高 daemon 断开后的任务存活/恢复能力到可接受水平，且严守"不误杀长任务"哲学。

## 关键问题（现有方案不够的痛点）
1. **lease GC 定时器生产无调用方**：`handle_expired_leases_batch` 写好+测好但全库无 cron/asyncio/lifespan 调用，daemon 断开后 lease 不回收、AgentRun 永久卡 running，直到后端重启被 `cleanup_stale_runs` 一刀切标 failed（连重试机会都不给）。
2. **worktree GC 判据错误**：固定 TTL 到期就删，与 agent 任务零关联，长任务超时被误删工作目录。
3. **悬空 session 不可见 + failed 无重试入口**：用户看不到哪个 session 的 daemon 离线了；failed 任务没法一键重跑，只能重新走变更流程。

## 变更范围
APScheduler 统一巡检骨架（LeaseReaperService）+ lease/worktree GC 接线（只收失联的）+ worktree 加 agent_run_id 外键改判据 + 心跳窗口放宽 + attempt 可配 + failed retry 入口 + 悬空可见性 + lease service 死代码清理 + 守护测试。详见 design.md（9 项工作 / 3 Wave）。

## 不在范围内（显式清单）
- 不加任何"绝对时长上限"自动超时（历史红线，会误杀推理模型长任务/长 turn）
- 不加 interactive 悬空 session 自动转 failed 兜底（用户决策：保持手动 end/delete）
- cancel 真停 daemon 进程（ql-20260712-001 已全链路打通：backend SESSION_INTERRUPT + daemon q.interrupt()，不重复）
- batch 重跑保留进度（用户决策：靠 sillyspec 工具幂等，backend 不改产物逻辑）
- 水平扩展/多实例（本变更只解单实例 GC/恢复，daemon WS 路由外置留待未来）
- 前端 HTML 原型（仅 retry 按钮 + 离线徽标 2 个小增量，参照现有组件）

## 成功标准（可验证）
- 未配置 GC 时（env 全关）行为与现状等价（lease 仍靠启动 cleanup 兜底，零回归）
- GC 接线后，daemon 断开 >心跳窗口+GC 周期，batch lease 被正确回收重派（而非永久卡死）
- daemon 持续心跳的 30 分钟长任务 lease 不被 GC（守护测试钉死）
- interactive lease（NULL expires）永不被 GC 扫到
- worktree 关联 agent_run 非终态时即使 expires_at 过期也不回收；终态（含 cancelled）才回收
- failed/killed run 可通过 retry 端点建新 run 重跑
- session 列表/详情显示持有 session 的 daemon 在线/离线状态
- 各 GC job env 开关可单独关停（排查友好）
- lease service 死代码（expire_overdue_leases + 残留正向方法）已清理，活代码（expire_leases/cancel）不受影响
