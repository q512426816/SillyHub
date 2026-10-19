# 未分类知识

> 项目特定的架构经验、历史记录、尚未提炼成通用 pattern 的知识。
> 已分类的迁移到：`sillyspec-gotchas.md`（工具坑）/ `testing-gotchas.md`（测试坑）/ `patterns.md`（架构）/ `known-issues.md`（项目坑）/ `conventions.md`（约定）。
> 已修复项保留并标注状态，便于回溯。INDEX.md 不索引本文件——条目成熟后请迁出到分类文件并加 INDEX 索引。

（2026-09-28 清账：本文件原有 41 条（40 个 `##` 条目 + 1 条丢标题的 SSE 路由条目）已全部迁出到五个分类文件并在 INDEX.md 补索引，见变更 2026-09-28-knowledge-inbox-clear。）

（2026-10-19 清账：本轮积压 16 条已全部迁出并在 INDEX.md 补索引——testing-gotchas 4 / known-issues 6 / conventions 3 / sillyspec-gotchas 2 / patterns 1，见变更 2026-10-19-knowledge-inbox-triage。4 条【待确认】逐条裁决留痕：daemon.start() 系统代理黑洞属实（推广待立项）、MissingGreenlet 已修（patterns）、require_permission 422 属实现行约束（known-issues 🟡）、.zcode 已跟踪文件属库存量状态（known-issues 🟡）；已修复项按 🟢/🟡 口径标注（生产嵌入定案 🟢、生产/本地索引损坏 🟢、首搜建库地雷 🟡 等）。另清掉 1 条已完成迁移的历史面包屑（fake timers waitFor）。当前收件箱为空，新踩坑从下方追加。）
