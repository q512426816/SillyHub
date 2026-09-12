---
id: task-02
title: 'input height drag pointer events'
title_zh: '拖拽手柄 Pointer Events 迁移'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 00:44:49
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-2]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - frontend/src/components/daemon/session-input-bar.tsx
  - frontend/src/components/group-chat/group-chat-panel.tsx
  - frontend/src/components/daemon/__tests__/session-input-bar-height.test.tsx
  - frontend/src/components/group-chat/__tests__/
target_files: [frontend/src/components/daemon/session-input-bar.tsx, frontend/src/components/group-chat/group-chat-panel.tsx, frontend/src/components/daemon/__tests__/session-input-bar-height.test.tsx, frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx]
goal: >
  输入框高度拖拽从 mouse 事件迁移 Pointer Events，触摸屏可拖。
implementation:
  - session-input-bar.tsx:501-526,651：onMouseDown→onPointerDown、window mousemove/mouseup→pointermove/pointerup（不用 setPointerCapture，对齐 panel-resizer 先例）
  - group-chat-panel.tsx:1688-1711,2771：同款副本同步迁移
  - session-input-bar-height.test.tsx：断言迁 pointer 事件 + createEvent/defineProperty 补 clientY 坐标（floating-session-host.test.tsx:711 方案）
  - group-chat-panel 高度拖拽新增同款断言（无现成测试）
acceptance:
  - pointer 拖拽实时改高度并钳制 44-480px
  - 双击恢复默认 + localStorage 持久化不变
  - 桌面鼠标路径测试绿（pointer 事件同路径覆盖）
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-input-bar-height.test.tsx src/components/group-chat/__tests__
constraints:
  - 不动双击/钳制/持久化逻辑
  - 不引入 setPointerCapture（jsdom 无实现）
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
