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
  return spawnSync(command, [], {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    shell: true,
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
  const files = new Set(gitLines(["diff", "--name-only", "--cached"]));

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
  hasBackend = true;
  hasFrontend = true;
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
  if (!runCheck("backend: mypy", "uv run mypy app", { cwd: "backend" })) {
    failures.push("backend: mypy");
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
  deny(`Local CI checks failed; git commit was blocked:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  process.exit(0);
}

log("all checks passed; git commit may continue");
