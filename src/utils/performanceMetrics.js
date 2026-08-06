function normalizeDuration(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

export function createPerformanceMetrics(scope, { now = Date.now } = {}) {
  const startedAt = now();
  const counters = {};
  const timings = {};

  return {
    increment(name, value = 1) {
      counters[name] = (counters[name] || 0) + value;
      return counters[name];
    },

    async measure(name, run) {
      const start = now();
      try {
        return await run();
      } finally {
        timings[`${name}Ms`] = (timings[`${name}Ms`] || 0) + normalizeDuration(now() - start);
      }
    },

    summary() {
      return {
        scope,
        durationMs: normalizeDuration(now() - startedAt),
        counters: { ...counters },
        timings: { ...timings },
      };
    },
  };
}
