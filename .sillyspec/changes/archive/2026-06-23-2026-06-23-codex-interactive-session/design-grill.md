---
author: qinyi
created_at: 2026-06-23 21:44:12
---

# Design Grill：/runtimes Codex Interactive Session

## Design Grill Result

status: passed

结论：设计可进入 plan。交叉审查发现 3 个结构性问题，均可由现有源码和本机 Codex schema 直接判断，无需用户补充决策；已同步修正 `design.md` 和 `decisions.md`。

## Cross-Check Matrix

| ID | 层级 | 交叉点 | 证据 A | 证据 B | 结论 | 决策 |
| --- | --- | --- | --- | --- | --- | --- |
| X-001 | consistency | driver input 类型 | design.md 原写 `AsyncIterable<string>` | `sillyhub-daemon/src/interactive/input-queue.ts` 真实为 `AsyncIterable<SDKUserMessage>` | conflict，若照原设计实现会把抽象做歪 | D-009：改为 provider-neutral `UserTurnInput`，driver 内部各自转换 |
| X-002 | consistency | Codex approval parity | design.md 曾要求 Codex command/file request 不自动 accept | `InteractiveSessionPanel` 创建 session 时传 `manual_approval:true, ask_user_only:true`；`SessionManager._buildCanUseToolCallback` 在 ask-only 模式对普通工具 allow-through | conflict，Codex 若普通审批全弹卡会比 Claude 重 | D-006：permission hook 必须尊重 `ask_user_only`，ask-only 只阻塞用户提问类请求 |
| X-003 | feasibility | Codex dialog payload | design.md 原写直接用 `item/tool/requestUserInput` 走 dialog | `AskUserDialogCard` 只解析 `questions/options`；Codex schema response 是 `{answers:{[questionId]:{answers:string[]}}}` | feasible with adapter，不能直传 raw payload | D-010：daemon 做 dialog payload 双向归一化 |
| X-004 | consistency | backend permission gate | Codex dialog/approval 要复用 `PERMISSION_REQUEST` | `DaemonPermissionService.handle_permission_request` 要求 `session.config.manual_approval is True` | ok，runtime panel 已传 `manual_approval:true` | plan 中保留并测试 createSession 参数 |
| X-005 | feasibility | Codex reopen | design.md 要 `thread/resume` | 本机 schema 存在 `thread/resume`，backend `reopen_session()` 只是 provider gate 限制 Claude | ok | backend 放开 `{"claude","codex"}` |
| X-006 | architecture | provider 扩展性 | design.md 使用 driver registry | daemon 当前 `SessionManagerDeps.driver` 单例 Claude | ok with refactor | plan 拆出 `InteractiveDriver` registry，保留 `driver` 兼容入口 |

## Question Distribution

| 分类 | 数量 | 含义 |
| --- | --- | --- |
| immediately_answered | 3 | 输入类型、approval 策略、dialog payload 均可由源码/schema 直接判定并修正 |
| needs_thinking | 0 | 无需用户业务判断 |
| unresolved | 0 | 无 P0/P1 未决阻塞 |

## Unresolved Blockers

| ID | priority | 问题 | 阻塞原因 | 下一步 |
| --- | --- | --- | --- | --- |
| - | - | 无 | - | 进入 plan |

## Accepted Corrections

- `design.md §5.1`：driver input 从 `AsyncIterable<string>` 改为 provider-neutral `UserTurnInput`。
- `design.md §5.3`：Codex approval/dialog 逻辑改为尊重 `manual_approval` + `ask_user_only` 策略。
- `design.md §5.5`：Claude/Codex parity 矩阵明确 ask-only 与 full-review 的行为一致性。
- `decisions.md`：新增 D-009、D-010，并修正 D-006。
