const SYSTEM_CONFIG = {
  experiments: {
    // Aryn does not expose bb's experimental timeline-windowing preference.
    // Keep bb's default-off behavior until Aryn owns an equivalent setting.
    timelineWindowing: false,
  },
}

export function useSystemConfig() {
  return { data: SYSTEM_CONFIG }
}
