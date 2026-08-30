# 符号影响面报告

> tasks.md 内容指纹（生成时）: 740dc9994356b56c——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。

- task-01: 无签名级变更（spike 仅临时日志补丁 + 还原，产出 spike-r09.md 结论文档，不提交代码改动）
- task-02: 接口字段级变更（非函数签名）：`PartialFlushBuffer`（session-manager.ts 内部 interface）新增 turnInputTokens/turnOutputTokens/lastCallCtxTokens 三字段；`PartialUsageSnapshot` 新增可选 ctx_tokens。消费点仅本文件内（_getOrCreateBuffer 初始化/_bufferPartial 累积/_flushPartial 组装），全部在任务范围内；对外无导出符号变化。
- task-03: 无签名级变更（纯测试新增/扩展）
- task-04: 模型类字段级变更：`AgentRun`（backend/app/modules/agent/model.py）新增列属性 ctx_tokens（int | None nullable）；新模块迁移文件 20260827230000_add_agent_runs_ctx_tokens.py（revision 常量）。SQLModel 列属性追加对既有读写零影响（from_attributes 直映），范围内。
- task-05: 字段级变更三处：`PublishIntent`（run_sync/service.py dataclass）新增字段 ctx_tokens（构造点 ~:1266-1278 同步）；`SessionRunRead`（daemon/router.py）新增 ctx_tokens: int | None；publish payload dict 新增键（None 不带）。方法签名（submit_messages/close_interactive_run/publish_submitted_messages）均不变，范围内。
- task-06: 无签名级变更（纯测试新增/扩展）
- task-07: 类型级变更：`frontend/src/lib/api-types.ts` SessionRunRead 新增 ctx_tokens（gen:types 生成，非手写）；`frontend/src/lib/daemon.ts` SessionStreamEnvelope 新增可选 ctx_tokens?: number | null。均为可选字段追加，既有消费点零影响，范围内。
- task-08: **组件 prop 类型签名变更**：`CtxUsageRingProps.usedTokens`（ctx-usage-bar.tsx）`number` → `number | null`——受影响调用点：session-panel.tsx 两处 CtxUsageBar 组装（~:2305 预会话 usedTokens={0} → {null}、~:2769 主组装改为逆序最新 ctxTokens），均在任务范围内同步；`SessionTurnView`（turn-timeline.tsx）新增可选 ctxTokens 字段（仅加字段，徽标渲染不动）。
- task-09: 无签名级变更（纯测试新增/修复断言）
