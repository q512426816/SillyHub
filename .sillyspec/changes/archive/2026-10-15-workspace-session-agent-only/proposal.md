---
author: flow-machine-draft
created_at: 2026-10-15T07:52:06.615Z
---
# 提案书（Proposal）— 2026-10-15-workspace-session-agent-only

## 动机

任务原话转写：工作区中新建会话不再选机器：机器已由工作区绑定决定，浮层只让用户选智能体类型

动机：会话新建浮层（PreSessionPicker）当前统一两步——① 选在线机器 ② 选该机器上的智能体。但用户是在某个工作区（工作区分组、工作区会话页、移动工作区会话页）里新建会话时，机器已由该工作区对本人的绑定（workspace_member_runtimes.daemon_id）确定，再让用户选机器既多余，又可能选到与该工作区无关的机器（会话 cwd 语义落错机器）。期望：工作区上下文中新建会话跳过机器选择，直接展示该工作区绑定机器上的智能体供选择；「非工作区」分组与无绑定的场景保持现状两步。

成功标准：
- 工作区上下文（分组/scope 带 workspaceId 且当前用户对该工作区有绑定机器）触发新建：浮层不再出现「① 机器（仅在线）」步骤，直接列出绑定机器上的在线智能体（claude/codex/pi/cursor）
- 绑定机器离线或不可见时：浮层给出明确空态文案（绑定机器离线/不可用，去工作区页重绑），不落回全机器列表
- 工作区无可解析绑定时保持原两步流程；「非工作区」分组保持原两步流程（零回归）
- 列表两层筛选已选智能体时，工作区分组「＋」在绑定机器上命中该引擎则直带上下文进预会话（机器取绑定机器，不再取筛选机器）
- ?new=1 直达（workspace/change/quicklog scope）改为解析绑定机器上的默认智能体（优先 claude、其次 codex），未命中自动弹只选智能体的浮层兜底
- 移动端工作区会话页（含 FAB 与空态入口）同样跳过机器选择
- 相关 vitest 用例通过（pre-session-picker / sessions-portal / floating-session-host / 移动会话页），frontend typecheck 通过

## 变更范围

按成功标准机械推导，共 7 条验收面：
1. 工作区上下文（分组/scope 带 workspaceId 且当前用户对该工作区有绑定机器）触发新建：浮层不再出现「① 机器（仅在线）」步骤，直接列出绑定机器上的在线智能体（claude/codex/pi/cursor）
2. 绑定机器离线或不可见时：浮层给出明确空态文案（绑定机器离线/不可用，去工作区页重绑），不落回全机器列表
3. 工作区无可解析绑定时保持原两步流程；「非工作区」分组保持原两步流程（零回归）
4. 列表两层筛选已选智能体时，工作区分组「＋」在绑定机器上命中该引擎则直带上下文进预会话（机器取绑定机器，不再取筛选机器）
5. ?new=1 直达（workspace/change/quicklog scope）改为解析绑定机器上的默认智能体（优先 claude、其次 codex），未命中自动弹只选智能体的浮层兜底
6. 移动端工作区会话页（含 FAB 与空态入口）同样跳过机器选择
7. 相关 vitest 用例通过（pre-session-picker / sessions-portal / floating-session-host / 移动会话页），frontend typecheck 通过

## 成功标准（可验证）

1. 工作区上下文（分组/scope 带 workspaceId 且当前用户对该工作区有绑定机器）触发新建：浮层不再出现「① 机器（仅在线）」步骤，直接列出绑定机器上的在线智能体（claude/codex/pi/cursor）
2. 绑定机器离线或不可见时：浮层给出明确空态文案（绑定机器离线/不可用，去工作区页重绑），不落回全机器列表
3. 工作区无可解析绑定时保持原两步流程；「非工作区」分组保持原两步流程（零回归）
4. 列表两层筛选已选智能体时，工作区分组「＋」在绑定机器上命中该引擎则直带上下文进预会话（机器取绑定机器，不再取筛选机器）
5. ?new=1 直达（workspace/change/quicklog scope）改为解析绑定机器上的默认智能体（优先 claude、其次 codex），未命中自动弹只选智能体的浮层兜底
6. 移动端工作区会话页（含 FAB 与空态入口）同样跳过机器选择
7. 相关 vitest 用例通过（pre-session-picker / sessions-portal / floating-session-host / 移动会话页），frontend typecheck 通过
