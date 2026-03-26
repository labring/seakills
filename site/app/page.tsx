import { Navbar } from "@/components/navbar"
import { TerminalHero } from "@/components/terminal-hero"
import { TerminalDemo } from "@/components/terminal-demo"
import { AgentBadges } from "@/components/agent-badges"
import { PipelineSection } from "@/components/pipeline-section"
import { SetupSection } from "@/components/setup-section"
import { ProjectStructure } from "@/components/project-structure"
import { CtaSection } from "@/components/cta-section"
import { GITHUB_URL, REPO } from "@/lib/constants"

export default function Page() {
  return (
    <>
      <Navbar />
      <main className="relative min-h-screen">
        <TerminalHero />
        <TerminalDemo />
        <AgentBadges />
        <PipelineSection />
        <SetupSection />
        <ProjectStructure />
        <CtaSection />
      </main>

      <footer className="border-t border-border py-8 text-center">
        <p className="font-mono text-xs text-muted-foreground">
          Built for the open agent skills ecosystem &middot; MIT License &middot;{" "}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary transition-colors hover:text-primary/80"
          >
            {REPO}
          </a>
        </p>
      </footer>
    </>
  )
}
