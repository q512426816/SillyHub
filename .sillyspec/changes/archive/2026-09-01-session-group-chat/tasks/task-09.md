---
id: task-09
title: 'member panel and at-mention autocomplete'
title_zh: '成员面板与@补全'
author: 'qinyi'
created_at: 2026-09-02 00:35:00
priority: P1
depends_on: ['task-02', 'task-07']
blocks: []
requirement_ids: [FR-14, FR-15]
decision_ids: []
allowed_paths:
  - frontend/src/components/group-chat/member-panel.tsx
  - frontend/src/components/group-chat/
  - frontend/src/components/daemon/session-mention-popover.tsx
  - frontend/src/components/daemon/__tests__/
  - frontend/src/components/group-chat/__tests__/
expects_from:
  task-02:
    - contract: /api/group-chats CRUD 端点与 GroupChatRead/GroupMemberRead DTO
      needs: [members, online_member_ids, display_name, shadow_status, reset-memory 端点]
  task-07:
    - contract: 群聊 API 客户端与群分区入口
      needs: ['listGroupChats 与 createGroupChat 等 /api/group-chats 客户端函数', '群行渲染数据结构（成员摘要 chips/最后消息摘要/在线成员）']
goal: >
  成员面板（用户成员在线/移除 + agent 成员六要素卡片/热切换弹窗/重置记忆）
  与 session-mention-popover 的 member 判别联合扩展（@补全），落地 FR-14/15。
implementation:
  - "新建 member-panel.tsx 右抽屉——用户成员行（头像+昵称+在线绿点由 online_member_ids 驱动、离线灰点；群主可移除调 DELETE 成员端点）；agent 成员卡片六要素展示（昵称/机器/工作区/引擎/模型/方案+影子状态徽标，对照原型 .member-row/.agent-card/.ac-kv/.online-dot）"
  - "agent 成员「切换配置」热切换弹窗——引擎/模型/方案/机器/工作区可改（提示下轮生效），机器或工作区变更弹二次确认提示记忆重置，提交调 PATCH 成员端点；「重置记忆」按钮经群 API 客户端调对应端点"
  - "session-mention-popover.tsx 判别联合加 member kind（数据源=群成员 agent+用户与 @全体 常量条目）——SessionMentionItem/mentionMatchTexts/mentionOptionTexts/GROUP_LABELS 补 member 分支与中文分组标签；过滤与键盘复用既有 filterMentionItems/handleMentionKeyDown 单一源"
  - "member 补全供 group-chat-panel 输入框消费（挂载接线归 task-08）——选择回填 @昵称 纯文本，键盘上下选择/回车回填与既有数学一致"
  - "自带 vitest——member-panel（分组渲染/在线态/热切换提交与记忆重置二次确认）与 session-mention-popover（member 过滤/分组/回填，既有 kind 零回归）"
acceptance:
  - "成员面板按用户/agent 正确分组渲染，在线绿点随 online_member_ids 变化；移除/热切换/重置记忆操作经对应端点生效"
  - "机器或工作区切换出现记忆重置二次确认；热切换弹窗提交调 PATCH 成员端点"
  - "member 补全弹层过滤与回填正确（含 @全体、回填纯文本昵称）；既有 mention 其他 kind 行为零回归；双主题正常"
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- member-panel session-mention-popover
constraints:
  - "回填纯文本 @昵称（@路由在后端解析，前端不做成员绑定字段）；不改既有 mention 判别联合其他 kind 的过滤/分组/渲染行为（只加 member 分支）"
  - "端点调用一律走 task-07 群 API 客户端；member-panel 为独立组件由 task-08 群聊面板挂载（Wave 序本卡在前，不与 task-08 文件冲突）"
  - "UI 中文；双主题遵守 AI-Native 铁律（brand-* 语义阶/themes.ts 单源/shadow token）"
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
