---
author: qinyi
created_at: 2026-10-16 15:55:00
plan_level: full
execution_mode: main  # 缺省直写（R7/R8 对撞实证：小任务派发税 2-3×）；任务总量单会话可吞吐
change: 2026-10-16-fix-auth-random-logout
---
# 实现计划（Plan）— 2026-10-16-fix-auth-random-logout

## Spike 前置验证

无——技术方案无不确定性：alembic 增量加列/UPDATE 谓词/状态码分流均为既有栈既有模式，无需 Spike。

## Wave 1（并行，无依赖）
- task-01
- task-03

## Wave 2（依赖 Wave 1）
- task-02

## Wave 3（收尾，依赖 Wave 2）
- task-04

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 会话族 family_id 列 + alembic 增量迁移 | W1 | P0 | — | FR-01, D-001@v1 | model.py 加列 + 手写迁移 c3f8a1d6e2b4 + 链尾 head 锚测试前移；存量 NULL 自成一族语义靠代码兜底 |
| task-02 | 族级复用吊销 + 宽限窗300s + 后端族语义测试 | W2 | P0 | task-01 | FR-01, FR-02, FR-03, D-001@v1, D-002@v1, D-003@v1 | service 族传递链 + _revoke_session_family + 文案 + config 300s；测试先行（新文件 + 改造既有 grace 用例 2 + test_config_auth 默认值断言同步；符号影响扫描补录） |
| task-03 | 前端刷新状态码分流 + 测试 + 13调用点审计 | W1 | P0 | — | FR-04, FR-05, D-004@v1 | doRefresh 分流（5xx/408/429 抛错；4xx 返 null）+ api.ts 注释 + vitest + 调用点审计 |
| task-04 | auth-flow.md 文档同步 | W3 | P1 | task-02, task-03 | FR-02, FR-03, D-002@v1, D-003@v1 | TTL 纠错（30min/14d）+ 族语义 + grace 300 + 前端 5xx 行为 |

## 关键路径

task-01 → task-02 → task-04（最长路径；task-03 与 task-01 并行、并入 task-04 的文档依据）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）

- 不改 HTTP API 请求/响应结构；无 gen:types 义务（family_id 是纯库内列，不出现在任何 API 面）
- 不改 access TTL（30min）与 refresh TTL（14 天）；不做 cookie/SSO；Bearer 传输不变
- 不改管理员 revoke-all 与改密码的全吊销语义（admin/settings 走 UserService.revoke_all_sessions）
- 族谓词必须带 user_id 前导过滤；family 兜底表达式 `family_id or id`（吊销调用处 `revoked.family_id or revoked.id`）
- grace 默认精确值 300（`auth_refresh_grace_seconds`，le=600 不变）；grace=0 退化语义保留
- 前端抛错枚举优先：5xx / 408 / 429 → 抛 ApiError；401/403/其余 4xx → null
- 迁移仅加 nullable 列，禁回填、禁重置数据、禁加索引（走既有 ix_sessions_user_revoked）
- 错误文案中文；注释与实现一致（CLAUDE.md 规则18）；Windows/Linux/macOS 兼容（规则13）
- 通过 hook 提交被拦截时禁止跳过；修复后再提交（规则10）

## 全局验收标准

1. 后端新增族语义测试全绿（族隔离/继承/legacy 兜底/新族/默认 300）；改造后的 grace 用例全绿；ruff/mypy 零错
2. 前端分流测试全绿（503/504 抛错不清会话、401 返 null、2xx 返对）；typecheck/lint 零错；13 调用点审计结论落账
3. 集成敏感面冒烟：`uv run alembic upgrade head` 通过；auth 域全量测试（tests/modules/auth/）不回归
4. （brownfield）不改行为面：admin revoke-all、改密码全吊销、grace 窗内重签、单飞刷新均保持原语义

> 逐项核验结果由 verify 阶段写入 verify-result.md；task 级验收对照 TaskCard acceptance。

## Review Focus 盲区清单（隐含面）

| # | 输入/条件 | 合理人预期行为 | 承接落点 |
|---|---|---|---|
| 1 | 存量 NULL 行（family_id IS NULL）refresh 出子代后再用旧行 token 超窗复用 | 谓词 `(family_id IS NULL AND id=:f)` 命中旧行 + `family_id=:f` 命中子代 → 整族灭；异族存活 | task-02（legacy 用例断言） |
| 2 | doRefresh 收到 200 但 body 非法 JSON / 缺字段 | 抛错路径视为瞬态：不清会话，调用方展示可重试错误 | task-03（审计确认不 clear） |
| 3 | api.ts 401 收口处 refresh 抛错时原 401 ApiError 被替换传播 | 用户看到刷新错误而非原业务错——与 timeout 先例一致，接受 | task-03（注释契约与审计记录） |
| 4 | 同一 rotated token 在 grace 窗内被多次提交 | 每次换新对且不吊销；rotated_at 不被刷新（窗口不无限续），超窗后落入族灭 | task-02（既有用例 1 覆盖单次；多次由 rotated_at 不刷新设计保证） |
| 5 | SSE 会话流 token 路径与 13 处调用点外的 token 使用面 | 不受本变更影响（SSE 401 只停连不清登录态） | task-03（审计范围显式排除并留痕） |

## 覆盖矩阵（如存在 decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02 | 迁移通过 + 族继承/兜底用例 |
| D-002@v1 | task-02 | 族隔离用例 + 文案断言 + grace 用例 2 改造 |
| D-003@v1 | task-02 | 默认 300 断言 |
| D-004@v1 | task-03 | 503/504 抛错不清会话用例 + 401 null 用例 |
| D-005@v1 | task-01, task-02（方案 A 组合） | 上述证据合集 |
| D-006@v1 | —（rejected 留档，无任务） | 防复潮台账 |
| D-007@v1 | —（rejected 留档，无任务） | 防复潮台账 |
