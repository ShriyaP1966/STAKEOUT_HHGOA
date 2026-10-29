import type { ReactNode } from "react";

export type DocSection = { id: string; heading: string; body: ReactNode };

export function Pending({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-sm border border-warn-line bg-warn-bg px-1.5 py-0.5 text-[13px] font-semibold text-warn-fg">{children}</span>
  );
}

export function DocPage({ title, updated, intro, sections }: { title: string; updated: string; intro: ReactNode; sections: DocSection[] }) {
  return (
    <div className="grid gap-10 lg:grid-cols-[14rem_1fr]">
      <nav aria-label={`${title} sections`} className="hidden lg:block">
        <p className="mb-3 text-xs font-semibold tracking-wide text-fg-muted uppercase">On this page</p>
        <ol className="space-y-1 border-l border-line">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="-ml-px block border-l border-transparent py-1 pl-4 text-sm text-fg-muted hover:border-fg hover:text-fg">
                {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <article className="max-w-3xl space-y-10">
        <header className="space-y-3 border-b border-line pb-8">
          <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">{title}</h1>
          <p className="text-sm text-fg-muted">Last updated {updated}</p>
          <div className="space-y-3 text-[17px] leading-relaxed text-fg-muted">{intro}</div>
        </header>
        {sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-8 space-y-3">
            <h2 className="text-xl font-bold text-fg">{section.heading}</h2>
            <div className="space-y-3 leading-relaxed text-fg [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">{section.body}</div>
          </section>
        ))}
      </article>
    </div>
  );
}
