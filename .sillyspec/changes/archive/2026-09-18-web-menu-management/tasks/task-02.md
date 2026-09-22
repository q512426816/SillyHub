---
id: task-02
title: 'add-menu-override-model-and-schemas'
title_zh: 'MenuOverride 表模型（admin/model.py）+ schema（admin/schema.py）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-18 14:46:09
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-05]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/admin/model.py
  - backend/app/modules/admin/schema.py
target_files:
  - backend/app/modules/admin/model.py
  - backend/app/modules/admin/schema.py
provides:
  - contract MenuOverrideRead 字段 menu_key、label、sort_order、hidden（读响应 DTO）
  - contract MenuOverrideUpsert 字段 label、sort_order、hidden（写请求 DTO，null 表示清除该维度回默认）
goal: >
  在 admin 模块落地 menu_overrides 表模型与读写 schema，为菜单覆盖存储和服务层契约提供数据地基，表无 role/user 维度。
implementation:
  - model.py 新增 MenuOverride（BaseModel 加 table=True，表名 menu_overrides），字段对齐 design 数据模型，id 为 UUID 主键、menu_key String(64) 唯一非空、label_override String(30) 可空、sort_order Integer 可空、hidden Boolean 默认 False、created_at 与 updated_at 带时区时间戳，写法对齐 Organization 惯例并更新模块 __all__
  - schema.py 新增 MenuOverrideRead（menu_key、label、sort_order、hidden，from_attributes）与 MenuOverrideUpsert（三字段全可空且 extra 等于 forbid，label 长度 1 到 30、sort_order 范围 0 到 999），更新模块 __all__
acceptance:
  - MenuOverride 字段与 design 数据模型一一对应，不含 role 或 user 维度字段（D-002）
  - MenuOverrideRead 恰含 menu_key、label、sort_order、hidden；MenuOverrideUpsert 恰含 label、sort_order、hidden 且未知字段被拒
  - ruff 与 mypy scoped 零报错
verify:
  - cd backend && uv run ruff check app/modules/admin/model.py app/modules/admin/schema.py
  - cd backend && uv run mypy app/modules/admin/model.py app/modules/admin/schema.py
constraints:
  - 后端不校验 menu_key 是否存在于前端注册表，任意稳定字符串可存（R-01 孤儿容忍）
  - 模型列名用 label_override 表达可空覆盖语义，对外 schema 字段名为 label
  - 空表等于现状行为，不改既有表模型与既有 schema 定义
  - 代码兼容 Windows、Linux 和 macOS
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
