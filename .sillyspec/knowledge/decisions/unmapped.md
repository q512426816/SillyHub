# 决策知识 — unmapped

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-003@v1 : 平台共享智能体绑定的守护进程取管理员自己名下
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：仅平台管理员自己名下的在线 daemon runtime。依据：避免引入「管理员

## D-002@v2 : 平台共享智能体会话——源码只读 + 指定目录可写
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：用户实答（重问轮）：「允许某个目录下写操作，可以生成点文档原型图
supersedes：D-002@v1

## D-004@v2 : 共享机器/智能体由用户在会话中显式选择
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：用户实答（重问轮）：「会话选择共享的机器和智能体呀，用户自己选」
supersedes：D-004@v1

## D-006@v1 : 实现方案选 B——统一授权表 daemon_runtime_grants
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：用户选定方案 B：新建 daemon_runtime_grants 统一授权表，工作区共享与

## D-011@v1 : 打破 daemon 零改动 Non-Goal——session 级 overlay roots 写守卫增量（spike-02 B 裁决）
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：选项 II（最小 daemon 增量）：_judgeWriteViaPolicyEngine 增加 per-session

## D-012@v1 : platform grant 的 pinned runtime 不经共享档案直接钉定 → 404
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：否——共享的是智能体而非裸 runtime：authorize_pinned_runtime 的

## D-002@v1 : 服务器重新部署范围
状态：implemented
变更：2026-08-29-daemon-platform-resilience
锚点：未记录
最近确认：bdef3a21
理由：仅后端进程重启（docker 容器重启/发新版镜像），数据库保留，daemon 的 api_key 与注册信息仍有效

## D-003@v1 : 前端回显纳入范围
状态：implemented
变更：2026-08-29-daemon-platform-resilience
锚点：未记录
最近确认：bdef3a21
理由：包含关键前端修复——断线状态提示、卡住的「运行中」轮次兜底、审批面板断线重连

## D-004@v1 : 改造深度
状态：implemented
变更：2026-08-29-daemon-platform-resilience
锚点：未记录
最近确认：bdef3a21
理由：允许结构改造——可新增接口/协议（控制消息补拉接口、lease 过期回收后台任务、SSE 游标增强等），彻底解决断线窗口丢消息

## D-005@v1 : 实现方案选型
状态：implemented
变更：2026-08-29-daemon-platform-resilience
锚点：未记录
最近确认：bdef3a21
理由：方案 A——控制指令落库待发（参考 DaemonChangeWrite 占坑-轮询-GC 先例）+ WS 推送保即时性 + daemon 重连后 HTTP 补拉幂等消费；分层加固：daemon 退避重连+register 重试、终态上报入 outbox、backend lease GC 接线与 WS 断开即时降级、会话 suspended 挂起语义、前端连接状态与看门狗兜底

## D-006@v1 : 六段设计整体确认
状态：implemented
变更：2026-08-29-daemon-platform-resilience
锚点：未记录
最近确认：bdef3a21
理由：确认。变更名 2026-08-29-daemon-platform-resilience，原型 prototype-session-connection-states.html 六状态快照
