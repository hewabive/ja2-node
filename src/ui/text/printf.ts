const DIRECTIVE = /%(%|s|d|u|i)/g;

export function printf(template: string, args: readonly (string | number)[]): string {
  let next = 0;
  return template.replace(DIRECTIVE, (whole, kind: string) => {
    if (kind === '%') return '%';
    if (next >= args.length) return whole;
    const value = args[next++];
    return kind === 's' ? String(value) : String(Math.trunc(Number(value)));
  });
}
