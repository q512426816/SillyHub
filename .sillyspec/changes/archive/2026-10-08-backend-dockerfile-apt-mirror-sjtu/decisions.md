---
author: flow-machine-draft
created_at: 2026-10-08T01:35:36.582Z
---
# 决策记录（Decisions）— 2026-10-08-backend-dockerfile-apt-mirror-sjtu

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：sjtu 源将来同样故障/限速（镜像站轮流抽风的先例：aliyun 2026-07-17、tuna 2026-10-08）——已在 Dockerfile 注释里留下完整的换源史与实测数据，下次故障按同模式 5 分钟内可再换。放弃的方案：① 原样重试（已试，两次死同层，tuna 服务端故障非瞬时抖动）；② 换 aliyun/ustc/huawei/http 官方源/deb.debian.org（实测同慢 ≈80KB/s，9.6MB 索引在 apt 超时内下不完）；③ 走本机 Clash 代理（7897 实测 2MB/33s 无改善）；④ 增大 apt 重试次数（传输中断形态重试无效，且要改同一行不如换源）。
