/**
 * YAML Runner — parses adapter YAML and executes commands step by step.
 *
 * YAML schema:
 *   platform: string
 *   login_url: string
 *   login_check:
 *     cookie: string        # cookie name that indicates logged-in state
 *   commands:
 *     <name>:
 *       args: string[]       # positional arg names
 *       steps: Step[]
 *
 * Step types:
 *   - open: "{{url}}"
 *   - click: ".selector"
 *   - click: { text: "visible text" }
 *   - fill: { selector: ".sel", value: "{{text}}" }
 *   - type_rich: { selector: ".sel", value: "{{text}}" }   # for contenteditable
 *   - wait: 3000
 *   - wait: { selector: ".sel" }
 *   - eval: "js expression"
 *   - capture: { name: varName, eval: "js" }
 *   - upload: { selector: ".sel", file: "{{file}}" }
 *   - screenshot: path.png
 *   - extract: { selector, fields: { key: ".sel" | { selector, attr } } }
 *   - return: [ { field, value } ]  →  builds output table
 *   - assert: { eval: "js", message: "error msg" }
 *   - wait_until: { eval: "js", timeout: 120000, interval: 2000 }  # poll until truthy
 */
import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { StepExecutor } from './step-executor.js';
import { renderTable } from '../output/table.js';
import type { Cookie } from '../browser/cdp.js';
import { connectTab } from '../browser/cdp.js';
import { loadSession } from '../browser/session.js';

// ─── YAML types ───────────────────────────────────────────────────────────────

export interface AdapterYaml {
  platform: string;
  login_url: string;
  login_check: { cookie: string };
  commands: Record<string, CommandDef>;
}

export interface CommandDef {
  args?: string[];
  steps: Step[];
}

export type Step =
  | { open: string }
  | { click: string | { text: string } | { selector: string } }
  | { fill: { selector: string; value: string } }
  | { type_rich: { selector: string; value: string } }
  | { wait: number | { selector: string } }
  | { eval: string }
  | { capture: { name: string; eval: string } }
  | { upload: { selector: string; file: string } }
  | { screenshot: string }
  | { extract: ExtractDef }
  | { return: ReturnRow[] }
  | { assert: { eval: string; message?: string } }
  | { key: string }
  | { keyboard_insert: string }
  | { insert_text: string }
  | { wait_until: { eval: string; timeout?: number; interval?: number } };

export interface ExtractDef {
  selector: string;
  fields: Record<string, string | { selector: string; attr: string }>;
}

