---
id: task-08
title: 'wire-group-chat-ws-ref-pipeline'
title_zh: '群聊全链路接入（输入区 wsRefTokens/槽位插入/组装位置换/气泡历史三类标签）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 13:48:40
priority: P1
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-08]
decision_ids: [D-008@v2]
allowed_paths:
  - frontend/src/components/group-chat/group-chat-panel.tsx
  - frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
target_files:
  - frontend/src/components/group-chat/group-chat-panel.tsx
  - frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
expects_from:
  task-01:
    - contract: WsRefDesc
      needs: [kind, workspaceId, path, name, lines]
    - contract: buildWsRefToken
      needs: [name, lines, seq]
    - contract: allocateWsRefToken
      needs: [base, poolTokens]
    - contract: substituteWsRefsForSend
      needs: [value, map]
  task-04:
    - contract: InputRefOverlayTokenMetas
      needs: [kind, title]
  task-06:
    - contract: PendingWsRefInsertSlot
      needs: [desc, nonce]
related_tests:
  - frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
goal: >
  群聊输入区对齐单聊 task-05 同款工作区引用机制（wsRefTokens 状态/槽位插入/角标元数据），
  串联发送置换与气泡历史三类标签，实现单聊/预会话/群聊三输入区行为一致（FR-08）。
implementation:
  - group-chat-panel.tsx:1763 旁增 wsRefTokens 状态（WsRefTokenMap）+ onWsRefTokensChange 受控回传（producer=输入区，组装位经父级消费）；token 分配用 allocateWsRefToken，poolTokens 取附件 token ∪ 工作区 token ∪ 正文手打【…】保守占位（对齐 group-chat-panel.tsx:1924-1931 附件 inText 并集先例）
  - 消费 task-06 下发的 pendingWsRefInsert 槽位（effect 依赖 nonce 而非 desc 引用相等，同引用可重复触发）：分配/复用 token 后经 groupLastCaretRef 失焦光标机制插入光标处，完成后上抛 onPendingWsRefInsertHandled(null)
  - 输入区 InputRefOverlay（group-chat-panel.tsx:3043）tokens 并入工作区 token，并传 task-04 tokenMetas（kind+title 元数据）渲染左上类型角标与悬停 tooltip；退格整删与 × 角标对附件/工作区 token 一视同仁，删附件 chip 联动（group-chat-panel.tsx:1906）只剥附件 token 不误删工作区 token
  - 组装位 group-chat-panel.tsx:1969 在 substituteAttRefsForSend 同点位串联 substituteWsRefsForSend（两张 map 并查），落码前 grep substituteAttRefsForSend 重盘核对行号（D-008@v2）
  - 气泡历史渲染两分支（group-chat-panel.tsx:3427 与 3484）检测函数换 parseInlineRefs，命中三类标记走 InlineAttRefTextWithPreview 标签渲染，无引用消息仍走 renderMentionHighlights 原路径零变化
  - 用例：pendingWsRefInsert 消费插入/退格整删/删附件不误剥工作区 token/发送置换三类标记/历史气泡三类标签（既有附件用例扩展同步）
acceptance:
  - group-chat-panel.test.tsx 全绿，覆盖群聊端到端（插入→角标与 tooltip→发送置换→历史标签）
  - 未插入任何工作区引用时群聊输入/发送/历史渲染与现状零差异（brownfield 回退）
verify:
  - cd frontend && pnpm exec vitest run src/components/group-chat/__tests__/group-chat-panel.test.tsx
constraints:
  - 本变更前历史消息渲染逐字不变；未插入引用零行为差异；孤儿 token 原样保留
  - 镜像高亮层背景块严禁 margin/padding/border，角标 absolute 不进文本流；品牌色一律 brand-* 语义阶；文案中文；后端零改动（引用随正文透传）
  - 组装位以 grep substituteAttRefsForSend 实测现状为准，落码前重盘；历史检测随 task-01 契约（空 path 根目录容忍与非法字符降级同口径）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
