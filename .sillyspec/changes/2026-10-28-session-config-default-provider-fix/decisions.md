# 决策记录

## D-001@v1 会话内供应商/模型切换时序保持「agent 接收到新消息时才切换」，不打断运行中轮次
用户拍板（2026-10-28）：忙轮场景暂存配置随排队消息派发时生效（daemon reloadWithConfig 先重载配置后喂 prompt）；不实现「立即打断当前轮切换」。链路核查锚点见变更目录 queue-dispatch-audit.md。
