---
id: task-07
title: "新建 (dashboard)/account/page.tsx 个人中心页"
title_zh: 个人中心页与修改密码表单
author: WhaleFall
created_at: 2026-07-15 11:24:44
priority: P0
depends_on: [task-06]
blocks: [task-08, task-09]
requirement_ids: [FR-06, FR-07]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/account/page.tsx
expects_from:
  task-06:
    - contract: changePassword
      needs: [oldPassword, newPassword]
goal: >
  新建个人中心页 /account，antd Form 修改密码表单（旧/新/确认），校验+提交+错误展示。
implementation:
  - 新建 frontend/src/app/(dashboard)/account/page.tsx
  - antd Form + Form.Item rules：旧密码必填、新密码≥8、新密码=确认
  - 提交调 changePassword(oldPassword, newPassword)；成功 message.success；失败（401）旧密码字段标红
  - 样式参考 CLAUDE.md 规则 17 前端样式系统
acceptance:
  - 表单三字段 + 校验（新≥8、新=确认）
  - 成功提示 + 401 旧密码错误展示（AC-08）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints:
  - 不做强制改密码（YAGNI）
  - 样式遵循前端样式系统
---

# task-07：个人中心页与修改密码表单

## 依据
- design.md §5.2（前端个人中心页）、§9 AC-08、D-003@v1（新密码 min_length=8，允许新=旧）
- FR-06 / FR-07：antd Form 三字段（旧/新/确认）+ 校验 + 提交提示
- task-06 提供 `changePassword(oldPassword, newPassword)`

## 实现要点
1. 新建 `frontend/src/app/(dashboard)/account/page.tsx`（"use client"）。
2. antd `Form` + 三个 `Form.Item` + `Input.Password`：
   - 旧密码：required
   - 新密码：required + `min: 8`（对齐 D-003）
   - 确认新密码：required + 自定义 validator（依赖新密码值，新≠确认报错）
3. `onFinish` 调 `changePassword(old, new)`：
   - 成功 → `message.success("密码已修改，其他设备需重新登录")` + `form.resetFields()`
   - 失败（401 旧密码错，错误码 `HTTP_401_PASSWORD_INCORRECT`）→ `form.setFields([{ name:"oldPassword", errors:["旧密码错误"] }])`
4. 样式遵循 CLAUDE.md 规则 17 前端样式系统（卡片式表单，对齐 `(dashboard)/settings/*` 风格）。

## 验收（AC-08）
- 表单三字段 + 校验（新≥8、新=确认）
- 成功提示「密码已修改，其他设备需重新登录」
- 401 旧密码错误 → 旧密码字段标红 + 文案

## 约束
- 不做强制改密码（§3 YAGNI）
- 新密码允许与旧密码相同（D-003，不查新=旧）
- 样式遵循前端样式系统
