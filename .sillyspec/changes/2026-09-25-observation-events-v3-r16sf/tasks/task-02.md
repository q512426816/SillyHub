---
id: task-02
title: 'Add observation events v3 feature flag and admin endpoints'
title_zh: '开关基础设施（feature_flag fail-closed + settings 管理端点）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 00:55:16
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-008@v1]
allowed_paths:
  - backend/app/modules/platform_sync/feature_flag.py
  - backend/app/modules/settings/router.py
  - backend/app/modules/settings/schema.py
  - backend/app/modules/settings/tests/
  - backend/app/modules/platform_sync/tests/
target_files:
  - NEW:backend/app/modules/platform_sync/feature_flag.py
  - backend/app/modules/settings/router.py
  - backend/app/modules/settings/schema.py
  - NEW:backend/app/modules/settings/tests/__init__.py
  - NEW:backend/app/modules/settings/tests/test_observation_events_v3_flag.py
provides:
  - contract: ObservationEventsV3Flag
    fields: [enabled]
goal: >
  建 observation-events-v3 功能开关：platform_sync 侧 fail-closed 读取函数 +
  settings 管理端点（GET/PUT，审计+管理员），缺省 false=v2 行为不变（D-008）。
  开关读取函数是 task-03/task-04 两端点语义参数的唯一来源。
implementation:
  - 新建 backend/app/modules/platform_sync/feature_flag.py：observation_events_v3_enabled(session)——session.get(PlatformSetting, "observation-events-v3")，缺键/json 解析失败/值非 dict 或 enabled 非真均返回 False（fail-closed，容错形态对齐 settings/router.py:198-206 _read_setting_json）
  - backend/app/modules/settings/schema.py 增 ObservationEventsV3Setting 读写模型（enabled: bool）
  - backend/app/modules/settings/router.py 增 GET/PUT /platform-settings/observation-events-v3（复用 _read_setting_json/_write_setting_json 与 _audit_platform_setting_write 审计 + 管理员鉴权，端点范式对齐 mcp-whitelist :237-262）
  - 新建 backend/app/modules/settings/tests/ 包与 test_observation_events_v3_flag.py：缺省 false、PUT true 即时生效、非管理员 403、审计行落库；若管理员 fixture 在 settings 域不可得，测试并入 platform_sync/tests/（Grill X-007 兜底，allowed_paths 已含该目录）
acceptance:
  - 无键/坏值/非真值三态 observation_events_v3_enabled 均返回 False
  - GET 缺省 enabled=false；PUT true 后 GET 返回 true 且审计行落库
  - 非管理员 PUT 得 403；无凭据 401
verify:
  - cd backend && uv run pytest app/modules/settings/tests/test_observation_events_v3_flag.py -q --no-cov
  - cd backend && uv run ruff check app/modules/platform_sync/feature_flag.py app/modules/settings
constraints:
  - fail-closed 三态均 False；不引入进程内缓存（回退即时性优先，D-008）
  - 不改 PlatformSetting 表结构与既有 settings 端点
  - KV 键名固定 observation-events-v3，值形如 enabled 布尔 JSON 对象
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
