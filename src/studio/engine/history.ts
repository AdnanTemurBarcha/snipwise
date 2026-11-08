export interface Command {
  label: string;
  do(): void;
  undo(): void;
  /** Absorb `next` into this command (e.g. slider scrubbing). Return true if merged. */
  merge?(next: Command): boolean;
}

export class BatchCommand implements Command {
  constructor(public label: string, private cmds: Command[]) {}
  do() {
    for (const c of this.cmds) c.do();
  }
  undo() {
    for (let i = this.cmds.length - 1; i >= 0; i--) this.cmds[i].undo();
  }
  get size() {
    return this.cmds.length;
  }
}

/** Linear undo/redo with merge support and a bounded depth. */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<() => void>();
  private lastPushAt = 0;

  constructor(private limit = 300, private mergeWindowMs = 800, private now = () => Date.now()) {}

  /** Run `cmd` and record it. */
  execute(cmd: Command): void {
    cmd.do();
    this.record(cmd);
  }

  /** Record a command whose effect has already been applied (live drags). */
  record(cmd: Command): void {
    const t = this.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (top?.merge && t - this.lastPushAt <= this.mergeWindowMs && top.merge(cmd)) {
      // merged into top
    } else {
      this.undoStack.push(cmd);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.lastPushAt = t;
    this.redoStack = [];
    this.emit();
  }

  /** Stop the next command from merging into the previous one. */
  breakMerge(): void {
    this.lastPushAt = 0;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get undoLabel() {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }
  get redoLabel() {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }
  get entries(): string[] {
    return this.undoStack.map((c) => c.label);
  }

  undo(): Command | null {
    const c = this.undoStack.pop();
    if (!c) return null;
    c.undo();
    this.redoStack.push(c);
    this.lastPushAt = 0;
    this.emit();
    return c;
  }

  redo(): Command | null {
    const c = this.redoStack.pop();
    if (!c) return null;
    c.do();
    this.undoStack.push(c);
    this.lastPushAt = 0;
    this.emit();
    return c;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((f) => f());
  }
}
