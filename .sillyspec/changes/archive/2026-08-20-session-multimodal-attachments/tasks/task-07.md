---
id: task-07
title: daemon-protocol-session-inject-attachments
title_zh: daemon 协议扩展——SessionInjectPayload 可选 attachments 字段
author: WhaleFall
created_at: 2026-08-20 15:13:46
priority: P0
depends_on: [task-06]
blocks: [task-09]
requirement_ids: [FR-2, FR-4]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/protocol.ts
provides:
  - contract: SessionInjectAttachment
    fields: [id, kind, media_type, name, bytes, data, object_key]
expects_from:
  task-06:
    - contract: SessionInjectAttachments
      needs: [id, kind, media_type, name, bytes, data, object_key]
goal: >
  SessionInjectPayload 新增可选 attachments 数组类型，字段与 task-06 契约逐字对齐（snake_case），旧 daemon 与旧 backend 双向兼容。
implementation:
  - protocol.ts 紧邻 SessionInjectPayload 新增附件项 interface——必填 id/kind/media_type/name/bytes，可选 data 与 object_key（均 string，设计 §4.3）
  - kind 类型为 image 与 file 的字符串字面量联合
  - SessionInjectPayload 增可选 attachments 字段（缺省不携带，旧 backend 消息零影响）
  - JSDoc 写明三种消费形态——kind=image 带 data 为内联多模态；kind=image 无 data 为 D-4 回拉（daemon 拉取后仍转 blocks）；kind=file 为落盘 cwd/attachments/（D-9 降级图片走此链路）
  - 保持本文件纯类型 interface 模式——不引入 zod 运行时校验（protocol.ts 现状无 zod），daemon.ts 与 SessionManager 消费改造归 task-09 不动
acceptance:
  - 字段名与 task-06 提供契约逐字一致（snake_case，无驼峰漂移，双侧契约单测对齐）
  - attachments 为可选字段，不携带时 SESSION_INJECT 既有消费路径零回归
  - 旧 daemon 兼容——收到未知字段忽略不破坏解析
  - pnpm typecheck 通过（tsc 严格模式为唯一静态门禁）
verify:
  - cd sillyhub-daemon && pnpm test tests/protocol-session-contract.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 不改 MSG 常量与其余 payload interface（值逐字对齐 backend 既有约束）
  - 不改 daemon.ts 与 SessionManager（消费归 task-09）
  - 契约消费测试补齐归 task-09 与 task-14，本卡仅类型与契约回归
related_tests: []
---
