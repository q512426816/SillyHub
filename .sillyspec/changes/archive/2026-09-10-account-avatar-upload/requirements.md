---
author: qinyi
created_at: 2026-09-10 15:50:00
change: 2026-09-10-account-avatar-upload
---

# 需求（Requirements）— 个人中心头像替换

## FR-01 头像存储与读取（D-001）

`users` 表新增 `avatar` 列（VARCHAR 512，nullable），值域为文件中心 URL（`/api/file/{id}`）或 http(s) 外链；NULL=未设置。`GET /api/auth/me` 的 `UserRead` 带出 `avatar` 字段。

验收：迁移后列存在且旧行全 NULL；`/api/auth/me` 响应含 `avatar` 键；未登录 401 不变。

## FR-02 头像更新端点

`PATCH /api/auth/me/avatar`（登录态）：body `{avatar: str | null}`，max_length=512，extra=forbid。语义：非空字符串=设置为新值；空串=清除（置 NULL）；None（字段缺省）=不改（幂等返回当前值）。返回更新后 `UserRead`。

验收：四态测试（设置/清除/None 不改/未登录 401）+ 超长 422；仅本人 token 可改本人。

## FR-03 桌面个人中心上传 UI

`/account` 页新增「个人资料」卡片：头像预览（圆形）、更换头像（选图直接上传，无裁剪）、恢复默认（清除）。上传走文件中心（owner_type=`user_avatar`），成功后 `PATCH /api/auth/me/avatar` + 写回 session store。

验收：mock 上传与 PATCH 的组件测试；上传失败有提示；未设头像时显示首字回退（现状行为）。

## FR-04 移动个人中心上传 UI

`/m/account` 头像区整块可点上传（相机角标提示），选图直接上传；有自定义头像时提供恢复默认入口；上传中禁点/失败提示。

验收：同 FR-03 口径的组件测试；触控目标 ≥44px（页面既有移动规范）。

## FR-05 头像展示五处

个人中心（桌面+移动，随 FR-03/04）、桌面顶栏用户区（TopBar avatar prop，无图维持首字）、群聊用户成员（D-002 后端回落：`member.avatar or user.avatar`，agent 成员不变）、1:1 会话自己气泡（sender.me 时传头像）。图片渲染统一走 `useAvatarSrc`（blob 拉取，失败回退首字）。

验收：TopBar 头像渲染测试；群聊回落：群内自定义优先、空值回落平台头像、agent 成员不受影响的 service 层测试。

## FR-06 类型同步

后端 schema 改动后 `pnpm gen:types` 重新生成 `frontend/src/lib/api-types.ts` 并提交 `backend/openapi.json`（CLAUDE.md 规则 21）。

## 非需求（明确不做）

- PPM 个人工作台 `avatar_text` 维持首字（D-003）；
- 裁剪器、外链 URL 手输、群内用户成员独立头像覆盖 UI；
- 头像压缩/审核专项。

## 决策引用

- D-001@v1（存储架构，FR-01/02/03/04）
- D-002@v1（群聊回落解析，FR-05）
- D-003@v1（PPM 非目标，非需求第 1 条）

全部当前版本 D-xxx@vN 已覆盖；无剩余未覆盖决策。
