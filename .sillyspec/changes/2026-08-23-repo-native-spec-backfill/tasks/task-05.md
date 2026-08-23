---
id: task-05
title: 'e2e-field-verification'
title_zh: '现场端到端验证——指针再中毒复查 + 本地变更上行平台 + junction 回灌回归'
author: qinyi
created_at: 2026-08-23 21:40:00
priority: P0
depends_on: [task-01, task-04]
blocks: []
repo: main
base_commit: 72f153fb
requirement_ids: [FR-1, FR-3, FR-4, FR-5, FR-6]
decision_ids: [D-001, D-002, D-003]
allowed_paths:
  - backend/app/modules/agent/context_builder.py
  - .sillyspec/changes/2026-08-23-repo-native-spec-backfill/verify-evidence.md
goal: >
  用真实现场闭环验证断链修复（proposal 成功标准 1/2/3 与验收口径全项）。依赖
  task-01（backend repo-native 本地模板落盘+测试绿）与 task-04（全局 CLI 3.27.3
  自指免疫生效）。
implementation:
  - 指针再中毒复查：ls .sillyspec-platform*（本仓库）应无 json/managed；若活跃平台会话在 backend 部署 task-01 前重跑旧 scan 导致指针重写，则验证 CLI 3.27.3 自指忽略生效（run 命令仍本地模式）
  - 本地变更上行端到端：本变更自身即活体样本——平台变更中心应可见 2026-08-23-repo-native-spec-backfill（CLI 内置 sync 通道），对照服务器镜像同步时间新于变更文件 mtime
  - repo-native scan 模板现场验证：backend 部署 task-01 后触发/观察 scan 日志中 prompt 无平台参数（三策略断言已由 task-01 单测覆盖，现场为生效态抽查）
  - 平台会话 junction 回灌回归：daemon junction（~/.sillyhub/daemon/specs/de24ed7c-* → .sillyspec）健在且平台会话结束 postSpecSync 不报错（daemon 日志/服务器 spec_version 递增）
  - 证据留存：验证输出写 .sillyspec/changes/2026-08-23-repo-native-spec-backfill/verify-evidence.md（verify 阶段正式化）
acceptance:
  - 本地会话产生的变更在平台变更中心可见（成功标准 1）
  - platform-managed/repo-mirrored 无回归（成功标准 3：task-01 快照断言 + 现场抽查）
  - 指针现场干净或自指免疫生效（成功标准 2 生效态）
verify:
  - 逐项命令输出留存 verify-evidence.md
  - sillyspec run verify 阶段整体复核
constraints:
  - 不重置平台数据（验证只读 + 本变更自身推进）
  - 平台会话验证借用既有活跃会话，不新建破坏性会话
---

# task-05 补充说明
纯验证任务（allowed_paths 为空，不产码）；verify 阶段承载。
