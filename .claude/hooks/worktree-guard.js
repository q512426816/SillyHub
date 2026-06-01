/**
 * worktree-guard.js — Hook 拦截判断逻辑
 *
 * 三重门禁：stageGate × locationGate × fileGate
 * 纯判断模块，不做实际的 hook 注入。
 *
 * P0 优化：
 * - 阶段检测 fallback：gate-status.json → sillyspec.db currentStage
 * - 拦截提示针对每个阶段给出具体修复建议
 */

import { existsSync, readFileSync } from 'fs'
import path from 'path'

// ── 常量 ──

const ALLOWED_STAGES = ['execute', 'quick']

const WORKTREE_SEGMENT = '.sillyspec/.runtime/worktrees/'

const FILE_WHITELIST_EXTS = ['.md']
const FILE_WHITELIST_NAMES = ['package.json', 'tsconfig.json', 'local.yaml', 'local.yml']

/** 只读命令（命令名） */
const READONLY_COMMANDS = new Set([
  'grep', 'rg', 'ag', 'find', 'ls', 'cat', 'head', 'tail', 'wc', 'stat',
  'echo', 'pwd', 'basename', 'dirname', 'realpath',
  'node', 'npm', 'npx', // 只允许 --version 等只读子命令，在 matchReadonlyWhitelist 中处理
])

/** 只读 git 子命令 */
const READONLY_GIT_SUBS = new Set(['diff', 'status', 'log', 'show', 'branch', 'stash'])

/** 危险 git 子命令 */
const DANGER_GIT_SUBS = new Set([
  'add', 'commit', 'push', 'checkout', 'restore', 'reset', 'clean',
  'mv', 'rm',
])

/** 危险 git stash 操作 */
const DANGER_STASH_ACTIONS = new Set(['drop', 'clear', 'pop'])

/** 危险命令前缀 */
const DANGER_PREFIXES = ['sudo', 'rm -rf', 'rm -r', 'rmdir']

// ── 阶段 → 拦截提示映射 ──

const STAGE_HINTS = {
  '(none)': [
    '没有检测到活跃的 SillySpec 流程。',
    '你需要先启动一个任务流程才能修改源码（调用对应的 sillyspec skills）：',
    '',
    '  BUG修复(skill sillyspec-quick)：sillyspec run quick "任务描述"',
    '  逻辑变更(skill sillyspec-brainstorm)：sillyspec run brainstorm → plan → execute → verify → archive',
    '  全自动模式(skill sillyspec-auto)：    sillyspec run auto "任务描述"',
  ],
  'brainstorm': [
    '当前在 brainstorm（需求分析）阶段，这个阶段只写文档，不写代码。',
    '完成 brainstorm 后，流程会自动推进到 plan → execute。',
    'execute 阶段才允许写代码。',
  ],
  'plan': [
    '当前在 plan（计划制定）阶段，这个阶段只写计划文档和任务蓝图，不写代码。',
    '完成 plan 后，运行 sillyspec run execute 进入执行阶段。',
  ],
  'verify': [
    '当前在 verify（验证）阶段，只做代码审查和测试验证，不修改源码。',
    '如需修改，请先回到 execute 阶段或使用 quick 模式：',
    '  sillyspec run quick "修改描述"',
  ],
  'archive': [
    '当前在 archive（归档）阶段，不修改源码。',
    '如需修改，请开启新变更：sillyspec run quick "修改描述"',
  ],
  'explore': [
    '当前在 explore（探索）阶段，只读不写。',
    '确认方案后使用：sillyspec run brainstorm 或 sillyspec run quick',
  ],
}

// ── 辅助函数 ──

function resolveWorktreeDir(cwd) {
  return path.join(cwd, '.sillyspec', '.runtime', 'worktrees')
}

/**
 * 读取 gate-status.json
 * @param {string} cwd
 * @returns {{ stage: string, changes?: string[], updatedAt?: string } | null}
 */
