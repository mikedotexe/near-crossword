// Adapters must honor cancellation. An ambiguous signer timeout still retains its DB allocation.
export async function bounded<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => run(controller.signal)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("Adapter deadline exceeded")); }, timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
