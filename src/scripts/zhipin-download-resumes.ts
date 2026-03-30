/**
 * Boss直聘简历批量下载脚本
 *
 * 机制说明：
 * - Boss直聘简历用 WebAssembly 解密 + Canvas 渲染，无法提取 DOM 文字
 * - 本脚本通过 CDP Page.captureScreenshot + clip 截取弹窗区域
 * - 每份简历滚动截多张图，保存为 PNG 序列
 *
 * 用法：
 *   npx tsx src/scripts/zhipin-download-resumes.ts [outputDir]
 *   npm run zhipin:resumes [-- ./my-resumes]
 */
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { connectTab, sleep, CDPClient } from '../browser/cdp.js';

const OUTPUT_DIR = resolve(process.argv[2] ?? './resumes');

interface Candidate {
  index: number;
  name: string;
  job: string;
  uid:  string;
  dataId: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function scrollLoadAll(client: CDPClient): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await client.eval(`(function(){ var l=document.querySelector(".user-list"); if(l) l.scrollTop=999999; })()`);
    await sleep(1200);
  }
}

async function getCandidates(client: CDPClient): Promise<Candidate[]> {
  const json = await client.eval<string>(`
    (function(){
      var items = document.querySelectorAll(".geek-item");
      return JSON.stringify(Array.from(items).map(function(item, i){
        var name   = item.querySelector(".geek-name");
        var job    = item.querySelector(".source-job");
        var dataId = item.getAttribute("data-id") || "";
        return { index: i, name: name?name.textContent.trim():"", job: job?job.textContent.trim():"", uid: dataId.split("-")[0], dataId: dataId };
      }));
    })()
  `);
  return JSON.parse(json ?? '[]') as Candidate[];
}

/** 截取弹窗内简历区域，滚动分段截图，返回保存的文件路径列表 */
async function screenshotResume(client: CDPClient, dir: string, prefix: string): Promise<string[]> {
  const paths: string[] = [];

  // 获取弹窗和滚动容器信息
  const info = await client.eval<string>(`
    (function(){
      var dialog = document.querySelector(".dialog-wrap.active");
      if(!dialog) return JSON.stringify(null);
      var rect = dialog.getBoundingClientRect();
      var scrollEl = dialog.querySelector(".resume-detail");
      return JSON.stringify({
        dx: rect.x, dy: rect.y, dw: rect.width, dh: rect.height,
        scrollHeight: scrollEl ? scrollEl.scrollHeight : rect.height,
        scrollTop:    scrollEl ? scrollEl.scrollTop    : 0
      });
    })()
  `);

  const d = JSON.parse(info ?? 'null') as { dx: number; dy: number; dw: number; dh: number; scrollHeight: number; scrollTop: number } | null;
  if (!d) {
    // Fallback: full page screenshot
    const ss = await client.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const p = resolve(dir, `${prefix}_01.png`);
    writeFileSync(p, Buffer.from(ss.data, 'base64'));
    return [p];
  }

  // 先滚回顶部
  await client.eval(`(function(){ var el=document.querySelector(".dialog-wrap.active .resume-detail"); if(el) el.scrollTop=0; })()`);
  await sleep(600);

  const viewH  = d.dh;                   // 可视高度
  const totalH = d.scrollHeight;         // 总高度
  const steps  = Math.ceil(totalH / viewH);

  for (let i = 0; i < steps; i++) {
    // 截弹窗区域（clip 到对话框 bounds）
    const dpr = await client.eval<number>('window.devicePixelRatio || 1');
    const ss = await client.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      clip: {
        x:      d.dx,
        y:      d.dy,
        width:  d.dw,
        height: d.dh,
        scale:  dpr,
      },
    });
    const p = resolve(dir, `${prefix}_${String(i + 1).padStart(2, '0')}.png`);
    writeFileSync(p, Buffer.from(ss.data, 'base64'));
    paths.push(p);

    // 滚动到下一段
    if (i < steps - 1) {
      await client.eval(`
        (function(){
          var el = document.querySelector(".dialog-wrap.active .resume-detail");
          if(el) el.scrollTop = ${(i + 1) * viewH};
        })()
      `);
      await sleep(800); // 等 Canvas 重绘
    }
  }

  return paths;
}

