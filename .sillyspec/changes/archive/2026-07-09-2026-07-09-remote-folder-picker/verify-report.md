---
author: WhaleFall
created_at: 2026-07-09 11:58:00
---

# verify-report — Remote Folder Picker（task-11）

> 变更 `2026-07-09-remote-folder-picker`。execute 阶段产出，docker 实测项留 verify 阶段（主仓库完整环境）。

## execute 阶段已完成

### grep 三端 browse 零残留（FR-5 代码清理）
扫描范围：`sillyhub-daemon/src` + `backend/app` + `frontend/src`，关键词 `browse_folder` / `browseFolder` / `BrowseFolder`。

结果：**代码零残留**（无 `browseFolder()` 调用、无 `browse_folder` RPC handler、无 `BrowseFolder{Request,Response}` 类）。仅 4 处说明性注释：
- `frontend/src/app/(dashboard)/runtimes/page.tsx:64/345/1118` —— task-10 改动说明（替代旧 browseFolder 原生弹窗）
- `frontend/src/components/daemon/remote-folder-picker.tsx:7` —— 组件 docstring（替换旧 browse_folder）

注释是描述性历史引用，可接受（非代码残留）。✅ 代码清理验收通过。

### 单元/集成测试全绿
- daemon：`pnpm typecheck` 0 错 + `tests/roots-rpc.test.ts` 5 passed
- backend：`pytest test_list_roots_endpoint.py` 4 passed + `ruff check` All passed + `mypy` no issues
- frontend：`tsc --noEmit` 0 错 + `remote-folder-picker.test.tsx` 5 passed + runtimes page 36 passed
- 代码审查（Explore agent）：P1-1（roots-rpc void RpcError 死代码）/ P1-2（POSIX sep 字面量）/ P2-3（Tree 加载失败反馈）/ P2-4（joinPath 跨平台分隔符）已修复，无 P0 bug

## 待 verify 阶段（docker 实测，主仓库完整环境）
- [ ] `cd deploy && docker compose up -d` rebuild
- [ ] Runtime 配置页：Windows daemon 显示盘符根（如 `C:\`、`D:\`），可逐层展开
- [ ] Linux daemon 显示 `/` 根，可展开（NFR-1 跨平台，验收标准 6）
- [ ] 非递归懒加载（展开才调 list_dir，不预扫全盘，NFR-2）
- [ ] 保存 allowed_roots → daemon PolicyCache 即时更新（在线，D-005 复用 WS policy_update）
- [ ] 非 admin 用户保存收 403（D-007 读=owner / 写=admin 既有行为不回归）

## 已知 worktree 环境限制（不影响 verify 主仓库）
- worktree 全新 checkout 缺 `build-id.ts`（gitignore 构建产物，已占位修复）+ 无独立 .venv/node_modules（backend 借主仓库 .venv + PYTHONPATH、frontend 借主仓库 node_modules junction）
- daemon 既有 38 测试文件失败（PolicyEngine/cli 数据相关，worktree 全新环境），非本变更引入，verify 主仓库完整环境验证
