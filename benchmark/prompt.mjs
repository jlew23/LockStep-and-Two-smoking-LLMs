// The text every contender receives. Same task text and requirements for all three;
// the LockStep condition only adds the process directive from the LockStep README.

const FORMAT = 'Work only inside the current directory and do not ask questions. When you are finished, end your reply with exactly one line of JSON, with no code fence: {"status":"done"|"partial"|"blocked","summary":"one sentence"}. Use "done" only if every requirement is met. If you could not meet all of them, use "partial" or "blocked" and say why in the summary.'

/** checks: tell the agent to add machine-checkable `checks` (only LockStep versions that support them). */
export function buildPrompt(task, { lockstep = false, taskId = task.id, checks = true } = {}) {
  const requirements = task.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')
  let text = `${task.prompt}\n\nRequirements:\n${requirements}\n\n${FORMAT}`
  if (lockstep) {
    const withChecks = checks ? ' and, for every claim about a file, add checks (exists, equals, contains, size, sha256 or hex)' : ''
    text += `\n\ntask_id: ${taskId}\nProcess: before planning, call find_playbooks_v1 and recent_lessons_v1. When you finish, call submit_worker_report_v1 with one criterion per requirement above (copied exactly)${withChecks}. Then call submit_verdict_v1 grading every criterion, and call read_task_report_v1. Your final reply must still end with the JSON line described above.`
  }
  return text
}
