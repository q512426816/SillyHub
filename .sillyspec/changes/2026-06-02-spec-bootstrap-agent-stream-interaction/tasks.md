---
author: qinyi
created_at: 2026-06-02T09:49:00
---

# Tasks

- [ ] 后端：重构 `backend/app/modules/spec_workspace/bootstrap.py` 为异步 AgentRun + ClaudeCodeAdapter 执行
- [ ] 后端：更新 `backend/app/modules/spec_workspace/router.py` 的 `/spec-bootstrap` 响应语义
- [ ] 后端：新增 Agent run 用户输入接口到 `backend/app/modules/agent/router.py` / `service.py`
- [ ] 后端：更新 `backend/app/modules/spec_workspace/tests/test_bootstrap.py`
- [ ] 后端：补充 Agent 输入接口与 SSE 行为测试
- [ ] 前端：更新 `frontend/src/lib/spec-workspaces.ts` 和 `frontend/src/lib/agent.ts`
- [ ] 前端：更新 Workspace 详情页 bootstrap 内联日志和输入入口
- [ ] 前端：更新 Agent 控制台待确认/指导输入入口
- [ ] 文档：同步 `.sillyspec/docs/backend/modules/spec_workspace.md`
- [ ] 文档：同步 `.sillyspec/docs/backend/modules/agent.md`
- [ ] 文档：同步 `.sillyspec/docs/frontend/scan/INTEGRATIONS.md` 和 `PROJECT.md`
- [x] Quick fix：修复 spec-bootstrap AgentRun stream 无输出返回问题
