"""Spike 04 — delegate_task 协议【路径 B：输出解析】可行性（直接 API 版）。

验证 GLM（glm-5.x via 智谱 BigModel Anthropic 兼容端点）作为 Coordinator，
能否稳定输出【可解析的结构化委派清单 JSON】，绕开 tool-use 风险。

判定（multi-agent-orchestration proposal §7，主门改为路径 B）：
  H1: 委派清单 JSON 可解析率 ≥ 80%
  H2: delegations 字段合法率 ≥ 80%（1-5 个 / role 枚举 / read_only 布尔 / 非空字段）
  D1: 记录失败模式

关键方法学决定（spike 过程中修正）：
  最初用 claude CLI（-p + workdir）验证，发现 claude 的 agentic system prompt 让
  GLM 在「待命(awaiting_task)」和「执行/请求澄清」之间摆动，拒绝纯输出委派 JSON。
  结论：Coordinator 的【分派阶段】是纯文本生成调用，不该跑在 agentic 框架（claude
  CLI/daemon）里。故改用 httpx 直接打 GLM messages API，去除 agentic 干扰，纯净
  验证 GLM 的 instruct-following 输出能力。

用法：
  python run.py [N]    # N=任务数，默认 10；先 run.py 3 验证通路
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parents[2]
ROLES = {"arch", "code_style", "test", "integration", "risk", "impl", "verify"}

SYSTEM = (
    "你是多 Agent 编排的 Coordinator。把用户的任务拆解为 Worker 委派，"
    "只输出一个 JSON 对象，不要有任何多余解释或 markdown 代码块。\n"
    "JSON 格式："
    '{"summary": "对任务的一句话理解", "delegations": ['
    '{"worker_id": "arch_analyzer", "role": "arch", "objective": "具体目标", '
    '"expected_artifact": "arch.md", "read_only": true}]}\n'
    "约束：delegations 1-5 个；role ∈ {arch, code_style, test, integration, risk, impl, verify}；"
    "read_only 布尔；worker_id/objective 非空。"
)

TASKS = [
    "扫描一个 Python FastAPI + Next.js 单体仓库（backend/ + frontend/），生成架构文档。",
    "给一个变更：在 AgentRun 模型增加 parent_run_id 字段以支持多 Agent 编排。拆解实现任务。",
    "审计一个 daemon 进程管理的可靠性：lease 续约、孤儿清理、崩溃恢复。",
    "为一个 RBAC 权限系统补齐端到端测试。",
    "把一个 REST API 从同步改为异步（async/await + asyncpg）。",
    "排查一个 SSE 日志流前端收不到日志的 bug。",
    "为一个知识库模块设计生命周期：draft→confirmed→verified→promoted→deprecated。",
    "给一个 Git worktree 隔离方案做安全评审。",
    "为一个 LLM 工具调用失败率监控设计阈值与告警。",
    "重构一个 1000 行的 dispatch.py：抽出 _cleanup_before_dispatch helper。",
]


def load_creds() -> tuple[str, str, str]:
    """Return (token, base_url, model) from deploy/.env or root .env."""
    creds = {"token": "", "base_url": "", "model": "glm-5.2"}
    for f in (REPO / "deploy" / ".env", REPO / ".env"):
        if not f.exists():
            continue
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if (
                k in ("ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY")
                and not creds["token"]
            ):
                creds["token"] = v
            elif k == "ANTHROPIC_BASE_URL":
                creds["base_url"] = v
            elif k == "ANTHROPIC_DEFAULT_SONNET_MODEL":
                creds["model"] = v
    return creds["token"], creds["base_url"], creds["model"]


def extract_json(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    candidate = m.group(0)
    for attempt in (candidate, re.sub(r",\s*([}\]])", r"\1", candidate)):
        try:
            return json.loads(attempt)
        except json.JSONDecodeError:
            continue
    return None


def validate(data: dict) -> tuple[bool, str]:
    dels = data.get("delegations")
    if not isinstance(dels, list):
        return False, "delegations_not_list"
    if not (1 <= len(dels) <= 5):
        return False, f"n={len(dels)}_out_of_1..5"
    for i, d in enumerate(dels):
        if not isinstance(d, dict):
            return False, f"del[{i}]_not_dict"
        if d.get("role") not in ROLES:
            return False, f"del[{i}]_bad_role_{d.get('role')!r}"
        if not isinstance(d.get("read_only"), bool):
            return False, f"del[{i}]_read_only_not_bool"
        if not d.get("worker_id") or not d.get("objective"):
            return False, f"del[{i}]_missing_fields"
    return True, ""


async def call_glm(
    client: httpx.AsyncClient, token: str, base_url: str, model: str, task: str
) -> str:
    """Call GLM Anthropic-compatible /v1/messages, return text content."""
    endpoint = base_url.rstrip("/") + "/v1/messages"
    payload = {
        "model": model,
        "max_tokens": 2048,
        "system": SYSTEM,
        "messages": [
            {"role": "user", "content": f"任务：{task}\n\n输出委派清单 JSON："}
        ],
    }
    headers = {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": token,
        "authorization": f"Bearer {token}",
    }
    resp = await client.post(endpoint, headers=headers, json=payload, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    return "".join(
        b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
    )


async def run_one(
    client: httpx.AsyncClient,
    token: str,
    base_url: str,
    model: str,
    task: str,
    idx: int,
    sem: asyncio.Semaphore,
) -> dict:
    async with sem:
        try:
            text = await call_glm(client, token, base_url, model, task)
        except Exception as exc:
            return {
                "idx": idx,
                "parsed": False,
                "valid": False,
                "error": f"{type(exc).__name__}: {str(exc)[:200]}",
                "task": task[:40],
            }
    data = extract_json(text)
    if data is None:
        return {
            "idx": idx,
            "parsed": False,
            "valid": False,
            "error": "unparseable",
            "raw_tail": text[-500:],
            "task": task[:40],
        }
    ok, reason = validate(data)
    dels = data.get("delegations")
    return {
        "idx": idx,
        "parsed": True,
        "valid": ok,
        "reason": reason,
        "n": len(dels) if isinstance(dels, list) else -1,
        "keys": list(data.keys()),
        "raw": json.dumps(data, ensure_ascii=False)[:700],
        "task": task[:40],
    }


async def amain(n: int) -> int:
    token, base_url, model = load_creds()
    if not token or not base_url:
        print("[spike04] missing ANTHROPIC token/base_url in deploy/.env", flush=True)
        return 2
    print(
        f"[spike04] model={model} base={base_url} N={n} (direct messages API)",
        flush=True,
    )

    sem = asyncio.Semaphore(3)
    # trust_env=False: GLM endpoint (open.bigmodel.cn) is domestic; don't inherit the
    # env SOCKS proxy (which is for reaching anthropic.com and lacks socksio).
    async with httpx.AsyncClient(trust_env=False) as client:
        results = await asyncio.gather(
            *[
                run_one(client, token, base_url, model, t, i, sem)
                for i, t in enumerate(TASKS[:n])
            ]
        )

    total = len(results)
    parsed = sum(r["parsed"] for r in results)
    valid = sum(r["valid"] for r in results)
    h1, h2 = parsed / total, valid / total
    modes: dict[str, int] = {}
    for r in results:
        if not r["valid"]:
            k = r.get("error") or r.get("reason") or "unknown"
            modes[k] = modes.get(k, 0) + 1

    out = Path(__file__).parent / "result.json"
    out.write_text(
        json.dumps(
            {
                "n": total,
                "model": model,
                "h1": round(h1, 3),
                "h2": round(h2, 3),
                "modes": modes,
                "results": results,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(
        f"[spike04] H1 parseable: {parsed}/{total} = {h1:.0%} "
        f"(gate >=80%) {'PASS' if h1 >= 0.8 else 'FAIL'}",
        flush=True,
    )
    print(
        f"[spike04] H2 valid    : {valid}/{total} = {h2:.0%} "
        f"(gate >=80%) {'PASS' if h2 >= 0.8 else 'FAIL'}",
        flush=True,
    )
    print(f"[spike04] D1 modes    : {modes or 'none'}", flush=True)
    print(f"[spike04] wrote {out}", flush=True)
    return 0 if (h1 >= 0.8 and h2 >= 0.8) else 1


def main() -> int:
    n = int(os.sys.argv[1]) if len(os.sys.argv) > 1 else 10
    return asyncio.run(amain(n))


if __name__ == "__main__":
    raise SystemExit(main())
