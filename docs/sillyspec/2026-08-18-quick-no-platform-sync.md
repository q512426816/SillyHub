---
author: qinyi
created_at: 2026-08-18 13:45:00
---

# quick 会话完成后不触发任何平台同步（进度 / 文档 / spec 树全静默）

## 现象

`sillyspec run quick --done --change quick-<id>` 完成后，平台（SillyHub）侧什么都没收到：
QUICKLOG、模块文档等 spec 树文件不更新，进度也不上行。输出里没有任何 `[sync]` /
`[spec-sync]` 日志（连"未连接平台"或"变更不存在"的 warn 都没有）。

实测：2026-08-18 ql-20260818-009-c287（multi-agent-platform，local.yaml platform 段配置
完好，url=127.0.0.1:8001 + shpsync_ token，CLI 3.26.10 带 spec-sync 功能）。

## 根因（sillyspec 仓源码，两层门叠加）

quick 会话按设计**没有** `.sillyspec/changes/<changeName>/` 目录（changeName =
`quick-<hex8>` 会话 ID），而平台同步链的每一环都锚定「变更目录存在」：

1. `src/run/shared.js` `triggerSync()`（:424）：
   `if (changeName && !existsSync(join(cwd, '.sillyspec', 'changes', changeName))) return`
   —— quick-<id> 不存在 → **静默 return**（无任何日志，所以表面看像"没触发"）。
2. 即使过了第一道，`src/sync.js` `SyncManager.sync()`（:385-389）还有第二道同款
   existsSync 门 → `[sync] 变更不存在: quick-<id>` → return `{synced: 0}`。

而 2026-08-17 落的 spec 树增量同步（`syncSpecTree`）挂在 sync() 成功**之后**
（sync.js:475），四件套文档直推（`syncDocuments`）同理（sync.js:466）——整条链
（进度 → 文档 → spec 树）全部 unreachable。

## 影响

- 所有 quick 会话（不只本次）的产出（QUICKLOG 条目、模块文档修订、活跃变更文件）
  永不自动上行平台；变更中心文件树/知识库视图滞后，直到下次任意**完整变更**的
  `--done` 触发 syncSpecTree 全树 diff 才被顺带推上去。
- `--linked-changes` 关联的变更也不因此上行——triggerSync 传的仍是 quick-<id>。

## 合理性辨析（修复时的语义边界）

对 quick 而言三段上行的意义不同：

- **进度上行（progress）**：quick-<id> 在平台无对应变更目录，推上去是孤儿行
  （变更中心按磁盘 change_key join，永不命中）→ 跳过是**对的**。
- **四件套文档（syncDocuments）**：quick 无 changes/<name>/ 四件套 → 跳过是**对的**。
- **spec 树增量（syncSpecTree）**：以服务器清单为锚做全树 diff，与变更目录无关，
  QUICKLOG/模块文档正是靠它上行 → **这段被误伤，是真正要接上的**。

## 期望修复（待 sillyspec 仓实现）

quick 收尾（或 triggerSync 通用路径）识别 `quick-<hex8>` 会话：跳过 progress/docs，
直接 `syncSpecTree(join(cwd, '.sillyspec'), platform, changeName)`（沿用 8s 总超时
熔断与 best-effort 语义，失败不影响 --done 返回）。更通用的做法：sync() 对
「变更不存在」降级为仅推 spec 树，但需防真实变更名拼写错误的噪音混入。

## 绕过方案（当前）

quick 完成后手动触发一次全树同步：起一个活跃完整变更跑任意 `--done`，或
`sillyspec platform sync`（若可用）。短期最简单：接受滞后，等下一个完整变更
--done 顺带收敛。
