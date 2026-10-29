---
author: flow-machine-draft
created_at: 2026-10-29T02:45:21.339Z
---
# 决策记录（Decisions）— 2026-10-29-edit-diff-stat-badge

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：大 patch（数千行）重复解析开销。缓解：跑马灯条目窗口上限 12 条、派生发生在 deriveLiveMarqueeEntries 纯函数内（段引用变化才重算，React memo 链既有）；ToolRowView 侧 useMemo 按 editPatch 字符串缓存。实测面量级（单文件 patch 数百行）无虞。 - 已放弃方案 a：用 hunk 头 oldLines/newLines 直接相加（省一轮遍历）——Write 覆盖写等场景 hunk 头与 lines 实际前缀可能不一致，且与展开区行级 diff（按行前缀渲染）不同源，会造成两处口径漂移。 - 已放弃方案 b：daemon 侧预计算统计随事件下发——多一层协议与 api-types 改动，前端已有全量数据，本变更不需要。 - 已知边界：zcode 引擎交互链路 edit_patch 暂缺（providers.ts 标记「structuredPatch 未验证」）→ 该引擎下按 FR-03 不伪造口径自然不显示徽标，引擎侧后续补齐数据后零改动自然点亮，不在本变更范围。
