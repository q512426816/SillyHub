---
id: task-01
title: 前端桌面登录页删明文密码缓存 + 默认回填 + 文案 + 旧缓存清洗
title_zh: 桌面登录页删 localStorage 明文密码与 admin/admin123 默认回填
author: qinyi
created_at: 2026-08-09 13:18:35
priority: P0
depends_on: []
blocks: [task-07]
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/(auth)/login/page.tsx
goal: >
  桌面登录页不再把密码明文存 localStorage、不再默认回填 admin/admin123，记住我只存账号，并清洗旧缓存里的明文密码。
implementation:
  - 回填段（:48-53）改为只 setFieldsValue account（删 ?? admin）与 remember，不再 set password（删 ?? admin123）
  - doLogin 写缓存段（:72-83）勾选记住我时只存 {account, remember}，删 password 字段
  - 回填时加旧缓存清洗 若 cached.password 不为 undefined 则用无密码版 setItem 重写一次性清除浏览器已存明文
  - 复选框文案（:202）记住密码改为记住登录名
acceptance:
  - 登录后浏览器 DevTools 查 localStorage 的 sillyhub.login.remember 值不含 password 键
  - 清空缓存进登录页 账号密码输入框均空
  - 预置旧格式含 password 的缓存访问后 localStorage 被重写为无 password 版
  - 复选框显示记住登录名
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints:
  - 不改 PLATFORM_KEY 平台选择逻辑（仅存平台 无敏感 保留）
  - 不动验证码 ConfirmCaptcha / handleVerified 链路
  - 不改 doLogin 的 login 调用签名（token 透传逻辑保留）
  - 与移动页 task-02 保持同 key 同逻辑
related_tests: []
---

# task-01 桌面登录页

详见 frontmatter。源文件 `frontend/src/app/(auth)/login/page.tsx`，对照 design.md §6.1 与 §5 文件清单。