function readGateStatus(cwd) {
  const p = path.join(cwd, '.sillyspec', '.runtime', 'gate-status.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 从 sillyspec.db 读取 currentStage
 * 优先级：gate-status.json > sillyspec.db
 * @param {string} cwd
 * @returns {string|null} 阶段名，null 表示无法确定
 */
function readCurrentStage(cwd) {
  // 1. gate-status.json（高速缓存，权威来源）
  const gateStatus = readGateStatus(cwd)
  if (gateStatus && gateStatus.stage) return gateStatus.stage

  // 2. 从 sillyspec.db 读取（通过 sqlite3 CLI 同步调用）
  const dbPath = path.join(cwd, '.sillyspec', '.runtime', 'sillyspec.db')
  if (!existsSync(dbPath)) return null
  try {
    const { execSync } = require('child_process')
    const result = execSync(
      `sqlite3 "${dbPath}" "SELECT current_stage FROM changes WHERE status='active' AND current_stage IN ('execute','quick') ORDER BY last_active DESC LIMIT 1"`,
      { encoding: 'utf8', timeout: 2000 }
    ).trim()
    return result || null
  } catch { /* sqlite3 CLI 不可用或查询失败 */ }

  return null
}

/**
 * 检查当前变更是否处于 noWorktree 模式
 * @param {string} cwd
 * @returns {boolean}
 */
function isNoWorktreeMode(cwd) {
  // 1. 检查 gate-status.json
  const gateStatus = readGateStatus(cwd)
  if (gateStatus && gateStatus.noWorktree) return true

  // 2. 从 sillyspec.db 读取
  const dbPath = path.join(cwd, '.sillyspec', '.runtime', 'sillyspec.db')
  if (!existsSync(dbPath)) return false
  try {
    const { execSync } = require('child_process')
    const result = execSync(
      `sqlite3 "${dbPath}" "SELECT no_worktree FROM changes WHERE status='active' AND current_stage IN ('execute','quick') LIMIT 1"`,
      { encoding: 'utf8', timeout: 2000 }
    ).trim()
    return result === '1'
  } catch { /* sqlite3 CLI 不可用或查询失败 */ }

  return false
}

/**
 * 判断路径是否在 worktree 内
 * @param {string} filePath - 绝对路径
 * @returns {boolean}
 */
function isInsideWorktree(filePath) {
  return filePath.includes(WORKTREE_SEGMENT)
}

/**
 * 文件白名单：文档类/配置类始终放行
 * @param {string} filePath - 绝对路径
 * @returns {boolean}
 */
function matchFileWhitelist(filePath) {
  // 路径以 .sillyspec/ 开头
  const parts = filePath.split(path.sep)
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '.sillyspec') return true
  }

  // 路径在 .git/ 下
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === '.git') return true
  }

  // 扩展名
  const ext = path.extname(filePath)
  if (FILE_WHITELIST_EXTS.includes(ext)) return true

  // 文件名
  const base = path.basename(filePath)
  if (FILE_WHITELIST_NAMES.includes(base)) return true

  return false
}

/**
 * 读取 local.yaml 中的扩展白名单配置（如果存在）
 * @param {string} cwd
 * @returns {{ fileWhitelist?: string[], readonlyCommands?: string[] }}
 */
function loadLocalConfig(cwd) {
  const candidates = [
    path.join(cwd, 'local.yaml'),
    path.join(cwd, 'local.yml'),
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try {
      const content = readFileSync(p, 'utf8')
      return parseSimpleYaml(content)
    } catch {
      return {}
    }
  }
  return {}
}

/**
 * 简易 YAML 解析，只处理顶层简单结构
 */
function parseSimpleYaml(content) {
  const result = {}
  let currentKey = null
  let inArray = false

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // 顶层键
    const topLevelMatch = trimmed.match(/^(\S[\S]*)\s*:\s*(.*)$/)
    if (topLevelMatch && !trimmed.startsWith(' ')) {
      const key = topLevelMatch[1]
      const val = topLevelMatch[2].trim()
      currentKey = key

      if (val) {
        // key: value (单行)
        result[key] = val
        inArray = false
      } else {
        // key: (多行值开始)
        result[key] = []
        inArray = true
      }
      continue
    }

    // 数组项
    if (inArray && currentKey && trimmed.startsWith('- ')) {
      const item = trimmed.slice(2).trim()
      if (Array.isArray(result[currentKey])) {
        result[currentKey].push(item)
      }
      continue
    }

    // 非数组行结束数组模式
    if (inArray && !trimmed.startsWith('- ') && !trimmed.startsWith('#')) {
      inArray = false
    }
  }

  return result
}

/**
 * 提取命令中第一个可执行命令名
 * @param {string} command
 * @returns {string}
 */
function extractCommandName(command) {
  const trimmed = command.trim()
  if (!trimmed) return ''
  return trimmed.split(/\s+/)[0]
}

/**
 * 判断单个命令片段是否匹配只读白名单
 * @param {string} cmd - 单个命令片段（不含管道/链式操作符）
 * @param {string[]} extraReadonlyCommands - local.yaml 扩展的只读命令
 * @returns {boolean}
 */
