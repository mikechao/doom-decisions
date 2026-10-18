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

      constructor() {
        super();
        const root = this.attachShadow({ mode: 'open', delegatesFocus: true });
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = stylesheetUrl;
        this.button = document.createElement('button');
        this.button.type = 'button';
        const start = document.createElement('slot');
        start.name = 'start';
        this.button.append(start, document.createElement('slot'));
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
