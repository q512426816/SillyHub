#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function isGitCommit(command) {
  return /(^|[;&|]\s*|\s)git(?:\s+-C\s+\S+)?\s+commit(?:\s|$)/.test(command);
}

function blocksAllTrackedChanges(command) {
  return /(^|\s)(?:-a|--all)(?:\s|$)/.test(command);
}

function log(message) {
  process.stderr.write(`[claude-pre-commit] ${message}\n`);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
}

function run(command, options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  // Ensure uv is on PATH (Windows: %USERPROFILE%\.local\bin, Unix: ~/.local/bin)
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const uvBin = require("path").join(home, ".local", "bin");
  if (!env.PATH.split(/[:;]/).includes(uvBin)) {
    env.PATH = uvBin + (process.platform === "win32" ? ";" : ":") + env.PATH;
  }
  return spawnSync(command, [], {
    cwd: options.cwd,
    env: env,
    encoding: "utf8",
    shell: true,
    // maxBuffer 默认 1MB：vitest 全量输出（含 jsdom stderr 噪音）远超 1MB，
    // 攒满即子进程被杀（status=null、无 Test Files 汇总、死点随机）——
    // 2026-08-27 实证 hook 连续误拦 "frontend: test failed" 而手动跑全绿。
    maxBuffer: 64 * 1024 * 1024,
  });
}

function gitLines(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function changedFiles(command) {
  // --diff-filter=ACMR：只取新增/复制/修改/重命名（新名），排除删除态——
  // 删除的文件传给 mypy 会报 "Can't get file 'x'"，无意义且让检查假 fail。
  const files = new Set(gitLines(["diff", "--name-only", "--cached", "--diff-filter=ACMR"]));

  if (blocksAllTrackedChanges(command)) {
    for (const file of gitLines(["diff", "--name-only"])) {
      files.add(file);
    }
  }

  return [...files];
}

function runCheck(label, command, options = {}) {
  log(`${label} ...`);
  const result = run(command, options);

  if (result.stdout) {
    process.stderr.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status === 0) {
    log(`${label} passed`);
    return true;
  }

  log(`${label} failed`);
  return false;
}

const input = readHookInput();
const command = input.tool_input && input.tool_input.command ? input.tool_input.command : "";

if (!isGitCommit(command)) {
  process.exit(0);
}

log("git commit detected; running local CI checks");

const files = changedFiles(command);
let hasBackend = files.some((file) => file.startsWith("backend/"));
let hasFrontend = files.some((file) => file.startsWith("frontend/"));

if (!hasBackend && !hasFrontend) {
  // 仅 docs / 配置 / 根目录文件变更：跳过全量 CI（worktree 环境下无
  // node_modules/.venv，跑 frontend/backend 检查必然失败）。
  log("no backend/frontend changes detected; skipping CI checks");
  process.exit(0);
}

const failures = [];

if (hasBackend) {
  log("=== Backend checks ===");
  if (!runCheck("backend: ruff check", "uv run ruff check .", { cwd: "backend" })) {
    failures.push("backend: ruff check");
  }
  if (!runCheck("backend: ruff format", "uv run ruff format --check .", { cwd: "backend" })) {
    failures.push("backend: ruff format");
  }
  // mypy：只扫本次 staged 的 backend .py（不写死全仓 `mypy app`）。
  // 背景：多子代理并发改同一 worktree 不同模块时，全仓 `mypy app` 会扫到他人
  // 未提交的在途文件 / 预存 mypy 债，把彼此 commit 卡死（task-12/14 实际撞过）。
  // mypy 传文件列表只报命令行显式文件的错误（默认 --follow-imports=normal），
  // 依赖模块分析但不报，commit 不被他人债拖累。代价：跨文件类型错误（调用方传
  // 错类型给被改的函数）单文件扫不到，由 log 提醒手动跑全仓 + CI 兜底。
  const backendPyFiles = files
    .filter((f) => f.startsWith("backend/") && f.endsWith(".py"))
    .map((f) => f.slice("backend/".length));
  if (backendPyFiles.length > 0) {
    const fileList = backendPyFiles.map((f) => `"${f}"`).join(" ");
    if (!runCheck("backend: mypy", `uv run mypy ${fileList}`, { cwd: "backend" })) {
      failures.push("backend: mypy");
    }
    // 单文件扫不覆盖跨文件类型错误——提醒手动跑全仓（不拦截、不自动跑，免拖慢 commit）。
    log(
      "提醒: pre-commit 只 mypy 了本次 staged 的 backend .py；跨文件类型检查请手动 `cd backend && uv run mypy app`（本次不拦截）"
    );
  } else {
    log("no backend .py staged; mypy skipped");
  }

  // 提醒式守门（2026-07-04-frontend-openapi-types, D-004@V1）：后端 schema.py
  // 改动但前端 api-types.ts 未同步 → 仅 log 提醒，不 deny（避免 commit 时跑
  // Python dump 拖慢；强制 block 待全量迁移后开启）。
  const schemaChanged = files.some(
    (f) => f.startsWith("backend/app/modules/") && f.endsWith("schema.py")
  );
  const apiTypesSynced =
    files.includes("frontend/src/lib/api-types.ts") ||
    files.includes("backend/openapi.json");
  if (schemaChanged && !apiTypesSynced) {
    log(
      "提醒: 后端 schema.py 改动但 frontend/src/lib/api-types.ts 未同步，建议跑 `pnpm gen:types`（本次不拦截）"
    );
  }
}

if (hasFrontend) {
  log("=== Frontend checks ===");
  if (!runCheck("frontend: lint", "pnpm lint", { cwd: "frontend" })) {
    failures.push("frontend: lint");
  }
  if (!runCheck("frontend: typecheck", "pnpm typecheck", { cwd: "frontend" })) {
    failures.push("frontend: typecheck");
  }
  if (!runCheck("frontend: test", "pnpm test", { cwd: "frontend" })) {
    failures.push("frontend: test");
  }
}

if (failures.length > 0) {
  // PreToolUse deny 是工具调用级拦截：整条 Bash 命令未执行——复合命令里的
  // git add 也没跑（暂存区未变）。不点破这一点，重试容易只重跑 commit，
  // 漏掉链上的 add → 静默漏提交（2026-08-27 实证：QUICKLOG 漏提交）。
  const addHint = /\bgit\s+add\b/.test(command)
    ? "\n注意：整条命令未执行（含其中的 git add，暂存区未变）。重试必须从 git add 重新发起整链，否则 add 的文件会静默漏提交。"
    : "\n注意：整条命令未执行（PreToolUse 拦截发生在执行前），修复后重试即可。";
  deny(
    `Local CI checks failed; git commit was blocked:\n${failures.map((item) => `- ${item}`).join("\n")}` +
      addHint
  );
  process.exit(0);
}

log("all checks passed; git commit may continue");
