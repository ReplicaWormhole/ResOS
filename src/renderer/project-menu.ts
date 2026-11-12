import type { Project } from '../shared/desktop-api.js';

export class ProjectMenu {
  private readonly element =
    document.querySelector<HTMLElement>('#project-menu')!;
  private anchor?: HTMLButtonElement;
  private pending = false;

  constructor(
    private readonly pin: (project: Project) => Promise<void>,
    private readonly remove: (project: Project) => Promise<void>,
    private readonly report: (error: unknown) => void,
  ) {
    this.element.addEventListener('beforetoggle', (event) => {
      this.anchor?.setAttribute(
        'aria-expanded',
        String((event as ToggleEvent).newState === 'open'),
      );
    });
    this.element.addEventListener('keydown', (event) => {
      const buttons = [...this.element.querySelectorAll('button')];
      const index = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      let next: number;
      switch (event.key) {
        case 'ArrowDown':
          next = (index + 1) % buttons.length;
          break;
        case 'ArrowUp':
          next = (index + buttons.length - 1) % buttons.length;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = buttons.length - 1;
          break;
        case 'Escape':
        case 'Tab':
          if (event.key === 'Escape') event.preventDefault();
          this.close();
          this.anchor?.focus();
          return;
        default:
          return;
      }
      event.preventDefault();
      buttons[next]?.focus();
    });
    window.addEventListener('resize', () => this.close());
    document.addEventListener('scroll', () => this.close(), true);
  }

  close(): void {
    this.element.hidePopover();
  }

  attach(button: HTMLButtonElement, project: Project): void {
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-controls', 'project-menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute(
      'aria-description',
      (project.pinned ? 'Pinned. ' : '') +
        'Right-click or press Shift+F10 for project options.',
    );
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.open(button, project, event.clientX, event.clientY);
    });
    button.addEventListener('keydown', (event) => {
      if (
        event.key !== 'ContextMenu' &&
        !(event.shiftKey && event.key === 'F10')
      )
        return;
      event.preventDefault();
      const bounds = button.getBoundingClientRect();
      this.open(button, project, bounds.left, bounds.bottom);
    });
  }

  private open(
    button: HTMLButtonElement,
    project: Project,
    x: number,
    y: number,
  ): void {
    if (this.pending) return;
    this.close();
    this.anchor = button;
    const action = (label: string, run: () => Promise<void>) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.textContent = label;
      item.addEventListener('click', async () => {
        if (this.pending) return;
        this.pending = true;
        this.close();
        button.focus();
        try {
          await run();
        } catch (error) {
          this.report(error);
        } finally {
          this.pending = false;
        }
      });
      return item;
    };
    this.element.replaceChildren(
      action(project.pinned ? 'Unpin' : 'Pin', () => this.pin(project)),
      action('Remove project', () => this.remove(project)),
    );
    this.element.showPopover();
    this.element.style.left =
      Math.max(
        8,
        Math.min(x, window.innerWidth - this.element.offsetWidth - 8),
      ) + 'px';
    this.element.style.top =
      Math.max(
        8,
        Math.min(y, window.innerHeight - this.element.offsetHeight - 8),
      ) + 'px';
    this.element.querySelector('button')?.focus();
  }
}
