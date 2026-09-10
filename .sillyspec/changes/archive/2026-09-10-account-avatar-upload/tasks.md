---
author: qinyi
created_at: 2026-09-10 15:50:00
change: 2026-09-10-account-avatar-upload
---

# 任务清单（Tasks）— 个人中心头像替换

- [x] task-01: User.avatar 列 + alembic 迁移
- [x] task-02: UserRead.avatar + UpdateMyAvatarRequest schema
- [x] task-03: PATCH /api/auth/me/avatar 端点 + service + 四态测试
- [x] task-04: 群成员 user 侧 avatar 回落解析 + 测试
- [x] task-05: SessionUser.avatar + updateMyAvatar() + gen:types
- [x] task-06: GroupMemberAvatarUpload 扩 ownerType prop
- [x] task-07: 桌面 /account 个人资料卡片
- [x] task-08: 移动 /m/account 头像上传
- [x] task-09: TopBar avatar prop 接线
- [x] task-10: 会话气泡 sender.me 头像接线
- [x] task-11: verify 验收（对照 design/requirements + 相关测试全绿）
