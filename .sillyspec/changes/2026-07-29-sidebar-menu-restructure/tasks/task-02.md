---
id: task-02
title: menu-permissions.ts 重组 + 同步更新 menu-permissions.test.ts
title_zh: 菜单数据源按功能域重组并更新测试
author: qinyi
created_at: 2026-07-30 09:06:13
priority: P0
depends_on: []
blocks: [task-03, task-04, task-05]
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v1, D-003@v1, D-006@v1]
allowed_paths:
  - frontend/src/lib/menu-permissions.ts
  - frontend/src/lib/__tests__/menu-permissions.test.ts
goal: >
  把菜单唯一数据源 menu-permissions.ts 从旧 5 分组 overview/management/admin/system/ppm 重组为
  新 6 分组 workspace/agent/config/governance/system/ppm，并新增 llm-providers、skills、mcp
  三个菜单项，同时同步更新 menu-permissions.test.ts 断言；这是 app-shell、picker、permission
  等下游消费的根基，必须先落地。
implementation:
  - MenuSection 联合类型改为 workspace/agent/config/governance/system/ppm 六值
  - 按 design §5.1 重排菜单项，工作区 8 项（原 overview 平移）、智能体 4 项、配置中心 4 项、协作治理 3 项、系统管理 4 项（用户/组织/角色/设置），守护进程运行时 runtimes 从 system 移入 config（D-006）
  - 新增 3 菜单项，llm-providers 我的供应商归 config 组 href 为 /settings/providers 权限 key 为 llm_provider:read，skills 技能管理与 mcp MCP 管理归 agent 组 href 分别为 /settings/skills 与 /settings/mcp 权限均为 settings:admin，结构严格沿用 design §7.1
  - 更新 MENU_SECTION_ORDER 为 workspace/agent/config/governance/ppm/system（ppm 保持中段位置或按既有渲染习惯，以 app-shell 消费方 task-03 定稿为准）并更新 MENU_SECTION_LABEL 中文标签
  - 同步更新测试，EXPECTED_MENU_KEYS 加 3 项总数 34 变 37，VALID_SECTIONS 与新 section 分布断言（workspace 8/agent 4/config 4/governance 3/system 4/ppm 14），BACKEND_PERMISSION_KEYS 补 llm_provider:read（长度 62 变 63）
acceptance:
  - MenuSection 六值与 design §7.1 一致，旧 overview/management/admin 字样全部移除
  - 菜单总数 37，新增 llm-providers/skills/mcp 三项且 section/href/permissions 与 design §7.1 完全一致
  - MENU_SECTION_ORDER 与 MENU_SECTION_LABEL 覆盖全部六分组且无遗漏键
  - ppm 组 14 项内容与 navHidden 标记保持原样未动
verify:
  - cd frontend 后执行 pnpm vitest run src/lib/__tests__/menu-permissions.test.ts
  - cd frontend 后执行 pnpm exec tsc --noEmit
  - 全局搜索 overview/management/admin/system 旧 section 残留，确认 MenuSection 引用处不再使用旧值
constraints:
  - 仅允许改动 allowed_paths 内两个文件，不改 permission.ts 与 app-shell.tsx（属 task-03）
  - 菜单项既有字段 menuLabel/icon/href/matchPattern/absolute/permissions 只改 section 归属与新增项，不得顺手改文案或图标
  - 本任务不做后端 permissions.py 加枚举（属后续 task），测试镜像常量 llm_provider:read 仅先行登记
---
