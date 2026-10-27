---
author: flow-machine-draft
created_at: 2026-10-27T23:33:32.445Z
---
# 需求规格（Requirements）— 2026-10-28-cgroup-v2-watermark-fix

## 功能需求

### FR-01: _CGROUP_LIMIT_FILES 候选补 /sys/fs/cgroup/memory.max（v2 在前、v1 兜底保留），模块 docstring 的 v2 文件名同步修正

- 必须把 `_CGROUP_LIMIT_FILES` 候选表改为首候选 `/sys/fs/cgroup/memory.max`（cgroup v2 真实文件）、保留 `/sys/fs/cgroup/memory/memory.limit_in_bytes` 兜底（v1）；禁止保留 v2 统一层级下不存在的 `/sys/fs/cgroup/memory.limit`。模块 docstring 中 v2 限制文件名必须同步改为 `memory.max`。

#### 场景：v2 宿主读出限制并计算水位

Given 仅存在 v2 形态文件（`memory.current` 写 1000、`memory.max` 写 2000，均由 monkeypatch 注入 tmp_path）
When 调用 `log_memory_watermark()`
Then 返回 0.5，且经模块 log 符号发出 `spec_workspace.memory_watermark` info 事件（带 ratio）

### FR-02: memory.max 内容为字面量 "max"（无限制）时安全跳过：不抛错、不误告警、返回 None

- 必须在 `memory.max` 内容为字面量 `max`（容器未设内存限制）时把 limit 视为不可用：返回 None、不抛异常、禁止发出任何水位告警事件（与无 cgroup 环境同走静默跳过路径）。

#### 场景：v2 无限制容器不误告警

Given `memory.current` 写 800、`memory.max` 内容为 `max`
When 调用 `log_memory_watermark()`
Then 返回 None，不抛错，log 符号上无 `memory_watermark_high` warning 也无 `memory_watermark` info

### FR-03: 新增 pytest 用例覆盖四形态：v2 正常读取算出比例、超 0.8 阈值出告警、"max" 字面量跳过、无 cgroup 环境跳过；spec_workspace 相关测试全绿

- 必须新增独立 pytest 文件覆盖四形态用例；用例必须经 monkeypatch 注入临时文件路径与 log 替身，禁止依赖真实 `/sys` 挂载；新增用例与 spec_workspace 既有测试（含 test_archive_scoped_reparse.py 的无 cgroup 回归）必须全部跑绿。

#### 场景：超阈值告警路径

Given `memory.current` 写 1900、`memory.max` 写 2000（比例 0.95 > 0.8）
When 调用 `log_memory_watermark()`
Then 返回 0.95，log 符号发出 `spec_workspace.memory_watermark_high` warning

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/spec_workspace/tests/test_memory_watermark.py「test_v2_limit_read_returns_ratio」
FR-02: backend/app/modules/spec_workspace/tests/test_memory_watermark.py「test_v2_max_literal_skips_watermark」
FR-03: backend/app/modules/spec_workspace/tests/test_memory_watermark.py「test_v2_ratio_above_threshold_warns」「test_watermark_silent_without_cgroup（既有回归，test_archive_scoped_reparse.py）」
