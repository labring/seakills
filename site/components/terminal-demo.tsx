"use client"

import { useEffect, useState, useRef } from "react"
import { motion, AnimatePresence } from "motion/react"

const lines = [
  { prefix: "[preflight]", content: "Checking environment...", delay: 0 },
  { prefix: "[preflight]", content: "\u2713 Docker installed (27.4.1)", delay: 600, highlight: true },
  { prefix: "[preflight]", content: "\u2713 Docker Hub authenticated", delay: 1000, highlight: true },
  { prefix: "[preflight]", content: "\u2713 Sealos Cloud connected", delay: 1400, highlight: true },
  { prefix: "", content: "", delay: 1700 },
  { prefix: "[assess]", content: "Scanning project...", delay: 1800 },
  { prefix: "[assess]", content: "Go + net/http \u2192 suitable for deployment", delay: 2400, highlight: true },
  { prefix: "", content: "", delay: 2600 },
  { prefix: "[detect]", content: "Checking for existing images...", delay: 2800 },
  { prefix: "[detect]", content: "Found ghcr.io/zxh326/kite:v0.4.0 (amd64) \u2192 skip build", delay: 3400, highlight: true },
  { prefix: "", content: "", delay: 3600 },
  { prefix: "[template]", content: "Generating Sealos template...", delay: 3800 },
  { prefix: "[template]", content: "Generated template/kite/index.yaml", delay: 4300, highlight: true },
  { prefix: "", content: "", delay: 4500 },
  { prefix: "[deploy]", content: "Deployment complete!", delay: 4800, highlight: true, success: true },
  { prefix: "[deploy]", content: "\u2192 https://kite.cloud.sealos.run", delay: 5200, link: true },
]

export function TerminalDemo() {
  const [visibleCount, setVisibleCount] = useState(0)
  const [hasStarted, setHasStarted] = useState(false)
  const [typingText, setTypingText] = useState("")
  const [showCommand, setShowCommand] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const command = "/sealos-deploy https://github.com/labring-sigs/kite"

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasStarted) {
          setHasStarted(true)
        }
      },
      { threshold: 0.3 }
    )
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [hasStarted])

  useEffect(() => {
    if (!hasStarted) return
    let i = 0
    const timer = setInterval(() => {
      if (i <= command.length) {
        setTypingText(command.slice(0, i))
        i++
      } else {
        clearInterval(timer)
        setShowCommand(true)
      }
    }, 35)
    return () => clearInterval(timer)
  }, [hasStarted, command])

  useEffect(() => {
    if (!showCommand) return
    const timers: ReturnType<typeof setTimeout>[] = []
    lines.forEach((line, i) => {
      timers.push(
        setTimeout(() => {
          setVisibleCount(i + 1)
        }, line.delay)
      )
    })
    return () => timers.forEach(clearTimeout)
  }, [showCommand])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [visibleCount, typingText])

  return (
    <section ref={containerRef} className="flex justify-center px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-3xl"
      >
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {/* Title bar */}
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <div className="h-3 w-3 rounded-full bg-muted-foreground/20" />
            <div className="h-3 w-3 rounded-full bg-muted-foreground/20" />
            <div className="h-3 w-3 rounded-full bg-muted-foreground/20" />
            <span className="ml-3 font-mono text-xs text-muted-foreground">
              ~/my-project
            </span>
          </div>

          {/* Terminal content */}
          <div ref={scrollRef} className="h-[380px] overflow-y-auto p-5 font-mono text-sm leading-relaxed">
            <div className="mb-3 text-muted-foreground">
              <span className="text-primary">$</span>{" "}
              <span className="text-foreground">
                {typingText}
                {!showCommand && hasStarted && (
                  <span className="inline-block w-2 h-4 ml-0.5 bg-primary animate-cursor-blink align-middle" />
                )}
              </span>
            </div>

            <AnimatePresence>
              {lines.slice(0, visibleCount).map((line, i) => {
                if (!line.content) return <div key={i} className="h-3" />
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2 }}
                    className="flex gap-2"
                  >
                    {line.prefix && (
                      <span className={`shrink-0 ${line.success ? "text-primary" : "text-muted-foreground/60"}`}>
                        {line.prefix}
                      </span>
                    )}
                    <span
                      className={
                        line.success
                          ? "font-bold text-primary"
                          : line.link
                            ? "text-primary underline underline-offset-2"
                            : line.highlight
                              ? "text-foreground"
                              : "text-muted-foreground"
                      }
                    >
                      {line.content}
                    </span>
                  </motion.div>
                )
              })}
            </AnimatePresence>

            {showCommand && visibleCount < lines.length && (
              <span className="inline-block h-4 w-2 bg-primary/80 animate-cursor-blink" />
            )}
          </div>
        </div>
      </motion.div>
    </section>
  )
}
