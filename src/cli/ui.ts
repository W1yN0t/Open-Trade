import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const c = chalk;

export function header(title: string): void {
  console.log('');
  console.log(chalk.bold.cyan(`◆  ${title}`));
  console.log('');
}

export function success(msg: string): void {
  console.log(chalk.green(`✅  ${msg}`));
}

export function error(msg: string): void {
  console.log(chalk.red(`❌  ${msg}`));
}

export function warn(msg: string): void {
  console.log(chalk.yellow(`⚠️   ${msg}`));
}

export function info(label: string, value: string): void {
  console.log(`   ${chalk.bold(label.padEnd(18))}  ${value}`);
}

export function divider(): void {
  console.log(chalk.dim('   ' + '─'.repeat(56)));
}

export function table(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))
  );

  const border = (left: string, mid: string, right: string, fill: string) =>
    left + widths.map(w => fill.repeat(w + 2)).join(mid) + right;

  const row = (cells: string[], bold = false) =>
    '│' + cells.map((c, i) => {
      const padded = ` ${c.padEnd(widths[i])} `;
      return bold ? chalk.bold(padded) : padded;
    }).join('│') + '│';

  console.log(chalk.dim(border('┌', '┬', '┐', '─')));
  console.log(row(headers, true));
  console.log(chalk.dim(border('├', '┼', '┤', '─')));
  for (const r of rows) console.log(row(r));
  console.log(chalk.dim(border('└', '┴', '┘', '─')));
}

export function version(): string {
  try {
    const pkgPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../package.json',
    );
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string };
    return pkg.version;
  } catch {
    return '?';
  }
}
