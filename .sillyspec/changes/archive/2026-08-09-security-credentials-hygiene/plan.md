---
plan_level: full
author: qinyi
created_at: 2026-08-09T13:15:00
---

# 实现计划（Plan）— 安全凭据卫生

## Spike 前置验证

无需 Spike。技术确定性高：config `field_validator` 有现成先例（config.py:204/212/279）、pydantic v2 `info.data` 字段顺序经 Design Grill 核实可取 email（R-01 有 `model_validator` 兜底）、前端两页同构改法无新技术。唯一待验证点（R-01 info.data）在 task-03 实现首步验证，不通过即用兜底，不构成 Spike。

## Wave 1（并行，无依赖）

各 task 改动文件不重叠，可并行：

- [x] task-01: 前端桌面登录页删明文密码缓存 + 默认回填 + 文案 + 旧缓存清洗（`frontend/src/app/(auth)/login/page.tsx`，覆盖：FR-01, FR-02, FR-03, FR-04, D-001@v1）
- [x] task-02: 前端移动登录页同步改法（`frontend/src/app/m/login/page.tsx`，覆盖：FR-01, FR-02, FR-03, FR-04, D-001@v1）
- [x] task-03: 后端 config.py 加 bootstrap 弱口令 field_validator（`backend/app/core/config.py`，覆盖：FR-05, D-002@v1, D-004@v1）
- [x] task-05: 清理文档/部署件 admin123（README、docs/security-audit-2026-07-28.md 4 处、2 部署 skill，覆盖：FR-06）
- [x] task-06: 改真实 deploy/.env 弱口令 + .env.example 注释（覆盖：FR-06, FR-07）

## Wave 2（依赖 Wave 1 task-03）

- [x] task-04: 新增 bootstrap 弱口令校验单测（`backend/tests/modules/auth/test_bootstrap_password_strength.py`，依赖 task-03，覆盖：FR-05）

## Wave 3（依赖 Wave 1+2）

- [x] task-07: 全量验证——后端 pytest + ruff/mypy、前端 lint、手测 fail-fast 与 localStorage 无密码（依赖 task-01~06，覆盖：全部 FR 验收）

## Wave 4（依赖 Wave 3）

- [x] task-08: 收尾——CONCERNS.md 标记已解决 + 模块文档变更索引 + QUICKLOG 精修（依赖 task-07 通过）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 桌面登录页删明文密码缓存 | W1 | P0 | — | FR-01/02/03/04, D-001 | 回填删 password 默认、写缓存删 password 键、旧缓存清洗、文案改「记住登录名」 |
| task-02 | 移动登录页同步改法 | W1 | P0 | — | FR-01/02/03/04, D-001 | 与 task-01 同构，同 key 同逻辑 |
| task-03 | config 加弱口令 field_validator | W1 | P0 | — | FR-05, D-002, D-004 | 复用 :204 同模式；实现首步验证 info.data 取 email，不通过改 model_validator(after) |
| task-04 | bootstrap 弱口令单测 | W1 | P0 | task-03 | FR-05 | 弱口令表逐项拒 + 与 email 同名拒 + 强口令通过 + None 放行 |
| task-05 | 清理文档/部署件 admin123 | W1 | P1 | — | FR-06 | README:87、security-audit :26/:89/:122/:131、deploy-to-server:164、sillyhub-docker-deploy:374 |
| task-06 | 改 deploy/.env + .env.example | W1 | P1 | — | FR-06/07 | deploy/.env:27 admin123→强随机占位；.env.example 加注释 |
| task-07 | 全量验证 | W2 | P0 | task-01~06 | 全 FR | pytest auth + ruff/mypy + 前端 lint + 手测 |
| task-08 | 文档收尾 | W2 | P1 | task-07 | — | CONCERNS 标记 + 模块变更索引 + QUICKLOG |

## 关键路径

task-03 → task-04 → task-07（config validator + 其单测 + 验证，决定后端交付）；task-01/02 → task-07（前端验证）。task-05/06 独立，不阻塞关键路径。

## 全局验收标准

- [ ] **AC-01**（FR-05）：`PLATFORM_BOOTSTRAP_ADMIN_PASSWORD=admin123` 启动 → ValidationError；`admin1234`/`password`/`12345678`/`qwerty123` 等表内项同；与 email 登录名相同被拒；强口令正常启动；None 放行（task-04 单测钉死）。
- [ ] **AC-02**（FR-01/02/03）：登录后 DevTools → localStorage `sillyhub.login.remember` 无 `password` 键；清空缓存后进登录页账号密码均空；复选框文案显示「记住登录名」（FR-03 并入手测）。
- [ ] **AC-03**（FR-04）：预置旧格式 `{account,password,remember}` 缓存访问登录页，localStorage 被重写为无 password 版。
- [ ] **AC-04**（FR-06）：全仓 `rg --no-ignore --hidden admin123` 仅剩 archive 历史文档（不运行）与占位说明。⚠️ 必须带 `--no-ignore --hidden`——默认 ripgrep 会跳过 `.claude/` 隐藏目录（漏掉 2 个部署 skill）和 gitignored 的 `deploy/.env`，导致 FR-06/07 假通过。
- [ ] **AC-04b**（FR-07）：`deploy/.env` 是 gitignored+untracked（`.gitignore:44`），task-06 对 `:27` 的改动是**本地操作、不进 commit diff**；可评审的 tracked 落点是 `deploy/.env.example`。验收以本地文件实际内容为准（非 git diff）。
- [ ] **AC-05**（回归）：现有 auth 测试零回归（弱口令表与现有测试口令 Xx1!abcd/OldPass1!/NewPass1!/Admin123!@# 零碰撞，validator 仅作用于配置项）。
- [ ] **AC-06**（lint）：后端 ruff check + format check + mypy 全过；前端 eslint 登录页改动无新增 error。
- [ ] **AC-07**（brownfield 不变）：未配 `platform_bootstrap_admin_password` 时 bootstrap 不建号、行为不变（D-004）。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（落点=前端 localStorage） | task-01, task-02 | AC-02, AC-03 |
| D-002@v1（方案A=config field_validator） | task-03, task-04 | AC-01 |
| D-003@v1（不做强制改密） | Non-Goals（无任务，明确排除） | — |
| D-004@v1（bootstrap 已存在不更新密码） | task-03 | AC-07 |
