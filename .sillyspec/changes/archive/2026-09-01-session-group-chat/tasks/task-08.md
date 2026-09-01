---
id: task-08
title: 'group chat panel with flat timeline'
title_zh: '群聊面板——平铺时间线与流式消费'
author: 'qinyi'
created_at: 2026-09-02 00:35:00
priority: P0
depends_on: ['task-05', 'task-06', 'task-07']
blocks: []
requirement_ids: [FR-05, FR-09, FR-12, FR-13]
decision_ids: [D-011]
allowed_paths:
  - frontend/src/components/group-chat/group-chat-panel.tsx
  - frontend/src/components/group-chat/
  - frontend/src/lib/daemon.ts
  - frontend/src/components/group-chat/__tests__/
provides:
  - contract: 群聊面板组件
    fields:
      - 'group-chat-panel 入口 props（群详情/成员摘要/选中挂载点消费）'
      - '平铺消息流渲染（时间线/成员身份气泡/typing 指示器）'
      - '成员面板右抽屉挂载点（消费 task-09 member-panel）'
expects_from:
  task-05:
    - contract: 群频道 SSE 事件契约
      needs: [member_id, member_name, member_session_id, sender_member_name, projection_log_id]
  task-06:
    - contract: typing SSE 事件流与 presence
      needs: ['typing 事件 payload member_name/preview', online_member_ids]
  task-07:
    - contract: 群聊 API 客户端与群分区入口
      needs: ['listGroupChats 与 createGroupChat 等 /api/group-chats 客户端函数', '群分区选中挂载点（供 task-08 群聊面板接入）']
goal: >
  新建 group-chat-panel 组件——平铺消息流（实时事件与回放读库统一按 log
  timestamp 全局排序、忽略 run 分组）、成员身份气泡与 SSE 消费（typing 分支
  与断线 resync），落地 FR-05/09/12/13 前端面。
implementation:
  - "新建 group-chat-panel.tsx——顶栏群名+成员头像堆叠（facepile +N）+成员面板开关（member-panel 本体归 task-09，本卡留右抽屉挂载点）；装配复用 session-log-assembler 分类原语但忽略 run 分组——实时事件与回放读库共用同一排序函数按 timestamp 全局平铺（D-011）"
  - "气泡渲染——user_input 行按 sender_member_name 渲染用户气泡（当前用户 self 右侧样式）；投影行按 metadata 的 member_id/member_name 还原身份渲染 agent 气泡（头像+昵称+引擎/模型标签+流式光标，member_id 分色分组）；系统事件居中；@提及文本高亮可点击（对照原型 .msg/.mention/.cursor-blink）"
  - "lib/daemon.ts 群流 SSE 消费——照 streamSession 的 fetchSse 模式订阅群会话流（复用 RECONNECT_BACKOFF_MS 退避档位与 onmessage dispatch 骨架、独立函数不动单聊路径），log/turn_completed/typing 三类事件分支；seenLogIds 以投影行 id 去重；断线退避重连后 resync 走 getAgentSessionLogs 增量拉取（after=lastLogTs-2s 重叠窗口）补缺口并按时间轴归并"
  - "输入区——发送走群消息端点（POST 经 task-07 群客户端）；typing 上报 250ms 节流（preview ≤400 字）；输入框上方 typing 指示气泡（成员昵称+三点动画，agent typing 显示「昵称」正在输入，TTL 2.5s 过期自动消失）"
  - "自带 vitest（group-chat/__tests__/）——实时与回放排序一致性（多成员交错 timestamp 归并、投影行 id 去重）、身份分组渲染（sender_member_name 与投影 metadata）、typing 渲染与 TTL 过期"
acceptance:
  - "多成员消息流按全局 timestamp 正确交错分组；刷新后回放与实时的顺序、身份一致（投影行 metadata 还原昵称头像）"
  - "断线重连 resync 不丢行不错序；typing 气泡正常出现/消失（agent typing 显示成员昵称）"
  - "@提及高亮与发送链路可用；tsc 与组件测试零错误"
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- group-chat-panel
constraints:
  - "不复用 session-panel 单 currentRunId 状态机（多成员并行 turn 破坏其前提）；群视图不消费 run 分组装配与 run 列表视图"
  - "typing 草稿不落库不进 AI 上下文（仅前端心跳上报与渲染）"
  - "不改单聊 streamSession 既有行为（群流消费独立实现，共享常量仅 import）；UI 中文"
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
