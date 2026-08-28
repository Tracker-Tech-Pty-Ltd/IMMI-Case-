import { useEffect, useState } from "react";

/**
 * Returns `value` delayed by `delayMs`. The returned value only updates once
 * `value` has stopped changing for `delayMs`. Used to keep high-frequency
 * input state (typing) from driving expensive work (network queries, full
 * document re-renders) on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
