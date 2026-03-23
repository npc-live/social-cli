/**
 * Session manager — save/load cookies to disk per platform.
 */
import fs from 'fs';
import path from 'path';
import type { Cookie, CDPClient } from './cdp.js';

const SESSION_DIR = path.join(process.env.HOME ?? '.', '.cdp-scraper', 'sessions');

function sessionPath(platform: string) {
  return path.join(SESSION_DIR, `${platform}.json`);
}

export function saveSession(platform: string, cookies: Cookie[]) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(sessionPath(platform), JSON.stringify(cookies, null, 2));
  console.log(`✅ Session saved → ${sessionPath(platform)} (${cookies.length} cookies)`);
}

export function loadSession(platform: string): Cookie[] | null {
  const p = sessionPath(platform);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as Cookie[];
}

export function hasSession(platform: string): boolean {
  return fs.existsSync(sessionPath(platform));
}

/** 从 browser 读取 cookies 并保存 */
export async function captureSession(client: CDPClient, platform: string): Promise<Cookie[]> {
  const cookies = await client.getAllCookies();
  saveSession(platform, cookies);
  return cookies;
}

/** 恢复已保存的 session 到 browser */
export async function restoreSession(client: CDPClient, platform: string): Promise<boolean> {
  const cookies = loadSession(platform);
  if (!cookies) return false;
  await client.setCookies(cookies);
  console.log(`✅ Session restored ← ${platform} (${cookies.length} cookies)`);
  return true;
}
