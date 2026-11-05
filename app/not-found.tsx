import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ArrowRight } from "@/components/icons";
import { Badge, Button } from "@/components/ui";
import styles from "./not-found.module.css";

export const metadata: Metadata = {
  title: "Page not found",
};

const links = [
  {
    href: "/dashboard",
    title: "Dashboard",
    text: "See your status and change your schedule.",
  },
  {
    href: "/setup",
    title: "Setup guide",
    text: "Install Stillgreen and add your Slack, step by step.",
  },
  {
    href: "/start",
    title: "Quick start",
    text: "The short version, and every command.",
  },
];

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        <div className="container">
          <div className={styles.inner}>
            <Badge dot>Error 404</Badge>
            <h1 className={styles.title}>Page not found</h1>
            <p className={styles.text}>This page doesn&apos;t exist, or it has moved. Try one of these instead.</p>

            <ul className={styles.links}>
              {links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={styles.link}>
                    <span className={styles.linkText}>
                      <span className={styles.linkTitle}>{link.title}</span>
                      <span className={styles.linkDescription}>{link.text}</span>
                    </span>
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>

            <div className={styles.actions}>
              <Button href="/">Back to home</Button>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
