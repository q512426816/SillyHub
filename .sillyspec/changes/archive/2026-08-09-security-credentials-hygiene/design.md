---
author: qinyi
created_at: 2026-08-09T13:01:53
scale: large
status: draft
---

# 安全凭据卫生（前端明文密码 + 默认弱口令）— 设计

> 来源：`.sillyspec/docs/SillyHub/scan/CONCERNS.md`「2026-08-08 多代理审计」🔴 高危。
> 实施计划父文档：`C:\Users\qinyi\.claude\plans\cozy-stirring-corbato.md`。
> 关联 change：本变更属「5 项高危安全修复」第 1 个（change 2 = incident+SSRF，change 3 = PPM 冒名，互不重叠）。

## 1. 背景

多代理审计发现两处「凭据卫生」高危，同属登录口令的存储/默认值主题：

1. **前端登录页明文密码 localStorage**：桌面 `(auth)/login/page.tsx:73-80` 与移动 `m/login/page.tsx:136-139` 把用户密码明文 `setItem` 进 `localStorage`（key `sillyhub.login.remember`），且回填时默认 `cached.password ?? "admin123"`（:51/:111）、`cached.account ?? "admin"`（:50/:110）。密码落浏览器本地存储可被 XSS/物理访问/同步窃取，默认回填更是把已知弱口令固化进分发代码。
2. **默认管理员弱口令**：真实部署 `deploy/.env:27` `PLATFORM_BOOTSTRAP_ADMIN_PASSWORD=admin123`，经 `config.py:158` `platform_bootstrap_admin_password` → `auth/service.py:362` `bootstrap_admin_and_seed_rbac()` 首启建 admin。`config.py` 仅有 `min_length=8`、无强度规则，`admin123` 8 位正好通过。文档/部署 skill/README 亦多处可复制弱口令。

**审计纠正**：原 CONCERNS 表述「登录明文密码日志」经逐点核对，**后端 Python 日志链路无任何打明文密码的点**（auth/service.py 全部日志只打 user_id/email/session_id，见探查报告 §1）。真正落点是前端 localStorage，本变更据此落点修复。

## 2. 设计目标

- **FR-01**：前端记住我只存 `{account, remember}`，删除 password 字段，回填密码留空。
- **FR-02**：删除 `admin`/`admin123` 默认回填，无缓存时账号密码均空。
- **FR-03**：复选框文案「记住密码」→「记住登录名」，语义对齐。
- **FR-04**：读取旧缓存时只取 account、忽略 password，并重写为无密码版，清掉浏览器已存明文。
- **FR-05**：`config.py` 增 `field_validator`，配置加载期 fail-fast 拒绝常见弱口令 + 与登录名相同（方案 A，复用 config.py 现有 `field_validator` 同款模式）。
- **FR-06**：清理 README / docs/security-audit / 部署 skill 中的可复制弱口令 `admin123`。
- **FR-07**：改真实 `deploy/.env` 弱口令为强随机占位（gitignored 真实配置）。

## 3. 非目标（Non-Goals）

- **不做**强制首登改密流程（加 `User.must_change_password` 列 + migration + 登录拦截 + 改密页 + 前端跳转）——改动大且冲击 PPM 在线账号，列 follow-up。
- **不做** incident 状态机 / SSRF 三连 / PPM 冒名填报——属 change 2、change 3，代码不重叠（CLAUDE.md 规则 18）。
- **不做**后端日志脱敏改造——后端确认无明文密码日志点。
- **不做**「记住密码」功能本身（保留记住账号能力，仅去掉密码记忆）。

## 4. 总体方案

两主题、跨前后端 + deploy + 文档，但改动小、强相关（修 5 的前端回填与修 4 是同一处代码）。统一在一个 change 完成，不拆分。

- **前端**（FR-01~04）：两登录页同构改法，抽同一套逻辑——删 password 缓存、删默认回填、文案改名、旧缓存清洗。
- **后端**（FR-05）：config 层加 validator，最早失败（Settings 实例化即拒），零窗口期。弱口令表小而明确，避免误伤强口令。email 相关性校验在 validator 内做（pydantic v2 `field_validator` 的 `info.data` 可访问同模型已校验字段；若字段顺序导致取不到，降级 `model_validator(mode="after")` 兜底，见风险 R-01）。
- **文档/deploy**（FR-06/07）：占位统一写 `<部署前替换为强随机口令>`，脚本/skill 改环境变量引用。

## 5. 文件变更清单（File Changes）

