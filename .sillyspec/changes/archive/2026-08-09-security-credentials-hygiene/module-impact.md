---
author: qinyi
created_at: 2026-08-09 14:08:00
---

# 模块影响分析（Module Impact）— 安全凭据卫生（前端明文密码 + 默认弱口令）

> 真相源 = worktree `git diff --name-only HEAD` + 未跟踪新文件，与 design.md 文件变更清单、plan.md 任务路径三重交叉一致。

## 影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend | 配置变更 + 新增测试 | `backend/app/core/config.py`；`backend/tests/modules/auth/test_bootstrap_password_strength.py`（新增，未跟踪） | config.py 加 `field_validator("platform_bootstrap_admin_password")` + 模块级 `_WEAK_BOOTSTRAP_PASSWORDS` 黑名单，配置加载期 fail-fast 拒弱口令/与 email 同名，None 放行（D-004）；新增 16 用例单测钉死。不改 router/schema/model/migration/entrypoint。 | false |
| frontend | 逻辑变更 | `frontend/src/app/(auth)/login/page.tsx`；`frontend/src/app/m/login/page.tsx` | 两登录页删 localStorage 明文密码缓存（只存 {account,remember}）+ 删 admin/admin123 默认回填 + 旧格式缓存一次性清洗 + 复选框文案「记住密码」→「记住登录名」。纯文本/缓存逻辑，无新依赖。 | false |

## 未匹配文件（docs / 部署件 / skill，非代码模块）

| 文件 | 性质 | 更新内容摘要 |
|------|------|-------------|
| `deploy/.env.example` | 部署配置模板 | `PLATFORM_BOOTSTRAP_ADMIN_PASSWORD` 上方加「部署前务必改强口令 + config 拒 admin123」防呆注释（模板值 Admin123!@# 保留，已过 validator） |
| `deploy/.env`（gitignored，本地未进 diff） | 真实部署配置（本地） | :27 admin123 → 强随机占位 SillyHub#Boot2026!xK9 + 注释（AC-04b，本地操作不进 commit） |
| `README.md` | 根文档 | :87 默认账号 admin/admin123 → 占位描述（引用 deploy/.env PLATFORM_BOOTSTRAP_ADMIN_*） |
| `docs/security-audit-2026-07-28.md` | 安全审计报告 | 4 处字面 admin/admin123 → 「常见弱口令/默认弱口令」描述性表达（保留审计结论措辞） |
| `.claude/skills/deploy-to-server/SKILL.md` | 部署 skill | :164 去默认 admin/admin123，改环境变量引用 |
| `.claude/skills/sillyhub-docker-deploy/SKILL.md` | 部署 skill | :374 curl 登录 password 占位化 |
| `.sillyspec/docs/SillyHub/scan/CONCERNS.md` | scan 文档 | :28 标 ✅ 已修复(change ...) |
| `.sillyspec/docs/multi-agent-platform/modules/frontend.md` | 模块文档 | 变更索引追加本 change 条目 |
| `.sillyspec/docs/multi-agent-platform/modules/backend.md` | 模块文档 | 变更索引追加本 change 条目 |

## 跨模块影响

无跨模块调用关系变更：config validator 仅作用于 `Settings` 实例化（app 启动配置加载），不改变任何 router/DTO/对外契约；前端改动不涉及 API 调用签名。frontend ↔ backend 之间无契约变动（探针 5 确认无 schema/router/model 改动，rule 20 免 gen:types）。

## 风险评估

- backend 改动隔离在配置层，brownfield（未配 platform_bootstrap_admin_password）行为不变（None 放行，bootstrap 不建号），已上线模块零影响。
- frontend 改动仅登录页缓存/回填/文案，无路由/守卫/中间件改动。
- 文档/deploy 改动为静态文本，无运行时影响。
- 整体 needs_review = false（影响完全确定，已由单测 + 真实启动路径 + 全量 lint/vitest 覆盖）。
