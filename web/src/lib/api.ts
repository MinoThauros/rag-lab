// Thin fetch wrapper for the rag-lab API. The session lives in httpOnly cookies,
// so requests to the same origin carry it automatically.

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new ApiError(response.status, body.error ?? response.statusText)
  }
  return response.status === 204 ? (undefined as T) : response.json()
}
