---
author: qinyi
created_at: 2026-08-09T23:15:00
change: 2026-08-09-security-backend-guardrails
stage: archive
---

# 模块影响矩阵 — 2026-08-09-security-backend-guardrails

> 真相源 = git diff（`git diff --cached --name-only HEAD`）+ design.md §6 文件清单。项目级 `_module-map.yaml` 为 monorepo 粒度（backend/frontend/sillyhub-daemon），本次变更 11 文件全部落在 `backend/**`。

## 模块影响

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend | 新增 + 逻辑变更 | backend/app/core/ssrf.py | 新建 SSRF 统一入口 façade（assert_public_url 全量 IPv4+IPv6 + assert_safe_repo_url 纯协议白名单 + UnsafeRepoUrl 400） | false |
| backend | 逻辑变更 | backend/app/modules/incident/service.py | update() 加 INCIDENT_TRANSITIONS 放宽版转换图 + assert_transition 校验（非法 422/值非法 400/同态幂等/重开清字段） | false |
| backend | 逻辑变更 | backend/app/modules/mcp_gateway/service.py | webhook create 注册前 + _deliver_one 投递前 assert_public_url 双查（硬拒 400 / best-effort） | false |
| backend | 逻辑变更 | backend/app/modules/worktree/git_runner.py | clone_bare 前 assert_safe_repo_url（拒 ext::/file:///裸路径/Windows 盘符，放行内网 git） | false |
| backend | 逻辑变更 | backend/app/modules/tool_gateway/service.py | _handle_http_get 改 follow_redirects=False 手动逐跳 ≤3 跳 + 每跳 assert_public_url（修 IPv6+重定向） | false |
| backend | 测试基建 | backend/conftest.py | 顺补 incident+release+ppm.project/task model import 解 NoReferencedTableError 测试 collection 债（brownfield） | false |
| backend | 测试新增 | backend/app/modules/incident/tests/test_fsm.py | 16 用例（合法边/非法 422/重开清字段/幂等/值 400） | false |
| backend | 测试新增 | backend/app/modules/worktree/tests/test_repo_url_guard.py | 22 用例（assert_safe_repo_url 纯函数 + clone_bare 集成） | false |
| backend | 测试新增 | backend/app/modules/tool_gateway/tests/test_ssrf.py | 6 用例（http_get IPv6/重定向逐跳） | false |
| backend | 测试新增 | backend/app/modules/mcp_gateway/tests/test_webhook_ssrf.py | 6 用例（注册拒/投递复查） | false |
| backend | 测试调整 | backend/app/modules/mcp_gateway/tests/test_webhook.py | +22 行 autouse mock assert_public_url（brownfield，解 hooks.example.com 不可解析） | false |

## 未匹配文件

无。全部 11 文件命中 `backend` 模块（`backend/**` glob）。

## 三重交叉验证

- **声明范围**（design.md §6 文件清单）：core/ssrf.py + incident/service.py + mcp_gateway/service.py + worktree/git_runner.py + tool_gateway/service.py + conftest.py + 4 测试文件 = 与 git diff 一致。
- **任务范围**（tasks.md / plan.md）：task-01~08 文件路径覆盖全部 11 文件。
- **真实变更**（git diff --cached）：11 文件全 A/M，无 D/R 删除。

三者一致，无漂移。

## 备注

- 不改 OpenAPI schema / DTO / 响应体 / 表结构 / migration（NFR-03）→ 无需 gen:types，无前后端契约影响。
- 文档同步（CONCERNS.md + backend.md 变更索引）已在 commit a8447a19 提交（属 docs 模块，不在本 backend 影响矩阵的代码 diff 内）。
