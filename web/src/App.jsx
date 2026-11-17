import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import AgentsView from "./components/AgentsView";
import AgentSettingsView from "./components/AgentSettingsView";
import ActivityView from "./components/ActivityView";
import TasksView from "./components/TasksView";
import TaskModal from "./components/TaskModal";
import NewChatModal from "./components/NewChatModal";
import NewAgentModal from "./components/NewAgentModal";
import TeamModal from "./components/TeamModal";
import IntakeModal from "./components/IntakeModal";
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
  const [settingsAgentId, setSettingsAgentId] = useState(null);
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
  const [notifications, setNotifications] = useState(
    () =>
      localStorage.getItem("agentim.notifications") === "1" &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted",
  );

  const markKeyRef = useRef("");
  const toastRef = useRef({ msg: "", at: 0 });
  const notifiedRef = useRef(null);

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
          next.doneAt = null;
        } else if (event.type === "text_delta") {
          next.text = (next.text ?? "") + event.text;
          next.active = true;
        } else if (event.type === "tool_use") {
          next.tools = [...(next.tools ?? []), { name: event.name, input: event.input }];
          next.active = true;
        } else if (event.type === "turn_end") {
          next.text = event.text || next.text;
          next.active = false;
          next.doneAt = Date.now();
        } else if (event.type === "skip") {
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
    const timer = setInterval(() => {
      setLive((prev) => {
        const now = Date.now();
        let changed = false;
        const next = { ...prev };
        for (const [key, item] of Object.entries(prev)) {
          if (item.doneAt && now - item.doneAt > 2200) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 700);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!notifications || !data || !document.hidden) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const candidates = data.rooms.filter(
      (room) => room.unread > 0 && room.lastMessage && room.lastMessage.sender !== data.human.id,
    );
    if (!candidates.length) return;
    const latest = [...candidates].sort(
      (a, b) => (b.lastMessage.createdAt ?? 0) - (a.lastMessage.createdAt ?? 0),
    )[0];
    if (notifiedRef.current === latest.lastMessage.id) return;
    notifiedRef.current = latest.lastMessage.id;
    try {
      new Notification(latest.name, {
        body: `${latest.lastMessage.displayName || latest.lastMessage.senderName}: ${String(
          latest.lastMessage.text ?? "",
        ).slice(0, 140)}`,
        tag: latest.id,
      });
    } catch {
      // notification permission may have been revoked
    }
  }, [data, notifications]);

  async function toggleNotifications() {
    if (notifications) {
      setNotifications(false);
      localStorage.setItem("agentim.notifications", "0");
      notify("桌面通知已关闭");
      return;
    }
    if (typeof Notification === "undefined") {
      notify("当前浏览器不支持桌面通知");
      return;
    }
    const permission = await Notification.requestPermission();
    const enabled = permission === "granted";
    setNotifications(enabled);
    localStorage.setItem("agentim.notifications", enabled ? "1" : "0");
    notify(enabled ? "桌面通知已开启" : "未获得通知权限");
  }

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
      } else if (/^\/agents\/.+\/settings$/.test(path)) {
        setSettingsAgentId(decodeURIComponent(path.split("/")[2] ?? ""));
        setView("agent-settings");
        setMobilePane("chat");
      } else if (path === "/agents") {
        setView("agents");
        setMobilePane("chat");
      } else if (path === "/settings") {
        setView("settings");
        setMobilePane("chat");
      } else if (path === "/activity") {
        setView("activity");
        setMobilePane("chat");
      } else if (path === "/tasks") {
        setView("tasks");
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

  function openActivity() {
    setView("activity");
    setMobilePane("chat");
    setHash("#/activity");
  }

  function openTasks() {
    setView("tasks");
    setMobilePane("chat");
    setHash("#/tasks");
  }

  function openAgentSettings(agentId) {
    setSettingsAgentId(agentId);
    setView("agent-settings");
    setMobilePane("chat");
    setHash(`#/agents/${encodeURIComponent(agentId)}/settings`);
  }

  function backToAgents() {
    setView("agents");
    setMobilePane("chat");
    setHash("#/agents");
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

  async function approveRoom(message) {
    const spec = message?.room;
    if (!spec) return;
    const requester = message.sender;
    const agentIds = [...new Set([requester, ...(spec.agentIds ?? [])])];
    const name = spec.name || (spec.kind === "dm" ? "私聊" : "群聊");
    try {
      const res = await api.createGroup(name, agentIds);
      await loadBootstrap();
      openRoom(res.room.id);
    } catch (err) {
      notify(err.message);
    }
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

  async function pauseAll(paused) {
    if (paused && !window.confirm("暂停所有 agent？当前轮会结束，下一轮不再跑；可随时恢复。")) return;
    try {
      await api.pauseAll(paused);
      await loadBootstrap();
      notify(paused ? "所有 agent 已暂停" : "所有 agent 已恢复");
    } catch (err) {
      notify(err.message);
    }
  }

  async function deleteAgentById(agentId) {
    if (!window.confirm("删除这个 agent？它会退出所有房间并从列表隐藏；Matrix 历史保留，账号不回收。")) {
      return;
    }
    try {
      await api.deleteAgent(agentId);
      setActiveRoomId(null);
      setMessages([]);
      markKeyRef.current = "";
      await loadBootstrap();
      backToAgents();
      notify("agent 已删除");
    } catch (err) {
      notify(err.message);
    }
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

  async function handleSend(text, replyTo = null) {
    if (!activeRoomId) return false;
    try {
      const res = await api.send(activeRoomId, text, replyTo);
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

  const handleIntake = (problem) =>
    runModal(async () => {
      const res = await api.intake(problem);
      await loadBootstrap();
      openRoom(res.room.id);
    });

  const handleCreateTask = (payload) =>
    runModal(async () => {
      await api.createTask(payload);
      setModal(null);
      setView("tasks");
      setMobilePane("chat");
      setHash("#/tasks");
    });

  const handleInvite = (agentIds) =>
    runModal(async () => {
      if (!activeRoomId) return;
      await api.invite(activeRoomId, agentIds);
      await loadBootstrap();
      setModal(null);
    });

  async function handleRemoveMember(agentId) {
    if (!activeRoomId) return;
    try {
      await api.removeMember(activeRoomId, agentId);
      await loadBootstrap();
      notify("成员已移除");
    } catch (err) {
      notify(err.message);
    }
  }

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
        onActivity={openActivity}
        onTasks={openTasks}
        onSearch={openSearch}
        onProfile={openProfile}
        onDeleteRoom={deleteRoomFromList}
      />

      <main className="main" id="main" tabIndex={-1}>
        {view === "agent-settings" ? (
          <AgentSettingsView
            agent={settingsAgentId ? agentsById.get(settingsAgentId) : null}
            templates={templates}
            onSave={saveAgent}
            onDelete={deleteAgentById}
            onBack={backToAgents}
          />
        ) : view === "activity" ? (
          <ActivityView data={data} onBack={() => setMobilePane("list")} />
        ) : view === "tasks" ? (
          <TasksView
            data={data}
            onNew={() => openModal("task")}
            onOpenRoom={openRoom}
            onBack={() => setMobilePane("list")}
          />
        ) : view === "agents" ? (
          <AgentsView
            agents={data?.agents ?? []}
            onNew={() => openModal("agent")}
            onNewTeam={() => openModal("team")}
            onIntake={() => openModal("intake")}
            onDm={handleCreateDm}
            onConfigure={openAgentSettings}
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
            notifications={notifications}
            onToggleNotifications={toggleNotifications}
            onPauseAll={pauseAll}
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
            onApproveRoom={approveRoom}
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

      {modal === "intake" && (
        <IntakeModal
          busy={busy}
          error={modalError}
          onClose={() => {
            if (!busy) setModal(null);
          }}
          onSubmit={handleIntake}
        />
      )}

      {modal === "task" && (
        <TaskModal
          agents={data?.agents ?? []}
          rooms={data?.rooms ?? []}
          busy={busy}
          error={modalError}
          onClose={() => {
            if (!busy) setModal(null);
          }}
          onCreate={handleCreateTask}
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
          onRemove={handleRemoveMember}
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
          onConfigure={
            profile.kind === "agent"
              ? (agentId) => {
                  setProfile(null);
                  openAgentSettings(agentId);
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
