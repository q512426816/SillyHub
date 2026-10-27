---
author: flow-machine-draft
created_at: 2026-10-27T03:42:52.048Z
---
# 任务注册表（Tasks）— 2026-10-27-netdata-prod-monitoring

- [x] task-01: SSH 上 124.222.127.242 先查 netdata 残留（which netdata / dpkg），无残留则 kickstart 安装（--stable-channel --disable-telemetry）——验证：systemctl is-active netdata = active 且 is-enabled = enabled
- [x] task-02: 改 /etc/netdata/netdata.conf [web] bind to = 127.0.0.1 并 systemctl restart netdata——验证：ss -tlnp 显示仅 127.0.0.1:19999 监听，curl -s 127.0.0.1:19999/api/v1/info 返回 JSON
- [x] task-03: 从办公网实测 124.222.127.242:19999 TCP 连接不通（公网不可达兜底）——验证：Test-NetConnection/nc 探测失败
- [ ] task-04: deploy.md「注意事项」节补 Netdata 条目（SSH 隧道命令 + 容器级指标入口 + 禁止安全组放行 19999）——验证：条目含三要素，与 FR-03 对照
