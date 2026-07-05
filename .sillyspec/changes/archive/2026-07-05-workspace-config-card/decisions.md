---
author: qinyi
created_at: 2026-07-05T01:01:22
change: 2026-07-05-workspace-config-card
stage: brainstorm
---

# Decisions — 工作区配置卡

本次变更的决策台账。每条记录有稳定版本 ID（D-xxx@V1）；若后续 Design Grill 修正，新记录使用 @V2 并写明 supersedes。

---

## D-001@V1 配置信息数据源

- **type**: architecture
- **status**: accepted
- **source**: 用户原话 + 调研（全项目源码 grep + docs/sillyspec/finished/scan-platform-params-ignored.md）
- **question**: 工作区配置卡片的数据源用哪个？用户字面提到项目根 `.sillyspec-platform.json`，但该文件疑似过时。
- **answer**: 用 backend DB（`GET /my-binding` 返回 `MemberBindingView` + `GET /spec-workspace` 返回 `SpecWorkspaceRead`），**不读**项目根那份 camelCase 字段的 `.sillyspec-platform.json`。
- **normalized_requirement**: 卡片所有字段来自 backend API；不读本地文件系统；不展示过时标记文件内容。
- **impacts**:
  - 不需要新增 backend API（已有端点足够）
  - 不需要前端文件读取能力（浏览器本来也读不到本地文件）
  - daemon 写的新 schema `.sillyspec-platform.json`（snake_case 6 字段）也不直接展示——其信息已被 DB 字段覆盖
- **evidence**:
  - 全项目源码 grep `"specRoot"|"scanRunId"|runtimeRoot|workspaceId` 零命中写入方（仅 task-03.md 文档 + 旧排查笔记提及）
  - `docs/sillyspec/finished/scan-platform-params-ignored.md` 第 34 行：「backend 写入源码目录的 `.sillyspec-platform.json`（含 specRoot/runtimeRoot/workspaceId/scanRunId/savedAt 字段）也**不被 sillyspec 读取**——它只是 backend 的平台上下文标记」
  - 当前 backend 源码 `grep '.sillyspec-platform' type:py` 仅命中注释/docstring，无写文件代码 → 该文件在当前架构下无写入方，是历史遗留
  - 真实生效配置在 `workspace_member_runtimes`（per-member）+ `spec_workspaces`（工作区级）两张表
- **priority**: P0（数据源选错整个方案失败）

---

## D-002@V1 spec_root / runtime_root 可编辑范围

- **type**: scope
- **status**: accepted
- **source**: AskUserQuestion Q2 用户选择
- **question**: 用户原话「specRoot 和 runtimeRoot 支持修改」，但这两个在当前架构是工作区共享、平台权威值，改它影响所有成员。具体让用户改哪个？
- **answer**: spec_root / runtime_root **保持只读**；可编辑范围限定为 per-member 的 root_path / daemon_id / path_source（已由 workspace-config-flow 变更实现基础，本次做整合 + 显眼位置）。
- **normalized_requirement**: 「工作区文档存储」组所有字段无编辑入口；「我的接入」组 root_path/daemon/path_source 三字段可编辑（就地展开 WorkspaceAccessGuide 编辑模式）。
- **impacts**:
  - 不做服务器文档目录迁移逻辑
  - 不做 per-member spec_root（不颠覆"工作区共享一份文档"模型）
  - 复用 `upsertMyBinding` API（已有）
- **evidence**: 用户选「只强化本地路径/daemon 编辑（推荐）」；architecture 调研显示 spec_root 由 `bootstrapSpecWorkspace` 自动建、runtime_root 是 `<spec_root>/runtime` 派生值
- **priority**: P0（决定整个 UI 编辑结构）

---

## D-003@V1 卡片位置与现有区块关系

- **type**: ui-structure
- **status**: accepted
- **source**: AskUserQuestion Q3 用户选择
- **question**: 「我的工作区配置」卡片放详情页哪里？与现有「规范管理（Spec Workspace）」区块什么关系？
- **answer**: **升级**现有「规范管理」SectionCard 为「我的工作区配置」卡（替换 page.tsx 第 598-825 行），不新增独立区块、不合并进「基本信息」。
- **normalized_requirement**: 删除 page.tsx 598-825 行原 SectionCard，替换为 `<WorkspaceConfigCard>`；不保留两份配置 UI；不污染基本信息区。
- **impacts**:
  - page.tsx 减载（删 ~227 行配置 JSX + 相关 state）
  - 现有"规范管理"区的操作按钮（初始化/扫描/同步/导入）和三态引导逻辑迁入新卡片
  - 避免信息重复（spec_root/sync_status 不在两处展示）
- **evidence**: 用户选「升级现有『规范管理』区（推荐）」；调研报告显示该区当前只读展示 spec_root/sync_status/profile_version/last_synced_at，与新卡片字段是子集关系
- **priority**: P1（决定改造范围）

---

## D-004@V1 daemon 本地缓存路径展示

- **type**: ui-detail
- **status**: accepted
- **source**: AskUserQuestion Q4 用户选择
- **question**: 要不要在卡片里展示 daemon 本地缓存路径（cache_root = 用户机器上 `~/.sillyhub/daemon/specs/<工作区ID>`）？前端无法知道用户实际 home 目录。
- **answer**: 展示约定模板 `~/.sillyhub/daemon/specs/<workspaceId>` + 通俗 tooltip 解释 `~` 三平台含义。仅 daemon-client 工作区展示（server-local 隐藏）。
- **normalized_requirement**: 「守护进程本地缓存」字段值 = 约定模板字符串；tooltip 文案「守护进程在你电脑上缓存这个工作区文档的位置。`~` = 你的用户主目录（Windows: `C:\Users\<你>`；macOS/Linux: `/home/<你>`）」；path_source !== 'daemon-client' 时隐藏该字段。
- **impacts**:
  - 前端按约定计算 cacheRoot，不需要后端给
  - 文案需通俗（用户不太懂代码，CLAUDE.md 规则 15）
- **evidence**: 用户选「展示缓存路径+通俗说明（推荐）」；daemon 端 `PLATFORM_CONFIG_FILENAME` 写入约定路径 `~/.sillyhub/daemon/specs/<ws>`
- **priority**: P2（展示细节）

---

## D-005@V1 组件组织方式

- **type**: implementation
- **status**: accepted
- **source**: AskUserQuestion Q5 用户选择
- **question**: 卡片组件怎么组织？UI 一样，差异在代码结构。
- **answer**: 新建独立 `WorkspaceConfigCard` 单组件（自包含数据获取 + 状态 + 两组布局 + 编辑入口 + 操作按钮），复用现有 `WorkspaceAccessGuide`（首次+编辑模式）+ `WorkspaceBindingGuard`（未绑定分支）子组件不重写。不拆两子组件（YAGNI）。
- **normalized_requirement**: 单文件 `workspace-config-card.tsx`；内部子组件复用而非重写；详情页只渲染 `<WorkspaceConfigCard workspaceId isOwner />`。
- **impacts**:
  - 文件变更清单：2 新增（组件 + 测试）+ 2 修改（page.tsx + binding-guard 收敛）
  - 不重写已稳定的 AccessGuide / BindingGuard 逻辑
  - 方案 B（拆两子组件）YAGNI 被否；方案 C（就地改 page.tsx）详情页 800+ 行持续膨胀被否
- **evidence**: 用户选「新建独立配置卡组件（推荐）」；page.tsx 当前 800+ 行，配置逻辑继续就地膨胀可读性差
- **priority**: P1（决定文件结构）
