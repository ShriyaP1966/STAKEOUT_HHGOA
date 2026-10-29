export function ConfigError({ problems }: { problems: string[] }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div role="alert" className="rounded-lg border border-danger-line bg-danger-bg p-6 text-danger-fg">
        <h1 className="text-xl font-bold">Configuration error</h1>
        <p className="mt-2 text-sm leading-relaxed">
          The app cannot start until these settings are fixed in apps/web/.env.local (see apps/web/.env.example) or in the
          deployment file:
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-5 font-mono text-[13px] break-words">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </div>
    </main>
  );
}
