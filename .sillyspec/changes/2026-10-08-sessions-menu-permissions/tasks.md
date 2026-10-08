---
author: flow-machine-draft
created_at: 2026-10-08T01:54:07.676Z
---
# 任务注册表（Tasks）— 2026-10-08-sessions-menu-permissions

- [x] task-01: sessions 菜单 permissions 补齐为 agent_session:read / task:run_agent / daemon:borrow / runtime:admin 四项（menu-permissions.ts sessions 项 1→4 + 注释补后端依据；sessions 用例四项期望写进 menu-permissions.test.ts，与本文件同提交）——验证：menu-permissions.test.ts「sessions 菜单…四项门控」绿
- [x] task-02: 角色管理勾选器「智能体会话」卡片可勾选上述全部权限（数据源驱动零组件改动；消费方 admin-role-permission-picker-tree.test.tsx 的 0/4 唯一性断言放宽 getAllBy——sessions 现同 4 权限不再唯一）——验证：picker tree 测试 6 用例绿
- [x] task-03: 测试镜像常量 BACKEND_PERMISSION_KEYS 与后端 72 项枚举对齐（补 daemon:borrow / knowledge:write / ppm:problem-change:read，计数断言 69→72；「4 个原常显菜单」用例 sessions 放宽 toContain）——验证：「镜像常量长度 === 72」用例绿
- [x] task-04: 相关测试 + tsc + lint 验证（menu-permissions 41 + permission 21 + picker tree 6 + app-shell 9 + menu-overrides 19 全绿；tsc --noEmit 零输出；改动文件 eslint 0 error——2 条 unused warning 为存量未触碰）——验证：本行即记录
