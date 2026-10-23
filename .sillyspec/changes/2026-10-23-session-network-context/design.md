---
author: qinyi
created_at: 2026-10-23 09:21:51
generated_by: sillyspec-design-init
scale: small  # Step 8 精判（2026-10-14 反判据口径）：虽有 daemon∥后端数据面一个可真并行簇，但全部改动单会话上下文吃得下（多数为一行级参数穿透+一个引擎文件），Wave 两条件不同时成立 → small 收编轻量道；早期印象"跨模块+迁移=large"系旧口径，不适用
---

# 设计文档（Design）— 2026-10-23-session-network-context

## 背景

用户在会话中问「怎么访问项目地址」类问题时，agent 不知道用户当前的网络环境（用户浏览器来源 IP、执行机器与用户是否同一局域网、机器的局域网 IP 是什么），只能瞎猜地址——跨网段时给出不可达地址、同网段时又不知道该用哪个 IP 拼。平台的每个用户机器上都跑着 daemon（天然的本机网络传感器），后端也能看到每次请求的来源 IP，但这两路信息目前都没有进入 agent 的上下文：前导块按 D-002 决策仅会话首轮拼装（backend/app/modules/daemon/session/context.py:460），daemon 心跳体不含网卡信息（sillyhub-daemon/src/hub-client.ts:804-879），后端除 auth 登录审计外不取客户端 IP（backend/app/modules/auth/router.py:48-61）。

本变更让 agent 在用户每次提问时都能看到【网络环境】段：用户来源 IP、会话可用机器与用户的同网段判定结果、以及拼访问地址所需的机器局域网 IP 事实，从而给出正确可达的访问方式（D-001/D-009）。

## 设计目标

1. 用户每次提问时，dispatch prompt 中含实时【网络环境】段（每轮通道，非首轮一次）。
2. 同网段判定以**后端观测的 daemon 请求来源 IP** 为 ground truth（不可伪造），daemon 自报网卡列表用于拼访问地址（D-002）。
3. 判定结论措辞诚实：同网段=「大概率可直连」，不承诺 100%；四种降级态（Docker 网桥特征/无网卡数据/全离线/纯 IPv6）各有明确文案，禁止误导。
4. 注入段有去重机制控制 token 成本：内容快照变化才重注 + 60s 最短间隔兜底（D-006）。
5. 机器可见范围 = 用户本会话可用机器（本人绑定 + 共享借用），不扩大信息面（D-005）。

## 非目标

- 前端「与您同网段」徽标及任何 frontend/src 改动（二期，D-003）。
- IPv6 同网段判定（IPv6 网卡照常上报存储，仅标注「未参与判定」，D-003）。
- 公网可达性探测（不做主动 ping/端口探测，判定纯基于网段计算）。
- 跨 VLAN/多层 NAT 的精确可达性判定（文案措辞兜底）。
- agent 按需查询 MCP 工具（方案 B，已否决 D-010）；前端展示方案（方案 C，已否决 D-011）。

## 拆分判断

单一功能链（daemon 采集 → 后端观测落库 → CIDR 判定 → 每轮注入），跨 backend/sillyhub-daemon 两子项目但语义内聚、接口只有心跳体一个契约面，一次变更交付；无批量模式特征（非模板×数据）。不拆分。

## 总体方案

### Phase 1 — daemon 侧采集上报

新增 `sillyhub-daemon/src/network-info.ts`：`collectNetworkInterfaces()` 调 `os.networkInterfaces()`，剔除 internal 回环与无 cidr 的条目，产出 `[{name, ip, cidr, family}]`（IPv4+IPv6 都保留，判定层只消费 IPv4）。心跳循环 `_sendHeartbeatOnce` 每跳采集并入心跳体新字段 `network_interfaces`（hub-client.ts `heartbeat()` 签名加参 + `HeartbeatBody` 类型扩展）。同步更新四个参数个数钉子测试文件（D-007）。

### Phase 2 — 后端数据面：观测 + 落库 + 迁移

- auth 的 `_client_ip`（XFF 最右段→remoteAddress，backend/app/modules/auth/router.py:48-61）抽为共享工具 `backend/app/core/client_ip.py`，auth 行为不变（纯重构）。
- 心跳端点（backend/app/modules/daemon/router/heartbeat.py:300）与注册端点（backend/app/modules/daemon/router/version.py）注入 `Request`，用共享工具观测 daemon 请求来源 IP。
- `daemon_instances` 新增 JSON 列 `network_info`，形状 `{observed_ip: str|null, interfaces: [{name, ip, cidr, family}]}`；一次 Alembic 迁移（链尾锚测试前移一行，D-008）。
- 语义（与既有心跳字段语义对齐）：`observed_ip` 每跳心跳/注册刷新直写；`network_interfaces` 走「出现即整写、缺席=保留旧值」语义（兄弟字段 `sillyspec_version` 先例，backend/app/modules/daemon/router/heartbeat.py:339-347）——老 daemon 不发该字段不清数据。