| 文件 | 类型 | 改动要点 |
|---|---|---|
| `frontend/src/app/(auth)/login/page.tsx` | 修改 | 回填 :50-51 删 password/account 默认；写缓存 :73-80 删 password 字段；旧缓存清洗；「记住密码」:202 改文案 |
| `frontend/src/app/m/login/page.tsx` | 修改 | 同上对应行 :110-111 / :136-139 / :236 |
| `backend/app/core/config.py` | 修改 | 新增 `_WEAK_BOOTSTRAP_PASSWORDS` + `field_validator("platform_bootstrap_admin_password")`（复用 :204 同模式） |
| `deploy/.env` | 修改 | :27 `admin123` → 强随机口令 + 注释（gitignored） |
| `deploy/.env.example` | 修改 | 加「部署前务必改强口令」注释（本身已 `Admin123!@#`） |
| `README.md` | 修改 | :87 admin123 → 占位描述 |
| `docs/security-audit-2026-07-28.md` | 修改 | admin123 引用处改占位（实际 4 处：`:26`/`:89`/`:122`/`:131`，需全改） |
| `.claude/skills/deploy-to-server/SKILL.md` | 修改 | :164 admin123 → 环境变量引用 |
| `.claude/skills/sillyhub-docker-deploy/SKILL.md` | 修改 | :374 admin123 → 环境变量引用 |
| `backend/tests/modules/auth/test_bootstrap_password_strength.py` | 新增 | 弱口令表逐项拒 + 与 email 同名拒 + 强口令通过 |

## 6. 接口定义 / 核心实现设计

### 6.1 前端登录页（FR-01~04，两页同构）

回填（`(auth)/login/page.tsx:48-53` 等）：
```ts
const cached = JSON.parse(raw) as Partial<LoginFormValues>;
form.setFieldsValue({
  account: cached.account ?? "",   // 删 ?? "admin"
  remember: true,
});                                 // 不再 set password（删 ?? "admin123"）
// 旧缓存清洗：若旧缓存含明文 password，重写为无密码版，一次性清除浏览器已存明文
if (cached.password !== undefined) {
  localStorage.setItem(REMEMBER_KEY, JSON.stringify({ account: cached.account ?? "", remember: true }));
}
```

写缓存（`doLogin` :72-80）：
```ts
if (values.remember) {
  localStorage.setItem(REMEMBER_KEY, JSON.stringify({
    account: values.account,
    remember: true,                 // 删 password 字段
  }));
} else {
  localStorage.removeItem(REMEMBER_KEY);
}
```

文案：`<Checkbox>记住密码</Checkbox>` → `记住登录名`（desktop :202、mobile :236）。

### 6.2 后端 config 弱口令校验（FR-05，方案 A）

`backend/app/core/config.py`：
```python
_WEAK_BOOTSTRAP_PASSWORDS = frozenset({
    "admin123", "admin1234", "admin@123",
    "password", "password123", "passwd123",
    "12345678", "123456789", "1234567890",
    "qwerty123", "letmein123", "welcome123",
})

@field_validator("platform_bootstrap_admin_password")
@classmethod
def _reject_weak_bootstrap_password(cls, v: str | None, info: ValidationInfo) -> str | None:
    if v is None:
        return v  # 未配 bootstrap，不建号，放行
    if v in _WEAK_BOOTSTRAP_PASSWORDS:
        raise ValueError(
            "platform_bootstrap_admin_password 是常见弱口令，请改为强口令（≥12 位、含大小写/数字/符号）"
        )
    email_local = (info.data.get("platform_bootstrap_admin_email") or "").split("@", 1)[0].lower()
    if email_local and email_local == v.lower():
        raise ValueError("platform_bootstrap_admin_password 不能与登录名相同")
    return v
```
- 复用 `config.py:204/212/279` 现有 `field_validator` 同款模式，无新依赖。
- `ValidationInfo.data` 在 pydantic v2 按字段定义顺序填充；若 `platform_bootstrap_admin_password`（:158）先于 `platform_bootstrap_admin_email`（:157）——实际 email 在前，可取到。实现时验证字段顺序，取不到则改 `model_validator(mode="after")`（见 R-01）。
- bootstrap（`service.py:362`）「已存在不更新密码」语义保留：强度校验在 config 层（启动加载期），只对**本次启动注入的口令**生效，已有 DB admin 不被强制改。

### 6.3 文档/deploy（FR-06/07）

