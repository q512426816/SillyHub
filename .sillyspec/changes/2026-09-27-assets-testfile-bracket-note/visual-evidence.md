# UI 视觉证据 — 2026-09-27-assets-testfile-bracket-note

本变更是纯逻辑修复（测试文件路径归一增加「用例名」注解剥离），不改任何页面结构、样式或文案面：

- 触及的唯一前端文件 `change-assets-card.tsx` 仅改 `normalizeTestFilePath` 纯函数与其头注释；无 JSX/className/布局改动，无视觉基准可比对需求。
- 行为变化只体现在数据瑕疵场景（记录路径粘「注解」）：原先弹窗显示「未在仓库中找到该测试文件」误报，现在能定位并预览真实测试文件——这是既有 FR-01~02 设计内的 resolved 分支，非视觉降级。
- 无因约束对不齐基准而缩小/收敛范围的降级，无需用户裁决留痕。

验证：`pnpm vitest run src/components/changes/detail/__tests__/change-assets-card.test.tsx` 22 passed（含新增 3 条注解剥离用例）；`pnpm exec tsc --noEmit` 零错。
