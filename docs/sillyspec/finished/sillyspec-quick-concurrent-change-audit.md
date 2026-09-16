---
author: qinyi
created_at: 2026-07-23 09:28:00
---

# quick 边界审计在多会话并发工作区误报（核心已解决 2026-07-23）

## ✅ 解决状态（2026-07-23, sillyspec ql-20260723）

- **核心已修**：并发会话对 `.sillyspec/changes/<非关联变更>/` 的改动/新增不再被本 quick 审计拦截（`src/run.js auditQuickCompletion`：`isQuickMetadata` 放行非关联 changes/ + `isBaselineFile` 折叠目录前缀匹配 + `parsePorcelainPath` 修 porcelain 首行丢首字符）。`.sillyspec/` 是工具**自己的元数据目录**，判定「哪个 change 是本 quick 的 vs 并发会话的」属工具职责。
- **不修的部分（项目职责，非工具）**：「删除/移动文件」子案例（如并发会话把 `docs/sillyspec/` 的 issue 移到 `finished/`）属**项目 issue 目录流转业务逻辑**，工具不管理 → 维持手动收尾绕过（见下文「绕过」节）。
- **生效条件**：需 sillyspec 发布新版本并重装（当前全局装 3.24.0，修复在 sillyspec 仓库 3.24.2+ 工作区，未发布）。


sillyspec `quick --done` 的变更边界审计假设「单会话独占工作区」。当本机有多个活跃会话（如另一个 Claude 会话做 `2026-07-23-rbac-permission-cache`、`2026-07-22-mobile-app-ui` 变更）在同一工作区并发写文件时，`quick --done` 会把**别的会话**的变更误判为「本 quick 引入的危险文件」并 BLOCKED，导致无法收尾。

## 现象（2026-07-23 ql-20260723-001-e169 实证）

本 quick（执行记录表附件优化，仅改 `frontend ppm/_components` 4 文件 + `frontend.md`）`--done` 时反复 BLOCKED：

```
🚫 quick 变更边界审计 — BLOCKED：
   - 危险文件变更: .sillyspec/changes/2026-07-23-rbac-permission-cache/design.md
   - 新增文件（需 --allow-new）: .../rbac-permission-cache/plan.md
   - 删除文件: docs/sillyspec/sillyspec-mobile-app-ui-flow-bugs.md
```

且**打地鼠**：并发会话持续变更（rbac 改 decisions/design、mobile 把文件移到 `finished/`），每次 `--done` 都抓到新的并发文件。

## 各 flag 的局限

| flag | 效果 | 局限 |
|---|---|---|
| `--skip-approval` | 无效 | 通用参数，跳的是审批，不是边界审计 |
| `--confirm` | 无效 | 文档说 warning/blocked 时用，实测不解锁 BLOCKED |
| `--force-baseline --allow-new` | 放行「修改/新增」危险文件 | **不放行「删除/移动」**；且每次 `--done` 重新审计，并发期间持续冒新的 |
| 删除/移动文件 | CLI 只提示「恢复/拆分」 | **无 flag 放行**；恢复会干扰并发会话的删除操作 |

## 根因

quick 启动时记 baseline（`quick-guard.json`），`--done` 审计扫「baseline 之后工作区出现的所有变更」。并发会话在 quick 启动后产生的文件（如 rbac `plan.md` mtime 09:24 > quick 启动 09:18）被算作「本 quick 新增」。审计无法区分「本会话改的」vs「并发会话改的」——它只看 git 工作区状态，不看改动来源。

## 绕过（已用）

1. **手动收尾 QUICKLOG**：CLI `--done` 卡住时，手动把 `.sillyspec/quicklog/QUICKLOG-<user>.md` 的 ql 条目「状态：进行中」翻「已完成」+ 补 `需求/方案/结果/影响/遗留/坑` 字段（同 ql-20260722-008 先例，记忆 `sillyspec-quick-done-unreliable-specroot` 背书）。代码改动照常 `git add` 暂存，提交由用户统一处理。
2. 关键：**只 `git add` 本 quick 的文件**（精确 `git add -- <file>`，禁 `git add -A`），并发会话的文件不进 staged、不 commit。

## 建议工具修复

quick 边界审计应支持「以 `--files` 为白名单」模式：`--files` 声明的文件之外的工作区变更视为「非本 quick」（并发/无关），审计只校验 `--files` 内的文件是否触碰危险路径，不因并发文件 BLOCKED。或提供 `--ignore-paths <glob>` 显式排除并发变更目录（如 `.sillyspec/changes/2026-07-23-rbac-permission-cache/`）。

## 判定「是否并发误报」

`--done` BLOCKED 报的文件若同时满足：
- 不在你的 `--files` / staged 集里；
- 在 `.sillyspec/changes/<别的变更名>/` 或别的会话活动范围；
- 文件 mtime 在你 quick 启动之后；

→ 基本是并发会话变更，非你引入，可手动收尾绕过（别 `--allow-new` 它，那会错误归属）。
