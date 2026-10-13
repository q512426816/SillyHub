---
author: flow-machine-draft
created_at: 2026-10-13T03:00:28.585Z
---
# 需求规格（Requirements）— 2026-10-13-subagent-stub-reconcile

## 功能需求

### FR-01: 子代理容器头(stub 与无任务元数据且运行中的 tool 段)按 tool_use_id 匹配任务快照:匹配到终态行时徽章/状态点/时长按快照展示(已完成/失败/已停止+权威时长),不再恒显「运行中」;无匹配维持现状

- 渲染层**必须**新增纯函数 `buildSubagentTaskLookup(rows)`:把任务快照行按 `tool_use_id` 建索引,同 tool_use_id 多行时按终态优先序(completed > failed > stopped)取一条,全 running 取最新;无 tool_use_id 的行跳过。
- `subagentHeaderOf` **必须**接受可选的对账参数:stub 段与「无任务元数据且段状态为 running」的 tool 段,按 `segment.id` 查对账索引——命中终态行时状态点/徽标/时长按快照展示(completed→「已完成」+elapsed 权威时长、failed→「失败」、stopped→「已停止」),`running` 与 sweep 动效随之消除;未命中时行为与现状完全一致。
- 带 [TASK_*] 元数据的 tool 段(metaStatus 非空)与已配对结果的段(status ok/deny)**禁止**被对账结果覆盖——元数据与既有三态永远优先。

#### 场景：历史 stub 段对账收敛

- Given 分页窗口截断致派发行缺失,某子代理容器为 stub 段(id=call_xxx),任务快照含 tool_use_id=call_xxx 的 completed 行(elapsed_ms=169000);
- When 渲染该容器头;
- Then 徽章显示「已完成」、状态点绿色非 pulse、时长显示 mm:ss 权威值、名称显示快照 task_name;不再显示「运行中」。

#### 场景：快照无匹配

- Given stub 段 id 在快照索引中无匹配(行被清或超 200 条窗口);
- When 渲染该容器头;
- Then 维持现状(名称=subagentType、durationText=「运行中」),零变化。

### FR-02: 容器头名称优先快照 task_name(真实任务名),stub 不再显示类型名 general-purpose;无匹配维持 subagentType 回退

- 容器头名称派生**必须**在对账命中时优先显示快照 `task_name`:stub 段命中 → task_name;tool 段 primary 为空且命中 → task_name;两种段未命中时维持现有回退链(tool: primary→subagentType→「子代理」;stub: subagentType→「子代理」)。

#### 场景：stub 名称显示真实任务名

- Given FR-01 场景的同一 stub 段,快照行 task_name=「独立评审单位弹窗重排」;
- When 渲染容器头;
- Then 名称显示「独立评审单位弹窗重排」,subagentType 标签照常渲染「general-purpose」。

### FR-03: 有任务元数据的 tool 段与已配对结果的段行为不变(零回归);补前端回归测试

- 既有渲染行为**必须**零回归:带 [TASK_*] 元数据的 tool 段徽标/时长/名称路径、已配对结果(ok/deny)段的状态路径、无任何数据源时的回退路径,均与本变更前一致。**必须**新增覆盖:对账索引构建(终态优先/多行取舍/无 tool_use_id 跳过)、stub 命中终态/未命中、tool 段三优先级(元数据 > 对账 > 段三态)。既有相关套件(turn-segment-views、task-line-assembler、session-panel 相关)**必须**全绿。

#### 场景：优先级与回归防线

- Given 新增用例与既有触达套件;
- When 运行;
- Then 新增用例全过、既有套件零回归(禁全量,仅跑触达模块)。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/subagent-task-reconcile.test.ts「buildSubagentTaskLookup 终态优先/stub 命中终态收敛/未命中维持现状」
FR-02: frontend/src/components/daemon/__tests__/subagent-task-reconcile.test.ts「stub 名称显示快照 task_name」
FR-03: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx 既有用例 + subagent-task-reconcile.test.ts「tool 段三优先级(元数据>对账>三态)」
