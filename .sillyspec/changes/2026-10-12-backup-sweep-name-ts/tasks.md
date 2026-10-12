---
author: flow-machine-draft
created_at: 2026-10-12T01:27:35.280Z
---
# 任务注册表（Tasks）— 2026-10-12-backup-sweep-name-ts

- [x] task-01: sweepStalePullScraps 对 .pre-junction-backup-* 条目按 max(mtimeMs, 目录名内嵌创建时刻) 计龄（内嵌 ts 为创建时 Date.now()，13 位数字后缀，解析失败回落 mtime），双信号均老才清扫——保守方向，绝不误删任一信号新鲜的备份
- [x] task-02: 新增用例先红后绿：①备份名内嵌 ts 新鲜 + mtime 30 天旧（盖戳失败形态）→ 清扫后仍在（修复前被删）；②内嵌 ts 8 天旧 + mtime 新鲜 → 仍在（保守语义钉）；既有「8 天清/10 分钟留」与盖戳证据用例语义不变
- [x] task-03: 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/test_init_lease.test.ts 全文件
