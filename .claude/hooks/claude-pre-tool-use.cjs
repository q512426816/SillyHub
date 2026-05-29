#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook 入口
 *
 * 从 stdin 读取 JSON，调用 worktree-guard 判断是否拦截。
 *
 * Claude Code hooks.json 配置：
 * {
 *   "hooks": {
 *     "PreToolUse": [
 *       {
 *         "matcher": "Edit|Write|MultiEdit|Bash",
 *         "hooks": [
 *           {
 *             "type": "command",
 *             "command": "node /path/to/sillyspec/src/hooks/claude-pre-tool-use.cjs"
 *           }
 *         ]
 *       }
 *     ]
 *   }
 * }
 */

'use strict'

const path = require('path')
const fs = require('fs')

// 动态 import ESM 模块
async function main() {
  // Claude Code hook 通过 stdin 传入 JSON
  let input = ''
  try {
    input = await readStdin()
  } catch {
    // 无法读取 stdin → 放行（安全优先于阻断）
    process.exit(0)
  }

  let parsed
  try {
    parsed = JSON.parse(input)
  } catch {
    // 非法 JSON → 放行
    process.exit(0)
  }

  // 解析 Claude Code hook 输入格式
  // 格式：{ tool_name: string, tool_input: { ... } }
  const toolName = parsed.tool_name || parsed.tool || ''
  const toolInput = parsed.tool_input || {}

  // 转换为 shouldBlock 的输入格式
  const toolMap = {
    'Write': 'Write',
    'Edit': 'Edit',
    'MultiEdit': 'MultiEdit',
    'Bash': 'Bash',
  }

  const mappedTool = toolMap[toolName]
  if (!mappedTool) {
    // 不在拦截范围内的工具 → 放行
    process.exit(0)
  }

  // 构造 opts
  const opts = { tool: mappedTool }
  if (mappedTool === 'Bash') {
    opts.command = toolInput.command || ''
  } else {
    // Write/Edit/MultiEdit
    const fp = toolInput.file_path || toolInput.filePath
    if (fp) opts.filePath = fp
    // MultiEdit 可能有多个文件
    if (mappedTool === 'MultiEdit') {
      const fps = toolInput.edits
        ? toolInput.edits.map(e => e.file_path || e.filePath).filter(Boolean)
        : []
      if (fps.length > 0) opts.filePaths = fps
    }
  }

  // 加载 worktree-guard（ESM）
  let shouldBlock
  try {
    const mod = await import('./worktree-guard.js')
    shouldBlock = mod.shouldBlock
  } catch (e) {
    // 模块加载失败 → 放行（不因为 hook 出错阻断工作流）
    // eslint-disable-next-line no-console
    console.error(`[sillyspec-hook] 模块加载失败: ${e.message}`)
    process.exit(0)
  }

  const result = shouldBlock(opts)

  if (result.blocked) {
    // 输出错误信息（Claude Code 会显示给 agent）
    // eslint-disable-next-line no-console
    console.error(`[sillyspec] ❌ ${result.reason || 'blocked by worktree guard'}`)
    process.exit(2) // exit code 2 = 阻止工具执行
  }

  // 放行
  process.exit(0)
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => chunks.push(chunk))
    process.stdin.on('end', () => resolve(chunks.join('')))
    process.stdin.on('error', reject)
    // 超时保护（3秒）
    setTimeout(() => {
      process.stdin.destroy()
      resolve('')
    }, 3000)
  })
}

main().catch(() => process.exit(0))
