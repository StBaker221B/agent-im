// Matrix account/room administration for the control plane.
// Uses the client-server API directly; no SDK.

export function createMatrixAdmin({ homeserver, registrationToken = "" }) {
  const base = String(homeserver).replace(/\/+$/, "");

  async function request(method, path, { body, token } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // non-JSON body; leave json null
    }
    return { ok: res.ok, status: res.status, body: json };
  }

  async function login({ username, password }) {
    const res = await request("POST", "/_matrix/client/v3/login", {
      body: {
        type: "m.login.password",
        identifier: { type: "m.id.user", user: username },
        password,
        initial_device_display_name: "agent-im",
      },
    });
    return res.ok ? res.body : null;
  }

  async function register({ username, password }) {
    const body = {
      username,
      password,
      initial_device_display_name: "agent-im",
    };
    const query = registrationToken
      ? `?kind=user&token=${encodeURIComponent(registrationToken)}`
      : "?kind=user";
    let res = await request("POST", `/_matrix/client/v3/register${query}`, { body });
    if (res.ok) return res.body;
    if (res.body?.errcode === "M_USER_IN_USE") return null;

    const session = res.body?.session;
    const flows = res.body?.flows ?? [];
    const attempts = [];
    if (registrationToken) attempts.push({ type: "m.login.registration_token", token: registrationToken });
    if (flows.includes("m.login.dummy")) attempts.push({ type: "m.login.dummy" });
    for (const auth of attempts) {
      res = await request("POST", "/_matrix/client/v3/register?kind=user", {
        body: { ...body, auth, ...(session ? { session } : {}) },
      });
      if (res.ok) return res.body;
      if (res.body?.errcode === "M_USER_IN_USE") return null;
    }
    throw new Error(`register ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  async function registerOrLogin({ username, password, displayName }) {
    const reg = await register({ username, password, displayName });
    if (reg?.access_token && reg?.user_id) {
      return { userId: reg.user_id, accessToken: reg.access_token, created: true };
    }
    const logRes = await login({ username, password });
    if (logRes?.access_token && logRes?.user_id) {
      return { userId: logRes.user_id, accessToken: logRes.access_token, created: false };
    }
    throw new Error(
      `cannot register or log in ${username}. If the account exists with another password, use a new id.`,
    );
  }

  async function setDisplayName(token, userId, displayName) {
    if (!displayName) return;
    await request("PUT", `/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`, {
      token,
      body: { displayname: displayName },
    });
  }

  async function createRoom(token, { name, invite = [], isDirect = false, topic } = {}) {
    const res = await request("POST", "/_matrix/client/v3/createRoom", {
      token,
      body: {
        name,
        ...(topic ? { topic } : {}),
        preset: "private_chat",
        invite,
        ...(isDirect ? { is_direct: true } : {}),
        creation_content: { "m.federate": false },
      },
    });
    if (!res.ok) throw new Error(`createRoom failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.room_id;
  }

  async function invite(token, roomId, userId) {
    const res = await request("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, {
      token,
      body: { user_id: userId },
    });
    if (!res.ok && !["M_FORBIDDEN", "M_BAD_STATE"].includes(res.body?.errcode)) {
      throw new Error(`invite ${userId} failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
  }

  async function join(token, roomId) {
    const res = await request("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {
      token,
      body: {},
    });
    if (!res.ok) throw new Error(`join ${roomId} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body?.room_id ?? roomId;
  }

  async function leave(token, roomId) {
    const res = await request("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/leave`, {
      token,
      body: {},
    });
    if (!res.ok && res.body?.errcode !== "M_NOT_FOUND") {
      throw new Error(`leave ${roomId} failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return true;
  }

  async function members(token, roomId) {
    const res = await request(
      "GET",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/members?membership=join`,
      { token },
    );
    if (!res.ok) throw new Error(`members ${roomId} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return (res.body?.chunk ?? []).map((e) => e.state_key);
  }

  return {
    request,
    login,
    register,
    registerOrLogin,
    setDisplayName,
    createRoom,
    invite,
    join,
    leave,
    members,
  };
}
