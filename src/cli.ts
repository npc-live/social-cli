#!/usr/bin/env node
/**
 * CLI entry — supports both YAML adapters and TypeScript adapters.
 *
 * Usage:
 *   tsx src/cli.ts <platform> <command> [args...]
 *
 * Adapter resolution order:
 *   1. adapters/<platform>.yaml   ← YAML-first
 *   2. src/adapters/<platform>.ts ← TypeScript fallback
 *
 * Examples:
 *   tsx src/cli.ts xhs search 法律ai
 *   tsx src/cli.ts xhs like "https://..."
 *   tsx src/cli.ts xhs comment "https://..." "太棒了！"
 *   tsx src/cli.ts xhs post --title "标题" --content "内容"
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { runYamlCommand } from './runner/yaml-runner.js';
import { run } from './browser/runner.js';
import { adapters } from './adapters/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const [, , platform, command, ...rest] = process.argv;

if (!platform || !command) {
  printHelp();
  process.exit(1);
}

// ── Resolve adapter ────────────────────────────────────────────────────────

const yamlPath = path.join(ROOT, 'adapters', `${platform}.yaml`);
const hasYaml  = fs.existsSync(yamlPath);
const tsAdapter = adapters[platform];

if (!hasYaml && !tsAdapter) {
  console.error(`❌ Unknown platform "${platform}"`);
  console.error(`   YAML adapters: ${listYamlAdapters().join(', ') || '(none)'}`);
  console.error(`   TS adapters:   ${Object.keys(adapters).join(', ')}`);
  process.exit(1);
}

// ── Parse args ─────────────────────────────────────────────────────────────
// Support both positional args and --key value flags

const args = parseArgs(rest);

// ── Run ───────────────────────────────────────────────────────────────────

if (hasYaml) {
  // YAML adapter: pass positional args in order
  runYamlCommand(yamlPath, command, args.positional).catch(err => {
    console.error('❌', err.message);
    process.exit(1);
  });
} else {
  // TypeScript adapter: pass flags as array (legacy)
  run(tsAdapter!, { command, args: rest }).catch(err => {
    console.error('❌', err.message);
    process.exit(1);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      flags[argv[i].slice(2)] = argv[++i] ?? '';
    } else {
      positional.push(argv[i]);
    }
  }
  return { positional, flags };
}

function listYamlAdapters(): string[] {
  const dir = path.join(ROOT, 'adapters');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.yaml'))
    .map(f => f.replace('.yaml', ''));
}

function printHelp() {
  const yaml = listYamlAdapters();
  const ts   = Object.keys(adapters);
  console.log('用法: tsx src/cli.ts <platform> <command> [args...]');
  console.log('');
  if (yaml.length) {
    console.log('YAML 平台 (推荐):');
    yaml.forEach(p => console.log(`  ${p}`));
  }
  if (ts.length) {
    console.log('TS 平台:');
    ts.forEach(p => console.log(`  ${p}`));
  }
  console.log('');
  console.log('示例:');
  console.log('  tsx src/cli.ts xhs search 法律ai');
  console.log('  tsx src/cli.ts xhs like "https://www.xiaohongshu.com/explore/..."');
  console.log('  tsx src/cli.ts xhs comment "https://..." "太棒了！"');
}
