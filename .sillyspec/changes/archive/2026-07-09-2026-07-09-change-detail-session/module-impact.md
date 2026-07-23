---
author: qinyi
created_at: 2026-07-09T20:40:00+08:00
---

# 模块影响分析（Module Impact）— 变更详情页内嵌会话

## 三重交叉验证

| 来源 | 范围 | 一致性 |
|---|---|---|
| 声明范围（design §6 文件清单） | 12 文件（model/migration/router×2/service×2/schema/context/page/panel/daemon.ts/section） | — |
| 任务范围（plan.md task-01~15） | 覆盖 design 12 文件 + 测试文件 | — |
| 真实变更（git diff HEAD~1 = commit 6bf7b4a0） | 18 文件（12 源 + 6 测试/新组件/migration） | 以 git diff 为准 |

声明/任务/真实一致：测试文件 + migration 为任务产出（声明 §6 标注"新增"但未穷举测试），无冲突。

## 模块影响矩阵

按 monorepo 顶层模块（_module-map.yaml：backend / frontend）+ 子区域细粒度：

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| backend.agent | 数据结构变更 + 调用关系变更 | app/modules/agent/model.py, placement.py, tests/test_agent_session_model.py, tests/test_interactive_session_placement.py | AgentSession 加 change_id/workspace_id 列+索引(D-001); prepare_interactive_dispatch 透传 workspace_id/cwd 到 lease metadata(R-02 接线, lease/context ws_id 分支消费) | false |
| backend.daemon | 接口变更 + 逻辑变更 + 数据结构 + 新增 | app/modules/daemon/router.py, service.py(facade), session/service.py, session/context.py(新), schema.py, tests/test_change_session.py | SessionCreateRequest+create_session 端点+facade 透传 change_id/workspace_id; create_session 写绑定+解析 cwd(Workspace.root_path); build_change_context_preamble 前导注入(dispatch prompt=前导+用户消息, AgentRunLog 干净 X-02/X-04); AgentSessionRead+AgentSessionListItem DTO | false |
| backend.change | 接口变更 + 新增 | app/modules/change/router.py | GET /workspaces/{wid}/changes/{cid}/sessions 跨成员列表端点(D-005, CHANGE_READ) | false |
| backend.migrations | 数据结构变更 | migrations/versions/419d34f8e33f_add_change_workspace_to_agent_sessions.py | agent_sessions 加 change_id/workspace_id 列+索引+FK(SET NULL); down_revision=20260707_custom_skills(单一 head, 迁移链无分叉) | false |
| frontend.daemon | 接口变更 + 调用关系变更 | src/lib/daemon.ts, components/daemon/interactive-session-panel.tsx, components/daemon/__tests__/interactive-session-panel-changeid.test.tsx | SessionCreateRequest 加 change_id/workspace_id + createSession body 透传 + listChangeSessions; InteractiveSessionPanel props changeId/workspaceId 透传 | false |
| frontend.changes | 新增 | src/components/changes/change-session-section.tsx, __tests__/change-session-section.test.tsx | 新建 ChangeSessionSection(左历史 listChangeSessions 跨成员显作者 + 右复用 Panel + attach 切换恢复) | false |
| frontend.详情页 | 调用关系变更 | src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 变更详情页 AgentRunPanel 后插入会话区块 | false |

## 未匹配文件

无（18 文件全部匹配 _module-map.yaml 的 backend/** 与 frontend/** paths glob）。

## needs_review 说明

全部 false。本变更复用既有 interactive 生命周期（design §7.5/§9），不改 session/lease/run 状态机语义，影响边界清晰（加 nullable 绑定列 + 前导注入 + 独立列表端点 + 前端组件），无不确定影响。

## 备注

- **零 sillyhub-daemon 改动**（X-02 纯后端前导注入，dispatch prompt 通道，非 system_prompt）
- **零 deploy/build/ci 改动**
- 两处实现细节层面 allowed_paths 偏差（task-03 补 facade daemon/service.py、task-05 接线点 placement.py 而非 lease/），已记入 review，方案无异议
