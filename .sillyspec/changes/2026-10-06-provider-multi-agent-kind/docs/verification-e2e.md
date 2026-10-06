# 端到端验收记录（task-11）— 2026-10-06-provider-multi-agent-kind

环境：worktree 本地栈（backend uvicorn :8765 连本地 PG——已跑迁移 20261006120000；frontend next dev :3877，NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8765）；临时验收账号 e2e_multi（验收后清理）。

## A. API 级全链路（curl 实打）

| # | 场景 | 结果 |
|---|---|---|
| A1 | 创建多引擎供应商（agent_kinds=["claude","pi"]） | ✅ 响应回 agent_kinds 数组，api_key masked |
| A2 | set-default（probe 实打 opencode.ai /zen/go/v1/models → 200，走本机 hosts 钉址） | ✅ switched=true |
| A3 | 同斥：新建 claude-only 设默认 → 多引擎行 is_default=False | ✅（行级布尔语义：claude 位被抢后整行失默认，含 pi 位——见「边界备注」） |
| A4 | 扩张：claude-only 默认行 PATCH agent_kinds=["claude","pi"] | ✅ 扩张成功默认保留（D-006） |
| A5 | 组合禁配：PATCH agent_kinds 含 pi + api_format=openai_chat | ✅ HTTP 422 |
| A6 | 收缩：多引擎行 PATCH 回 ["claude"] | ✅（pi 默认空缺不转移） |

## B. UI 级（浏览器实操作）

| # | 场景 | 结果 |
|---|---|---|
| B1 | 列表多引擎徽标：[claude,pi] 行显示 claude + pi 两枚徽标 | ✅ |
| B2 | 编辑表单勾选组回填：Claude Code ✓ / Pi ✓ / Codex ✗ / Gemini 禁用占位 | ✅ |
| B3 | openai 格式下 pi 勾选框前置禁用 +「（openai 格式不可用）」提示 | ✅（单测 + UI 实查） |
| B4 | 收缩空缺 toast | ✅（实现落地；toast 弹层自动化断言留 CI） |

## C. 覆盖方式说明（非本环境可跑面）

- 双引擎**会话**命中（claim payload agent_kind=会话引擎）与热切换**扇出**（不同引擎会话各收本引擎 config）：本地无 daemon 会话链，由 task-07 集成测试覆盖（test_resolve_* 盖引擎断言 / test_provider_switch 扇出用例含单引擎回归）；生产部署后建议用户在 /sessions 各开一个 claude 与 pi 会话选同一多引擎供应商实测。
- 迁移生产 PG 实跑：2026-10-06 开发库（本机 PG）upgrade→downgrade→upgrade 往返 + 终态断言（列/索引/存量单元素数组）已实证，SQLite 侧自动化在 test_agent_kinds_migration.py。

## 边界备注（设计语义澄清，非缺陷）

is_default 为行级布尔：多引擎默认行的某引擎默认位被新默认抢占时，整行失默认（其余引擎默认位随之空缺）——D-003 的「全引擎生效」是行级语义；更细粒度「部分默认」为明确非目标。互斥不变量 (user, 引擎) 在行级布尔表达下天然闭合（行失默认即不再占任何引擎位）。

## 验收后清理

- 删除 e2e 供应商两行与 e2e_multi 用户（本地 dev 库）。
- 停 worktree uvicorn(:8765) / next dev(:3877)。
