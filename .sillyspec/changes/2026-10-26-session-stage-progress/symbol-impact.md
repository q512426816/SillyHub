# 符号影响面报告

> tasks.md 内容指纹（生成时）: 6bdb6c293596e30e——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增符号——`TurnPhaseReportRequest` DTO（schema.py 新类）、`publish_turn_phase_event` helper（publish.py 新函数）、`POST /sessions/{session_id}/turn-phase` 端点（router/notify.py 新路由）、`control_commands.py` 两翻转点内联调用；全部为新增，不改既有符号签名。openapi.json 随 schema 新增重导出。
- task-02: 新增符号——daemon 侧 `notifyTurnPhase` 方法（hub-client.ts 新增）；daemon.ts/_startInteractiveSession、turn-control.ts、events.ts 在既有函数体内插上报调用（函数签名零变化）；api-types.ts 重生成（新增端点类型）。
- task-03: 前端信封扩展——`SessionEventKind` 联合类型加 `"turn_phase"`、`SessionStreamEnvelope` 加可选字段 `phase`/`detail`（类型增广非破坏）；handlers 加可选 `onTurnPhase`；turn-state.ts 轮状态类型加可选 `currentPhase`。全部为可选字段扩展，既有调用点签名兼容。
- task-04: `turn-status-bar.tsx` Props 加可选 `currentPhase`、组件内新增 `PHASE_LABEL` 常量映射——Props 可选扩展，无 phase 时渲染路径与现状一致，既有调用点（turn-timeline.tsx 渲染点）签名兼容。
- task-05: 无签名级变更（验收+文档同步任务，不触代码符号）。
- task-06: 无签名级变更——`_recheck_deferred_runs` 函数签名（session, tracked）不变，仅在函数体判死路径前插入 `_run_awaiting_user_input(session, run_id, now)` 豁免调用（既有私有函数复用，签名 session: AsyncSession/run_id: uuid.UUID/now: datetime 逐参一致）；测试文件 `_add_log` helper 加可选 channel/tool_kind 参数（默认值向后兼容既有调用）。
