import { useEffect, useRef } from "react";

/**
 * Focus the first field in a dialog, trap Tab inside it, close on Escape and
 * return focus to the trigger on unmount.
 */
export function useDialogFocus(onClose) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement;

    const focusables = () =>
      [
        ...root.querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((node) => node.offsetParent !== null || node === document.activeElement);

    const preferred = root.querySelector(
      "input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
    );
    (preferred ?? focusables()[0])?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);

  return ref;
}
