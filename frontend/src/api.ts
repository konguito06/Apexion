const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail ?? 'Request failed');
  return body as T;
}
