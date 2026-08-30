---
id: task-12
title: '复制测试——CopyButton 单测（成功/降级/反馈）+ 三挂载点渲染断言（含用户气泡剥离附件标记）'
title_zh: '复制测试——CopyButton 单测（成功/降级/反馈）+ 三挂载点渲染断言（含用户气泡剥离附件标记）'
author: 'qinyi'
created_at: 2026-08-31 04:00:53
priority: P0
depends_on: ['task-11']
blocks: []
requirement_ids: [FR-07]
decision_ids: []
expects_from:
  task-11:
    - contract: CopyButton 组件
      needs: ['props text 或 getText', '「✓ 已复制」1.2s 反馈复位', 'clipboard 失败/不可用 console.warn 降级']
allowed_paths:
  - frontend/src/components/daemon/__tests__/copy-button.test.tsx
  - frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx
goal: >
  FR-07 复制功能测试面（design §8「CopyButton 复制/失败反馈、三类气泡挂载」）：
  新建 copy-button.test.tsx 单测（成功复制/降级静默/1.2s 反馈复位/getText 惰性取值），
  既有 turn-segment-views.test.tsx 与 turn-timeline 测试补三挂载点渲染断言（含
  用户气泡剥离附件标记、空文本不渲染按钮）。
implementation:
  - "新建 __tests__/copy-button.test.tsx：① 成功——vi.spyOn(navigator.clipboard, 'writeText') mockResolvedValue，点击后 toHaveBeenCalledWith(文本) 且按钮文案切「✓ 已复制」，fake timers 推进 1200ms 后复位；② 降级——clipboard 不可用（Object.defineProperty 置 undefined）点击不抛错 + console.warn spy 命中（R-06）；③ 失败——writeText mockRejectedValue 同样静默 warn 不抛；④ getText 形态——传函数每次点击取当时返回值（用户气泡剥离标记场景的组件级验证）"
  - "turn-segment-views.test.tsx 既有 describe 补挂载断言（TextSegmentView :179 起 / ThinkingRowView :195 起）：渲染文本段与思考段展开后存在复制按钮（jsdom 无 :hover，hover 显隐是 CSS 行为不断言，断言按钮存在与 aria-label）；点击后 clipboard 收到 segment.text 纯文本"
  - "turn-timeline-session-input-bar.test.tsx 补用户气泡断言（既有 makeTurn prompt 格局 + MarkdownText mock 已就位）：带附件标记的 prompt（如 [附件:uuid|image|x.png] 前缀）渲染的气泡挂复制按钮，点击复制 parseAttachmentMarkers 剥离后的正文（断言 writeText 参数不含 [附件: 行）；纯附件 prompt（text 空串）断言无复制按钮"
  - "clipboard/console mock 照各文件既有 mock 策略（文件头注释块口径）：afterEach restore，避免污染邻近用例"
acceptance:
  - "copy-button.test.tsx 全绿：成功/undefined 降级/reject 降级/getText 四路覆盖，1.2s 反馈复位经 fake timers 断言（R-06 降级不抛错）"
  - "三挂载点渲染断言齐备：TextSegmentView、ThinkingRowView 展开正文、turn-timeline 用户气泡；用户气泡复制内容不含附件标记行、纯附件（空文本）不渲染按钮（FR-07 验收面）"
  - "既有 turn-segment-views / turn-timeline-session-input-bar 用例零回归（适配只加断言，不改旧语义）"
  - "cd frontend && pnpm exec tsc --noEmit 0 错"
verify:
  - 'cd frontend && pnpm exec vitest run src/components/daemon/__tests__/copy-button.test.tsx'
  - 'cd frontend && pnpm exec vitest run src/components/daemon/__tests__/turn-segment-views.test.tsx src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx'
  - 'cd frontend && pnpm exec tsc --noEmit'
constraints:
  - "只改测试：CopyButton 组件行为缺陷回 task-11 修（CLAUDE.md 规则 9）"
  - "禁止全量测试，仅本卡 3 文件（规则 0）；测试路径与 task-11 allowed_paths 不相交（Wave 6 文件集铁律）"
  - "jsdom 无 :hover 与安全上下文限制：hover 显示逻辑不在断言范围（纯 CSS），clipboard 用 vi.spyOn / Object.defineProperty mock 并 afterEach 还原"
  - "测试标题与断言中文（frontend scan CONVENTIONS 第 7 条）；不引新依赖"
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
