/**
 * A very small DOM helper. Elements are built as objects rather than HTML
 * strings so that book titles, notes and author names — all user or API
 * supplied — can never be interpreted as markup.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function applyProps(node, props) {
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') {
      node.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    } else if (key === 'style' && typeof value === 'object') {
      for (const [property, setting] of Object.entries(value)) {
        // Custom properties are invisible to `style.foo = …`, so they have to
        // go through setProperty or they are silently dropped.
        if (property.startsWith('--')) node.style.setProperty(property, setting);
        else node.style[property] = setting;
      }
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'ref' && typeof value === 'function') {
      value(node);
    } else if (key === 'html') {
      node.innerHTML = value; // only ever called with literals in this codebase
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
}

function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  applyProps(node, props);
  appendChildren(node, children);
  return node;
}

export function svg(tag, props, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key === 'className' ? 'class' : key, String(value));
    }
  }
  appendChildren(node, children);
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  appendChildren(node, children);
  return node;
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/** Icons are drawn rather than typed so they render identically everywhere. */
const ICON_PATHS = {
  library: 'M4 4h5v16H4zM11 4h4v16h-4zM17.2 4.6l3.4 15.1',
  scan: 'M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M7 9v6M10 9v6M13.5 9v6M17 9v6',
  stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4.35-4.35',
  filter: 'M4 6h16M7 12h10M10 18h4',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5l-7 7 7 7',
  camera: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2L9 5h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  image: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM4 16l4.5-4.5 4 4L16 12l4 4M9 9.5h.01',
  torch: 'M9 3h6l-1 5h3l-7 13 1.5-8H8z',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  download: 'M12 4v11M8 11l4 4 4-4M4 20h16',
  upload: 'M12 20V9M8 13l4-4 4 4M4 4h16',
  check: 'M5 13l4 4L19 7',
  offline: 'M2 4l20 16M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 3-2M19 13a10 10 0 0 0-9-2.9M12 20h.01',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4',
  install: 'M12 4v10M8 10l4 4 4-4M5 20h14',
  edit: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
};

export function icon(name, { size = 24, className = '' } = {}) {
  const d = ICON_PATHS[name];
  return svg(
    'svg',
    {
      class: `icon ${className}`.trim(),
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    d ? svg('path', { d }) : null,
  );
}

/** A filled or outlined star. */
export function starIcon(filled, size = 28) {
  return svg(
    'svg',
    {
      class: `star ${filled ? 'is-filled' : ''}`.trim(),
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: filled ? 'currentColor' : 'none',
      stroke: 'currentColor',
      'stroke-width': 1.6,
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    svg('path', { d: 'M12 3.4l2.7 5.6 6.1.85-4.4 4.3 1.05 6.1L12 17.4l-5.45 2.85L7.6 14.15 3.2 9.85l6.1-.85z' }),
  );
}

/** The bomb: the one verdict that is not a number of stars. */
export function bombIcon(size = 24) {
  return svg(
    'svg',
    {
      class: 'bomb-icon',
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.7,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    svg('circle', { cx: '10.5', cy: '14.5', r: '6.2', fill: 'currentColor', stroke: 'none' }),
    svg('path', { d: 'M15.2 9.8l2-2M17.6 6.2c.6-1.2 1.9-1.6 3-1.1M19.4 3.2v1.6M21.8 5.1l-1.4.9' }),
  );
}

export function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

/** "12 Mar 2024" — short, unambiguous, locale-aware. */
export function formatDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
