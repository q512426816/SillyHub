---
author: flow-machine-draft
created_at: 2026-10-27T03:42:52.047Z
---
# 需求规格（Requirements）— 2026-10-27-netdata-prod-monitoring

## 功能需求

### FR-01: 腾讯云生产服务器上 Netdata 以 systemd 服务稳定运行（stable 通道、遥测关闭）

- 必须：在 124.222.127.242 上以官方 kickstart 脚本安装 Netdata（`--stable-channel --disable-telemetry`），装后 `systemctl is-active netdata` 必须返回 `active` 且开机自启（`is-enabled` 返回 `enabled`）。

#### 场景：主路径

- Given 生产服务器（Ubuntu 24.04，内存余量 ≥5G）当前无 Netdata
- When 执行 kickstart 安装（stable 通道、关闭遥测）
- Then systemd 服务 active + enabled，`curl -s http://127.0.0.1:19999/api/v1/info` 返回 JSON（进程含 netdata）

### FR-02: Netdata Web 仅绑定 127.0.0.1，公网 19999 端口实测不可达

- 必须：Netdata Web 接口仅监听 `127.0.0.1:19999`（netdata.conf `[web] bind to = 127.0.0.1`），禁止对公网网卡监听；验收时从办公网实测 `124.222.127.242:19999` 连接必须失败（超时/拒绝）。

#### 场景：公网探测兜底

- Given Netdata 已运行且仅绑回环
- When 从办公网（公网出口）对 124.222.127.242:19999 发起 TCP 连接
- Then 连接不通（面板无密码认证，公网可达即安全事故）

### FR-03: deploy.md 模块文档补充 Netdata 排查条目（SSH 隧道访问命令、容器级指标入口、安全边界）

- 必须：`.sillyspec/docs/multi-agent-platform/modules/deploy.md` 的「注意事项」节新增一条生产监控条目，包含：SSH 隧道访问命令（`ssh -L 19999:127.0.0.1:19999`）、面板本机地址、逐容器（backend/frontend/postgres/redis/minio）指标入口说明、以及「禁止在腾讯云安全组放行 19999」的安全边界声明。

#### 场景：后续会话排查生产问题

- Given 生产出现性能问题（卡顿/OOM/单容器资源打满）
- When 任意后续会话读 deploy.md 模块文档
- Then 能直接拿到隧道命令与面板入口完成秒级现场排查，无需重新调研

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：生产服务器宿主层操作（systemd 服务安装），无仓库测试面；验收走 SSH 实测留证（is-active/is-enabled/curl 本机面板）。
FR-02: 不适用：网络边界实测项（公网端口探测），无仓库测试面；验收走办公网 TCP 探测不可达留证。
FR-03: 不适用：纯文档条目补充（deploy.md 模块卡），无代码路径；验收走文档内容对照（条目含隧道命令/容器入口/安全边界三要素）。
