# 符号影响面报告

> tasks.md 内容指纹（生成时）: 35597e5fbb66449f——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。

- task-01: SQLModel 列新增（非方法签名）——AgentSession 增 fork_of_session_id/fork_at_run_id/engine_fork_anchor 三可空字段、AgentRun 增 engine_anchor 可空字段（backend/app/modules/agent/model.py:888-918/:263-306 区域）；受影响调用点：无（可空列默认 NULL，既有构造/查询零破坏）；在任务范围内（本卡自带迁移+模型单测）。
- task-02: 无签名级变更（纯 spike 证据产出：spike-pi-fork.md + decisions.md D-008 追加，零源码）。
- task-03: 接口字段级变更——ProviderCaps 类型增第 16 键 sessionFork（枚举 native/seed/none，sillyhub-daemon/src/interactive/providers.ts，dialog 枚举键既有先例）；受影响调用点：gen-provider-caps.mjs 生成器（本卡）、backend/app/modules/agent/provider_caps.py 与 frontend/src/lib/provider-caps.ts 镜像（生成器产出）、get_provider_caps 取值处（缺键 none 兜底，本卡）、alignment/provider-registry 测试（本卡）；全部在任务范围内。
- task-04: 无签名级变更——submit_commit.py 轮终态收口内部增 engine_anchor 回填写列（函数签名不变，内部数据流扩展；backend/app/modules/daemon/run_sync/service/submit_commit.py:194-197 旁同款语义）。
- task-05: 多处签名级变更——①create_session 签名增 fork 参数组（可选参数缺省零回归；受影响调用方=router/session_crud.py 既有调用不传新参零破坏+fork.py 新调用方，均在范围内）；②SessionRead DTO 增 fork 三字段（消费方=前端经 gen:types 生成 api-types.ts+手写镜像，产物随本卡提交）；③新增 SessionForkRequest/Response DTO 与 fork_session 服务函数（新 API 无既有调用方）；④build_claim_payload（backend/app/modules/daemon/lease/context.py:459）claim payload 白名单增 resume_at_uuid/fork_session 两键（消费方=daemon execPayload 解析，跨 task 契约由 task-06 接）。
- task-06: 接口字段级变更——CreateSessionInput（sillyhub-daemon/src/interactive/session-manager/types.ts）增 resumeAtUuid/forkSession 可选键（消费方=daemon.ts execPayload 解析/session-manager 建会话 driverOpts/driver-factory 转发/claude-sdk-driver options，全链在范围内）；claude SDK options 增 resumeSessionAt/forkSession 透传（forkSession 生产先例 claude-sdk-driver.ts:476-479）；可选键缺省既有路径零破坏。
- task-07: 新增导出 API+组件 props 扩展——frontend/src/lib/daemon/sessions.ts 新增 forkSession()（新导出无既有调用方）；turn-segment-views.tsx 轮头动作区增分叉入口（组件 props 若增 onFork 回调，受影响调用点=session-panel page/dialog 挂载，归 task-08 范围内衔接）；fork-confirm-modal.tsx 新组件（新 API）。
- task-08: 组件 props 可选扩展——worker-session-overlay.tsx 增可选 title prop（既有调用方 team-task-block.tsx 不传=默认「分身会话」零回归）；lineage-block.tsx 新组件（新 API）；session-list-panel.tsx 分组判定逻辑（内部，origin+fork_of 与 parent_session_id 双轨并行，无对外签名变更）。
