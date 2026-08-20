---
id: task-12
title: session-input-bar-attachment-flow-and-multimodal-toggle
title_zh: 会话输入栏附件流与多模态门控
author: WhaleFall
created_at: 2026-08-20 15:13:46
priority: P0
depends_on: [task-11]
blocks: [task-14]
requirement_ids: [FR-1, FR-3, FR-7, FR-10]
decision_ids: [D-6, D-7, D-9]
allowed_paths:
  - frontend/src/components/daemon/session-input-bar.tsx
  - frontend/src/app/(dashboard)/sessions/page.tsx
  - frontend/src/components/llm-providers/llm-provider-form.tsx
  - frontend/src/lib/daemon.ts
  - frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx
provides:
  - contract: SessionInjectOptions
    fields: [attachment_ids]
expects_from:
  task-11:
    - contract: AttachmentApi
      fields: [upload, remove, contentUrl]
    - contract: LlmProviderRead
      fields: [multimodal]
goal: >
  SessionInputBar 落地附件流（入口门控/上传 chips/删除/发送带 attachment_ids/降级黄条），并在供应商表单加 multimodal 三态手动覆盖开关。
implementation:
  - SessionInputBar 新增可选 prop attachmentsDisabled（codex 会话为 true，禁用先例对齐供应商锁定），缺省 false 零回归
  - 输入栏加 📎 按钮，隐藏 input 双 accept（图片 png/jpeg/webp/gif 与全类型），选文件即调 AttachmentApi.upload，上传中 chip 转 spinner，失败红 chip 可重试
  - chips 区渲染图片缩略图（经 contentUrl 取内容）与文件名加大小（KB/MB 格式化），chip 提供删除按钮调 remove，张数/大小超限按 task-11 预检常量前端拦截并明示
  - 发送守卫对齐 D-7——附件非空时允许空 prompt（按钮 disabled 由纯空文本改为无附件且空文本才禁），纯文本消息仍要求非空
  - onSend 语义扩展携带附件 id 列表（类型向后兼容，父级旧签名不破），发送成功后清空 chips 与附件状态
  - daemon.ts injectSession 的 body 组装补 attachment_ids 透传（生成类型 SessionInjectRequest 已含该字段，判断 undefined 而非真值，空数组语义保留）
  - FR-10 降级提示条——按会话当前生效 provider 的 multimodal 判定（auto/true/false），不支持时附件区上方渲染黄色提示条，文案注明图片/PDF 将自动降级为文件落盘模式（用户知情无需手选）
  - llm-provider-form.tsx 高级区加 multimodal 三态开关（自动/开启/关闭，中转站别名场景的权威来源），表单值与既有 formToCreate/formToUpdate 链路透传
  - 同步测试文件——既有断言零回归，新增附件流用例（选→传→chip→删→发送带 ids、codex 禁用、带附件空 prompt 可发、降级黄条）
acceptance:
  - codex 会话附件入口禁用不可点，claude 会话可用
  - 选图即传即显缩略图 chip 可删，失败红 chip 可重试，超限前端拦截有明示
  - 发送请求 body 携带 attachment_ids，成功后 chips 清空
  - 带附件空 prompt 可发送，无附件空 prompt 仍禁用
  - provider 不支持多模态时显示黄色降级提示条
  - 供应商表单可保存并回显三态 multimodal 覆盖值
verify:
  - cd frontend && pnpm typecheck && pnpm test
constraints:
  - 宿主接线归 sessions/page.tsx（协调者已核：SessionInputBar 由该页组装，附件状态在页内持有并经 props 下传、发送时并入 inject 载荷；与 W4 其他任务无文件重叠）
  - 附件状态与 UI 自治于 SessionInputBar 内，父级仅经 props 与发送载荷感知
  - 样式遵循 FRONTEND_PAGE_STYLE.md 与前端样式系统总纲（黄条用警示色系）
  - 既有测试仅在组件 props 扩展导致 mock/固件需补字段时同步，非测试逻辑有误不得改断言迁就实现
related_tests:
  - frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx
---
