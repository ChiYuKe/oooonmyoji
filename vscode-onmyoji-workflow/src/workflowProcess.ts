/** Pure helpers for launching workflow runs without shell command construction. */

export function buildWorkflowRunArguments(
  configPath: string,
  workflowReference: string,
  instance: string,
  eventsFile: string,
): string[] {
  return [
    '-m',
    'src.oooonmyoji.cli',
    '--config',
    configPath,
    'run-workflow',
    workflowReference,
    '--instance',
    instance,
    '--events-file',
    eventsFile,
  ];
}

export function missingWorkflowInstances(
  runs: Array<{ instance: string }>,
  available: Array<{ id: string }>,
): string[] {
  const availableIds = new Set(available.map((item) => item.id));
  return [...new Set(runs.map((run) => run.instance).filter((instance) => !availableIds.has(instance)))];
}

export function buildPartySoulsRunArguments(
  configPath: string,
  leaderInstance = 'mumu-0',
  memberInstance = 'mumu-1',
  rounds = 9999,
  leaderEventsFile?: string,
  memberEventsFile?: string,
): string[] {
  const args = [
    '-m',
    'src.oooonmyoji.cli',
    '--config',
    configPath,
    'run-party-souls',
    '--leader-instance',
    leaderInstance,
    '--member-instance',
    memberInstance,
    '--rounds',
    String(rounds),
  ];
  if (leaderEventsFile) args.push('--leader-events-file', leaderEventsFile);
  if (memberEventsFile) args.push('--member-events-file', memberEventsFile);
  return args;
}
