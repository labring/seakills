"use client"

import { motion, useInView } from "motion/react"
import { useRef } from "react"

const tree = [
  { depth: 0, name: "install.sh", comment: "One-line installer", isFile: true },
  { depth: 0, name: "README.md", isFile: true },
  { depth: 0, name: "skills/" },
  { depth: 1, name: "sealos-deploy/", comment: "Main skill", highlight: true },
  { depth: 2, name: "SKILL.md", comment: "Entry point", isFile: true },
  { depth: 2, name: "modules/" },
  { depth: 3, name: "preflight.md", comment: "Docker + auth checks", isFile: true },
  { depth: 3, name: "pipeline.md", comment: "Phase 1-5 pipeline", isFile: true },
  { depth: 2, name: "scripts/" },
  { depth: 3, name: "sealos-auth.mjs", comment: "Sealos Cloud auth", isFile: true },
  { depth: 1, name: "dockerfile-skill/", comment: "Dockerfile generation" },
  { depth: 1, name: "cloud-native-readiness/", comment: "Readiness assessment" },
  { depth: 1, name: "docker-to-sealos/", comment: "Template conversion" },
]

export function ProjectStructure() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const isInView = useInView(sectionRef, { once: true, margin: "-80px" })

  return (
    <section ref={sectionRef} className="flex justify-center px-6 py-24">
      <div className="w-full max-w-3xl">
        <motion.h3
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-2 text-center font-mono text-sm uppercase tracking-widest text-primary"
        >
          Structure
        </motion.h3>
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="mb-12 text-center text-2xl font-bold text-foreground md:text-3xl text-balance"
        >
          Project Layout
        </motion.h2>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="overflow-hidden rounded-xl border border-border bg-card"
        >
          <div className="border-b border-border px-5 py-3">
            <span className="font-mono text-xs text-muted-foreground">seakills/</span>
          </div>
          <div className="p-5 font-mono text-sm leading-loose">
            {tree.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0 }}
                animate={isInView ? { opacity: 1 } : {}}
                transition={{ duration: 0.3, delay: 0.3 + i * 0.04 }}
                className="flex items-baseline gap-2"
                style={{ paddingLeft: item.depth * 24 }}
              >
                <span className="text-border select-none">
                  {item.isFile ? "\u251C\u2500\u2500" : "\u251C\u2500\u252C"}
                </span>
                <span className={item.highlight ? "text-primary" : "text-foreground"}>
                  {item.name}
                </span>
                {item.comment && (
                  <span className="text-muted-foreground/50">
                    {"# " + item.comment}
                  </span>
                )}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
