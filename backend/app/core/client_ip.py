"""客户端来源 IP 提取共享工具。

2026-10-23-session-network-context task-04：原 ``app.modules.auth.router._client_ip``
（2026-08-20 审计 BS-3 语义：X-Forwarded-For **最右段**，防最左伪造）抽为共享
工具——daemon 心跳/注册端点观测 daemon 来源 IP（``daemon_instances.network_info.
observed_ip``，D-002 ground truth）需要同一语义，auth 登录审计/限流迁用本工具
（纯重构，行为逐字节不变）。
"""

from __future__ import annotations

from fastapi import Request


def client_ip_from_request(request: Request) -> str | None:
    """客户端 IP：nginx 反代下取 X-Forwarded-For 最右段（可信代理追加的末跳），直连回退 client.host。

    ⚠️ 2026-08-20 审计 BS-3（语义原样迁移自 auth/router.py）：原实现取最左段
    （客户端自报可伪造，换假 IP 即绕过登录限流/失败计数/验证码）。nginx
    ``$proxy_add_x_forwarded_for`` 是**追加**语义，最右段才是离我们最近的可信
    代理实际看到的来源 IP，伪造只能影响左侧历史段。残余风险：无反代直连时
    攻击者仍可自报整条 XFF（部署拓扑含 nginx 时不成立）。
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        segments = [s.strip() for s in xff.split(",") if s.strip()]
        if segments:
            return segments[-1]
    return request.client.host if request.client else None


def has_forwarded_for(request: Request) -> bool:
    """是否存在非空 X-Forwarded-For 头。

    2026-10-23-session-network-context（FR-05 降级矩阵）：区分「经 nginx 转发」
    与「直连容器」——无 XFF 且来源 IP 落 172.16.0.0/12（Docker 网桥特征）时，
    用户真实网段不可判定，注入段降级「无法判定」。
    """
    xff = request.headers.get("x-forwarded-for")
    if not xff:
        return False
    return any(s.strip() for s in xff.split(","))
