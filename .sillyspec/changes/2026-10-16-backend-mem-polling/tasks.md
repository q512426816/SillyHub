---
author: qinyi
created_at: 2026-10-16 09:53:00
---
# 任务清单（Tasks）

- [ ] task-01: 嵌入子进程封装（embedding_worker.py 三闸自灭+代理）+ 向量索引缓存 LRU 上限 + 配置键 + 单测
- [ ] task-02: spec 包 gzip 缓存全局字节帽 LRU（128MB）+ 并发用例
- [ ] task-03: 权限定时器会话治理（新短会话+全路径提交+事务边界收窄）+ 回归测试
- [ ] task-04: ws_hub 修复（_pending_rpcs 两泄漏径+disconnect 身份校验）+ 回归测试
- [ ] task-05: 附件先检后读（size 预检 413）+ WS 大消息日志截断（8KB）
- [ ] task-06: change-write WS 推送 backend 侧（protocol 常量+notify helper+四落库点接线）(depends_on: task-04)
- [ ] task-07: change-write WS 推送 daemon 侧（protocol.ts 对齐+分发+独立 120s 兜底）+ 契约测试 (depends_on: task-06)
- [ ] task-08: title_fallback 列+迁移回填（哨兵''）+session_crud 读列自愈+测试
- [ ] task-09: compose 配额重分配（1.85G）+oom_score_adj+entrypoint 兜底+部署文档 swappiness
- [ ] task-10: 服务器部署实测（内存回落/轮询请求率/列表耗时/idle-in-transaction 四指标）(depends_on: task-01,task-02,task-03,task-04,task-05,task-06,task-07,task-08,task-09)
