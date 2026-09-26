---
author: flow-machine-draft
created_at: 2026-09-26T07:26:45.051Z
---
# 任务注册表（Tasks）— 2026-09-26-assets-test-binding-raw-text

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。
- [x] task-01: 后端 assets.py 新增 _read_binding_raw_text（读归档 requirements.md，正则匹配 AGENT:测试绑定FR-XX 槽注释，取其后连续非空内容行空格拼接为原文，返回锚点→原文映射，缺文件/损坏/空槽 fail-open 空映射）；_read_test_rows 增第二参数按行锚点填充 raw_binding；schema.py ChangeTestRow 加 raw_binding: str | None = None
- [x] task-02: requirements 缺失/槽不存在/锚点缺席 → raw_binding=None，既有字段与行为零变化（金样本与既有 17 用例全过）
- [x] task-03: 规则 21 gen:types 已跑——backend/openapi.json 与 frontend/src/lib/api-types.ts 随提交更新（raw_binding?: string | null 已生成）
- [x] task-04: 前端资产卡测试绑定行下渲染原文小字（「原文：」前缀 + truncate + title 悬停全文）；raw_binding 与 tests 等价（纯文件级）时不渲染防重复
- [x] task-05: 后端 test_assets 补三面——金样本断言 FR-01 槽两行拼接、无 requirements.md 容错 None 用例、_read_binding_raw_text 纯函数用例（多行拼接/空内容槽跳过/缺文件空映射）
- [x] task-06: 前端组件测试补两用例——既有「点开预览」用例增强原文行断言（含 title 悬停全文）+ 等价不渲染用例 = 16 passed
- [x] task-07: 后端 change 模块聚焦全量 581 passed + 2 skipped（既有 skip）
- [x] task-08: frontend pnpm exec tsc --noEmit → exit 0
