---
id: task-05
title: session-panel-mention-wiring
title_zh: 会话面板联想接线——浮层回传、placeholder 文案与七处发送组装
author: qinyi
created_at: 2026-08-26 23:43:50
priority: P0
depends_on: [task-03, task-08]
blocks: []
requirement_ids: [FR-05, FR-06, FR-08]
decision_ids: [D-002, D-003]
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/__tests__/session-panel-team.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-prompt.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-dialog-changeid.test.tsx
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
expects_from:
  task-03:
    - contract: onMentionsChange
      needs: [change, quick]
  task-08:
    - contract: SessionInjectOptions
      needs: [bind_change_key, bind_quick_id]
goal: >
  SessionPanel 三个 SessionInputBar 渲染点接 onMentionsChange 并更新 placeholder 提示文案，
  七个发送组装点位按预会话 create 与真会话 inject 两通道携带绑定字段，发送成功清 pendingMentions。
implementation:
  - page 与 dialog 各自持有 pendingMentions（change/quick 两槽位、同类型后选覆盖）；三个渲染点（page 预会话 :2202 / page 真会话 :2571 / dialog :4169）传 onMentionsChange，三处 placeholder 传参追加「/ 唤起技能 · @ 关联变更」提示（FR-08）
  - createSession 两点位——page 预会话 handlePreSessionSend :1719 与 dialog :3635，pendingMentions 展开为 change_id / quicklog_id 随首句上送（FR-05 既有契约；dialog 与既有 changeId prop 合并语义不互相覆盖）
  - injectSession 四点位带 bind_change_key / bind_quick_id——page sendFromQueue :1546、page sendToServerQueue :1612、dialog submitFollowup :3428（dialog 重发复用一并生效）、dialog sendToServerQueue :3496（dialog 忙轮，漏改则 FR-06 该场景静默失效）
  - page 重发 :1952 不携带 mentions（R-7 取舍，@ 文本保留提示重选）；无选中时 bind 字段缺省不进请求体保后端零行为差异；发送成功后清 pendingMentions（与 clearAttachments 同时机），草稿持久化不存 mentions
  - 同步更新受文案影响的 session-panel-* placeholder 既有断言，回归 /team 拦截/剥离、附件、草稿用例
acceptance:
  - 预会话请求体含 change_id 或 quicklog_id；真会话四个 inject 点位含 bind_change_key 或 bind_quick_id，page 与 dialog 忙轮路径均覆盖
  - page 重发链路不带 bind 字段；无 mentions 时请求体与现状逐字段一致（零回归）
  - 三处 placeholder 均含新提示文案；/team、附件、草稿既有用例全部通过
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-panel-pre-session.test.tsx src/components/daemon/__tests__/session-panel-dialog.test.tsx src/components/daemon/__tests__/session-panel-team.test.tsx src/components/daemon/__tests__/session-panel-prompt.test.tsx src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx src/components/daemon/__tests__/session-panel-dialog-changeid.test.tsx
constraints:
  - /team 整条拦截与 team popover 互斥零改动；消息模型、渲染协议、附件流、高度拖拽不触碰
  - 草稿不持久化 pendingMentions；page 重发明确不带 mentions（R-7 已声明取舍）
related_tests:
  - path: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
    reason: 门户页级渲染 SessionPanel，2 处追问态 placeholder 精确断言随文案更新（task-09 全量回归时发现，Plan Review 相关测试清单遗漏此文件）
  - path: frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx
    reason: 预会话 placeholder 14 处 getByPlaceholderText 断言随文案更新
  - path: frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx
    reason: dialog placeholder 48 处断言随文案更新
  - path: frontend/src/components/daemon/__tests__/session-panel-team.test.tsx
    reason: /team 行为零回归守护兼 placeholder 6 处断言更新
  - path: frontend/src/components/daemon/__tests__/session-panel-prompt.test.tsx
    reason: 追问 placeholder 场景回归守护（无文案断言，仅回归）
  - path: frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx
    reason: 附件流回归兼 placeholder 4 处断言更新
  - path: frontend/src/components/daemon/__tests__/session-panel-dialog-changeid.test.tsx
    reason: changeId 绑定语义回归兼 placeholder 2 处断言更新
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