### Phase 3 — 判定引擎 + 每轮注入

新增 `backend/app/modules/daemon/session/network_context.py` 判定引擎：

1. **输入**：本轮用户请求来源 IP（含是否经 XFF 标记）、会话可用机器清单——会话 runtime 所属 daemon + workspace_member_runtimes 本人绑定 + **grants 表 enabled 借用集**（与派发链路 `resolve_granted_daemon_for_borrow` 同源口径，D-005@v2）。
2. **判定**（Python 标准库 `ipaddress`，仅 IPv4）：
   - 主判定：user_ip 与各机器 `observed_ip` 是否同网段（按 observed_ip 所在网卡 cidr 归属计算；observed_ip 无网卡数据时按 /24 与 /16 双档近似，文案标注「低置信（无网卡数据，按默认掩码近似）」）。
   - 地址选择：拼访问地址优先选与 observed_ip 同网段的网卡 IPv4（规避 Windows 虚拟网卡干扰）；都不匹配则列出全部 IPv4 并标注不确定。
   - 降级矩阵（四态）：user_ip 缺失→「无法判定」；无 XFF 且 user_ip ∈ 172.16.0.0/12（容器网桥特征）→「服务端疑似容器直连，无法判定真实用户网段」；机器 network_info 为 NULL（无观测 IP）→「无网络数据（daemon 尚未上报来源 IP 与网卡），无法判定网段或给出访问地址」；无网卡掩码（有观测 IP 但无可用 cidr，NAT 出口等）→「仅观测 IP 判定，低置信，拼地址信息不可用」；全部机器离线→「在线机器：无」。纯 IPv6 user_ip→「未参与判定」。
3. **去重**：Redis（key `session:netenv:<session_id>`，TTL 7 天）存「上次**已注入**内容 hash + 注入时间戳」；当前渲染与上次注入相同→不注入；不同且距上次注入 ≥60s→注入并更新快照；<60s→不注入也**不更新**快照，下一轮重比、到点补注（变化不丢失，D-013）；Redis 故障降级为每轮注入（正确性优先，与 auth 缓存降级约定同向）。
4. **注入**：以 `NetworkContextBlock(user_ip, has_xff)` 数据块镜像 `page_context` 的**完整穿透面**——service/__init__.py 方法面（:387/:528/:617/:671 四处）、control.py（:103/:698）、create.py（:74）、inject.py（:69/:246/:433/:898）与 queue.py（入队序列化 :304、steering 重放 :776-823、排队派发重放 :945-986）——渲染点在 dispatch prompt 组装处调引擎；首轮（create 路径）不走去重强制注入一次建立上下文。排队/steering 轮：入队时随条目序列化 user_ip/has_xff（queue.py:304 同款先例），派发时用存储 IP + 实时机器数据**重算判定**注入，不重放旧判定文本（D-012——queue.py:774「只重放不注入」曾是审查修复缺陷，不重蹈）。

注入段格式（示意）：

```
【网络环境】
- 用户当前来源 IP：192.168.1.23（内网）
- 在线机器：qinyi-pc（192.168.1.10，与用户同网段，大概率可直连该机服务）
  build-server（10.0.3.5，与用户不同网段，用户浏览器无法直连）
- 指引：建议访问地址用同网段机器的 IP 拼（端口按服务实际监听）；跨网段如实告知不可直连，禁止猜测公网地址。
```

