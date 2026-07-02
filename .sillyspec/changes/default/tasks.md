---
author: WhaleFall
created_at: 2026-06-25T14:01:00
---

# quick 任务 — default

- [x] **参考 ppm/project-plans 样式调整 admin/users 页面**（布局 + 查询条件 + 列表对齐 layout 组件模式）✅ 已完成
  - 文件：`frontend/src/app/(dashboard)/admin/users/page.tsx`
  - 方案：
    1. 布局：裸 `div max-w-7xl` → `PageContainer` + `PageHeader`(title 用户管理)
    2. 查询条件：裸 input/select/按钮 → `SectionCard`(bodyPadding p-2) + `SearchBar`(搜索 input + 状态 select) + `SearchBarActions`(共 N + 新建)；保留 debounce 搜索
    3. 列表：裸 antd `Table` → `DataTable`(bordered + emptyText)
  - 依据：`ppm/project-plans/page.tsx` 模式 + CLAUDE.md 规则 15（layout 组件样式系统）
  - 不变：load/handlers/columns 逻辑、Drawer/Dialog 子组件
  - commit：`8e86679b`（已 push + rebuild frontend 部署）

- [x] **修正 admin/users 对齐偏差**（用户反馈：搜索条件布局/新建按钮位置/列表高度不对）
  - commit：`ca9e99c6`（已 push + rebuild frontend 部署 healthy）
  - 修正点：
    1. 查询区：横向 SearchBar → **grid-cols-4 垂直 Field 表单**（关键词 Input + 状态 Select），控件原生 → antd Input/Select
    2. 新建按钮：SearchBarActions 内 → **顶部操作按钮行右端**（搜索/重置/分隔/+新建用户，justify-end）
    3. 列表高度：无 y → **scroll.y = calc(100vh - 430px)**
    4. 加 Field 组件（垂直 label）+ handleSearchClick/handleResetClick（搜索按钮即时 + 重置）
    5. 去掉冗余顶部「共 N」（分页 showTotal 已有）
  - 文件：`frontend/src/app/(dashboard)/admin/users/page.tsx`
  - 验证：typecheck no errors、lint 无 page.tsx 相关、frontend rebuild healthy

- [x] **成员接入引导卡片：Daemon Runtime 改下拉 + 路径来源/标签中文化**
  - 文件：`frontend/src/components/workspace-access-guide.tsx`（+ 补最小测试）
  - 背景：`/workspaces/[id]` 当前用户未配置 binding 时弹出的引导卡，「Daemon Runtime ID」让用户手填 UUID、「路径来源」下拉显示英文内部值，UX 不合理且违反中文 UI 规则。
  - 方案：
    1. 「Daemon Runtime ID」Input → 下拉：数据源 `listDaemonRuntimes()`（`@/lib/daemon`，已按当前登录用户过滤）；交互沿用 `workspace-daemon-switcher.tsx`（online 排前、离线也可选、每项 PROVIDER_META label + DAEMON_RUNTIME_STATUS_LABELS/labelOf + daemonRuntimeStatusVariant 状态徽标）；空态提示「请先在 /runtimes 启动一个守护进程」。
    2. 「路径来源」下拉选项显示中文：复用 `workspacePathSourceLabel()`（`@/lib/workspace-path`）→「本机守护进程路径 / 服务器本地路径」，value 仍保留英文枚举 `daemon-client`/`server-local`。
    3. 英文 label 中文化：「Daemon Runtime ID」→「绑定守护进程」。
    4. `runtime_id` 保持 `string | null`（可不选→提交 null），`root_path` 仍必填；不破坏 `MemberBindingUpsertRequest` 契约。
  - 依据：CLAUDE.md 规则 11（中文 UI）；复用现有 `listDaemonRuntimes` / `workspace-daemon-switcher` 模式 / `workspacePathSourceLabel`，不新增 API。
  - 测试：补最小用例（mock `listDaemonRuntimes` 验证下拉渲染 + 中文 label + 空态），`cd frontend && pnpm test` + `pnpm typecheck` + `pnpm lint`。
