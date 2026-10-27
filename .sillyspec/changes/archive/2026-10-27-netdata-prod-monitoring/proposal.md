---
author: flow-machine-draft
created_at: 2026-10-27T03:42:52.047Z
---
# 提案书（Proposal）— 2026-10-27-netdata-prod-monitoring

## 动机

任务原话转写：腾讯云生产机部署 Netdata 秒级监控
腾讯云生产服务器 124.222.127.242 目前无实时监控，出问题只能靠 docker stats 与日志事后翻，缺秒级现场（瞬时抖动、OOM、单容器资源打满）。

成功标准：
- 腾讯云生产服务器上 Netdata 以 systemd 服务稳定运行（stable 通道、遥测关闭）
- Netdata Web 仅绑定 127.0.0.1，公网 19999 端口实测不可达
- deploy.md 模块文档补充 Netdata 排查条目（SSH 隧道访问命令、容器级指标入口、安全边界）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 腾讯云生产服务器上 Netdata 以 systemd 服务稳定运行（stable 通道、遥测关闭）
2. Netdata Web 仅绑定 127.0.0.1，公网 19999 端口实测不可达
3. deploy.md 模块文档补充 Netdata 排查条目（SSH 隧道访问命令、容器级指标入口、安全边界）

## 成功标准（可验证）

1. 腾讯云生产服务器上 Netdata 以 systemd 服务稳定运行（stable 通道、遥测关闭）
2. Netdata Web 仅绑定 127.0.0.1，公网 19999 端口实测不可达
3. deploy.md 模块文档补充 Netdata 排查条目（SSH 隧道访问命令、容器级指标入口、安全边界）
