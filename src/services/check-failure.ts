import { mkdtemp, open, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CheckExecutionError } from './check-runner.js';

const MAX_LINES = 100;
const MAX_BYTES = 5 * 1024;

export class CheckFailureService {
  async format(name: string, error: unknown): Promise<string> {
    const detail = error as { message?: unknown; stdout?: unknown; stderr?: unknown } | null;
    const message = typeof detail?.message === 'string' ? detail.message : String(error);
    const heading = `${name}: ${message}`;
    let output = [detail?.stdout, detail?.stderr].filter(Boolean).map(String).join('\n');
    let logPath = error instanceof CheckExecutionError ? error.logPath : undefined;

    try {
      let partial = false;
      if (logPath) {
        const log = await open(logPath, 'r');
        try {
          const { size } = await log.stat();
          const start = Math.max(0, size - MAX_BYTES);
          const buffer = Buffer.alloc(Math.min(size, MAX_BYTES));
          const { bytesRead } = await log.read(buffer, 0, buffer.length, start);
          output = this.decodeTail(buffer.subarray(0, bytesRead));
          partial = start > 0;
        } finally {
          await log.close();
        }
      }

      const fullMessage = output ? `${heading}\n${output}` : heading;
      if (!partial && this.fits(fullMessage)) return fullMessage;

      if (!logPath) {
        const directory = await mkdtemp(join(tmpdir(), 'pi-hooks-'));
        logPath = join(directory, 'check.log');
        await writeFile(logPath, fullMessage, { mode: 0o600 });
      }
      return this.excerpt(heading, output || message, `\n\n[Output truncated. Full log: ${logPath}]`);
    } catch (logError) {
      // Failure reporting must still work if temporary storage is unavailable.
      const reason = logError instanceof Error ? logError.message : String(logError);
      const notice = logPath ? `Full log: ${logPath}` : 'Could not save full log';
      return this.excerpt(heading, output || message, `\n\n[${notice}; ${this.tail(reason, 1, 512)}]`);
    }
  }

  private fits(text: string): boolean {
    return Buffer.byteLength(text) <= MAX_BYTES && text.split('\n').length <= MAX_LINES;
  }

  private excerpt(heading: string, output: string, notice: string): string {
    const footer = this.tail(notice, 3, 2 * 1024);
    const header = this.tail(heading, 5, 1024);
    const lines = MAX_LINES - header.split('\n').length - footer.split('\n').length + 1;
    const bytes = MAX_BYTES - Buffer.byteLength(header) - Buffer.byteLength(footer) - 1;
    return `${header}\n${this.tail(output, lines, bytes)}${footer}`;
  }

  private tail(text: string, lines: number, bytes: number): string {
    const buffer = Buffer.from(text);
    return this.decodeTail(buffer.subarray(Math.max(0, buffer.length - bytes)))
      .split('\n').slice(-lines).join('\n');
  }

  private decodeTail(buffer: Buffer): string {
    let start = 0;
    // A byte-limited tail can start in the middle of a UTF-8 character.
    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;
    return buffer.subarray(start).toString('utf8');
  }
}
