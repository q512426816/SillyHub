---
author: flow-machine-draft
created_at: 2026-10-16T03:35:02.975Z
---
# 任务注册表（Tasks）— 2026-10-15-server-logs-dockerfile-fix

- [x] task-01: Dockerfile 构建期预建 /data/logs 并 chown 给 app 用户（对齐 /data/spec-workspaces 既有惯例），容器启动后日志文件可正常创建写入
- [x] task-02: configure_logging 建目录/挂 FileWriter 失败时向 stderr 输出一条警告（含失败原因），不再无声降级
- [x] task-03: 聚焦测试（test_server_log_filer.py）全绿且补降级警告断言用例