- `deploy/.env:27`：`PLATFORM_BOOTSTRAP_ADMIN_PASSWORD=admin123` → `<部署前替换为强随机口令>`（实际写入一个 16 位随机串占位 + 注释）。
- README/docs/skill：`admin123` → ` <部署前替换为强随机口令>` 占位；e2e/skill 用 `curl` 登录的改 `password: "${PLATFORM_BOOTSTRAP_ADMIN_PASSWORD}"`。

## 7. 生命周期契约

不涉及生命周期契约（本变更不改 session/lease/agent_run/daemon/heartbeat 等运行时状态机，仅改前端登录缓存、后端启动配置校验、静态文档）。

## 8. 风险登记（Risk）

| ID | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R-01 | pydantic `field_validator` 内 `info.data` 因字段顺序取不到 email | 中 | 实现时第一件事验证字段顺序；取不到则降级 `model_validator(mode="after")`（此时已全部字段就绪） |
| R-02 | 改真实 `deploy/.env` 口令后，已部署环境的旧 admin 口令不自动更新（bootstrap 仅新建） | 低 | 文档注明：已部署环境需手动改密；本项目除 PPM 外未上线，可重置数据（CLAUDE.md 规则 11） |
| R-03 | 前端旧用户浏览器残留明文密码 | 中 | FR-04 读取时清洗重写，一次性清除 |
| R-04 | 弱口令表误伤现有测试口令 | 低 | 表内均为已知弱口令；现有 auth 测试用 `Xx1!abcd`/`OldPass1!`/`NewPass1!`/`Admin123!@#` 等强口令，不在表内；且 validator 仅作用于 `platform_bootstrap_admin_password` 配置项，测试里的 user `password_hash` 根本不经此校验；bootstrap 新测试构造时用强口令 |
| R-05 | 移动端与桌面端回填逻辑需保持一致 | 低 | 两页同构改法，复用同一 key 与同一套清洗逻辑 |

## 9. 决策追溯

- **D-001@v1**（accepted）：明文密码落点 = 前端 localStorage（非后端日志）。source=code+audit。覆盖：FR-01~04。evidence：auth/service.py 全部日志只打 user_id/email；CONCERNS:28 指向前端。
- **D-002@v1**（accepted）：弱口令校验层 = config `field_validator`（方案 A），非 service 层/非仅告警。source=user。覆盖：FR-05。理由：最早失败、零窗口期、复用现有模式。impacts：FR-05、task config。
- **D-003@v1**（accepted）：不做强制改密流程（②）。source=user。理由：改动大、冲击 PPM 在线账号；fail-fast 已消除弱默认口令风险。列 follow-up。覆盖：Non-Goals。
- **D-004@v1**（accepted）：bootstrap「已存在不更新密码」语义保留——弱口令强度校验在 config 层（启动加载期），只对本次启动注入的口令生效，DB 已有 admin 不被强制改（避免线上锁死）。source=code。覆盖：FR-05。evidence：auth/service.py:388（existing is None 才建）。

## 10. 自审（Self-Review）

- ✅ scale=large，四件套齐全（design + proposal + requirements + tasks）。
- ✅ 复用 config.py 现有 `field_validator` 模式（:204/212/279），无新依赖。
- ✅ 不碰 OpenAPI schema（不改 DTO 输出），无需 `pnpm gen:types`。
- ✅ 不碰已上线 PPM 模块。
- ✅ 与 change 2（incident/SSRF）、change 3（PPM 冒名）代码不重叠。
- ✅ 生命周期契约：明确豁免（不改运行时状态机）。
- ✅ Non-Goals 清晰：不做强制改密、不做后端日志改造。
- ⚠️ 自审存疑：pydantic v2 `field_validator` 内 `info.data` 能否稳定取到 email_local（R-01）——实现时第一件事验证，不通过则用 `model_validator(mode="after")`。

## 11. 验证方案

| 项 | 命令（主仓库根目录，CLAUDE.md 规则 21） | 通过标准 |
|---|---|---|
| 后端单测 | `cd backend && uv run pytest app/modules/auth tests/modules/auth -q` | 新增弱口令 validator 用例全过 + 现有 auth 测试零回归 |
| 后端 lint | `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app` | 无错 |
| 前端 lint | `cd frontend && pnpm lint` | 登录页改动无新增 error |
| 手测 | `.env` 设 `admin123` → 启动应 ValidationError 失败；登录后 DevTools → Application → localStorage 确认 `sillyhub.login.remember` 无 password 字段 | fail-fast 生效 + 无明文密码残留 |
