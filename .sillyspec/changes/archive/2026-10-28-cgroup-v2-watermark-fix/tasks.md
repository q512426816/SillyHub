---
author: flow-machine-draft
created_at: 2026-10-27T23:33:32.445Z
---
# 任务注册表（Tasks）— 2026-10-28-cgroup-v2-watermark-fix

- [x] task-01: 测试先行——新增 backend/app/modules/spec_workspace/tests/test_memory_watermark.py 四用例（v2 读出比例 / 超 0.8 告警 / "max" 字面量跳过 / 无 cgroup 跳过；monkeypatch 注入 tmp_path 文件与 log 替身），跑一轮确认 v2 用例按预期红（现缺陷）
- [x] task-02: 修 drift_probe.py——_CGROUP_LIMIT_FILES 首候选改 /sys/fs/cgroup/memory.max（v1 兜底保留）、docstring v2 文件名同步、候选表旁注释 "max" 无限制语义；新用例全绿
- [x] task-03: 回归 spec_workspace 测试目录全量（含 test_archive_scoped_reparse.py 既有水位回归用例）确认零破坏
