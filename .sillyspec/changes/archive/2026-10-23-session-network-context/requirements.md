---
author: qinyi
created_at: 2026-10-23 09:09:38
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 会话用户 | 在前端会话页提问的人；其浏览器来源 IP 是判定的一端 |
| agent | 会话中被注入【网络环境】段的执行者，据此给出可达访问地址 |
| daemon | 用户机器上的守护进程；心跳自报网卡列表，其请求来源 IP 被后端观测 |
| 共享借用人 | 使用他人共享机器的会话用户；可见该机器内网 IP（D-004） |

## 功能需求

### FR-01: 每轮注入【网络环境】段
覆盖决策：D-001@v1, D-006@v1, D-009@v1, D-012@v1
Given 用户在会话中提问（首轮或后续轮）
When 后端组装本轮 dispatch prompt
Then 必须含实时【网络环境】段（用户来源 IP + 在线机器同网段判定 + 访问地址指引）；首轮必须注入一次建立上下文；后续轮按 FR-05 快照去重；Redis 不可用时必须降级为每轮注入（禁止因缓存故障丢失功能）

### FR-02: daemon 心跳上报网卡列表
覆盖决策：D-007@v1
Given daemon 心跳循环每跳执行
When 采集 `os.networkInterfaces()`
Then 心跳体必须携带 `network_interfaces: [{name, ip, cidr, family}]`（必须剔除 internal 回环与无 cidr 条目，IPv4+IPv6 保留）；四个钉子测试文件的参数个数断言必须在同一变更内 N→N+1 且聚焦测试通过

#### 场景：老 daemon 兼容
Given 未升级的旧版 daemon 发心跳（body 无 network_interfaces 字段）
When 后端落库
Then 必须保留旧值不清除（None=保留语义），判定降级不报错

### FR-03: 后端观测与落库
覆盖决策：D-002@v1, D-008@v1
Given daemon 发起注册或心跳请求
When 后端处理该请求
Then 必须以共享 IP 工具（XFF 最右段→remoteAddress，auth 语义原样迁移）观测来源 IP 并落 `daemon_instances.network_info`；`observed_ip` 每跳直写，`network_interfaces` 出现即整写、缺席保留旧值；一次 Alembic 迁移加列且链尾锚测试 head 常量必须前移一行

### FR-04: 机器可见性口径
覆盖决策：D-004@v1, D-005@v2, D-012@v1
Given 会话发生提问
When 组装机器清单
Then 必须仅含用户本会话可用机器（会话 runtime 所属 daemon + workspace_member_runtimes 本人绑定 + grants 表 enabled 借用集，与派发链路 resolve_granted_daemon_for_borrow 同源口径），禁止查全平台；共享机器的内网 IP 对借用人可见；清单超 10 台必须截断为「等 N 台」；忙轮排队/steering 轮派发时必须按入队存储的用户 IP + 实时机器数据重算判定注入（不重放旧判定文本）

### FR-05: 判定与降级文案
覆盖决策：D-002@v1, D-003@v1, D-006@v1, D-013@v1
Given 用户来源 IP 与机器网络数据
When 执行判定（仅 IPv4，标准库 ipaddress）
Then 同网段判定必须优先用观测 IP 所在网卡的 cidr 精确计算（禁止固定 /24——/16、/8 局域网不得误判）；无可用掩码时才退 /24 与 /16 双档近似并标注低置信；同网段=「大概率可直连」，禁止承诺 100%；拼地址必须优先选与观测 IP 同网段的网卡 IPv4；降级各有明确文案：无 XFF 且源 IP ∈ 172.16.0.0/12（容器网桥特征）→「无法判定」；机器无观测 IP（network_info 为 NULL）→「无网络数据」；有观测 IP 但无网卡掩码→「仅观测 IP 判定/低置信/拼地址不可用」；全部机器离线 →「在线机器：无」；纯 IPv6 →「未参与判定」；连续同快照必须跳过重注；快照变化但距上次注入 <60s 时不注入也不更新快照，下一轮仍不同且到点则必须补注（变化不得丢失）

### FR-06: 注入段指引措辞
覆盖决策：D-001@v1
Given 【网络环境】段被注入
When agent 回答访问地址类问题
Then 段内指引必须要求：用同网段机器 IP 拼地址（端口按服务实际监听）；跨网段如实告知不可直连；禁止猜测公网地址；IP 与判定为事实陈述，不构成对用户的指令

## 非功能需求
- 兼容性：老 daemon 不发新字段必须保留旧数据（None=保留）；auth `_client_ip` 迁移必须为纯重构行为不变；本项目未上线，无历史数据兼容负担
- 可回退：字段全部可空、注入段为纯文本追加，回滚代码即恢复原状；迁移回滚 = drop column
- 可测试：判定引擎必须为纯函数可单测（render_network_env）；降级矩阵四态各有可构造的输入用例；daemon 采集过滤有独立测试文件
- 性能：判定为请求时纯计算（无阻塞 IO 除 Redis 读写）；快照去重使常态每会话仅注入一两次，控制 token 成本
- 安全：注入范围仅本人会话可见机器；内网 IP 低敏（无公网路由意义）；XFF 取最右段防最左伪造（BS-3 语义保留）

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 每轮注入通道，不动 D-002 首轮策略 |
| D-002@v1 | FR-03, FR-05 | 双源判定，观测 IP 为 ground truth |
| D-003@v1 | FR-05 | 一期范围：无前端、仅 IPv4 判定 |
| D-004@v1 | FR-04 | 共享机器 IP 对借用人可见 |
| D-005@v1 | （superseded） | 已被 D-005@v2 修正 |
| D-005@v2 | FR-04 | 绑定查 member_runtimes + 共享查 grants 表（派发链路同源） |
| D-012@v1 | FR-01, FR-04 | 排队/steering 轮入队存 IP、派发实时重算 |
| D-013@v1 | FR-05 | 快照仅实际注入时更新，到点补注 |
| D-006@v1 | FR-01, FR-05 | 快照去重 + 60s 间隔 + Redis 降级 |
| D-007@v1 | FR-02 | 心跳钉子四文件同步 |
| D-008@v1 | FR-03 | JSON 单列 + 迁移链尾锚前移 |
| D-009@v1 | FR-01..FR-06 | 方案 A 自动注入（全局选定） |
| D-010@v1 | （rejected） | 落选方案 B，防复潮条目 |
| D-011@v1 | （rejected） | 落选方案 C，防复潮条目 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: backend/tests/modules/daemon/test_network_context.py「首轮强制注入/同快照跳过/Redis 故障降级每轮注入」
FR-02: sillyhub-daemon/tests/network-info.test.ts「过滤回环与无cidr/IPv4+IPv6保留」+ 四钉子文件断言同步用例（daemon-heartbeat-pending 等）「心跳参数个数 N+1」
FR-03: backend/tests/modules/daemon/test_network_context.py「落库语义：observed_ip 每跳直写/network_interfaces 出现即整写缺席保留（老 daemon 兼容场景）」+ backend/tests/test_align_platform_change_events_migration.py「链尾锚 head 前移」
FR-04: backend/tests/modules/daemon/test_network_context.py「机器清单仅绑定+grants 借用集/超10台截断/queue 派发实时重算」
FR-05: backend/tests/modules/daemon/test_network_context.py「同段/跨段/四态降级矩阵（网桥特征/无网卡数据/全离线/纯IPv6）/快照<60s 到点补注」
FR-06: backend/tests/modules/daemon/test_network_context.py「渲染文案断言：指引措辞与事实陈述边界」
