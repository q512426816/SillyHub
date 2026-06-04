"""Spike 03 — Claude Code 子进程可控性验证。

要求：
  1. 已安装 claude code CLI (`claude` 命令可用)
  2. 设置环境变量 ANTHROPIC_API_KEY
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


CLAUDE_BIN = shutil.which("claude") or shutil.which("claude-code")


def run_claude_in_box(
    task_prompt: str, sample_seed: str = "print('hi from spike')"
) -> dict:
    if not CLAUDE_BIN:
        return {"error": "claude CLI not found in PATH"}
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    auth_token = os.environ.get("ANTHROPIC_AUTH_TOKEN")
    if not api_key and not auth_token:
        return {"error": "ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN not set"}

    tmp = Path(tempfile.mkdtemp(prefix="cc-spike-"))
    workdir = tmp / "repo"
    home = tmp / "home"
    workdir.mkdir()
    home.mkdir()
    sample = workdir / "sample"
    sample.mkdir()
    # seed 一个文件，证明 Claude 是在我们准备的目录里
    (sample / "seed.txt").write_text("seed\n", encoding="utf-8")

    env = {
        "HOME": str(home),
        "USERPROFILE": str(home),  # Windows
        "PATH": os.environ.get("PATH", ""),
    }
    if api_key:
        env["ANTHROPIC_API_KEY"] = api_key
    if auth_token:
        env["ANTHROPIC_AUTH_TOKEN"] = auth_token
    base_url = os.environ.get("ANTHROPIC_BASE_URL")
    if base_url:
        env["ANTHROPIC_BASE_URL"] = base_url
    # 透传可选的网络代理 / 模型映射 / 其他 Anthropic SDK 环境
    for var in (
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "API_TIMEOUT_MS",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
        "ComSpec",
        "SystemRoot",
        "SystemDrive",
        "TEMP",
        "TMP",
        "PATHEXT",
    ):
        if var in os.environ:
            env[var] = os.environ[var]

    argv = [
        CLAUDE_BIN,
        "-p",
        task_prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        "Read,Write,Edit",
        "--add-dir",
        str(workdir),
        "--max-turns",
        "5",
    ]

    try:
        proc = subprocess.run(
            argv,
            cwd=workdir,
            env=env,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
        )
        stdout = proc.stdout
        stderr = proc.stderr
        exit_code = proc.returncode
    except subprocess.TimeoutExpired:
        return {"error": "timeout", "tmp": str(tmp)}

    diff: list[str] = []
    for f in workdir.rglob("*"):
        if not f.is_file():
            continue
        rel = f.relative_to(workdir)
        if str(rel).startswith(".git"):
            continue
        diff.append(str(rel))

    leaked: list[str] = []
    for p in home.rglob("*"):
        if not p.is_file():
            continue
        rel = str(p.relative_to(home))
        # 允许 .cache / .config 类（Claude 可能写自己的状态），但要标记
        if rel.startswith((".cache", ".config", ".claude")):
            continue
        leaked.append(rel)

    key_values = [v for v in (api_key, auth_token) if v]
    key_leak = any(k in stdout or k in stderr for k in key_values)

    return {
        "exit_code": exit_code,
        "stdout_tail": stdout[-2000:],
        "stderr_tail": stderr[-2000:],
        "files_in_workdir": sorted(diff),
        "leaked_to_home": sorted(leaked),
        "api_key_leaked": key_leak,
        "tmp": str(tmp),
    }


def main() -> int:
    prompt = (
        "在当前工作目录的 sample/ 子目录下创建一个 hello.py 文件，"
        "文件内容为 print('hi from spike')。仅创建这个文件，不做其他操作。"
    )
    result = run_claude_in_box(prompt)
    print(
        json.dumps(
            {k: v for k, v in result.items() if k != "stdout_tail"},
            indent=2,
            ensure_ascii=False,
        )
    )

    if "error" in result:
        print(f"[spike03] FAIL: {result['error']}", file=sys.stderr)
        return 1

    fails: list[str] = []
    if result["exit_code"] != 0:
        fails.append(f"exit_code={result['exit_code']}")
    if not any(
        "sample/hello.py" in f or "sample\\hello.py" in f
        for f in result["files_in_workdir"]
    ):
        fails.append("hello.py not created")
    if result["leaked_to_home"]:
        fails.append(f"leaked_to_home={result['leaked_to_home']}")
    if result["api_key_leaked"]:
        fails.append("api_key leaked to stdout")

    if fails:
        print(f"[spike03] SPIKE FAILED: {fails}", file=sys.stderr)
        return 1
    print("[spike03] SPIKE PASSED", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
