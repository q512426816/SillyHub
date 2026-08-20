---
id: task-01
title: add-mission-patrol-settings-fields
title_zh: Settings 四项巡检配置（enabled/interval/zombie_after/revive_window + Field 约束 + 默认值单测）
author: qinyi
created_at: 2026-08-21 07:22:59
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001]
allowed_paths:
  - backend/app/core/config.py
  - backend/app/core/tests/test_patrol_settings.py
goal: >
  在 Settings 新增 mission 巡检四项配置（design §3），为 task-02 巡检循环与
  Wave 2/3 僵尸阈值提供唯一配置来源（FR-04.1），并补默认值/边界单测。
implementation:
  - config.py Settings 内新增分组注释段（# ── Mission patrol ──，对齐 auth 段惯例），四字段全部带默认值 + 中文 description 注明变更来源，存量部署零配置可启动
  - mission_patrol_enabled: bool = Field(True, ...)：巡检总开关，False=零回归（NFR-02）
  - mission_patrol_interval_seconds: int = Field(60, ge=10)：巡检间隔秒
  - mission_patrol_zombie_after_minutes: int = Field(60, ge=5)：daemon 持续离线判僵尸阈值（分钟）
  - mission_patrol_revive_window_minutes: int = Field(30, ge=5)：僵尸复活窗口（分钟）
  - 单测：app/core/tests/ 下无 test_config.py（现有仅 test_config_auth.py 覆盖 auth 段），新增到合适测试位置 = 新建 app/core/tests/test_patrol_settings.py，照 test_config_auth.py 惯例（_base_kwargs 最小构造 + ValidationError 断言）
  - 用例：四项默认值 True/60/60/30；MISSION_PATROL_* env 覆盖生效（含 ENABLED="false" 解析为 False）；下界拒绝（interval=9/zombie_after=4/revive_window=4 抛 ValidationError）；下界值合法（10/5/5）
acceptance:
  - 不设任何 MISSION_PATROL_* env 时四项默认 True/60/60/30，env 可逐项覆盖
  - interval<10、zombie_after<5、revive_window<5 实例化抛 ValidationError，恰好 10/5/5 合法
  - 既有配置用例（tests/test_config.py、app/core/tests/）不受新增字段影响，全绿
verify:
  - cd backend && uv run pytest app/core/tests/test_patrol_settings.py -q --no-cov
  - cd backend && uv run pytest tests/test_config.py app/core/tests -q --no-cov
  - cd backend && uv run ruff check app/core/config.py && uv run mypy app/core/config.py
constraints:
  - 只加配置字段与单测：不写 patrol.py（task-02）、不写任何巡检业务逻辑
  - 四项全部有默认值（brownfield 零回归），键名严格按 design §3 mission_patrol_* 前缀，不加第五项
  - Field 约束照 design 表：ge=10/5/5 只设下界不设上界
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
