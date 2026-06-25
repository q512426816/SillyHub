---
author: qinyi
created_at: 2026-06-25T15:42:00
---

# Proposal

## 动机

scan 场景下，agent 在单个 `claude -p` 调用内用 Bash 反复跑 `sillyspec run scan --done` 推进 10 步，持续约 30 分钟。daemon 把这种"单次长 turn"误判为空闲 session，在 30 分钟 idle 阈值到期时强制 kill claude 进程，前端表现为 `[Request interrupted by user]`，但用户并未中断。

实测案例 `agent-run-812ebea3.log`：scan 14:13:27 开始，14:43:38（+30 分 11 秒）被杀，撞 `default idleTimeoutSec=1800`。scan 产出本身完整（step10 在 14:41:41 落盘），被砍的只是收尾汇报文字。

核心要解决的问题：**让有终点的任务（scan/stage）完成时主动结束会话、claude 进程及时退出，彻底摆脱超时误杀；同时移除 idle 自动回收这套与原生 claude code "完成即退"语义相悖的兜底机制。**

## 关键问题（现有方案为何不够）

### 痛点 1：daemon idle 回收误判"工作中的长 turn"为空闲

`session-manager.ts` 用 `lastActiveAt` 判断空闲，但该字段只在 4 处更新（session 创建 / inject 新 turn / interrupt / `_onResult`）。turn 进行中持续吐的 assistant message / tool_use / tool_result / thinking delta（走 `_onMessage`）全部不更新。单 turn 跑 30 分钟的长任务，`lastActiveAt` 停在首条 inject 时刻，被 `_scanIdle` 误判空闲 → `_onIdleExpire` → interrupt + end → claude 被杀。

光修"活动判定"（原方案三）只是治标——scan 完成后 session 仍残留，还得靠 idle 兜底回收。

### 痛点 2：backend scan/stage 完成时不主动 end_session（真正缺口）

`complete_lease`（`lease/service.py:278`）收尾链——标 lease completed → 更新 AgentRun → Redis → patch → stage 回调 → post_scan 校验——**唯独不调 `end_session`**。`end_session` 当前只被用户手动 HTTP 端点（`router.py:1089`）调用，无自动完成路径。结果 scan 完成后 daemon session 残留 active，claude 进程因 `--input-format stream-json` 常驻等 stdin 不退出，最终撞 idle 回收。

### 痛点 3：idle 回收机制与原生 claude code 语义相悖

原生 `claude -p` 跑完 turn 即 SIGEXIT，无 daemon / session 池 / idle 回收。SillyHub 的 idle 回收是为自造的"长驻 session"模型（`--input-format stream-json` 让进程常驻复用）打的补丁。这套超时兜底既会误杀长 turn，又在 scan 完成后仍需它兜底——根因是缺少"完成驱动 end"。补上完成驱动 end 后，idle 回收可整体移除，回归"完成即退"的简洁语义。

## 变更范围

1. **daemon 侧（D-001）**：移除 idle 自动回收——`session-manager.ts` 的 `_idleTimer` 默认不启动，`DEFAULT_IDLE_TIMEOUT_SEC` 由 1800 改 0；env `SESSION_IDLE_TIMEOUT_SEC>0` 留逃生口。
2. **backend 侧（D-002）**：`complete_lease` 收尾链末尾对 scan run（`change_id=None` + `spec_strategy=platform-managed`）和 stage run（`change_id` 非空）主动调 `end_session`，经 D-006 facade 委托 + FR-05 `session_end` 链路关闭 daemon session。
3. **单测**：daemon idle 禁用 + 长 turn 不杀；backend scan/stage 完成 → end_session 调用；多轮对话不自动 end。

## 不在范围内（显式清单）

- **不**做前端"守护进程运行列表超时计时器单独配置"UI 入口（idle 已默认禁用无配置需求，UI 配置单独立变更）
- **不**保留 idle 活动判定修复（双修方案下 idle 整体禁用，活动判定无意义）
- **不**处理"agent hang 死不完成 + 用户断网"极端泄漏（容忍，靠用户下次手动清理）
- **不**改 claude `-p` 的 stream-json 常驻语义
- **不**引入绝对上限 / 新增任何自动超时机制（D-003）

## 成功标准（可验证条件）

1. **SC-1**：scan 跑完 10 步 → `complete_lease` 收尾主动调 `end_session` → daemon session 转 ended → claude 进程退出（单测断言 end_session 被调用）
2. **SC-2**：长时间 scan（>30min）不再被 `[Request interrupted by user]` 误杀（idle 定时器默认不启动，长 turn 不触发 end）
3. **SC-3**：多轮对话 session 仍可由用户手动结束（现有 FR-05 链路回归通过）
4. **SC-4**：idle 定时器默认不启动；env `SESSION_IDLE_TIMEOUT_SEC=1800` 可恢复旧行为（逃生口）
5. **SC-5**：stage run 完成同样主动 end（stage 每步独立 session，已确认）
6. **SC-6**：`complete_lease` 完成驱动 end 失败不阻塞 lease 完成语义（try/except warn log）
