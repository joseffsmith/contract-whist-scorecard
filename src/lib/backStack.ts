import { useEffect, useRef } from "react";

// Open sheets, innermost last. The Android back button (nativeImpl.ts) closes
// the top one before it navigates anywhere.
const layers: { current: () => void }[] = [];

// Call from a component that is a dismissable layer while it's mounted.
export function useBackClose(close: () => void) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    layers.push(ref);
    return () => {
      const i = layers.indexOf(ref);
      if (i !== -1) layers.splice(i, 1);
    };
  }, []);
}

// Closes the top layer; false when none is open.
export function closeTopLayer(): boolean {
  const top = layers[layers.length - 1];
  if (!top) return false;
  top.current();
  return true;
}