机器数超 10 台截断为「等 N 台」。IP 与判定结论是事实陈述，不构成对用户的指令。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:backend/app/core/client_ip.py | 共享客户端 IP 提取：`client_ip_from_request(request) -> str \| None` + `has_forwarded_for(request) -> bool`。数据流：producer=auth 登录审计 / daemon 心跳·注册端点（Request 注入）→ 本工具归一（XFF 最右段 strip→remoteAddress）→ consumer=登录限流审计（既有迁用）+ daemon observed_ip 落库 |
| 修改 | backend/app/modules/auth/router.py | `_client_ip` 改调共享工具，行为不变（纯重构，BS-3 语义保留） |
| 修改 | backend/app/modules/daemon/model.py | DaemonInstance 新增 `network_info: dict \| None` JSON 列（NULL 允许） |
| 新增 | NEW:backend/migrations/versions/20261023090000_add_daemon_instances_network_info.py | Alembic 迁移加列（`add_column` 可空无默认，接续 20261022100000） |
| 新增 | NEW:backend/migrations/versions/20261023090100_add_queued_messages_network_context.py | 排队表加 network_context 快照列（task-08 落实 D-012：入队存 user_ip/has_xff，派发实时重算） |
| 修改 | backend/app/modules/agent/model.py | AgentSessionQueuedMessage 新增 network_context JSON 列（D-012 入队快照） |
| 修改 | backend/app/modules/daemon/router/session_crud.py | create/inject 两端点注入 Request 构造 NetworkContextBlock（首轮强制/每轮去重）。数据流：producer=Request 源 IP（client_ip 工具）→ NetworkContextBlock → facade → service 链 → consumer=dispatch prompt |
| 修改 | backend/tests/test_align_platform_change_events_migration.py | 链尾锚 head 常量前移一行（钉子①） |
| 修改 | backend/app/modules/daemon/router/heartbeat.py | DaemonHeartbeatRequest 加可选 `network_interfaces: list[HeartbeatNetworkInterface] \| None`；端点注入 Request 取 observed_ip 传服务层。数据流：producer=daemon network-info.ts → HTTP 心跳体 → pydantic（缺省 None）→ heartbeat_daemon → daemon_instances.network_info → consumer=network_context.py 判定引擎 |
| 修改 | backend/app/modules/daemon/runtime/service.py | `heartbeat_daemon` 加 `network_interfaces`/`observed_ip` 参数：observed_ip 每跳直写，network_interfaces 出现即整写/缺席保留（注释锚定语义） |
| 修改 | backend/app/modules/daemon/service.py | DaemonService facade 同步 `inject_session` 的 network_context 参数与透传（漏透传会 500——facade 显式签名惯例） |
| 修改 | backend/app/modules/daemon/router/version.py | 注册端点观测来源 IP 首写 network_info.observed_ip（daemon 首登即有观测 IP） |
| 新增 | NEW:backend/app/modules/daemon/session/network_context.py | 判定引擎 + 【网络环境】段渲染 + Redis 快照去重。数据流：producer=用户请求 IP（client_ip 工具）+ daemon_instances.network_info → 引擎计算 → consumer=inject 通道 dispatch prompt（→ daemon SDK 会话首条 user 消息，agent 可见） |
| 修改 | backend/app/modules/daemon/session/service/inject.py | `inject_session`/`_inject_into_session` 加 `network_context: NetworkContextBlock \| None = None` 参数透传（镜像 page_context 先例 inject.py:69/246/433/898） |
| 修改 | backend/app/modules/daemon/session/service/control.py | 用户提问控制路径透传 NetworkContextBlock（后续轮，组装点走去重渲染） |
| 修改 | backend/app/modules/daemon/session/service/create.py | 首轮 dispatch prompt 组装调引擎强制注入一次（首轮不去重） |
| 修改 | backend/app/modules/daemon/session/service/__init__.py | 方法面透传 NetworkContextBlock（:387/:528/:617/:671 四处，镜像 page_context 面位） |
| 修改 | backend/app/modules/daemon/session/service/queue.py | 入队条目序列化 user_ip/has_xff（:304 同款先例）；steering/排队派发重放时实时重算判定注入（D-012，不重放旧文本） |
| 新增 | NEW:backend/tests/modules/daemon/test_network_context.py | 判定引擎单测：同段/跨段/四态降级矩阵/IPv6 不判定/地址选择优先同段/快照去重与 60s 间隔/Redis 故障降级 |
| 新增 | NEW:sillyhub-daemon/src/network-info.ts | `collectNetworkInterfaces(): NetworkInterfaceInfo[]`——os.networkInterfaces 过滤（internal/无 cidr 剔除，IPv4+IPv6 保留） |
| 修改 | sillyhub-daemon/src/hub-client.ts | HeartbeatBody 加 `network_interfaces`；`heartbeat()` 签名加尾参 |
| 修改 | sillyhub-daemon/src/daemon.ts | `_sendHeartbeatOnce` 调 collectNetworkInterfaces 平铺传参 |
| 修改 | sillyhub-daemon/tests/daemon-heartbeat-pending.test.ts | 参数个数钉子 N→N+1（钉子②） |
| 修改 | sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts | 同上 |
| 修改 | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | 同上（6 处） |
| 修改 | sillyhub-daemon/tests/integration/selfupdate-scenarios.test.ts | 同上（2 处） |
| 新增 | NEW:sillyhub-daemon/tests/network-info.test.ts | 采集过滤单测（回环剔除/无 cidr 剔除/IPv4+IPv6 保留/多网卡） |
| 修改 | .claude/skills/deploy-to-server/SKILL.md | nginx 段补注：X-Forwarded-For 转发头是网络环境判定硬依赖，缺则用户源 IP 退化为网桥地址、判定降级 |

