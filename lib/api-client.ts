// Fetch wrapper for Flow API routes: JSON in/out, readable error messages, and a trip to /login on 401.
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { window.location.assign("/login"); throw new Error("Please sign in again"); }
  if (!response.ok) throw new Error((data as { error?: string }).error || "Something went wrong");
  return data as T;
}
