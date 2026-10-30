import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { t, tk } from "@shared/i18n";
import {
  Ban,
  Camera,
  Check,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  FilePen,
  FilePlus,
  FileText,
  Globe,
  ImageIcon,
  ListTodo,
  LoaderCircle,
  MessageCircleQuestion,
  MousePointerClick,
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
import { ToolImages } from "./ToolImages";
import { editOf, mcpTool, todosOf, toolKind, toolVerb, type Todo, type ToolKind } from "@/lib/activity";

const ICONS: Record<ToolKind, LucideIcon> = {
  read: FileText,
  write: FilePlus,
  edit: FilePen,
  command: SquareTerminal,
  search: Search,
  web: Globe,
  browser: MousePointerClick,
  screenshot: Camera,
  image: ImageIcon,
  agent: Users,
  todo: ListTodo,
  question: MessageCircleQuestion,
  other: Wrench,
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
            // Long MCP tool names would push the card wider than the panel.
            className="max-w-full min-w-0"
            title={
              shell
                ? t("Allows this exact command until the session ends")
                : t("Allows {tool} until the session ends", { tool: tool.name })
            }
            onClick={() => void answer(approval.requestId, "allow-session")}
          >
            <span className="truncate">
              {shell
                ? t("Allow this command for the session")
                : t("Allow {tool} for the session", { tool: tool.name })}
            </span>
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setDenying(true)}>
            {t("Deny…")}
          </Button>
        </div>
      )}
    </motion.div>
  );
}

type ToolCardProps = { tool: ToolItem; cwd: string; ended: boolean; sessionId: string };

/** A tool call, or the questions it asks the user. */
export function ToolCard(props: ToolCardProps) {
  if (props.tool.questions) return <QuestionCard tool={props.tool} />;
  if (props.tool.name === "TodoWrite") {
    const todos = todosOf(props.tool.input);
    if (todos) return <TodoCard todos={todos} />;
  }
  return <ToolCallCard {...props} />;
}

/** The agent's to-do list, as a checklist. */
function TodoCard({ todos }: { todos: Todo[] }) {
  const done = todos.filter((todo) => todo.status === "completed").length;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs" data-tool="TodoWrite">
      <p className="mb-1.5 flex items-center gap-1.5 font-medium">
        <ListTodo className="size-3.5 text-muted-foreground" />
        {t("To-do list")}
        <span className="font-normal text-muted-foreground">
          {t("{done} of {total} done", { done, total: todos.length })}
        </span>
      </p>
      <ul className="space-y-1">
        {todos.map((todo, i) => (
          <li key={i} className="flex items-start gap-2">
            {todo.status === "completed" ? (
              <CircleCheck className="mt-px size-3.5 shrink-0 text-success" />
            ) : todo.status === "in_progress" ? (
              <LoaderCircle className="mt-px size-3.5 shrink-0 animate-spin text-primary" />
            ) : (
              <Circle className="mt-px size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span
              className={cn(
                todo.status === "completed" && "text-muted-foreground line-through",
                todo.status === "in_progress" && "font-medium",
              )}
            >
              {todo.status === "in_progress" ? todo.activeForm : todo.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Removed lines in red, added in green: what an edit changes. */
function EditDiff({ edits }: { edits: Array<{ before: string; after: string }> }) {
  const lines = (text: string, sign: "-" | "+") =>
    text.split("\n").map((line, j) => (
      <div
        key={`${sign}${j}`}
        className={cn(
          "px-2 whitespace-pre-wrap",
          sign === "-" ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success",
        )}
      >
        <span className="select-none">{sign} </span>
        {line}
      </div>
    ));
  return (
    <div className="max-h-72 space-y-1.5 overflow-auto rounded border bg-muted/40 font-mono text-[11px] leading-snug">
      {edits.map((edit, i) => (
        <div key={i}>
          {edit.before && lines(edit.before, "-")}
          {lines(edit.after, "+")}
        </div>
      ))}
    </div>
  );
}

function ToolCallCard({ tool, cwd, ended, sessionId }: ToolCardProps) {
  const state = toolState(tool, ended);
  const [open, setOpen] = useState(false);
  const kind = toolKind(tool.name);
  const Icon = ICONS[kind];
  const summary = describeTool(tool.name, tool.input, cwd);
  const mcp = mcpTool(tool.name);
  // MCP tools Clyde does not know read as `server › tool`.
  const verb = kind === "other" && mcp ? `${mcp.server} › ${mcp.tool}` : kind === "other" ? tool.name : toolVerb(tool.name);
  const edits = kind === "edit" || kind === "write" ? editOf(tool.name, tool.input) : null;
  const command = kind === "command" && typeof tool.input["command"] === "string" ? (tool.input["command"] as string) : null;
  const images = tool.result?.images ?? [];

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
        <span className="shrink-0 font-medium" title={tool.name}>{verb}</span>
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
      {/* Screenshots stay in sight: they are what the agent saw. */}
      <ToolImages sessionId={sessionId} images={images} className="border-t px-2.5 py-2" />
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
              {command !== null ? (
                <pre className="max-h-48 overflow-auto rounded bg-muted/60 px-2 py-1.5 font-mono text-[11px] leading-snug whitespace-pre-wrap">
                  <span className="text-muted-foreground select-none">$ </span>
                  {command}
                </pre>
              ) : edits ? (
                <EditDiff edits={edits} />
              ) : (
                <pre className="max-h-48 overflow-auto font-mono text-[11px] leading-snug whitespace-pre-wrap text-muted-foreground">
                  {JSON.stringify(tool.input, null, 2)}
                </pre>
              )}
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
