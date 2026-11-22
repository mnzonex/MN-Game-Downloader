export const getApiUrl = (path: string): string => {
  if (path.startsWith('http')) return path;

  // In Electron (production), the renderer is loaded via file:// — relative paths
  // like /api/... would resolve to file:///api/... which fails. Always use absolute URL.
  // In dev (Vite), the browser is at http://127.0.0.1:3000 so relative works too,
  // but using absolute is safe in both cases.
  const base = 'http://127.0.0.1:3000';
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  return `${base}${cleanPath}`;
};

let apiTokenPromise: Promise<string> | null = null;

async function getDesktopApiToken(): Promise<string> {
  const bridge = (window as any).electron;
  if (typeof bridge?.getApiToken !== 'function') return '';
  if (!apiTokenPromise) {
    apiTokenPromise = Promise.resolve(bridge.getApiToken()).catch((error: unknown) => {
      apiTokenPromise = null;
      throw error;
    });
  }
  return apiTokenPromise;
}

export const apiFetch = async (path: string, options: RequestInit = {}): Promise<Response> => {
  const url = getApiUrl(path);
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = await getDesktopApiToken();
  if (token) headers.set('X-MN-API-Token', token);
  return fetch(url, { ...options, headers });
};