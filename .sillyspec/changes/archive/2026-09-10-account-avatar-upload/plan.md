---
plan_level: full
---

# 实现计划（Plan）— 2026-09-10-account-avatar-upload

## Spike 前置验证

无——技术不确定性低：全部复用既有验证过的管线（文件中心上传 / useAvatarSrc / GroupMemberAvatarUpload / alembic add_column 先例），Grill 已对源码逐点核实。

## Wave 1（并行，无依赖）——后端数据层

- task-01
- task-02

## Wave 2（依赖 Wave 1）——后端端点与群聊回落

- task-03
- task-04

## Wave 3（依赖 Wave 2；task-06 仅依赖本 wave 内无依赖）——前端基座

- task-05
- task-06

## Wave 4（依赖 Wave 3）——前端页面与展示接线

- task-07
- task-08
- task-09
- task-10

## Wave 5（依赖 Wave 1-4）——验收

- task-11

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | User.avatar 列 + alembic 迁移 | W1 | P0 | — | FR-01, D-001@v1 | model.py 加列（String 512 nullable，放 display_name 邻域）+ 迁移 20260910160000_users_avatar.py（add_column / 对称 drop） |
| task-02 | UserRead.avatar + UpdateMyAvatarRequest schema | W1 | P0 | — | FR-01, FR-02 | schema.py：UserRead 追加 avatar（default=None 兼容 mock fixture）；新 DTO max_length=512 + extra=forbid |
| task-03 | PATCH /api/auth/me/avatar 端点 + service + 四态测试 | W2 | P0 | task-01, task-02 | FR-02 | router 端点（get_current_user + SessionDep，对齐 change_password 风格）；service.update_my_avatar（值=设/空串=置 NULL/None=不改）；tests/modules/auth/test_my_avatar.py 四态 + 422 |
| task-04 | 群成员 user 侧 avatar 回落解析 + 测试 | W2 | P1 | task-01 | FR-05, D-002@v1 | daemon/group 构造点：helpers._to_read:701（批量预取 user_id→avatar 映射后处理 read.members）+ members.py:203/219（加用户成员返回，单查目标 user）+ 512（改成员返回）；673 重置记忆仅 agent 成员无需回落；tests/modules/daemon/test_group_member_avatar_fallback.py |
| task-05 | SessionUser.avatar + updateMyAvatar() + gen:types | W3 | P0 | task-03 | FR-01, FR-06 | pnpm gen:types 再生成 api-types.ts + openapi.json；stores/session.ts 加可选字段；lib/auth.ts 新函数（PATCH 后重跑 fetchMe 取规范 user 写回 store） |
| task-06 | GroupMemberAvatarUpload 扩 ownerType prop | W3 | P1 | — | FR-03, FR-04 | 可选 prop 默认 GROUP_MEMBER_AVATAR_OWNER_TYPE，既有两调用方零改动；导出 USER_AVATAR_OWNER_TYPE="user_avatar" 常量 |
| task-07 | 桌面 /account 个人资料卡片 | W4 | P0 | task-05, task-06 | FR-03 | 修改密码卡片上方加卡片：GroupMemberAvatarUpload（ownerType=user_avatar）+ updateMyAvatar；page.test.tsx 补用例 |
| task-08 | 移动 /m/account 头像上传 | W4 | P0 | task-05, task-06 | FR-04 | 头像整块可点（相机角标），选图上传 + updateMyAvatar；恢复默认入口；触控 ≥44px；NEW page.test.tsx |
| task-09 | TopBar avatar prop 接线 | W4 | P1 | task-05 | FR-05 | app-shell 取 user.avatar 传入；top-bar.tsx shadcn Avatar 内嵌头像（useAvatarSrc blob），无图首字；NEW top-bar-avatar.test.tsx |
| task-10 | 会话气泡 sender.me 头像接线 | W4 | P2 | task-05 | FR-05 | turn-timeline.tsx 用户气泡（sender.me）传 useSession user.avatar；接线极薄（一行 prop），无自动化用例，verify 阶段目检兜底 |
| task-11 | verify 验收 | W5 | P0 | task-01~10 | 全部 FR | verify 阶段执行（独立阶段，不写码）：对照 design/requirements 逐条核验 + 相关测试全绿 + 双主题目检 |

## 关键路径

task-01、task-02（W1 并行，无依赖边）→ task-03 → task-05 → task-07 / task-08（W4 同层）→ task-11

（最长串行链决定最短交付周期；W1 两任务间无依赖，仅因 task-03 同时消费两者而汇合。）

## 全局验收标准

1. 相关单元/组件测试全绿（auth 四态 + 回落解析 + 三页面/组件用例；按 CLAUDE.md 规则 0 仅跑相关测试，全量留 CI）
2. brownfield 兼容：未设置头像时五处展示点行为与现状一致（首字回退）；旧 localStorage user 缺 avatar 字段不报错
3. 群聊既有语义不变：群内自定义头像优先、agent 成员头像不受影响、PATCH 群成员 None=不改/空串=清除语义不变
4. `api-types.ts` 与 `openapi.json` 同批提交（不落后后端形成类型债）

## 覆盖矩阵（如存在 decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-03, task-05, task-06 | AC-1（迁移后列存在、/me 带出 avatar）；test_my_avatar.py 四态绿 |
| D-002@v1 | task-04 | test_group_member_avatar_fallback.py：自定义优先/空值回落/agent 不受影响 |
| D-003@v1 | task-11（verify 核对非目标零触碰） | PPM 模块文件零改动（git diff 证据） |
