import type { UiLanguage } from '../../content/text/data-version.ts';
import { Labels, type StringTables } from '../../ui/text/labels.ts';

interface StringsBody {
  readonly language?: UiLanguage;
  readonly tables?: StringTables;
}

export async function fetchLabels(language: UiLanguage | null, fallback: UiLanguage = 'eng'): Promise<Labels> {
  try {
    const res = await fetch(language ? `/api/strings?lang=${encodeURIComponent(language)}` : '/api/strings');
    if (!res.ok) return new Labels(language ?? fallback, null);
    const body = (await res.json()) as StringsBody;
    return new Labels(body.language ?? language ?? fallback, body.tables ?? null);
  } catch {
    return new Labels(language ?? fallback, null);
  }
}
