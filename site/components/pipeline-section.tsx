"use client"

import { motion, useInView } from "motion/react"
import { useRef } from "react"

const steps = [
  { label: "Preflight", desc: "Check Docker, Docker Hub, and Sealos Cloud connection." },
  { label: "Assess", desc: "Analyze project language, framework, and deployment readiness." },
  { label: "Detect", desc: "Search for existing container images to skip unnecessary builds." },
  { label: "Dockerfile", desc: "Auto-generate an optimized Dockerfile if one is missing." },
  { label: "Build & Push", desc: "Build the container image and push to Docker Hub." },
  { label: "Deploy", desc: "Generate a Sealos template and deploy to Sealos Cloud." },
]

export function PipelineSection() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" })

  return (
    <section ref={sectionRef} className="flex justify-center px-6 py-24">
      <div className="w-full max-w-2xl">
        <motion.h3
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-2 text-center font-mono text-sm uppercase tracking-widest text-primary"
        >
          Pipeline
        </motion.h3>
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="mb-16 text-center text-2xl font-bold text-foreground md:text-3xl text-balance"
        >
          What Happens When You Run It
        </motion.h2>

        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[19px] top-0 bottom-0 w-px overflow-hidden">
            <motion.div
              initial={{ scaleY: 0 }}
              animate={isInView ? { scaleY: 1 } : { scaleY: 0 }}
              transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
              className="h-full w-full origin-top bg-border"
            />
          </div>

          <div className="flex flex-col gap-10">
            {steps.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 16 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{
                  duration: 0.5,
                  delay: 0.3 + i * 0.1,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="relative flex items-start gap-6 pl-0"
              >
                {/* Dot */}
                <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={isInView ? { scale: 1 } : { scale: 0 }}
                    transition={{ delay: 0.4 + i * 0.1, type: "spring", stiffness: 400, damping: 20 }}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
                  >
                    <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                  </motion.div>
                </div>

                {/* Content */}
                <div className="pt-1.5">
                  <h4 className="font-mono text-sm font-semibold text-foreground">{step.label}</h4>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
