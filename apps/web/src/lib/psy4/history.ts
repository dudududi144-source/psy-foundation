/**
 * Undo/Redo History — command pattern for reversible parameter changes.
 *
 * Every commercial DAW/synth has Ctrl-Z. Without it, users fear experimentation.
 * This implements a standard command pattern with bounded history.
 *
 * Usage:
 *   const history = new HistoryManager()
 *   history.execute({ type: 'setCutoff', oldValue: 3000, newValue: 4200, undo: () => set(3000), redo: () => set(4200) })
 *   history.undo()  // reverts to 3000
 *   history.redo()  // re-applies 4200
 *
 * Keyboard: Ctrl-Z (undo), Ctrl-Y / Ctrl-Shift-Z (redo)
 */

export interface Command {
  type: string // e.g. 'setCutoff', 'loadPreset'
  description: string // human-readable for UI: "Set Cutoff to 4200"
  undo: () => void // revert the change
  redo: () => void // re-apply the change
  timestamp: number // when executed
}

export class HistoryManager {
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private maxHistory = 100 // bounded history to prevent memory growth
  private listeners: Set<() => void> = new Set()

  /** Execute a command and push to undo stack */
  execute(cmd: Omit<Command, 'timestamp'>): void {
    const fullCmd: Command = { ...cmd, timestamp: Date.now() }
    fullCmd.redo() // apply the change
    this.undoStack.push(fullCmd)
    // Clear redo stack (new action invalidates redo history)
    this.redoStack = []
    // Enforce max history
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift()
    }
    this.notifyListeners()
  }

  /** Undo the last command */
  undo(): boolean {
    const cmd = this.undoStack.pop()
    if (!cmd) return false
    cmd.undo()
    this.redoStack.push(cmd)
    this.notifyListeners()
    return true
  }

  /** Redo the last undone command */
  redo(): boolean {
    const cmd = this.redoStack.pop()
    if (!cmd) return false
    cmd.redo()
    this.undoStack.push(cmd)
    this.notifyListeners()
    return true
  }

  /** Can undo? */
  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  /** Can redo? */
  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** Get undo stack (for UI display) */
  getUndoStack(): Command[] {
    return [...this.undoStack]
  }

  /** Get redo stack (for UI display) */
  getRedoStack(): Command[] {
    return [...this.redoStack]
  }

  /** Clear all history */
  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.notifyListeners()
  }

  /** Get last command description (for UI: "Undo: Set Cutoff to 4200") */
  getLastUndoDescription(): string | null {
    const cmd = this.undoStack[this.undoStack.length - 1]
    return cmd ? cmd.description : null
  }

  /** Get next redo command description */
  getNextRedoDescription(): string | null {
    const cmd = this.redoStack[this.redoStack.length - 1]
    return cmd ? cmd.description : null
  }

  /** Subscribe to history changes (for UI updates) */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(): void {
    this.listeners.forEach((l) => l())
  }

  /** Get history stats */
  getStats(): { undoCount: number; redoCount: number; total: number } {
    return {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      total: this.undoStack.length + this.redoStack.length,
    }
  }
}

/**
 * Helper: create a simple set-param command.
 * Usage:
 *   const cmd = createSetCommand('Cutoff', 3000, 4200, (v) => setCutoff(v))
 *   history.execute(cmd)
 */
export function createSetCommand(
  paramName: string,
  oldValue: number,
  newValue: number,
  setter: (value: number) => void
): Omit<Command, 'timestamp'> {
  return {
    type: `set_${paramName}`,
    description: `Set ${paramName} to ${newValue}`,
    undo: () => setter(oldValue),
    redo: () => setter(newValue),
  }
}
