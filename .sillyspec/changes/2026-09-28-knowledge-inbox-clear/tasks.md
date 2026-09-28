---
author: flow-machine-draft
created_at: 2026-09-28T13:37:18.189Z
---
# 任务注册表（Tasks）— 2026-09-28-knowledge-inbox-clear

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: uncategorized.md 全部条目迁出，文件仅保留收件箱头注与清账说明
- [x] task-02: 每条按内容归入 known-issues（18）/ patterns（6）/ conventions（5）/ testing-gotchas（8）/ sillyspec-gotchas（4），正文忠实保留不删减；worktree doctor 条目内路径文本损坏处（\f 控制字符吃掉 \frontend）修复还原
- [x] task-03: 已修复项按 known-issues 既有惯例标题带 🟢 状态标记（12 条），未修复或现状认知项标 🟡（6 条）；两条「待确认」标题标记经正文证据核实后摘除；两条条目追加代码核验的现状备注（crypto.py:49 健壮性缺口仍开放 / hasBackgroundTaskGrace 宽限缓解已落地）
- [x] task-04: 丢失标题的 SSE 路由条目补写标题（含 commit 0c7860f7 已验证存在）后归入 known-issues FastAPI 路由顺序同族条目，交叉引用 ppm export-excel 条目
- [x] task-05: INDEX.md 五个分类节补齐 41 行迁移条目索引，Uncategorized 节改为已清空说明；锚点经 node 脚本按 GitHub slug 规则全量校验 99/99 可解析（顺手修复 6 条改动前即存在的存量坏锚点）
- [x] task-06: known-issues.md 内指向 uncategorized 旧条目的交叉引用（alembic 多 head 关联行）改为指向 conventions 新位置；迁移条目间的 [[wiki 链]] 改为同文件条目引用
- [x] task-07: sillyspec knowledge validate 无 errors（ok=true，errors=[]；唯一 flag_like_keyword warning 已顺手消除）
