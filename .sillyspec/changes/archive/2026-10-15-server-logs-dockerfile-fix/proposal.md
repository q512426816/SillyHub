---
author: flow-machine-draft
created_at: 2026-10-16T03:35:02.975Z
---
# 提案书（Proposal）— 2026-10-15-server-logs-dockerfile-fix

## 动机

任务原话转写：动机：服务器信息页日志卡在生产容器显示「日志文件尚未生成」——容器内 repo_root 推导到 /，默认日志路径成 /data/logs，而镜像以非 root 用户 app 运行且构建期未预建 /data/logs（/data 属 root），mkdir 权限被拒后 FileWriter 按设计静默降级 stderr-only，页面无从知晓原因。
成功标准：
- Dockerfile 构建期预建 /data/logs 并 chown 给 app 用户（对齐 /data/spec-workspaces 既有惯例），容器启动后日志文件可正常创建写入
- configure_logging 建目录/挂 FileWriter 失败时向 stderr 输出一条警告（含失败原因），不再无声降级
- 聚焦测试（test_server_log_filer.py）全绿且补降级警告断言用例

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. Dockerfile 构建期预建 /data/logs 并 chown 给 app 用户（对齐 /data/spec-workspaces 既有惯例），容器启动后日志文件可正常创建写入
2. configure_logging 建目录/挂 FileWriter 失败时向 stderr 输出一条警告（含失败原因），不再无声降级
3. 聚焦测试（test_server_log_filer.py）全绿且补降级警告断言用例

## 成功标准（可验证）

1. Dockerfile 构建期预建 /data/logs 并 chown 给 app 用户（对齐 /data/spec-workspaces 既有惯例），容器启动后日志文件可正常创建写入
2. configure_logging 建目录/挂 FileWriter 失败时向 stderr 输出一条警告（含失败原因），不再无声降级
3. 聚焦测试（test_server_log_filer.py）全绿且补降级警告断言用例
