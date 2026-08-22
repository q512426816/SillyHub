---
id: task-04
title: antd-ize-input-bar-buttons
title_zh: 输入条发送与附件按钮换 antd
author: qinyi
created_at: 2026-08-22 13:50:00
priority: P0
depends_on: [task-01]
blocks: [task-03, task-07]
requirement_ids: [FR-05]
decision_ids: [D-005@v1]
expects_from:
  task-01:
    - contract: adapter-deleted
      needs: [consumers-on-sessionpanel]
provides:
  - contract: inputbar-antd
    fields: [send-primary, attach-text, chips-native-kept]
allowed_paths:
  - frontend/src/components/daemon/session-input-bar.tsx
goal: >
  把 SessionInputBar 两处 shadcn Button（发送、📎 附件）换成 antd Button
  （primary / text），弹窗与 /sessions 页两消费面输入区基元统一（design
  §4.B.3、FR-05）。
implementation:
  - 发送按钮（约 :196）换 antd Button type primary——onClick/onSend、disabled 守卫（disabled 或空文本且无附件）与 creating 转 spinner 逻辑原样保留
  - 📎 附件 ghost 按钮（约 :169）换 antd Button type text（ghost 无边框语义，D-005@v1），title 与 disabled 门控（disabled 或 attachmentsDisabled）保持
  - 附件 chips 删除按钮为原生 button（约 :140），不动（design §3 非目标）
  - 删 :21 的 @/components/ui/button import，改从 antd 引入 Button
acceptance:
  - 本文件 grep 无 @/components/ui/button import，仅 antd Button 渲染两处操作按钮
  - 发送按钮 title 与 disabled 行为保持——既有 getByTitle("发送") 断言兼容（Grill X-11/X-12 实测 antd Button 透传 title/disabled）
  - turn-timeline-session-input-bar 套件全绿；tsc 零 error
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不动附件上传逻辑与 SessionInputBarProps 签名（零 props 变化）
  - chips 原生删除按钮不换（D-005@v1 范围仅两处 shadcn Button）
  - antd 色走 token 零手写 hex，不改输入区布局类名（FR-07）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
