---
author: flow-machine-draft
created_at: 2026-10-05T23:16:41.772Z
---
# 设计记录（Design Record）— 2026-10-06-opencode-session-send-incident

> 四节每节必答——问题行原样保留（勿删勿改勿用答案替换），答案另起一行写在问题行下方；小改动可写「不适用：<理由>」；flow done 空节拒收。
> 需要列改动文件时加独立「## 文件变更清单」章节+表格（| 操作 | 路径 | 说明 |）——章节标题是 parseFileChangeList 的识别面，勿写在「接口契约」节内（收口声明面解析不到会误报夹带嫌疑）。
> 四问原文/FR 标题/镜像任务行是收口锚——问题行从本模板原样保留或复制，勿删勿改、勿用答案整块替换问题原文、勿手打重写（标点也要逐字：2026-10-05 三度实证——句号手写成问号、答案整块替换问题原文均被锚对比拒收）。

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

双故障一根一修：①前端 TDZ——handleSend（useCallback）函数体引用 isToolReportBody，而该 const 声明在预会话 if (!sessionId) 早退**之后**（sessionBody 派生区，d6fabf408 引入）；预会话渲染（新建会话页）走早退，声明语句不执行 → 闭包绑定停 TDZ → 首句点发送必抛 ReferenceError（线上 chunk 的 ae 即此变量，session-panel-page.tsx:3234 实证 + 预会话测试文件 15 用例挂）。修法：派生上移到 deriveSessionStatusFlags 旁（所有早退分支之前），session 判空改可选链（预会话/加载中 null → false，真会话语义不变），并补进 handleSend 依赖数组（顺手补同行的 handleTakeoverSend 预存缺依赖）。②opencode SSL——daemon 所在机器直连 opencode.ai 被 TLS 劫持（证书主机名不匹配，本机 curl SEC_E_WRONG_PRINCIPAL 复现），opencode 供应商改 anthropic 直连后 Claude Code 子进程直打出网即撞此劫持；修法：供应商行 extra_env 注入 HTTPS_PROXY=http://127.0.0.1:7897（daemon 本机 Clash 混合端口，http 代理实测 200），注入器规则 6 Object.assign 原样透传给子进程，Claude Code（undici）原生尊重该 env。为什么不改代码路由层：问题分别是变量作用域错位与机器网络环境，均无代码架构面变更必要，最小修复即正确修复。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无函数签名/端点/文件格式变更。可见行为变化：①SessionPanel（page 模式）预会话态点发送从「必抛 ReferenceError（发送无效）」恢复为「走 handlePreSessionSend 创建会话」；②handleSend 依赖数组 +2 项（isToolReportBody/handleTakeoverSend），memoization 粒度变化无行为影响（两者本就在闭包内被引用）；③服务器 OpenCode Go 供应商行 extra_env 多 HTTPS_PROXY 键 + notes 追加说明（运维数据面，非 schema）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立/不适用：isToolReportBody 是渲染期纯派生（session 单源），无事件乱序面；HTTPS_PROXY 是静态 env，无时序语义。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：单组件内 const 派生无共享可变状态；DB 行一次性 UPDATE（后台无流量时隙），之后只被常规表单更新路径触碰。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：上移后的声明在每次渲染无条件执行（含预会话/加载/错误态），任意早退路径下闭包绑定必已初始化——这正是修复要消除的不变量破坏。会话切换（预会话→真会话 rerender）时 isToolReportBody 随 session 引用变化重算并在依赖数组驱动下重建 handleSend，无陈旧闭包。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：前端是编译期单组件作用域；HTTPS_PROXY 的 extra_env 只随该供应商 provider_config 下发给其会话的子进程（GLM/DeepSeek/Kimi 等国内供应商不携带，不受代理影响）。已知边界：换 daemon 机器（无 Clash 或端口不同）时该 127.0.0.1:7897 失效，需按机器调整（provider notes 已注明）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：①HTTPS_PROXY 绑定 daemon 本机代理端口（127.0.0.1:7897）——换机器/换端口失效，属环境耦合（notes 已注明，探活与会话报错即时暴露）；②上游网络环境变化（劫持消失/代理下线）时该 env 变冗余但无害（代理拒连才会断，可再清）。放弃的方案：①把 isToolReportBody 判定内联进 handleSend（session?.origin === ...）——治标不治本，渲染区 6 处消费点仍需变量，双源漂移；②在 llm-proxy（hub 服务器侧转发）承载 opencode 流量借服务器干净网络——那是 openai_chat 的 LiteLLM 路径，anthropic 直连形态无此通道，为绕网络劫持重开转换网关属方向性倒退（litellm 分叉仍未拍板）；③给 daemon 全局配代理——影响所有供应商（国内上游走代理反而劣化），per-provider extra_env 是正确粒度。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | isToolReportBody 派生上移（早退前 + 可选链）+ 删原声明点 + handleSend 依赖数组补 isToolReportBody/handleTakeoverSend |
| 修改 | .sillyspec/docs/multi-agent-platform/modules/frontend.md | 模块文档补本变更条目 |
| 修改 | docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md | 坑文档补 2026-10-06 下午段（服务器 compose 未同步致隔离失效教训） |
| 运维数据 | 服务器 47.113.145.252 llm_providers 行 68b4b5b9 | extra_env 注入 HTTPS_PROXY=http://127.0.0.1:7897 + notes 说明（psql 一次性 UPDATE，不入仓） |
| 运维数据 | 服务器 /opt/sillyhub/deploy/deploy/docker-compose.yml | 同步仓内 quarantine 版 compose（profiles 门控生效，默认 up -d 不再拉起 litellm；scp 同步不入仓） |
