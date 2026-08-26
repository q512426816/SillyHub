---
id: task-03
title: session-input-bar-mention-integration
title_zh: 会话输入框接入联想——检测驱动浮层、IME 保护与光标回填
author: qinyi
created_at: 2026-08-26 23:43:50
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-08]
decision_ids: [D-002]
allowed_paths:
  - frontend/src/components/daemon/session-input-bar.tsx
  - frontend/src/components/daemon/__tests__/session-input-bar-mention.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx
  - frontend/src/components/daemon/__tests__/session-input-bar-height.test.tsx
provides:
  - contract: onMentionsChange
    fields: [change, quick]
expects_from:
  task-01:
    - contract: MentionDetection
      needs: [trigger, query, start]
    - contract: applyMentionPick
      needs: [value, caret]
  task-02:
    - contract: SessionMentionPopover
      needs: [onSelect]
goal: >
  在 SessionInputBar 内打通联想接入——onChange 读 selectionStart 调 detectMention 驱动浮层、
  IME 组合保护、选中按 invoke_name ?? name 回填并延迟复位光标，经 onMentionsChange 回传
  结构化选中（change/quick 两槽位、同类型后选覆盖先选），placeholder prop 保持父级传入不动。
implementation:
  - 新增可选 prop onMentionsChange；onChange 内读 e.target.selectionStart 调 detectMention（task-01），命中则渲染 SessionMentionPopover（task-02）并随 query 过滤，查询串含空白或输入清空即关层
  - compositionstart 置 ref 标记——组合期跳过检测与 Enter/Tab 拦截，compositionend 后对最终文本重检（中文拼音含 / 或 @ 不误触）
  - onKeyDown 首位接浮层键盘——浮层激活时 Enter/Tab 选中高亮项且不触发 onSend、Esc 关层；未激活时 Enter 发送与 Shift+Enter 换行原语义不变
  - 选中回填——技能回填名取 invoke_name ?? name，@ 回填 change_key 或 ql_id，均后随空格；组装新文本调 onChange 后记 pendingCaretRef，useEffect 内经 textareaRef.current.setSelectionRange 延迟复位光标（同步调用会被受控 value 的 DOM 更新覆盖，仓库首例模式）
  - 新建 __tests__/session-input-bar-mention.test.tsx——Enter 拦截/放行边界、IME 组合期行为、回填文本与光标位置断言；回归 turn-timeline-session-input-bar 与 session-input-bar-height
acceptance:
  - 浮层激活时 Enter 选中高亮项且 onSend 不被触发；浮层未激活时 Enter/Shift+Enter 行为与现状一致
  - IME 组合期不弹层不拦截，compositionend 后按最终文本重检
  - 选中后回填为 /回填名+空格 或 @自然键+空格，jsdom 用例断言回填后光标位置
  - placeholder prop 透传不变，turn-timeline 既有 6 处 getByPlaceholderText 断言零修改通过
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-input-bar-mention.test.tsx src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx src/components/daemon/__tests__/session-input-bar-height.test.tsx
constraints:
  - 不改 placeholder prop 与父级 SessionPanel（文案更新与接线归 task-05）；不触碰附件流、高度拖拽、发送守卫既有契约
  - 回填名计算收敛在本组件（task-02 浮层只抛原始实体不读 invoke_name）；不新增网络请求
related_tests:
  - path: frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx
    reason: placeholder 精确断言 6 处，placeholder prop 不动以保零破坏
  - path: frontend/src/components/daemon/__tests__/session-input-bar-height.test.tsx
    reason: 高度拖拽与 textarea 布局契约回归守护
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
