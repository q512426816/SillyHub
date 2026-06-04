---
author: hermes
created_at: 2026-06-04T15:30:00
---

# Proposal: workspace-spec-root-managed-p0

## 动机

SillyHub 平台管理的每个 Workspace 应有独立的 spec 文档目录（`spec_root`），而非将所有项目的 scan 文档写入 SillyHub 自身仓库的 `.sillyspec/docs/`。

当前问题：
1. `spec_workspaces` 表有模型和 Service，但 **0 行数据**——5 个 workspace 全无 spec_root
2. `spec_data_root` 默认 `/data/sillyspec-data`，`.env` 未配置，物理目录不存在
3. `ScanDocsService.reparse()` 有 spec_root 读取逻辑，但 fallback 到 `root_path`
4. 所有 scan 文档堆积在 SillyHub 仓库 `.sillyspec/docs/` 下

## 关键问题

- 如何为已有 5 个 workspace 补建 `spec_workspaces` 记录？
- 已有的 scan 文档如何迁移到各 workspace 的 spec_root？
- `spec_data_root` 在 macOS 开发环境下用什么路径？

## 变更范围

1. `.env` 设置 `SPEC_DATA_ROOT` 为项目内 `./data/spec-storage`
2. 为已有 5 个 workspace 创建 `spec_workspaces` 行 + 物理目录
3. 迁移 `.sillyspec/docs/` 下已有的 scan 文档到各 workspace spec_root
4. 确认 `ScanDocsService`、`dispatch`、`start_scan_dispatch` 链路跑通
5. 补充测试覆盖

## 不在范围内

- in_repo / mirror 策略（P2）
- workspace runtime_root 管理
- manifest.json 生成（可后续加）
- 前端 UI 变更（后端先通）

## 成功标准

1. 每个 workspace 有独立的 `spec_root` 目录，scan 文档写入其中
2. `ScanDocsService.reparse()` 从 spec_root 读取，不再 fallback
3. 已有 5 个 workspace 的 scan 文档成功迁移
4. 全部现有测试通过 + 新增 spec_root 相关测试
