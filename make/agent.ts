// A Muse model driving a Claude Agent SDK loop inside one game directory. Unattended, so every tool call goes
// through a guard: files only inside the directory (reads too, so .env and the rest of the machine stay out of
// reach), and Bash only for single commands that start with one of the allowed prefixes.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type CanUseTool, query } from "@anthropic-ai/claude-agent-sdk";

export const PRICES: Record<string, { input: number; cachedInput: number; output: number }> = {
  // Per million tokens, dev.meta.ai/docs/pricing-rate-limits.
  "muse-wonder-1.0": { input: 4, cachedInput: 0.2, output: 20 },
  "muse-spark-1.3": { input: 1.25, cachedInput: 0.15, output: 4.25 },
};

export interface AgentRun {
  model: string;
  ms: number;
  turns: number;
  usage: { input: number; cachedInput: number; output: number };
  summary: string;
}

export const costOf = (r: AgentRun): number => {
  const p = PRICES[r.model] ?? PRICES["muse-wonder-1.0"]!;
  return (r.usage.input * p.input + r.usage.cachedInput * p.cachedInput + r.usage.output * p.output) / 1e6;
};

export function createGuard(dir: string, bashOk: string[]): CanUseTool {
  const inside = (path: unknown) => typeof path === "string" && (resolve(dir, path) === dir || resolve(dir, path).startsWith(`${dir}/`));
  // One command, no chaining, redirection or substitution. Quotes are allowed (the cutout's sheet prompt).
  const plain = (cmd: string) => !/[;&|`<>]|\$\(/.test(cmd);
  return async (tool, input) => {
    if (tool === "Read" || tool === "Write" || tool === "Edit" || tool === "Glob" || tool === "Grep") {
      return inside(input.file_path ?? input.path ?? dir)
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: `Only files inside ${dir} are available.` };
    }
    if (tool === "Bash") {
      const cmd = String(input.command ?? "").trim();
      if (plain(cmd) && bashOk.some((p) => cmd === p.trim() || cmd.startsWith(p))) return { behavior: "allow", updatedInput: input };
      return { behavior: "deny", message: `Bash runs only single commands starting with: ${bashOk.join(" | ")}` };
    }
    return { behavior: "deny", message: `${tool} is not available.` };
  };
}

export async function runAgent(opts: {
  dir: string;
  model: string;
  system: string;
  prompt: string;
  bashOk: string[];
  // Writes <tag>.log and <tag>.json into dir.
  tag: string;
  effort?: "low" | "medium" | "high";
  onTool?: (name: string, input: unknown) => void;
}): Promise<AgentRun> {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) throw new Error("MODEL_API_KEY is not set");
  const started = performance.now();
  const usage = { input: 0, cachedInput: 0, output: 0 };
  let summary = "";
  let turns = 0;
  const log: string[] = [];
  for await (const m of query({
    prompt: opts.prompt,
    options: {
      model: opts.model,
      ...(opts.effort ? { effort: opts.effort } : {}),
      cwd: opts.dir,
      systemPrompt: opts.system,
      allowedTools: [],
      canUseTool: createGuard(opts.dir, opts.bashOk),
      permissionMode: "default",
      settingSources: [],
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: "https://api.meta.ai",
        ANTHROPIC_AUTH_TOKEN: apiKey,
        ANTHROPIC_MODEL: opts.model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: opts.model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: "muse-spark-1.3",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "muse-spark-1.3",
        CLAUDE_CODE_SUBAGENT_MODEL: "muse-spark-1.3",
      },
    },
  })) {
    if (m.type === "assistant") {
      turns++;
      for (const c of m.message.content) {
        if (c.type === "text") log.push(`text: ${c.text}`);
        if (c.type === "tool_use") {
          log.push(`tool ${c.name}: ${JSON.stringify(c.input).slice(0, 400)}`);
          opts.onTool?.(c.name, c.input);
        }
      }
    } else if (m.type === "result") {
      summary = m.subtype === "success" ? m.result : "";
      usage.input = m.usage.input_tokens + (m.usage.cache_creation_input_tokens ?? 0);
      usage.cachedInput = m.usage.cache_read_input_tokens ?? 0;
      usage.output = m.usage.output_tokens;
      log.push(`result ${m.subtype}`);
    }
  }
  const run = { model: opts.model, ms: Math.round(performance.now() - started), turns, usage, summary };
  writeFileSync(`${opts.dir}/${opts.tag}.log`, `${log.join("\n")}\n`);
  writeFileSync(`${opts.dir}/${opts.tag}.json`, JSON.stringify(run, null, 2));
  return run;
}
