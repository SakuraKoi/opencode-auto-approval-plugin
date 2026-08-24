export const reviewerAgentName = "auto-approval-reviewer";

export const reviewerTools = {
  read: true,
  glob: true,
  grep: true,
  lsp: true,
};

export function reviewerAgent(): Record<string, unknown> {
  return {
    description: "Read-only reviewer for auto-approval decisions.",
    mode: "subagent",
    prompt:
      "You are a security reviewer. You may inspect the workspace only through read, glob, grep, and lsp. Never modify files, run shell commands, access the network, use MCP tools, or delegate work.",
    tools: reviewerTools,
    permission: {
      "*": "deny",
      read: "allow",
      glob: "allow",
      grep: "allow",
      lsp: "allow",
      edit: "deny",
      bash: "deny",
      task: "deny",
      skill: "deny",
      webfetch: "deny",
      websearch: "deny",
      question: "deny",
      external_directory: "deny",
    },
  };
}
