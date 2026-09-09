---
author: qinyi
created_at: 2026-09-08 12:05:00
---

# 决策记录（Decisions）

## D-001@v1: cursor 交互式 driver 架构——每轮 respawn + --resume chatId 薄 driver
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: cursor 交互式会话 driver 用什么架构？（A 每轮 respawn 薄 driver / B worker 长驻协议 / C 档B 直挂 ClaudeSdkDriver）
- answer: 方案A 每轮 respawn。每个 UserTurnInput spawn 一次 `cursor-agent -p --output-format stream-json [--resume chatId] [--model] <prompt>`，NDJSON 逐帧归一化为 AgentEvent v2，result 帧 + 进程退出 = turn 收敛；chatId 从帧内 session_id 捕获（`create-chat` 子命令兜底）；Windows 经 resolveWindowsCmdShim（含 cursor 坏 ps1 版本目录增强）。B/C 否决：worker 实测是 Cursor 云端 worker 注册通道（K8s 探针/标签/池分配，非本地 stdio 会话协议）；cursor-agent 无 --input-format/SDK 控制协议（批量适配 D-008@v1 已证参数集分叉），ClaudeSdkDriver 握手必挂
- normalized_requirement: 多轮会话靠 CLI 原生 --resume 串联；进程按轮隔离（崩溃不毁会话）；复用批量层已验证的 cursor 参数集与 Windows shim 绕过；pi 直 spawn 先例
- impacts: [driver 设计, 归一化器设计, caps 取值]
- evidence: 用户 AskUserQuestion 方案轮实答（2026-09-08）；cursor-agent --help / worker --help 本机实测（2026.06.16-20-30-07-a07d3ac 版本目录入口）

## D-002@v1: 接入范围——仅交互式会话最小闭环
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 本次 cursor 接入范围？（仅最小闭环 / +liveness 存活点 / +平台侧凭证配置）
- answer: 仅最小闭环：补齐交互式会话链路（driver + 归一化器 + 注册表 + 三端 caps + 前端白名单 + 测试 + 冒烟），对齐 pi 接入先例。liveness 推导器注册与平台侧 Cursor 凭证配置（llm_provider agent_kind 扩展 + CursorCredentialInjector）留后续变更
- normalized_requirement: 非目标=批量层改动（已可用）/liveness/凭证配置；避免与活跃变更 2026-09-08-session-list-liveness-dot 撞代码
- impacts: [proposal 范围, tasks 边界]
- evidence: 用户 AskUserQuestion 需求澄清轮实答（2026-09-08）

## D-003@v1: 交互式首版权限模式——先实测非 force 行为再定
- type: behavior
- priority: P1
- status: superseded
- supersedes: D-003@v1 的待定状态（本条为 v1 存档；结论见 D-003@v2）
- source: user
- question: cursor 交互式首版工具权限模式？（全自动 --force --trust 与批量一致 / 先实测非 force 行为再定）
- answer: 先实测再定（v1 阶段决策：设计含前置实测任务）
- normalized_requirement: 权限模式不拍脑袋，以实测为准；批量层现状 --force --trust 作对照基线
- impacts: [FR-05, driver 启动参数, caps.permission_dialog]
- evidence: 用户 AskUserQuestion 需求澄清轮实答（2026-09-08）

## D-003@v2: 权限模式定版——--force --trust 全自动 + permission_dialog=false（task-02 实测回填）
- type: behavior
- priority: P0
- status: accepted
- supersedes: D-003@v1
- source: code
- question: cursor-agent headless 模式的工具权限行为与 driver 启动参数定版？
- answer: 定版 `--force --trust` + caps.permission_dialog=false。证据：①无 --trust → 进程级硬拒绝（exit=1、零帧、stderr "Workspace Trust Required … Pass --trust, --yolo, or -f"）——--trust 为 headless 硬前提不可省；②仅 --trust 无 --force → 工具直接放行（editToolCall started→completed success、文件真实创建、is_error=false、无任何审批帧型）；③CLI stderr 自述放行途径仅 --trust/--yolo/-f 三旗标，headless 无交互审批通道可依托——未验证工具类在不带 --force 时有挂死/失败风险。综合：与批量层 buildArgs 一致落 --force --trust，消除未验证风险
- normalized_requirement: driver 启动参数恒含 ['--force','--trust']（'--model auto' 为 options.model 缺省兜底，Free 计划实测必须）；permission_dialog=false（UI 不出审批弹窗，manualApproval 选项忽略）
- impacts: [FR-02, task-04, caps.permission_dialog]
- evidence: task-02 探针实测（2026-09-08）：probe-trust-only.ndjson 帧 7/8/14（tool_call 执行成功）+ probe-no-flags.ndjson capture 记录（exit_code=1 + stderr 原文）；worktree sillyhub-daemon/tests/fixtures/cursor/

## D-004@v1: caps 守护测试 EXPECTED_PROVIDERS 同步必改（Grill B-01）
- type: consistency
- priority: P1
- status: accepted
- source: design-grill
- question: 三端 PROVIDER_CAPS 加 cursor 后，对齐守护测试是否自动覆盖？
- answer: 否。`backend/app/modules/agent/tests/test_provider_caps_alignment.py:52` EXPECTED_PROVIDERS 为硬编码 `{"claude","codex","pi"}`，test_provider_sets_identical 对三端表断言集合相等——三端表加 cursor 后守护测试必失败。必须同 commit 同步 EXPECTED_PROVIDERS 加 'cursor'（pi 接入 commit 7c4dd4efd 同款先例）。设计文件清单已补该文件
- normalized_requirement: caps 三端镜像的同步动作=4 处（daemon 单源 + backend 镜像 + frontend 镜像 + 守护测试 EXPECTED_PROVIDERS），不是 3 处
- impacts: [FR-01, 文件变更清单, Wave 2]
- evidence: 独立 Grill 子代理实读（2026-09-08，review-2026-09-08-115739）；test_provider_caps_alignment.py L52/L131-139

