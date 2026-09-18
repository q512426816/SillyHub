---
id: task-04
title: 'add-menu-overrides-service'
title_zh: 'menu_overrides_service（list/upsert/delete + 审计 + label/sort 校验）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-18 14:46:09
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-02, FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/admin/
target_files:
  - NEW:backend/app/modules/admin/menu_overrides_service.py
expects_from:
  - task-02 提供 contract MenuOverrideRead 字段 menu_key、label、sort_order、hidden（读响应 DTO）
  - task-02 提供 contract MenuOverrideUpsert 字段 label、sort_order、hidden（写请求 DTO，null 表示清除该维度回默认）
goal: >
  新建 menu_overrides_service 提供 list、upsert、delete 服务方法与审计写入，作为 task-05 三端点的业务底座。
implementation:
  - 新建 menu_overrides_service.py，MenuOverrideService 以 session 与 actor_id 初始化，结构对齐 RoleService，list 返回全量 MenuOverrideRead 供读路径共用
  - upsert 按 menu_key 查行，无则新建有则更新；label 与 sort_order 为 None 时落 NULL 表示清除该维度回默认，hidden 落库；label 长度 1 到 30 与 sort_order 范围 0 到 999 边界校验拒绝非法值，错误文案中文
  - delete 按 menu_key 整行删除，行不存在时幂等 no-op，对应端点 204 语义
  - 私有 _audit 对齐 roles_service 模式（AuditLog 直写加 session.info 注入 audit_context），action 记 menu_override.upserted 与 menu_override.deleted，details 含 menu_key 与变更内容
  - 写操作 commit；menu_overrides 非权限数据，不调 invalidate_all_permissions
acceptance:
  - upsert 对新 key 建行、既有 key 更新，null 清除对应维度回默认，非法 label 或越界 sort_order 被拒
  - 每次 upsert 与 delete 各写一条审计日志且含 actor 与 menu_key
  - ruff 与 mypy scoped 零报错（端点单测归 task-06）
verify:
  - cd backend && uv run ruff check app/modules/admin/menu_overrides_service.py
  - cd backend && uv run mypy app/modules/admin/menu_overrides_service.py
constraints:
  - 表与服务均无 role 或 user 维度，不引入按角色查询参数（D-002 覆盖全局生效）
  - menu_key 不校验注册表存在性，孤儿容忍（R-01）
  - 不建 router、不写测试文件（分别归 task-05 与 task-06）
  - 错误文案中文；代码兼容 Windows、Linux 和 macOS
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
