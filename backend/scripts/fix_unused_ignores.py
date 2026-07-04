"""批量删除 mypy 报告的 unused type:ignore 注释。

跑 mypy → 解析 unused-ignore 错 → 删对应行的 `# type: ignore[code]`。
"""

import re
import subprocess
import sys


def main() -> int:
    result = subprocess.run(
        ["uv", "run", "mypy", "app"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    out = result.stdout + result.stderr

    file_lines: dict[str, list[int]] = {}
    pat = re.compile(r"^(.+?):(\d+): error: Unused \"type: ignore\"")
    for line in out.splitlines():
        m = pat.match(line)
        if m:
            f = m.group(1).replace("\\", "/")
            file_lines.setdefault(f, []).append(int(m.group(2)))

    if not file_lines:
        print("no unused-ignore errors")
        return 0

    total = 0
    for f, lns in file_lines.items():
        try:
            with open(f, encoding="utf-8") as fh:
                lines = fh.read().split("\n")
        except FileNotFoundError:
            continue
        lns_set = set(lns)
        changed = False
        for i, raw in enumerate(lines, start=1):
            if i not in lns_set:
                continue
            new = re.sub(
                r"\s*#\s*type:\s*ignore(\[[^\]]*\])?(?=\s*$)",
                "",
                raw,
            )
            if new != raw:
                lines[i - 1] = new
                total += 1
                changed = True
        if changed:
            with open(f, "w", encoding="utf-8") as fh:
                fh.write("\n".join(lines))
            print(f"fixed {len(lns_set)} in {f}")

    print(f"total removed: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
