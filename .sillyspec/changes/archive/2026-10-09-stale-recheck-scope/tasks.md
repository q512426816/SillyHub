---
author: flow-machine-draft
created_at: 2026-10-08T17:21:38.088Z
---
# 任务注册表（Tasks）— 2026-10-09-stale-recheck-scope

- [x] task-01: 复扫链只追踪启动清理时因日志新鲜而跳过的轮，启动后新开的轮不再进入复扫判死面
- [x] task-02: 复扫判死前叠加 daemon 活性守卫：daemon 在线或心跳宽限窗内则保持 running 继续追踪（对齐 patrol 判死段双条件语义），run→daemon 链路不可解析时退回纯日志 recency 语义
- [x] task-03: 复扫循环单次迭代异常不再终止整链：逐迭代捕获记日志，连续失败超上限才放弃并留 error 痕迹
- [x] task-04: 行锁收窄：启动清理与复扫都先无锁判日志活性，仅对确定要判死的轮 FOR UPDATE 重读，并逐轮提交即时释放锁
- [x] task-05: 既有 liveness/错误码/并发收口守卫用例保持绿；新增复扫范围、daemon 活性、循环韧性用例先红后绿
