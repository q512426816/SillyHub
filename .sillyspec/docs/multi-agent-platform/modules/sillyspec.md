---
schema_version: 1
doc_type: module-card
module_id: sillyspec
author: qinyi
created_at: 2026-06-04T11:20:00+08:00
---

# sillyspec

## 定位
文档驱动的变更管理框架，负责定义和组织 `.sillyspec/**` 目录结构下的变更生命周期、工作流规则、技能编排和知识管理。**不负责**代码执行、Agent 调度、Git 操作或实际文档写入——这些由 `change`、`agent`、`workflow`、`git_gateway`、`change_writer` 等模块承担。

## 契约摘要

### 标准工作流阶段
- **SCAN**：项目扫描，生成 7 维文档（ARCHITECTURE/CONVENTIONS/STRUCTURE/INTEGRATIONS/TESTING/CONCERNS/PROJECT）
- **BRAINSTORM**：需求分析，输出初始 proposal.md
- **PROPOSE**：方案审核，完善 proposal.md
- **PLAN**：任务拆解，生成 plan.md（Wave 分组 + Task 列表）
- **EXECUTE**：代码实现，在 worktree 隔离环境执行
- **VERIFY**：验收检查，对照 design/plan 验证成果
- **ARCHIVE**：影响分析，归档变更并沉淀知识
- **QUICK**：快速通道，跳过 brainstorm/plan，直接修复

### 技能编排（16 个 sillyspec-* 技能）
- **启动类**：`sillyspec-init`（绿地项目初始化）、`sillyspec-propose`（生成规范文档）
- **流程类**：`sillyspec-auto`（全自动推进）、`sillyspec-continue`（判断下一步）、`sillyspec-resume`（恢复中断）
- **阶段类**：`sillyspec-brainstorm`、`sillyspec-plan`、`sillyspec-execute`、`sillyspec-verify`
- **快速类**：`sillyspec-quick`（直接小修复）、`sillyspec-commit`（智能提交）
- **管理类**：`sillyspec-status`、`sillyspec-state`、`sillyspec-doctor`（状态修复）
- **其他**：`sillyspec-scan`（扫描项目）、`sillyspec-archive`（归档变更）、`sillyspec-workspace`（工作区管理）、`sillyspec-export`（导出模板）、`sillyspec-explore`（只读调研）

### 工作流模板
- **scan-docs.yaml**：并行生成 7 份扫描文档，定义 4 个角色（arch/conventions/structure/quality）
- **archive-impact.yaml**：归档影响分析，定义 2 个角色（impact-analyzer/doc-syncer）

### 状态管理
- **progress.json**：记录 currentStage、stages 状态（pending/in-progress/completed）、步骤级进度
- **_module-map.yaml**：模块索引，包含 entrypoints/main_symbols/depends_on/used_by
- **projects/*.yaml**：项目配置（name/path/role/repo）

### 知识库
- **knowledge/INDEX.md**：知识索引，关键词→文件映射
- **knowledge/uncategorized.md**：执行中发现的坑，待归类
- **quicklog/**：快速操作日志

## 关键逻辑

```text
# 变更启动
sillyspec run auto/propose/quick
  → 创建 .sillyspec/changes/{date}-{name}/
  → 生成 proposal/design/plan/tasks 文档
  → progress.json 记录 currentStage + stages

# 阶段执行
Agent 读取 progress.json.currentStage
  → 根据 stages[stage].steps 顺序执行
  → execute 阶段创建 worktree（.runtime/worktrees/<name>）
  → 更新 progress.json 进度

# 阶段流转
brainstorm 完成 → 评估复杂度 → 启动审核子代理
plan 完成 → 同样评估 → 确认后进入 execute
verify 通过 → archive → 移动到 changes/archive/

# 归档流程
sillyspec run archive
  → archive-impact.yaml 分析 git diff
  → 生成 module-impact.md（模块影响矩阵）
  → 蒸馏知识到 knowledge/
  → 同步 _module-map.yaml
```

## 注意事项

### 文档优先原则
- 禁止无文档改代码，所有变更必须先有 proposal/design/plan
- design.md 是实现依据，verify 对照其验收
- 模块卡片在 docs/*/modules/，由 sillyspec-scan 生成

### 状态一致性
- progress.json 是状态源，CLI 更新状态，Agent 读取后决定执行策略
- stages 内含 8 个阶段（含 quick/explore），每个阶段含 steps 数组
- currentStage 决定 Agent 行为，不是所有阶段都启用 worktree

### Worktree 边界
- execute 创建的 worktree 从最新 commit checkout，**不含主工作区未提交内容**
- 已知坑：前序 quick 流程改动未 commit 时，worktree 基线过时
- 规避：execute 前确认相关改动已 commit，或在主工作区重做

### 模块映射同步
- _module-map.yaml 由 sillyspec-scan 生成，修改模块后需重新扫描
- used_by/depends_on 反向关系在 scan 时自动推导
- 手动维护需保持结构一致性（schema_version/modules 格式）

### 归档路径规则
- 归档目录名：changes/<date>-<name>/ → archive/<date>-<name>/
- 路径中斜杠替换为连字符（如 `a/b` → `a-b`），可能冲突
- module-impact.md 必须在归档前生成，作为知识沉淀输入

### 人工备注区域
- 模块卡片的 <!-- MANUAL_NOTES_START --> <!-- MANUAL_NOTES_END --> 永远保护
- doc-syncer 角色更新模块卡片时跳过此区域
- 用户可自由添加维护提醒、已知限制、依赖说明

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
