---
author: flow-machine-draft
created_at: 2026-10-12T01:27:35.280Z
---
# 提案书（Proposal）— 2026-10-12-backup-sweep-name-ts

## 动机

任务原话转写：动机：24h 风险审查 P2-4——备份 7 天人工取回窗口在「utimes 盖戳失败 + 被备份残留 mtime 本来就老」组合下退化为 0：spec-sync.ts:543 utimes(backup, now, now).catch(() => {}) 静默吞错，rename 继承旧目录 mtime（aa809dc91 自举的 30 天残留场景），清扫（spec-sync.ts:341-372）按 mtimeMs 判 7 天——刚创建的备份在下次 pull 顶部清扫即被删，而备份里可能有未回灌的本地改动。
成功标准：
- sweepStalePullScraps 对 .pre-junction-backup-* 条目按 max(mtimeMs, 目录名内嵌创建时刻) 计龄（内嵌 ts 为创建时 Date.now()，13 位数字后缀，解析失败回落 mtime），双信号均老才清扫——保守方向，绝不误删任一信号新鲜的备份
- 新增用例先红后绿：①备份名内嵌 ts 新鲜 + mtime 30 天旧（盖戳失败形态）→ 清扫后仍在（修复前被删）；②内嵌 ts 8 天旧 + mtime 新鲜 → 仍在（保守语义钉）；既有「8 天清/10 分钟留」与盖戳证据用例语义不变
- 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/test_init_lease.test.ts 全文件

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. sweepStalePullScraps 对 .pre-junction-backup-* 条目按 max(mtimeMs, 目录名内嵌创建时刻) 计龄（内嵌 ts 为创建时 Date.now()，13 位数字后缀，解析失败回落 mtime），双信号均老才清扫——保守方向，绝不误删任一信号新鲜的备份
2. 新增用例先红后绿：①备份名内嵌 ts 新鲜 + mtime 30 天旧（盖戳失败形态）→ 清扫后仍在（修复前被删）；②内嵌 ts 8 天旧 + mtime 新鲜 → 仍在（保守语义钉）；既有「8 天清/10 分钟留」与盖戳证据用例语义不变
3. 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/test_init_lease.test.ts 全文件

## 成功标准（可验证）

1. sweepStalePullScraps 对 .pre-junction-backup-* 条目按 max(mtimeMs, 目录名内嵌创建时刻) 计龄（内嵌 ts 为创建时 Date.now()，13 位数字后缀，解析失败回落 mtime），双信号均老才清扫——保守方向，绝不误删任一信号新鲜的备份
2. 新增用例先红后绿：①备份名内嵌 ts 新鲜 + mtime 30 天旧（盖戳失败形态）→ 清扫后仍在（修复前被删）；②内嵌 ts 8 天旧 + mtime 新鲜 → 仍在（保守语义钉）；既有「8 天清/10 分钟留」与盖戳证据用例语义不变
3. 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/test_init_lease.test.ts 全文件
