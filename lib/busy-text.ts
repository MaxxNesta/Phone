/** Whether a message is a limit's refusal (lib/heavy.ts): shown as "wait", not as a failure. */
export const isBusyText = (s: string) =>
  /^(Too many .* in the last minute|Another of these is already running)/.test(s);
