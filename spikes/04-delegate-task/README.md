# Spike 04 — delegate_task 协议【路径 B：输出解析】可行性

## 验证目标

> 验证 GLM（glm-5.1，智谱 BigModel Anthropic 兼容端点）作为 Coordinator，能否稳定输出【可解析、合法的结构化委派清单 JSON】，使 `delegate_task` 协议走**路径 B（输出解析）**而非路径 A（工具调用——spike-02 D2 证 GLM 工具调用不稳定）。

## 判定门（multi-agent-orchestration proposal §7）

| 门 | 内容 | 阈值 | 实测 (N=10) |
|----|------|------|------|
| H1 | 委派清单 JSON 可解析率 | ≥80% | **100%** ✅ |
| H2 | delegations 字段合法率（1-5 / role 枚举 / read_only 布尔 / 非空） | ≥80% | **100%** ✅ |
| D1 | 失败模式 | — | none |

**结论：路径 B 明确通过，主门 100%。** 委派内容质量高（见 `result.json`：扫描仓库→backend/frontend/integration/doc_compiler；加字段→arch/impl(.diff)/integration/…，read_only 标注正确）。

## 关键架构发现（spike 过程中得到，比通过/不通过更重要）

### 失败尝试：claude CLI（agentic 框架）

最初按 spike 03 经验用 `claude -p ... --add-dir <workdir> --max-turns 1 --allowedTools ""` 验证。GLM **拒绝纯输出委派 JSON**，在两种偏离模式间摆动：

- 弱 prompt → 输出 `{"status":"awaiting_task","message":"未收到待拆解的具体任务..."}`（待命 / meta-respond）
- 强 prompt（任务前置）→ 直接「执行任务」：探索空 workdir、请求路径/权限、或吐完整实现方案（26 点计划）

根因：**claude CLI 的 agentic system prompt（"你是个 coding agent"）覆盖了 JSON 输出指令**，让 GLM 倾向于「执行 / 澄清」而非「纯输出规划」。

### 成功方案：直接 messages API

改用 httpx 直接打 GLM `/v1/messages`（无 agentic system prompt 干扰），GLM 100% 输出可解析、合法、高质量的委派清单。

### 给多 Agent 架构的输入（写入 design）

> **Coordinator 的【分派阶段】是纯文本生成调用，必须用直接 API 调用，不能跑在 claude CLI / daemon agentic 框架里。**

- Coordinator 的委派规划 = backend 内嵌的一次 GLM messages 调用（system + user + JSON 输出约束），**不是**再 spawn 一个 daemon lease / claude 进程。
- Worker 才走 daemon / claude CLI（agentic 执行）。
- 天然契合 proposal §4「Coordinator 不接收原始日志、只输出委派清单 + 收 Artifact」——Coordinator 本来就轻量，不该套 agentic 外壳。

## 运行

```bash
# 凭证在 deploy/.env（ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL / ANTHROPIC_DEFAULT_SONNET_MODEL）
backend/.venv/Scripts/python.exe spikes/04-delegate-task/run.py 10
```

输出 `result.json`（每任务 raw 委派清单 + H1/H2/modes）。

实现注记：
- httpx 用 `trust_env=False`——GLM 端点 `open.bigmodel.cn` 国内直连，不继承环境的 SOCKS 代理（那是为连 anthropic 官方，且缺 socksio）。
- 并发 semaphore=3，避免触发 GLM 端限流。
