---
author: qinyi
created_at: 2026-09-10 15:50:00
change: 2026-09-10-account-avatar-upload
---

# 任务清单（Tasks）— 个人中心头像替换

> 任务细节（Wave 分组、依赖、验收命令）在 plan 阶段展开。

- task-01 后端：`User.avatar` 列 + alembic 迁移
- task-02 后端：`UserRead.avatar` + `UpdateMyAvatarRequest` schema
- task-03 后端：`PATCH /api/auth/me/avatar` 端点与 service 逻辑 + 四态测试
- task-04 后端：群成员 user 侧 avatar 回落解析（daemon/group 构造点）+ 测试
- task-05 前端：`SessionUser.avatar` + `updateMyAvatar()`（fetchMe 映射惯例）+ gen:types
- task-06 前端：`GroupMemberAvatarUpload` 扩 `ownerType` prop
- task-07 前端：桌面 `/account` 个人资料卡片
- task-08 前端：移动 `/m/account` 头像上传
- task-09 前端：TopBar avatar prop 接线（app-shell → TopBar）
- task-10 前端：会话气泡 sender.me 头像接线
- task-11 验收：verify 对照 design/requirements + 相关测试全绿
