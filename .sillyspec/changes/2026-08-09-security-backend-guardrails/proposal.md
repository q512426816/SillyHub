---
author: qinyi
created_at: 2026-08-09T20:49:11
---
# 提案（Proposal）— 后端防护加固：incident 状态机转换校验 + SSRF 三连

## 变更名
`2026-08-09-security-backend-guardrails`

## 一句话
修补 CONCERNS.md「2026-08-08 多代理审计」🔴 高危中的两项后端入口校验缺失：incident 故障状态机无合法转换校验（任意互跳/终态可复活）+ SSRF 三连（mcp webhook 回调 / worktree git clone / http_get 工具三个出站点缺校验或校验不全）。

## 动机
- **incident 状态机失控**：`update()` 只校验状态值合法，不查能否从当前状态跳到目标。后果：任意状态互跳、已解决(resolved)的故障能被改回待处理/排查中还残留解决时间与解决人 → 故障生命周期数据失真、终态可复活。审计标注 severity 校验已补、status 转换校验仍待办。
- **SSRF 三连**：三个「让后端替用户发外部请求」的入口有缺口——mcp webhook 回调 URL 无校验（可指向云元数据 169.254.169.254 / 本机 / 内网）；worktree clone 的 repo_url 零校验（ext:: 协议可 RCE、file:// 可读本地文件）；http_get 工具重定向后不复查 + 私网检查仅 IPv4（不挡 IPv6 私网 ::1/fc00::/fe80:: 与重定向绕过）。SSRF 可让攻击者借后端身份访问内网/本机/云元数据，乃至偷云密钥、读本地文件。
- 底层「域名解析→内网 IP 判定」原语此前 LLM 供应商功能已实现并测试（IPv4+IPv6+防 DNS 阻塞），本次复用，不重复造轮子。

## 范围
- incident：加合法转换校验（放宽版图），终态不可任意复活、重开清解决记录、非法转换返 422。
- SSRF：新建统一入口 `app/core/ssrf.py`，三出站点接入；堵 IPv6 私网、重定向、危险协议三类绕过。

## 非目标（不在范围内 / Non-Goals）
- 不改 incident 前端/UI（后端校验足够）。
- 不把 IP 原语整体搬到 core（控范围，留 follow-up）。
- 不升级 policy 路径 `_check_not_private_ip` 的 IPv6（handler 逐跳已覆盖）。
- PPM 冒名填报防护（属 change 3，已上线模块单独隔离）。
- incident 时间戳 utcnow() 统一（无关的低优先项）。

## 对用户/业务的影响
- 普通用户无感：现有 incident 操作（新建=open、开始排查=open→investigating、解决=open→resolved）全部保留；公网 webhook/clone/http 请求照常。
- 受影响仅异常路径：试图把已解决故障乱改状态、或注册指向内网/本机的回调、或用 ext::/file:// 仓库地址 → 被拒（4xx + 中文提示）。

## 验收要点
- incident 非法转换返 422、重开清 resolved_at/by、现有 incident 测试全绿零回归。
- mcp webhook 注册 127.0.0.1/169.254.169.254/file:// 被拒；投递前复查。
- worktree clone ext::/file:///裸路径 拒；https/ssh/git/git@host:path 放行。
- http_get [::1]/fe80:: 拒、重定向到 127.0.0.1 拒（≤3 跳逐跳复查）。

## 实现路径
SillySpec 完整流程，本提案属 brainstorm 产物；下一步 `sillyspec run plan --change 2026-08-09-security-backend-guardrails` 出任务拆分，再 execute→verify→archive。串行 3 安全 change 的第 2 个（change 1 凭据卫生已完成，change 3 PPM 冒名待做）。
