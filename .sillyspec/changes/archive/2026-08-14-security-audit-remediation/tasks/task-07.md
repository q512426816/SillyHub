---
id: task-07
title: "sync_documents 路径守卫"
title_zh: "change sync_documents 路径穿越修复（startswith 改 relative_to + filename 白名单）"
author: qinyi
created_at: 2026-08-15 01:12:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/schema.py
  - backend/app/modules/change/tests/test_sync_documents_traversal.py
goal: >
  sync_documents 的路径穿越守卫从 startswith 前缀判断改为 pathlib relative_to 解析校验，schema 层加 filename 白名单，双层防御。
implementation:
  - 新建 backend/app/modules/change/tests/test_sync_documents_traversal.py，先写失败用例——filename 形态 ../../evil 期望 4xx、形态 foo-evil/../../x 期望 4xx、正常 design.md 与 proposal.md 回归成功
  - change/service.py sync_documents（约 :612-678）——root_resolved 在循环外 resolve 一次（现在循环内每文档 resolve root，先提到循环外）
  - 循环内守卫替换——resolved.relative_to(root_resolved) try except ValueError，失败 raise ChangeDocNotFound（路径穿越语义），替换现有 str(resolved).startswith(str(root.resolve())) 判断，与同文件 read_file/write_file（:334/:371）的 relative_to 范式对齐
  - change/schema.py 的 DocumentsSyncRequest（:200）加 pydantic validator——iter_documents 返回前对每个 filename 校验正则单段文件名白名单（字母数字点下划线连字符，禁路径分隔符与点开头目录跳转），不合法 raise ValueError 映射 422
  - 白名单正则覆盖既有 CLI 契约的单段名（design.md / proposal.md 等），platform_sync 侧 DocumentsSyncRequest（platform_sync/schema.py DOCUMENT_FILES 白名单）已有四件套收敛，本 task 只在 change 侧兜底，不改 platform_sync/schema.py
acceptance:
  - filename 含 ../ 的 documents 同步请求被 schema 层拒绝，期望 HTTP 422
  - 绕过 schema 直调 service.sync_documents 传 ../../evil 形态，期望抛 ChangeDocNotFound（HTTP 404）
  - filename 含子目录分隔符形态同样被拒（422 或 404，取决于命中层级）
  - 正常四件套单段文件名 sync 后磁盘落在 .sillyspec/changes/{change_key}/ 目录内，返回 synced 计数正确
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_sync_documents_traversal.py -q --no-cov
  - cd backend && uv run pytest app/modules/change/tests/test_files_router.py app/modules/change/tests/test_router.py -q --no-cov
constraints:
  - 不改 sync_documents 的 upsert 与批量 IN 查询语义（N+1 优化保持）
  - ChangeDocNotFound 的既有 HTTP 映射不变（404）
  - 与 task-06 不冲突——本 task 只动 change 域文件，platform_sync 的 DocumentsSyncRequest 不在 allowed_paths
  - Windows 路径兼容——relative_to 在 Windows 分隔符形态下同样生效，测试用正斜杠形态即可（pathlib 归一化）
related_tests:
  - path: backend/app/modules/change/tests/test_files_router.py
    reason: 既有 test_read_file_traversal_rejected 与 test_write_file_traversal_rejected 覆盖 read/write_file 的 relative_to 守卫，本 task 对齐同一范式；改 service 守卫后这两个用例必须保持绿（防回归锚点，非失效）
---
