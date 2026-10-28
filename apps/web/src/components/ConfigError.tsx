export function ConfigError({ problems }: { problems: string[] }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-5 text-red-900">
        <h1 className="text-xl font-semibold">Configuration error</h1>
        <p className="mt-2 text-sm">
          The app cannot start until these settings are fixed in apps/web/.env.local (see apps/web/.env.example) or in
          the deployment file:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 font-mono text-sm break-words">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </div>
    </main>
  );
}
