---
author: flow-machine-draft
created_at: 2026-10-08T01:54:07.676Z
---
# 提案书（Proposal）— 2026-10-08-sessions-menu-permissions

## 动机

任务原话转写：sessions 会话页实际依赖多个后端权限（全部 /api/daemon/sessions 端点 task:run_agent、业务人员借用 daemon:borrow、机器列表 /api/daemon/machines 需 runtime:admin），但菜单注册表 sessions 只挂 agent_session:read，角色管理勾选器无法在会话菜单下对应配置这些权限；补齐菜单权限映射。

成功标准：
- sessions 菜单 permissions 补齐为 agent_session:read / task:run_agent / daemon:borrow / runtime:admin 四项
- 角色管理勾选器「智能体会话」卡片可勾选上述全部权限
- 测试镜像常量 BACKEND_PERMISSION_KEYS 与后端 72 项枚举对齐（补 daemon:borrow / knowledge:write / ppm:problem-change:read），计数断言同步
- menu-permissions 相关测试通过，前端 tsc/lint 无回归

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. sessions 菜单 permissions 补齐为 agent_session:read / task:run_agent / daemon:borrow / runtime:admin 四项
2. 角色管理勾选器「智能体会话」卡片可勾选上述全部权限
3. 测试镜像常量 BACKEND_PERMISSION_KEYS 与后端 72 项枚举对齐（补 daemon:borrow / knowledge:write / ppm:problem-change:read），计数断言同步
4. menu-permissions 相关测试通过，前端 tsc/lint 无回归

## 成功标准（可验证）

1. sessions 菜单 permissions 补齐为 agent_session:read / task:run_agent / daemon:borrow / runtime:admin 四项
2. 角色管理勾选器「智能体会话」卡片可勾选上述全部权限
3. 测试镜像常量 BACKEND_PERMISSION_KEYS 与后端 72 项枚举对齐（补 daemon:borrow / knowledge:write / ppm:problem-change:read），计数断言同步
4. menu-permissions 相关测试通过，前端 tsc/lint 无回归
