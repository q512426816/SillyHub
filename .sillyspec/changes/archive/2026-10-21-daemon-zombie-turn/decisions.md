# 决策记录

## D-001@v1 inject 被吞走「拒绝+回报」而非自动重推：重推在假阳性（引擎慢启动）下会双执行同一条消息，失败后用户重发更安全

## D-002@v1 四层收敛窗口：daemon 看门狗 90s（env 可调）→ 打断 no-op 秒级回报 → backend pending 清扫 300s（Settings 可配，对齐 inject 停等窗硬顶）→ 前端 15s 提示
