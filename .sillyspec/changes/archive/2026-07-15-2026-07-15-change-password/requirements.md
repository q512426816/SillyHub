<!-- author: WhaleFall -->
<!-- created_at: 2026-07-15T11:13:18 -->

# 需求（Requirements）：用户自助修改密码

> 变更：`2026-07-15-change-password` ｜ 设计依据：design.md

## 功能需求（FR）

- **FR-01**：后端 `POST /api/auth/change-password`，已认证用户（`Depends(get_current_user)`）提交 `old_password` + `new_password` 修改自己密码，成功返回 204。
- **FR-02**：必须校验旧密码（`password_hasher.verify` 通过才允许改），失败 401 `HTTP_401_PASSWORD_INCORRECT`。
- **FR-03**：新密码 `min_length=8`（对齐 `UserCreateRequest.password`），不满足 422。
- **FR-04**：改密成功撤销该用户全部 session（execute-only UPDATE，与密码+审计原子提交）；当前 access_token 30min 内仍有效（保留当前会话），其他设备 refresh 失效（撤销其他）。
- **FR-05**：记审计 `AuditLog(action="user.password_change", actor=自己)`。
- **FR-06**：前端新建个人中心页 `/account`，antd Form 修改密码表单（旧/新/确认）。
- **FR-07**：前端校验新密码 ≥8、新=确认；成功提示「密码已修改，其他设备需重新登录」。
- **FR-08**：顶栏头像下拉新增「个人中心」入口 → 跳 `/account`。

## 验收标准（AC）

- **AC-01**：正确 token + 正确旧密码 + 合法新密码 → 204，`User.password_hash` 已更新。
- **AC-02**：旧密码错误 → 401 `HTTP_401_PASSWORD_INCORRECT`。
- **AC-03**：新密码 <8 位 → 422。
- **AC-04**：未带 token → 401。
- **AC-05**：改密成功后用旧密码登录 → 401。
- **AC-06**：改密成功后该用户其他设备 refresh → 失败（session 已撤销）；当前 access_token 30min 内仍可用。
- **AC-07**：审计新增 `action="user.password_change"` 记录，actor=自己。
- **AC-08**：`/account` 表单校验（新≥8、新=确认）+ 成功提示 + 旧密码错误展示。
- **AC-09**：顶栏头像下拉有「个人中心」入口，点击跳 `/account`。

## 设计决策引用（design.md §4）

- **D-001@v1**：旧密码错 → 401 `PasswordIncorrect`（不复用 `AuthInvalidCredentials`）。
- **D-002@v1**：后端 body 只收 `old_password`+`new_password`；confirm 仅前端。
- **D-003@v1**：新密码 min_length=8，允许新=旧。
- **D-004@v1**：撤销全部 session 用 execute-only UPDATE + 末尾统一 commit（**不**调内部 commit 的 `revoke_all_user_sessions`，X-001 修正）；当前 access_token 30min 无状态保留。
- **D-005@v1**：审计 `user.password_change`，actor=自己。
- **D-006@v1**：已认证（get_current_user）即可改，login_enabled 不阻断。

> 所有 D-xxx@vN 均已在本 requirements 覆盖，无未覆盖决策。

## 剩余风险

- **R-001**：当前会话保留 ≤ access_token 有效期（30min）；超时需重新登录（用户已接受方案 A）。
- **R-002**：未做强制改密码，默认密码用户可不改（提示文案引导）。
- execute 阶段确认项（非阻塞）：`top-bar.tsx` 用户下拉现状、`/account` 路由白名单。
