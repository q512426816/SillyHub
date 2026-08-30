---
author: qinyi
created_at: 2026-08-26 21:36:01
change: 2026-08-26-session-input-mention
status: plan
---

# 任务分解（会话输入框智能联想）

> 按已确认方案 B 编排；已吸收可行性复核 6 条修订 + Design Grill P1/gap 修正 +
> Plan Review 结构修正（6 Wave），见 review-feasibility.md 与两份 stage review。
> Wave 分组与依赖见 plan.md；详细要点在下方各任务行内。

## W1 前端基础 + 后端扩展（并行起步）

- [x] task-01: `frontend/src/lib/session-mention.ts` 触发检测/回填纯函数 + jsdom 单测（词首/行首/空白中断/回填 `/team ` 后浮层关闭与整条 /team 拦截兼容） (depends_on: —)
- [x] task-04: 联想数据 hooks——复用 usePlatformSkillsManifest/listChanges/listQuicklogEntries（placeholder 过滤、workspaceId 为空禁用 @；挂载 prefetch + staleTime 5min）；仅用现有字段，不消费 invoke_name（其类型在 task-08 才加入） (depends_on: —)
- [x] task-06: 后端 `_summarize_skills` invoke_name 透传（skills_bundle_service.py :226/:230/:232-234；端点返回 dict 无响应模型可改）；用例并入既有 `backend/app/modules/daemon/tests/test_skills_bundle.py` (depends_on: —)
- [x] task-07: 后端 `SessionInjectRequest` 加 `bind_change_key`(≤200)/`bind_quick_id`(≤128, ql-* 模式，对齐 create 契约；不纳入空 prompt 豁免)；三层透传同步（router → Facade service.py:692 → SessionService）；binder 插入行锁后、tool_report 早退前（覆盖忙轮排队）；显式传 session.workspace_id + None 守卫；pytest：test_session_service（幂等/None 守卫/跨 workspace 只在会话工作区建 placeholder/bind 失败不阻断）、test_session_router（字段校验）、test_session_queue（忙轮排队仍绑定） (depends_on: —)

## W2 浮层组件 + 前端类型组装

- [x] task-02: `session-mention-popover.tsx` 浮层组件——分组渲染（指令/技能；变更/快速修复）、过滤（前缀优先）、键盘（↑↓/Enter/Tab/Esc）、无障碍 role、空态（manifest 404 引导）；**onSelect 抛原始实体对象（不在浮层内读 invoke_name，回填名 `invoke_name ?? name` 由 task-03 接入层计算）**；单测含键盘/过滤/与 team popover 及附件降级提示条叠层互斥（R-5 落点） (depends_on: task-01, task-04)
- [x] task-08: 前端类型与组装——`daemon.ts` injectSession 透传 bind 字段、`custom-skills.ts` PlatformSkillSummary 手写加 invoke_name（注释标注来源）、`pnpm gen:types` 重生成并提交 `frontend/src/lib/api-types.ts` + `backend/openapi.json`（规则 21） (depends_on: task-06, task-07)

## W3 输入框接入

- [x] task-03: `session-input-bar.tsx` 接入——onChange 读 selectionStart 检测驱动浮层、composition 保护（start/end + 最终文本重检）、`onMentionsChange` 回传、回填名计算（`invoke_name ?? name`）、光标回填模式（pendingCaretRef + useEffect 延迟 setSelectionRange，用例断言光标位置）；**placeholder prop 保持父级传入不动（文案更新在 task-05）**；单测新文件 `__tests__/session-input-bar-mention.test.tsx` 覆盖 Enter 拦截/放行边界与 IME 行为；回归既有 turn-timeline-session-input-bar.test.tsx（getByPlaceholderText 精确断言 6 处）与 session-input-bar-height.test.tsx (depends_on: task-02)

## W4 会话面板接线

- [x] task-05: `session-panel.tsx` 接线——3 渲染点传 onMentionsChange + placeholder 文案更新（3 传参处追加「/ 唤起技能 · @ 关联变更」提示，FR-08）+ **7 个发送组装点位**（createSession：page 预会话 :1719 / dialog :3635；injectSession：page sendFromQueue :1546 / page sendToServerQueue :1612 / dialog submitFollowup :3428 / **dialog sendToServerQueue :3496（dialog 忙轮，漏改则 FR-06 该场景静默失效；dialog 重发复用 submitFollowup 一并生效）**；page 重发 :1952 不携带 mentions 列 R-7 取舍）；预会话 create 绑定（FR-05：change_id/quicklog_id）+ 发送成功清 pendingMentions；回归 `/team`、附件、草稿及 session-panel-* placeholder 相关既有用例 (depends_on: task-03, task-08)

## W5 全量回归

- [x] task-09: 全量回归——backend `uv run pytest -q`（覆盖率 ≥60%）+ frontend `pnpm test` / `pnpm typecheck` / `pnpm lint`（local.yaml 命令） (depends_on: task-01~08)

## W6 冒烟硬验收

- [x] task-10: 冒烟硬验收——真实会话实测 `/技能`（平台**冒号名**技能与用户技能各一条可调起，R-1 收口）；`@变更`/`@快速修复` 发送后（含 running 忙轮排队 **page 与 dialog 双路径**）变更/quicklog 详情会话卡出现该会话；`/team` 行为不变 (depends_on: task-05, task-07, task-09)
