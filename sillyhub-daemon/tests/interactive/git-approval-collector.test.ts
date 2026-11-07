/**
 * interactive/git-approval-collector 单测（2026-11-06-session-git-approval task-02）。
 *
 * 手法：注入 execFile fixture（对齐 turn-file-changes.test.ts 惯例的假件面）——
 * porcelain v2 -z / numstat 双口径 / git log 明细全部以真实 git 输出形态构造字符串，
 * 解析口径以 `--porcelain=v2 -z`（NUL 终止、`1` 条目 path 空格分隔实证坑）为准。
 *
 * 覆盖（= task-02 acceptance 逐条）：
 *   1. porcelain 解析：staged 归属 / 中文与含空格路径（R-07）/ rename 取 new 路径；
 *   2. numstat 双口径合并（staged 取 --cached、未暂存取工作区）；
 *   3. push 态 ahead 明细（sha/subject/author/date/files；rename 取 new；>20 显统计；
 *      每提交 >50 截断为样本+统计）；无上游分支降级不抛；
 *   4. R-03 截断三档（files>500 / 每提交 files>50 / ahead>20）；
 *   5. defaultSelected 四分支接线（D-012：pathspec / -a / 暂存区 / 暂存区空勾全部）；
 *   6. 容量实测（R-03 验收）：500 文件 fixture 的 payload 序列化 < 512KB
 *      （查证事实：dialog_payload 为 JSON 列无固定上限、8KB 截断仅 bash_chunk 事件，
 *       512KB 为保守断言上限）。
 */
import { describe, expect, it } from "vitest";

import {
  collectGitApprovalPayload,
  parseLogNameStatus,
  parseNumstat,
  parsePorcelainV2Z,
  type GitApprovalExecFile,
  type GitApprovalPayload,
} from "../../src/interactive/git-approval-collector.js";
import { detectGitWriteIntent } from "../../src/interactive/git-command-guard.js";

/* ───────────── fixture 工具 ───────────── */

const NUL = "\0";
const SEP = "\x1f";

/** 典型 porcelain v2 -z 输出：分支 main 领先 3；staged 修改 + 未暂存修改 + rename + 未跟踪。 */
const PORCELAIN_FIXTURE = [
  "# branch.oid 1234567890abcdef",
  "# branch.head main",
  "# branch.upstream origin/main",
  "# branch.ab +3 -0",
  // staged modified（X=M Y=空格→worktree 无二次改动）
  `1 M. N... 100644 100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} backend/app/service.py`,
  // staged modified + worktree 又改（XY=M M）
  `1 MM N... 100644 100644 100644 ${"c".repeat(40)} ${"d".repeat(40)} docs/中文 文档.md`,
  // 仅未暂存 modified（XY=.M）
  `1 .M N... 100644 100644 100644 ${"e".repeat(40)} ${"f".repeat(40)} frontend/src/app.tsx`,
  // staged deleted
  `1 D. N... 100644 000000 000000 ${"0".repeat(40)} ${"0".repeat(40)} old/removed.txt`,
  // staged rename（2 条目；new path 含空格；origPath 为随后 NUL 段）
  `2 R. N... 100644 100644 100644 ${"1".repeat(40)} ${"2".repeat(40)} new dir/renamed file.ts`,
  "old dir/original file.ts",
  // untracked
  "? notes/未跟踪 草稿.md",
]
  .join(NUL) + NUL;

const NUMSTAT_UNSTAGED = ["10\t2\tfrontend/src/app.tsx", "5\t0\tdocs/中文 文档.md"].join("\n") + "\n";
const NUMSTAT_STAGED = [
  "38\t4\tbackend/app/service.py",
  "12\t2\tdocs/中文 文档.md",
  "0\t0\tnew dir/renamed file.ts",
  "0\t9\told/removed.txt",
].join("\n") + "\n";

/** ahead 明细 fixture（2 条提交；第 2 条含 rename R100 双路径）。 */
const LOG_NS_FIXTURE =
  [
    `fff0001${SEP}feat: first${SEP}qinyi${SEP}2026-11-06`,
    "M\tbackend/a.py",
    "A\tfrontend/b.tsx",
    "",
    `fff0002${SEP}feat: second${SEP}qinyi${SEP}2026-11-06`,
    "R100\told/x.ts\tnew/x.ts",
  ].join("\n") + NUL;
const LOG_NUM_FIXTURE = ["fff0001", "20\t1\tbackend/a.py", "8\t0\tfrontend/b.tsx", "", "fff0002", "3\t3\tnew/x.ts"].join("\n") + NUL;

