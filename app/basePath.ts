// Mirrors next.config.ts's basePath — Next.js auto-prefixes its own
// router/Link/Image, but not raw fetch()/window.location calls, so those
// need this prepended by hand to keep working once deployed under a
// URL prefix (see next.config.ts for why).
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
