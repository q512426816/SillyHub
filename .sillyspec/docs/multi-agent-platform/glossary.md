---
author: qinyi
created_at: 2026-06-03T09:50:00
---

# Glossary

## Workspace
工作区。对应一个被导入的项目，包含 SillySpec 文档和配置。一个 Workspace 关联一个宿主机上的项目目录。

## SpecWorkspace
规格工作区。Workspace 下 SillySpec 配置的具体实例，管理 .sillyspec 目录的初始化和状态。

## Change
变更。SillySpec 中的核心工作单元，代表一次功能开发或修改。包含 proposal → design → plan → execute → verify → archive 完整生命周期。

## Task
任务。Change 下的具体执行步骤，按 Wave 分组。状态: pending → in_progress → completed / failed。

## Wave
波次。Task 的分组单位，同一 Wave 内的任务可并行，Wave 之间按顺序执行。

## AgentRun
Agent 运行记录。一次 Claude Code CLI 的调用实例，记录输入、输出、状态和日志。

## Worktree
Git 工作树。为 AgentRun 提供隔离的文件系统空间，避免并发操作冲突。

## ScanDocument
扫描文档。项目扫描生成的 7 类文档: ARCHITECTURE, STRUCTURE, CONVENTIONS, INTEGRATIONS, TESTING, CONCERNS, PROJECT。

## Module Map
模块映射。项目的结构化索引（_module-map.yaml），记录模块路径、依赖关系、入口点等。

## Tool Gateway
工具网关。管理 Agent 的工具调用策略、权限控制和审计日志。

## Change Writer
变更写入器。Agent 驱动的代码写入模块，负责将 Agent 的输出应用到项目文件。

## Bootstrap
引导。首次导入项目时自动初始化 SillySpec 配置和文档结构的过程。

## SpecProfile
规格档案。记录 .sillyspec 目录的清单和状态，用于冲突检测。

## Release
发布。将已归档的变更打包发布的流程，包含审批机制。

## Incident
事件。记录生产环境的问题和事后复盘。
