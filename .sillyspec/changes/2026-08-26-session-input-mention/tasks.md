---
author: qinyi
created_at: 2026-08-26 21:36:01
change: 2026-08-26-session-input-mention
status: brainstorm
---

# 任务分解（会话输入框智能联想）

> 依赖 brainstorm 用户选定方案；以下按推荐方案 B 编排（已吸收独立复核 6 条
> 必须修订项，见 review-feasibility.md）。方案 A = 仅 W1。

## W1 前端联想（纯前端，可独立交付）

- T1.1 `frontend/src/lib/session-mention.ts`：`detectMention(value, caret)` 触发
  检测 + 选中回填纯函数；jsdom 单测（词首/行首/空白中断/回填 `/team ` 后浮层
  关闭与整条 /team 拦截兼容）。
- T1.2 `session-mention-popover.tsx` 浮层组件：分组渲染（指令/技能；变更/快速修复）、
  过滤、键盘（↑↓/Enter/Tab/Esc）、无障碍 role、空态（manifest 404 → 空态引导）；
  单测覆盖键盘与过滤。
- T1.3 `session-input-bar.tsx` 接入：onChange 读 selectionStart 检测驱动浮层、
  composition 保护、`onMentionsChange` 回传、placeholder 文案、**光标回填模式**
  （pendingCaretRef + useEffect 延迟 setSelectionRange，用例断言回填后光标位置）；
  单测覆盖 Enter 拦截/放行边界。
- T1.4 数据 hook：复用 `usePlatformSkillsManifest`、`listChanges`、
  `listQuicklogEntries`（placeholder 过滤、workspaceId 为空禁用 @）；挂载
  prefetch + staleTime 5min。
- T1.5 `session-panel.tsx` 接线：3 渲染点传 onMentionsChange + **6 个发送组装
  点位**（createSession：page 预会话 / dialog；injectSession：sendFromQueue /
  sendToServerQueue / dialog submitFollowup；重发链路不携带 mentions 列 R-7 取舍）；
  预会话 create 绑定（FR-05）+ 发送成功清 pendingMentions；回归 `/team`、附件、
  草稿既有用例。

## W2 后端最小扩展（依赖 T1.5 定稿请求体）

- T2.1 `skills_bundle_service.py` `_summarize_skills` invoke_name 透传（:226/:230/
  :232-234 三处；**无响应模型可改**，端点返回 dict）；测试落
  `test_skills_bundle.py`（FR-07）。
- T2.2 `SessionInjectRequest` + bind 字段（不纳入空 prompt 豁免）；**三层透传
  同步**（router :2305 → Facade service.py:692 → SessionService :2171）；
  binder 插入 `SessionService.inject_session` 归属校验（:2242）后、tool_report
  分支（:2258）前——覆盖忙轮排队早退；显式传 `session.workspace_id` + None
  守卫（照抄 create 先例 :1220-1232）+ best-effort 失败告警。pytest 用例：
  `test_session_service.py`（幂等/None 守卫/跨 workspace 只在会话工作区建
  placeholder）、`test_session_router.py`（端点字段校验）、
  `test_session_queue.py`（**忙轮排队路径仍绑定**）。
- T2.3 前端 `daemon.ts` injectSession 组装 + `custom-skills.ts`
  PlatformSkillSummary 手写加 invoke_name（注释标注来源）+ `pnpm gen:types`
  重生成并提交 `frontend/src/lib/api-types.ts` / `backend/openapi.json`。

## W3 验收

- T3.1 全量回归：backend pytest、frontend vitest + tsc + lint。
- T3.2 冒烟（硬性）：真实会话实测 `/技能`——平台**冒号名**技能与用户技能各一条
  可调起（R-1 收口）；`@变更`/`@快速修复` 发送后（含会话 running 忙轮排队场景）
  变更/quicklog 详情会话卡出现该会话；`/team` 行为不变。
