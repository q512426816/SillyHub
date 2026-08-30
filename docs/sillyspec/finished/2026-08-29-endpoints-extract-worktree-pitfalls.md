---
author: qinyi
created_at: 2026-08-29 22:42:15
---

# endpoints extract 在 execute worktree 模式下的三个坑（2026-08-29-approval-notify-push 实测）

## 现象

变更代码在 execute worktree（`.sillyspec/.runtime/worktrees/<change>`）内时，端点提取产物错误：

1. **`--all-tasks` 聚合模式扫主仓**：allowed_paths 相对主仓根解析，worktree 里才存在的文件扫不到 → 13 个 task 全部提取 0 端点（2026-08-29 实测 0/522）。
2. **`--dir <worktree>/backend` 会把产物写进 worktree 自己的 `.sillyspec/.runtime/contract-artifacts/`**（spec-dir 跟随 --dir 解析），主仓 verify 探针 5 读不到；且 --dir 模式扫整个 backendRoot（522 端点全量），不按 task 过滤。
3. **`@router.get("")` 空路径装饰器漏扫**：`GET /notifications`（router.get("")）未被提取，仅显式路径的 4 条命中。

## 绕过方案（当前已用）

```
sillyspec endpoints extract --change <名> --task task-NN \
  --files <worktree>/backend/app/modules/<mod>/router.py \
  --spec-dir <主仓>/.sillyspec
```
--files（相对主仓拼绝对路径）+ --spec-dir 钉住主仓产物位置；空路径端点手工核对源码装饰器后补进 JSON（格式 {"method","path"}）。

## 建议修复（sillyspec 侧）

- execute worktree 模式下 --all-tasks 聚合应优先从 worktree meta.json 的 worktreePath 解析 allowed_paths；
- --dir 只影响扫描根，不应连带改 spec-dir（产物落点）；
- FastAPI 扫描器补 `@router.get("")` 前缀即路由本身的 case。

## 处置记录（2026-08-30 定时收口，三坑全修）

修复落点（sillyspec 仓，未提交留工作区）：

1. **坑①（--all-tasks 扫不到 worktree 文件）**：`src/index.js` endpoints 分支新增 `resolveScoped`——活跃 worktree（`WorktreeManager.getMeta` 读 `<主仓>/.sillyspec/.runtime/worktrees/<change>/meta.json` 的 `worktreePath`）存在时，相对 allowed_paths **优先按 worktree 根解析**（worktree = baseline 检出 + 本变更改动，扫描结果即交付态），不在 worktree 的文件回落主仓；显式 `--files` 绝对路径不受影响。`--all-tasks`、`--task`/默认清单两条路径都走该解析。
2. **坑②（产物落 worktree 副本）**：同分支接入 `detectWorktreeSpecDrift`——CLI 在 worktree 副本内跑（spec 命中 checkout 出来的 `.sillyspec`）时自动锚回主仓 spec 并打 warn，产物恒落主仓 `.runtime/contract-artifacts/`（verify 探针 5 只认主仓）。注：原文件把触发归因到 `--dir` 不准确——实际是 cwd 落在 worktree 时 spec 跟随 cwd；`--dir` 只影响扫描根。`--dir` 模式不按 task 过滤属显式全量扫描语义，与 `--all-tasks` 互斥已挡，保留。
3. **坑③（`@router.get("")` 漏扫）**：`src/endpoint-extractor.js` FastAPI 装饰器与 Express 路由正则的路径组 `[^"'`]+` → `*`（空串 = 前缀本身即路由，如 `APIRouter(prefix="/notifications")` + `@router.get("")` → `GET /notifications`）；多行空路径装饰器同样命中。

测试证据：新增 `test/endpoints-extract-worktree.test.mjs` 5 用例（空路径单提取 ×3、--all-tasks worktree 解析 e2e、cwd=worktree 副本锚定 e2e）全绿；既有 endpoint 消费方 38 用例零回归；`--files` 冒烟通过。使用侧从此不需要绕过方案——worktree 模式直接 `--all-tasks` 即可，空路径端点自动提取。
