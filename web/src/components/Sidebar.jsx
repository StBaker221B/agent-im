import { useEffect, useMemo, useState } from "react";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { listTime, preview } from "../format";

function roomTitle(room) {
  if (room.kind !== "dm") return room.name;
  const peer = room.members?.find((m) => m.kind === "agent");
  return peer?.displayName || room.name;
}

export default function Sidebar({
  data,
  activeRoomId,
  view,
  connected,
  onSelectRoom,
  onNew,
  onAgents,
  onSettings,
  onSearch,
  onProfile,
  onDeleteRoom,
}) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(null);
  const agents = data?.agents ?? [];

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const filtered = useMemo(() => {
    const all = data?.rooms ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((room) =>
      `${roomTitle(room)} ${room.lastMessage?.text ?? ""} ${room.lastMessage?.displayName ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [data, query]);

  function openMenu(room, x, y) {
    setMenu({ room, x: Math.min(x, window.innerWidth - 170), y: Math.min(y, window.innerHeight - 60) });
  }

  return (
    <aside className="sidebar">
      <header className="side-head">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Agent IM</h1>
            <p>
              <span className={`conn-dot ${connected ? "ok" : "bad"}`} aria-hidden="true" />
              {connected ? "本地已连接" : "连接中断"}
            </p>
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onNew} title="新建会话" aria-label="新建会话">
          <Icon name="plus" />
        </button>
      </header>

      <div className="search">
        <Icon name="search" size={16} />
        <input
          name="room-search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) {
              e.preventDefault();
              onSearch(query.trim());
            }
          }}
          placeholder="搜索会话，回车搜消息"
          aria-label="搜索会话或消息"
        />
      </div>

      <div className="room-list" role="list">
        {filtered.map((room) => {
          const active = room.id === activeRoomId && view === "chat";
          const last = room.lastMessage;
          const peer = room.kind === "dm" ? room.members?.find((m) => m.kind === "agent") : null;
          return (
            <div className={`room-row${active ? " active" : ""}`} key={room.id} role="listitem">
              <button
                type="button"
                className={`room${active ? " active" : ""}`}
                onClick={() => onSelectRoom(room.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu(room, e.clientX, e.clientY);
                }}
              >
                <Avatar
                  name={peer?.name ?? room.name}
                  group={room.kind !== "dm"}
                  square={room.kind !== "dm"}
                  size={40}
                />
                <span className="room-body">
                  <span className="room-top">
                    <span className="room-name">{roomTitle(room)}</span>
                    <span className="room-time">{last ? listTime(last.createdAt) : ""}</span>
                  </span>
                  <span className="room-bottom">
                    <span className="room-preview">
                      {last
                        ? `${room.kind === "group" ? `${last.displayName || last.senderName}：` : ""}${preview(
                            last.msgtype === "m.image"
                              ? `[图片] ${last.text}`
                              : last.msgtype === "m.file"
                                ? `[文件] ${last.text}`
                                : last.text,
                          )}`
                        : "还没有消息"}
                    </span>
                    {room.unread > 0 && (
                      <span className="badge">{room.unread > 99 ? "99+" : room.unread}</span>
                    )}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="room-more"
                title="会话菜单"
                aria-label={`${roomTitle(room)} 的菜单`}
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  openMenu(room, rect.right - 150, rect.bottom + 4);
                }}
              >
                ⋯
              </button>
            </div>
          );
        })}

        {!filtered.length && (
          <div className="side-empty">
            {query ? "没有匹配的会话" : "还没有会话"}
            {!query && (
              <button type="button" onClick={onNew}>
                新建一个
              </button>
            )}
          </div>
        )}
      </div>

      <footer className="side-foot">
        <button type="button" className={`foot-item${view === "agents" ? " active" : ""}`} onClick={onAgents}>
          <Icon name="agent" size={17} />
          <span>Agents</span>
          <span className="foot-count">{agents.length}</span>
        </button>
        <button
          type="button"
          className={`foot-item${view === "settings" ? " active" : ""}`}
          onClick={onSettings}
        >
          <Icon name="settings" size={17} />
          <span>设置</span>
        </button>
        <button
          type="button"
          className="me"
          onClick={() =>
            onProfile({
              id: data?.human?.id,
              name: data?.human?.name,
              displayName: data?.human?.displayName,
              kind: "human",
            })
          }
          title="我的资料"
        >
          <Avatar name={data?.human?.displayName ?? "你"} size={30} />
          <span className="me-name">{data?.human?.displayName ?? "…"}</span>
          <span className="me-tag">你</span>
        </button>
      </footer>

      {menu && (
        <div
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          role="menu"
        >
          <button
            type="button"
            className="danger"
            role="menuitem"
            onClick={() => {
              const room = menu.room;
              setMenu(null);
              onDeleteRoom(room);
            }}
          >
            删除会话
          </button>
        </div>
      )}
    </aside>
  );
}
