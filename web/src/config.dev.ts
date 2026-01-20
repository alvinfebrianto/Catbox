// Development config - uses local server (relative paths)
(globalThis as unknown as { API_BASE_URL: string }).API_BASE_URL = '';
(globalThis as unknown as { PROXY_AUTH_TOKEN: string }).PROXY_AUTH_TOKEN = 'dev-token';
