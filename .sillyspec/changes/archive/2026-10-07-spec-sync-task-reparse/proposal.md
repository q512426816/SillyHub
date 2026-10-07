---
author: flow-machine-draft
created_at: 2026-10-07T13:43:18.668Z
---
# 提案书（Proposal）— 2026-10-07-spec-sync-task-reparse

## 动机

任务原话转写：平台任务板陈旧根因（hide-quicklog 实证）：spec-sync 增量落盘后自动触发的 scoped reparse 只重建变更表（ChangeService），任务表（TaskService）全后端唯一刷新入口是手动端点 POST /changes/{id}/tasks/reparse——agent 中途改写 tasks.md 后，文档列与变更表都会新，任务板永远停在初版解析（磁盘 5 任务、平台显示 4 条种子）。CLI 侧重推触发已另行修复（sillyspec 仓 tick/工件变更触发 spec-sync），本变更补平台侧闭环：reparse 执行体连动任务表。

成功标准：
- _run_reparse_once 在 ChangeService.reparse 后按同一 scope 连动 TaskService.reparse（非归档 name 逐行；archive_hit 全量；location=deleted 跳过），best-effort 失败仅告警不阻断同步
- 增量同步改写 changes/<name>/tasks.md 后（drain 调度器），任务表条目跟随新文件内容（追加/改写/删除三态收敛）
- 新增测试覆盖连动（scoped 触发→任务行更新；范围外任务不动；连动失败不阻断主流程），backend 相关测试与 lint/mypy 绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. _run_reparse_once 在 ChangeService.reparse 后按同一 scope 连动 TaskService.reparse（非归档 name 逐行；archive_hit 全量；location=deleted 跳过），best-effort 失败仅告警不阻断同步
2. 增量同步改写 changes/<name>/tasks.md 后（drain 调度器），任务表条目跟随新文件内容（追加/改写/删除三态收敛）
3. 新增测试覆盖连动（scoped 触发→任务行更新；范围外任务不动；连动失败不阻断主流程），backend 相关测试与 lint/mypy 绿

## 成功标准（可验证）

1. _run_reparse_once 在 ChangeService.reparse 后按同一 scope 连动 TaskService.reparse（非归档 name 逐行；archive_hit 全量；location=deleted 跳过），best-effort 失败仅告警不阻断同步
2. 增量同步改写 changes/<name>/tasks.md 后（drain 调度器），任务表条目跟随新文件内容（追加/改写/删除三态收敛）
3. 新增测试覆盖连动（scoped 触发→任务行更新；范围外任务不动；连动失败不阻断主流程），backend 相关测试与 lint/mypy 绿