function isSingleCommandReadonly(cmd, extraReadonlyCommands = []) {
  const trimmed = cmd.trim()
  if (!trimmed) return true // 空片段放行

  const parts = trimmed.split(/\s+/)
  const cmdName = parts[0]

  // 纯命令名匹配
  if (READONLY_COMMANDS.has(cmdName)) {
    // node/npm/npx 需要进一步检查子命令
    if (cmdName === 'node' || cmdName === 'npm' || cmdName === 'npx') {
      const rest = parts.slice(1).join(' ')
      return rest.includes('--version') || rest.includes('-v') && parts.length <= 3 || rest === 'run test' || rest.startsWith('test')
    }
    return true
  }

  // local.yaml 扩展
  if (extraReadonlyCommands.includes(cmdName)) return true

  // git 只读子命令
  if (cmdName === 'git') {
    const sub = parts[1] || ''
    if (READONLY_GIT_SUBS.has(sub)) return true
    // git stash list
    if (sub === 'stash' && (parts[2] === 'list' || parts.length === 2)) return true
    // git worktree 管理（list/add/remove）放行
    if (sub === 'worktree') return true
    return false
  }

  // sillyspec worktree 命令
  if (cmdName === 'sillyspec') {
    const sub = parts[1] || ''
    if (sub === 'worktree') return true
    return false
  }

  return false
}

/**
 * 判断单个命令片段是否匹配危险黑名单
 * @param {string} cmd - 单个命令片段
 * @returns {boolean}
 */
function isSingleCommandDangerous(cmd) {
  const trimmed = cmd.trim().toLowerCase()

  for (const prefix of DANGER_PREFIXES) {
    if (trimmed.startsWith(prefix)) return true
  }

  const parts = trimmed.split(/\s+/)
  const cmdName = parts[0]

  if (cmdName === 'git') {
    const sub = parts[1] || ''
    if (DANGER_GIT_SUBS.has(sub)) return true
    // git stash drop/clear/pop
    if (sub === 'stash' && DANGER_STASH_ACTIONS.has(parts[2] || '')) return true
  }

  // rm（不限于 -rf）
  if (cmdName === 'rm') return true

  return false
}

/**
 * 将命令按管道/链式操作符拆分为多个片段
 * @param {string} command
 * @returns {string[]}
 */
function splitCommandParts(command) {
  // 按管道和链式操作符拆分
  return command.split(/(?:\|\|&&|&&|\|)/g).map(s => s.trim()).filter(Boolean)
}

/**
 * 判断命令是否匹配只读白名单（含管道/链式检查）
 * @param {string} command
 * @param {string[]} extraReadonlyCommands
 * @returns {boolean}
 */
function matchReadonlyWhitelist(command, extraReadonlyCommands = []) {
  const parts = splitCommandParts(command)
  return parts.every(p => isSingleCommandReadonly(p, extraReadonlyCommands))
}

/**
 * 判断命令是否匹配危险黑名单（含管道/链式检查）
 * @param {string} command
 * @returns {boolean}
 */
function matchDangerBlacklist(command) {
  const parts = splitCommandParts(command)
  return parts.some(p => isSingleCommandDangerous(p))
}

/**
 * 构建阶段拦截提示
 * @param {string} stage
 * @returns {string}
 */
function buildStageHint(stage) {
  const hint = STAGE_HINTS[stage] || STAGE_HINTS['(none)']
  return hint.join('\n')
}

// ── 公共接口 ──

/**
 * 判断文件写入是否应被拦截
 *
 * 降级策略（无 worktree = 更严格）:
 * - noWorktree 模式下，execute/quick 阶段不允许源码写入（没有隔离环境）
 * - 除非同时设置 SILLYSPEC_DISABLE_HOOKS=1
 *
 * P0 优化：
 * - 使用 readCurrentStage() fallback 读取阶段（gate-status → progress）
 * - 拦截提示按阶段给出具体修复建议
 *
 * @param {string} filePath - 目标文件绝对路径
 * @param {string} cwd - 当前工作目录
 * @returns {{ blocked: boolean, reason?: string }}
 */
