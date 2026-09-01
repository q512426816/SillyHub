---
id: task-07
title: 'group chat list section and creation wizard'
title_zh: '前端群列表分区与建群向导'
author: 'qinyi'
created_at: 2026-09-02 00:35:00
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: []
allowed_paths:
  - frontend/src/components/sessions/sessions-portal.tsx
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/group-chat/create-group-wizard.tsx
  - frontend/src/components/group-chat/
  - frontend/src/lib/daemon.ts
  - frontend/src/components/sessions/__tests__/
provides:
  - contract: 群聊 API 客户端与群分区入口
    fields:
      - 'listGroupChats 与 createGroupChat 等 /api/group-chats 客户端函数'
      - '群行渲染数据结构（成员摘要 chips/最后消息摘要/在线成员）'
      - '群分区选中挂载点（供 task-08 群聊面板接入）'
expects_from:
  task-01:
    - contract: AgentGroupChat/AgentGroupMember 模型与群 DTO
      needs: [session_kind, display_name, provider, llm_provider_id, agent_profile_id, runtime_id, workspace_id]
  task-02:
    - contract: /api/group-chats CRUD 端点与 GroupChatRead/GroupMemberRead DTO
      needs: [id, title, members, agent_cross_mention, online_member_ids]
goal: >
  会话门户（workspace 会话页与全局 /sessions）新增群聊分区——数据统一由
  GET /api/group-chats 供数（list_agent_sessions 不可用），并交付三步建群向导
  （群名→邀用户→配 agent 成员六要素）与 lib/daemon.ts 群聊 API 客户端。
implementation:
  - "lib/daemon.ts 照 apiFetch 既有模式新增群聊 API 客户端——listGroupChats/createGroupChat/getGroupChat/updateGroupChat/endGroupChat 与成员增改删调用，类型一律 import task-01 生成的 api-types 群 DTO（禁手写）"
  - "session-list-panel.tsx 照 TOOL_REPORT_SECTION_KEY 分桶先例加群聊分区——独立 useQuery（listGroupChats）供数、不掺单聊 agentSessions 数据源；群行含群头像、成员头像堆叠预览（facepile +N）与最后消息摘要（对照原型 .sess-item/.tag-group）；workspace scope 与全局门户同款生效"
  - "sessions-portal.tsx 挂群分区入口——分区头「＋」开向导、群行选中态与右侧群视图挂载点（面板本体归 task-08）；群列表随建群成功与 agent_sessions 变更信号 invalidate 刷新"
  - "新建 create-group-wizard.tsx 三步向导对话框——①群名与 workspace（workspace scope 锁定、全局可选）②邀请用户多选（workspace 成员列表，上限 50）③agent 成员卡片可增删（六要素下拉——昵称/机器/工作区/引擎/模型/方案，昵称与已配成员重复即时校验，上限 8）；完成调 createGroupChat 后刷新群列表并选中新群"
  - "样式遵守 AI-Native 双主题铁律（brand-* 语义阶/themes.ts 单源/shadow token），对照原型 prototype-group-chat.html；自带 vitest 组件测试（group-chat/__tests__/ 向导用例 + sessions/__tests__/ 既有面板用例回归）"
acceptance:
  - "群分区出现在 workspace 会话页与全局会话页（/api/group-chats 供数），单聊列表数据源与既有行为零回归"
  - "向导三步可完成建群且新群出现在群分区；六要素表单校验生效（昵称重复即时报错、agent 8/用户 50 上限拦截）"
  - "双主题（ai-native/blue）下群分区与向导渲染正常"
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- create-group-wizard sessions-portal session-list-panel
constraints:
  - "群列表只用 GET /api/group-chats 供数（list_agent_sessions 按请求者 user_id 过滤，非群主成员不可见）；群行不掺入单聊列表数据源"
  - "不改单聊列表与既有建会话入口（组头「＋」两步浮层）行为；UI 文案中文"
  - "类型一律消费 api-types 生成物禁手写（DTO 变更与 gen:types 产物提交归 task-01）"
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
