---
author: flow-machine-draft
created_at: 2026-10-17T09:09:32.394Z
---
# 设计记录（Design Record）— 2026-10-17-dsh-rc2-routing-restore

## 做法概述

dsh-rc2-protocol-fix 后轮次可达但暴露三层：① compat 块被 rc.2 compatProfile 新 schema 静默拒收（整条 provider 不激活——探针双轮实证带/不带 compat 的模型目录差异）；② 模型 valueId 变 JSON 数组串；③ 通知信封未拆包致回复零落库。修法：writeDshHome 改三件套布局（package.json 模板清单 + workspace + 无 compat patch——catalog 默认值由引擎按 api 协议补齐，compat 留给引擎自带）；驱动模型值组装 `["sillyhub","<model>"]`（DSH_PROVIDER_ID 单源）；通知处理兼容信封拆包。UI 真机终验：模型自答 GLM-5.3-FlashX/智谱，路由完整恢复。

## 接口契约

- `writeDshHome`（dsh-settings.ts）：写 profiles/acp/ 三件套（新增 package.json + pnpm-workspace.yaml），patch 去 compat 块；新导出 DSH_PROVIDER_ID。
- `DshAcpDriver.consume`：模型 set_config_option 值改 valueId 数组串；通知处理信封拆包（兼容旧直发形状）。
- 端点/命令/表结构：无变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：通知拆包在驱动消费侧即时判形状，无时序假设。
2. 并发写：per-session 目录独占写，三件套为单写方（provider-file-settings 分派层串行调用）。
3. 切换/生命周期：写盘先于 spawn（既有顺序），热切换重写幂等。
4. 作用域：per-session DSH_HOME 隔离，provider 键固定 sillyhub 不跨仓。

## 文件变更清单（自声明对账面）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/dsh-settings.ts | 三件套布局 + 去 compat + 导出 DSH_PROVIDER_ID |
| 修改 | sillyhub-daemon/src/interactive/dsh-acp-driver.ts | 模型 valueId 数组串 + 通知信封拆包 |
| 修改 | sillyhub-daemon/tests/dsh-settings.test.ts | 三件套 + 禁 compat 钉板 |
| 修改 | sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts | valueId 数组串钉板 |

## 风险与死路

最大风险：dsh 下个版本再改 compatProfile/valueId 形状——探针脚本 + configOptions 运行时可观测（模型目录出现/消失一目了然），回归成本低。已放弃：保留 compat 块仅修正漂移字段（rc.2 schema 字段集未文档化，逐字段试探成本高于整块去除——catalog 默认值由引擎按 api 协议自动补齐，语义无损）。
