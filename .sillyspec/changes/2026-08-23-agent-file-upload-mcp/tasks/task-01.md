---
id: task-01
title: extend-file-model-with-description-column-and-dto-fields
title_zh: 'backend file 模块扩展——File 加 description 列 + FileUploadResp/FileMetaResp 扩字段（含 created_at）+ upload_file 增参 + alembic 迁移'
author: 'qinyi'
created_at: 2026-08-23 09:37:06
priority: P0
depends_on: []
blocks: [task-02, task-03]
requirement_ids: [FR-06]
decision_ids: [D-006@v2]
provides:
  - contract: file-dto-extended
    fields: [description, created_at]
allowed_paths:
  - backend/app/modules/file/model.py
  - backend/app/modules/file/schema.py
  - backend/app/modules/file/service.py
  - backend/migrations/versions/20260823100000_file_description_column.py
  - backend/app/modules/file/tests/test_file_api.py
  - backend/app/modules/agent/tests/test_mission_session_id.py
related_tests:
  - backend/app/modules/file/tests/test_file_api.py —— 上传/meta/batch/list 响应新增 description 与 created_at 字段，现有逐键断言兼容，若暴露整 dict 断言失效需同步补字段
  - backend/app/modules/agent/tests/test_mission_session_id.py —— test_migration_is_single_head_after_mount 原钉死 head=20260822090000，本 task 迁移推进 head 后必然失效；连带修复为「单 head + walk_revisions 链可达」不钉值（execute Wave1 已修，commit 5049141e）
goal: >
  为 agent 上传文件提供 description 持久化位置与展示字段（design §8 / D-006@v2，FR-06）——File 表加 nullable description 列 + alembic 迁移，
  FileUploadResp/FileMetaResp 扩 description、FileMetaResp 另补 created_at（列已有 DTO 未暴露，§7.1 list 工具需要），upload_file 增参。
implementation:
  - model.py File 新增 description 字段（String(255)、nullable、default None，写法仿 deleted_at 列），docstring 注明 agent 上传描述用途（D-006@v2）
  - schema.py FileUploadResp 增 description（str | None 默认 None，兼容旧行 NULL），FileMetaResp 增 description 与 created_at（datetime），from_attributes 直接从 ORM 映射；service.py upload_file 增 keyword-only 参数 description（str | None = None），落 File 行时截断 255（仿 original_name 处理），FileUploadResp 构造处带出 description
  - 新建 alembic 迁移 20260823100000_file_description_column.py——revision=20260823100000，down_revision 取执行时 alembic head（当前 20260822090000），op.add_column 纯加列 nullable 无回填，downgrade 对称 drop，头注释与格式仿 20260822090000_mission_session_id.py
acceptance:
  - alembic upgrade head 后 file 表出现 description 列（String(255)、nullable、无默认回填），downgrade 可对称回退
  - upload_file 传 description 时 FileUploadResp 与 FileMetaResp（get_meta/batch_meta/list 路径）均返回该值，不传时为 None；FileMetaResp 另含 created_at 且等于落库时间
  - file 模块既有测试全绿（test_file_api.py 逐键断言与新增字段兼容，既有 /api/file/upload 行为不变）
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run pytest app/modules/file -q
constraints:
  - 不做存量数据回填（design §9）；不改 /api/file/upload 既有 router 签名与行为（description 的业务消费方是 task-03 file_artifacts 端点）
  - 不触碰 _can_access（属 task-02，共享 service.py 故错波）；description 超长截断不加新校验错误码，不动 owner_type/owner_id 多态归属语义
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
