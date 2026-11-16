import { colorFor, initial } from "../format";

export default function Avatar({ name, size = 38, square = false, group = false }) {
  const color = colorFor(name);
  return (
    <span
      className={`avatar${square ? " square" : ""}`}
      style={{ "--avatar-color": color, width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {group ? "群" : initial(name)}
    </span>
  );
}
