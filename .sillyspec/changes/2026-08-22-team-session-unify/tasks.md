---
author: qinyi
created_at: 2026-08-22 03:28:02
---

# 任务清单（Tasks）

> 任务名唯一真相源；plan.md Wave 段纯 ID 引用。task-XX 卡片在 tasks/task-NN.md 由蓝图步骤展开。

- [ ] task-01: backend 数据模型迁移——agent_missions.session_id 列 + 索引 + 活跃态部分唯一索引（alembic）
- [ ] task-02: derive_status 兼容扩展——awaiting_input 档 + session_id NULL 守卫 + 判据矩阵全格单元测试 (depends_on: task-01)
- [ ] task-03: 会话团队触发/列表端点——POST/GET /daemon/sessions/{id}/team-mission(s) + DTO + 409 + scope 冻结 + objective 占位 (depends_on: task-01)
- [ ] task-04: inject 主控轮双标记——活跃 mission 回填 mission_id+role='orchestrator' + objective 首条回填 (depends_on: task-01)
- [ ] task-05: mcp_tools 会话定位——X-Session-Id 解析 + dispatch_worker 懒建（补回填双标记 + 并发守卫 + 无工作区 422 + 默认预算上限） (depends_on: task-02, task-03, task-04)
- [ ] task-06: converge 语义重定义——busy 引导 + converged_at 独立置位 + finalizer/_get_main_run 锚点取最新 orchestrator run（适配 test_mcp_tools.py 既有 converge 用例断言） (depends_on: task-04, task-05)
- [ ] task-07: 治理门/workers/成本查询判别——control.py 等加 role!='orchestrator'（MAX_WORKERS/成本/workers 列表）
- [ ] task-08: patrol/schedule_loop 适配——awaiting_input 超时自动收敛 + 僵尸判定按会话活跃 + redispatch 存量 no-op (depends_on: task-02, task-06)
- [ ] task-09: daemon 注入谓词（claude 且 stage∈{空,'orchestrator'}）+ 分身 stage 常量化 'mission_worker'（role 移 lease metadata，cli.ts + execution.py；适配 cli.ts 谓词与 execution stage 相关既有用例）
- [ ] task-10: daemon MCP 会话上下文 + 工具改造——env MCP_SESSION_ID + hub-client X-Session-Id + mcp-server 参数可选化与描述重写（适配参数 schema 相关既有用例） (depends_on: task-09；spike-01 通过后按原方案，否则 fallback 参数显式)
- [ ] task-11: 前端触发入口——派团队按钮+配置弹层+状态 chip + /team 指令 + Codex 置灰 + 「用团队分析」两处改造 + TeamTaskBlock 挂载 (depends_on: task-03, task-12)
- [ ] task-12: 前端 TeamTaskBlock（概要/分身明细/日志产物/取消）+ 进度视图分身段块与 MCP 工具卡 + lib/daemon.ts API client (depends_on: task-03)
- [ ] task-13: 删除旧入口——mission-console/两页面路由/菜单项/lib/agent.ts create+list client + backend agent/router.py 删 create+list 四端点（保留 GET /missions/{id} 与 cancel）+ 全仓引用清理（保留 getMission/cancelMission） (depends_on: task-11)
- [ ] task-14: 类型同步（frontend/daemon api-types + backend openapi.json）+ agent/daemon 模块文档更新收尾 (depends_on: task-05, task-06, task-08, task-10, task-11, task-12, task-13)
