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

export const apiFetch = async (path: string, options: RequestInit = {}): Promise<Response> => {
  const url = getApiUrl(path);
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
};