# UI 视觉证据 — 2026-10-04-knowledge-touch-plain-title

本变更是纯展示文案替换（知识触达区块标题两态换用户语言 + 新增 title 悬停属性），不改任何页面结构、className 或布局：

- 触及的唯一前端文件 `change-assets-card.tsx` 仅改标题 span 的字符串内容与新增 title 属性、组头注释；JSX 结构、样式类、行渲染均不变，无视觉基准可比对需求。
- 行为变化即文案本身：归档态「知识触达（注入命中 · 待复核标记反查）」→「知识触达（本变更参考过的知识）」；在途态「知识触达（注入命中 · 实时）」→「知识触达（本变更参考过的知识 · 实时）」；机制口径移入 title 悬停（鼠标停留可见）。
- 无因约束对不齐基准而缩小/收敛范围的降级，无需用户裁决留痕。方向与文案形态经用户会话确认（"改"）。

验证：`pnpm vitest run src/components/changes/detail/__tests__/change-assets-card.test.tsx` 28 passed（含更新后的两态标题断言）；`pnpm typecheck` 零错。未起全栈渲染实页——纯字符串替换无布局面，与先例 2026-09-27-assets-testfile-bracket-note 同口径（组件测试即证据面）。
