---
author: qinyi
created_at: 2026-08-14 15:33:16
---

# 模块影响分析（Module Impact）— 变更中心会话驱动化

> 首版（plan 阶段）。执行/验证阶段按实际代码变更更新；归档阶段最终确认。

## 影响矩阵

| 模块 | 影响类型 | 涉及文件（design §6 清单） | 说明 |
|---|---|---|---|
| change | 修改 | `backend/app/modules/change/service.py` | reparse 加 scope（零删除守卫）、review 四方法删派发+投影收敛+服务身份注入、created 新变更绑会话 |
| change | 新增 | `backend/app/modules/change/model.py`（ChangeSessionLink） | 新模型 + 关联表 |
| change（migrations） | 新增 | `backend/alembic/versions/2026xxxx_add_change_session_links.py` | 建表 migration |
| change | 修改 | `backend/app/modules/change/parser.py` | parse_workspace 支持按 key 过滤（scoped） |
| change_writer | 删除 | `backend/app/modules/change_writer/router.py` | create/proxy-create/execute/documents 端点删除 |
| spec_workspace | 修改 | `backend/app/modules/spec_workspace/schema.py` | SpecIncrementalSyncRequest 加 change_dirs |
| spec_workspace | 修改 | `backend/app/modules/spec_workspace/service.py` | apply_ops 事务外触发 scoped reparse（含兜底/归档走全量） |
| agent | 修改 | `backend/app/modules/agent/router.py` | agent-sessions 加 include_ended（扩展非新增） |
| mcp_gateway | 修改 | `backend/app/modules/mcp_gateway/tools.py` | submit_stage_review docstring/返回契约同步 |
| daemon（前端链路） | 修改 | `sillyhub-daemon/src/spec-sync.ts` + `hub-client.ts` | 增量同步 change_dirs 标注 |
| frontend | 新增 | `workspaces/[id]/sessions/page.tsx` + `components/workspace-session-section.tsx` | 工作区会话页 |
| frontend | 修改 | `components/workspace-tabs.tsx`、`workspaces/[id]/changes/page.tsx`、`changes/[cid]/page.tsx`、`components/changes/detail/change-stage-actions.tsx`、`lib/changes.ts`、`lib/daemon.ts` | 会话 tab/去表单/详情页退化/审批卡/客户端清理 |
| frontend | 删除 | `workspaces/[id]/create-change/page.tsx`（+ 其 __tests__） | 表单页下线 |
| frontend | 修改 | `lib/api-types.ts`（gen:types 再生成） | 类型同步 |
| 平台文档 | 修改 | `.sillyspec/docs/backend/modules/{change,spec_workspace,agent,mcp_gateway,change_writer,daemon}.md` + `_module-map.yaml` | 文档同步 |
| daemon（Node 测试） | 修改 | `sillyhub-daemon/tests/{test_pull_before_push,test_init_lease,spec-sync}.test.ts` | verify 期间修复 3 处预存断言漂移（postSpecSync 2 参断言 vs HEAD 3 参生产调用，非本 change 引入，断言补第三参 undefined 对齐） |

## 模块依赖关系摘要

- `change` ←（reparse/审批调用方）→ `spec_workspace`（apply_ops 触发 reparse）：新增「增量同步→scoped reparse→绑定会话」依赖方向。
- `change` → `platform_sync`：审批投影收敛新增 upsert platform_change_progress 调用（既有依赖强化）。
- `change` → `agent`：reparse 绑定会话读 AgentSession + 审批注入复用 session 服务（新增跨模块调用）。
- `daemon`（Node）↔ `spec_workspace`（Python）：change_dirs 标注契约跨进程（请求体字段，best-effort 容错）。

## unmapped

本变更涉及文件全部映射到上述模块（`sillyhub-daemon/src/` 归 daemon 模块，`frontend/src/` 归 frontend 模块），无 unmapped。
