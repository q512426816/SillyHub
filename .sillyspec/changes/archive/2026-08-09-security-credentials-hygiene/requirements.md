---
author: qinyi
created_at: 2026-08-09T13:10:53
---

# 需求规格（Requirements）— 安全凭据卫生

## 功能需求

### FR-01 · 删除前端密码明文缓存
桌面 `(auth)/login/page.tsx` 与移动 `m/login/page.tsx` 的「记住我」只存 `{account, remember}`，不存 `password` 字段；回填时密码留空。

- 验收：登录后浏览器 DevTools → Application → localStorage，`sillyhub.login.remember` 的值不含 `password` 键。

### FR-02 · 去除 admin/admin123 默认回填
删除两登录页 `cached.password ?? "admin123"` 与 `cached.account ?? "admin"`；无缓存时账号、密码均空。

- 验收：清空 localStorage 后进登录页，账号密码输入框均为空。

### FR-03 · 「记住密码」改「记住登录名」
复选框文案语义对齐：desktop `(auth)/login/page.tsx:202`、mobile `m/login/page.tsx:236`。

- 验收：复选框文案显示「记住登录名」。

### FR-04 · 旧缓存清洗
读取旧缓存时只取 `account`、忽略 `password`，并用无密码版重写 localStorage，清掉浏览器已存明文。

- 验收：预置旧格式 `{account,password,remember}` 缓存后访问登录页，localStorage 被重写为无 password 版本。

### FR-05 · 后端 bootstrap 弱口令强度校验（方案 A）
`backend/app/core/config.py` 新增 `_WEAK_BOOTSTRAP_PASSWORDS` + `field_validator("platform_bootstrap_admin_password")`，配置加载期 fail-fast：弱口令表命中 → ValueError；与 `platform_bootstrap_admin_email` 本地部分相同 → ValueError。`None`（未配 bootstrap）放行。

- 验收：`PLATFORM_BOOTSTRAP_ADMIN_PASSWORD=admin123` 启动 → Settings 实例化抛 ValidationError；`admin1234`/`password`/`12345678` 等表内项同；强口令正常启动；与 email 登录名相同被拒。
- 覆盖决策：D-002（方案 A）、D-004（只校验本次注入口令，DB 已有 admin 不触发）。

### FR-06 · 清理文档/部署件的可复制弱口令
README、`docs/security-audit-2026-07-28.md`（4 处：:26/:89/:122/:131）、`.claude/skills/deploy-to-server/SKILL.md`（:164）、`.claude/skills/sillyhub-docker-deploy/SKILL.md`（:374）中的 `admin123` 改为 `<部署前替换为强随机口令>` 占位描述；e2e/skill 中 `curl` 登录改环境变量引用。

- 验收：全仓 grep `admin123` 仅剩历史 archive 变更文档（不运行）与占位说明。

### FR-07 · 改真实 deploy/.env 弱口令
`deploy/.env:27` `PLATFORM_BOOTSTRAP_ADMIN_PASSWORD=admin123` → 强随机口令 + 注释「部署前务必改」（gitignored 真实配置）。

- 验收：`deploy/.env:27` 不再是 `admin123`。

## 约束

- 兼容 Windows / Linux / macOS（CLAUDE.md 规则 13）。
- 不碰 OpenAPI schema（不改 DTO 输出），无需 `pnpm gen:types`。
- 不碰已上线 PPM 模块。
- 与 change 2（incident+SSRF）、change 3（PPM 冒名）代码不重叠（规则 18）。

## 决策覆盖

| 决策 | 覆盖 FR | 状态 |
|---|---|---|
| D-001@v1 明文密码落点=前端 localStorage | FR-01、FR-04 | accepted |
| D-002@v1 弱口令校验层=config field_validator（方案A） | FR-05 | accepted |
| D-003@v1 不做强制改密流程 | Non-Goals | accepted |
| D-004@v1 bootstrap 已存在不更新密码 | FR-05 | accepted |

> 无未覆盖的当前版本决策；无剩余风险（R-01~R-05 均有缓解，见 design §8）。

## 非功能需求

- **安全**：消除明文密码本地存储与弱默认口令两个已知缺陷面。
- **回归零**：现有 auth 测试（`Xx1!abcd`/`OldPass1!`/`NewPass1!`/`Admin123!@#` 等强口令）不受弱口令表影响；validator 仅作用于 `platform_bootstrap_admin_password` 配置项。
