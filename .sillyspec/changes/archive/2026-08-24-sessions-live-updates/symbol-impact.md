# 符号影响面报告

> tasks.md 内容指纹（生成时）: 3208a22ec6ba5fa2——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。

- task-01: 纯新增模块 session_events.py（新函数 publish_sessions_changed + 常量），无既有签名变更；调用点=后续 task-02/03/04 的新增 import，范围内。
- task-02: session/service.py 仅在既有方法体内追加 await publish 调用与 import；无方法签名/DTO 变更；受影响调用点（router 层调 create_session/end_session 等）零感知，范围内。
- task-03: run_sync/service.py、sweep.py、lease_service.py、platform_sync/service.py、agent/service.py、agent/placement.py 均为方法体内追加 await publish + import；无签名级变更，范围内。
- task-04: daemon/router.py 新增路由函数 stream_sessions_changed（新符号，非改既有签名）；既有路由零改动；范围内。
- task-05: daemon.ts 新增导出函数 subscribeAgentSessionsEvents（新符号）；RECONNECT_BACKOFF_MS 由 streamSession 函数内局部 const 提升为模块级导出（声明位置变更，streamSession 内引用同步改指模块级，无行为变化，唯一允许触碰点已在卡片声明）；范围内。
- task-06: sessions-portal.tsx 仅追加 useEffect + import；无签名级变更，范围内。
- task-07: 文档与验证产物，无签名级变更。