/** 按 args 关键词分发的 fixture 执行器。 */
function makeExec(routes: Array<{ match: (args: string[]) => boolean; stdout?: string; reject?: boolean }>): GitApprovalExecFile {
  return async (args) => {
    for (const r of routes) {
      if (r.match(args)) {
        if (r.reject) throw new Error("fixture: command failed");
        return { stdout: r.stdout ?? "", stderr: "" };
      }
    }
    return { stdout: "", stderr: "" };
  };
}

function baseRoutes(overrides?: Partial<Record<"status" | "unstaged" | "staged" | "logNs" | "logNum", { stdout?: string; reject?: boolean }>>): Array<{ match: (args: string[]) => boolean; stdout?: string; reject?: boolean }> {
  return [
    {
      match: (a) => a.includes("status"),
      stdout: overrides?.status ? PORCELAIN_FIXTURE : undefined,
      ...(overrides?.status ?? {}),
    },
  ];
}

/** 完整路由 fixture（status/双 numstat/log 两口径）。 */
function fullExec(over: {
  status?: string;
  unstaged?: string;
  staged?: string;
  logNs?: string;
  logNum?: string;
  logReject?: boolean;
} = {}): GitApprovalExecFile {
  return makeExec([
    { match: (a) => a.includes("status"), stdout: over.status ?? PORCELAIN_FIXTURE },
    { match: (a) => a.includes("diff") && a.includes("--cached"), stdout: over.staged ?? NUMSTAT_STAGED },
    { match: (a) => a.includes("diff"), stdout: over.unstaged ?? NUMSTAT_UNSTAGED },
    { match: (a) => a.includes("--name-status"), stdout: over.logNs ?? LOG_NS_FIXTURE },
    { match: (a) => a.includes("log"), stdout: over.logNum ?? LOG_NUM_FIXTURE, reject: over.logReject },
  ]);
}

function intentOf(command: string) {
  const intent = detectGitWriteIntent(command);
  expect(intent).not.toBeNull();
  return intent!;
}

const CTX = { cwd: "C:/repo", sessionId: "s-1" };

/* ───────────── porcelain v2 -z 解析 ───────────── */

describe("parsePorcelainV2Z", () => {
  it("解析 branch/ahead 与 staged 归属（R-07：空格/中文路径、1 条目 path 空格分隔）", () => {
    const p = parsePorcelainV2Z(PORCELAIN_FIXTURE);
    expect(p.branch).toBe("main");
    expect(p.ahead).toBe(3);
    expect(p.behind).toBe(0);
    const byPath = new Map(p.files.map((f) => [f.path, f]));
    expect(byPath.get("backend/app/service.py")).toMatchObject({ status: "modified", staged: true });
    expect(byPath.get("docs/中文 文档.md")).toMatchObject({ status: "modified", staged: true });
    expect(byPath.get("frontend/src/app.tsx")).toMatchObject({ status: "modified", staged: false });
    expect(byPath.get("old/removed.txt")).toMatchObject({ status: "deleted", staged: true });
    expect(byPath.get("notes/未跟踪 草稿.md")).toMatchObject({ status: "untracked", staged: false });
  });

  it("rename（2 条目）取 new 路径归 renamed，origPath 段被跳过不产生伪条目", () => {
    const p = parsePorcelainV2Z(PORCELAIN_FIXTURE);
    expect(p.files.some((f) => f.path === "new dir/renamed file.ts" && f.status === "renamed" && f.staged)).toBe(true);
    expect(p.files.some((f) => f.path === "old dir/original file.ts")).toBe(false);
    expect(p.files).toHaveLength(6);
  });
});

/* ───────────── numstat 解析 ───────────── */

describe("parseNumstat", () => {
  it("tab 三列解析，binary `-` 归 0", () => {
    const m = parseNumstat("1\t2\ta.txt\n-\t-\tbin.dat\n");
    expect(m.get("a.txt")).toEqual({ addLines: 1, delLines: 2 });
    expect(m.get("bin.dat")).toEqual({ addLines: 0, delLines: 0 });
  });
});

/* ───────────── ahead 明细解析 ───────────── */

