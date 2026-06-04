---
author: hermes
created_at: 2026-06-04T15:30:00
---

# Requirements: workspace-spec-root-managed-p0

## 角色

| 角色 | 说明 |
|------|------|
| platform | SillyHub 平台（系统操作） |
| developer | 开发者（手动触发迁移） |

## 功能需求

### FR-01: 配置 spec_data_root
- **Given** .env 文件存在
- **When** 平台启动
- **Then** `spec_data_root` 从 `SPEC_DATA_ROOT` 环境变量读取，默认 `./data/spec-storage`

### FR-02: 补建 spec_workspaces 记录
- **Given** 数据库有 N 个 workspace 但 spec_workspaces 表为空
- **When** 执行 alembic migration
- **Then** 每个 workspace 在 spec_workspaces 表有一行，strategy=`platform-managed`，spec_root=`{spec_data_root}/{workspace_id}`
- **And** 对应的物理目录已创建

### FR-03: 迁移已有 scan 文档
- **Given** `.sillyspec/docs/{component_key}/scan/` 下有 scan 文档
- **When** 执行迁移脚本
- **Then** 文档被复制到 `{spec_root}/.sillyspec/docs/{component_key}/scan/`

### FR-04: ScanDocsService 从 spec_root 读取
- **Given** workspace 有 spec_workspaces 行且 strategy=`platform-managed`
- **When** 调用 `ScanDocsService.reparse(workspace_id)`
- **Then** 从 `spec_root` 读取 scan 文档，不再 fallback 到 `root_path`

### FR-05: 现有测试不回归
- **Given** 所有现有测试
- **When** 执行 `pytest`
- **Then** 全部通过
