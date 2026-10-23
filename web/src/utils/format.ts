// Qwen writes inline math as "$ x $"; Markdown math needs "$x$".
export const normalizeMath = (text: string) =>
  text.replace(/(?<!\$)\$ +([^$\n]+?) +\$(?!\$)/g, (_, inner: string) => `$${inner}$`)

export const pagesLabel = (pages: number[]) =>
  pages.length > 1 ? `pp. ${pages[0]}–${pages[pages.length - 1]}` : `p. ${pages[0]}`
