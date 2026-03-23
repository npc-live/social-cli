/**
 * Runner — orchestrates login flow + command execution for any adapter.
 *
 * Flow:
 *   1. Connect to Chrome tab
 *   2. Check if already logged in (via saved session or live cookies)
 *   3. If not, navigate to loginUrl and wait for user to log in
 *   4. Save session cookies
 *   5. Run the requested command
 *   6. Render output
 */
import { newTab, connectTab, sleep } from './cdp.js';
import { captureSession, restoreSession, hasSession } from './session.js';
import { renderTable } from '../output/table.js';
import type { Adapter } from '../adapters/base.js';

export interface RunOptions {
  cdpPort?: number;
  command: string;
  args?: string[];
}

export async function run(adapter: Adapter, opts: RunOptions) {
  const port = opts.cdpPort ?? 9222;
  console.log(`\n🔌 连接 Chrome CDP :${port}...`);

  const client = await newTab(port);

  // --- 登录流程 ---
  let loggedIn = false;

  // 先尝试恢复已保存的 session
  if (hasSession(adapter.platform)) {
    await restoreSession(client, adapter.platform);
    // 导航到目标站验证 session 是否还有效
    await client.navigate(adapter.loginUrl, 3000);
    loggedIn = await adapter.isLoggedIn(client);
    if (!loggedIn) {
      console.log('⚠️  已保存的 session 已失效，需要重新登录');
    }
  }

  // session 无效或没有 session → 引导用户登录
  if (!loggedIn) {
    await client.navigate(adapter.loginUrl, 2000);
    console.log(`\n🔑 请在 Chrome 中登录 ${adapter.platform}，完成后按 Enter 继续...`);
    await waitForEnter();

    // 等待并轮询登录状态
    for (let i = 0; i < 30; i++) {
      loggedIn = await adapter.isLoggedIn(client);
      if (loggedIn) break;
      process.stdout.write(`\r等待登录... ${(i + 1) * 2}s`);
      await sleep(2000);
    }
    process.stdout.write('\n');

    if (!loggedIn) {
      client.close();
      throw new Error('登录超时，请重试');
    }

    // 保存 session
    await captureSession(client, adapter.platform);
  }

  console.log(`✅ 已登录 ${adapter.platform}`);

  // --- 执行命令 ---
  const handler = adapter.commands[opts.command];
  if (!handler) {
    const available = Object.keys(adapter.commands).join(', ');
    client.close();
    throw new Error(`未知命令 "${opts.command}"，可用: ${available}`);
  }

  console.log(`\n🔍 执行: ${adapter.platform} ${opts.command} ${(opts.args ?? []).join(' ')}\n`);
  const result = await handler(client, opts.args ?? []);
  client.close();

  // --- 渲染 ---
  renderTable(result.columns, result.rows);
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.setRawMode?.(false);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}
