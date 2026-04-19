function getThemeValue(host: Element, value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'light' || normalized === 'dark') {
    return normalized;
  }
  if (host.classList.contains('dark')) {
    return 'dark';
  }
  if (host.classList.contains('light')) {
    return 'light';
  }
  return null;
}

export function findMeoThemeHost(source?: Node | null): HTMLElement | null {
  if (source instanceof HTMLElement) {
    return source.closest('.meo-native-theme');
  }
  if (source instanceof Element) {
    return source.closest('.meo-native-theme');
  }
  if (source?.parentElement instanceof HTMLElement) {
    return source.parentElement.closest('.meo-native-theme');
  }
  const host = document.querySelector('.meo-native-theme');
  return host instanceof HTMLElement ? host : null;
}

function syncMeoThemeScope(target: HTMLElement, host: HTMLElement | null) {
  target.classList.add('meo-native-theme');

  const resolvedTheme = host
    ? getThemeValue(host, host.getAttribute('data-theme') ?? host.dataset.theme)
    : null;

  target.classList.toggle('light', resolvedTheme === 'light');
  target.classList.toggle('dark', resolvedTheme === 'dark');

  if (resolvedTheme) {
    target.dataset.theme = resolvedTheme;
  } else {
    delete target.dataset.theme;
  }

  return host;
}

export function bindMeoThemeScope(target: HTMLElement, source?: Node | null) {
  const host = syncMeoThemeScope(target, findMeoThemeHost(source));

  if (!host || typeof MutationObserver === 'undefined') {
    return () => {};
  }

  const observer = new MutationObserver(() => {
    syncMeoThemeScope(target, host);
  });

  observer.observe(host, {
    attributes: true,
    attributeFilter: ['class', 'data-theme'],
  });

  return () => {
    observer.disconnect();
  };
}

export function mountMeoScopedPortal(
  target: HTMLElement,
  source?: Node | null,
  parent: HTMLElement = document.body
) {
  const disposeThemeScope = bindMeoThemeScope(target, source);
  parent.appendChild(target);

  return () => {
    disposeThemeScope();
    target.remove();
  };
}
