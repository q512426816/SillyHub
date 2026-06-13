---
author: qinyi
created_at: 2026-06-13 23:59:42
---

# Proposal

> 变更：`2026-06-13-daemon-nodejs-rewrite`
> 方案：方案B（协议抽象 + Wave 增量交付）
> 详细设计见 `design.md`。

## 动机

`sillyhub-daemon` 是 SillyHub 的本地守护进程，负责连接 backend daemon 通道、在本地 workspace 调用 12 种 agent CLI 执行任务、流式回传消息、提交 git diff patch。当前实现为 Python 3.12（源码 ~4059 行 + 测试 ~6660 行）。

本 monorepo 除 backend 外已全部 TS/JS 化（frontend、multi-agent-platform、未来 tooling）。把 daemon 转向 Node.js，是为了让整个 monorepo 的技术栈收敛、部署链统一，并利用 Node 事件循环对「WebSocket 长连 + 子进程流 + HTTP」这类 I/O 密集场景的原生契合。

## 关键问题（为什么现有 Python 方案不够）

1. **栈分裂带来的维护/认知成本**：Python daemon 是 monorepo 第二个也是仅有的两个 Python 项目之一，贡献者需要同时维护两套语言生态（pyproject/uv/pytest 与 package.json/pnpm/vitest），CI 与 Docker 镜像都要为 Python 单独维护一条线。
2. **部署镜像臃肿**：Docker 镜像需为 daemon 单独安装 Python 运行时；Node 化后可与 frontend 共用基础镜像，缩小体积与构建时间。
3. **协议抽象不够彻底**：现有 `AgentBackend(ABC)` 同时承担「执行子进程」和「解析输出」两职，5 个 backend 各自重复了子进程执行模板。借重写之机深化抽象（方案B），把通用执行流程下沉到 `TaskRunner` 单点、协议差异收敛到 `parse(line)`，使未来新增协议零侵入。

## 变更范围

将 `sillyhub-daemon/` 子项目整体重写为 **Node.js 20 LTS + TypeScript**，分 6 个 Wave 增量交付：

- **W0** 项目骨架（package.json / tsconfig(strict) / 类型定义 / vitest 脚手架）
- **W1** 协议抽象层（ProtocolAdapter 接口 + 5 adapter + getBackend 工厂 + 12 provider 映射）★
- **W2** 基础设施（config / credential-0600 / version / workspace-git-mirror / agent-detector-12provider）
- **W3** 通信层（HubClient-REST-fetch + WsClient-ws，严格对齐 backend protocol.py）
- **W4** 编排层（TaskRunner + Daemon 主类生命周期）
- **W5** CLI(commander) + 真实 backend 冒烟；冒烟通过后删除 Python 源码 `sillyhub_daemon/`

对外行为与 Python 版 1:1 等价，与 `backend/app/modules/daemon/protocol.py` 的 WS 消息类型、REST 端点、lease 状态机逐字对齐。

## 不在范围内（显式清单）

- ❌ 不改 backend 端 `protocol.py` / daemon REST 端点（Node 版迁就 backend）
- ❌ 不新增功能（不增 provider、不改 credential/config 文件格式、不改 git mirror 策略）
- ❌ 不做 daemon 高可用/集群/水平扩展（仍单机守护进程）
- ❌ 不重写 backend（其 Python 化属另一长期规划）
- ❌ 不引入 ORM/数据库（daemon 仅文件存储）
- ❌ 不做性能压测优化（等价即可）

## 成功标准（可验证）

- ✅ **契约对齐**：`protocol.ts` 常量与 `backend/app/modules/daemon/protocol.py` 逐字一致，契约单测断言全部消息类型（G-02）
- ✅ **测试迁移**：17 个 Python 测试文件的用例 1:1 迁移到 vitest，行为覆盖等价（G-01）
- ✅ **真实冒烟**：W5 完成一次真实 daemon↔backend 的完整 lease（task_available→claim→start→messages→complete+patch）（G-02）
- ✅ **增量可交付**：每 Wave `tsc + vitest` 双绿即可推进（G-04）
- ✅ **零/少依赖**：`dependencies` 仅 `ws` / `commander`，运行时依赖受控（G-05）
- ✅ **可回退**：Python 版保留至 W5 冒烟通过；任一 Wave 发现不可调和对端偏差可立即回退
