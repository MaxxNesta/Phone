/**
 * A circuit breaker for an outside service.
 *
 * After `failures` failures in a row the circuit opens: calls fail at once,
 * without waiting on a service that is down, for `coolMs`. Then one call is
 * let through to try it; success closes the circuit, failure opens it again.
 *
 * Per server instance, in memory. That is enough for its job, which is to
 * stop one broken service holding every request open until it times out.
 */
export class CircuitOpenError extends Error {
  constructor(name: string, retryInMs: number) {
    super(`${name} is not responding. Try again in ${Math.ceil(retryInMs / 1000)} seconds.`);
    this.name = "CircuitOpenError";
  }
}

export function breaker(name: string, { failures = 3, coolMs = 30_000, now = () => Date.now() } = {}) {
  let streak = 0;
  let openedAt: number | null = null;
  let trial = false;

  return async function call<T>(fn: () => Promise<T>): Promise<T> {
    if (openedAt !== null) {
      const waited = now() - openedAt;
      if (waited < coolMs || trial) throw new CircuitOpenError(name, Math.max(0, coolMs - waited));
      trial = true; // half-open: this one call tries the service
    }
    try {
      const out = await fn();
      streak = 0; openedAt = null; trial = false;
      return out;
    } catch (e) {
      streak += 1;
      if (trial || streak >= failures) openedAt = now();
      trial = false;
      throw e;
    }
  };
}
