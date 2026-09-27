---
id: task-01
title: 'Widen change event detail column to Text'
title_zh: '存储层 detail 列 Text 化（ORM+迁移）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 00:55:16
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/platform_sync/model.py
  - backend/migrations/versions/
target_files:
  - backend/app/modules/platform_sync/model.py
  - NEW:backend/migrations/versions/20260925900000_change_event_detail_text.py
provides:
  - contract: PlatformChangeEventDetailText
    fields: [detail]
goal: >
  把 platform_change_events.detail 从 String(2000) 无损加宽为 Text 并附 Alembic 迁移，
  支撑 v3 开态 64KB 明细落库（D-005）。detail 列宽是 task-03 落库截断 65536 的前置。
implementation:
  - backend/app/modules/platform_sync/model.py:379-403 PlatformChangeEventORM.detail 列 sa.String(2000) 改 sa.Text（docstring 补 64KB=65536 字符口径）
  - 新建迁移 backend/migrations/versions/20260925900000_change_event_detail_text.py：down_revision 取当前唯一 head；upgrade 用 ALTER COLUMN TYPE TEXT（PG）/ batch_alter_table（SQLite 方言分叉，对齐既有迁移先例）；downgrade 同形缩窄回 String(2000) 并在 docstring 注明仅限无 v3 数据的开发库（R-06）
  - 核对迁移链位：cd backend && uv run alembic heads 必须单 head（防并行变更撞 revision 坑，见 knowledge known-issues）
acceptance:
  - ORM detail 列为 Text 且表其余列/唯一约束/索引零改动
  - alembic heads 输出单 head；upgrade 在 SQLite 测试库口径可执行
  - ruff check 与 mypy 对 model.py 零新增告警
verify:
  - cd backend && uv run alembic heads
  - cd backend && uv run ruff check app/modules/platform_sync/model.py
constraints:
  - 只加宽不缩窄：up/downgrade 形态对称但 downgrade 仅限无 v3 数据的开发库，生产回退走开关不走迁移
  - 不改 dedup 唯一约束、索引、其余列
  - 迁移文件名时间戳按 execute 实际落点可微调，revision id 保持单链
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
