---
name: shadcn-expert
description: Specialized knowledge for working with shadcn/ui components, including installation, customization, and best practices. Provides guidance on using the CLI, theming, and extending components.
---

# Shadcn/ui Expert

This skill provides expert knowledge for using `shadcn/ui` in React projects. It covers installation, component usage, theming, and customization.

## Core Concepts

- **Not a Component Library**: shadcn/ui is a collection of re-usable components that you can copy and paste into your apps. You have full control over the code.
- **Radix UI**: Built on top of Radix UI primitives for accessibility and headless functionality.
- **Tailwind CSS**: Uses Tailwind CSS for styling.
- **CLI**: The `npx shadcn-ui@latest` CLI is used to add components to your project.

## Workflow

### 1. Adding Components

To add a component to your project, use the CLI:

```bash
npx shadcn-ui@latest add [component-name]
```

Example:

```bash
npx shadcn-ui@latest add button card dialog
```

### 2. Customization

Components are installed into your `components/ui` folder. You can modify them directly.

- **Change Styles**: Edit the Tailwind classes in the component file.
- **Change Behavior**: Modify the Radix UI primitive props or event handlers.
- **Theming**: Update your `globals.css` (CSS variables) or `tailwind.config.js` to change colors, fonts, and radii globally.

## Best Practices

1.  **Keep it Local**: Don't try to abstract shadcn components into a separate npm package unless necessary. The value is in owning the code.
2.  **Use `cn` Utility**: Always use the `cn` (classnames + tailwind-merge) utility for conditional styling.
    ```tsx
    import { cn } from "@/lib/utils";
    <div className={cn("bg-red-500", className)}>...</div>;
    ```
3.  **Accessibility First**: Do not remove the accessibility features provided by Radix UI.
4.  **Composition**: Build complex UI by composing smaller shadcn primitives (e.g., Card + Button + Input).

## Component Reference (Common)

- **Button**: Features verify different variants (default, destructive, outline, secondary, ghost, link).
- **Card**: Compound component (CardHeader, CardTitle, CardDescription, CardContent, CardFooter).
- **Dialog**: Modal dialogs.
- **Input / Form**: Form handling, often used with `react-hook-form` and `zod`.
- **Dropdown Menu**: Accessible dropdowns.
- **Sheet**: Slide-out panels.
- **Table**: Data tables.

## Troubleshooting

- **Missing Styles**: Check `tailwind.config.js` `content` array to ensure it includes your `components` directory.
- **Hydration Errors**: Ensure client components are marked with `"use client"`.
