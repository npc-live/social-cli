/**
 * CDP client — wraps a single Chrome tab via WebSocket.
 * Handles request/response matching, navigate, eval, cookies.
 */
import WebSocket from 'ws';

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
}

export class CDPClient {
  private ws: WebSocket;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private idCounter = 0;
  private ready: Promise<void>;

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as { id?: number; result?: unknown; error?: { message: string } };
      if (msg.id !== undefined) {
        const cb = this.pending.get(msg.id);
        if (!cb) return;
        this.pending.delete(msg.id);
        if (msg.error) cb.reject(new Error(msg.error.message));
        else cb.resolve(msg.result ?? null);
      }
    });
  }

  async waitReady() {
    await this.ready;
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.idCounter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async navigate(url: string, waitMs = 3000): Promise<void> {
    await this.send('Page.navigate', { url });
    await sleep(waitMs);
  }

  async eval<T = unknown>(expression: string): Promise<T> {
    const res = await this.send<{ result: { value?: T; type: string } }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result.value as T;
  }

  async getAllCookies(): Promise<Cookie[]> {
    const res = await this.send<{ cookies: Cookie[] }>('Network.getAllCookies');
    return res.cookies;
  }

  /** 通过 DOM.setFileInputFiles 上传本地文件到 input[type=file] */
  async uploadFiles(selector: string, filePaths: string[]): Promise<void> {
    await this.send('DOM.enable');
    const doc = await this.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 1 });
    const q = await this.send<{ nodeId: number }>('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector,
    });
    if (!q.nodeId) throw new Error(`uploadFiles: selector not found: ${selector}`);
    await this.send('DOM.setFileInputFiles', { files: filePaths, nodeId: q.nodeId });
  }

  async setCookies(cookies: Cookie[]): Promise<void> {
    for (const c of cookies) {
      await this.send('Network.setCookie', {
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
      });
    }
  }

  close() {
    this.ws.close();
  }
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** 连接到 Chrome CDP，返回指定 tab 的 CDPClient */
export async function connectTab(cdpPort = 9222, tabIndex = 0): Promise<CDPClient> {
  const res = await fetch(`http://localhost:${cdpPort}/json`);
  const tabs = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl: string; url: string }>;
  const pages = tabs.filter((t) => t.type === 'page');
  if (!pages[tabIndex]) throw new Error(`No page tab at index ${tabIndex}`);
  const client = new CDPClient(pages[tabIndex].webSocketDebuggerUrl);
  await client.waitReady();
  return client;
}

/** 新建 tab，返回其 CDPClient */
export async function newTab(cdpPort = 9222): Promise<CDPClient> {
  const res = await fetch(`http://localhost:${cdpPort}/json/new`, { method: 'PUT' });
  const tab = (await res.json()) as { webSocketDebuggerUrl: string };
  const client = new CDPClient(tab.webSocketDebuggerUrl);
  await client.waitReady();
  return client;
}
