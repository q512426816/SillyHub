---
author: qinyi
created_at: 2026-06-14T22:04:34
id: task-14
title: 前端测试 / typecheck + 手动验收
priority: P1
estimated_hours: 2
depends_on: [task-08, task-09, task-10, task-11, task-12]
blocks: [task-15]
allowed_paths:
  - frontend/
---

# task-14: 前端测试 / typecheck + 手动验收

## 上下文
前端无单测框架（local.yaml `frontend_typecheck` / `frontend_build` 即验收门）。本任务跑 typecheck + build，并对照 FR-07/FR-08 做手动验收 checklist。依赖 task-08~12 全部完成。

## 修改文件（必填）
- 无新文件（验收任务）。若 typecheck/build 报错，回头修 task-08~12 对应文件。

## 实现要求
1. **typecheck**：`cd frontend && pnpm typecheck` —— 0 error。
2. **build**：`cd frontend && pnpm build` —— 成功。
3. **lint（若 package.json 有）**：`cd frontend && pnpm lint` —— 0 error（warning 可接受）。
4. **手动验收 checklist**（对照 FR-07/08 + 成功标准 5）：
   - [ ] 设置页：选 claude → 保存 → 刷新仍显示 claude（FR-07）。
   - [ ] 设置页：选"未设置" → 保存 → 显示未设置（FR-01 清空）。
   - [ ] task 面板：workspace.default_agent=claude → 下拉预选 claude（FR-08）。
   - [ ] task 面板：改 codex → 提交 → 网络请求 body provider=codex。
   - [ ] task 面板：选"使用默认" → 提交 → body provider=null。
   - [ ] stage dispatch：选 codex 重跑 → body provider=codex。
   - [ ] scan：选 claude 生成 → body provider=claude。
   - [ ] 离线 provider：default_agent 指向离线 provider → 下拉标注"（离线）"（R-01）。
   - [ ] daemon 全离线：下拉仅"使用默认/未设置"项，不崩（R-04）。

## 接口定义（代码类任务必填）
N/A（验收任务）。

## 边界处理（必填）
- **typecheck 报错**：定位 task-08~12 文件修复，不跳过。
- **build 报错**：同上。
- **手动验收失败项**：记录失败 FR，回对应 task 修复，重跑。
- **网络请求验证**：用浏览器 DevTools Network 面板看 body（或 mock 后端打日志）。
- **daemon 全离线场景**：手动停 daemon 或断开，验证下拉降级。

## 非目标（本任务不做的事）
- 不改实现（回对应 task 修）。
- 不做端到端多 provider（task-15）。
- 不引入前端测试框架（MVP 用 typecheck/build/手动验收）。

## 参考
- FR-07/FR-08（requirements.md）+ 成功标准 5（proposal.md）。
- task-08~12 的验收标准表。
- local.yaml `frontend_typecheck` / `frontend_build`。

## TDD 步骤
1. typecheck → build → lint。
2. 按 checklist 逐项手动验收（启动前后端 + daemon）。
3. 失败项回 task-08~12 修复后重跑。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | pnpm typecheck | 0 error |
| AC-02 | pnpm build | 成功 |
| AC-03 | 手动验收 checklist 全过 | FR-07/08 + 成功标准 5 达成 |
| AC-04 | 离线/全离线边界 | 降级正确，不崩 |
