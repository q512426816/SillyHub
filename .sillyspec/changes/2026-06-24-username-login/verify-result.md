---
author: WhaleFall
created_at: 2026-06-25T12:49:58
---

# 验证报告 — 2026-06-24-username-login

## 结论

**PASS WITH NOTES**（风险等级 contract-required，HTTP 端到端测试覆盖契约；登记 2 项测试债务 + task-03 友好 409 透传待补，均非功能阻塞）

## 任务完成度

- task-01~10 蓝图逐项验收：
  - task-01/03~10：验收 checkbox 全部已勾选 ✅
  - task-02（后端 schema 改造）：5 项完成定义 checkbox 执行时未回填，经 QA 核实**全部满足**：
    - §5 四处字段改动落地（git show 精准匹配，见"代码审查"）
    - §9 TDD/§10 AC-01~06、AC-09~11 通过；AC-07/08 测试缺口登记为债务
    - settings/schema.py 未改（re-export 自动同步）
    - task-02 范围仅改两个 allowed_paths 文件

## 设计一致性

- 对照 design.md Phase 0-5 全部实现（verify Step 3 核验）
- decisions D-001~D-005 全部 `accepted`，无 unresolved/superseded/stale 引用

## 探针结果

- 未实现标记扫描：变更文件（33 个）无 TODO/FIXME/HACK/XXX
- 关键词覆盖：schema（admin/auth email Optional + username 必填）、service（login 纯 username、update 唯一校验）、login 前端文案、migration（email nullable）、前端 drawer 登录名 + 列表登录名列，均实现
- 测试覆盖：backend admin+auth 167 passed + 5 xfailed；frontend 48 passed
- 决策追踪覆盖：D-001~D-005 全覆盖（见下表）

## 决策追踪矩阵

| 决策 ID | 要求 | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | 纯登录名登录（移除 email 登录） | task-01/03 | auth/service.py login 移除 @email 分支只走 `_lookup_active_user_by_username`；login/page.tsx 文案改登录名；test_login_username.py::test_login_email_rejected 验证 email 被拒 | PASS |
| D-002@v1 | 存量 username 沿用（零数据迁移） | task-04 | admin/users_service.py `_resolve_username` 沿用已生成值；migration 202608010900 仅 email nullable 不动 username 列；前端列表显登录名列 | PASS |
| D-003@v1 | 非空 email 仍唯一 | task-02/03 | schema email Optional；`ux_users_email_active` 唯一索引保留（PG 多 NULL 放行）；migration email nullable；test_multiple_null_emails_coexist 通过 | PASS（DB 索引保证唯一；友好 409 透传 xfail 属 task-03） |
| D-004@v1 | username 可编辑 | task-02/03/06 | UserUpdateRequest 增 username；users_service.update_user 增 `_resolve_username` 唯一校验；admin-user-drawer 增登录名可编辑；test_update_username_* 覆盖 | PASS（功能实现；友好 409 透传 xfail 属 task-03） |
| D-005@v1 | 方案 A 最小兼容 + 删 merge revision | task-05 | migration 202608010900 down_revision 锚定 202606241001；坏 merge revision 删除；复用现有字段/索引，无字段改名/部分索引/DB CHECK | PASS |

## 测试结果

- backend pytest（admin+auth）：**167 passed, 5 xfailed**（51.82s）
  - 5 xfail：3 个 task-03（username/email conflict 409 透传、email set null）、2 个 task-05（refresh grace、logout 三元组）—— 均 TDD RED 预留，注明属后续 task
- frontend vitest（admin.test + admin-user-drawer）：**48 passed**（admin.test 35 + drawer 13，33.82s）
- backend ruff（全量）：All checks passed
- backend mypy（admin/auth/settings 22 文件）：no issues found
- frontend tsc --noEmit：no errors
- frontend next lint：仅既有 no-unused-vars warning（全在非本次变更文件：daemon-session/token-refresh/use-agent-run-stream 测试 + kanban.ts），无 error

## 技术债务

