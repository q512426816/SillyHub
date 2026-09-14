---
author: qinyi
created_at: 2026-09-15 00:40:00
---
# 提案书（Proposal）

## 动机

平台完全没有模型思考级别选择能力——用户在 CLI 可切 thinking 档位（更深推理或更快响应），平台只能用引擎默认。用户明确要求 v2 全量：创建时选档+按模型动态档位+会话中切换。

## 关键问题

1. 四引擎档位词表不同（claude 五档/pi 七档动态/codex 五档/cursor 无）——需要统一抽象+映射。
2. 会话中切换需要轻量通道——进程重启式切模型不适用（丢流式状态）。
3. codex caps.thinking 声明与事实不符（driver 已映射 reasoning 事件但表值 false）——顺手修。

## 变更范围

- caps 第 13 键 thinking_level（三端生成+守护）+codex thinking 翻值（声明对齐）
- daemon 七档词表+映射矩阵单源+三 driver 可选契约（getThinkingLevels/setThinkingLevel）+启动设置+两 RPC handler
- backend 全链透传（schema/create/placement/lease/归一化）+GET/POST 两端点
- 前端创建表单档位下拉（静态七档镜像）+会话切换控件（动态档位+现值）+caps/空闲双门控

## 不在范围内（显式清单）

- 思考预算/自适应 thinking 配置管理（NG-01）
- 轮中切档（NG-02，仅空闲）
- cursor（NG-03）
- 档位持久化到 config 列（NG-04，不写不落库）
- 数字型 effort（NG-05）
- 子代理 per-agent 档位（NG-06）

## 成功标准（可验证）

- 三引擎真机各切一轮档位（pi set_thinking_level+get_available 双实证最低成本）
- 创建时选档全链到达 driver（placement/lease 断链已修）
- caps 三端一致+守护绿+防遗漏实证
- codex thinking 翻值后守护同步（纯声明对齐无行为变化）
