/** Runs `fn` with console.log/error/warn captured: log → stdout, error and warn → stderr. */
export async function captureConsole(
  fn: () => Promise<number>
): Promise<{ code: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const [log, error, warn] = [console.log, console.error, console.warn];
  console.log = (...a: unknown[]) => out.push(a.join(" "));
  console.error = (...a: unknown[]) => err.push(a.join(" "));
  console.warn = (...a: unknown[]) => err.push(a.join(" "));
  try {
    const code = await fn();
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    [console.log, console.error, console.warn] = [log, error, warn];
  }
}
