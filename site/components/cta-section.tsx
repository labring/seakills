"use client"

import { useState, useCallback, useEffect } from "react"
import { Check, Copy } from "lucide-react"
import { motion } from "motion/react"
import { GITHUB_URL, INSTALL_CMD } from "@/lib/constants"

export function CtaSection() {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(INSTALL_CMD)
    setCopied(true)
  }, [])

  useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 2000)
      return () => clearTimeout(t)
    }
  }, [copied])

  return (
    <section className="flex justify-center px-6 py-24">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-3xl"
      >
        <div className="overflow-hidden rounded-2xl border border-border bg-card p-10 text-center md:p-16">
          <h2 className="mb-4 text-2xl font-bold text-foreground md:text-4xl text-balance">
            Ready to Deploy?
          </h2>
          <p className="mx-auto mb-8 max-w-md text-sm text-muted-foreground">
            Install through the standard skills ecosystem. Let your AI assistant handle the rest, from Dockerfile to live deployment.
          </p>

          <div className="mx-auto flex max-w-xl items-center gap-3 rounded-lg border border-border bg-background px-5 py-4 transition-colors duration-200 hover:border-primary/30">
            <span className="shrink-0 font-mono text-sm text-primary">$</span>
            <code className="flex-1 overflow-x-auto font-mono text-sm text-foreground scrollbar-none whitespace-nowrap">
              {INSTALL_CMD}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Copy install command"
            >
              {copied ? (
                <Check className="h-4 w-4 text-primary" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>

          <div className="mt-8 flex items-center justify-center gap-6 text-sm text-muted-foreground">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 transition-colors hover:text-foreground"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              GitHub
            </a>
            <span className="text-border">|</span>
            <span>MIT License</span>
            <span className="text-border">|</span>
            <span>v1.3.0</span>
          </div>
        </div>
      </motion.div>
    </section>
  )
}
