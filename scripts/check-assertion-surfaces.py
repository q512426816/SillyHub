#!/usr/bin/env python3
"""共享断言面同步闸门（pre-commit check-only，2026-10-11-assertion-surface-guard）。

「改契约必须同一提交内同步钉子测试」的机制化防呆——提醒性手段（源码注释 +
knowledge 条目）拦不住：2026-10-07/08 两轮 CI 清偿 14 失败中 9 处同模式，本周
CI 清偿再见迁移锚 / TABS 数 / 菜单声明序 / 协议 MSG 计数四处漏跟。

规则清单（权威源 = .sillyspec/knowledge/testing-gotchas.md「共享断言面」条目，
本脚本是同一清单的可执行形态——新增断言面两处同步登记）：
  ① alembic 新迁移 → 链尾锚测试（每迁移前移一行）
  ② daemon 心跳加参 → length 钉四文件
  ③ WorkspaceTabs 增删页签 → 数量钉 + 高亮钉
  ④ provider caps 形状变更 → 全对象 toEqual 钉
  ⑤ previewers 桶导出增删 → 枚举式 vi.mock 两文件
  ⑥ backend 词表/字段形态（agent_kinds）→ daemon 对账正则
  ⑦ 菜单注册表增删项 → 声明序索引钉（本周实证新登记）
  ⑧ 协议 MSG 常量增删 → MSG 总数钉（本周实证新登记）

触发模式：
  file 模式——staged 面出现 glob 匹配文件即触发（迁移：加文件本身就是事件）；
  diff 模式——staged diff 的增删行命中内容锚才触发（避免注释级误拦）。

跑法：pre-commit 自动（staged 面）；手工 `python scripts/check-assertion-surfaces.py`。
退出码：0 = 无漏同步；1 = 有漏同步（打印同步指引，勿绕过——仓库规则 10）。
"""

from __future__ import annotations

import fnmatch
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Callable, Iterable


@dataclass(frozen=True)
class SurfaceRule:
    """一条断言面规则：surface 源触发 ⇒ requires 里的钉子测试必须在同提交。"""

    no: str  # 断言面编号（与 knowledge 条目对应）
    source: str  # 契约源文件/目录（展示用）
    glob: str  # staged 路径 fnmatch 模式（diff 模式为具体文件）
    mode: str  # "file"：文件出现即触发；"diff"：增删行命中 diff_pattern 才触发
    diff_pattern: str  # diff 模式的内容锚（对剥掉 +/- 前缀后的行匹配）
    requires: tuple[str, ...]  # 必须同一提交的钉子测试文件
    hint: str  # 被拦时的同步指引