export interface ReturnRow {
  field: string;
  value: string;
  [key: string]: string;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runYamlCommand(
  adapterPath: string,
  commandName: string,
  argValues: string[],
  cdpPort = 9222,
) {
  // 1. Load & parse YAML
  const raw = fs.readFileSync(adapterPath, 'utf-8');
  const adapter = parseYaml(raw) as AdapterYaml;

  const cmdDef = adapter.commands[commandName];
  if (!cmdDef) {
    const available = Object.keys(adapter.commands).join(', ');
    throw new Error(`Unknown command "${commandName}". Available: ${available}`);
  }

  // 2. Build variables map from args
  const vars: Record<string, string> = {};
  (cmdDef.args ?? []).forEach((name, i) => {
    vars[name] = argValues[i] ?? '';
  });

  // 3. Ensure logged in → resolve tab ws URL
  const wsUrl = await resolveTabWsUrl(adapter, cdpPort);
  const exec = new StepExecutor(wsUrl);
  exec.connect();
  const cdpClient = await connectTab(cdpPort);

  console.log(`✅ 已连接 ${adapter.platform}`);
  console.log(`\n🔍 执行: ${adapter.platform} ${commandName} ${argValues.join(' ')}\n`);

  // 4. Execute steps
  let extractedRows: Record<string, string | number>[] | null = null;
  let returnRows: ReturnRow[] | null = null;

  for (const step of cmdDef.steps) {
    const key = Object.keys(step)[0] as keyof Step;
    const val = (step as Record<string, unknown>)[key];

    switch (key) {

      case 'open': {
        const url = interpolate(val as string, vars);
        console.log(`  → open ${url}`);
        exec.open(url);
        break;
      }

      case 'click': {
        if (typeof val === 'string') {
          // plain selector
          const sel = interpolate(val, vars);
          console.log(`  → click "${sel}"`);
          throwIfFail(exec.click(sel), `click failed: ${sel}`);
        } else if (typeof val === 'object' && val !== null && 'text' in (val as object)) {
          const text = interpolate((val as { text: string }).text, vars);
          console.log(`  → click text="${text}"`);
          throwIfFail(exec.clickText(text), `text not found: "${text}"`);
        } else if (typeof val === 'object' && val !== null && 'selector' in (val as object)) {
          const sel = interpolate((val as { selector: string }).selector, vars);
          console.log(`  → click selector="${sel}"`);
          throwIfFail(exec.click(sel), `click failed: ${sel}`);
        }
        break;
      }

      case 'fill': {
        const { selector, value } = val as { selector: string; value: string };
        const sel = interpolate(selector, vars);
        const v   = interpolate(value, vars);
        console.log(`  → fill "${sel}" = "${v.slice(0, 40)}"`);
        throwIfFail(exec.fill(sel, v), `fill failed: ${sel}`);
        break;
      }

      case 'type_rich': {
        const { selector, value } = val as { selector: string; value: string };
        const sel = interpolate(selector, vars);
        const v   = interpolate(value, vars);
        console.log(`  → type_rich "${sel}" = "${v.slice(0, 40)}"`);
        throwIfFail(exec.typeContentEditable(sel, v), `type_rich failed: ${sel}`);
        break;
      }

      case 'wait': {
        if (typeof val === 'number') {
          console.log(`  → wait ${val}ms`);
          exec.wait(val);
        } else {
          const sel = interpolate((val as { selector: string }).selector, vars);
          console.log(`  → wait selector="${sel}"`);
          exec.wait(sel);
        }
        break;
      }

      case 'eval': {
        const js = interpolate(val as string, vars);
        console.log(`  → eval ...`);
        exec.eval(js);
        break;
      }

      case 'capture': {
        const { name, eval: js } = val as { name: string; eval: string };
        const interpolatedJs = interpolate(js, vars);
        console.log(`  → capture ${name}`);
        const r = exec.eval(interpolatedJs);
        vars[name] = String(r.value ?? '');
        console.log(`     ${name} = ${vars[name].slice(0, 60)}`);
        break;
      }

      case 'upload': {
        const { selector, file } = val as { selector: string; file: string };
        const sel = interpolate(selector, vars);
        const f   = interpolate(file, vars);
        console.log(`  → upload "${sel}" ← ${f}`);
        throwIfFail(exec.upload(sel, f), `upload failed: ${sel}`);
        break;
      }

      case 'screenshot': {
        const p = interpolate(val as string, vars);
        console.log(`  → screenshot → ${p}`);
        exec.screenshot(p);
        break;
      }

      case 'extract': {
        const def = val as ExtractDef;
        console.log(`  → extract "${def.selector}"`);
        extractedRows = runExtract(exec, def, vars);
        break;
      }

      case 'return': {
        returnRows = (val as ReturnRow[]).map(r => ({
          field: interpolate(r.field, vars),
          value: interpolate(r.value, vars),
        }));
        break;
      }

      case 'assert': {
        const { eval: js, message } = val as { eval: string; message?: string };
        const r = exec.eval(interpolate(js, vars));
        if (!r.value) throw new Error(message ?? `Assertion failed: ${js}`);
        console.log(`  → assert ✅`);
        break;
      }

      case 'key': {
        const k = interpolate(val as string, vars);
        console.log(`  → key "${k}"`);
        // For Enter/special keys that need to reach the focused element, use CDPClient directly
        if (k === 'Enter' || k === 'Control+Enter') {
          const modifiers = k.startsWith('Control') ? 2 : 0;
          await cdpClient.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers });
          await cdpClient.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers });
        } else {
          exec.pressKey(k);
        }
        break;
      }

      case 'keyboard_insert': {
        // Send text char-by-char via CDP Input.dispatchKeyEvent 'char' events
        // This triggers Draft.js / React input handlers correctly
        const text = interpolate(val as string, vars);
        console.log(`  → keyboard_insert "${text.slice(0, 40)}"`);
        for (const char of text) {
          const code = char.codePointAt(0)!;
          await cdpClient.send('Input.dispatchKeyEvent', { type: 'keyDown', key: char, windowsVirtualKeyCode: code });
          await cdpClient.send('Input.dispatchKeyEvent', { type: 'char', key: char, text: char });
          await cdpClient.send('Input.dispatchKeyEvent', { type: 'keyUp', key: char, windowsVirtualKeyCode: code });
        }
        break;
      }

      case 'insert_text': {
        // CDP Input.insertText — inserts text directly into the focused element,
        // works even inside shadow DOM (unlike keyboard_insert which targets document.activeElement)
        const text = interpolate(val as string, vars);
        console.log(`  → insert_text "${text.slice(0, 40)}"`);
        await cdpClient.send('Input.insertText', { text });
        break;
      }

      case 'wait_until': {
        // Poll a JS expression until it returns truthy, with timeout
        const { eval: js, timeout = 120000, interval = 2000 } = val as { eval: string; timeout?: number; interval?: number };
        const interpolatedJs = interpolate(js, vars);
        console.log(`  → wait_until (timeout: ${timeout / 1000}s, interval: ${interval / 1000}s)`);
        const deadline = Date.now() + timeout;
        let resolved = false;
        while (Date.now() < deadline) {
          const r = exec.eval(interpolatedJs);
          if (r.ok && r.value && r.value !== 'false' && r.value !== '' && r.value !== 0) {
            resolved = true;
            break;
          }
          console.log(`     ... waiting (${Math.round((deadline - Date.now()) / 1000)}s left)`);
          exec.wait(interval);
        }
        if (!resolved) {
          throw new Error(`wait_until timed out after ${timeout / 1000}s`);
        }
        console.log(`     ✅ condition met`);
        break;
      }
    }
  }

  // 5. Render output
  console.log('');
  if (extractedRows) {
    const fields = Object.keys(extractedRows[0] ?? {});
    const columns = fields.map(k => ({
      key: k,
      header: k,
      width: k === 'index' ? 4 : k === 'link' ? 52 : k === 'title' ? 36 : 24,
    }));
    renderTable(columns, extractedRows);
  } else if (returnRows) {
    renderTable(
      [{ key: 'field', header: '字段', width: 12 }, { key: 'value', header: '值', width: 50 }],
      returnRows,
    );
  }
  cdpClient.close();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Replace {{expr}} placeholders — supports plain var names and JS expressions */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(.+?)\}\}/g, (_, expr) => {
    const trimmed = expr.trim();
    // Plain variable name: fast path
    if (/^\w+$/.test(trimmed)) return vars[trimmed] ?? '';
    // JS expression: inject vars as locals and eval
    try {
      const keys = Object.keys(vars);
      const vals = keys.map(k => vars[k]);
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      return String(new Function(...keys, `return (${trimmed})`)(...vals) ?? '');
    } catch {
      return '';
    }
  });
}

