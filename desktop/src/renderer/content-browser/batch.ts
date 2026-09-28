/** Run sequentially: moving one workflow may rewrite another selected file. */
export async function runContentBatch<T, R>(items: readonly T[], action: (item: T) => Promise<R>): Promise<{
  completed: { item: T; result: R }[];
  failed: { item: T; error: unknown }[];
}> {
  const completed: { item: T; result: R }[] = [];
  const failed: { item: T; error: unknown }[] = [];
  for (const item of items) {
    try { completed.push({ item, result: await action(item) }); }
    catch (error) { failed.push({ item, error }); }
  }
  return { completed, failed };
}