RULES: tuple[SurfaceRule, ...] = (
    SurfaceRule(
        no="①",
        source="backend/migrations/versions/*.py",
        glob="backend/migrations/versions/*.py",
        mode="file",
        diff_pattern="",
        requires=("backend/tests/test_align_platform_change_events_migration.py",),
        hint="迁移链尾锚测试 heads[0] 前移到新 head（注释链续写）",
    ),
    SurfaceRule(
        no="②",
        source="sillyhub-daemon/src/daemon.ts（心跳平铺传参）",
        glob="sillyhub-daemon/src/daemon.ts",
        mode="diff",
        diff_pattern="_sendHeartbeatOnce",
        requires=(
            "sillyhub-daemon/tests/daemon-heartbeat-pending.test.ts",
            "sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts",
            "sillyhub-daemon/tests/sillyspec-platform-command.test.ts",
            "sillyhub-daemon/tests/integration/selfupdate-scenarios.test.ts",
        ),
        hint="四处 length 钉 N→N+1（d6fabf408 machine-id 漏跟实证）",
    ),
    SurfaceRule(
        no="③",
        source="frontend/src/components/workspace-tabs.tsx（TABS 数组）",
        glob="frontend/src/components/workspace-tabs.tsx",
        mode="diff",
        diff_pattern=r"\{.*key:.*path:",
        requires=(
            "frontend/src/components/git-log/__tests__/git-log-page.test.tsx",
            "frontend/src/components/__tests__/workspace-tabs.test.tsx",
        ),
        hint="页签数量钉 toHaveLength(N) 与高亮用例按 path 同步（e8da254ce 漏跟实证）",
    ),
    SurfaceRule(
        no="④",
        source="frontend/src/lib/provider-caps.ts（ProviderCaps 形状）",
        glob="frontend/src/lib/provider-caps.ts",
        mode="diff",
        diff_pattern=r"interface ProviderCaps|ProviderCaps =|^\s*\w+: (?:true|false)[,;]?\s*$",
        requires=(
            "frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx",
        ),
        hint="全对象 toEqual 钉两处逐键同步（b8afd807c 误删 multimodal 实证）",
    ),
    SurfaceRule(
        no="⑤",
        source="frontend/src/components/files/previewers.tsx（桶导出）",
        glob="frontend/src/components/files/previewers.tsx",
        mode="diff",
        diff_pattern=r"^export ",
        requires=(
            "frontend/src/components/files/__tests__/onlyoffice-preview.test.tsx",
            "frontend/src/components/files/__tests__/file-preview-modal.test.tsx",
        ),
        hint="枚举式 vi.mock 导出清单同步，缺导出整套件收集炸（fa799e68b 实证）",
    ),
    SurfaceRule(
        no="⑥",
        source="backend/app/modules/llm_provider/schema.py（词表/字段形态）",
        glob="backend/app/modules/llm_provider/schema.py",
        mode="diff",
        diff_pattern="agent_kinds",
        requires=("sillyhub-daemon/tests/provider-adapter-registry.test.ts",),
        hint="daemon 对账正则按声明形态同步（单数→复数 list Literal 漂移实证）",
    ),
    SurfaceRule(
        no="⑦",
        source="frontend/src/lib/menu-permissions.ts（菜单注册表）",
        glob="frontend/src/lib/menu-permissions.ts",
        mode="diff",
        diff_pattern="menuKey:",
        requires=("frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx",),
        hint="组内上移/下移用例声明序锚重算（8a928588f 删两项全体前移实证）",
    ),
    SurfaceRule(
        no="⑧",
        source="sillyhub-daemon/src/protocol.ts（MSG 常量）",
        glob="sillyhub-daemon/src/protocol.ts",
        mode="diff",
        diff_pattern=r"^\s*[A-Z_]+:\s*'daemon:",
        requires=("sillyhub-daemon/tests/protocol-session-contract.test.ts",),
        hint="MSG 总数钉 N→N+1 并补键值回归用例（0b09d1555 漏跟实证）",
    ),
)


def changed_diff_lines(diff_text: str) -> list[str]:
    """从 unified diff 文本提取增删行（剥 +/- 前缀；跳过文件头与 \n 行）。"""
    out: list[str] = []
    for line in diff_text.splitlines():
        if line.startswith(("+++", "---", "diff ", "index ", "@@")):
            continue
        if line.startswith("+") or line.startswith("-"):
            out.append(line[1:])
    return out


def evaluate(
    rules: Iterable[SurfaceRule],
    staged: list[str],
    diff_fetch: Callable[[str], str],
) -> list[SurfaceRule]:
    """纯函数：返回「触发但配对测试未同提交」的规则列表。

    diff_fetch(glob) 返回该规则源文件的 staged diff 文本（file 模式不调用）。
    """
    staged_set = set(staged)
    violations: list[SurfaceRule] = []
    for rule in rules:
        hit_sources = [p for p in staged if fnmatch.fnmatch(p, rule.glob)]
        if not hit_sources:
            continue
        if rule.mode == "diff":
            lines = changed_diff_lines(diff_fetch(rule.glob))
            if not any(re.search(rule.diff_pattern, ln) for ln in lines):
                continue
        missing = [t for t in rule.requires if t not in staged_set]
        if missing:
            violations.append(rule)
    return violations


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    ).stdout


def main() -> int:
    staged = [p for p in _git("diff", "--cached", "--name-only").splitlines() if p]
    if not staged:
        return 0

    def diff_fetch(glob: str) -> str:
        return _git("diff", "--cached", "--unified=0", "--", glob)

    violations = evaluate(RULES, staged, diff_fetch)
    if not violations:
        return 0

    print(
        "共享断言面同步闸门：以下契约源被触碰，但配对钉子测试不在本提交：",
        file=sys.stderr,
    )
    for rule in violations:
        missing = [t for t in rule.requires if t not in set(staged)]
        print(f"  {rule.no} {rule.source}", file=sys.stderr)
        for t in missing:
            print(f"     缺: {t}", file=sys.stderr)
        print(
            f"     ↩ {rule.hint}；同一提交内同步后重新 add（清单: knowledge/testing-gotchas.md）",
            file=sys.stderr,
        )
    print(
        "  （若确认本次改动确实不触及钉子断言，把对应测试文件一并纳入评审说明，勿绕过——仓库规则 10）",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
