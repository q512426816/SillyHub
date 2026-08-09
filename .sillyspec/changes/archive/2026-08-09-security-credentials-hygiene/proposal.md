---
author: qinyi
created_at: 2026-08-09T13:10:53
status: draft
---

# 变更提案（Proposal）— 安全凭据卫生

## 动机

`.sillyspec/docs/SillyHub/scan/CONCERNS.md`「2026-08-08 多代理审计」🔴 高危发现两处登录口令「凭据卫生」缺陷：

1. **前端登录页明文密码 localStorage**：桌面 `frontend/src/app/(auth)/login/page.tsx` 与移动 `frontend/src/app/m/login/page.tsx` 把用户密码明文 `setItem` 进 `localStorage`（key `sillyhub.login.remember`），且回填默认 `admin` / `admin123`。密码落浏览器本地存储可被 XSS/物理访问/账号同步窃取，默认回填把已知弱口令固化进分发代码。
2. **默认管理员弱口令**：真实部署 `deploy/.env` 用 `PLATFORM_BOOTSTRAP_ADMIN_PASSWORD=admin123`，`config.py` 仅有 `min_length=8` 无强度规则，弱口令照常生效。文档/部署 skill/README 多处可复制弱口令。

**审计纠正**：原 CONCERNS 表述「登录明文密码日志」经逐点核对，后端 Python 日志链路无任何打明文密码的点（auth/service.py 全部日志只打 user_id/email/session_id）。真正落点是前端 localStorage，本变更据此落点修复（D-001）。

## 目标

消除前端明文密码存储 + 服务端拒绝弱默认口令 + 清理文档/部署件可复制弱口令，使登录凭据的存储与默认值达到「不留明文、不固化弱口令」。

## 范围内

- **前端**（FR-01~04）：两登录页删 localStorage 密码字段、删 admin/admin123 默认回填、文案改「记住登录名」、旧缓存清洗。
- **后端**（FR-05）：`config.py` 加 `field_validator` fail-fast 拒弱口令（方案 A，D-002）。
- **文档/deploy**（FR-06~07）：清理 `deploy/.env`、README、docs/security-audit、部署 skill 的 admin123。

## 不在范围内（Non-Goals）

- **不做**强制首登改密流程（加 User 列 + migration + 登录拦截 + 改密页，冲击 PPM 在线账号；`admin/users_service.py:48` 的 `force_change_on_next_login` 已是零引用死代码印证其复杂度）——列 follow-up（D-003）。
- **不做**incident 状态机 / SSRF 三连 / PPM 冒名填报（属 change 2、change 3，代码不重叠）。
- **不做**后端日志脱敏改造（后端确认无明文密码日志点）。
- **不做**「记住密码」功能本身（保留记住账号能力，仅去密码记忆）。

## 方案概要

- 前端两页同构改法：删 password 缓存键、删默认回填、文案改名、读时清洗旧缓存。
- 后端 config `field_validator`（复用 config.py:204/212/279 同模式）配置加载期 fail-fast，零窗口期；email 相关性校验在 validator 内做。
- 文档/deploy：占位统一 `<部署前替换为强随机口令>`，脚本改环境变量引用。

详细设计见 `design.md`。
