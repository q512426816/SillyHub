---
author: flow-machine-draft
created_at: 2026-09-27T10:15:36.195Z
---
# 任务注册表（Tasks）— 2026-09-27-session-portal-ia-restructure

> 机器预填草稿已按实际实现路径覆写。验收锚在 requirements（FR-01~FR-08）。
> ✅ 边干边勾：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`。

- [x] task-01: 功能清点基线存档 feature-inventory.md（三子代理清点整合，FR-01 对照物）+ 右列三模式骨架（收起/详情/子代理，列模式状态 + localStorage 记忆 + 详情开关按钮接入头部占位）(FR-01, FR-02)
- [x] task-02: 详情模式内容三组——概览（元信息 MetaPanel + #id 复制 + 配置快照）、用量（SessionUsageBar 迁入）、任务（TaskExecutionPanel 迁入 + applyEvent 链路保持）；desktop 原位置同步移除，mobile 维持原挂载 (FR-02, FR-04)
- [x] task-03: 中栏头部两层化——主行降噪（标题/状态 StateLabel/视图tab/后台目录/子代理目录/详情开关/搜索/打断），元信息降级次行 muted meta 行（#id 复制/机器/工作区/共享徽标）+ 相关测试同步 (FR-03)
- [x] task-04: 左栏筛选区紧凑化——搜索+状态同行、机器/智能体/关联紧凑排布（flex-wrap 两行内），联动/记忆/重置行为不变 + 相关测试同步 (FR-05)
- [x] task-05: 行为零改动红线审查——diff 逐行核对仅 render 组织层；深链/四分支/草稿/队列/滚动行为点验；/m/ 与群聊零波及核对 (FR-06)
- [x] task-06: 功能零丢失对照验收——feature-inventory.md 逐项打勾对照 + 三主题 token 零硬编码 grep + tsc/eslint 零新增 + 相关测试全绿 (FR-01, FR-07, FR-08)
