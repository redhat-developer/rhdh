/** Provider-specific actions for one runtime fixture teardown. */
export interface RuntimeTeardown {
  /** Names the target in error messages, e.g. `rds slot 1`. */
  label: string;
  /** Error caught from setup or the test body; reported before any cleanup error. */
  setupError: unknown;
  redact: (text: string) => string;
  progress: { run<T>(phase: string, action: () => Promise<T>): Promise<T> };
  collectDiagnostics: () => Promise<void>;
  stopApplication: () => Promise<void>;
  closeSqlClients: () => Promise<void>;
  /** Omit when no admin connection path was ever established. */
  dropDatabases?: () => Promise<void>;
  reportCleanup: (completed: boolean) => Promise<void>;
  /** Cloud SQL only: the proxy lives in the namespace and must outlive the drop. */
  closeProxy?: () => Promise<void>;
  deleteNamespace: () => Promise<void>;
}

function redactedError(error: unknown, redact: (text: string) => string): Error {
  // Report-only copies keep raw causes, nested aggregates, and custom properties private.
  const reported = new Error(redact(error instanceof Error ? error.message : String(error)));
  if (error instanceof Error) {
    reported.name = redact(error.name);
    reported.stack = redact(error.stack ?? String(error));
  }
  return reported;
}

/** One teardown order for every runtime provider; a failed step never skips a later one. */
export async function teardownRuntime(steps: RuntimeTeardown): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (phase: string, action?: () => Promise<void>): Promise<boolean> => {
    if (action === undefined) return false;
    try {
      await steps.progress.run(phase, action);
      return true;
    } catch (error) {
      errors.push(error);
      return false;
    }
  };
  // Capture application and proxy evidence, even after a setup failure, before deleting it.
  await attempt("diagnostics", steps.collectDiagnostics);
  const stopped = await attempt("stop-application", steps.stopApplication);
  await attempt("close-sql-clients", steps.closeSqlClients);
  // A live writer would recreate what is dropped; a later run on the slot retires leftovers.
  const dropped = stopped && (await attempt("drop-databases", steps.dropDatabases));
  try {
    await steps.reportCleanup(dropped);
  } catch (error) {
    errors.push(error);
  }
  await attempt("close-proxy", steps.closeProxy);
  await attempt("delete-namespace", steps.deleteNamespace);

  const { setupError } = steps;
  if (errors.length > 0) {
    const all = (setupError === undefined ? errors : [setupError, ...errors]).map((error) =>
      redactedError(error, steps.redact),
    );
    throw new AggregateError(all, `${steps.label} failed: ${all.map(String).join("; ")}`);
  }
  if (setupError !== undefined) {
    throw setupError instanceof Error
      ? redactedError(setupError, steps.redact)
      : new Error(`${steps.label} setup failed`);
  }
}
