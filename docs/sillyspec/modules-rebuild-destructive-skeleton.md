---
author: qinyi
created_at: 2026-08-07 17:05:01
---

# 坑：`sillyspec modules rebuild` 破坏性——骨架重写 + schema 升级丢手动内容

## 现象

`sillyspec modules rebuild` 会把 `_module-map.yaml` **骨架重建 + schema v1→v2 升级**，无破坏性预警。

实测（2026-08-06-scan-doc-drift-gate archive Step 3 第 8 步，误跑）：
- `.sillyspec/docs/backend/modules/_module-map.yaml` 从 **964 行砍到 259 行**（删 782 行）。
- 丢失大量手动维护内容：`last_change` 增量更新备注、各模块 `entrypoints`/`main_symbols`/`tags`/`depends_on`/`used_by` 全被砍成空骨架。
- 输出提示「rebuild 只重建骨架。tags/entrypoints/main_symbols/depends_on/used_by 需要重新运行 scan 或手动补充」+「schema 已升级到 v2」——但**跑之前没有**「将删除 N 行手动内容」的预警。

## 根因

archive 工作流 `archive-impact.yaml` 的 doc-syncer 第 8 步建议「运行 sillyspec modules rebuild 刷新索引（如果需要）」，但 rebuild 是**破坏性重建**，与「归档只改 1 行 ci.entrypoints」的轻量场景不匹配。agent 照做 = 误触发大范围破坏。

## 影响

误跑 rebuild 会把手动维护的模块映射内容清空（尤其 `last_change` 增量备注是人工长期积累）。对多 change 并发、模块映射含人工维护字段的项目风险高。

## 绕行（本次已验证）

```
git checkout -- .sillyspec/docs/backend/modules/_module-map.yaml   # 回滚被重建的文件
```

## 建议

- rebuild 前**对比 diff 预警**（「重建将删除 N 行，含 M 条手动备注，确认？」）。
- 或改为**非破坏模式**：只补缺失的骨架字段，保留 tags/entrypoints/main_symbols/depends_on/used_by/人工备注。
- 至少：在 rebuild 帮助/输出里显式写明「破坏性，将覆盖手动字段」，archive-impact.yaml 第 8 步加「慎用」提示。
