export default function Icon({ name, size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  switch (name) {
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="m4 12 15-7-4.5 15-3.2-6.2L4 12Z" />
          <path d="m11.3 13.8 3.2-3.2" />
        </svg>
      );
    case "back":
      return (
        <svg {...common}>
          <path d="m14.5 5-7 7 7 7" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19c.6-3.2 2.7-5 5.5-5s4.9 1.8 5.5 5" />
          <path d="M16 5.5a3 3 0 0 1 0 5.8M17.5 14c2 .4 3.3 2 3.8 4.4" />
        </svg>
      );
    case "agent":
      return (
        <svg {...common}>
          <rect x="5" y="7.5" width="14" height="11" rx="2.5" />
          <path d="M12 7.5V4.5M9 4.5h6" />
          <circle cx="9.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="14.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
          <path d="M9.5 16h5" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case "paperclip":
      return (
        <svg {...common}>
          <path d="M20 11.5 12.3 19a4.5 4.5 0 0 1-6.4-6.4l7.6-7.6a3 3 0 0 1 4.2 4.2l-7.5 7.5a1.5 1.5 0 0 1-2.1-2.1l6.8-6.8" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M4 7h16M9 7V5h6v2M6.5 7l.8 12h9.4l.8-12M10 11v5M14 11v5" />
        </svg>
      );
    default:
      return null;
  }
}
