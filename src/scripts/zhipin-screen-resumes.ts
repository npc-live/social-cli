/**
 * Boss直聘简历 AI 筛选脚本
 *
 * 读取 zhipin-download-resumes.ts 生成的截图目录，
 * 用 Claude Vision 逐个分析简历，按招聘标准打分并输出结果。
 *
 * 用法：
 *   npx tsx src/scripts/zhipin-screen-resumes.ts <resumeDir> "<标准描述>"
 *   npm run zhipin:screen -- ./resumes "要求3年以上Python经验，熟悉大模型训练，本科及以上学历"
 *
 * 环境变量：
 *   ANTHROPIC_API_KEY  Claude API Key（必填）
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

// ── 参数解析 ─────────────────────────────────────────────────────────────────

const RESUME_DIR  = process.argv[2];
const CRITERIA    = process.argv[3];

if (!RESUME_DIR || !CRITERIA) {
  console.error('用法: npx tsx src/scripts/zhipin-screen-resumes.ts <resumeDir> "<招聘标准>"');
  console.error('示例: npm run zhipin:screen -- ./resumes "要求3年以上Python经验，熟悉大模型训练"');
  process.exit(1);
}

// 支持 ZenMux 代理：优先用 ANTHROPIC_AUTH_TOKEN，其次 ANTHROPIC_API_KEY
const apiKey  = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? 'placeholder';
const baseURL = process.env.ANTHROPIC_BASE_URL;   // ZenMux 等代理端点

// ── 类型 ─────────────────────────────────────────────────────────────────────

interface CandidateMeta {
  name: string;
  job:  string;
  uid:  string;
  screenshots: string[];
  error?: string;
}

interface ScreenResult {
  name:       string;
  job:        string;
  uid:        string;
  pass:       boolean;
  score:      number;   // 0-10
  summary:    string;   // 一句话简历摘要
  pros:       string[]; // 符合标准的亮点
  cons:       string[]; // 不符合/欠缺的地方
  rawReason:  string;   // Claude 完整理由
}

// ── 读取简历目录 ─────────────────────────────────────────────────────────────

function loadCandidates(dir: string): CandidateMeta[] {
  const summaryPath = join(dir, '_summary.json');
  if (!statSync(summaryPath, { throwIfNoEntry: false })) {
    // 没有 _summary.json，自动扫描子目录
    const subdirs = readdirSync(dir).filter(d => statSync(join(dir, d)).isDirectory());
    return subdirs.map(d => {
      const pngs = readdirSync(join(dir, d)).filter(f => f.endsWith('.png')).map(f => join(dir, d, f)).sort();
      const namePart = d.replace(/^\d+_/, '');
      return { name: namePart, job: '', uid: d, screenshots: pngs };
    });
  }
  const summary = JSON.parse(readFileSync(summaryPath, 'utf-8')) as { candidates: CandidateMeta[] };
  return summary.candidates.filter(c => c.screenshots.length > 0);
}

// ── Claude Vision 分析 ───────────────────────────────────────────────────────

const clientOpts: ConstructorParameters<typeof Anthropic>[0] = { apiKey };
if (baseURL) clientOpts.baseURL = baseURL;
const client = new Anthropic(clientOpts);

async function analyzeResume(candidate: CandidateMeta, criteria: string): Promise<ScreenResult> {
  // 读取所有截图，转 base64
  const imageBlocks: Anthropic.ImageBlockParam[] = candidate.screenshots.map(p => ({
    type: 'image' as const,
    source: {
      type:       'base64' as const,
      media_type: 'image/png' as const,
      data:       readFileSync(p).toString('base64'),
    },
  }));

  const prompt = `你是一位专业的招聘顾问。请根据以下招聘标准，评估这份简历是否符合要求。

招聘标准：
${criteria}

请严格按照以下 JSON 格式输出，不要有任何其他文字：
{
  "pass": true或false,
  "score": 0到10的整数（10分完全符合，0分完全不符合），
  "summary": "一句话概括候选人背景（20字以内）",
  "pros": ["符合标准的亮点1", "亮点2"],
  "cons": ["不符合或欠缺的地方1", "欠缺2"],
  "reason": "详细说明通过或不通过的原因（100字以内）"
}`;

  const model = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? 'claude-sonnet-4-6';
  const msg = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{
      role:    'user',
      content: [...imageBlocks, { type: 'text', text: prompt }],
    }],
  });

  const raw = (msg.content[0] as Anthropic.TextBlock).text.trim();

  // 提取 JSON（防止模型在 JSON 外输出多余文字）
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`模型未返回 JSON: ${raw.slice(0, 100)}`);

  const parsed = JSON.parse(jsonMatch[0]) as {
    pass: boolean; score: number; summary: string;
    pros: string[]; cons: string[]; reason: string;
  };

  return {
    name:      candidate.name,
    job:       candidate.job,
    uid:       candidate.uid,
    pass:      parsed.pass,
    score:     parsed.score,
    summary:   parsed.summary,
    pros:      parsed.pros ?? [],
    cons:      parsed.cons ?? [],
    rawReason: parsed.reason,
  };
}

// ── 输出格式 ─────────────────────────────────────────────────────────────────

function renderResult(r: ScreenResult, index: number, total: number): void {
  const icon   = r.pass ? '✅' : '❌';
  const bar    = '█'.repeat(r.score) + '░'.repeat(10 - r.score);
  console.log(`\n${icon} [${index}/${total}] ${r.name}  ${r.job}`);
  console.log(`   评分: ${bar} ${r.score}/10`);
  console.log(`   摘要: ${r.summary}`);
  if (r.pros.length)  console.log(`   亮点: ${r.pros.join(' · ')}`);
  if (r.cons.length)  console.log(`   欠缺: ${r.cons.join(' · ')}`);
  console.log(`   理由: ${r.rawReason}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const dir        = resolve(RESUME_DIR);
const candidates = loadCandidates(dir);

console.log(`\n🔍 招聘标准：${CRITERIA}`);
console.log(`👥 候选人数：${candidates.length}`);
console.log(`${'─'.repeat(60)}`);

const results: ScreenResult[] = [];
const errors:  { name: string; error: string }[] = [];

for (let i = 0; i < candidates.length; i++) {
  const c = candidates[i];
  process.stdout.write(`\n⏳ 分析 [${i + 1}/${candidates.length}] ${c.name}...`);
  try {
    const result = await analyzeResume(c, CRITERIA);
    results.push(result);
    renderResult(result, i + 1, candidates.length);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(` ❌ ${msg}\n`);
    errors.push({ name: c.name, error: msg });
  }
}

// ── 汇总统计 ─────────────────────────────────────────────────────────────────

const passed = results.filter(r => r.pass);
const failed = results.filter(r => !r.pass);
const avgScore = results.length ? (results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(1) : '0';

console.log(`\n${'═'.repeat(60)}`);
console.log(`📊 筛选结果汇总`);
console.log(`${'─'.repeat(60)}`);
console.log(`总候选人：${candidates.length}  |  通过：${passed.length}  |  未通过：${failed.length}  |  平均分：${avgScore}`);

if (passed.length) {
  console.log(`\n✅ 通过名单（${passed.length} 人）：`);
  passed
    .sort((a, b) => b.score - a.score)
    .forEach(r => console.log(`   ${r.score}/10  ${r.name}  — ${r.summary}`));
}

if (failed.length) {
  console.log(`\n❌ 未通过（${failed.length} 人）：`);
  failed
    .sort((a, b) => b.score - a.score)
    .forEach(r => console.log(`   ${r.score}/10  ${r.name}  — ${r.cons[0] ?? r.rawReason.slice(0, 30)}`));
}

// ── 保存结果 ─────────────────────────────────────────────────────────────────

const outputPath = join(dir, '_screen_result.json');
writeFileSync(outputPath, JSON.stringify({
  criteria:  CRITERIA,
  total:     candidates.length,
  passed:    passed.length,
  failed:    failed.length,
  avgScore:  parseFloat(avgScore),
  results:   results.sort((a, b) => b.score - a.score),
  errors,
}, null, 2), 'utf-8');

console.log(`\n📄 详细结果已保存：${outputPath}`);
