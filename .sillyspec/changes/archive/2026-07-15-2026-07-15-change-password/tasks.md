<!-- author: WhaleFall -->
<!-- created_at: 2026-07-15T11:13:18 -->

# 任务清单（Tasks）：用户自助修改密码

> 变更：`2026-07-15-change-password` ｜ 仅列任务名，Wave 分组与细节在 plan 阶段展开。

- [ ] T-01 后端：`core/errors.py` 新增 `PasswordIncorrect`(401) AppError 子类并导出
- [ ] T-02 后端：`auth/schema.py` 新增 `ChangePasswordRequest{old_password, new_password(min 8)}` 并导出
- [ ] T-03 后端：`auth/service.py` `AuthService.change_password`（verify 旧密码→hash 新密码→execute-only 撤销 session→AuditLog→统一 commit）
- [ ] T-04 后端：`auth/router.py` 新增 `POST /api/auth/change-password` 端点（204）
- [ ] T-05 后端：`tests/modules/auth/` 新增 `test_change_password`（成功/旧密码错401/新密码短422/未认证401/旧密码登录失效/其他会话撤销/审计）
- [ ] T-06 前端：跑 `gen-api-types.mjs` 重新生成 api-types + `lib/auth.ts` 新增 `changePassword`
- [ ] T-07 前端：新建 `(dashboard)/account/page.tsx` 个人中心页（antd Form 修改密码表单）
- [ ] T-08 前端：`top-bar.tsx` 顶栏头像下拉加「个人中心」入口 + `/account` 路由白名单确认
- [ ] T-09 前端：account 页表单组件测试（校验/提交/错误展示）
- [ ] T-10 联调验证：改密成功 / 旧密码错 / 其他设备会话撤销 / 审计记录（对照 AC-01~09）
