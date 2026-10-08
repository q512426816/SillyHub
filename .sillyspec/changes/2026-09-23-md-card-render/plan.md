---
author: WhaleFall
created_at: 2026-10-08 10:32:00
change: 2026-09-23-md-card-render
plan_level: light
execution_mode: main
---

# 轻量计划（Light Plan）：md 卡片渲染改造（scan-docs / knowledge 卡片模式）

## 来源

design.md（Grill 通过，review-2026-10-08-101430）+ requirements.md FR-01~04 + D-001/D-002/D-003。视觉基准 prototype-card-render.html panel-c（用户已确认）。

## 范围

| 文件 | 动作 |
|---|---|
| NEW:frontend/src/components/knowledge/card-markdown.tsx | CardMarkdown 薄壳（MarkdownText compact + 表格横向滚动 + 字号 11.5px 对齐 + 表头 brand 色） |
| NEW:frontend/src/components/knowledge/__tests__/card-markdown.test.tsx | 薄壳单测（mock 先例 team-task-block.test.tsx:42-50） |
| frontend/src/components/knowledge/entry-card-list.tsx | 4 处正文接入 + manual/SingleCard 卡片头重构（色条/头底/标题色/🔗 复制/🔥 收敛/data-entry-anchor 保留）+ parseFrontmatterMeta 元信息条（缺失降级） |
| frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx | 新结构断言 + 元信息条两分支 + 锚点回归 |

## 验收

- FR-01：卡片正文 md 正常渲染（表格/列表/加粗/行内代码），经统一 rehype-sanitize，全文渲染无折叠（D-002）
- FR-02：卡片头视觉与原型 panel-c 一致，色值全走 brand-* 语义阶（禁 hex），🔥 仅卡片头一处，🔗 复制生效（SingleCard 复制串=裸文件名）
- FR-03：frontmatter 元信息条显示 ✍ 作者 · 收录时间；缺失时整条隐藏不报错；stripFrontmatter 签名不动（走 parseFrontmatterMeta）
- FR-04：INDEX 路由行锚点跳转零回归（data-entry-anchor + scrollIntoView）；双主题换肤正确
- `pnpm -C frontend exec vitest run src/components/knowledge` 相关测试全绿 + `pnpm -C frontend exec tsc --noEmit` 0 error + `pnpm -C frontend exec eslint <改动文件>` 0 error

## 覆盖矩阵（如存在 decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | （非目标约束） | conventions.md 未被修改（git diff 为证）；原型以其内容为演示数据 |
| D-002@v1 | task-01, task-02 | FR-01 验收（全文渲染、无折叠/卡片内滚动交互） |
| D-003@v1 | task-01, task-02 | FR-01/02/03/04 全域（方案 C 落地，panel-c 基准） |
