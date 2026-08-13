export type LibraryTheme = "day" | "night";

export function initialLibraryTheme(prefersDark: boolean): LibraryTheme {
  return prefersDark ? "night" : "day";
}

export function nextLibraryTheme(theme: LibraryTheme): LibraryTheme {
  return theme === "day" ? "night" : "day";
}

export function libraryThemeAsset(theme: LibraryTheme): string {
  return `./assets/library-${theme}.webp`;
}
