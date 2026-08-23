---
author: qinyi
created_at: 2026-08-23 10:10:26
---

# 全量回归证据（task-08 / W6）

worktree：`.sillyspec/.runtime/worktrees/2026-08-23-sessions-workspace-hub`
（分支 `sillyspec/2026-08-23-sessions-workspace-hub`，基线 b0d8632c + W1-W7 代码提交，
HEAD=28286abb 时执行）。

| # | 命令 | 结果 | 用时 |
|---|------|------|------|
| 1 | backend：`uv run pytest app/modules/daemon -q --no-cov -n auto` | **978 passed**，0 failed，399 warnings（存量：AsyncMock coroutine never awaited / FastAPI 422 DeprecationWarning） | 73.36s |
| 2 | frontend：`pnpm test`（vitest run 全量） | **177 test files / 1921 tests 全部通过**，0 failed / 0 skipped 汇总异常；jsdom `getComputedStyle` 噪音为存量输出（rc-table，非失败） | 120.28s |
| 3 | frontend：`pnpm typecheck`（tsc --noEmit） | **通过（exit 0，零错误输出）** | — |
| 4 | frontend：`pnpm lint`（next lint） | **通过（exit 0，0 error）**；警告全为存量（`src/lib/__tests__/*`、`src/stores/kanban.ts` 等）。本变更涉及文件警告数与基线 b0d8632c 逐文件持平：page.test.tsx 2、session-panel.tsx 6、daemon.ts 10（基线同 2/6/10）→ **零新增警告** | — |

## 说明

- backend 回归面 = 本变更后端面（app/modules/daemon 全模块，含新增
  `tests/test_sessions_list_owner_name.py` 5 用例：owner_name 注入 / null 兜底 /
  limit=500 放行 / limit=501 422 拒绝等）。
- frontend 全量含迁移复绿的 `app/(dashboard)/sessions/__tests__/page.test.tsx`
  （预会话语义重写）与新增 `pre-session-picker.test.tsx`、
  `session-panel-pre-session.test.tsx`、重写的 `session-list-panel.test.tsx`、
  `sessions-portal.test.tsx`。
- **无 flaky**：四项一次通过，未触发重跑条款。
- lint 基线比对方法：对 b0d8632c 与 HEAD 分别 checkout 同三文件跑 eslint 计数，
  比对后还原 HEAD（工作树 clean）。

## 结论

后端面 / 前端全量 / 类型 / 代码风格四项全绿，与基线持平，task-08 worktree 内
部分达成。部署与浏览器实证由主代理在 worktree 合并后执行（不在本卡范围）。
