# flow done 在共享主仓多会话下的三类摩擦（2026-10-23 实证）

> 变更：2026-10-22-agent-profiles-page-restyle（thin，2 文件级前端重设计）
> CLI：本机 link 的 sillyspec（`C:/Users/qinyi/IdeaProjects/sillyspec`）
> 结果：最终归档成功（review PASS 零 findings），但 flow done 共重入 7 轮、约 2 小时。

## ① design.md 被手写替代 → 空 AGENT 槽拒收，恢复指引失效

**现象**：flow done `artifacts` 子步报「design.md 有 1 个空 AGENT 槽（骨架缺失——被整删或手写替代）」。
**恢复指引**：「从 `.runtime/step-guides/` 的指纹缓存可找骨架原文」——实测该目录只有
brainstorm/archive 指引，没有任何 flow design 骨架（grep `MACHINE-DRAFT:design-approach`
在 step-guides 下零命中；只有历史 archive 的 design.md 与 logs 副本）。
**处置**：手工在四节问题行后补 `<!--AGENT:槽N ... -->` 标记（内容保留），artifacts 门通过。
**建议**：flow start 时把 design 骨架原文同时落一份到 `.runtime/step-guides/flow-design-<change>.md`
（或 flow-state 记录指纹），否则恢复指引指向不存在的缓存。
**注意**：`verifyDesignRecordFilled` 只检查槽后是否有非空行——把槽放在问题行之前时，
问题行本身会被当成答案。作答必须放在问题行之后（本次已按此摆放）。

## ② 共享主仓动态子集膨胀：FR 关联回归 740 条 / 674 测试 / baseline..HEAD 并行提交全算文件面

**现象**（同一变更连续 3 轮）：
- 文件面 236 → 242 个；动态子集 345 → 674 个测试；FR 关联回归触达 590 → 740 条 active FR
  （绑定测试 361 个）。
- 原因：PageHeader 被 41 个页面消费，import 依赖扩散全仓；且 baseline..HEAD 里包含
  大量**并行会话提交**，其文件/FR 也被算入本变更文件面与 FR 域路由。
- 后果：单轮实测 12–30 分钟；并行会话的在途/已提交债（如 `clearStatusProbeEviction`
  mock 缺方法、额度胶囊测试）反复把门禁打红；豁免后「前轮失败批 314 ∪ …」又把失败批
  并进下一轮，形成放大。
**建议**：
- FR 关联回归按「本变更声明面 ∩ FR 绑定」收窄，不要把 baseline..HEAD 的并行提交
  全量计入 FR 域；或提供 `--fr-scope=declared`。
- 增量重跑面设上限（如「前轮失败批 ≤ N 文件」），否则一次失败会滚成全量。
- 共享主仓 dirty/committed 归属已有 `splitOwnVsForeignDiffFiles`，但 FR/文件面聚合仍
  未过同一把刀，建议统一。

## ③ 归档提交在共享暂存区竞态下打印了命令但未落库

**现象**：flow done 末尾打印
`🧾 归档提交一笔到位：git commit -m "chore(archive): ..." -- ...`，
但随后 `git log` 无该提交，归档目录全部停在 staged（`A`），源目录删除停在 `D`。
同时并行会话的归档提交（8150bbef4）先落库。
**后果**：用户看到「✅ flow done 完成 / change 已归档注销」，实际归档件未入库；
若不人工复查，下一次 pull/清理会丢归档。
**处置**：手动补两笔——归档目录 + docs/knowledge（dd693909c）、源目录删除（8b00d3f76）。
**建议**：归档子步结束后断言「HEAD 已移动且归档路径已在 HEAD 树中」，否则报
「归档提交未落库」并给出可复制的 pathspec 命令；不要只打印命令当成功。
**关联**：与项目规则 12（pre-commit stash/restore 竞态致静默不落）同族，
但这次发生在工具内部的 `git commit` 调用，不是用户提交。

## 正面记录

- known_failures 窄豁免与「纯超时（无挂掉用例）不拦完成」降级，避免了一次 133 文件
  pytest 超时把收口彻底卡死；豁免支持中文字符串/ANSI 剥离后匹配，实用。
- 升厚档（tier=thick）后归档仍 `skipPlanCheck`，thin 出生变更不会因缺 plan.md 死锁
  （源码注释 line 954 已实现），实测一致。
- `--accept-unmapped` / `--accept-dirty-gap` 的显式留痕通道，在共享主仓并行噪声下
  是必要出口，比 silent pass 诚实。
