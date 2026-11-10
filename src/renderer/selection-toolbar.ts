export interface SelectionActions {
  annotate(): Promise<void>;
  ask(): Promise<void>;
  add(): Promise<void>;
}

export class SelectionToolbar {
  private readonly element =
    document.querySelector<HTMLElement>('#selection-toolbar')!;
  private actions?: SelectionActions;
  private frame = 0;

  constructor(
    private readonly resolve: (range: Range) => SelectionActions | undefined,
    private readonly report: (error: unknown) => void,
  ) {
    document.addEventListener('selectionchange', () => this.schedule());
    document.addEventListener('pointerdown', (event) => {
      if (this.element.contains(event.target as Node)) event.preventDefault();
      else this.hide();
    });
    document.addEventListener('pointerup', (event) => {
      if (!this.element.contains(event.target as Node)) this.schedule();
    });
    document.addEventListener('scroll', () => this.hide(), true);
    window.addEventListener('resize', () => this.hide());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.element.hidden) {
        const returnFocus = this.element.contains(document.activeElement);
        this.hide();
        if (returnFocus)
          document
            .getSelection()
            ?.anchorNode?.parentElement?.closest<HTMLElement>(
              '[tabindex], [contenteditable]',
            )
            ?.focus();
      }
      if (event.altKey && event.shiftKey && event.code === 'KeyA') {
        this.update();
        if (this.actions) {
          event.preventDefault();
          this.element.querySelector('button')?.focus();
        }
      }
    });
    for (const button of this.element.querySelectorAll('button')) {
      const action = button.dataset.action as keyof SelectionActions;
      button.addEventListener('click', () => {
        const captured = this.actions;
        this.hide();
        if (captured) void captured[action]().catch(this.report);
      });
    }
  }

  hide(): void {
    cancelAnimationFrame(this.frame);
    this.actions = undefined;
    this.element.hidden = true;
  }

  private schedule(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.update());
  }

  private update(): void {
    const selected = document.getSelection();
    if (!selected || selected.isCollapsed || !selected.rangeCount) {
      this.hide();
      return;
    }
    const range = selected.getRangeAt(0);
    const actions = this.resolve(range);
    const rect = [...range.getClientRects()].find(
      (candidate) =>
        candidate.height > 0 &&
        candidate.bottom > 0 &&
        candidate.top < window.innerHeight,
    );
    if (!actions || !rect) {
      this.hide();
      return;
    }
    this.actions = actions;
    this.element.hidden = false;
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    this.element.style.left =
      Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
    this.element.style.top =
      (rect.top >= height + 10
        ? rect.top - height - 6
        : Math.min(rect.bottom + 6, window.innerHeight - height - 8)) + 'px';
  }
}
