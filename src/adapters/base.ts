/**
 * Base adapter — defines the contract for all platform adapters.
 *
 * Each adapter implements:
 *   - platform: unique key (used for session file name)
 *   - loginUrl: where to send the user to log in
 *   - isLoggedIn(): check if current session is valid
 *   - commands: Record<name, handler>
 */
import type { CDPClient } from '../browser/cdp.js';
import type { Column } from '../output/table.js';

export interface CommandResult {
  columns: Column[];
  rows: Record<string, string | number>[];
}

export type CommandHandler = (client: CDPClient, args: string[]) => Promise<CommandResult>;

export abstract class Adapter {
  abstract platform: string;
  abstract loginUrl: string;
  abstract commands: Record<string, CommandHandler>;

  /** Return true if the current browser session is logged in */
  abstract isLoggedIn(client: CDPClient): Promise<boolean>;
}
