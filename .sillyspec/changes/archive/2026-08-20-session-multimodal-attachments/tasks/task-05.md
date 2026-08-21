---
id: task-05
title: inject-attachment-validation-and-multimodal-gate
title_zh: inject 附件校验与多模态能力门控
author: WhaleFall
created_at: 2026-08-20 15:13:46
priority: P0
depends_on: [task-01]
blocks: [task-06]
requirement_ids: [FR-2, FR-5, FR-7, FR-9, FR-10]
decision_ids: [D-6, D-7, D-9]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/session_attachment/capability.py
  - backend/app/modules/llm_provider/schema.py
provides:
  - contract: MultimodalGate
    fields: [supports_multimodal, effective_provider_id]
expects_from:
  task-01:
    - contract: SessionAttachment
      needs: [id, user_id, kind, session_id]
    - contract: llm_providers.multimodal
      needs: [multimodal]
goal: >
  inject 接受 attachment_ids 完成归属数量引擎校验与 D-9 多模态门控判定供组装消费。
implementation:
  - schema.py SessionInjectRequest 增 attachment_ids 默认空上限 10 扩展 _require_prompt_or_switch 附件非空豁免空 prompt（D-7）另 llm_provider/schema.py LlmProviderRead 增 multimodal 三态字段 from_attributes 直映射
  - session/service.py inject_session 与 _inject_into_session 透传 attachment_ids 引擎门控 provider 非 claude 携附件 → 422 新错误码 HTTP_422_SESSION_ATTACHMENTS_UNSUPPORTED（D-6 错误类放既有 DaemonSession 错误块）批量查行缺失或归属不符 → 404 隐藏 超限 → 422 校验段事务内整体失败即回滚
  - 新建 capability.py 三态判定 true 与 false 直取 auto 按生效模型名启发式表（v 系 vision glm gpt-4o gpt-5 o4 claude gemini qwen vl 等）未命中一律不支持（D-9 保守）
  - 生效 provider 取会话显式绑定行优先为空回退用户 is_default 同 agent_kind 行再无则保守不支持 模型名取 model 或 default_fallback_model 产出 MutimodalGate 供 task-06 组装消费
acceptance:
  - codex 携附件回 422 错误码 HTTP_422_SESSION_ATTACHMENTS_UNSUPPORTED 他人附件或不存在 id → 404 超限 → 422 校验失败整体回滚
  - 附件非空加空 prompt 通过双空仍 422（D-7）不带 attachment_ids 的既有 inject 行为零回归
  - auto 命中启发式判支持未命中判不支持手动 true false 覆盖优先会话绑定行优先于 is_default
verify:
  - cd backend && uv run pytest app/modules/daemon/tests app/modules/session_attachment/tests -q
constraints:
  - 组装下发 user_input 标记行 session_id 回填与 D-4 闸门归 task-06 本卡只校验与判定 llm_provider 仅 Read 暴露 multimodal 写入路径不在本卡 auto 未命中一律不支持宁降级不硬失败
related_tests: []
---
