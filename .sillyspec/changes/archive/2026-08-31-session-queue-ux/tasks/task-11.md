---
id: task-11
title: 'CopyButton 组件（纯文本复制 + "✓ 已复制"1.2s 反馈 + clipboard 降级 console.warn）+ 三处挂载：TextSegmentView/ThinkingRowView 展开正文（segment.text）/turn-timeline 用户气泡（parseAttachmentMarkers 剥离标记，空文本不渲染按钮）'
title_zh: 'CopyButton 组件（纯文本复制 + "✓ 已复制"1.2s 反馈 + clipboard 降级 console.warn）+ 三处挂载：TextSegmentView/ThinkingRowView 展开正文（segment.text）/turn-timeline 用户气泡（parseAttachmentMarkers 剥离标记，空文本不渲染按钮）'
author: 'qinyi'
created_at: 2026-08-31 04:00:53
priority: P0
depends_on: []
blocks: [task-12]
requirement_ids: [FR-07]
decision_ids: []
provides:
  - contract: CopyButton 组件
    fields:
      - 'props text 或 getText'
      - 'aria-label'
      - 'className 透传'
      - 'navigator.clipboard?.writeText'
      - '「✓ 已复制」1.2s 反馈复位'
      - 'clipboard 失败/不可用 console.warn 降级'
allowed_paths:
  - frontend/src/components/daemon/copy-button.tsx
  - frontend/src/components/daemon/turn-segment-views.tsx
  - frontend/src/components/daemon/turn-timeline.tsx
goal: >
  FR-07 消息复制：新建 CopyButton 复用组件（纯文本复制 + 「✓ 已复制」1.2s 反馈 +
  clipboard 降级 R-06），挂载三处气泡——TextSegmentView/ThinkingRowView 展开正文
  复制 segment.text、turn-timeline 用户气泡复制 parseAttachmentMarkers 剥离附件
  标记后的纯文本（空文本不渲染按钮），hover 形态对齐原型 .copy-btn。
implementation:
  - "新建 frontend/src/components/daemon/copy-button.tsx（design §4 Phase 3「交互统一抽 CopyButton」）：props——text（静态文本）或 getText（点击时惰性取值，用户气泡剥离标记场景）；内部 useState 反馈位（1.2s 定时复位，卸载清理 timer）；点击 navigator.clipboard?.writeText(文本) 成功切「✓ 已复制」（对齐 session-panel.tsx:3264-3287 复制会话 ID 交互先例）；catch 或 clipboard 不可用 → console.warn 静默降级（R-06：http 局域网非安全上下文，不阻塞聊天）；aria-label「复制」/「已复制」"
  - "turn-segment-views.tsx TextSegmentView（:388）：气泡容器补 relative，hover 浮出 CopyButton text={segment.text}（右下角 absolute，原型 .copy-btn 形态：muted 色、hover 显色、done 态品牌色——用 text-muted-foreground/text-brand-600 语义阶）；显示逻辑纯 CSS :hover 零状态（design Phase 3）；不破坏 memo 边界——CopyButton 反馈 state 内聚，外层浅比较不受影响"
  - "turn-segment-views.tsx ThinkingRowView（:409）展开正文（open 分支容器 :443-447）：同款挂 CopyButton text={segment.text}；折叠态不渲染（R-03 展开才挂载正文现状保持）"
  - "turn-timeline.tsx 用户气泡（:427-449 turn.prompt 分支）：气泡容器补 relative + hover 显示 CopyButton；getText 取 parseAttachmentMarkers(turn.prompt).text（:437 既有调用同源，剥离附件标记行与显示一致）；parsed.text 空串（纯附件看图说话）不渲染按钮"
  - "三处样式统一走 CopyButton 内建 + className 透传（原型 prototype-session-queue-ux.html .copy-btn :55-60：position absolute 右下、msg-user/bubble-ai hover 显示、done 态 ok 色）；ToolRowView 既有复制先例（:474-546）不动（NG-05 工具行已有复制）"
acceptance:
  - "CopyButton 单文件导出可供三处复用（task-12 消费其契约）；复制成功反馈「✓ 已复制」1.2s 后复位；clipboard 不可用/失败 console.warn 不抛错（R-06）"
  - "TextSegmentView 与 ThinkingRowView 展开正文均出现复制按钮，复制内容=segment.text 纯文本；两 memo 组件未被破坏（反馈 state 内聚于 CopyButton，SegmentView 分发器零改动）"
  - "用户气泡复制内容=parseAttachmentMarkers 剥离附件标记后的 text（与显示一致）；纯附件（text 空串）不渲染按钮"
  - "cd frontend && pnpm exec tsc --noEmit 0 错；三改动文件近邻既有测试零回归"
verify:
  - 'cd frontend && pnpm exec tsc --noEmit'
  - 'cd frontend && pnpm exec vitest run src/components/daemon/__tests__/turn-segment-views.test.tsx src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx src/components/daemon/__tests__/turn-timeline-scroll.test.tsx'
constraints:
  - "复制统一走 navigator.clipboard?.writeText + try/catch 降级 console.warn（R-06），禁止 alert/notify 弹层打断聊天"
  - "用户气泡必须 parseAttachmentMarkers 剥离附件标记（复制内容与显示文本一致）；空文本不渲染按钮"
  - "不破坏 memo 组件与段引用稳定性（design Phase 3：反馈用 CopyButton 内部 useState）；SegmentView 分发器/ToolRowView 复制先例零改动（NG-05）"
  - "本卡不写测试（CopyButton 单测与三挂载点断言归 task-12）；零新增依赖（照 D-006 同款铁律）"
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
