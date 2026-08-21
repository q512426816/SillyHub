---
id: task-06
title: session-inject-attachment-assembly-dispatch
title_zh: 附件组装与 SESSION_INJECT 下发（内联闸门、降级链路、标记行、绑定回填）
author: WhaleFall
created_at: 2026-08-20 15:13:46
priority: P0
depends_on: [task-03, task-05]
blocks: []
requirement_ids: [FR-2, FR-4, FR-5, FR-6, FR-10]
decision_ids: [D-3, D-4, D-9]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/session_attachment/service.py
provides:
  - contract: SessionInjectAttachments
    fields: [id, kind, media_type, name, bytes, data, object_key]
expects_from:
  task-05:
    - contract: MultimodalGate
      needs: [supports_multimodal, effective_provider_id]
goal: >
  inject 轮组装 SESSION_INJECT payload 的 attachments（多模态 base64 内联或回拉/文件元数据）、写 user_input 标记行、同事务回填附件 session_id。
implementation:
  - session_attachment/service.py 新增组装 helper——入参为已校验附件行 + task-05 的 MultimodalGate 结果（supports_multimodal 与 effective_provider_id），出参为 attachments 列表与下发模式
  - 多模态内联——gate 判支持时图片与 application/pdf 经 storage 读对象转 base64 写入 data 字段，按 base64 编码后总量累计
  - D-4 闸门——内联总量超 8MB（模块常量）时全部附件整体切回拉模式，仅带 id/kind/media_type/name/bytes/object_key 不带 data；单附件超限同规则，按总量而非单张判定
  - D-9 降级——gate 判不支持多模态时图片/PDF 改走文件链路，按 kind=file 下发（media_type 保留原值供回显），不带 data，turn 不失败
  - 链路判别口径——kind=image 带 data 为内联；kind=image 无 data 为 D-4 回拉（daemon 拉取后仍转多模态块）；kind=file 一律落盘
  - _inject_into_session 接线——task-05 校验通过后在 SESSION_INJECT payload 附加 attachments 键（仅在存在附件时），无附件路径与现状逐字节一致零回归
  - D-3 标记行——AgentRunLog user_input 的 content 头部逐附件插入标记行 [附件:id|kind|name]（kind 取 DB 原始值供前端回显缩略图），换行后接原 prompt，沿用既有截断口径
  - session_id 回填——校验通过的同事务内将附件行 session_id 由 null 回填为本会话 id（draft 到 bound 唯一前进迁移），已 bound 附件可再次引用且不改状态
acceptance:
  - attachments 项字段名与 task-07 协议逐字一致（snake_case 的 id/kind/media_type/name/bytes/data/object_key）
  - 多模态支持且总量不超 8MB——图片与 PDF 项含 data 不含 object_key
  - 总量超 8MB——全部附件项改带 object_key 不带 data（含小图整体切回拉）
  - 不支持多模态——图片与 PDF 项按 file 链路带 object_key 不带 data
  - 标记行格式与位置正确——user_input content 头部每附件一行且换行后接原 prompt
  - inject 成功后附件行 session_id 已回填，inject 失败回滚不绑定
  - 无附件 inject 零回归——payload 无 attachments 键且 user_input 无标记行
verify:
  - cd backend && uv run pytest tests/modules/daemon -q
  - cd backend && uv run pytest tests/modules/agent -q
constraints:
  - 不改 daemon/schema.py（attachment_ids 校验与门控归 task-05），不改 protocol.py 常量与 ws_hub
  - 首轮 create_session 不带附件（设计仅扩展 inject 端点 SessionInjectRequest）
  - 8MB 阈值为模块级共享常量，注释标明 D-4；组装单测矩阵（超限切回拉、降级链路、标记行、回填）由 task-14 在 tests/modules/session_attachment 落地
  - 旧 daemon 收到多余字段忽略（协议向后兼容零破坏）；降级不导致 turn 失败（链路由 kind 字段表达）
related_tests: []
---
