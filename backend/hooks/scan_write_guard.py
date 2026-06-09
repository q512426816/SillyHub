"""PreToolUse hook for Claude Code — blocks writes to forbidden paths during scan.

Reads target file paths from tool_input and checks against environment variables:
- SCAN_DENIED_WRITE_PATHS: colon-separated path prefixes that are forbidden
- SCAN_ALLOWED_WRITE_PATHS: colon-separated path prefixes that are allowed

When SCAN_DENIED_WRITE_PATHS is empty, the hook passes through (non-scan runs).

Exit codes:
- 0 with JSON deny output: block the tool call
- 0 with no output: allow (normal permission flow applies)
"""

from __future__ import annotations

import json
import os
import sys


def _normalize(p: str) -> str:
    return p.rstrip("/").rstrip("\\")


def _is_denied(file_path: str, denied_prefixes: list[str]) -> bool:
    fp = _normalize(file_path)
    return any(
        fp == dp or fp.startswith(dp + "/") or fp.startswith(dp + "\\") for dp in denied_prefixes
    )


def _is_allowed(file_path: str, allowed_prefixes: list[str]) -> bool:
    if not allowed_prefixes:
        return True
    fp = _normalize(file_path)
    return any(
        fp == ap or fp.startswith(ap + "/") or fp.startswith(ap + "\\") for ap in allowed_prefixes
    )


def _deny(reason: str) -> None:
    output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }
    sys.stdout.write(json.dumps(output))
    sys.stdout.flush()


def _check_path(file_path: str, denied: list[str], allowed: list[str]) -> str | None:
    if not file_path:
        return None
    if _is_denied(file_path, denied):
        return f'Write to "{file_path}" blocked: path is in the denied list for scan runs'
    if not _is_allowed(file_path, allowed):
        return f'Write to "{file_path}" blocked: path is outside allowed write directories for scan runs'
    return None


def main() -> None:
    denied_str = os.environ.get("SCAN_DENIED_WRITE_PATHS", "")
    if not denied_str:
        return

    denied = [_normalize(p) for p in denied_str.split(":") if p.strip()]
    allowed_str = os.environ.get("SCAN_ALLOWED_WRITE_PATHS", "")
    allowed = [_normalize(p) for p in allowed_str.split(":") if p.strip()] if allowed_str else []

    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, Exception):
        return

    tool_input = data.get("tool_input", {})

    # Write / Edit: single file_path
    file_path = tool_input.get("file_path", "")
    if file_path:
        reason = _check_path(file_path, denied, allowed)
        if reason:
            _deny(reason)
            return

    # MultiEdit: multiple edits with file_path in each
    edits = tool_input.get("edits", [])
    if isinstance(edits, list):
        for edit in edits:
            if isinstance(edit, dict):
                fp = edit.get("file_path", "")
                if fp:
                    reason = _check_path(fp, denied, allowed)
                    if reason:
                        _deny(reason)
                        return


if __name__ == "__main__":
    main()
