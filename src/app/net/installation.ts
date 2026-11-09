import { INSTALLATION_ROUTE, type InstallationView } from '../../protocol/installation.ts';

export async function fetchInstallation(): Promise<InstallationView> {
  const res = await fetch(INSTALLATION_ROUTE);
  if (!res.ok) throw new Error(`${INSTALLATION_ROUTE}: HTTP ${res.status}`);
  return (await res.json()) as InstallationView;
}

export async function handOverMeanwhileScenesSeen(meanwhileScenesSeen: number): Promise<boolean> {
  const res = await fetch(INSTALLATION_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ meanwhileScenesSeen }),
  });
  return res.ok;
}
