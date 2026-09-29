---
author: flow-machine-draft
created_at: 2026-09-29T00:49:55.977Z
---
# 任务注册表（Tasks）— 2026-09-29-issue-row-grid-misalign

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: issue-row.tsx leading 缺席渲染空占位 div（aria-hidden），四子元素落设计轨道，对齐 IssueRowHeader 占位先例
- [x] task-02: primer-structures.test.tsx 追加占位回归用例（无 leading 4 子元素 + 占位 aria-hidden；带 leading 同 4）13/13 绿；消费方 changes 页 39/39 绿 + tsc 0 错
- [x] task-03: 机理 A/B 静态对照（grid-repro.html）：无占位交集 true（右列内容左溢出盒 337px）vs 有占位交集 false，证据落 visual-evidence.md A/B 节
- [ ] task-04: 部署生产后同行复测 desc × step-sub-row 交集 false + 列表全行扫描零叠压（部署后勾选）
- [ ] task-05: 部署生产后同行复测交集 false + 列表全行扫描零叠压
