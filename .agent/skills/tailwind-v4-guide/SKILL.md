---
name: tailwind-v4-guide
description: Expert guide for Tailwind CSS v4 usage, highlighting new features, breaking changes, and migrations from v3. Focuses on the new engine, CSS-first configuration, and modern utility patterns.
---

# Tailwind CSS v4 Guide

This skill provides expertise on Tailwind CSS v4, focusing on the new high-performance engine, simplified configuration, and modern CSS features.

## Key Changes in v4

- **New Engine**: Rewritten in Rust for incredible speed.
- **CSS-First Configuration**: Configuration is now done primarily in CSS using `@theme` directives, rather than `tailwind.config.js`.
- **Zero Configuration**: Many defaults work out of the box without needing a config file.
- **Native Cascading Layers**: Uses native `@layer` support.

## Configuration (v4 vs v3)

**v3 (Legacy - tailwind.config.js)**:

```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: "#005f73",
      },
    },
  },
};
```

**v4 (Modern - CSS)**:
In your main CSS file:

```css
@import "tailwindcss";

@theme {
  --color-brand: #005f73;
  --font-display: "Satoshi", sans-serif;
}
```

## using `cn` (Class Name Merging)

Just like in v3, use `tailwind-merge` and `clsx` (often wrapped as `cn`) to handle class conflicts dynamically.

```tsx
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

## New Features

- **3D Transforms**: Native utilities for 3D transforms (e.g., `rotate-x-12`, `scale-3d`).
- **Gradient Color Stops**: Improved syntax for complex gradients.
- **Container Queries**: First-class support for `@container` queries using `@tailwindcss/container-queries` (often built-in).
- **Logical Properties**: Expanded support for logical properties (e.g., `ms-4` for margin-inline-start).

## Migration Tips

1.  **Upgrade Node.js**: Ensure you are on a recent Node version.
2.  **Remove `postcss` config**: v4 often handles this internally or via standard plugins.
3.  **Replace `@tailwind` directives**: Use `@import "tailwindcss";` instead of `@tailwind base; @tailwind components; @tailwind utilities;`.

## Troubleshooting

- **Classes not applying**: In v4, ensure your build tool (Vite, Next.js, etc.) is correctly configured to use the new Tailwind PostCSS plugin or CLI.
- **Variable scoping**: CSS variables defined in `@theme` are globally available.
