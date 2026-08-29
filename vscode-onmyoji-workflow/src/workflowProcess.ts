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