## 接口定义

```python
# backend/app/core/client_ip.py
def client_ip_from_request(request: Request) -> str | None:
    """XFF 最右段（逐段 strip 取最后非空，防最左伪造——auth/router.py:48-61 同语义）
    → request.client.host → None。"""

def has_forwarded_for(request: Request) -> bool:
    """是否存在非空 X-Forwarded-For 头（区分 nginx 转发与容器直连）。"""

# backend/app/modules/daemon/session/network_context.py
@dataclass(frozen=True)
class NetworkContextBlock:
    """随提问轮穿透注入链的数据块（镜像 PageContextCreateBlock 形态；
    queue 入队序列化存储，派发时携存储值调引擎实时渲染）。"""
    user_ip: str | None
    has_xff: bool

@dataclass(frozen=True)
class MachineNetworkInfo:
    daemon_id: str
    name: str            # display_alias or hostname（口径同 grants/queries.py:335）
    observed_ip: str | None
    interfaces: list[dict]  # [{name, ip, cidr, family}]

async def network_context_for_turn(
    *, session_id: uuid.UUID, user_ip: str | None, has_xff: bool,
    machines: list[MachineNetworkInfo], first_turn: bool = False,
) -> str | None:
    """渲染【网络环境】段；快照与上轮相同且非首轮 → None（不注入）；
    Redis 不可用 → 恒返回文本（每轮注入降级）。"""

def render_network_env(user_ip: str | None, has_xff: bool,
                       machines: list[MachineNetworkInfo]) -> str:
    """纯函数：判定 + 渲染（四态降级矩阵见总体方案 Phase 3）。"""
```

```python
# backend/app/modules/daemon/router/heartbeat.py（DaemonHeartbeatRequest 扩展）
class HeartbeatNetworkInterface(BaseModel):
    name: str
    ip: str
    cidr: str | None = None
    family: str  # "IPv4" | "IPv6"

# DaemonHeartbeatRequest 新增字段：
network_interfaces: list[HeartbeatNetworkInterface] | None = None  # None=保留旧值，出现即整写
```

```typescript
// sillyhub-daemon/src/network-info.ts
export interface NetworkInterfaceInfo {
  name: string; ip: string; cidr: string; family: 'IPv4' | 'IPv6';
}
export function collectNetworkInterfaces(): NetworkInterfaceInfo[];
```

对外零新增端点；心跳体为唯一契约面扩展（向后兼容可选字段）。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| daemon register | daemon | backend | daemon_local_id, hostname, providers（既有） | upsert daemon_instances；新增 observed_ip 首写 network_info |
| daemon heartbeat | daemon | backend | daemon_local_id, providers（既有必填）；network_interfaces（新增可选，None=保留） | last_heartbeat_at 刷新；observed_ip 每跳直写；network_interfaces 出现即整写 |
| user submit message（每轮） | frontend | backend | sessionId, content（既有） | dispatch prompt 变化时附加【网络环境】段（首轮强制，后续轮快照去重） |

表中三事件分别对应任务：register/heartbeat → Phase 1/2 任务；submit message 注入 → Phase 3 任务；均有对应测试任务（生命周期必需字段出现在上述 DTO/interface 定义中）。

## 数据模型

`daemon_instances` 新增列：

```
network_info  JSON  NULL    -- {observed_ip: str|null, interfaces: [{name, ip, cidr, family}]}
```

无其它表结构变更；Redis 新增 key `session:netenv:<session_id>`（hash + 时间戳，TTL 7 天，自动过期无清理任务）。

## 兼容策略（brownfield 必填）

