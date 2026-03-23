/**
 * Step executor — maps YAML step types to agent-browser CLI calls.
 *
 * Each method runs `agent-browser <args>` and returns parsed JSON result.
 */
import { execSync } from 'child_process';

export interface StepResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export class StepExecutor {
  private wsUrl: string;
  private connected = false;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  /** Connect to Chrome tab (once per session) */
  connect(): void {
    if (this.connected) return;
    this.run(['connect', this.wsUrl]);
    this.connected = true;
  }

  // ── Core step methods ──────────────────────────────────────────────────────

  open(url: string): StepResult {
    return this.run(['open', url]);
  }

  click(selector: string): StepResult {
    return this.run(['click', selector]);
  }

  /** Click an element by its visible text (uses eval under the hood) */
  clickText(text: string): StepResult {
    const js = `(function(){
      var el = [...document.querySelectorAll('*')].find(function(e){
        return e.textContent.trim() === ${JSON.stringify(text)} && e.children.length === 0;
      });
      if(el){ el.click(); return true; }
      return false;
    })()`;
    const r = this.eval(js);
    if (!r.value) return { ok: false, error: `Text not found: "${text}"` };
    return { ok: true };
  }

  fill(selector: string, value: string): StepResult {
    // Use eval to avoid shell-quoting issues with complex selectors
    const js = `(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
                   || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      if (nativeSet && nativeSet.set) nativeSet.set.call(el, ${JSON.stringify(value)});
      else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`;
    return this.eval(js);
  }

  type(selector: string, value: string): StepResult {
    return this.run(['type', selector, value]);
  }

  /** Type into a contenteditable element via execCommand */
  typeContentEditable(selector: string, value: string): StepResult {
    const js = `(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      if(!el) return false;
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, ${JSON.stringify(value)});
      return el.textContent || el.value || true;
    })()`;
    return this.eval(js);
  }

  /** Type via agent-browser's real keystroke simulation (works with Draft.js / React) */
  typeKeys(selector: string, value: string): StepResult {
    return this.run(['type', selector, value]);
  }

  wait(msOrSelector: number | string): StepResult {
    if (typeof msOrSelector === 'number') {
      return this.run(['wait', String(msOrSelector)]);
    }
    return this.run(['wait', msOrSelector]);
  }

  /** Press a key via agent-browser press (real key event, e.g. z, x, Enter, Control+Enter) */
  pressKey(key: string): StepResult {
    return this.run(['press', key]);
  }

  /** Insert text into the currently focused element via agent-browser keyboard type */
  keyboardInsertText(text: string): StepResult {
    // 'keyboard type' sends real key events char-by-char — works with Draft.js
    return this.run(['keyboard', 'type', text]);
  }

  eval(js: string): StepResult {
    const r = this.run(['eval', js]);
    if (r.ok && r.value !== undefined) {
      // agent-browser wraps eval result in data.result
      const data = r.value as Record<string, unknown>;
      return { ok: true, value: data.result ?? r.value };
    }
    return r;
  }

  screenshot(path?: string): StepResult {
    return this.run(path ? ['screenshot', path] : ['screenshot']);
  }

  upload(selector: string, filePath: string): StepResult {
    return this.run(['upload', selector, filePath]);
  }

  getUrl(): string {
    const r = this.run(['get', 'url']);
    const data = r.value as Record<string, unknown>;
    return (data?.url as string) ?? '';
  }

  snapshot(): string {
    const r = this.run(['snapshot']);
    return String(r.value ?? '');
  }

  // ── Internal runner ────────────────────────────────────────────────────────

  private run(args: string[]): StepResult {
    try {
      const cmd = `agent-browser ${args.map(a => this.shellQuote(a)).join(' ')}`;
      const out = execSync(cmd, {
        env: { ...process.env, AGENT_BROWSER_JSON: '1' },
        timeout: 30000,
        encoding: 'utf8',
      });

      // Find last JSON line (agent-browser may emit warnings before JSON)
      const jsonLine = out.trim().split('\n').reverse().find(l => l.startsWith('{'));
      if (!jsonLine) return { ok: true };

      const parsed = JSON.parse(jsonLine) as { success: boolean; data?: unknown; error?: string };
      if (!parsed.success) return { ok: false, error: parsed.error ?? 'unknown error' };
      return { ok: true, value: parsed.data };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  private shellQuote(s: string): string {
    // Wrap in single quotes, escape internal single quotes
    return `'${s.replace(/'/g, "'\\''")}'`;
  }
}
