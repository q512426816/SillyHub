---
author: qinyi
created_at: 2026-08-26 21:36:01
change: 2026-08-26-session-input-mention
status: brainstorm
---

# 任务分解（会话输入框智能联想）

> 按已确认方案 B 编排；已吸收可行性复核 6 条修订 + Design Grill P1/gap 修正
> （7 发送点位 / bind_quick_id 128 / 测试路径 / 叠层用例），见
> review-feasibility.md 与 stage review。方案 A = 仅 W1。

## W1 前端联想（纯前端，可独立交付）

- T1.1 `frontend/src/lib/session-mention.ts`：`detectMention(value, caret)` 触发
  检测 + 选中回填纯函数；jsdom 单测（词首/行首/空白中断/回填 `/team ` 后浮层
  关闭与整条 /team 拦截兼容）。
- T1.2 `session-mention-popover.tsx` 浮层组件：分组渲染（指令/技能；变更/快速修复）、
  过滤、键盘（↑↓/Enter/Tab/Esc）、无障碍 role、空态（manifest 404 → 空态引导）；
  单测覆盖键盘/过滤/**与 team popover 及附件降级提示条的叠层互斥（R-5 落点）**。
- T1.3 `session-input-bar.tsx` 接入：onChange 读 selectionStart 检测驱动浮层、
  composition 保护、`onMentionsChange` 回传、placeholder 文案、**光标回填模式**
  （pendingCaretRef + useEffect 延迟 setSelectionRange，用例断言回填后光标位置）；
  单测覆盖 Enter 拦截/放行边界与 IME 组合期行为。
- T1.4 数据 hook：复用 `usePlatformSkillsManifest`、`listChanges`、
  `listQuicklogEntries`（placeholder 过滤、workspaceId 为空禁用 @）；挂载
  prefetch + staleTime 5min。
- T1.5 `session-panel.tsx` 接线：3 渲染点传 onMentionsChange + **7 个发送组装
  点位**（createSession：page 预会话 :1719 / dialog :3635；injectSession：
  page sendFromQueue :1546 / page sendToServerQueue :1612 / dialog
  submitFollowup :3428 / **dialog sendToServerQueue :3496（dialog 忙轮，漏改则
  FR-06 该场景静默失效；dialog 重发复用 submitFollowup 一并生效）**；page 重发
  :1952 不携带 mentions 列 R-7 取舍）；预会话 create 绑定（FR-05）+ 发送成功清
  pendingMentions；回归 `/team`、附件、草稿既有用例。

## W2 后端最小扩展（依赖 T1.5 定稿请求体）

- T2.1 `skills_bundle_service.py` `_summarize_skills` invoke_name 透传（:226/:230/
  :232-234 三处；**无响应模型可改**，端点返回 dict）；用例并入既有
  `backend/app/modules/daemon/tests/test_skills_bundle.py`（FR-07）。
- T2.2 `SessionInjectRequest` + bind 字段（`bind_quick_id` max_length=128 对齐
  create 契约；不纳入空 prompt 豁免）；**三层透传同步**（router → Facade
  service.py:692 → SessionService）；binder 插入 `SessionService.inject_session`
  行锁后、tool_report 早退分支前——覆盖忙轮排队早退；显式传
  `session.workspace_id` + None 守卫（照抄 create 先例 :1220-1232）；binder
  savepoint 已保证不抛，SessionService 仅记结果日志。pytest 用例：
  `test_session_service.py`（幂等/None 守卫/跨 workspace 只在会话工作区建
  placeholder/**bind 失败不阻断消息发送**）、`test_session_router.py`（端点
  字段校验）、`test_session_queue.py`（**忙轮排队路径仍绑定**）。
- T2.3 前端 `daemon.ts` injectSession 组装 + `custom-skills.ts`
  PlatformSkillSummary 手写加 invoke_name（注释标注来源）+ `pnpm gen:types`
  重生成并提交 `frontend/src/lib/api-types.ts` / `backend/openapi.json`。

## W3 验收

- T3.1 全量回归：backend pytest、frontend vitest + tsc + lint。
- T3.2 冒烟（硬性）：真实会话实测 `/技能`——平台**冒号名**技能与用户技能各一条
  可调起（R-1 收口）；`@变更`/`@快速修复` 发送后（含会话 running 忙轮排队
  **page 与 dialog 双路径**）变更/quicklog 详情会话卡出现该会话；`/team` 行为
  不变。
