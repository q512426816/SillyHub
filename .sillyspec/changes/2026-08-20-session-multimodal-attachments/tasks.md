# Tasks：会话附件（任务注册表——checkbox 唯一真相；plan.md Wave 段为纯 ID 引用）

- [ ] task-01: SessionAttachment 模型 + Alembic 迁移（含 llm_providers.multimodal 列）（FR-1, FR-3; D-5）
- [ ] task-02: MinIO 内容寻址接入（object_key sha256 + 同哈希复用）（FR-1, FR-3）
- [ ] task-03: POST 上传端点（multipart 限制/magic/PIL 校验 + AttachmentRead）（FR-1, FR-3, FR-8）
- [ ] task-04: GET content 流式 + DELETE 仅草稿（FR-6, FR-8; D-8）
- [ ] task-05: inject 校验与 D-9 多模态门控（attachment_ids/422/空文本豁免）（FR-2, FR-5, FR-7, FR-9, FR-10; D-6, D-7, D-9）
- [ ] task-06: 附件组装下发 + 标记行 + session_id 回填（D-4 帧闸门/降级路由）（FR-2, FR-4, FR-5, FR-6, FR-10; D-3, D-4, D-9）
- [ ] task-07: daemon 协议扩展 SessionInjectPayload.attachments（向后兼容）（FR-2, FR-4; D-1）
- [ ] task-08: 草稿清理任务 48h（FR-8; D-5）
- [ ] task-09: daemon inject 消费（blocks/回拉/文件落盘+路径清单+失败降级）（FR-2, FR-4, FR-5; D-2, D-4）
- [ ] task-10: mapUserTurnInputToSdk 块数组改造 + spike-01（零回归）（FR-2, FR-5; D-1）
- [ ] task-11: gen:types + 附件 API 封装（FR-1, FR-3, FR-6; D-9）
- [ ] task-12: 输入栏附件流 + 供应商表单 multimodal 开关（codex/降级门控）（FR-1, FR-3, FR-7, FR-10; D-6, D-9）
- [ ] task-13: 历史回显标记行解析（缩略图/chip 容错）（FR-6; D-3）
- [ ] task-14: 三端测试补齐（FR-1 至 FR-10; D-4, D-6, D-7, D-9）
- [ ] task-15: E2E 验收 + 部署 + 文档同步（FR-1 至 FR-10 全验收; D-4, D-9）
