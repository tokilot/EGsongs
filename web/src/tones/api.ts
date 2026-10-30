// The tone library's calls to the local server (server/src/routes/tones.ts).
import { request } from '../shared/http.ts'

/** The library as last saved on the server, or null before it was ever saved there. */
export async function getToneLibrary(): Promise<unknown> {
  return (await request<{ library: unknown }>('/api/tones')).library
}

export function saveToneLibrary(library: unknown): Promise<{ ok: boolean }> {
  return request('/api/tones', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(library) })
}
