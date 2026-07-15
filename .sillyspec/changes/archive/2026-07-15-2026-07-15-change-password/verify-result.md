<!-- author: WhaleFall -->
<!-- created_at: 2026-07-15T12:47:18 -->

# 验证报告：用户自助修改密码（2026-07-15-change-password）

## 结论：PASS（✅ 通过）

## AC 验收（design §9，对照 test_change_password + account 测试）
- AC-01 改密 204 + 密码更新：test_change_password_success（新密码可登录）✅
- AC-02 旧密码错 401 PASSWORD_INCORRECT ✅
- AC-03 新密码<8 422 ✅
- AC-04 未带 token 401 ✅
- AC-05 改后旧密码登录 401 ✅
- AC-06 其他设备会话撤销（2 session revoked）✅
- AC-07 审计 user.password_change ✅
- AC-08 前端表单校验+成功提示+旧密码错误展示（account 5/5）✅
- AC-09 顶栏个人中心入口跳 /account（layout 白名单 + top-bar）✅

## 测试结果（worktree commit ac8b8382）
- 后端：mypy app 468 文件无问题；test_change_password 7/7；auth+admin 186 passed + 5 xfailed + 1 预先债务(test_auth_user_read_email_optional/employee_no，与本次无关)
- 前端：tsc 通过；account 5/5；layout 17/17；全量 929 passed + 2 flaky(page-team-toggle 全量并发，单独 8/8)

## 决策落实（D-001~006）
全部落实：旧密码401/body只收old+new/min8允许新=旧/execute-only撤销+统一commit/审计user.password_change/已认证即可改。

## 偏差（已记录，非缺陷）
account 页用原生 input + Tailwind（design §5.2 写 antd Form；子代理合理纠正：dashboard 区无 antd，避免引入新依赖，design.md §13 已含）。

## 风险
- baseline 漂移（execute 期间主目录 .sillyspec 文档更新）→ archive 用 --merge 合并
- 预先债务（employee_no test / page-team-toggle flaky）与本次无关
