import { useEffect, useState } from "react";
import { api } from "../api";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { timeShort } from "../format";

function highlight(text, query) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts = [];
  let last = 0;
  let index = lower.indexOf(q);
  while (index >= 0) {
    if (index > last) parts.push(text.slice(last, index));
    parts.push(
      <mark key={index} className="search-hit">
        {text.slice(index, index + query.length)}
      </mark>,
    );
    last = index + query.length;
    index = lower.indexOf(q, last);
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function SearchView({ query, onSearch, onOpenResult, onBack }) {
  const [value, setValue] = useState(query);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deep, setDeep] = useState(false);
  const [scannedPages, setScannedPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setValue(query);
  }, [query]);

  useEffect(() => {
    if (!query) {
      setResults([]);
      setTotal(0);
      setHasMore(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    api
      .search(query, { deep })
      .then((res) => {
        if (alive) {
          setResults(res.results ?? []);
          setScannedPages(res.pages ?? (deep ? 5 : 1));
          setTotal(res.total ?? res.results?.length ?? 0);
          setHasMore(Boolean(res.hasMore));
        }
      })
      .catch((err) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [query, deep]);

  async function loadMore() {
    if (!query || !hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.search(query, { deep, offset: results.length, limit: 50 });
      setResults((prev) => {
        const seen = new Set(prev.map((item) => `${item.room.id}-${item.message.id}`));
        return [
          ...prev,
          ...(res.results ?? []).filter((item) => !seen.has(`${item.room.id}-${item.message.id}`)),
        ];
      });
      setTotal(res.total ?? total);
      setHasMore(Boolean(res.hasMore));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="search-view">
      <header className="view-head">
        <button type="button" className="icon-btn only-mobile" onClick={onBack} aria-label="返回会话列表">
          <Icon name="back" />
        </button>
        <div className="view-title">
          <h2>搜索消息</h2>
          <p>在最近的房间历史里查找</p>
        </div>
      </header>

      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(value.trim());
        }}
      >
        <Icon name="search" size={17} />
        <input
          name="message-search"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="输入关键词，回车搜索"
          autoFocus
          aria-label="搜索消息"
        />
        <label className="search-depth">
          <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
          深搜历史
        </label>
        <button type="submit" className="primary" disabled={!value.trim()}>
          搜索
        </button>
      </form>
      <p className="muted search-state">
        搜索每个房间最近 {scannedPages * 100} 条消息{deep ? "（深搜最多 500 条）" : "，勾选深搜可到 500 条"}。
        {query && ` 共 ${total} 条命中，已显示 ${results.length} 条。`}
      </p>

      {error && <p className="form-error">{error}</p>}
      {loading && <p className="muted search-state">搜索中…</p>}
      {!loading && query && !results.length && !error && (
        <p className="muted search-state">没有找到包含「{query}」的消息。</p>
      )}

      <div className="search-results">
        {results.map((result) => (
          <button
            type="button"
            className="search-result"
            key={`${result.room.id}-${result.message.id}`}
            onClick={() => onOpenResult(result.room.id, result.message.id)}
          >
            <Avatar name={result.message.senderName} size={34} />
            <span className="search-body">
              <span className="search-meta">
                <strong>{result.room.name}</strong>
                <span>
                  {result.message.displayName || result.message.senderName} ·{" "}
                  {timeShort(result.message.createdAt)}
                </span>
              </span>
              <span className="search-text">{highlight(result.message.text, query)}</span>
            </span>
          </button>
        ))}
      </div>

      {hasMore && (
        <div className="search-more">
          <button type="button" className="ghost" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? "加载中…" : "加载更多"}
          </button>
        </div>
      )}
    </section>
  );
}
