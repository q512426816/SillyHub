// verify 阶段 Runtime Evidence：daemon 双落盘真模块真 CLI spawn（非 mock）。
// 用真实 sillyspec 安装（SILLYSPEC_BIN）在临时目录落盘，验证两类产物真实生成。
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runLinkedReposSync } from '../dist/linked-repos-sync.js';

const wsRoot = mkdtempSync(join(tmpdir(), 'lr-ws-'));
const specsDir = mkdtempSync(join(tmpdir(), 'lr-specs-'));
// register-repo 校验路径须是 git 仓——临时目录初始化为 git 仓。
execSync('git init -q', { cwd: specsDir });

try {
  const out = await runLinkedReposSync(
    {
      workspace_id: 'e2e-ws',
      root_path: wsRoot,
      repos: [
        {
          name: 'e2e-specs',
          rel_path: specsDir, // 临时场景用绝对可解析路径（resolve 相对 cwd=wsRoot 亦可，这里直接给 specs 目录名）
          repo_url: null,
          abs_path: specsDir,
        },
      ],
    },
    {
      resolveBin: () => process.env.SILLYSPEC_BIN ?? null,
      report: async (results) => {
        console.log('report callback results:', JSON.stringify(results));
      },
    },
  );
  console.log('sync results:', JSON.stringify(out.results));

  // 产物 1：projects/e2e-specs.yaml（workspace add 生成）
  const projYaml = join(wsRoot, '.sillyspec', 'projects', 'e2e-specs.yaml');
  const yamlExists = existsSync(projYaml);
  console.log('projects yaml exists:', yamlExists);
  if (yamlExists) console.log('projects yaml content:', readFileSync(projYaml, 'utf8').trim());

  // 产物 2：local.yaml repos: 段（register-repo 生成）
  const localYaml = join(wsRoot, '.sillyspec', 'local.yaml');
  const localExists = existsSync(localYaml);
  console.log('local.yaml exists:', localExists);
  if (localExists) {
    const text = readFileSync(localYaml, 'utf8');
    console.log('local.yaml has repos e2e-specs:', /e2e-specs\s*:/.test(text));
    console.log('local.yaml repos section:', /repos:/.test(text) ? text.split('\n').filter((l) => l.includes('e2e-specs') || l.trim() === 'repos:').join(' | ') : '(no repos)');
  }

  const allOk =
    out.results.every((r) => r.status === 'ok') && yamlExists && localExists;
  console.log('RESULT:', allOk ? 'ALL PASS' : 'FAILED');
  process.exitCode = allOk ? 0 : 1;
} finally {
  rmSync(wsRoot, { recursive: true, force: true });
  rmSync(specsDir, { recursive: true, force: true });
}
