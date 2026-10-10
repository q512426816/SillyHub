---
id: task-01
title: '附件引用纯函数库 attachment-refs.ts + 单测'
title_zh: '附件引用纯函数库 attachment-refs.ts + 单测'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 13:50:14
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/lib/attachment-refs.ts
  - frontend/src/components/daemon/__tests__/attachment-refs.test.ts
target_files:
  - NEW:frontend/src/lib/attachment-refs.ts
  - NEW:frontend/src/components/daemon/__tests__/attachment-refs.test.ts
goal: >
  实现附件引用 token 全生命周期纯函数（构建/同名唯一化分配/剥离/发送置换/历史解析），为输入区与发送组装提供无副作用核心。
implementation:
  - 新建 frontend/src/lib/attachment-refs.ts：AttRefTokenMap 类型 + buildAttRefToken(name, seq)（seq=1 无后缀、>1 加 ·seq）+ allocateAttRefToken(name, existingTokens)（正文已出现与已分配并集内取最小可用序号，不随删除重排）+ stripAttRefTokens(value, tokens)（逐 token 全量移除）+ substituteAttRefsForSend(value, tokenMap, attachments)（token 换 [附件引用:uuid|name]，映射不命中的孤儿 token 原样保留）+ parseInlineAttRefs(text)（正则匹配 36 位 hex uuid，口径对齐 runtime-session-helpers.tsx parseAttachmentMarkers）
  - 单测 frontend/src/components/daemon/__tests__/attachment-refs.test.ts：同名唯一化分配与删除不重排、strip 全量移除不误伤、置换 uuid 与附件一致、孤儿降级原样、解析拆段与非法片段容错
acceptance:
  - vitest attachment-refs.test.ts 全绿（含同名/孤儿/uuid 口径边界）
  - tsc --noEmit 零错（纯函数无 React 依赖）
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/attachment-refs.test.ts
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 纯函数零副作用、不依赖 React；不修改本任务两文件之外的任何文件
---

# 附件引用纯函数库 attachment-refs.ts + 单测

目标与步骤见 frontmatter；验收证据（测试输出摘要）追加于本文件末尾。
