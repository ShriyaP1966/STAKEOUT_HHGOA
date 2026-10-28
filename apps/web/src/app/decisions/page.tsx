"use client";

import { useQuery } from "@tanstack/react-query";
import { isAddress, isHex, size } from "viem";
import { Empty, ErrorPanel, ExplorerLink, Field, Loading, Mono, RefreshButton, Section } from "@/components/ui";
import { backend, BackendError } from "@/lib/backend";
import { combinedAbi } from "@/lib/abi";
import { decodeError } from "@/lib/errors";

export default function DecisionsPage() {
  const decisions = useQuery({ queryKey: ["decisions"], queryFn: () => backend.decisions() });
  const refresh = <RefreshButton onClick={() => decisions.refetch()} busy={decisions.isFetching} />;

  return (
    <Section title="Verifier decisions" action={refresh}>
      {decisions.isPending && <Loading label="Reading decisions from the backend…" />}
      {decisions.isError && (
        <ErrorPanel
          error={decisions.error instanceof BackendError ? decisions.error.decoded : decodeError(decisions.error, combinedAbi)}
        />
      )}
      {decisions.isSuccess && (
        <>
          <p className="mb-3 text-xs text-slate-500">Data source: {decisions.data.dataSource}</p>
          {decisions.data.decisions.length === 0 ? (
            <Empty label="The verifier has not handled any events yet." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {decisions.data.decisions.map((decision) => (
                <li key={decision.id} className="py-3">
                  <dl className="space-y-1">
                    <Field label="Target">
                      {isAddress(decision.target) ? <ExplorerLink kind="address" value={decision.target} /> : <Mono>{decision.target}</Mono>}
                    </Field>
                    <Field label="Kind">{decision.kind}</Field>
                    <Field label="Outcome">{decision.outcome}</Field>
                    <Field label="Rule">{decision.rule}</Field>
                    <Field label="Reason">{decision.reason}</Field>
                    <Field label="Created at">{decision.created_at}</Field>
                    <Field label="Transaction">
                      {decision.tx_hash === null ? (
                        "None (no transaction sent)"
                      ) : isHex(decision.tx_hash, { strict: true }) && size(decision.tx_hash) === 32 ? (
                        <ExplorerLink kind="tx" value={decision.tx_hash} />
                      ) : (
                        <Mono>{decision.tx_hash}</Mono>
                      )}
                    </Field>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}