describe("parseLogNameStatus + applyLogNumstat（经 collect 集成）", () => {
  it("rename R100 双路径取 new；numstat 按 sha 回填", async () => {
    const payload = await collectGitApprovalPayload(intentOf("git push"), { ...CTX, execFile: fullExec() });
    const commits = payload.aheadCommits ?? [];
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({ sha: "fff0001", subject: "feat: first", author: "qinyi" });
    expect(commits[0]!.files.find((f) => f.path === "backend/a.py")).toMatchObject({ addLines: 20, delLines: 1 });
    const rn = commits[1]!.files.find((f) => f.path === "new/x.ts");
    expect(rn).toMatchObject({ status: "renamed", addLines: 3, delLines: 3 });
    expect(commits[1]!.files.some((f) => f.path === "old/x.ts")).toBe(false);
  });
});

/* ───────────── collectGitApprovalPayload 集成 ───────────── */

describe("collectGitApprovalPayload", () => {
  it("commit 态：numstat 双口径合并（staged 取 --cached、未暂存取工作区）", async () => {
    const payload = await collectGitApprovalPayload(intentOf('git commit -m "x"'), {
      ...CTX,
      execFile: fullExec(),
    });
    const byPath = new Map(payload.files.map((f) => [f.path, f]));
    // staged 文件取 --cached 口径 38/4（而非工作区口径 5/0）
    expect(byPath.get("backend/app/service.py")).toMatchObject({ addLines: 38, delLines: 4, staged: true });
    // 未暂存文件取工作区口径 10/2
    expect(byPath.get("frontend/src/app.tsx")).toMatchObject({ addLines: 10, delLines: 2, staged: false });
    // staged 且 worktree 又改（MM）：staged 口径优先
    expect(byPath.get("docs/中文 文档.md")).toMatchObject({ addLines: 12, delLines: 2, staged: true });
    expect(payload.branch).toBe("main");
    expect(payload.message).toBe("x");
  });

  it("push 态：remoteTarget 缺省 origin+当前分支；main 保护分支警示（D-006）", async () => {
    const payload = await collectGitApprovalPayload(intentOf("git push"), { ...CTX, execFile: fullExec() });
    expect(payload.remoteTarget).toBe("origin/main");
    expect(payload.protectedBranch).toBe(true);
    expect(payload.runner).toBe("git");
    expect(payload.aheadCount).toBe(3);
  });

  it("push 态：显式 remote/ref 与非保护分支", async () => {
    const payload = await collectGitApprovalPayload(intentOf("git push upstream dev"), {
      ...CTX,
      execFile: fullExec(),
    });
    expect(payload.remoteTarget).toBe("upstream/dev");
    expect(payload.protectedBranch).toBe(false);
  });

  it("sillyspec push：runner=sillyspec、remote/ref 从 --remote/--branch 解析", async () => {
    const payload = await collectGitApprovalPayload(intentOf("sillyspec push --remote origin --branch main"), {
      ...CTX,
      execFile: fullExec(),
    });
    expect(payload.runner).toBe("sillyspec");
    expect(payload.remoteTarget).toBe("origin/main");
    expect(payload.protectedBranch).toBe(true);
  });

  it("无上游分支（git log 失败）→ aheadCommits 空且不抛（降级面）", async () => {
    const payload = await collectGitApprovalPayload(intentOf("git push"), {
      ...CTX,
      execFile: fullExec({ logReject: true }),
    });
    expect(payload.aheadCommits).toEqual([]);
    expect(payload.aheadCount).toBe(3);
  });

  it("defaultSelected 四分支（D-012）：pathspec / -a / 暂存区 / 暂存区空勾全部", async () => {
    // ① pathspec：勾 pathspec ∩ 改动
    const p1 = await collectGitApprovalPayload(intentOf("git commit -m x -- frontend/src/app.tsx docs/不存在.md"), {
      ...CTX,
      execFile: fullExec(),
    });
    expect(new Set(p1.defaultSelected)).toEqual(new Set(["frontend/src/app.tsx"]));
    // ② -a：勾全部 tracked（非 untracked）
    const p2 = await collectGitApprovalPayload(intentOf("git commit -a -m x"), { ...CTX, execFile: fullExec() });
    expect(p2.defaultSelected).not.toContain("notes/未跟踪 草稿.md");
    expect(p2.defaultSelected).toContain("backend/app/service.py");
    // ③ 无 pathspec/-a：勾暂存区
    const p3 = await collectGitApprovalPayload(intentOf("git commit -m x"), { ...CTX, execFile: fullExec() });
    expect(new Set(p3.defaultSelected)).toEqual(
      new Set(["backend/app/service.py", "docs/中文 文档.md", "old/removed.txt", "new dir/renamed file.ts"]),
    );
    // ④ 暂存区空：勾全部改动
    const emptyStaged = PORCELAIN_FIXTURE.replace(
      `1 M. N... 100644 100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} backend/app/service.py${NUL}`,
      "",
    )
      .replace(`1 MM N... 100644 100644 100644 ${"c".repeat(40)} ${"d".repeat(40)} docs/中文 文档.md${NUL}`, `1 .M N... 100644 100644 100644 ${"c".repeat(40)} ${"d".repeat(40)} docs/中文 文档.md${NUL}`)
      .replace(`1 D. N... 100644 000000 000000 ${"0".repeat(40)} ${"0".repeat(40)} old/removed.txt${NUL}`, "")
      .replace(`2 R. N... 100644 100644 100644 ${"1".repeat(40)} ${"2".repeat(40)} new dir/renamed file.ts${NUL}`, "");
    const p4 = await collectGitApprovalPayload(intentOf("git commit -m x"), {
      ...CTX,
      execFile: fullExec({ status: emptyStaged }),
    });
    expect(new Set(p4.defaultSelected)).toEqual(new Set(["docs/中文 文档.md", "frontend/src/app.tsx", "notes/未跟踪 草稿.md"]));
  });

  it("R-03 截断①：files>500 → 样本 50 + filesTruncated + fileCount", async () => {
    const many = [PORCELAIN_FIXTURE];
    for (let i = 0; i < 501; i++) {
      many.push(`1 .M N... 100644 100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} dir/file-${i}.ts`);
    }
    const payload = await collectGitApprovalPayload(intentOf("git commit -m x"), {
      ...CTX,
      execFile: fullExec({ status: many.join(NUL) + NUL }),
    });
    expect(payload.filesTruncated).toBe(true);
    expect(payload.fileCount).toBe(501 + 6);
    expect(payload.files).toHaveLength(50);
  });

  it("R-03 截断③：ahead>20 → aheadTruncated 且 aheadCommits ≤20", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 21; i++) {
      lines.push(`sha-${i}${SEP}subject-${i}${SEP}qinyi${SEP}2026-11-06`, "M\ta.py", "");
    }
    const payload = await collectGitApprovalPayload(intentOf("git push"), {
      ...CTX,
      execFile: fullExec({ logNs: lines.join("\n") + NUL, logNum: "" }),
    });
    expect(payload.aheadTruncated).toBe(true);
    expect(payload.aheadCommits).toHaveLength(20);
  });

  it("R-03 截断②：单提交 files>50 → 该提交截断样本 + filesTruncated + fileCount", async () => {
    const lines: string[] = [`sha-big${SEP}big commit${SEP}qinyi${SEP}2026-11-06`];
    for (let i = 0; i < 51; i++) lines.push(`M\tfile-${i}.ts`);
    const payload = await collectGitApprovalPayload(intentOf("git push"), {
      ...CTX,
      execFile: fullExec({ logNs: lines.join("\n") + NUL, logNum: "" }),
    });
    const big = payload.aheadCommits?.[0];
    expect(big?.filesTruncated).toBe(true);
    expect(big?.fileCount).toBe(51);
    expect(big?.files).toHaveLength(50);
  });

  it("R-03 容量实测：500 文件 payload 序列化 < 512KB（查证：dialog_payload JSON 列、8KB 截断仅 bash_chunk）", async () => {
    const many = [`# branch.head main`];
    for (let i = 0; i < 500; i++) {
      many.push(`1 .M N... 100644 100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} some/deep/nested/path/file-${i}.ts`);
    }
    const payload: GitApprovalPayload = await collectGitApprovalPayload(intentOf("git commit -m x"), {
      ...CTX,
      execFile: fullExec({ status: many.join(NUL) + NUL }),
    });
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    expect(payload.files).toHaveLength(500); // 500 恰不触发截断
    expect(bytes).toBeLessThan(512 * 1024);
  });

  it("git -C <path>：采集落在 intent.workDir（cwd 覆盖）", async () => {
    let seenCwd = "";
    const exec: GitApprovalExecFile = async (args, opts) => {
      seenCwd = opts.cwd;
      if (args.includes("status")) return { stdout: PORCELAIN_FIXTURE, stderr: "" };
      if (args.includes("diff") && args.includes("--cached")) return { stdout: NUMSTAT_STAGED, stderr: "" };
      if (args.includes("diff")) return { stdout: NUMSTAT_UNSTAGED, stderr: "" };
      return { stdout: "", stderr: "" };
    };
    await collectGitApprovalPayload(intentOf("git -C D:/other commit -m x"), { ...CTX, execFile: exec });
    expect(seenCwd).toBe("D:/other");
  });
});
