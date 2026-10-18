export const SERVER_PORT = Number(process.env.JA2_E2E_PORT ?? 7431);
export const WEB_PORT = Number(process.env.JA2_E2E_WEB_PORT ?? 5183);
export const SERVER = `http://127.0.0.1:${SERVER_PORT}`;
export const TOKEN = 'e2e-token-not-secret-0123456789';
