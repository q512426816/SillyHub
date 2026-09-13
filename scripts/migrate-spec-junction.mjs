#!/usr/bin/env node
/**
 * migrate-spec-junction.mjs — daemon 规范目录 junction 迁移官方脚本（三护栏）
 *
 * 来源坑：docs/sillyspec/platform-spec-junction-migration-split.md（2026-09-09 实证）：
 * 迁移快照落后进行中写入 30 分钟 → 变更产物劈在两个目录；备份落在 specs/ 与
 * spec-backups/ 两处且内容不一致，极易拿错。本脚本把三条改进建议机制化：
 *   ① 先全量快照再切 junction（快照的是切换瞬间的真实活目录，不是历史副本）；
 *   ② 切换前静默窗口检查（.runtime 最近 5 秒有写入 → 拒绝，提示稍后重试）；
 *   ③ 备份位置唯一：~/.sillyhub/daemon/spec-backups/<wsId>-prejunction-<ts>/。
 *
 * 用法：
 *   node scripts/migrate-spec-junction.mjs <workspaceId> <repoSillySpecAbsDir>          # dry-run 计划
 *   node scripts/migrate-spec-junction.mjs <workspaceId> <repoSillySpecAbsDir> --apply  # 执行
 *
 * 行为：
 *   1. 校验：workspaceId 形如 UUID；repo .sillyspec 目录存在；daemon specs/<wsId> 存在且
 *      当前不是 junction（已 junction 则幂等退出）。
 *   2. 静默检查：活目录 .runtime 下任意文件 mtime 距今 <5s → 拒绝执行（CLI/daemon 在写）。
 *   3. 快照：活目录整树复制到 spec-backups/<wsId>-prejunction-<YYYYMMDD-HHMMSS>/。
 *   4. 切换：specs/<wsId> 改名 <wsId>.switching-<ts>（临时持有，非备份）→ 在原位创建
 *      junction 指向 repo .sillyspec（Windows junction / POSIX symlink 自动选择）。
 *   5. 验证：经 junction 读写探针文件成功 → 删临时持有目录（备份已在唯一位置）；
 *      失败 → 自动回滚（删 junction、持有目录改名回去），退出码 1。
 *
 * 注意：junction 目标（repo .sillyspec）若已有旧内容，与快照的新内容可能分裂——本脚本
 * 不自动合并（风险大于收益），切换后请人工比对 spec-backups 快照与 repo 侧差异后搬运。
 * 跨平台：Windows 用 junction type，POSIX 用 dir symlink。
 */
import { existsSync, statSync, lstatSync, readdirSync, renameSync, symlinkSync, rmSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const positional = args.filter(a => !a.startsWith('--'))
if (positional.length !== 2) {
  console.error('用法: node scripts/migrate-spec-junction.mjs <workspaceId> <repoSillySpecAbsDir> [--apply]')
  process.exit(2)
}
const [wsId, repoSpecDir] = positional
const DAEMON_HOME = join(homedir(), '.sillyhub', 'daemon')
const SPECS_DIR = join(DAEMON_HOME, 'specs')
const BACKUPS_DIR = join(DAEMON_HOME, 'spec-backups')
const liveDir = join(SPECS_DIR, wsId)

// ── 1. 校验 ──
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wsId)) {
  console.error(`❌ workspaceId 形态非 UUID: ${wsId}（非 UUID 目录名不得进 daemon specs/——心跳 UUID 守卫会 422）`)
  process.exit(2)
}
if (!existsSync(repoSpecDir) || !statSync(repoSpecDir).isDirectory()) {
  console.error(`❌ 目标目录不存在或非目录: ${repoSpecDir}`)
  process.exit(2)
}
if (!existsSync(liveDir)) {
  console.error(`❌ daemon specs 下无该工作区目录: ${liveDir}`)
  process.exit(1)
}
// 必须真 lstat：statSync 会跟随 junction/symlink 返回目标目录的 stat
// （isSymbolicLink 恒 false）——幂等护栏对已迁移目录永不触发，--apply 重跑
// 会穿透护栏把整个 repo .sillyspec 经 junction 复制一遍快照（2026-09-13 审查）。
const liveStat = lstatSync(liveDir)
if (liveStat.isSymbolicLink()) {
  console.log(`ℹ️ ${liveDir} 已是 junction/symlink——幂等退出，无需迁移`)
  process.exit(0)
}

