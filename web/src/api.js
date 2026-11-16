async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error body; leave data null
  }
  if (!res.ok) throw new Error(data?.error ?? `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  bootstrap: () => request("/api/bootstrap"),
  roleTemplates: () => request("/api/role-templates"),
  usage: () => request("/api/usage"),
  messages: (roomId) => request(`/api/rooms/${encodeURIComponent(roomId)}/messages`),
  send: (roomId, text) =>
    request(`/api/rooms/${encodeURIComponent(roomId)}/messages`, { method: "POST", body: { text } }),
  read: (roomId, ts) =>
    request(`/api/rooms/${encodeURIComponent(roomId)}/read`, { method: "POST", body: { ts } }),
  createDm: (agentId) => request("/api/rooms", { method: "POST", body: { kind: "dm", agentId } }),
  createGroup: (name, agentIds) =>
    request("/api/rooms", { method: "POST", body: { kind: "group", name, agentIds } }),
  createAgent: (payload) => request("/api/agents", { method: "POST", body: payload }),
  updateAgent: (agentId, payload) =>
    request(`/api/agents/${encodeURIComponent(agentId)}`, { method: "PATCH", body: payload }),
  search: (q) => request(`/api/search?q=${encodeURIComponent(q)}`),
  invite: (roomId, agentIds) =>
    request(`/api/rooms/${encodeURIComponent(roomId)}/members`, {
      method: "POST",
      body: { agentIds },
    }),
  deleteRoom: (roomId) => request(`/api/rooms/${encodeURIComponent(roomId)}`, { method: "DELETE" }),
  updateRoom: (roomId, payload) =>
    request(`/api/rooms/${encodeURIComponent(roomId)}`, { method: "PATCH", body: payload }),
  upload: (roomId, { filename, contentType, data }) =>
    request(`/api/rooms/${encodeURIComponent(roomId)}/upload`, {
      method: "POST",
      body: { filename, contentType, data },
    }),
};
