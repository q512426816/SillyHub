// tests/task-runner-skill-detect.test.ts
// task-08（NFR-01 / D-001）：claude 调 skill 兜底检测单测。
// 覆盖 detectSkillInvoked 纯函数：明确失败标记 → false；skill 痕迹 → true；
// 灰区 → true（不误杀）；非 stage lease → true（零回归）。
//
// @module task-runner-skill-detect.test

import { describe, it, expect } from 'vitest';
import { detectSkillInvoked, buildSkillPrompt } from '../src/task-runner.js';

describe('task-08 detectSkillInvoked', () => {
  it('非 stage lease（stageMeta 空）→ true 零回归', () => {
    expect(detectSkillInvoked('任意输出')).toBe(true);
    expect(detectSkillInvoked('output', undefined)).toBe(true);
  });

  it('stageMeta 无 skill_name → true 不检测', () => {
    expect(detectSkillInvoked('output', { stage: 'verify' })).toBe(true);
  });

  it('输出含 "skill not found" → false', () => {
    expect(
      detectSkillInvoked('Error: skill not found', {
        skill_name: 'sillyspec-verify',
        stage: 'verify',
      }),
    ).toBe(false);
  });

  it('输出含 "No skill named" → false', () => {
    expect(
      detectSkillInvoked('No skill named sillyspec-verify available', {
        skill_name: 'sillyspec-verify',
      }),
    ).toBe(false);
  });

  it('输出含 "unknown skill" → false', () => {
    expect(
      detectSkillInvoked('unknown skill: sillyspec-verify', {
        skill_name: 'sillyspec-verify',
      }),
    ).toBe(false);
  });

  it('输出含 skill 调用痕迹 /<skill> → true', () => {
    expect(
      detectSkillInvoked('Running /sillyspec-verify --change chg-1', {
        skill_name: 'sillyspec-verify',
      }),
    ).toBe(true);
  });

  it('输出含 skill 名字符串 → true', () => {
    expect(
      detectSkillInvoked('sillyspec-verify completed checks', {
        skill_name: 'sillyspec-verify',
      }),
    ).toBe(true);
  });

  it('灰区（无失败标记无 skill 痕迹）→ true 不误杀', () => {
    expect(
      detectSkillInvoked('Task completed normally', {
        skill_name: 'sillyspec-verify',
      }),
    ).toBe(true);
  });
});

describe('task-08 buildSkillPrompt', () => {
  it('完整 stageMeta → /<skill> --change X --stage Y', () => {
    const p = buildSkillPrompt({
      skill_name: 'sillyspec-verify',
      change_id: 'chg-1',
      stage: 'verify',
    });
    expect(p).toBe('/sillyspec-verify --change chg-1 --stage verify');
  });

  it('无 skill_name → 空串', () => {
    expect(buildSkillPrompt({ stage: 'verify' })).toBe('');
    expect(buildSkillPrompt(undefined)).toBe('');
  });
});