function throwIfFail(r: { ok: boolean; error?: string }, msg: string): void {
  if (!r.ok) throw new Error(`${msg}: ${r.error ?? ''}`);
}

/** Run an extract step: scrape a list of items with named fields */
function runExtract(
  exec: StepExecutor,
  def: ExtractDef,
  vars: Record<string, string>,
): Record<string, string | number>[] {
  const fieldsJson = JSON.stringify(def.fields);
  const js = `(function(){
    var fields = ${fieldsJson};
    var results = [];
    document.querySelectorAll(${JSON.stringify(def.selector)}).forEach(function(item, i) {
      var row = { index: i + 1 };
      Object.keys(fields).forEach(function(key) {
        var spec = fields[key];
        if (typeof spec === 'string') {
          var el = item.querySelector(spec);
          row[key] = el ? el.textContent.trim() : '';
        } else {
          var el2 = item.querySelector(spec.selector);
          row[key] = el2 ? (spec.attr === 'href' ? (el2.href || el2.getAttribute(spec.attr)) : el2.getAttribute(spec.attr)) || el2.textContent.trim() : '';
        }
      });
      if (Object.values(row).some(function(v){ return v && v !== i + 1; })) results.push(row);
    });
    return JSON.stringify(results);
  })()`;

  const r = exec.eval(js);
  try {
    return JSON.parse(String(r.value ?? '[]')) as Record<string, string | number>[];
  } catch {
    return [];
  }
}

