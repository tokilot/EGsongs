// The one way the page talks to the local server (server/src/app.ts); each part has its own calls in its api.ts.
import { translate } from './ui/i18n.ts'

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new Error(translate('无法连接本地服务，请确认后端已启动。'))
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? translate('请求失败（{status}）', { status: response.status }))
  }
  return (await response.json()) as T
}

export function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
