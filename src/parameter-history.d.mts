export function createHistory<T>(initial: T, limit?: number): {
  get(): T; canUndo(): boolean; canRedo(): boolean; begin(): void; push(value: T, grouped?: boolean): void;
  end(): void; undo(): T; redo(): T; reset(value: T): void;
};