/** Find the ws URL of the right tab, with full user onboarding if needed */
async function resolveTabWsUrl(adapter: AdapterYaml, cdpPort: number): Promise<string> {
  // Step 1: Check Chrome is running with CDP
  let tabs: Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  try {
    const res = await fetch(`http://localhost:${cdpPort}/json`, { signal: AbortSignal.timeout(2000) });
    tabs = (await res.json()) as typeof tabs;
  } catch {
    console.error(`\n❌ 无法连接到 Chrome CDP (端口 ${cdpPort})`);
    console.error('\n👉 请先启动 Chrome，开启远程调试：\n');
    console.error(`   macOS:   /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\`);
    console.error(`              --remote-debugging-port=${cdpPort} \\`);
    console.error(`              --user-data-dir=$HOME/.cdp-scraper/chrome-profile\n`);
    console.error(`   Windows: chrome.exe --remote-debugging-port=${cdpPort} --user-data-dir=%USERPROFILE%\\.cdp-scraper\\chrome-profile\n`);
    console.error(`   Linux:   google-chrome --remote-debugging-port=${cdpPort} --user-data-dir=~/.cdp-scraper/chrome-profile\n`);
    console.error('启动后重新运行此命令。');
    process.exit(1);
  }

  const pageTabs = tabs.filter(t => t.type === 'page');
  if (pageTabs.length === 0) {
    console.error('❌ Chrome 中没有打开的页面，请至少保持一个标签页打开。');
    process.exit(1);
  }

  // Step 2: Prefer a tab already on the platform domain
  const domain = new URL(adapter.login_url).hostname.replace('www.', '');
  const existing = pageTabs.find(
    t => t.url.includes(domain) && !t.url.includes('creator'),
  );
  if (existing) return existing.webSocketDebuggerUrl;

  // Step 3: Check saved session cookie
  const cookies = loadSession(adapter.platform) as Cookie[] | null;
  const hasCookie = cookies?.some(c => c.name === adapter.login_check.cookie);
  if (hasCookie) {
    const page = pageTabs[0];
    return page.webSocketDebuggerUrl;
  }

  // Step 4: Not logged in — guide user through login
  console.log(`\n🔑 需要登录 ${adapter.platform}`);
  console.log('─'.repeat(50));

  // Open the platform login page in the first tab via agent-browser
  const firstTab = pageTabs[0].webSocketDebuggerUrl;
  console.log(`\n   正在打开登录页: ${adapter.login_url}`);
  console.log(`   (使用 agent-browser 连接到: ${firstTab})\n`);

  const { execSync } = await import('child_process');
  try {
    execSync(`agent-browser connect '${firstTab}'`, {
      env: { ...process.env, AGENT_BROWSER_JSON: '1' },
      timeout: 5000,
      encoding: 'utf8',
    });
    execSync(`agent-browser open '${adapter.login_url}'`, {
      env: { ...process.env, AGENT_BROWSER_JSON: '1' },
      timeout: 10000,
      encoding: 'utf8',
    });
  } catch {
    console.log(`   ⚠️  无法自动打开页面，请手动在 Chrome 中访问: ${adapter.login_url}`);
  }

  console.log(`👀 请在 Chrome 中完成登录 ${adapter.platform}，然后按 Enter...`);
  await waitForEnter();

  // Step 5: Verify login by checking for the cookie
  const resTabs = await fetch(`http://localhost:${cdpPort}/json`);
  const freshTabs = (await resTabs.json()) as typeof tabs;
  const freshPage = freshTabs.filter(t => t.type === 'page')[0];
  if (!freshPage) {
    console.error('❌ Chrome 中没有打开的页面');
    process.exit(1);
  }

  // Save session from the browser
  const { connectTab } = await import('../browser/cdp.js');
  const { captureSession } = await import('../browser/session.js');
  const client = await connectTab(cdpPort);
  const saved = await captureSession(client, adapter.platform);
  client.close();

  const ok = saved.some(c => c.name === adapter.login_check.cookie);
  if (!ok) {
    console.error(`❌ 未检测到登录 cookie (${adapter.login_check.cookie})，请确认已登录后重试`);
    process.exit(1);
  }

  console.log(`✅ 登录成功，session 已保存\n`);
  return freshPage.webSocketDebuggerUrl;
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.setRawMode?.(false);
    process.stdin.resume();
    process.stdout.write('   > ');
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}
