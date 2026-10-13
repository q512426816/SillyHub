---
author: flow-machine-draft
created_at: 2026-10-13T15:01:33.213Z
---
# 提案书（Proposal）— 2026-10-13-sillyspec-version-probe-fast-retry

## 动机

任务原话转写：动机：daemon 注册期 sillyspec 版本探测失败（冷启动慢超时等瞬态原因）后落 NULL，机器卡误显「sillyspec 未安装」，且第四循环先睡后查要等 1 小时才自愈；总览采集维度已用 sillyspec_status_error 区分「采集失败」与「未安装」，版本徽标缺同款快速自愈。
成功标准：
- SillySpecManager 新增限频重探入口 retryProbeLocalIfUnknown：version 未知（null）且距上次 probeLocal 尝试超过 120 秒才真正重探；版本已知不重探；全路径自收敛不抛异常
- daemon 心跳每拍触发该入口且不阻塞心跳节奏（void 不 await，探测最坏 30 秒超时不拖心跳发送）
- 旧假 manager（无新方法）注入时心跳不崩（duck-type 守卫，对齐 getCommandResult 惯例）
- 注册期探测失败场景：假「未安装」在 2 分钟限频窗口过后随重探自愈，成功后下一拍心跳带上真实版本
- 重探仍失败时限频窗口重新计时，不产生每拍连发探测
- 新增单测覆盖上述分支，相关既有测试（sillyspec-manager / daemon-heartbeat-sillyspec）不回归

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. SillySpecManager 新增限频重探入口 retryProbeLocalIfUnknown：version 未知（null）且距上次 probeLocal 尝试超过 120 秒才真正重探；版本已知不重探；全路径自收敛不抛异常
2. daemon 心跳每拍触发该入口且不阻塞心跳节奏（void 不 await，探测最坏 30 秒超时不拖心跳发送）
3. 旧假 manager（无新方法）注入时心跳不崩（duck-type 守卫，对齐 getCommandResult 惯例）
4. 注册期探测失败场景：假「未安装」在 2 分钟限频窗口过后随重探自愈，成功后下一拍心跳带上真实版本
5. 重探仍失败时限频窗口重新计时，不产生每拍连发探测
6. 新增单测覆盖上述分支，相关既有测试（sillyspec-manager / daemon-heartbeat-sillyspec）不回归

## 成功标准（可验证）

1. SillySpecManager 新增限频重探入口 retryProbeLocalIfUnknown：version 未知（null）且距上次 probeLocal 尝试超过 120 秒才真正重探；版本已知不重探；全路径自收敛不抛异常
2. daemon 心跳每拍触发该入口且不阻塞心跳节奏（void 不 await，探测最坏 30 秒超时不拖心跳发送）
3. 旧假 manager（无新方法）注入时心跳不崩（duck-type 守卫，对齐 getCommandResult 惯例）
4. 注册期探测失败场景：假「未安装」在 2 分钟限频窗口过后随重探自愈，成功后下一拍心跳带上真实版本
5. 重探仍失败时限频窗口重新计时，不产生每拍连发探测
6. 新增单测覆盖上述分支，相关既有测试（sillyspec-manager / daemon-heartbeat-sillyspec）不回归
