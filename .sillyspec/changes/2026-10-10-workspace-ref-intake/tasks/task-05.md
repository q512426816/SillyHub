---
id: task-05
title: 'wire-wsref-tokens-into-session-input-bar'
title_zh: 'SessionInputBar 工作区引用接入——wsRefTokens 状态/槽位消费/删附件联动隔离'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 13:48:40
priority: P0
depends_on: [task-01, task-04]
blocks: []
requirement_ids: [FR-02, FR-08]
decision_ids: [D-005, D-009]
allowed_paths:
  - frontend/src/components/daemon/session-input-bar.tsx
  - frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
target_files:
  - frontend/src/components/daemon/session-input-bar.tsx
  - frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
expects_from:
  task-01:
    - contract: WsRefDesc
      needs: [kind, workspaceId, path, name, lines]
    - contract: buildWsRefToken
      needs: [name, lines, seq]
    - contract: allocateWsRefToken
      needs: [base, poolTokens]
  task-04:
    - contract: InputRefOverlayTokenMetas
      needs: [kind, title]
  task-06:
    - contract: PendingWsRefInsertSlot
      needs: [desc, nonce]
related_tests:
  - frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
goal: >
  单聊（含预会话）输入区接入工作区引用标签（FR-02 单聊侧）——新增 wsRefTokens
  状态与 onWsRefTokensChange 受控回传、effect 消费 pendingWsRefInsert 槽位于
  光标处插入标签、删附件联动只剥附件 token 不误伤工作区 token。
implementation:
  - frontend/src/components/daemon/session-input-bar.tsx:285-289 旁新增 wsRefTokens 状态（WsRefTokenMap）与 syncWsRefTokens 受控回传 onWsRefTokensChange（同 syncTokenMap 模式，D-009）；props 增 pendingWsRefInsert 与 onPendingWsRefInsertHandled（契约见 design 接口定义）
  - effect 依赖 nonce 消费槽位（同引用可重复触发）——按 key=path（code 追加行号段）查映射复用或新分配；分配池=附件 token ∪ 工作区 token ∪ 正文 inText 三者并集（对齐 session-input-bar.tsx:297-303 附件 allocateAttRefToken 既有口径，审查 requiredEvidence X-1），token 经 task-01 的 buildWsRefToken/allocateWsRefToken 生成
  - 插入复用 handleInsertAttRef（session-input-bar.tsx:294-316）的 lastCaretRef/pendingCaretRef 机制（聚焦插当前光标、失焦插失焦前光标位、从未聚焦插末尾），消费后回调 onPendingWsRefInsertHandled 清槽
  - 退格贴尾整删（session-input-bar.tsx:1024-1047）与 × 角标删除的 token 匹配集从附件池扩为附件∪工作区并集（最长匹配优先不变）；overlay（session-input-bar.tsx:951-959）tokens 同步两池并集并按 task-04 契约传 tokenMetas（附件 att 与工作区 file/dir/code 各 kind）
  - 删附件联动（session-input-bar.tsx:677-696）维持只精确剥该附件自身 token，不误删工作区 token；外部清空归零（session-input-bar.tsx:555-573）与发送清空（session-input-bar.tsx:641-646）同步清 wsRefTokens 防陈旧槽位跨消息泄漏
  - 扩展 session-input-bar-upload.test.tsx 既有附件用例并新增用例——槽位插入（含 nonce 重复触发）、并集同名 ·2、退格整删工作区标签、删附件后工作区 token 原样保留
acceptance:
  - pendingWsRefInsert 槽位（nonce 自增）在光标处插入【名称】/【名称:起-止】标签，同一引用连续添加可重复触发且消费后槽位清空
  - 同名唯一化跨池生效——附件 token/工作区 token/正文手打【…】并集池内完全同名才加 ·2（D-005）
  - 删附件 chip 只剥该附件 token，正文工作区 token 原样保留；退格贴尾一次整删两池标签
  - 未插入任何工作区引用时输入区行为与现状零差异；wsRefTokens 随 onWsRefTokensChange 受控回传供组装位消费
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改 input-ref-overlay.tsx 与 frontend/src/lib/attachment-refs.ts（task-01/task-04 范围），只消费其契约；群聊侧同款接入归 task-08
  - 分配池必须并入正文 inText 保守占位（X-1 审查证据），两池共用 allocateWsRefToken 单一入口
  - 品牌色 brand-* 语义阶、文案中文；孤儿 token 原样保留；后端 0 端点
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
