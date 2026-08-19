
## ql-20260817-001-e974 | 2026-08-17 09:58:35 | (quick 任务)
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260818-001-fd53 | 2026-08-18 17:00:02 | 切换档案后时间线有空气泡轮且需重进才看到
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/sessions/page.tsx, frontend/src/components/daemon/turn-timeline.tsx, deploy/.sillyspec/, frontend/.sillyspec/
需求：切换档案后时间线有空气泡轮且需重进才看到。
根因：静默切换 run 无 prompt/output，渲染为空 whoLine+轮次块；runs 数据仅 page mount 拉取。
方案：①turn-timeline 识别配置变更轮渲染 ⚙ 紧凑一行标记；②onSwitched 立即 listSessionRuns。
结果：157 文件/1613 全绿，tsc 0。
审计：📝 文档欠账（D-8）：4 个源码文件改动未同步任何模块文档
