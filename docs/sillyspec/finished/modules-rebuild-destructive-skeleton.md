---
author: qinyi
created_at: 2026-08-07 17:05:01
status: 已解决（sillyspec quick ql-20260807-012-2b86，commit 6d01918）
---

# 坑：`sillyspec modules rebuild` 破坏性——骨架重写 + schema 升级丢手动内容

## 解决（sillyspec quick ql-20260807-012-2b86）

`src/modules.js` `rebuildModuleMap(cwd, { force })` 改为**默认 dry-run 不写盘 + 打印覆盖预警**（"该命令会覆盖 _module-map.yaml，清空 tags/entrypoints/main_symbols/depends_on/used_by 等手动维护字段；确认覆盖请运行：sillyspec modules rebuild --force"），`--force` 才真正覆盖；`src/index.js` rebuild 路由解析 `--force` 传 options + help 文本加 `[--force]` 说明。`src/stages/archive.js` 步骤 8 的 rebuild 提示加 --force 慎用说明（与 archive-impact 的「人工备注保护」约束冲突，仅当手动字段已并入骨架或可接受覆盖时用）。新增 `test/modules-rebuild-dryrun.test.mjs` 6 断言（dry-run 不写 / force 覆盖 / 手动字段清空）。非破坏补骨架（保留手动字段）为更大工程，本次采 dry-run 保护方案。

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
