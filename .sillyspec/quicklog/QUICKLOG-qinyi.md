## ql-20260604-001-progress | 2026-06-04 10:43:13 | 清除 progress.json 残留引用

状态：已完成
文件：backend/app/core/spec_paths.py、backend/app/modules/runtime/service.py、backend/app/modules/runtime/schema.py、backend/app/modules/runtime/tests/test_router.py
摘要：删除 progress.json fallback 逻辑，改用 SQLite sillyspec.db。测试通过 4/4。

## ql-20260605-001-a3f2 | 2026-06-05 09:33:54 | 修复 bootstrap scan --dir 指向 source_root 并添加 preflight 检查
状态：已完成
文件：backend/app/modules/agent/context_builder.py、backend/app/modules/agent/adapters/claude_code.py、backend/app/modules/spec_workspace/bootstrap.py、backend/tests/modules/agent/test_context_builder.py
摘要：修改 4 文件：(1) context_builder.py --dir→root_path, allowed_paths 加入 root_path (2) claude_code.py scan fallback --dir→root_path (3) bootstrap.py 重写 bundle 为完整平台参数命令, lease_path→code_root, 新增 _run_preflight (4) test_context_builder.py 更新断言+5 个 preflight 测试。18/18 通过。

## ql-20260605-002-b7c1 | 2026-06-05 09:49:08 | 放宽 preflight 签名检查：支持递归子目录和更多项目特征
状态：已完成
文件：backend/app/modules/spec_workspace/bootstrap.py、backend/tests/modules/agent/test_context_builder.py
摘要：放宽 preflight 签名检查。_PLATFORM_ENTRIES 加入 README.md/.git，增加一层子目录递归检测。新增 4 个测试覆盖边界场景。21/21 通过。已重新部署。

## ql-20260605-003-c8e4 | 2026-06-05 10:42:58 | Agent 执行 Token/Cost 和上下文追踪
状态：已完成
文件：backend/app/modules/agent/base.py、backend/app/modules/agent/adapters/claude_code.py、backend/app/modules/agent/model.py、backend/app/modules/agent/service.py、backend/app/modules/agent/schema.py、backend/migrations/versions/202606240900_add_agent_usage_fields.py、backend/app/modules/agent/tests/test_adapter_isolation.py
依据：C:\Users\qinyi\.claude\plans\agent-token-moonlit-squid.md
摘要：AgentRunResult 新增 6 字段（total_cost_usd/duration_ms/duration_api_ms/num_turns/session_id/conversation_events），适配器解析 CLI result 事件元数据，3 个执行路径持久化，API 响应暴露 5 字段，新增迁移+4 个测试。14/14 通过。

## ql-20260605-004-d5a7 | 2026-06-05 11:10:21 | 前端展示 Agent Run Usage/Cost 数据
状态：已完成
文件：frontend/src/lib/agent.ts、frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
摘要：AgentRun type 新增 5 字段，Active Runs 卡片 Cost 用真实数据，Completed Runs 表新增 Cost/Turns 列，展开日志新增 Usage/Cost 摘要卡片。
