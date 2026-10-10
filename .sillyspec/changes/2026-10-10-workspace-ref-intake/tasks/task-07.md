---
id: task-07
title: 'chain-wsref-substitution-at-assembly-sites'
title_zh: '组装位置换接线——grep 重盘后同点位串联（page/dialog 六处，group 归 task-08）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 13:48:40
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-003, D-004, D-008]
allowed_paths:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
target_files:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
expects_from:
  task-01:
    - contract: substituteWsRefsForSend
      needs: [value, map]
    - contract: WsRefTokenMap
      needs: [desc, token]
  task-06:
    - contract: PendingWsRefInsertSlot
      needs: [desc, nonce]
goal: >
  单聊/预会话六个发送组装位接入工作区引用置换（FR-06；D-008@v2）——先 grep
  substituteAttRefsForSend 重盘核对现状，再同点位串联 substituteWsRefsForSend
  （附件/工作区两张 map 并查），并把 pendingWsRefInsert 槽位从面板透传到
  SessionInputBar。
implementation:
  - 第一步 grep substituteAttRefsForSend 重盘核对（2026-10-10 实测 7 处——session-panel-dialog.tsx:312/392/1343、session-panel-page.tsx:835/2748/3258、group-chat-panel.tsx:1969 归 task-08）；落码时以 grep 现状为准，点位漂移即先更新本卡与审查记录再接线
  - session-panel-page.tsx:755 与 session-panel-dialog.tsx:193 旁新增 wsRefTokens 状态（WsRefTokenMap）；SessionInputBar 组装位（session-panel-page.tsx:3850 与 :4933、session-panel-dialog.tsx:2153）挂 onWsRefTokensChange={setWsRefTokens}（同既有 onAttTokenMapChange 的 session-panel-page.tsx:3860/:4950、session-panel-dialog.tsx:2165 模式）
  - 六处同点位串联——定时 confirmSchedCreate（session-panel-page.tsx:835、session-panel-dialog.tsx:312）、onSendSettled 草稿同文比对（session-panel-page.tsx:2748、session-panel-dialog.tsx:392）、handleSend（session-panel-page.tsx:3258、session-panel-dialog.tsx:1343）均先附件置换再 substituteWsRefsForSend 工作区置换；wsRefTokens 空时原样返回零开销旁路，守卫/长度口径仍用 rawPrompt 原文
  - 面板透传 pendingWsRefInsert prop 到输入区（契约见 design 接口定义）——page/dialog props 增槽位并下传 SessionInputBar；portal 侧槽位下发归 task-06
  - grep 盘点记录核对——substituteAttRefsForSend 全部点位与本卡串联点一一对应（group-chat-panel.tsx:1969 分工归 task-08）
acceptance:
  - 六处组装位发送文本均完成附件+工作区双重置换，token 置换为 [文件引用/目录引用/代码引用] 标记（D-003 只含工作区 id、路径与行号，D-004 文本协议）
  - wsRefTokens 空时输出逐字等于现状——未插入引用的既有发送行为零差异；孤儿 token（映射不命中）原样保留
  - page/dialog 的 SessionInputBar 均回传 wsRefTokens；page 透传 pendingWsRefInsert 槽位 prop 到输入区
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend 目录内 grep -rn substituteAttRefsForSend src --include=*.tsx --include=*.ts 盘点输出与卡内点位一一对应
constraints:
  - 置换正确性由 task-01 纯函数单测覆盖，接线冒烟由 task-06 sessions-portal.test 端到端覆盖，本卡不新增测试文件
  - 面板透传 pendingWsRefInsert prop 到输入区（契约见 design 接口定义）
  - 只在 substituteAttRefsForSend 同点位串联，不重构发送链路；group-chat-panel.tsx:1969 归 task-08，本卡不碰群聊文件
  - 孤儿 token 原样保留；未插入引用零行为差异；文案中文；后端 0 端点
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
