/**
 * CLI table renderer with CJK character width support.
 */

type Row = Record<string, string | number>;

export interface Column {
  key: string;
  header: string;
  width: number;
}

function dispWidth(s: string): number {
  let w = 0;
  for (const c of s) w += c.codePointAt(0)! > 127 ? 2 : 1;
  return w;
}

function truncate(s: string, maxW: number): string {
  let out = '', cur = 0;
  for (const c of s) {
    const cw = c.codePointAt(0)! > 127 ? 2 : 1;
    if (cur + cw > maxW - 1) return out + '…';
    out += c; cur += cw;
  }
  return out;
}

function pad(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - dispWidth(s)));
}

function sep(cols: Column[], char = '-') {
  return '+' + cols.map((c) => char.repeat(c.width + 2)).join('+') + '+';
}

function row(cols: Column[], values: string[]) {
  return '|' + cols.map((c, i) => ` ${pad(truncate(String(values[i] ?? ''), c.width), c.width)} `).join('|') + '|';
}

export function renderTable(cols: Column[], data: Row[]) {
  const divider = sep(cols);
  const doubleSep = sep(cols, '=');

  console.log(divider);
  console.log(row(cols, cols.map((c) => c.header)));
  console.log(doubleSep);

  data.forEach((item, i) => {
    console.log(row(cols, cols.map((c) => String(item[c.key] ?? ''))));
    if (i < data.length - 1) console.log(divider);
  });

  console.log(divider);
  console.log(`\n共 ${data.length} 条结果`);
}
