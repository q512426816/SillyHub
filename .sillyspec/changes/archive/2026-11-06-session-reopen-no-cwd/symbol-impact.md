# 符号影响面报告

> tasks.md 内容指纹（生成时）: 0ef635f72cbb64aa——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——`_routeSessionResume`（sillyhub-daemon/src/daemon.ts:9499 起）构造 PersistedSessionRecord 的 cwd 字段取值逻辑由单级改三级链，方法签名与 record 类型形状不变；受影响调用点 restoreAndReconnect 在任务范围外零改动。
- task-02: 签名级变更（参数可选化扩展）——hub-client.ts `notifySessionReady(sessionId, opts?)` 与 `confirmReconnected(sessionId, opts)` 加可选 cwd 参数；daemon.ts:1192 接口声明同步扩展。向后兼容（既有调用点不传 opts 零改动编译），受影响调用点仅本任务三处发送点，均在任务范围内。
- task-03: 签名级变更（公开符号删除）——backend/app/modules/daemon/session/service/errors.py 删 `DaemonSessionNoCwd` 异常类（导出面收缩）；受影响调用点 session_lifecycle.py:136 raise（随块同删）+ 测试 import（随用例改写），全在任务范围内；仓内其余 import 需 grep 清零（卡内已列）。
- task-04: 无签名级变更——resume_payload 为函数内局部 dict 构造（session_lifecycle.py:296 与 sweep.py 恢复路径同款），字段条件化不改任何函数签名/DTO；受影响消费方 daemon `_routeSessionResume` 的 raw.cwd 读取对缺键已容错（?? 兜底），在 task-01 范围内。
- task-05: 签名级变更（DTO 字段+端点参数扩展）——backend/app/modules/daemon/schema.py `SessionRuntimeRequest` 加可选字段 cwd；notify.py `notify_session_ready` 端点函数加可选 Body 参数（`Optional[SessionReadyRequest] = None`）、`confirm_session_reconnected` 行为扩展无签名变化。OpenAPI 面变化由 task-06 gen:types 承接；共享 SessionRuntimeRequest 的 mark-recovery-failed 端点 OpenAPI 同步暴露新键（审查确认按忽略处理，daemon 不发）。
- task-06: 无签名级变更——纯生成物（api-types.ts ×2 + openapi.json）由 schema 演进驱动重新导出，无手写符号改动。
