export const CLIENT_PAGE_ALIASES: Readonly<Record<string, string>> = {
  '/play': '/src/app/game/index.html',
};

export function clientPagePath(url: string): string {
  const query = url.indexOf('?');
  const path = query < 0 ? url : url.slice(0, query);
  const page = CLIENT_PAGE_ALIASES[path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path];
  return page ? `${page}${query < 0 ? '' : url.slice(query)}` : url;
}
