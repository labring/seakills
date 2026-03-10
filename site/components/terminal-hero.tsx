"use client"

import { useEffect, useState, useCallback } from "react"
import { Check, Copy } from "lucide-react"
import { motion } from "motion/react"

const installCmd = "curl -fsSL https://seakills.gzg.sealos.run/install.sh | bash"

export function TerminalHero() {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(installCmd)
    setCopied(true)
  }, [])

  useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 2000)
      return () => clearTimeout(t)
    }
  }, [copied])

  return (
    <section className="relative flex flex-col items-center px-6 pt-32 pb-24 overflow-hidden">
      {/* Subtle radial glow */}
      <div className="pointer-events-none absolute top-0 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/5 blur-[120px]" />

      {/* Badge */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="mb-8 flex items-center gap-2 rounded-full border border-border bg-secondary px-4 py-1.5 font-mono text-xs text-muted-foreground"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
        v1.0.5 — Agent Skill for AI Coding Assistants
      </motion.div>

      {/* ASCII Art Title */}
      <motion.pre
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="mb-6 hidden text-center font-mono text-[10px] leading-tight text-primary/80 md:block select-none"
        aria-hidden="true"
      >{`███████╗███████╗ █████╗ ██╗      ██████╗ ███████╗
██╔════╝██╔════╝██╔══██╗██║     ██╔═══██╗██╔════╝
███████╗█████╗  ███████║██║     ██║   ██║███████╗
╚════██║██╔══╝  ██╔══██║██║     ██║   ██║╚════██║
███████║███████╗██║  ██║███████╗╚██████╔╝███████║
╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚══════╝`}</motion.pre>
      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="mb-2 text-center font-mono text-4xl font-bold tracking-tight text-foreground md:hidden"
      >
        SEALOS
      </motion.h1>

      <motion.h2
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.35 }}
        className="mb-4 text-center font-mono text-3xl font-bold tracking-tight text-foreground md:text-5xl text-balance"
      >
        <span className="text-primary">Deploy</span> Skill
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.45 }}
        className="mb-10 max-w-xl text-center font-mono text-sm leading-relaxed text-muted-foreground md:text-base"
      >
        One command to deploy any GitHub project to Sealos Cloud.
        <br className="hidden md:block" />
        Works with Claude Code, Gemini CLI, Codex — any AI coding assistant.
      </motion.p>

      {/* Install Command */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.55 }}
        className="w-full max-w-2xl"
      >
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-4 transition-colors duration-200 hover:border-primary/30">
          <span className="shrink-0 font-mono text-sm text-primary">$</span>
          <code className="flex-1 overflow-x-auto font-mono text-sm text-foreground scrollbar-none whitespace-nowrap">
            {installCmd}
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
      </motion.div>

      {/* Quick Use */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.7 }}
        className="mt-6 flex flex-col items-center gap-3 font-mono text-sm text-muted-foreground sm:flex-row"
      >
        <span className="text-foreground/50">then use:</span>
        <code className="rounded-md border border-border bg-secondary px-3 py-1 transition-colors hover:border-primary/30">
          /sealos-deploy
        </code>
      </motion.div>
    </section>
  )
}
