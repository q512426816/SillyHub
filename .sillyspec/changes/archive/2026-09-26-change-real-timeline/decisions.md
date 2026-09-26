---
author: flow-machine-draft
created_at: 2026-09-26T08:10:58.563Z
---
# 决策记录（Decisions）— 2026-09-26-change-real-timeline

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：事件流覆盖不全（watcher 后拉起/单飞锁盲窗，CLI 脚注同款披露）——展示面注明「观测起点≠诞生时刻」，墙钟统计以首末事件为界，不冒充完整历史。次风险：tasks.md 机器稿行含长描述截断规则与未来格式漂移——正则宽容匹配（task-\d+ 后冒号任意文本），坏行跳过不炸。试过但放弃：①把 CLI 命令嵌 daemon RPC 直接取渲染文本——耦合 CLI 输出格式且失去结构化（前端无法做任务面表格），且 daemon 旧版无此命令会 502；②events 表加 timeline 专用投影列——违反红线 D-004（零业务加工），聚合现算即可（变更事件量级 <100/单变更）。commit 标题匹配用 9 字符短哈希前缀——碰撞概率在 limit 50 窗口内可忽略，命中多条取最新。
