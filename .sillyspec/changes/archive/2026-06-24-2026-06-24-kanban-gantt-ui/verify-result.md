---
author: WhaleFall
created_at: 2026-06-24T11:25:00
---

# 验证报告:kanban 时间轴甘特图

变更:`2026-06-24-kanban-gantt-ui`
结论:**✅ PASS**(可归档)

## 一、范围

把 `/ppm/kanban` 主体从「人员×日期矩阵」改成「时间轴甘特图」(自研方案 A)。新增 `KanbanGantt`/`KanbanActualGantt` + `kanban-gantt-helpers`(纯函数 + 单测),替换两个 Matrix;`page.tsx` 接入;删 4 个废弃文件。实现 + 6 轮样式/bug 修复在主仓库 main 完成并部署。

## 二、对照 design.md §9 验收标准

| AC | 标准 | 结果 | 证据 |
|----|------|------|------|
| AC1 | 计划 tab 渲染甘特:人员多行泳道 + 日期刻度 + 跨日任务条形,位置/宽度与 start→deadline 一致 | ✅ | kanban-gantt.tsx 条形 computeBarLayout 定位;14 单测覆盖 |
| AC2 | 同人并行任务分不同泳道行,无重叠;左右行高对齐(LANE_HEIGHT) | ✅ | assignLanes 贪心 + 同日按整天判定(f23d331a 修复);LANE_HEIGHT/DATE_ROW_HEIGHT 统一驱动 |
| AC3 | 无 start/deadline(或单边缺失)→未排期;null user→全局区;跨范围裁剪 | ✅ | computeBarLayout 完全范围外返回 null(f3a7f25e);未排期按人归 + 全局区 |
| AC4 | 周末列高亮、今天竖线(范围内时随滚动定位) | ✅ | isWeekendKey + emerald 底;todayIdx 今天竖线 error.color(内容层 absolute) |
| AC5 | 计划:点击→DetailDrawer + 右键 ContextMenu;实际:点击→ActualEditModal,无右键;两 tab 切换;实际用 actual_start/end | ✅ | kanban-gantt 有 onTaskContextMenu;kanban-actual-gantt 仅 onEdit(grep 确认) |
| AC6 | 筛选/日期导航/工时图/CRUD 弹窗不回归 | ✅ | ls 确认 search-bar/date-nav/work-hour-chart/create/edit/assign dialog/context-menu/detail-drawer 全保留 |
| AC7 | helpers 单测覆盖定位/裁剪/泳道/null 兜底;typecheck;现有测试不回归 | ✅ | kanban-gantt-helpers 14 单测;typecheck 通过;vitest 全量 441/441 |
| AC8 | 样式 Design Token,无散落 hex;行头任务数取 task_count | ✅ | emerald/slate/primary/semantic.error token;行头 u.task_count |

## 三、plan.md 9 task 完成情况

- task-01 helpers ✅ / task-02 14 单测 ✅ / task-03 计划 gantt ✅ / task-04 实际 gantt ✅
- task-05 page 接入 ✅ / task-06 删 matrix/cell ✅ / task-07 删 grouping ✅
- task-08 typecheck + 单测 ✅ / task-09 docker 部署 + 人工验收 ✅

7 个 commit:d8e6966b(feat)+ 47c6bd66/81ee0433/4dc4fd31/6f57bf06(style)+ f23d331a/f3a7f25e(fix)。

## 四、测试与质量

- **typecheck**:通过(tsc --noEmit 无错)
- **vitest 全量**:441/441 通过(37 文件,含 kanban-gantt-helpers 14 + milestone-details 18)
- **lint**:无 error,仅预存在 `no-unused-vars` warning(stores/kanban.ts 等,**非本次 kanban-gantt 文件新增**)
- **部署**:frontend docker 重建,容器 healthy,HTTP 200

## 五、人工验收(用户多轮反馈,均已处理)

1. 行高:无任务行翻倍(lanesH = max(rowCount,2) * LANE_HEIGHT)
2. 日期列宽:90→120→300→450(用户多轮要求加宽)
3. 状态 tag 换行:条形 title span 加 `min-w-0 flex-1 truncate`,tag 加 `shrink-0`(4dc4fd31)
4. 泳道重叠:assignLanes 改按整天比较,同日算重叠分不同行(f23d331a)
5. 范围外任务堆首列:完全范围外不渲染(f3a7f25e)
6. 日期列竖向边框线(6f57bf06)

## 六、已知遗留(不影响验收)

- **sillyspec execute worktree 未使用**:execute 启动时创建了隔离 worktree(`.sillyspec/.runtime/worktrees/2026-06-24-kanban-gantt-ui`),但因 docker deploy 在主仓库 + 项目 commit main 惯例,实现直接在主仓库 main 完成,worktree 副本未用(可后续清理,不影响功能)。
- **拖拽改期/虚拟滚动**:design §12 非目标(YAGNI),未做。

## 七、结论

**PASS**。design §9 八条验收标准全通过,plan 9 task 全完成,typecheck + 441 单测全绿,lint 无新增 error,已部署且用户多轮人工验收确认。可进入 archive 归档。
