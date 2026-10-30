import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { t, tk } from "@shared/i18n";
import {
  Ban,
  Check,
  ChevronRight,
  CircleAlert,
  FilePen,
  FileText,
  Globe,
  ListTodo,
  LoaderCircle,
  MessageCircleQuestion,
  Search,
  ShieldQuestion,
  SquareTerminal,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describeTool, toolState, type ToolItem } from "@/lib/transcript";
import { useAgents } from "@/stores/agents";
import { cn } from "@/lib/utils";
import { attention, duration, ease, iconSwap, shake } from "@/lib/motion";
import { QuestionCard } from "./QuestionCard";

const ICONS: Record<string, LucideIcon> = {
  Bash: SquareTerminal,
  PowerShell: SquareTerminal,
  Monitor: SquareTerminal,
  Read: FileText,
  Write: FilePen,
  Edit: FilePen,
  MultiEdit: FilePen,
  NotebookEdit: FilePen,
  Glob: Search,
  Grep: Search,
  WebFetch: Globe,
  WebSearch: Globe,
  Agent: Users,
  Task: Users,
  TodoWrite: ListTodo,
  run_command: SquareTerminal,
  read_file: FileText,
  write_file: FilePen,
  edit_file: FilePen,
  list_files: Search,
  AskUserQuestion: MessageCircleQuestion,
  ask_user: MessageCircleQuestion,
};

const DECISION_LABEL = {
  "allow-once": tk("Allowed once"),
  "allow-session": tk("Allowed for this session"),
  deny: tk("Denied"),
  cancelled: tk("Cancelled"),
} as const;

function Approval({ tool }: { tool: ToolItem }) {
  const answer = useAgents((s) => s.answer);
  const [denying, setDenying] = useState(false);
  const [message, setMessage] = useState("");
  const approval = tool.approval;
  if (!approval) return null;
  const shell = ["Bash", "PowerShell", "Monitor", "run_command"].includes(
    tool.name,
  );

  if (approval.state !== "pending") {
    return (
      <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        {t(DECISION_LABEL[approval.state])}
      </p>
    );
  }
  return (
    <motion.div
      variants={attention}
      initial="hidden"
      animate="shown"
      className="approval-glow space-y-2 border-t border-warning/40 bg-warning/10 px-3 py-2.5"
      role="group"
      aria-label={t("Approval request")}
    >
      <p className="flex items-start gap-1.5 text-xs">
        <ShieldQuestion className="mt-px size-3.5 shrink-0 text-warning" />
        <span>{approval.reason}</span>
      </p>
      {denying ? (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void answer(approval.requestId, "deny", message);
          }}
        >
          <Input
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("Tell the agent what to do instead (optional)")}
            className="h-7 text-xs"
          />
          <Button type="submit" size="xs" variant="destructive">
            {t("Deny")}
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="xs"
            onClick={() => void answer(approval.requestId, "allow-once")}
          >
            {t("Allow once")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            title={
              shell
                ? t("Allows this exact command until the session ends")
                : t("Allows {tool} until the session ends", { tool: tool.name })
            }
            onClick={() => void answer(approval.requestId, "allow-session")}
          >
            {shell
              ? t("Allow this command for the session")
              : t("Allow {tool} for the session", { tool: tool.name })}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setDenying(true)}>
            {t("Deny…")}
          </Button>
        </div>
      )}
    </motion.div>
  );
}

/** `mcp__github__search` reads as `github › search`. */
function displayName(name: string): string {
  const mcp = /^mcp__([^_]+(?:[-_][^_]+)*?)__(.+)$/.exec(name);
  return mcp ? `${mcp[1]} › ${mcp[2]}` : name;
}

type ToolCardProps = { tool: ToolItem; cwd: string; ended: boolean };

/** A tool call, or the questions it asks the user. */
export function ToolCard(props: ToolCardProps) {
  return props.tool.questions ? (
    <QuestionCard tool={props.tool} />
  ) : (
    <ToolCallCard {...props} />
  );
}

function ToolCallCard({ tool, cwd, ended }: ToolCardProps) {
  const state = toolState(tool, ended);
  const [open, setOpen] = useState(false);
  const Icon = ICONS[tool.name] ?? Wrench;
  const summary = describeTool(tool.name, tool.input, cwd);

  return (
    <motion.div
      // Mounting in the error state (a loaded history) does not shake; turning into it does.
      initial={false}
      animate={state === "error" ? shake : { x: 0 }}
      className={cn(
        "overflow-hidden rounded-lg border bg-card text-xs transition-colors duration-200",
        tool.parentToolUseId && "ml-4",
        state === "running" && "shimmer",
        state === "awaiting" && "border-warning/60",
        state === "error" && "border-destructive/40",
      )}
      data-tool={tool.name}
      data-state={state}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="press-soft press flex w-full items-center gap-2 px-2.5 py-1.5 text-left outline-none hover:bg-accent/50 focus-visible:bg-accent/60"
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">{displayName(tool.name)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {summary}
        </span>
        <span className="relative grid size-3.5 shrink-0 place-items-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={state}
              variants={iconSwap}
              initial="hidden"
              animate="shown"
              exit="gone"
              className="absolute inset-0"
            >
              <StateIcon state={state} />
            </motion.span>
          </AnimatePresence>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: "auto",
              opacity: 1,
              transition: { duration: duration.base, ease: ease.out },
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: { duration: duration.fast, ease: ease.out },
            }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t px-3 py-2">
              <pre className="max-h-48 overflow-auto font-mono text-[11px] leading-snug whitespace-pre-wrap text-muted-foreground">
                {JSON.stringify(tool.input, null, 2)}
              </pre>
              {tool.denied && (
                <p className="text-[11px] text-muted-foreground">
                  {t("Refused: {reason}", { reason: tool.denied })}
                </p>
              )}
              {tool.result && (
                <pre
                  className={cn(
                    "max-h-64 overflow-auto rounded border bg-muted/50 px-2 py-1.5 font-mono text-[11px] leading-snug whitespace-pre-wrap",
                    tool.result.isError &&
                      "border-destructive/40 text-destructive",
                  )}
                >
                  {tool.result.content || t("(no output)")}
                </pre>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <Approval tool={tool} />
    </motion.div>
  );
}

function StateIcon({ state }: { state: ReturnType<typeof toolState> }) {
  switch (state) {
    case "running":
      return (
        <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
      );
    case "done":
      return <Check className="size-3.5 text-success" />;
    case "error":
      return <CircleAlert className="size-3.5 text-destructive" />;
    case "denied":
      return <Ban className="size-3.5 text-muted-foreground" />;
    case "awaiting":
      return <ShieldQuestion className="size-3.5 text-warning" />;
  }
  return null;
}
