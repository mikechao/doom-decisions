import stylesheetUrl from './doom-button.css?url&no-inline';

export interface DoomButtonElement extends HTMLElement {
  disabled: boolean;
}

// Explicit registration keeps this module importable by the offline DOM fixtures.
export function defineDoomButton() {
  if (customElements.get('doom-button')) return;
  if (
    !('ariaControlsElements' in Element.prototype) ||
    !('ariaDescribedByElements' in Element.prototype)
  ) {
    throw new Error('Doom buttons require ARIA element-reference support.');
  }
  customElements.define(
    'doom-button',
    class extends HTMLElement implements DoomButtonElement {
      static observedAttributes = [
        'disabled',
        'autofocus',
        'aria-haspopup',
        'aria-controls',
        'aria-describedby',
        'aria-expanded',
        'aria-busy',
      ];
      private readonly button: HTMLButtonElement;
      private readonly start: HTMLSlotElement;
      private readonly spinner: HTMLSpanElement;

      constructor() {
        super();
        const root = this.attachShadow({ mode: 'open', delegatesFocus: true });
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = stylesheetUrl;
        this.button = document.createElement('button');
        this.button.type = 'button';
        this.start = document.createElement('slot');
        this.start.name = 'start';
        this.start.addEventListener('slotchange', () => this.syncSpinner());
        this.spinner = document.createElement('span');
        this.spinner.className = 'spinner';
        this.spinner.setAttribute('aria-hidden', 'true');
        this.spinner.hidden = true;
        this.button.append(
          this.start,
          this.spinner,
          document.createElement('slot'),
        );
        root.append(stylesheet, this.button);
      }

      get disabled() {
        return this.hasAttribute('disabled');
      }

      set disabled(value: boolean) {
        this.toggleAttribute('disabled', value);
      }

      connectedCallback() {
        this.syncButton();
      }

      attributeChangedCallback() {
        this.syncButton();
      }

      private syncButton() {
        this.button.disabled = this.disabled;
        this.button.autofocus = this.autofocus;
        this.button.ariaHasPopup = this.getAttribute('aria-haspopup');
        this.button.ariaExpanded = this.getAttribute('aria-expanded');
        this.button.ariaBusy = this.getAttribute('aria-busy');
        // Resolve IDs on the light-DOM host, then assign actual element references.
        // Copying the attribute into the shadow root would lose the dialog target.
        this.button.ariaControlsElements = this.ariaControlsElements;
        this.button.ariaDescribedByElements = this.ariaDescribedByElements;
        this.syncSpinner();
      }

      private syncSpinner() {
        // An assigned element (including an SVG with no text) owns the leading
        // presentation. Ignore whitespace and comments in flattened assignments.
        const hasStartContent = this.start
          .assignedNodes({ flatten: true })
          .some(
            (node) =>
              node.nodeType === Node.ELEMENT_NODE ||
              (node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim()),
          );
        this.spinner.hidden =
          this.getAttribute('aria-busy') !== 'true' || hasStartContent;
      }

      focus(options?: FocusOptions) {
        this.button.focus(options);
      }

      click() {
        this.button.click();
      }
    },
  );
}
