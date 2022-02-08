import { useRef } from 'react'

export function useInstance<T>(instanceFunc: () => T) {
  const ref = useRef<T | null>(null)
  if (ref.current === null) {
    ref.current = instanceFunc()
  }
  return ref.current
}
