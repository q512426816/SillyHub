---
id: task-13
title: 'pre-session-picker-variant-bottom-sheet'
title_zh: 'PreSessionPicker 加 variant（bottomSheet 底部抽屉两步，默认 center 零回归）（FR-08/FR-11）'
author: 'qinyi'
created_at: 2026-08-27 00:34:52
priority: P1
depends_on: []
blocks: ['task-12']
requirement_ids: [FR-08, FR-11]
decision_ids: [D-001@V1, D-003@V1]
allowed_paths:
  - frontend/src/components/sessions/pre-session-picker.tsx
  - frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx
related_tests:
  - frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx
provides:
  - contract: 'PreSessionPicker variant bottomSheet'
    fields: ['variant?: "center" | "bottomSheet"（默认 center）', open, machines, onCancel, 'onPick(runtimeId)']
goal: >
  给 PreSessionPicker 加 variant?: "center"|"bottomSheet"（默认 center 零回归），
  bottomSheet 仅把容器定位改为底部抽屉两步浮层（对齐原型），两步选择逻辑零分叉。
implementation:
  - 'pre-session-picker.tsx:41 PreSessionPickerProps 加 variant?: "center" | "bottomSheet"，解构默认值 "center"'
  - ':122-135 容器类按 variant 分支：center 保持现状原类不动（fixed inset-0 flex items-center justify-center + 居中 max-w-[360px] 卡）；bottomSheet 改 items-end 贴底抽屉（rounded-t-2xl、max-h-[80dvh] overflow-y-auto、pb-[env(safe-area-inset-bottom)]、满宽）——仅容器定位/外观类差异'
  - 两步状态机（machineId 重置/open 受控/onPick/onCancel/在线与 provider 白名单过滤）零改动，两种 variant 走同一逻辑路径
  - 既有测试文件补用例：①不传 variant 渲染与改前一致（容器仍含居中定位类，回归锚）；②variant="bottomSheet" 容器为贴底抽屉且两步流程走通（机器→智能体→onPick(runtimeId)），遮罩/✕ 取消仍只回调 onCancel
  - grep 确认既有调用点（sessions 门户等）零改动、零新增传参
acceptance:
  - 不传 variant 的渲染与改前完全一致；pre-session-picker.test.tsx 既有用例零修改通过
  - variant="bottomSheet" 时容器贴底抽屉定位生效，两步选择/取消/空态与 center 完全同构（同一逻辑路径）
  - 既有桌面调用点零改动（grep 证），默认值 "center" 保持桌面行为
  - 新增回归测试通过（含触摸热区 ≥44px 抽检）
verify:
  - cd frontend && pnpm test -- src/components/sessions/__tests__/pre-session-picker.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - variant 默认值保持桌面行为，既有调用点零改动（FR-11 桌面零回归）
  - 仅改容器定位/外观类；受控语义（open/onCancel/onPick）与过滤白名单零分叉，不复制两步逻辑
  - 不引入第三方 bottom-sheet 依赖（Tailwind 类自绘）；禁止顺手改 new-session-form / session-list-panel
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
