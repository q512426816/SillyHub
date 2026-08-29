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
