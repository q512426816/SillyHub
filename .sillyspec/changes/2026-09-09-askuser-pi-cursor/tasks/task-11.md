---
id: task-11
title: 'aggregate member ask-user cards into group chat timeline'
title_zh: '群聊聚合渲染（成员 pending 原生卡 + marker 卡 + 先到先得关闭态 + 成员来源标注）+ 单测'
author: 'qinyi'
created_at: 2026-09-09 23:09:21
priority: P0
depends_on: ['task-07', 'task-09', 'task-10']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-004@v2]
allowed_paths:
  - frontend/src/components/group-chat/group-chat-panel.tsx
  - frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  - frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx
  - frontend/src/lib/daemon/session-sse.ts
  - frontend/src/lib/daemon/sessions.ts
target_files:
  - frontend/src/components/group-chat/group-chat-panel.tsx
  - frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  - NEW:frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx
goal: >
  群聊面板聚合呈现成员 agent 的提问（FR-05）：agent 成员影子会话 pending 原生卡与
  cursor 标记卡嵌入群消息流，任何群成员先到先得作答，后答者见「已被 ×× 回答」
  关闭态，卡片标注来源成员并渲染推荐回答人条。
expects_from:
  task-06:
    - contract: parseAskUserMarker
      needs: [parseAskUserMarker]
  task-09:
    - contract: shadow_dialog_answer
      needs: [shadow_member_answer_allowed, answered_by_actual_user]
  task-10:
    - contract: ask_user_dialog_card_groupchat
      needs: [recommendResponders_bar, answered_by_close_state]
implementation:
  - group-chat-panel.tsx 聚合成员 pending 原生提问：getGroupChat 详情的 agent 成员（shadow_session_id 非空，≤5）随既有刷新节拍并行 fetchPendingDialogs（lib/daemon/sessions.ts:157 既有端点），pending 卡复用 AskUserDialogCard 嵌入消息流末尾，卡头标注来源成员（头像/昵称，成员数据对齐 member-panel 影子会话来源口径）
  - 群消息行 marker 卡：投影 agent 气泡文本段复用 parseAskUserMarker（task-06）命中处渲染 AskUserMarkerCard 并隐藏标记原文（对齐 task-07 turn-timeline 接入形态）；marker 型作答走既有 sendGroupMessage 链路（发消息即答案，天然先到先得，无后端事件）
  - 先到先得关闭态：答题提交成功或收到 permission_resolved SSE（或重拉见 409 已答）后渲染「已被 ×× 回答」关闭态；实际答题人名消费 task-09 answered_by 实际答题人数据 + task-10 已答关闭态展示
  - 推荐条与单测：群聊 pending 卡透传 dialog_payload.recommendResponders 渲染「推荐 @xx 回答」条（task-10 卡内能力）；NEW group-askuser-aggregate.test.tsx 覆盖聚合卡渲染/来源标注/推荐条/已被回答态/成员提交作答；group-chat-panel.test.tsx（2661 行）既有断言适配
acceptance:
  - 群聊消息流内可见成员 agent 的 pending 原生提问卡（带来源成员标注与推荐回答人条），群成员身份可直接提交作答（影子会话答题授权已由 task-09 放开）
  - 先到者作答后，后答者见到「已被 ×× 回答」关闭态而非可提交表单（幂等，R-03 前端不新增锁）
  - cursor 标记提问在群消息流内渲染为 marker 卡，提交答案即发送群消息（无后端 dialog 事件）
  - group-chat 系列既有测试（含 group-chat-panel.test.tsx 适配后）与新增聚合测试全绿
verify:
  - cd frontend && pnpm vitest run src/components/group-chat
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 复用 AskUserDialogCard / AskUserMarkerCard / parseAskUserMarker，不在群聊内再造卡片（D-007 无新抽象层）
  - 成员 pending 拉取仅限 agent 成员（≤5）且复用既有刷新节拍，不新建轮询通道、不改后端接口
  - 不改 sortGroupTimeline / applyGroupTimelineEvent 排序与去重行为；普通群消息渲染零回归
  - spike no-go（cursor 降级）时 marker 卡自然不渲染——解析不命中即普通文本，无需配置开关
related_tests:
  - frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx（面板新增聚合渲染分支与查询 mock 后，2661 行既有断言需同步适配）
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
