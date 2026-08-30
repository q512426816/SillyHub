---
author: qinyi
created_at: 2026-07-11 23:36:07
---

# 提案书（Proposal）

## 动机

平台有两个会话入口：`/runtimes?session=...` 弹窗（`RuntimeSessionDialog`）与变更详情页内嵌会话区（`ChangeSessionSection`）。二者样式与交互各搞一套：

- runtimes 弹窗左侧列表是裸会话 ID + 提供方 + 删除按钮、贴边无框；变更会话是标题 + 状态 + 作者 + 时间、独立圆角卡片、蓝色选中边框、顶部新建按钮。
- runtimes 弹窗 attach 续聊时右侧多一个「返回历史」栏；变更会话直接是会话面板。
- runtimes 弹窗点已结束/失败的会话只读回看，要点「继续对话」才能 reopen；变更会话点开即续聊。

同时 runtimes 弹窗 attach 历史会话时，消息区把 `[SYSTEM:thinking_tokens]`、`[THINKING]` 等原始标记当正文渲染，且内容重复显示——因为 attach 历史预填的 `logsToTurns` 没像实时 SSE 的 `renderLogContent` 那样过滤标记。

另外删除会话当前是物理删除（硬删会话行），用户要求改为逻辑删除（软删，会话行保留可审计）。

## 关键问题

1. **样式分叉**：两套会话列表样式各自演进，视觉与交互割裂，维护双份。
2. **消息渲染 BUG**：`logsToTurns`（attach 历史预填）未复用 `renderLogContent` 的过滤逻辑，thinking/SYSTEM/AskUserQuestion 标记泄漏到正文 + 内容重复。
3. **删除即销毁**：`delete_agent_session` 物理删会话行，无法审计/恢复。
4. **列表无标题**：`list_agent_sessions` 不返回 `title`，runtimes 弹窗只能显示裸会话 ID。

## 变更范围

- **前端公共件**：新增 `SessionListLayout` 组件（标准化列表项 + 圆角卡片 + 蓝色选中 + 可选删除按钮），runtimes 弹窗与变更会话两处复用；抽共享纯函数 `sanitizeSessionLogContent`，`renderLogContent` 和 `logsToTurns` 都调用。
- **前端重构**：`RuntimeSessionDialog` 左侧换 `SessionListLayout`、右侧去掉「返回历史」栏直接挂 `InteractiveSessionPanel`、删只读回看分支、ended/failed 选中先 reopen 再 attach；`ChangeSessionSection` 左侧改用 `SessionListLayout` 并同步加 ended/failed reopen；`logsToTurns` 修标记过滤 + 内容去重 BUG。
- **后端**：`AgentSession` 加 `deleted_at` 列 + migration；`delete_agent_session` 改 `UPDATE deleted_at`（不再删行/断外键）；`list_agent_sessions`/`list_change_sessions`/`get_agent_session` 过滤软删；`list_agent_sessions` 返回值补 `title`（首条 user_input 摘要前 30 字）；`AgentSessionRead` 加 `title`/`deleted_at`。
- **测试**：前端 `SessionListLayout`/`runtime-session-dialog`/`logsToTurns` 新测 + `change-session-section` 回归；后端 `test_session_delete_active.py` 断言改软删 + list title/软删过滤用例。

## 不在范围内（显式清单）

- 不做会话搜索 / 排序 / 批量删除 / 软删项恢复 UI。
- 不改 `sillyhub-daemon`（daemon 侧 session 逻辑不动）。
- 不改 runtimes 弹窗 URL `?session=` 恢复点机制（page.tsx 已正确）。
- 不删除 `SessionHistoryView`/`SessionsSidebar` helper（保留供潜在引用，弹窗内不再用）。
- 不要求历史数据兼容（规则 10，migration 直接加列）。

## 成功标准（可验证）

- `/runtimes?session=<id>` 弹窗左侧列表与变更会话视觉一致（圆角卡片 / 标题+状态+提供方+轮数+时间 / 蓝色选中边框 / 顶部新建按钮 / 保留删除按钮）。
- attach 历史会话：消息区**不再出现** `[SYSTEM:thinking_tokens]`/`[THINKING]`，**不再重复**用户消息与助手回复。
- 点 ended/failed 会话：直接进入可续聊面板（无「返回历史」栏、无只读回看），自动 reopen。
- 点删除：会话从列表消失；DB `agent_sessions` 该行 `deleted_at` 非空（行仍在、`agent_runs` 外键仍连、run/log 可查）。
- 变更会话区块零回归，且 ended/failed 会话同样支持点开直接续聊。
- 前后端单测全绿；migration 可逆；tsc/ruff/mypy 通过。

## 风险

- **migration head 冲突**：并行变更可能新增 alembic revision 撞 head，execute 前 `alembic heads` 复核唯一 head `419d34f8e33f`。
- **内容重复根因待证**：`logsToTurns` 与 SSE 去重的精确根因需 execute 时真实会话复现确认（C-4/F-3）。
- **attach ended reopen 失败**：SDK 上下文失效时 reopen 失败 → panel 转 failed + errorMsg，可接受（与现状一致）。
