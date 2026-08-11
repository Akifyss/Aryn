import type { Root } from 'react-dom/client'

type DeferredUnmountRoot = Pick<Root, 'unmount'>

export function scheduleDeferredReactRootUnmount(root: DeferredUnmountRoot) {
  let didUnmount = false
  const unmount = () => {
    if (didUnmount) {
      return
    }

    didUnmount = true
    root.unmount()
  }

  // These secondary roots can be destroyed from a parent React tree cleanup.
  // Defer to avoid unmounting one root while React is committing another.
  globalThis.setTimeout(unmount, 0)
  return unmount
}
