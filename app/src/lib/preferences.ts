export const themeStorageKey = 'sciplot-theme';
export const languageStorageKey = 'sciplot-lang';

export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}
