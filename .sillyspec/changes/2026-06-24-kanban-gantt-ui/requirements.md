---
author: WhaleFall
created_at: 2026-06-24T09:40:00
---

# 需求规范:kanban 时间轴甘特图

## 功能需求
- **FR-1 计划甘特**:纵轴人员多行泳道,横轴日期,任务条形跨 `start_time→deadline`,条形位置/宽度与日期一致。
- **FR-2 实际甘特**:条形跨 `actual_start_time→actual_end_time`(计划/实际两 tab 切换,结构同)。
- **FR-3 多行泳道**:同人多任务贪心分配首个不冲突槽位,各占一行,无遮挡。
- **FR-4 只读交互**:计划点击条形→DetailDrawer + 右键 ContextMenu;实际点击条形→ActualEditModal(无右键,对齐现状)。
- **FR-5 边界**:`start/deadline` 同时有才进时间轴;单边/双边缺失→未排期区(按 user 归人,null user 全局);跨范围→裁剪 + 渐变指示;`start>deadline`→按 deadline 单日兜底。
- **FR-6 视觉**:周末列高亮、今天竖线(在范围内时)、项目色条形、选中人员行高亮。
- **FR-7 复用不回归**:SearchBar 筛选、DateNav 日期导航、WorkHourChart 工时图、Create/Edit/Assign 弹窗功能保持。

## 非功能需求
- **NFR-1** 零新依赖(自研)。
- **NFR-2** Design Token 统一,无散落 hex。
- **NFR-3** 定位/泳道抽 `kanban-gantt-helpers` 纯函数 + 单测覆盖。
- **NFR-4** `pnpm typecheck` 通过,现有 kanban 测试不回归。
- **NFR-5** 左右行高同源常量驱动(`LANE_HEIGHT`/`DATE_ROW_HEIGHT`/`DAY_WIDTH`),避免 sticky 行头错位。

## 验收标准
见 `design.md` §9(8 条)。

## 不做(YAGNI)
- 拖拽改期(需后端 update + 乐观更新 + 冲突校验,留后续增强)。
- 第三方甘特库(frappe-gantt 等)。
- 超大数据虚拟滚动(人员/范围超大时再做)。
