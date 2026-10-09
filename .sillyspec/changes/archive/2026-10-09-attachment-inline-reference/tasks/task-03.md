---
id: task-03
title: '单聊输入区接入：右击插入/映射回传/删附件联动/镜像层挂载'
title_zh: '单聊输入区接入：右击插入/映射回传/删附件联动/镜像层挂载'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 13:50:14
priority: P0
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-05]
decision_ids: [D-001@v1, D-002@v1, D-004@v1, D-006@v1]
allowed_paths:
  - frontend/src/components/daemon/session-input-bar.tsx
  - frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
target_files:
  - frontend/src/components/daemon/session-input-bar.tsx
  - frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
goal: >
  session-input-bar 支持右击附件 chip 在正文末尾插入引用 token，attTokenMap 状态随附件生命周期维护并回传父级，删除附件联动剥离正文引用，挂载镜像高亮层。
implementation:
  - chip 文件名按钮加 onContextMenu：preventDefault + attTokenMap 命中或 allocateAttRefToken 分配 token + onChange(value + token) 追加末尾 + pendingCaretRef 延迟置光标末尾（复用既有机制 session-input-bar.tsx:280 附近）
  - 新增 prop onAttTokenMapChange（可选回调）；attTokenMap 变更（分配/清理）时回传；registerClearAttachments 清空时同步清映射
  - handleRemove（session-input-bar.tsx:610 附近）：onChange(stripAttRefTokens(value, 该附件 token)) 联动剥离 + 删映射
  - textarea 容器挂 InputRefOverlay（tokens 为 attTokenMap 值集，onRemoveToken 移除一次出现），版式 class/style 与 textarea 同参（含 inputHeight 高度拖拽同步）
  - 用例：右击插入末尾与光标、重复右击多标签、同名 ·2、×角标删一处、删附件联动清全部引用、无引用时零回归
acceptance:
  - session-input-bar-upload.test.tsx 新用例全绿且既有用例零回归
  - 未右击过任何附件时组件行为与现状一致（镜像层不渲染）
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/session-input-bar-upload.test.tsx src/components/daemon/__tests__/session-input-bar-height.test.tsx src/components/daemon/__tests__/session-input-bar-plus-menu.test.tsx
constraints:
  - 不改 SessionInputBar 既有 props 语义（新 prop 可选缺省）；不动 @联想/IME/粘贴/拖高既有逻辑
---

# 单聊输入区接入：右击插入/映射回传/删附件联动/镜像层挂载

目标与步骤见 frontmatter；验收证据（测试输出摘要）追加于本文件末尾。