export function shouldBlockWrite(filePath, cwd) {
  if (!filePath) return { blocked: true, reason: 'no file path' }

  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd || process.cwd(), filePath)

  // 1. 文件门禁：文档类/配置类始终放行
  if (matchFileWhitelist(absPath)) return { blocked: false }

  // 2. 阶段门禁（使用 fallback 读取）
  const effectiveCwd = cwd || process.cwd()
  const stage = readCurrentStage(effectiveCwd) || '(none)'

  if (!ALLOWED_STAGES.includes(stage)) {
    return {
      blocked: true,
      reason: buildStageHint(stage)
    }
  }

  // 3. 位置门禁
  if (isInsideWorktree(absPath)) return { blocked: false }

  // noWorktree 模式：无隔离环境，禁止源码写入（降级到更严格）
  if (isNoWorktreeMode(effectiveCwd)) {
    return {
      blocked: true,
      reason: [
        '当前处于 --no-worktree 降级模式，不允许源码写入。',
        '如需修改源码，请移除 --no-worktree 标志重新执行。',
        '紧急情况可设置 SILLYSPEC_DISABLE_HOOKS=1 绕过限制。',
      ].join('\n')
    }
  }

  return {
    blocked: true,
    reason: [
      '源码修改只能在 worktree 隔离环境中进行。',
      '',
      '你可能需要：',
      '  1. 确认 worktree 已创建：sillyspec worktree list',
      '  2. 如未创建，先创建：sillyspec worktree create <变更名>',
      '  3. 在 worktree 目录中工作（子代理的 cwd 设为 worktree 路径）',
      '',
      '如果你在 execute 阶段，通常会自动创建 worktree。',
      '检查是否跳过了 "创建 worktree" 步骤。',
    ].join('\n')
  }
}

/**
 * 判断 Bash 命令是否应被拦截
 * @param {string} command - Bash 命令字符串
 * @param {string} cwd - 当前工作目录
 * @returns {{ blocked: boolean, reason?: string }}
 */
export function shouldBlockBash(command, cwd) {
  if (!command || !command.trim()) return { blocked: false }

  const effectiveCwd = cwd || process.cwd()

  // cwd 在 worktree 内 → 全部放行
  if (isInsideWorktree(effectiveCwd)) return { blocked: false }

  // 阶段门禁（使用 fallback 读取）
  const stage = readCurrentStage(effectiveCwd) || '(none)'
  const stageOk = ALLOWED_STAGES.includes(stage)

  if (!stageOk) {
    // 非 execute/quick 阶段，只允许只读白名单
    const localConfig = loadLocalConfig(effectiveCwd)
    const extraReadonly = localConfig.worktreeHook?.readonlyCommands || localConfig['worktree-hook']?.readonlyCommands || []
    if (matchReadonlyWhitelist(command, extraReadonly)) return { blocked: false }
    return {
      blocked: true,
      reason: buildStageHint(stage)
    }
  }

  // execute/quick 阶段 + 主工作区
  const localConfig = loadLocalConfig(effectiveCwd)
  const extraReadonly = localConfig.worktreeHook?.readonlyCommands || localConfig['worktree-hook']?.readonlyCommands || []

  // 危险黑名单
  if (matchDangerBlacklist(command)) {
    return { blocked: true, reason: `dangerous command blocked: ${command.trim()}` }
  }

  // 只读白名单放行
  if (matchReadonlyWhitelist(command, extraReadonly)) return { blocked: false }

  // 不确定 → 放行
  return { blocked: false }
}

/**
 * 判断工具调用是否应被拦截
 * @param {{
 *   tool: 'Write' | 'Edit' | 'MultiEdit' | 'Bash',
 *   filePath?: string,
 *   filePaths?: string[],
 *   command?: string,
 *   cwd?: string
 * }} opts
 * @param {{ cwd?: string }} ctx
 * @returns {{ blocked: boolean, reason?: string }}
 */
export function shouldBlock(opts, ctx = {}) {
  // 逃生开关
  if (process.env.SILLYSPEC_DISABLE_HOOKS === '1') return { blocked: false }

  const cwd = opts.cwd || ctx.cwd || process.cwd()

  switch (opts.tool) {
    case 'Write':
    case 'Edit': {
      const fp = opts.filePath
      if (!fp) return { blocked: true, reason: 'no file path' }
      const absPath = path.isAbsolute(fp) ? fp : path.resolve(cwd, fp)
      return shouldBlockWrite(absPath, cwd)
    }
    case 'MultiEdit': {
      const filePaths = opts.filePaths
      if (!filePaths || filePaths.length === 0) return { blocked: true, reason: 'no file paths' }
      for (const fp of filePaths) {
        const absPath = path.isAbsolute(fp) ? fp : path.resolve(cwd, fp)
        const result = shouldBlockWrite(absPath, cwd)
        if (result.blocked) return result
      }
      return { blocked: false }
    }
    case 'Bash': {
      return shouldBlockBash(opts.command || '', cwd)
    }
    default:
      return { blocked: false }
  }
}
