---
id: task-12
title: 模块文档同步（backend/frontend/sillyhub-daemon 变更索引）+ 测试补齐
priority: P1
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11]
blocks: []
requirement_ids: [FR-1, FR-2, FR-3]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1, D-005@v1]
allowed_paths:
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
  - .sillyspec/docs/multi-agent-platform/modules/frontend.md
  - .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md
  - .sillyspec/docs/frontend/modules/app-pages.md
---

## 修改文件
- `.sillyspec/docs/multi-agent-platform/modules/backend.md`、`frontend.md`、`sillyhub-daemon.md`：变更索引追加
- `.sillyspec/docs/frontend/modules/app-pages.md`：MANUAL_NOTES 补充（会话回看含用户消息 + 续聊）
- 测试：确认各 task 测试覆盖（已在前置 task 内）

## 覆盖来源
- design.md §13（文件变更清单）；decisions D-001~D-005@v1；requirements FR-1~3

## 实现要求
1. 三模块文档底部「变更索引」追加：
   `- 2026-06-20-session-history-enhance | 交互式会话历史回看：用户消息落库回看 + 任意会话 reopen 续聊(仅claude) + 任意状态删除`
2. `app-pages.md` MANUAL_NOTES（:54 附近）补充：
   `- 2026-06-20-session-history-enhance：/runtimes 历史回看按 channel 渲染用户/agent 气泡；ended/failed claude 会话可「继续对话」(reopen+SDK resume)，codex 只读；任意状态会话可删除（active 先 end 再删）`
3. 文档头部保留现有 `author/created_at`（已存在，不新建）
4. 测试补齐确认：backend pytest（reopen/delete/user-log）、daemon vitest（SESSION_RESUME）、frontend vitest（channel 渲染/续聊可用性/删除全状态）—— 各 task 已写，本任务跑全量确认

## 接口定义
- 纯文档 + 测试运行，无代码接口

## 边界处理
1. **模块文档头部**：已存在 frontmatter，只追加变更索引/备注，不改头部
2. **app-pages.md 已有 runtimes-layout 备注**（:54）：新增条目并列，不覆盖
3. **测试 baseline failure**：daemon 有既存环境测试失败（agent-detector/cli/terminal-observer，与本次无关，记录但不阻塞）
4. **interactive-session-panel 未命中 frontend _module-map**（孤儿组件）：文档同步在 app-pages.md（命中 runtimes/page.tsx）体现，不强加到未注册模块

## 非目标
- 不重新 scan（_module-map 已知 sillyhub-daemon needs_review，不在本任务范围）
- 不改模块正文架构描述（只追加索引/备注）

## 参考
- 现有变更索引格式：`backend.md`/`frontend.md` 底部
- app-pages.md MANUAL_NOTES：:52-56

## TDD 步骤
本任务无代码，跳过 TDD；执行测试全量确认：
1. `cd backend && uv run pytest`（daemon session 相关）
2. `cd sillyhub-daemon && pnpm test`
3. `cd frontend && pnpm test`
4. 全绿（或仅既存无关 baseline failure）

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | backend.md 变更索引 | 追加 2026-06-20-session-history-enhance 条目 |
| AC-02 | frontend.md / sillyhub-daemon.md | 同上追加 |
| AC-03 | app-pages.md MANUAL_NOTES | 补充回看含用户消息 + 续聊 + 删除说明 |
| AC-04 | backend pytest | session 相关全绿 |
| AC-05 | daemon vitest | SESSION_RESUME route + restoreAndReconnect 复用全绿（既存无关 failure 记录） |
| AC-06 | frontend vitest | channel 渲染/续聊可用性/删除全状态全绿 |
