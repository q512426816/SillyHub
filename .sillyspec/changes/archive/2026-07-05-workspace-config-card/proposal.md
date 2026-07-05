---
author: qinyi
created_at: 2026-07-05 01:12:09
change: 2026-07-05-workspace-config-card
stage: brainstorm
---

# Proposal — 工作区配置卡（WorkspaceConfigCard）

## 动机

工作区详情页现有「规范管理（Spec Workspace）」区块只读展示部分服务器侧 spec 信息（spec_root / sync_status / profile_version / last_synced_at），当前用户在该工作区的接入信息（绑定守护进程、本地项目路径、初始化状态）藏在「编辑我的接入配置」按钮后的弹层里。用户打开详情页无法一眼看清：

- 自己机器上文档到底存在哪（服务器目录 / runtime 目录 / 守护进程本地缓存）
- 自己接的是哪个守护进程、本地项目路径是什么、初始化到哪一步
- 哪些是自己能改的（per-member）、哪些是全工作区共享不能随便改的

用户原话诉求：「工作区页面应该能看到 `.sillyspec-platform.json` 对应的配置信息，方便用户知道对应的文档存储位置；specRoot 和 runtimeRoot 支持修改；不同用户配置可能不同，但多个用户共用同一个工作区」。

## 关键问题（为什么现有方案不够）

1. **配置信息散落**：spec_root / sync_status 在"规范管理"区只读展示，但 root_path / daemon / init 状态要进编辑弹层才看到——用户看不出完整图景。
2. **过时文件误导**：项目根的 `.sillyspec-platform.json`（camelCase 字段）是历史遗留，全项目源码无写入方、不被任何代码读取，用户以为它是真相其实不是。
3. **缺失关键展示**：现有方案没有「守护进程本地缓存路径」和「runtime 目录」展示，用户在本地排查问题时找不到缓存位置。
4. **角色边界模糊**：用户分不清哪些是 per-member（自己改）vs 全工作区共享（不能自己改）。
5. **详情页臃肿**：page.tsx 已 800+ 行，配置逻辑就地膨胀难维护。

## 变更范围

- 升级详情页「规范管理」SectionCard 为「我的工作区配置」卡（page.tsx 第 598-825 行替换为新组件）。
- 新建 `<WorkspaceConfigCard>` 组件，内分两组：
  - **「我的接入」**（per-member 可编辑）：绑定守护进程 / 本地项目路径 / 路径来源 / 接入初始化状态 / 上次接入同步
  - **「工作区文档存储」**（共享只读）：服务器文档目录 / runtime 目录 / 守护进程本地缓存 / 文档版本 / 同步状态 / 上次文档同步 / spec 策略
- 编辑入口「编辑我的接入」做到「我的接入」组右上角显眼位置，点击就地展开 WorkspaceAccessGuide 编辑模式（不弹 Modal）。
- 守护进程本地缓存路径含 `~` 配通俗 tooltip（三平台含义）。
- 操作按钮（初始化 / 扫描 / 同步到服务器 / 导入 / 生成项目组件）的 handlers 从 page.tsx 等价迁入卡片。
- server-local 工作区隐藏 daemon/cache 字段。

## 不在范围内（显式清单）

- **不让 spec_root / runtime_root 可编辑**：共享权威值，改它 = 整树迁移影响所有成员；用户已通过 AskUserQuestion 确认放弃。
- **不读项目根过时的 `.sillyspec-platform.json`**：历史遗留，不被读。
- **不展示 daemon 写的新 schema `.sillyspec-platform.json`**：daemon 自用保鲜文件，信息已被 DB 字段覆盖。
- **不新增 backend API / 不改 schema**：所需 API（`GET /my-binding` + `GET /spec-workspace`）已存在。
- **不改 daemon 端代码**。
- **不改 spec 策略运行时切换**（创建时定死，只读展示）。
- **不改基本信息区的 WorkspaceDaemonSwitcher**：保留作快速改绑 daemon 入口（仅改 daemon_id 的轻量操作），与新卡片"完整编辑接入"（daemon + path + source）职责不同，共存。
- **不改 WorkspaceBindingGuard**：详情页未引用该组件。
- **不拆两子组件**：YAGNI，单卡片足够承载两组信息。

## 成功标准（可验证条件）

- **SC-1**：打开任意 daemon-client 工作区详情页，能在一张卡片内看到「我的接入」5 字段 + 「工作区文档存储」7 字段，无需点击进入弹层。
- **SC-2**：点击「编辑我的接入」就地展开表单（回填当前 binding），保存后字段刷新、表单收起。
- **SC-3**：server-local 工作区详情页，卡片隐藏「绑定守护进程」「守护进程本地缓存」字段，显示说明文案。
- **SC-4**：守护进程本地缓存字段 tooltip 含 `~` 三平台（Windows / macOS / Linux）解释。
- **SC-5**：「工作区文档存储」组无任何编辑入口（共享只读）。
- **SC-6**：初始化 / 扫描 / 同步 / 导入按钮在新卡片内，行为与改造前等价（含轮询、409 重扫确认、状态反馈、卸载清理）。
- **SC-7**：page.tsx 行数显著减少（删除第 598-825 行 + 配置 state/handlers），其他区块（基本信息 / 默认智能体 / Overview / Quick nav）行为不变。
- **SC-8**：详情页现有测试 `page.test.tsx` 全绿 + 新组件测试覆盖 §5.3 六态 + 编辑流程 + 操作按钮行为。

## 关联

- 设计详见 `design.md`；决策详见 `decisions.md`（D-001~D-005）；原型 `prototype-workspace-config-card.html`。
- 复用 `2026-07-02-workspace-config-flow` 已落地的 per-member 接入编辑基础（WorkspaceAccessGuide / upsertMyBinding）。
