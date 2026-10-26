---
author: flow-machine-draft
created_at: 2026-10-26T05:54:46.929Z
---
# 需求规格（Requirements）— 2026-10-26-turn-phase-prod-fix

## 功能需求

### FR-01: 生产会话轮内 inject_received/first_event 阶段事件实际到达前端(生产会话验证,状态条翻动)

轮内阶段上报修复部署后，生产会话（真实用户经浏览器提问）必须在消息发出后于状态条看到 inject_received（消息已送达 AI）及后续 first_event（AI 开始响应）或其退位形态；禁止停留在「执行器已接收」直至超时警示。验收以生产会话实测为准（状态条翻动截图/观察为证），聚焦测试绿不能替代。

#### 场景：恢复会话后续轮（生产实证形态）

Given 一个经 daemon 重启恢复的活跃会话（生产会话 221ac351 同形态）
When 用户发送一条新消息
Then 状态条必须在合理时延内离开「执行器已接收」档（经 inject_received/first_event 推进或退位到活动摘要），agent 日志流照常（主消息轨不受影响）

### FR-02: 断点根因定位并修复(有代码修复,非仅绕过)

必须以 FR-03 观测数据（或等价运行时证据）定位「上报调用未实际执行」的运行时根因并做对应代码修复；禁止以手动补发、前端兜底、摘除功能等方式绕过。已知静态排除项（定位时勿重复排查）：bundle 含上报代码（7 处在）、进程为 11:54:38 新构建、cli deps 注入存在、daemon 侧三个入口守卫 warn 零记录、backend 端点手动上报 200 OK、SSE/前端消费正常（delivered 可显示）。

### FR-03: 上报可观测:失败首次 warn 留痕(不再静默黑盒),成功路径可通过配置观测

daemon 侧 turn_phase 上报失败必须在首次发生即记 warn（含 session_id/run_id/phase/错误摘要；按 session+phase 去重，同一键后续失败不得重复刷屏）；成功上报在默认 info 级日志下必须保持静默，在 SILLYHUB_TURN_PHASE_TRACE=1 时必须记 info（含 phase 与 run_id）。上报日志增强禁止改变 fire-and-forget 语义（不阻塞会话主链路）。

#### 场景：上报失败

Given daemon POST turn-phase 收到非 2xx 或网络异常
When 上报失败首次发生
Then 必须记 warn 一条；同 session+phase 的再次失败禁止重复 warn

#### 场景：观测开关

Given 环境变量 SILLYHUB_TURN_PHASE_TRACE=1
When 阶段上报成功
Then 必须记 info（phase+run_id）；开关关闭时成功必须零日志（现状保持）

### FR-04: backend 网络环境 NAT 场景(observed IP 不在任何网卡网段)文案不再自相矛盾:低置信标注与地址建议并存时删「拼地址信息不可用」断言,该断言仅在真无网卡数据时出现

【网络环境】段渲染必须满足：「拼地址信息不可用」断言在且仅在 interfaces 为空（无网卡数据）时出现；NAT 形态（observed IP 不在任何网卡网段）必须输出低置信判定标注 + 地址候选建议（二者并存），禁止任何形式的「不可用」断言与地址建议同现。判定逻辑（_same_subnet_by_cidr 回退序）必须保持不变。

#### 场景：NAT 出口（生产实证形态：observed=112.2.37.34 公网、网卡=10.10.128.145/172.23.144.1 内网）

Given 机器 observed_ip 为公网地址且 interfaces 非空、无一网卡网段包含 observed_ip
When 渲染【网络环境】段该机器行
Then 必须含低置信标注与「访问地址建议用 …（多网卡未定，候选：…）」；禁止出现「拼地址信息不可用」

#### 场景：无网卡数据（保持现状）

Given 机器 interfaces 为空
When 渲染该机器行
Then 「无可用 IPv4 地址」/信息不足类断言必须保留（不得因本变更丢失）

## 非功能需求
- 兼容性：上报观测不得阻塞会话主链路（fire-and-forget 语义不变，仅日志增强）；无观测开关时成功静默保持现状
- 可回退：FR-04 仅文案分支调整，判定逻辑不动
- 可测试：上报观测三态（默认成功静默/失败首警去重/TRACE 开关）与文案三态（无网卡/NAT/正常）各有可构造用例

## 测试绑定（每条 FR 至少一行）
FR-01: 生产会话验证（状态条翻动）为验收证据；代码面由 FR-02 修复的对应单测覆盖（见 FR-02 行）
FR-02: 依定位结果落修复面测试，收口时回填具体路径（当前预填：sillyhub-daemon/tests/turn-phase-observability.test.ts「上报链路触发」——若根因在 session-manager 侧则为对应模块测试）
FR-03: sillyhub-daemon/tests/turn-phase-observability.test.ts「失败首次 warn+去重/TRACE 开关 info/默认成功静默」
FR-04: backend/tests/modules/daemon/test_network_context.py「NAT 场景禁『拼地址信息不可用』+候选在/无网卡数据态断言保留」