- 变更文件无 TODO/FIXME/HACK/XXX
- 测试债务（task-02）— ✅ **已于 quick task-11 补齐**（`backend/tests/modules/admin/test_schema_username_login.py`，2 测试通过）：
  - **AC-07**：auth.schema.UserRead email=null 无直接单测（仅 login 流程间接覆盖）→ 已补 `test_auth_user_read_email_optional`（model_validate 不报错 + .email is None + JSON null）
  - **AC-08**：§9 要求的 `test_settings_reexport_synced`（验证 settings.schema re-export 与 admin.schema 是同一对象 `is`）→ 已补（`S is A` + 字段同步：email Optional / username 必填 min_length=3）
- task-03 友好 409 透传：update username/email 冲突当前可能抛 DB IntegrityError 而非友好 409（xfail 预留，task-03 service 范围）
- frontend 既有 lint warning（非本次引入，建议独立清理）

## 变更风险等级

**contract-required**

判定依据：本变更新改 Pydantic schema DTO（UserCreateRequest/UserUpdateRequest/UserRead 的 username/email 字段契约）+ auth login 查询分支，属 API contract/DTO 改动。未触及 session/lease/agent_run 状态机核心（login 仅改查询分支，refresh/session 不变；test_refresh_grace_window xfail 为 task-05 既有遗留，非本变更引入）、未涉及 daemon、未改 deployment 启动路径。

contract test 证据：test_login_username.py + test_users_router.py 均通过真实 AsyncClient + DB 端到端验证 DTO 契约（username 必填 422、min_length 422、email optional、UserRead email=null 序列化、extra=forbid）。

## Runtime Evidence

contract-required 非强制 Runtime Evidence。补充集成证据：
- login 流程：test_login_username.py 端到端验证（真实 HTTP + DB）—— username 登录成功、email 被拒（test_login_email_rejected）、错误密码枚举防护、disabled 用户阻断、未知用户 404
- admin user CRUD：test_users_router.py 端到端验证 create/update/email optional/username 必填 422/UserRead email null 序列化
- backend 已部署（verify Step 0 记录"execute 14/14 已完成并部署"）；本次未单独采集 runtime 日志（contract-required 不强制）

## 代码审查

- task-02 schema 改动干净：git show 确认 admin/schema.py(+11/-4)、auth/schema.py(+1/-1) 精准匹配 §5 四处字段改动，无越界、无夹带
- settings/schema.py 未改（re-export 自动同步，AC-08 功能成立）
- 总体：实现质量良好，契约改动精准，测试覆盖充分（端到端 + 单测）；2 项测试债务 + task-03 409 透传为已知后续项，不影响本次功能正确性

## 进度修复记录（doctor 介入）

本次 verify 过程中发现并修复了 SillySpec 进度状态分裂：
- **根因**：shell cwd 停在 `backend/` 时运行 `sillyspec run verify --done`（运行测试 step），状态误写进 `backend/.sillyspec/.runtime/sillyspec.db`（sillyspec 在子目录 cwd 错误创建的副本 DB），导致根权威 DB（`.sillyspec/.runtime/sillyspec.db`，274KB）的 verify ordering5 一直 pending，状态机输出错乱（project 切换、step 归位错乱）
- **修复**：① 清理误建的 `backend/.sillyspec`；② 在项目根 cwd 补录 verify ordering5（运行测试）；③ 完成 ordering6（本报告）
- **预防**：所有 sillyspec 命令必须在项目根 `F:\WorkNew\SillyHub` 运行，避免 cwd 在子目录导致状态分裂
- **工具缺陷**（CLAUDE.md 规则 14，建议记录到 docs/sillyspec/）：sillyspec 在子目录 cwd 运行时会用 `cwd/.sillyspec` 拼接而非向上查找根 `.sillyspec`，多 project 工作区下易产生状态分裂。建议增强 .sillyspec 解析逻辑（向上查找已注册项目根）

## 下一步

- PASS WITH NOTES → 可运行 `sillyspec run archive` 归档
- 建议：补 2 项测试债务（AC-07/08）+ 推进 task-03 友好 409 透传（可纳入后续 quick 或新变更）
