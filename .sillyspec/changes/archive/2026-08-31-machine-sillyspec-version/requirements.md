---
author: qinyi
created_at: 2026-08-31 08:20:00
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在机器列表查看 sillyspec 版本、触发升级的运维/开发者 |
| daemon | 本地守护进程，sillyspec 探测/升级执行体（新 sillyspec-manager） |
| backend | 版本/状态落库方 + 升级指令下发方 |
| npm registry | sillyspec 最新版来源（daemon 侧 `npm view`） |

## 功能需求

### FR-01: sillyspec 版本显示
覆盖决策：D-001@v1, D-002@v1
Given 机器在线且 daemon 已探测到本机 sillyspec 版本
When 用户查看机器列表
Then 机器卡 meta 行显示 `sillyspec <版本>` 徽标：已最新=常色；落后=橙色「当前 → 最新」+「有新版本」小标签；未安装=红色「未安装」
And 版本随 15s 轮询刷新，daemon 离线显示最后上报值

### FR-02: 手动远程升级
覆盖决策：D-001@v1
Given 机器在线
When 用户点击「升级 sillyspec」（未安装时文案为「安装 sillyspec」，失败后为「重试升级」）
Then 后端校验归属后经 WS `daemon:sillyspec_update` 触发 daemon 执行 `npm install -g sillyspec@latest`，响应 `{"sent": true}`
And 离线/下发失败返回 504；离线/升级中/等待空闲时按钮禁用且 title 说明原因；落后时按钮橙色高亮

### FR-03: 升级过程可见
覆盖决策：D-001@v1
Given 升级已触发
When daemon 状态流转
Then 机器卡横幅按 `sillyspec_update.state` 显示四态：running=info「正在升级（from → to）」、deferred=warning「机器忙等待空闲（每 30s 复查）」、success=success「已升级到 to」、failed=destructive「升级失败：<error>」
And 终态横幅展示 10 分钟后自动消失；成功后版本徽标刷新为新版本

### FR-04: 运行期自动定期升级
覆盖决策：D-001@v1
Given daemon 运行中且 `sillyspec_update_interval_sec` > 0（默认 3600）
When 定时循环发现本机落后于 npm 最新版或未安装
Then 自动触发升级（trigger=auto），机器忙时推迟不打断进行中的会话/任务（复用 `_isBusyForUpdate` 三臂忙判定）
And `0` = 关闭自动升级

### FR-05: 数据链与兼容
覆盖决策：D-001@v1, D-002@v1
Given daemon 与 backend 版本可能不齐
Then register 对 sillyspec_version/latest 直接落值（含 null）；心跳对二者非 None 才覆盖、对 sillyspec_update 无键即清除（pending_update 同款）
And 新 daemon + 旧 backend：心跳多带字段被忽略不报错；旧 daemon + 新 backend：版本列保留不误清除
And `state` 不收紧成 Literal（心跳是保活通道宁宽勿断）

## 非功能需求

### NFR-01: 协议纪律
新增 WS 字面量先改 backend `protocol.py` 再对齐 daemon `protocol.ts`（逐字 `daemon:sillyspec_update`），双侧契约单测同步（backend `test_protocol_session_contract.py` + TS `protocol-session-contract.test.ts`）。

### NFR-02: 三平台兼容
探测与安装复用 preflight `runWithTreeKill`（Windows `taskkill /T /F`）；npm/.cmd shim 解析走既有链路。

### NFR-03: 前端类型不手写
`api-types.ts` 经 `pnpm gen:types` 再生，`backend/openapi.json` 同步提交。

## 决策覆盖对账

- D-001@v1（architecture）：FR-01~FR-05 全部覆盖。
- D-002@v1（consistency）：FR-05 覆盖；无未覆盖决策，无剩余风险。

## 验收要点（verify 阶段展开）

1. 机器卡三形态徽标 + 按钮 5 态 + 横幅四态与原型 8 场景一致。
2. 心跳/register 落库语义双侧单测通过（含缺省/显式 null 分支）。
3. 协议字面量双侧镜像测试通过。
4. daemon 相关测试套件 + backend daemon 模块测试 + frontend machine-card 测试绿，tsc/ruff/mypy 0 错。
