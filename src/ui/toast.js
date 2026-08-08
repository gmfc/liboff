/** Transient messages and confirmations. */

import { h } from './dom.js';

let container = null;

function ensureContainer() {
  if (!container) {
    container = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(container);
  }
  return container;
}

export function toast(message, { kind = 'info', duration = 2600, action } = {}) {
  const node = h(
    'div',
    { class: `toast toast--${kind}` },
    h('span', { class: 'toast__text' }, message),
    action
      ? h(
          'button',
          {
            type: 'button',
            class: 'toast__action',
            onClick: () => {
              action.onClick();
              node.remove();
            },
          },
          action.label,
        )
      : null,
  );
  ensureContainer().appendChild(node);
  setTimeout(() => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 220);
  }, duration);
  return node;
}

/**
 * A modal confirm. Used for the destructive actions only — deleting a book and
 * erasing the library — since neither can be undone once the write lands.
 */
export function confirmDialog({ title, body, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const dialog = h(
      'div',
      { class: 'dialog-backdrop', onClick: (event) => event.target === dialog && close(false) },
      h(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h2', { class: 'dialog__title' }, title),
        body ? h('p', { class: 'dialog__body' }, body) : null,
        h(
          'div',
          { class: 'dialog__actions' },
          h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => close(false) }, 'Cancel'),
          h(
            'button',
            {
              type: 'button',
              class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
              onClick: () => close(true),
            },
            confirmLabel,
          ),
        ),
      ),
    );

    function onKey(event) {
      if (event.key === 'Escape') close(false);
    }

    function close(result) {
      document.removeEventListener('keydown', onKey);
      dialog.remove();
      resolve(result);
    }

    document.addEventListener('keydown', onKey);
    document.body.appendChild(dialog);
    dialog.querySelector('.btn--danger, .btn--primary')?.focus();
  });
}
