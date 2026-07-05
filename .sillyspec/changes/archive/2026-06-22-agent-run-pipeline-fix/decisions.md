---
author: qinyi
created_at: 2026-06-22T15:35:00
change: 2026-06-22-agent-run-pipeline-fix
---

# 决策台账 — agent-run 调度链路修复

本变更的决策记录。每条有稳定版本 ID。长期术语在 archive/scan 时再提升到 glossary.md。

## D-001@v1: A1 路径修复策略 = bind mount + daemon 翻译
- type: architecture
- status: accepted
- source: user（AskUserQuestion 选择）
- question: spec-data 是 Docker named volume，daemon(Win 宿主机)访问不到，导致 /data/ 路径 EPERM，怎么修？
- answer: docker-compose 把 spec-data 改成 bind mount 指向宿主机真实目录（默认 C:/data/spec-workspaces），daemon 端激活已有 SPEC_ROOT_MAP 翻译器把 /data/spec-workspaces 翻译成 Windows 路径。backend/daemon 通过 bind mount 真正共享文件系统。
- normalized_requirement: scan 在 Windows daemon 上跑通，agent 拿到的 spec-root 是 Windows 可访问路径，无 EPERM；backend/daemon/agent 三方见同一物理目录。
- impacts: A1, 部署文档(docker-compose/.env), daemon config
- evidence: design.md §4.1；调研 daemon.ts:1694-1705、docker-compose.yml:55,110、config.py:64-68
- priority: P0

## D-002@v1: 前端范围 = 修 bug + 优化展示
- type: boundary
- status: accepted
- source: user（AskUserQuestion 选择）
- question: 前端日志优化到什么程度？
- answer: 源头修（daemon partial 缓冲去重 + backend _extract_sdk_messages 去重 + tool_call 全局配对）+ 前端 timeline 重设计（tool_use↔result 配对、thinking 折叠摘要、tool_call JSON 收卡片、channel 着色强化）。不做 D1/D2 源头全重构（不重写日志 IR 协议）。
- normalized_requirement: 同一思考只出现一次；同一 tool 调用只一张卡片；日志可读性大幅提升。
- impacts: D1, D2, D3, 前端 normalize.ts / agent-log-viewer.tsx / tool-renderers.tsx
- evidence: design.md §5.3, §5.4；调研 session-manager.ts:1323-1444、service.py:3329-3488、normalize.ts:359-386
- priority: P1

## D-003@v1: 数据迁移可清空
- type: compatibility
- status: accepted
- source: code（CLAUDE.md 规则7）
- question: spec-data 改 bind mount，既有 named volume 数据怎么办？
- answer: 按 CLAUDE.md 规则7（本项目未正式上线，不需要考虑版本迭代兼容，数据可以清空），直接 docker volume rm 重建。
- normalized_requirement: 切换 bind mount 时清空旧 named volume，无需数据迁移脚本。
- impacts: A1 部署步骤
- evidence: CLAUDE.md 硬性规则7；design.md §9
- priority: P0

## D-004@v1: sillyspec 跨仓库管理
- type: architecture
- status: accepted
- source: user（"sillyspec 你也可以直接改动"）
- question: sillyspec 是独立仓库（v3.18.5 全局安装），改动怎么管理？
- answer: 在 C:\Users\qinyi\IdeaProjects\sillyspec 源码改 + git 提交；本变更文档（design/plan/tasks）在 multi-agent-platform 仓库记录跨仓库影响；全局安装通过 npm link 或 reinstall 生效（execute 阶段定）。
- normalized_requirement: sillyspec 改动有 git 记录；SillyHub 变更文档回引 sillyspec 提交；daemon 调用的 sillyspec 指向新源码。
- impacts: B1, B2, B3, B4
- evidence: design.md §7
- priority: P0（影响 B1-B4 验证）

## D-005@v1: 执行策略 = 按优先级 P0/P1 分层
- type: boundary
- status: accepted
- source: user（AskUserQuestion 选择）
- question: 整体执行粒度（按优先级 / 按仓库 / 扁平）？
- answer: 按 P0/P1 分层。P0 打通 scan 主链路（A1/B1/B4/C1），P1 做体验与正确性（B2/B3/D1/D2/D3/前端）。先止血再优化，可分阶段验证。
- normalized_requirement: plan.md 按 P0/P1 分 Wave；P0 完成即可让 scan 跑通，P1 可独立验证。
- impacts: plan.md Wave 划分
- evidence: design.md §3；AskUserQuestion 选择"按优先级 P0/P1"
- priority: —（执行策略本身）

## D-006@v1: Token 消耗展示
- type: feature
- status: accepted
- source: user（plan 阶段补充需求）
- question: 日志优化要展示 token 消耗（input/output）？
- answer: 后端数据已有（`AgentRun.input_tokens/output_tokens`，daemon.ts:1070-1080 assistant message usage 实时回写 + 1000-1004 result 汇总 + task-runner.ts:1192-1195 usage_update 透传）。前端在 run 概要展示累计 input/output tokens，流式实时刷新。
- normalized_requirement: agent-run 日志面板展示 input/output token 消耗，流式期间实时更新。
- impacts: FR-11, frontend agent-run-panel/agent-log-viewer, agent.ts API 字段确认
- evidence: sillyhub-daemon/src/daemon.ts:1000-1004,1070-1080；task-runner.ts:1192-1195
- priority: P1
