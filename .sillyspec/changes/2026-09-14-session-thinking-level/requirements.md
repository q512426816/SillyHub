---
author: qinyi
created_at: 2026-09-15 00:40:00
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 会话用户 | 创建时选思考档位（更深推理/更快响应）、会话中切档、看到当前档 |
| 引擎接入开发者 | 新引擎实现可选契约方法+翻 caps 即可接入 |

## 功能需求

### FR-01: caps 第 13 键+codex thinking 翻值
覆盖决策：D-001@v1
Given ProviderCaps 加 thinking_level 键（claude/pi/codex=true、cursor=false）
When gen 脚本三端生成+守护同步
Then 前端门控/后端校验有真数据源；codex thinking 翻 true（纯声明对齐）

### FR-02: 统一七档词表与映射
Given THINKING_LEVELS 七档常量+mapPlatformLevelToEngine 映射矩阵
When 各 driver 消费
Then 引擎不支持档位按降级规则映射（off→不设、minimal→low、max→xhigh）+矩阵单测全绿

### FR-03: 创建时选档全链
Given 前端 preThinkingLevel→createSession
When 全链五跳透传（schema→create→placement→lease→daemon→driver）
Then 三 driver 启动设置生效（claude options.effort/codex turn params/pi 握手后命令）

### FR-04: 动态档位查询
Given 会话存在且 caps=true
When GET /sessions/{id}/thinking-levels
Then 返回 {levels, current}——pi 按模型动态/claude supportedModels 过滤/codex 五档

### FR-05: 会话中切换
Given turn 空闲+合法档位
When POST /sessions/{id}/thinking-level
Then 三引擎切换生效（pi 命令/claude applyFlagSettings/codex settings/update）+成功通知

### FR-06: 前端双控件
Given caps.thinking_level=true
When 创建表单（静态七档+off 显示"默认"+语义差异 tooltip）/会话配置条（动态档位+现值+running 禁用）
Then 切换成功通知+失败带原因

### FR-07: 真机验证
Given 三引擎会话
When 各创建选档+查询+切换
Then 档位生效（真机回执记 QUICKLOG；spike-01 codex 形状/spike-02 claude applyFlagSettings）

## 非功能需求

- 兼容性：旧 daemon RemoteError→结构化 error；cursor 三层拒绝；不支持档 400/过滤；既有链零变化
- 可回退：codex spike 失败→切换报不支持（多会话场景放弃 config.toml 降级避免互相污染）
- 可测试：映射矩阵纯函数单测+三 driver mock+守卫+端点+前端分支

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR 全集 | v2 全量范围 |
| D-002@v1 | FR-02~06 | RPC 模式+可选契约 |
