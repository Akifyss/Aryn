type ClassValue =
  | false
  | ((...args: any[]) => string | undefined)
  | null
  | string
  | undefined
  | ClassValue[]
  | Record<string, boolean | null | undefined>

export function cn(...inputs: ClassValue[]) {
  const classes: string[] = []

  const collect = (value: ClassValue): void => {
    if (!value) return

    if (typeof value === "string") {
      classes.push(value)
      return
    }

    if (typeof value === "function") return

    if (Array.isArray(value)) {
      value.forEach(collect)
      return
    }

    Object.entries(value).forEach(([className, enabled]) => {
      if (enabled) classes.push(className)
    })
  }

  inputs.forEach(collect)
  return classes.join(" ")
}
