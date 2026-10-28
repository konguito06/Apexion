const API = import.meta.env.VITE_API_URL ?? '';
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  } catch {
    throw new Error('Cannot reach Apexion API. Check that the backend is running, then retry.');
  }

  const text = await response.text();
  let body: { detail?: string } | T;
  try {
    body = text ? JSON.parse(text) as { detail?: string } | T : {} as T;
  } catch {
    body = {} as T;
  }
  if (!response.ok) {
    const detail = typeof body === 'object' && body !== null && 'detail' in body && typeof body.detail === 'string'
      ? body.detail
      : `Apexion API request failed (${response.status}).`;
    throw new Error(detail);
  }
  return body as T;
}
