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
    const watch = (el: Element) => {
      if (seen.has(el) || el.hasAttribute("data-shown")) return;
      seen.add(el);
      io.observe(el);
    };
    document.querySelectorAll("[data-reveal]").forEach(watch);
    // Pages render more content after loading (for example the live dashboard).
    // Only newly added elements are checked, so text updates cost nothing.
    const mo = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.hasAttribute("data-reveal")) watch(node);
          if (node.firstElementChild) node.querySelectorAll("[data-reveal]").forEach(watch);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [pathname]);

  return null;
}
