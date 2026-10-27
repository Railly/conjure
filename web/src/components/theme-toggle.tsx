"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const OPTIONS = [
  { value: "light", label: "Claro", Icon: Sun },
  { value: "dark", label: "Oscuro", Icon: Moon },
  { value: "system", label: "Sistema", Icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // The theme is only known on the client; render a neutral shell until then to avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div role="radiogroup" aria-label="Tema" className="flex items-center gap-0.5 rounded-full border border-line bg-surface/80 p-0.5 backdrop-blur">
      {OPTIONS.map(({ value, label, Icon }) => {
        const on = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={`grid size-7 place-items-center rounded-full transition-colors ${on ? "bg-ink text-paper" : "text-ink-3 hover:text-ink"}`}
          >
            <Icon className="size-3.5" strokeWidth={2.2} />
          </button>
        );
      })}
    </div>
  );
}
