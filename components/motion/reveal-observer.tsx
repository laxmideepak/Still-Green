"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Fades in any element marked `data-reveal` when it scrolls into view.
 * The hidden starting state lives in globals.css and only applies once the
 * `js` class is on <html>, so the page is fully readable without JavaScript.
 * Use `style={{ "--reveal-delay": "120ms" }}` to stagger siblings.
 */
export function RevealObserver() {
  const pathname = usePathname();

  useEffect(() => {
    const seen = new WeakSet<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-shown", "");
          io.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    const scan = () => {
      document.querySelectorAll("[data-reveal]:not([data-shown])").forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        io.observe(el);
      });
    };
    scan();
    // Pages render more content after loading (for example the live dashboard).
    let queued = 0;
    const mo = new MutationObserver(() => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        scan();
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
      cancelAnimationFrame(queued);
    };
  }, [pathname]);

  return null;
}
