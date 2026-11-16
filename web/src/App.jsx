import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import AgentsView from "./components/AgentsView";
import NewChatModal from "./components/NewChatModal";
import NewAgentModal from "./components/NewAgentModal";
import TeamModal from "./components/TeamModal";
import InviteModal from "./components/InviteModal";
import ProfileModal from "./components/ProfileModal";
import SearchView from "./components/SearchView";
import SettingsView from "./components/SettingsView";
import Icon from "./components/Icon";

function mergeMessages(prev, next) {
  const ids = new Set(next.map((m) => m.id));
  const extra = prev.filter((m) => !ids.has(m.id));
  if (!extra.length) return next;
  return [...next, ...extra].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

function EmptyChat({ onNew }) {
  return (
    <section className="empty-chat">
      <div className="empty-mark" aria-hidden="true" />
      <h2>选择或新建一个会话</h2>
      <p>和 agent 私聊，或者拉几个 agent 建个群。每条人类消息都会被 agent 读到。</p>
      <button type="button" className="primary" onClick={onNew}>
        <Icon name="plus" size={16} />
        新建会话
      </button>
    </section>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [teams, setTeams] = useState([]);
  const [live, setLive] = useState({});
  const [connected, setConnected] = useState(false);
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [view, setView] = useState("chat");
  const [messages, setMessages] = useState([]);
  const [modal, setModal] = useState(null); // chat | agent | invite
  const [profile, setProfile] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [focusMessageId, setFocusMessageId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [modalError, setModalError] = useState("");
  const [toast, setToast] = useState("");
  const [mobilePane, setMobilePane] = useState("list");

  const markKeyRef = useRef("");
  const toastRef = useRef({ msg: "", at: 0 });

  const notify = useCallback((msg) => {
    const now = Date.now();
    if (toastRef.current.msg === msg && now - toastRef.current.at < 8000) return;
    toastRef.current = { msg, at: now };
    setToast(msg);
  }, []);

  const loadBootstrap = useCallback(async () => {
    try {
      const next = await api.bootstrap();
      setData(next);
      setConnected(true);
      return next;
    } catch (err) {
      setConnected(false);
      notify(err.message);
      return null;
    }
  }, [notify]);

  useEffect(() => {
    loadBootstrap();
    const timer = setInterval(loadBootstrap, 2500);
    return () => clearInterval(timer);
  }, [loadBootstrap]);

  useEffect(() => {
    api
      .roleTemplates()
      .then((res) => setTemplates(res.templates ?? []))
      .catch(() => {});
    api
      .teamTemplates()
      .then((res) => setTeams(res.teams ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (e) => {
      let event;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!event?.agentId || !event?.roomId) return;
      const key = `${event.roomId}:${event.agentId}`;
      setLive((prev) => {
        const current = prev[key] ?? {
          agentId: event.agentId,
          roomId: event.roomId,
          text: "",
          tools: [],
          active: false,
        };
        const next = { ...current };
        if (event.type === "turn_start") {
          next.text = "";
          next.tools = [];
          next.active = true;
        } else if (event.type === "text_delta") {
          next.text = (next.text ?? "") + event.text;
          next.active = true;
        } else if (event.type === "tool_use") {
          next.tools = [...(next.tools ?? []), { name: event.name, input: event.input }];
          next.active = true;
        } else if (event.type === "turn_end" || event.type === "skip") {
          const copy = { ...prev };
          delete copy[key];
          return copy;
        }
        return { ...prev, [key]: next };
      });
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    document.title = data?.totalUnread ? `(${data.totalUnread}) Agent IM` : "Agent IM";
  }, [data?.totalUnread]);

  useEffect(() => {
    if (!activeRoomId) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await api.messages(activeRoomId);
        if (alive) setMessages((prev) => mergeMessages(prev, res.messages));
      } catch (err) {
        if (alive) notify(err.message);
      }
    };
    load();
    const timer = setInterval(load, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activeRoomId, notify]);

  useEffect(() => {
    if (!activeRoomId || !messages.length || view !== "chat" || mobilePane !== "chat") return;
    const last = messages[messages.length - 1];
    const key = `${activeRoomId}:${last.id}`;
    if (markKeyRef.current === key) return;
    markKeyRef.current = key;
    api.read(activeRoomId, last.createdAt).catch(() => {});
  }, [messages, activeRoomId, view, mobilePane]);

  const agentsById = useMemo(() => new Map((data?.agents ?? []).map((a) => [a.id, a])), [data]);
  const activeRoom = data?.rooms.find((r) => r.id === activeRoomId) ?? null;

  useEffect(() => {
    const applyHash = () => {
      const path = decodeURIComponent(location.hash.replace(/^#/, ""));
      const match = path.match(/^\/room\/(.+)$/);
      if (match) {
        setActiveRoomId(match[1]);
        setView("chat");
        setMobilePane("chat");
      } else if (path === "/agents") {
        setView("agents");
        setMobilePane("chat");
      } else if (path === "/settings") {
        setView("settings");
        setMobilePane("chat");
      } else if (path.startsWith("/search?q=")) {
        setSearchQuery(path.slice("/search?q=".length));
        setView("search");
        setMobilePane("chat");
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  function setHash(hash) {
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  function openModal(kind) {
    setModalError("");
    setModal(kind);
  }

  function openRoom(roomId) {
    setActiveRoomId(roomId);
    setView("chat");
    setMobilePane("chat");
    setMessages([]);
    setModal(null);
    setFocusMessageId(null);
    setHash(`#/room/${encodeURIComponent(roomId)}`);
  }

  function openProfile(member) {
    const id = typeof member === "string" ? member : member?.id;
    if (!id) return;
    const memberInfo = typeof member === "string" ? activeRoom?.members.find((m) => m.id === id) : member;
    const agent = agentsById.get(id);
    setProfile(
      agent
        ? { ...agent, kind: "agent" }
        : { ...(data?.human ?? {}), ...memberInfo, id, kind: memberInfo?.kind ?? "human" },
    );
  }

  function openSearch(q) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSearchQuery(trimmed);
    setView("search");
    setMobilePane("chat");
    setHash(`#/search?q=${encodeURIComponent(trimmed)}`);
  }

  function openSettings() {
    setView("settings");
    setMobilePane("chat");
    setHash("#/settings");
  }

  async function deleteRoomById(roomId) {
    try {
      await api.deleteRoom(roomId);
      if (activeRoomId === roomId) {
        setActiveRoomId(null);
        setMessages([]);
        markKeyRef.current = "";
        setHash("#/");
        setMobilePane("list");
      }
      await loadBootstrap();
    } catch (err) {
      notify(err.message);
    }
  }

  async function deleteRoomFromList(room) {
    const peer = room.members?.find((m) => m.kind === "agent");
    const label = room.kind === "dm" ? peer?.displayName || room.name : room.name;
    if (window.confirm(`删除「${label}」？会离开这个房间并从列表移除。`)) await deleteRoomById(room.id);
  }

  async function approveTool(agentId, tool) {
    if (!activeRoomId) return;
    try {
      await api.approveTool(agentId, tool, activeRoomId);
      await loadBootstrap();
    } catch (err) {
      notify(err.message);
    }
  }

  function openSearchResult(roomId, messageId) {
    openRoom(roomId);
    setFocusMessageId(messageId);
  }

  async function saveAgent(agentId, payload) {
    try {
      await api.updateAgent(agentId, payload);
      await loadBootstrap();
      notify("设置已保存");
      return true;
    } catch (err) {
      notify(err.message);
      return false;
    }
  }

  async function handleSend(text) {
    if (!activeRoomId) return false;
    try {
      const res = await api.send(activeRoomId, text);
      setMessages((prev) => mergeMessages(prev, [res.message]));
      // Pull the engine activity (floor/queue) right away so the UI shows the
      // real "thinking" state instead of guessing from messages.
      loadBootstrap();
      return true;
    } catch (err) {
      notify(err.message);
      return false;
    }
  }

  async function handleUpload(file) {
    if (!activeRoomId || !file) return false;
    setUploading(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
        reader.readAsDataURL(file);
      });
      const data = String(dataUrl).split(",")[1] ?? "";
      const res = await api.upload(activeRoomId, {
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        data,
      });
      setMessages((prev) => mergeMessages(prev, [res.message]));
      loadBootstrap();
      return true;
    } catch (err) {
      notify(err.message);
      return false;
    } finally {
      setUploading(false);
    }
  }

  async function runModal(action) {
    setBusy(true);
    setModalError("");
    try {
      await action();
    } catch (err) {
      setModalError(err.message);
      notify(err.message);
    } finally {
      setBusy(false);
    }
  }

  const handleCreateDm = (agentId) =>
    runModal(async () => {
      const res = await api.createDm(agentId);
      await loadBootstrap();
      openRoom(res.room.id);
    });

  const handleCreateGroup = (name, agentIds) =>
    runModal(async () => {
      const res = await api.createGroup(name, agentIds);
      await loadBootstrap();
      openRoom(res.room.id);
    });

  const handleCreateAgent = (payload) =>
    runModal(async () => {
      const agent = await api.createAgent(payload);
      const res = await api.createDm(agent.id);
      await loadBootstrap();
      openRoom(res.room.id);
    });

  const handleCreateTeam = (payload) =>
    runModal(async () => {
      const res = await api.createTeam(payload.teamId, {
        prefix: payload.prefix,
        groupName: payload.groupName,
      });
      await loadBootstrap();
      openRoom(res.group.room.id);
    });

  const handleInvite = (agentIds) =>
    runModal(async () => {
      if (!activeRoomId) return;
      await api.invite(activeRoomId, agentIds);
      await loadBootstrap();
      setModal(null);
    });

  const handleNewAgent = () => {
    setModalError("");
    setModal("agent");
  };

  return (
    <div className={`app${mobilePane === "chat" ? " mobile-chat" : ""}`}>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        跳到主要内容
      </a>
      <Sidebar
        data={data}
        activeRoomId={activeRoomId}
        view={view}
        connected={connected}
        onSelectRoom={openRoom}
        onNew={() => openModal("chat")}
        onAgents={() => {
          setView("agents");
          setMobilePane("chat");
          setHash("#/agents");
        }}
        onSettings={openSettings}
        onSearch={openSearch}
        onProfile={openProfile}
        onDeleteRoom={deleteRoomFromList}
      />

      <main className="main" id="main" tabIndex={-1}>
        {view === "agents" ? (
          <AgentsView
            agents={data?.agents ?? []}
            onNew={() => openModal("agent")}
            onNewTeam={() => openModal("team")}
            onDm={handleCreateDm}
            onProfile={openProfile}
            onBack={() => setMobilePane("list")}
          />
        ) : view === "search" ? (
          <SearchView
            query={searchQuery}
            onSearch={openSearch}
            onOpenResult={openSearchResult}
            onBack={() => setMobilePane("list")}
          />
        ) : view === "settings" ? (
          <SettingsView
            data={data}
            templates={templates}
            onSave={saveAgent}
            onBack={() => setMobilePane("list")}
          />
        ) : activeRoom ? (
          <ChatView
            key={activeRoom.id}
            room={activeRoom}
            messages={messages}
            human={data.human}
            agentsById={agentsById}
            activity={activeRoom.activity}
            live={live}
            sending={busy || uploading}
            uploading={uploading}
            focusId={focusMessageId}
            onSend={handleSend}
            onUpload={handleUpload}
            onInvite={() => openModal("invite")}
            onApproveTool={approveTool}
            onDelete={() => deleteRoomById(activeRoom.id)}
            onProfile={openProfile}
            onBack={() => setMobilePane("list")}
          />
        ) : (
          <EmptyChat onNew={() => openModal("chat")} />
        )}
      </main>

      {modal === "chat" && (
        <NewChatModal
          agents={data?.agents ?? []}
          busy={busy}
          error={modalError}
          onClose={() => {
            if (!busy) setModal(null);
          }}
          onCreateDm={handleCreateDm}
          onCreateGroup={handleCreateGroup}
          onNewAgent={handleNewAgent}
        />
      )}

      {modal === "agent" && (
        <NewAgentModal
          templates={templates}
          busy={busy}
          error={modalError}
          onClose={() => {
            if (!busy) setModal(null);
          }}
          onCreateAgent={handleCreateAgent}
        />
      )}

      {modal === "team" && (
        <TeamModal
          teams={teams}
          templates={templates}
          busy={busy}
          error={modalError}
          onClose={() => {
            if (!busy) setModal(null);
          }}
          onCreate={handleCreateTeam}
        />
      )}

      {modal === "invite" && activeRoom && (
        <InviteModal
          room={activeRoom}
          agents={data?.agents ?? []}
          busy={busy}
          error={modalError}
          onClose={() => {
            if (!busy) setModal(null);
          }}
          onInvite={handleInvite}
        />
      )}

      {profile && (
        <ProfileModal
          profile={profile}
          onClose={() => setProfile(null)}
          onDm={
            profile.kind === "agent"
              ? (agentId) => {
                  setProfile(null);
                  handleCreateDm(agentId);
                }
              : null
          }
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
