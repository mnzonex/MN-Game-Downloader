/**
 * Central API Client for MN Game Downloader
 * Automatically routes calls to http://127.0.0.1:3000 when running under file:// or custom protocols.
 */

export function getApiUrl(endpoint: string): string {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  if (typeof window !== 'undefined') {
    const isFileProtocol = window.location.protocol === 'file:';
    if (isFileProtocol) {
      return `http://127.0.0.1:3000${cleanEndpoint}`;
    }
  }
  return cleanEndpoint;
}

export async function apiFetch(input: string, init?: RequestInit, maxRetries: number = 3, retryDelayMs: number = 400): Promise<Response> {
  const url = getApiUrl(input);
  let attempt = 0;

  while (true) {
    try {
      const response = await fetch(url, init);
      if (response.ok || attempt >= maxRetries) {
        return response;
      }
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
    }
    attempt++;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}
