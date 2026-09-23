export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
export const AI_BASE_URL = process.env.NEXT_PUBLIC_AI_URL || 'http://localhost:8000';

export const isElectron = (): boolean =>
  typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined';

// Electron serves the AI service through the app:// protocol; the browser talks to it directly.
export const AI_STREAM_BASE = (): string => (isElectron() ? 'app://./aiservice' : AI_BASE_URL);

/**
 * fetch() replacement that routes through IPC when running inside Electron.
 * Used for SSE streaming, where a plain fetch would bypass the main process.
 */
export const electronFetch = async (
  input: string,
  init: RequestInit = {}
): Promise<Response> => {
  if (!isElectron()) return fetch(input, init);

  const result = await window.electronAPI!.request(input, {
    method: init.method,
    body: init.body,
    headers: init.headers as Record<string, string> | undefined,
  });

  return new Response(typeof result === 'string' ? result : JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const ENDPOINTS = {
  health: '/api/health',
  // Add module endpoints here following this pattern:
  // moduleName: {
  //   list: '/api/module',
  //   byId: (id: string) => `/api/module/${id}`,
  // },
} as const;
