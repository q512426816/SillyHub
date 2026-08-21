---
id: task-14
title: tri-end-attachment-test-suite
title_zh: 三端测试补齐（backend pytest / daemon vitest / frontend vitest）
author: WhaleFall
created_at: 2026-08-20 15:13:46
priority: P0
depends_on: [task-10, task-12, task-13]
blocks: []
requirement_ids: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10]
decision_ids: [D-4, D-6, D-7, D-9]
allowed_paths:
  - backend/app/modules/session_attachment/tests/__init__.py
  - backend/app/modules/session_attachment/tests/conftest.py
  - backend/app/modules/session_attachment/tests/test_router.py
  - backend/app/modules/session_attachment/tests/test_inject_attachments.py
  - backend/app/modules/session_attachment/tests/test_draft_cleanup.py
  - sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-attachments.test.ts
  - frontend/src/components/daemon/__tests__/session-input-bar-attachments.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-attachment-markers.test.tsx
goal: >
  按 design.md §8 测试矩阵补齐三端自动化测试，逐条覆盖附件链路与关键决策闸门，证明 brownfield 零回归。
implementation:
  - 新建 session_attachment 模块 tests 目录（__init__ + conftest），fixture 沿用既有模块测试范式（归属用户/会话 + StorageBackend stub + httpx AsyncClient）
  - test_router.py 覆盖上传校验（图片类型/单张 5MB/每消息 5 张、文件 20MB/5 份、magic 与 PIL 宽高）；跨用户取内容与他用户 id → 404 归属隐藏；同 user 同 sha256 上传 → 复用同 object_key 建新行；DELETE 仅草稿可删、已绑定附件拒删
  - test_inject_attachments.py 覆盖 attachment_ids 归属与限制整体 4xx 拒绝（不部分生效）；codex 会话携附件 → 422（D-6）；纯附件空 prompt 放行、纯文本空 prompt 仍拒（D-7）；payload 内联 base64 总量超 8MB → 全部切回拉元数据（D-4）；multimodal 三态启发式表驱动 + 不支持时图片/PDF 降级文件链路且组装不失败（D-9）；user_input 标记行写入 + session_id 回填断言
  - test_draft_cleanup.py 覆盖 48h 未绑定草稿行清理、bound 行与新鲜草稿保留、cron 委托挂接点断言
  - daemon claude-sdk-driver-content-blocks.test.ts 覆盖有 blocks 时 content 转 SDK 块数组（text + image/document base64）；无 blocks 保持纯字符串路径输出逐字等价（零回归）；codex driver 静默忽略 blocks 兜底
  - daemon session-manager-attachments.test.ts 覆盖 payload.attachments 分组（image/pdf → blocks、file → filesToFetch + hub-client 下载落盘）；cwd/attachments/ 同名冲突加序号；prompt 追加路径清单；单文件下载失败标注且 turn 不中断（降级）
  - frontend session-input-bar-attachments.test.tsx 覆盖选文件即传 → chip 渲染（缩略图/文件名+大小）→ 删除 → 发送携带 attachment_ids；超限预检报错；codex 会话附件入口禁用；非多模态 provider 降级提示条渲染
  - frontend turn-timeline-attachment-markers.test.tsx 覆盖 user_input 标记行解析为缩略图/只读 chip；非法标记行按原文本容错显示
acceptance:
  - 三端新增测试全绿，design §8 矩阵每条场景有对应用例
  - 既有测试零修改零回归（纯文本消息与无 blocks 会话流程不受影响）
  - backend 覆盖率不被拉低（pytest --cov-fail-under=60 门槛仍过）
verify:
  - cd backend && uv run pytest -q
  - cd frontend && pnpm test
  - cd sillyhub-daemon && pnpm test
constraints:
  - 不为凑绿改既有断言（规则 9）；测试暴露实现缺陷时回 task-05/06/09/10/12/13 责任路径修实现，本卡不改产品代码
  - 测试文件头注释标注 task/FR/D 编号，沿用仓库既有测试注释惯例
related_tests: []
---
