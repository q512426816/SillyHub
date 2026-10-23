---
author: qinyi
created_at: 2026-10-23 09:09:38
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
用户在会话中问「怎么访问项目地址」类问题时，agent 不知道用户的网络环境（浏览器来源 IP、执行机器与用户是否同局域网、机器的局域网 IP），只能瞎猜地址。平台每台用户机器都跑着 daemon（天然本机网络传感器），后端能看到请求来源 IP，但这两路信息都没进入 agent 上下文。本变更把网络环境事实实时注入 agent 上下文，让 agent 给出正确可达的访问方式。

## 关键问题
1. 前导块按 D-002 决策仅会话首轮拼装，用户会话中途切换网络（WiFi/VPN/热点）后信息过期；唯一每轮注入先例是【页面上下文】，网络环境需要同款通道。
2. 后端除 auth 登录审计外不取客户端 IP（backend/app/modules/auth/router.py:48-61），daemon 心跳体不含网卡信息——两路数据源都缺。
3. 判定必须诚实：跨 VLAN/多层 NAT 会误判、绕过 nginx 直连容器时源 IP 退化为网桥地址，若无降级文案会产生误导性结论。

## 变更范围
- daemon：心跳循环采集 `os.networkInterfaces()` 过滤后入心跳体新字段 `network_interfaces`（含四个钉子测试文件同步）。
- backend：`_client_ip` 抽共享工具；心跳/注册端点观测来源 IP；`daemon_instances` 新增 `network_info` JSON 列（一次 Alembic 迁移）；CIDR 同网段判定引擎 + 【网络环境】段每轮注入（快照去重 + 60s 间隔 + Redis 故障降级）。
- 文档：deploy skill 标注 nginx XFF 转发头为判定硬依赖。

## 不在范围内（显式清单）
- 不做前端「与您同网段」徽标及任何 frontend/src 改动（二期）
- 不做 IPv6 同网段判定（IPv6 仅上报存储标注）
- 不做公网可达性主动探测（ping/端口扫描）
- 不做 agent 按需查询 MCP 工具（方案 B 已否决）与前端展示方案（方案 C 已否决）

## 成功标准（可验证）
- 用户提问后 dispatch prompt 中出现【网络环境】段，含用户来源 IP 与各在线机器的同网段判定结论；机器离线/网卡缺数据/网桥特征时为对应降级文案，无误导性结论。
- daemon 心跳体携带过滤后的网卡列表；老 daemon（不发该字段）心跳正常且旧数据保留，判定降级不报错。
- 四个心跳钉子测试文件断言同步更新且聚焦测试全绿；Alembic 链尾锚测试前移一行通过。
- 同网络环境下连续提问不重复注入（快照去重生效）；切换网络后下一问自动更新判定。
