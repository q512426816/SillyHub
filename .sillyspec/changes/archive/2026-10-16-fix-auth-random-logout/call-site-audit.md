---
author: qinyi
created_at: 2026-10-16 16:50:00
---
# task-03 验收记录：13 处 ensureFreshAccessToken 调用点抛错容错审计

> 背景：`doRefresh` 分流后（5xx/408/429 抛 ApiError 不清会话）逐点确认各调用点容错——
> 抛错不得产生未处理 Promise 拒绝；瞬态抛错应跳过「401 清会话」分支（正是修复目标）。
> 审计方式：全仓 grep `ensureFreshAccessToken()` 逐一读调用上下文（worktree 执行期实测）。
> 复审锚：execute 阶段独立 QA review checklist A-2/C-4（agent-tool 通道独立重跑 grep 同向）。

| # | 调用点 | 形态 | 抛错传播路径 | 结论 |
|---|---|---|---|---|
| 1 | frontend/src/lib/api.ts:238 | `await`（apiFetch 401 收口） | 抛错取代原 401 apiErr 向上传播（与 timeout 先例一致）；clear+redirect 仅在 null 分支 | ✓ 设计内传播 |
| 2 | frontend/src/components/app-shell.tsx:216 | fire-and-forget | 已有 `.catch(() => {})` 静默兜底（主动续票不负责登录态清理） | ✓ 唯一裸调用点有 catch |
| 3 | frontend/src/lib/health.ts:46 | `await`（401→刷新→重试） | async 函数内传播为请求失败；调用方经 react-query/上层 catch 展示可重试错误 | ✓ 同 timeout 先例 |
| 4 | frontend/src/lib/spec-workspaces.ts:277 | 同上 | 同上 | ✓ |
| 5 | frontend/src/lib/explorer.ts:79 | 同上 | 同上 | ✓ |
| 6 | frontend/src/lib/api/session-attachments.ts:83 | 同上 | 同上 | ✓ |
| 7 | frontend/src/lib/change-files.ts:122 | 同上 | 同上 | ✓ |
| 8 | frontend/src/lib/daemon/session-export.ts:100 | `await`（导出 401 收口） | 传播为导出失败；「二次 401 清会话」分支被抛错跳过（瞬态不清，符合修复目标） | ✓ |
| 9 | frontend/src/lib/file/api.ts:112（上传） | `await`（XHR 上传 401 收口） | 同上 | ✓ |
| 10 | frontend/src/lib/file/api.ts:204（下载） | `await` | 同上 | ✓ |
| 11 | frontend/src/lib/ppm/problem.ts:206 | `await`（导出 401 收口） | 同上 | ✓ |
| 12 | frontend/src/lib/ppm/export.ts:80（下载） | `await` | 同上 | ✓ |
| 13 | frontend/src/lib/ppm/export.ts:158（预览上传） | `await` | 同上 | ✓ |

## 结论

- 13 处逐一核验：无「未处理 Promise 拒绝」面（唯一 fire-and-forget 点 #2 已有 catch）；
- 其余 12 处均为 `await` 链，抛错按请求失败传播（用户可重试），且全部**跳过各自「401 清会话」分支**——瞬态故障不再误登出，即根因二的修复目标；
- 抛错通道与既有 ql-20260917-005 timeout 先例同构（此前该通道已在生产验证），未引入新的拒绝类别；
- 前端测试锚：token-refresh.test.ts 用例 10/11/12（5xx/408/429 抛错不清会话、401 返 null）；QA 独立重跑 14/14 绿。

## 残留说明（QA 观察，接受）

- 理论 3xx 状态（fetch 默认跟随重定向后不可达）落入 null 分支，与「其余 4xx」字面外延差——不可达路径，不追。
- D-008 内部 commit 的同事务断言局限：SQLite 内存库单连接下无法从第二事务观察 commit 有无；实现正确性经代码审查确认（commit 位于 UPDATE 与 raise 之间），接受该测试强度局限。
