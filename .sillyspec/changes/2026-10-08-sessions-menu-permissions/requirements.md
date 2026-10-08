---
author: flow-machine-draft
created_at: 2026-10-08T01:54:07.676Z
---
# 需求规格（Requirements）— 2026-10-08-sessions-menu-permissions

## 功能需求

### FR-01: sessions 菜单 permissions 补齐为 agent_session:read / task:run_agent / daemon:borrow / runtime:admin 四项

- 菜单注册表（frontend/src/lib/menu-permissions.ts）中 menuKey=sessions 的 permissions 数组必须包含且仅包含 agent_session:read、task:run_agent、daemon:borrow、runtime:admin 四项（顺序即此序，agent_session:read 保持首位作门控主 key）。每项必须带非空中文 name。后端依据：全部 /api/daemon/sessions* 端点经 TaskRunAgentUser 需 task:run_agent（backend/app/modules/daemon/router/__init__.py:119）；无自有 daemon 的会话借用需 daemon:borrow（backend/app/modules/agent/borrow_resolver.py:104、daemon/session/service/inject_gates.py:171）；新建会话机器·智能体下拉的数据源 GET /api/daemon/machines 需 runtime:admin（backend/app/modules/daemon/router/machines.py:47）。

#### 场景：主路径

- Given 菜单注册表已加载
- When 读取 menuKey=sessions 的 permissions
- Then key 列表严格等于 ["agent_session:read", "task:run_agent", "daemon:borrow", "runtime:admin"]

#### 场景：菜单可见性按任一命中放宽

- Given 某 role 仅持有 task:run_agent（无 agent_session:read）
- When 该用户侧边栏渲染
- Then 智能体会话菜单可见（canSeeMenu 任一命中语义，与 runtime/approvals 等既有菜单同口径）

### FR-02: 角色管理勾选器「智能体会话」卡片可勾选上述全部权限

- 角色管理页权限勾选器（admin-role-permission-picker.tsx 直接消费 MENU_PERMISSION_GROUPS）的「智能体会话」卡片必须渲染 FR-01 四项权限的 checkbox；勾选/全选行为必须与其它菜单卡片一致（toggle 同一 permission key，跨卡片计数联动）。本 FR 由数据源驱动，不新增组件代码。

#### 场景：主路径

- Given 管理员打开角色编辑弹窗
- When 左树选中「智能体会话」
- Then 右面板列出 4 个权限项（智能体会话查看/会话运行/借用守护进程/守护进程机器查看），全选计数 0/4

### FR-03: 测试镜像常量 BACKEND_PERMISSION_KEYS 与后端 72 项枚举对齐（补 daemon:borrow / knowledge:write / ppm:problem-change:read），计数断言同步

- frontend/src/lib/__tests__/menu-permissions.test.ts 的 BACKEND_PERMISSION_KEYS 必须与 backend/app/modules/auth/permissions.py 的 Permission 枚举逐项一致（72 项），补齐历史漂移缺失的 daemon:borrow、knowledge:write、ppm:problem-change:read；长度/去重计数断言必须同步为 72。既有用例「4 个原常显菜单挂独立 read 权限」对 sessions 的单元素 toEqual 断言必须放宽为 toContain（read key 仍在，但不再是唯一项）。

#### 场景：镜像护栏

- Given 后端枚举 72 项
- When 跑 BACKEND_PERMISSION_KEYS 完整性用例
- Then 长度与去重后大小均 === 72，且 sessions 菜单四个 key 全部命中镜像集合

### FR-04: menu-permissions 相关测试通过，前端 tsc/lint 无回归

- 本变更改动的 frontend/src/lib/menu-permissions.ts 与其测试文件必须通过 vitest 相关用例；受影响面前端类型检查（tsc）与 lint 必须零新增报错。禁止跑全量测试（CLAUDE.md 规则 0），仅跑本变更相关面。

#### 场景：主路径

- Given 变更代码已提交
- When 运行 frontend 下 menu-permissions / permission 相关测试与 tsc
- Then 全部通过，无新增类型/风格报错

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/lib/__tests__/menu-permissions.test.ts「sessions 菜单：agent 组 /sessions + 会话页实际权限四项门控（补齐 task:run_agent / daemon:borrow / runtime:admin）」
FR-02: frontend/src/lib/__tests__/menu-permissions.test.ts「所有 permission.key 命中 BACKEND_PERMISSION_KEYS，且镜像常量长度 === 72」（数据源驱动，勾选器无独立测试面——同文件注册表断言覆盖）
FR-03: frontend/src/lib/__tests__/menu-permissions.test.ts「所有 permission.key 命中 BACKEND_PERMISSION_KEYS，且镜像常量长度 === 72」+「4 个原常显菜单挂独立 read 权限（sessions 放宽 toContain）」
FR-04: frontend/src/lib/__tests__/menu-permissions.test.ts（全文件）+ frontend/src/lib/__tests__/permission.test.ts（canSeeMenu 任一命中回归）
