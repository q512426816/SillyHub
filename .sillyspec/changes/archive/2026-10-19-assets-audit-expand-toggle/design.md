---
author: flow-machine-draft
created_at: 2026-10-19T01:06:36.704Z
---
# 设计记录（Design Record）— 2026-10-19-assets-audit-expand-toggle

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

2026-10-15-change-detail-redesign FR-06 把资产卡六组从「固定高度 h-64 + 组内滚动」统一改为「自然高度 + 每组最多 5 行 + GroupToggle『展开全部 N 条』」，design.md 明文六组含归档留档；实现时 fr/决策/知识触达/测试绑定/模块触达五组都补了 GroupToggle，唯独归档留档的「改动文件」清单只接了 `cap(patchFileList, "audit")` 截断、漏放 GroupToggle——超 5 条永远只显示前 5 条，无滚动也无展开，用户看到 180 文件的变更以为数据丢了。修复即补齐：在清单 `</ul>` 后放一个与其它五组同源的 `<GroupToggle total={patchFileList.length} expanded={isExpanded("audit")} onToggle={() => toggleGroup("audit")} unit="个文件" />`，不新造任何机制。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无后端/端点/类型改动（`ChangeAssetsRead` 响应消费不变，`pnpm gen:types` 无涉）。仅前端组件 `ChangeAssetsCard` 内部展示行为变化：audit 分组新增展开/收起交互，GroupToggle 文案形态与其它分组一致（`展开全部 N 个文件 ▾` / `收起`）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：不适用——纯展示组件，数据来自既有 useQuery 单次聚合响应，无事件流；查询失败走既有分区级错误分支，不新增路径。
2. 并发写：不适用——展开状态是组件内 `expandedGroups` useState（本地 UI 态），无持久化、无跨组件共享；同页多卡各自独立实例互不影响。
3. 切换/生命周期：收起/展开仅改本地 state，切换 tab 或卸载组件即丢弃（下次进入默认 5 条），与其它五组展开行为同语义，无残留状态风险。
4. 作用域：不适用——不触工作区/仓/实例边界，`cap`/`isExpanded("audit")` 的 key 与其它分组 key 同级不冲突（"audit" 唯一）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：展开 180 条时卡片自然高度变得很长——但这是六组统一形态的设计决定（design.md「自然高度 + 展开全部」取代内滚），其它组同样如此，本修复不改该决定。试过但不做：给清单恢复组内滚动/固定高度——正是 2026-10-15 改版明确否掉的旧形态（多内滚小窗是「乱」的主要来源），回退会造成 audit 组与其它五组形态分裂。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/changes/detail/change-assets-card.tsx | 归档留档改动文件清单 `</ul>` 后补 GroupToggle（unit=个文件，key=audit） |
| 修改 | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | 新增两用例：超 5 条展开/收起；≤5 条无展开按钮 |
