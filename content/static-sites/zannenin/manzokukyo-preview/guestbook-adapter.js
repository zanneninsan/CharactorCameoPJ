// Add preview-specific modal behavior around the shared guestbook controls.
// Loading entries and submitting posts remain entirely in the shared widget.
export function connectGuestbook({ onChange, onTap } = {}) {
  let root, modal, launcher, closeButton, ready = false, openState = false;
  const previousInert = new Map();
  const isOpen = () => Boolean(modal?.classList.contains('is-open'));
  const soundInvitationOpen = () => Boolean(document.querySelector('.sound-invitation[open]'));

  function synchronize() {
    const next = isOpen();
    if (next === openState) return;
    openState = next;
    if (next) {
      for (const element of document.querySelectorAll('.site-header, main, .skip-link')) {
        previousInert.set(element, element.getAttribute('inert'));
        element.inert = true;
      }
    } else {
      for (const [element, value] of previousInert) {
        if (value === null) element.removeAttribute('inert');
        else element.setAttribute('inert', value);
      }
      previousInert.clear();
    }
    onChange?.(next);
  }

  function trapTab(event) {
    if (event.key !== 'Tab' || !isOpen()) return;
    const focusable = [...modal.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled')
        && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0
        && getComputedStyle(element).visibility !== 'hidden');
    const first = focusable[0], last = focusable.at(-1);
    if (!first) {
      event.preventDefault();
      return;
    }
    const current = document.activeElement;
    if (!focusable.includes(current) || (event.shiftKey ? current === first : current === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  }

  function connect() {
    if (ready) return;
    root = document.querySelector('[data-guestbook-widget]');
    modal = root?.querySelector('[data-guestbook-modal]');
    launcher = root?.querySelector('[data-guestbook-open]');
    closeButton = root?.querySelector('button[data-guestbook-close]');
    if (!modal || !launcher || !closeButton || root.dataset.guestbookReady !== 'true') return;
    ready = true;
    injectionObserver.disconnect();
    // Capture before the shared launcher handler so consent stays the first step.
    root.addEventListener('click', event => {
      if (event.target.closest('[data-guestbook-open]') && soundInvitationOpen()) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
    root.addEventListener('click', event => {
      synchronize();
      if (event.target.closest('button')) onTap?.();
    });
    document.addEventListener('keydown', trapTab, true);
    document.addEventListener('focusin', event => {
      if (isOpen() && !modal.contains(event.target)) closeButton.focus({ preventScroll: true });
    });
    // Shared Escape and backdrop handlers also change the modal class.
    stateObserver.observe(modal, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    synchronize();
  }

  const injectionObserver = new MutationObserver(connect);
  const stateObserver = new MutationObserver(synchronize);
  injectionObserver.observe(document.documentElement, { childList: true, subtree: true });
  connect();

  return {
    isOpen,
    isReady: () => ready,
    open() {
      if (!ready || soundInvitationOpen()) return false;
      if (!isOpen()) launcher.click();
      synchronize();
      return isOpen();
    },
    close() {
      if (!ready || !isOpen()) return;
      closeButton.click();
      synchronize();
    }
  };
}