- **老 daemon 混跑**：心跳体无 `network_interfaces` → None=保留旧值不清数据；observed_ip 仍由后端从请求观测刷新（零 daemon 改动也有观测 IP，判定可用）。
- **未配置/无数据**：network_info 为 NULL → 注入段按「仅观测 IP 判定」降级文案，不报错不阻断会话。
- **auth 重构**：`_client_ip` 抽工具为纯重构，登录审计/限流行为逐字节不变（BS-3 最右段语义保留）。
- **回退路径**：字段全部可空、注入段纯文本追加——回滚代码即恢复原状；迁移回滚 = drop column（本项目未上线，不要求历史数据兼容）。
- **不改变的 API/表结构**：除 daemon_instances 加一列外零 schema 变更；既有心跳字段语义零改动。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 心跳加参后四个钉子测试文件漏跟致 CI 红（历史上 machine-id 漏跟两次实证） | P0 | 文件清单显式列四文件为独立修改行；聚焦测试跑全四文件后再 --done |
| R-02 | Windows 虚拟网卡（WSL/Hyper-V vEthernet 172.x）干扰拼地址选择 | P1 | 地址选择优先与 observed_ip 同网段的网卡；都不匹配列全部 IPv4 并标注不确定，交 agent 如实转述 |
| R-03 | 部署侧 nginx 未配 XFF 时用户源 IP 退化为网桥地址，判定误导 | P1 | 无 XFF + 172.16/12 网桥特征 → 显式「无法判定」降级；deploy skill 文档标注 XFF 为硬依赖 |
| R-04 | 用户网络频繁切换（热点/VPN）致注入抖动 | P2 | 60s 最短重注间隔兜底（D-006） |
| R-05 | 会话日志留有内网 IP 痕迹（隐私面） | P2 | 接受：内网 IP 低敏（无路由意义）；注入范围仅本人会话可见机器（D-005），共享 IP 可见性经用户确认（D-004） |
| R-06 | 机器多的工作区注入段过长烧 token | P2 | 段内机器清单截断 top 10 + 「等 N 台」；快照去重常态只注一两次 |
| R-07 | 多实例 backend 下 Redis 快照竞态（双写） | P2 | 接受：快照仅优化用途，竞态最坏多注一次，无正确性影响 |

无长驻进程/外部资源新增，生命周期面不适用：心跳循环为既有设施，判定引擎请求时无状态计算，Redis key TTL 自动过期。

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 每轮注入不动首轮策略 | 总体方案 Phase 3 注入通道；FR-01 | 已覆盖 |
| D-002@v1 双源判定（观测 IP 为 ground truth） | Phase 2 观测 + Phase 3 主判定；FR-02/FR-03 | 已覆盖 |
| D-003@v1 一期范围（无前端/仅 IPv4） | 非目标；FR 全域边界 | 已覆盖 |
| D-004@v1 共享机器 IP 对借用人可见 | Phase 3 机器清单口径（绑定+共享）；FR-04 | 已覆盖 |
| D-005@v1 可见性复用既有口径 | 已被 D-005@v2 修正（member_runtimes.shared 口径过时） | superseded |
| D-005@v2 共享口径 = grants 表 | Phase 3 输入（绑定+grants 借用集）；FR-04 | 已覆盖 |
| D-012@v1 排队/steering 注入语义 | Phase 3 注入第 4 点 + 文件清单 queue.py 行；FR-01/FR-04 | 已覆盖 |
| D-013@v1 快照到点补注语义 | Phase 3 去重第 3 点；FR-05 | 已覆盖 |
| D-006@v1 快照去重 + 60s 间隔 + Redis 降级 | Phase 3 去重；FR-05 | 已覆盖 |
| D-007@v1 心跳钉子四文件同步 | 文件变更清单四行；FR-02 | 已覆盖 |
| D-008@v1 JSON 单列 + 迁移链尾锚前移 | 数据模型 + 文件清单；FR-03 | 已覆盖 |
| D-009@v1 选定方案 A 自动注入 | 总体方案全域；FR-01..FR-06 | 已覆盖 |
| D-010@v1 落选方案 B（rejected） | 非目标末条 | 已覆盖（防复潮条目） |
| D-011@v1 落选方案 C（rejected） | 非目标末条 | 已覆盖（防复潮条目） |

无未解决决策；多裁定组合推演：D-002（双源）×D-008（列可 NULL）×D-006（去重）叉乘四态（观测IP有/无 × 网卡有/无 × Redis 有/无）均落在 Phase 3 降级矩阵与 R-07 内，无死锁组合。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale——scale 留 Step 8 落值）
- [x] 引用所有当前版本 D-001@v1..D-011@v1（决策追踪表全覆盖，状态列均为已覆盖）
- [x] 涉及 daemon/heartbeat/session 关键词 → 已含「生命周期契约表」（三事件×发起方×接收方×必需字段×状态变化）
- [x] UI 原型分级：跳过（纯后端 + daemon 采集，无任何界面变化；已在 Step 5 向用户声明并确认）
- [x] 自审全部通过，无未闭合存疑标记；新建文件路径均带 NEW: 前缀；新增字段已标 producer→consumer 数据流
