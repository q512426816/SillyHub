---
author: flow-machine-draft
created_at: 2026-10-05T23:16:41.772Z
---
# 需求规格（Requirements）— 2026-10-06-opencode-session-send-incident

## 功能需求

> FR 由你撰写：每条 = `### FR-NN: 标题` + 一句带强度词的行为规定（必须=硬性；禁止=红线；
> SHOULD=建议须注理由；可以=可选）；边界情形加场景块 `#### 场景：名` + Given/When/Then 行。
> 标题行是成功标准锚（勿改写——收口做门柱对比）；正文与场景块归你。

### FR-01: isToolReportBody 派生上移到所有早退分支之前（session 判空安全），handleSend 依赖数组补该变量

- isToolReportBody 必须声明在组件内所有早退分支（含预会话 if (!sessionId) return）之前且 session 判空安全（可选链），handleSend 依赖数组必须含 isToolReportBody；禁止在早退分支之后声明被回调闭包引用的渲染派生变量（TDZ 回归红线）。

#### 场景：主路径

- Given SessionPanel 处于预会话态（sessionId=null，session=null）
- When 用户输入首句并点击发送
- Then handleSend 正常执行（不抛 ReferenceError），走 handlePreSessionSend 创建会话

### FR-02: session-panel-pre-session.test.tsx 原先挂掉的 15 个用例全部转绿（TDZ 回归测试即现有用例）

- 修复后 session-panel-pre-session.test.tsx 必须 36/36 全绿（修复前 15 挂 21 过，挂在 Cannot access 'isToolReportBody' before initialization），且 session-panel-takeover.test.tsx 7/7 保持全绿（takeover 行为零回归）。

#### 场景：主路径

- Given 修复前预会话测试 15 用例因 TDZ 失败
- When 应用上移修复并运行该文件
- Then 36 用例全过，takeover 用例 7/7 全过

### FR-03: 服务器 OpenCode Go 供应商行 extra_env 注入 HTTPS_PROXY=http://127.0.0.1:7897，daemon 本机 Claude Code 经代理连 opencode.ai 实测 200

- 服务器 47.113.145.252 llm_providers 行 OpenCode Go 的 extra_env 必须含 HTTPS_PROXY=http://127.0.0.1:7897（注入器规则 6 透传给 Claude Code 子进程），且真实 Claude Code 以该环境变量组合直连 opencode.ai 实测成功。

#### 场景：主路径

- Given daemon 本机直连 opencode.ai TLS 被劫持（SEC_E_WRONG_PRINCIPAL）
- When Claude Code 子进程带 HTTPS_PROXY=http://127.0.0.1:7897 + anthropic 直连 env 运行
- Then 请求经 Clash 代理到达 opencode.ai 并正常应答（实测「收到」）

### FR-04: 未跑全量测试（仅跑本修复相关测试文件）

- 本变更必须且仅跑修复相关测试（session-panel-pre-session + session-panel-takeover + tsc + 单文件 eslint）且全绿；禁止跑全量测试（CI 留守，仓库规则 0）。

#### 场景：主路径

- Given 修复与依赖数组调整完成
- When 运行两个相关测试文件与类型/lint 检查
- Then 43 用例全过、tsc 0 错、eslint 0 error（1 预存 warning），全量未触发

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx「首句发送 → createSession 含 runtime_id + prompt + manual_approval/ask_user_only（不带 provider），成功清空输入并上报 onPreSessionCreated」
FR-02: test/frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx（36/36 全绿）+ test/frontend/src/components/daemon/__tests__/session-panel-takeover.test.tsx（7/7）
FR-03: 不适用：运维数据 + 真机网络验证（daemon 本机 Claude Code 经 Clash 7897 实测「收到」，无仓内自动化测试面；服务器行 extra_env 落库证据为 psql 查询回显）
FR-04: test/frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx「空文本不发首句（后端 prompt 首句约束）」（跑面声明：两文件 + tsc + eslint，未跑全量）