/** 关闭简历弹窗 */
async function closeDialog(client: CDPClient): Promise<void> {
  await client.eval(`
    (function(){
      var btn = document.querySelector(".boss-popup__close, .boss-dialog__close, [class*=dialog__close], [class*=popup__close]");
      if(btn) { btn.click(); return; }
      document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", keyCode:27, bubbles:true}));
    })()
  `);
  await sleep(600);
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log(`\n📁 输出目录: ${OUTPUT_DIR}`);
mkdirSync(OUTPUT_DIR, { recursive: true });

const chatClient = await connectTab(9222, 0);
await chatClient.navigate('https://www.zhipin.com/web/chat/index', 4500);

console.log('\n⏳ 加载候选人列表...');
await scrollLoadAll(chatClient);

const candidates = await getCandidates(chatClient);
console.log(`✅ 找到 ${candidates.length} 位候选人\n`);

const summary: { name: string; job: string; uid: string; screenshots: string[]; error?: string }[] = [];

for (const c of candidates) {
  const label = `[${c.index + 1}/${candidates.length}] ${c.name} (${c.job})`;
  console.log(`📄 ${label}`);

  const dir = resolve(OUTPUT_DIR, `${String(c.index + 1).padStart(3, '0')}_${c.name}`);
  mkdirSync(dir, { recursive: true });

  try {
    // 点击候选人
    await chatClient.eval(`
      (function(){
        var item = document.querySelector('[data-id="${c.dataId}"]');
        if(item) item.click();
      })()
    `);
    await sleep(1800);

    // 等待在线简历按钮出现
    let btnReady = false;
    for (let t = 0; t < 10; t++) {
      const has = await chatClient.eval<boolean>(`!!document.querySelector("a.resume-btn-online")`);
      if (has) { btnReady = true; break; }
      await sleep(500);
    }
    if (!btnReady) throw new Error('在线简历按钮未出现');

    // 点击在线简历
    await chatClient.eval(`document.querySelector("a.resume-btn-online").click()`);
    await sleep(3500); // 等待 WASM 加载并渲染 Canvas

    // 截图
    const prefix = `resume`;
    const screenshots = await screenshotResume(chatClient, dir, prefix);
    summary.push({ name: c.name, job: c.job, uid: c.uid, screenshots });
    console.log(`  ✅ 截图 ${screenshots.length} 张 → ${dir}`);

    // 关闭弹窗
    await closeDialog(chatClient);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ 失败: ${msg}`);
    summary.push({ name: c.name, job: c.job, uid: c.uid, screenshots: [], error: msg });
    // 尝试关闭弹窗后继续
    await closeDialog(chatClient).catch(() => {});
  }

  await sleep(500);
}

// 保存汇总
const summaryPath = resolve(OUTPUT_DIR, '_summary.json');
writeFileSync(summaryPath, JSON.stringify({
  total:      candidates.length,
  downloaded: summary.filter(s => s.screenshots.length > 0).length,
  failed:     summary.filter(s => !!s.error).length,
  candidates: summary,
}, null, 2), 'utf-8');

console.log(`\n${'─'.repeat(50)}`);
console.log(`✅ 完成: ${summary.filter(s => s.screenshots.length > 0).length}/${candidates.length} 份简历`);
if (summary.some(s => s.error)) {
  console.log(`❌ 失败: ${summary.filter(s => s.error).length} 份`);
  summary.filter(s => s.error).forEach(s => console.log(`   - ${s.name}: ${s.error}`));
}
console.log(`📄 汇总: ${summaryPath}`);
console.log(`📁 目录: ${OUTPUT_DIR}`);

chatClient.close();