// ── 2. 静默窗口检查（护栏②）──
const QUIESCE_MS = 5_000
function latestWriteMs(dir, root = true) {
  let latest = 0
  let names
  try { names = readdirSync(dir) } catch { return latest }
  for (const n of names) {
    const p = join(dir, n)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) latest = Math.max(latest, latestWriteMs(p, false))
    else latest = Math.max(latest, st.mtimeMs)
  }
  return latest
}
const latest = latestWriteMs(join(liveDir, '.runtime'))
const quietMs = Date.now() - latest
if (apply && latest > 0 && quietMs < QUIESCE_MS) {
  console.error(`❌ 静默检查未过：.runtime ${Math.round(quietMs / 1000)}s 前仍有写入（CLI/daemon 活跃）——等写入停止后重试`)
  console.error(`   （坑 platform-spec-junction-migration-split 护栏②：迁移期写入 = 产物分裂）`)
  process.exit(1)
}

// ── 计划输出 / dry-run ──
const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
const backupDir = join(BACKUPS_DIR, `${wsId}-prejunction-${ts}`)
const holdDir = join(SPECS_DIR, `${wsId}.switching-${ts}`)
console.log(`迁移计划（${apply ? ' APPLY' : 'DRY-RUN'}）：`)
console.log(`  活目录     ${liveDir}`)
console.log(`  junction → ${repoSpecDir}`)
console.log(`  快照备份   ${backupDir}   （护栏①③：切换瞬间全量快照，位置唯一）`)
console.log(`  临时持有   ${holdDir}   （验证通过后删除，不是备份）`)
console.log(`  静默窗口   ${latest === 0 ? '（无 .runtime，视为静默）' : `最近写入 ${Math.round(quietMs / 1000)}s 前（阈值 ${QUIESCE_MS / 1000}s）`}`)
if (!apply) {
  console.log('\ndry-run 不落任何改动；确认后加 --apply 执行')
  process.exit(0)
}

// ── 3. 全量快照（护栏①）──
function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true })
  for (const n of readdirSync(src)) {
    const s = join(src, n), d = join(dst, n)
    const st = statSync(s)
    if (st.isDirectory()) copyTree(s, d)
    else copyFileSync(s, d)
  }
}
try {
  copyTree(liveDir, backupDir)
  console.log(`✅ 快照完成（唯一备份位置）: ${backupDir}`)
} catch (e) {
  console.error(`❌ 快照失败，中止（未做任何切换）: ${e.message}`)
  process.exit(1)
}

// ── 4. 切换 ──
try {
  renameSync(liveDir, holdDir)
  try {
    symlinkSync(repoSpecDir, liveDir, 'junction')
  } catch {
    symlinkSync(repoSpecDir, liveDir, 'dir') // POSIX
  }
} catch (e) {
  // 回滚：持有目录改名回去——失败必须如实报（原版 catch{} 吞错后仍打印
  // 「已回滚」，活目录实际缺失却被当成功，只剩快照可救）。
  let restored = false
  if (existsSync(holdDir) && !existsSync(liveDir)) {
    try { renameSync(holdDir, liveDir); restored = true } catch (e2) {
      console.error(`❌ 回滚失败：活目录未还原。数据保留在 ${holdDir}，快照在 ${backupDir}，请人工恢复: ${e2.message}`)
    }
  }
  if (restored) {
    console.error(`❌ junction 创建失败，已回滚（活目录已还原）: ${e.message}`)
  } else if (existsSync(liveDir)) {
    console.error(`❌ junction 创建失败（改名未发生，活目录仍在原位）: ${e.message}`)
  }
  process.exit(1)
}

// ── 5. 验证 + 收尾 ──
const probe = join(liveDir, '.runtime', '.junction-probe-' + ts)
try {
  mkdirSync(join(liveDir, '.runtime'), { recursive: true })
  writeFileSync(probe, 'junction-verify\n')
  if (readFileSync(probe, 'utf8') !== 'junction-verify\n') throw new Error('读回不一致')
  unlinkSync(probe)
  rmSync(holdDir, { recursive: true, force: true })
  console.log(`✅ junction 验证通过（读写探针），临时持有目录已清理`)
  console.log(`ℹ️ 后续：比对快照 ${backupDir} 与 repo 侧内容——快照里更新的人工搬运进 repo（本脚本不自动合并）`)
} catch (e) {
  // 验证失败回滚：删 junction、持有目录还原——每步失败如实报，活目录未还原
  // 时不得仍报「已回滚」。
  try { rmSync(liveDir, { recursive: true, force: true }) } catch (e2) {
    console.error(`⚠️ junction 删除失败（${liveDir} 仍在）: ${e2.message}`)
  }
  try {
    renameSync(holdDir, liveDir)
    console.error(`❌ junction 验证失败，已回滚（活目录已还原，快照保留在 ${backupDir}）: ${e.message}`)
  } catch (e2) {
    console.error(`❌ junction 验证失败且回滚未完成：活目录缺失，数据在 ${holdDir}，快照在 ${backupDir}，请人工恢复: ${e2.message}`)
  }
  process.exit(1)
}
