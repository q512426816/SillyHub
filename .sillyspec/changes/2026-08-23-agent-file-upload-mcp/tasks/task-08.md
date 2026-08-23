---
id: task-08
title: 'add-chat-file-segment-and-file-message-card'
title_zh: '前端聊天流 file 段——assembler 分类入口传入 toolKind + 文件卡片组件 + 段视图渲染 + 测试'
author: 'qinyi'
created_at: 2026-08-23 09:37:06
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-007@v1]
allowed_paths:
  - frontend/src/components/daemon/session-log-assembler.ts
  - frontend/src/components/daemon/file-message-card.tsx
  - frontend/src/components/daemon/turn-segment-views.tsx
  - frontend/src/components/daemon/__tests__/session-log-assembler.test.ts
  - frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  - frontend/src/components/daemon/__tests__/file-message-card.test.tsx
  - frontend/src/components/daemon/turn-status-bar.tsx
  - frontend/src/components/daemon/turn-timeline.tsx
related_tests_note: turn-status-bar.tsx segmentTs 与 turn-timeline.tsx segmentTsOf 的 seg.kind 穷尽 switch 因 TurnSegment 新联合成员触发 TS2366 编译错，各补 1 行 case "file" 返回 seg.ts（execute Wave4 连带最小修正，非原卡预见）
provides:
  - contract: FileMessageCard
    fields: [fileId, name, size, mime, description]
    note: 'daemon/file-message-card.tsx 纯展示 memo 组件——图片 mime 走 FileImage（JWT blob 拉取+点击放大）缩略图卡片，其余走图标+名+大小+downloadFile 下载；task-09 产出文件区直接复用'
  - contract: TurnSegment file 段
    fields: [kind-file, fileId, name, size, mime, description]
    note: 'session-log-assembler.ts TurnSegment 联合新成员（design §7.3，另含 id/ts/segId 按既有段派生规则）；tool_kind=FileUpload 日志行的映射产物，供段视图与 task-09 消费'
expects_from:
  task-03:
    - contract: AgentRunLog FileUpload 日志行
      needs: [file_id, original_name, size, mime_type, description]
goal: >
  聊天流呈现 agent 上传文件——FileUpload 日志行优先映射为 file 段（不再误渲染 tool_use 段），
  file-message-card 按图片/通用两形态渲染并接入段视图（FR-01 / D-001@v1）。
implementation:
  - 'session-log-assembler.ts——TurnSegment 联合（:205-244）新增 file 段成员（design §7.3 全字段）；classifySessionLog 签名（:100-139 现只收 content/channel）扩可选第三参 toolKind——toolKind 为 FileUpload 且 channel 为 tool_call 时优先于通用 tool_use 映射（R-07），parse content JSON 取五字段，解析失败回退通用 tool_use 不丢行；applyLogToSegments（:609）与 logsToSegments 去重键路径（:906）两调用点同步传 toolKind（AssemblerLogInput.toolKind 已有 :201，归一层已填，零改调用方）；装配 switch 新增 file 分支经 applyToBucket 追加（id 走 makeUniqueSegmentId、ts 取 log timestamp），segmentsToLegacy 投影跳过 file 段（旧消费方零感知）'
  - '新建 file-message-card.tsx——props 见 provides；图片 mime（isImageMime）缩略图卡片（复用 FileImage preview 模式，约 220px 宽），非图片图标+名+描述+formatFileSize+下载按钮（downloadFile）；不读 SSE/store/本地时钟'
  - 'turn-segment-views.tsx——SegmentView 新增 file 分支渲染 FileMessageCard；导出 FileTurnSegment 类型别名（对齐 Text/Thinking/Stderr 先例）'
  - '测试——assembler 测试加分组（FileUpload 行到 file 段且同轮无 tool_use 段/未知 tool_kind 行为保持/非 JSON 回退/投影跳过/两路去重不受影响）；turn-segment-views 测试加 file 段渲染；新建 file-message-card.test.tsx（图片/普通两形态+下载事件，mock lib/file/api）'
acceptance:
  - 'tool_kind=FileUpload 的 tool_call 日志行映射为 file 段（五字段取自 content JSON），同轮不再产生 tool_use 段（R-07 测试锚点）'
  - '图片 mime 渲染缩略图卡片（JWT blob 经 FileImage 拉取，可点击放大）；非图片渲染通用卡片且下载触发 downloadFile(fileId, name)'
  - '未知/旧 tool_kind 分类策略保持——仍走通用 tool_use 映射，既有 assembler 与段视图测试零回归'
verify:
  - cd frontend && pnpm vitest run src/components/daemon
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - '不改 session-panel.tsx / runtime-session-helpers.tsx / lib/file/api.ts（toolKind 已在归一层填入；下载与 blob 只消费不改）；classifySessionLog 第三参可选，session-log-sanitize.ts 垫片同源引用不受影响'
  - 'UI 遵循 FRONTEND_PAGE_STYLE.md 与 AI-Native 双主题（brand-* 语义阶/主题 token/阴影 var 化，不硬编码 hex），参考原型 prototype-agent-file-upload-mcp.html 的 file-card/file-thumb 两形态'
  - '时间取自 log timestamp，展示 Date.toLocaleString 显式传 zh-CN；turn-segment-views.tsx 不直接引 antd 的纪律保持（antd 仅经 FileImage 间接用于图片放大）'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
