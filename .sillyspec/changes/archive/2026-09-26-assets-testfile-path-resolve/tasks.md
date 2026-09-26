---
author: flow-machine-draft
created_at: 2026-09-26T06:57:07.027Z
---
# 任务注册表（Tasks）— 2026-09-26-assets-testfile-path-resolve

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: change-assets-card.tsx 新增导出 normalizeTestFilePath / resolveTestFilePath 纯函数 + TestFileBody 弹窗主体：打开时按文件名 fetchSearch，等值或唯一后缀命中自动用真实路径预览（参考知识库 normalizeKnowledgeFileParam 先例）
- [x] task-02: resolveTestFilePath 后缀多命中时排除 .sillyspec/.runtime/ 工作树副本前缀再判唯一，仍多个返回 candidates；TestFileBody 渲染候选清单按钮由用户点选（点选后转 FilePreview）
- [x] task-03: normalizeTestFilePath 处理反斜杠→斜杠、去 ./ 前缀、首尾空白（与知识库归一同款最小集；命中集元素比较前同样归一）
- [x] task-04: redirected 救回时弹窗预览上方渲染 change-assets-test-redirect-note 注记（记录路径未直接命中，已定位到仓库内同名文件：+真实路径）
- [x] task-05: 零命中渲染中性文案「未在仓库中找到该测试文件（路径）——记录路径可能不完整，或文件已被移动/删除」；搜索通道失败时兜底原路径直开（FilePreview 呈现 explorer 真实错误，不吞）
- [x] task-06: backend explorer/service.py not_found 文案改中性「文件或目录不存在：路径可能不完整，或文件已被移动/删除」（code/details 结构不动）
- [x] task-07: change-assets-card.test.tsx 新增 5 用例（等值无注记/短路径后缀救回/worktree 排除/多候选点选/零命中中性文案）+ 既有 10 用例一次跑过 = 15 passed；详情页整页回归 22 用例同绿
- [x] task-08: backend uv run pytest tests/modules/explorer/ -q → 39 passed
- [x] task-09: frontend pnpm exec tsc --noEmit → exit 0
