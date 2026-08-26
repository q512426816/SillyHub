---
id: task-01
title: Add change file raw endpoint
title_zh: 后端 raw 端点（service.read_file_raw + 路径守卫提取 + router + 测试）
author: 'qinyi'
created_at: 2026-08-26 20:13:49
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/router.py
  - backend/app/modules/change/tests/test_files_router.py
goal: >
  新增变更文件二进制读取端点 GET files/raw（FR-04），供前端构造 Blob 预览变更目录里的
  图片与文档（D-001）；从 read_file 提取共用路径守卫 helper，read_file 行为零变更。
implementation:
  - service.py 提取 _resolve_change_file 私有 helper（get change → workspace → _resolve_change_dir → resolve 拼路径 → relative_to 穿越守卫，违反抛 ChangeDocNotFound），现 read_file（L373-385）改调 helper，对外行为零变更
  - service.py 新增模块级常量 MAX_RAW_BYTES（50MB）与 read_file_raw，经 helper 拿 full_path 后 asyncio.to_thread 读字节，不存在抛 ChangeDocNotFound，超限抛 HTTPException(413)，mimetypes.guess_type 定 media_type（未知回 application/octet-stream），返回 (文件字节, media_type) 二元组
  - router.py 新增 GET changes/{change_id}/files/raw 路由（path 用 Query，权限 Permission.CHANGE_READ 与 files/content（L430-443）一致），StreamingResponse(BytesIO(字节))，headers 含 Content-Length（实际字节数）与 Content-Disposition（inline + RFC5987 filename*，写法对齐 explorer/router.py L91-107 但 disposition 用 inline 非 attachment）
  - test_files_router.py 新增 5 用例（该文件 fixture 已备 change_id 与 spec_root，files 端点用例均在此）——正常 png 200 且 Content-Type 为 image/png 且 body 字节一致；路径穿越（../ 与绝对路径）404；不存在 404；写入超限大小文件断言 413；无 CHANGE_READ 权限 403
acceptance:
  - GET files/raw 命中镜像内图片返回 200，Content-Type 为 guess_type 结果，Content-Length 等于实际字节数，body 为文件原始字节
  - 路径穿越与文件不存在均返回 404（ChangeDocNotFound 同款守卫语义）
  - 文件超过 50MB 返回 413
  - 无 CHANGE_READ 权限返回 403
  - 既有 read_file 与 files/content 测试全绿（helper 重构零回归）
verify:
  - cd backend && uv run pytest app/modules/change -q --no-cov -n auto
constraints:
  - 不改 read_file 与 files/content 的对外契约（响应模型、1MB 截断行为、错误语义均不动），仅内部提取 helper 复用
  - 不碰 daemon 与 daemon-client 写回链路，本端点纯只读
  - 大小上限用独立常量 MAX_RAW_BYTES（50MB），不复用也不修改 MAX_CONTENT_BYTES（1MB）
provides:
  - contract: files_raw_endpoint
    fields: [media_type, body, filename_star]
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
