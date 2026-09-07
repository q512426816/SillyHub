---
id: task-08
title: 'scheduled-send-ui'
title_zh: '定时发送 UI（输入栏 ⏰ 按钮+定时弹窗+use-scheduled-messages hook+ScheduledMessagesBar 双挂载）'
author: 'qinyi'
created_at: 2026-09-07 23:32:39
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-04, FR-05]
decision_ids: [D-001@v1, D-002@v1]
expects_from:
  task-05:
    - createScheduledMessage
    - listScheduledMessages
    - cancelScheduledMessage
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/session-input-bar.tsx
  - frontend/src/components/daemon/scheduled-messages-bar.tsx
  - frontend/src/hooks/use-scheduled-messages.ts
target_files:
  - NEW:frontend/src/components/daemon/scheduled-messages-bar.tsx
  - NEW:frontend/src/hooks/use-scheduled-messages.ts
goal: >
  会话聊天加定时发送 UI——输入栏 ⏰ 入口 + antd 定时弹窗（分钟级 + 快捷项）、
  use-scheduled-messages hook 与 ScheduledMessagesBar 双挂载（page/dialog 两模式），覆盖一次性定时消息创建、查看、取消全链路。
implementation:
  - 新建 hooks/use-scheduled-messages.ts——react-query useQuery（queryKey [agentSessions, scheduled, sessionId]，listScheduledMessages 供数，refetchInterval 30s）+ 创建/取消后 invalidate；sessionId 空不启用
  - 新建 scheduled-messages-bar.tsx——纯展示条（照 MessageQueueBar 形态）——每条 dispatch_at + prompt 摘要 + 状态 tag（pending 黄/dispatched 绿/cancelled 灰/failed 红，failed 悬停显 error_message）+ pending 条目 X 取消；空列表返回 null 不占位
  - session-input-bar.tsx——SessionInputBarProps 加可选 onSchedule；发送按钮左侧 ⏰ 按钮（Clock 图标 hover brand），未传不渲染，仅已有 sessionId 的会话显示（预会话 idle 态不渲染入口）
  - session-panel.tsx 双点接线——page 模式与 dialog 模式 MessageQueueBar 邻位各挂 ScheduledMessagesBar（sessionId key 隔离不串数据，Grill B-05）；onSchedule 开 antd Modal——草稿预览 + DatePicker 分钟粒度 + 快捷项（30 分钟后/1 小时后/明早 9 点）+ 确认 createScheduledMessage 成功后清草稿并在聊天流插系统提示行；样式全走 brand-*/muted/destructive 语义阶（双主题铁律）
acceptance:
  - pnpm exec tsc --noEmit 零错误；空定时列表零布局变化（bar 返回 null）
  - page 与 dialog 两模式均渲染定时条，创建成功后草稿清空、系统提示行插入、条目立即出现
  - pending 可取消（确认后调 DELETE 并 invalidate），failed 条目可见失败原因
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - session-panel 文件头 R4 不变式——dialog 渲染路径零 useQuery/useQueryClient（弹窗测试无 QueryClientProvider）；ScheduledMessagesBar 不依赖外层 Provider，组件内自建本地 QueryClientProvider 包数据子树，创建/取消失效走该本地 client
  - 不改 MessageQueueBar 本体与后端；不做定时条目编辑（仅取消重建，非目标）；不改既有测试（新用例归 task-09）
  - dispatch_at ≥ now+60s 校验由后端兜底，前端 DatePicker 禁选过去时间即可
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
