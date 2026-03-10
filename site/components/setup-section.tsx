"use client"

import { motion } from "motion/react"

const features = [
  {
    title: "Docker",
    desc: "Build images locally. The skill detects your project type and generates optimized Dockerfiles automatically.",
    tag: "Required",
  },
  {
    title: "Docker Hub",
    desc: "Push your built images to Docker Hub. Just run docker login — the skill handles the rest.",
    tag: "Required",
  },
  {
    title: "Sealos Cloud",
    desc: "Your deployment target. Provide a token on first use — the skill guides you through OAuth setup.",
    tag: "Required",
  },
]

export function SetupSection() {
  return (
    <section className="flex justify-center px-6 py-24">
      <div className="w-full max-w-4xl">
        <motion.h3
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-2 text-center font-mono text-sm uppercase tracking-widest text-primary"
        >
          First Time Setup
        </motion.h3>
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="mb-4 text-center text-2xl font-bold text-foreground md:text-3xl text-balance"
        >
          Interactive Environment Check
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mx-auto mb-12 max-w-lg text-center text-sm text-muted-foreground"
        >
          On first use, the skill checks your environment and guides you through setup interactively.
        </motion.p>

        <div className="grid gap-4 md:grid-cols-3">
          {features.map((f, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.15 + i * 0.08 }}
              className="flex flex-col rounded-xl border border-border bg-card p-6 transition-colors duration-200 hover:border-primary/20"
            >
              <div className="mb-4 flex items-center justify-between">
                <h4 className="font-mono text-base font-semibold text-foreground">{f.title}</h4>
                <span className="rounded-full border border-border px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {f.tag}
                </span>
              </div>
              <p className="flex-1 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
