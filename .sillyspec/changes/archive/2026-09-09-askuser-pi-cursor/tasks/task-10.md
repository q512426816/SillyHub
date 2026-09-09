---
id: task-10
title: 'askuser-dialog-card-group-enhance'
title_zh: 'AskUserDialogCard 群聊推荐条 + 已答关闭态实际答题人 + 单测'
author: 'qinyi'
created_at: 2026-09-09 23:09:21
priority: P1
depends_on: ['task-09']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-004@v2]
allowed_paths:
  - frontend/src/components/ask-user-dialog-card.tsx
  - frontend/src/components/ask-user-dialog-card.test.tsx
target_files:
  - frontend/src/components/ask-user-dialog-card.tsx
  - frontend/src/components/ask-user-dialog-card.test.tsx
provides:
  - contract: ask_user_dialog_card_groupchat
    fields: [recommendResponders_bar, answered_by_close_state]
expects_from:
  task-09:
    - contract: shadow_dialog_answer
      needs: [answered_by_actual_user]
related_tests:
  - frontend/src/components/ask-user-dialog-card.test.tsx
goal: >
  AskUserDialogCard 群聊增强：渲染 agent 推荐回答人软提示条（dialog_payload.recommendResponders）与已答关闭态实际答题人名，支撑群聊先到先得语义（后答者可见已被谁回答）。
implementation:
  - '推荐条：解析 dialog_payload.recommendResponders（string[]，daemon 端头平铺透传、dialog_payload 自由 JSON 无 schema 变更），非空时在问题区上方渲染「💡 推荐 @xx 回答」条（视觉对齐原型场景二 .ask-recommend 浅青虚线描边）；仅软提示不做答题门控'
  - '已答关闭态：卡片 resolved/answered 展示态显示实际答题人（「✓ ×× 已回答，本题已关闭」，视觉对齐原型 .answered-strip/.takenover-strip）；答题人标识消费 task-09 契约（SSE permission_resolved / dialogs_history），缺失时降级为现有文案不显示人名'
  - 适配 ask-user-dialog-card.test.tsx 既有断言并新增用例：推荐条渲染 / 无 recommendResponders 零变化 / 已答关闭态人名 / 答题人数据缺失降级
acceptance:
  - dialog_payload 带 recommendResponders 渲染推荐 @条；不带时卡片渲染零变化（单聊回归无影响）
  - 已答关闭态显示实际答题人名，数据缺失降级不崩
  - ask-user-dialog-card.test.tsx 全绿
verify:
  - cd frontend && pnpm vitest run src/components/ask-user-dialog-card.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改提交协议（respondSessionPermission 调用与 dialog_result 结构零变化）；推荐人仅展示层软提示不门控（D-004@v2）
  - 群聊聚合挂载/成员来源标注/409 关闭态流转归 task-11，本任务只改本组件与其测试
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
