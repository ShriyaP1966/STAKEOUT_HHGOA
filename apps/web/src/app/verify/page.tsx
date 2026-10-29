"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { isHex, size, type Hex } from "viem";
import { useAppConfig } from "@/components/AppConfigContext";
import { CheckIcon, CrossIcon, InfoIcon } from "@/components/icons";
import { buttonClass, Empty, ErrorPanel, ExplorerLink, inputClass, Loading, Mono, PageHeader } from "@/components/ui";
import { combinedAbi } from "@/lib/abi";
import { backend, BackendError } from "@/lib/backend";
import { decodeError } from "@/lib/errors";
import { useStakeoutClient } from "@/lib/hooks";
import { fetchStakeoutEvents } from "@/lib/logs";
import { checkBundle, findHashOnChain } from "@/lib/verify";

function isBytes32(value: string): value is Hex {
  return isHex(value, { strict: true }) && size(value) === 32;
}

function Result({ ok, title, children }: { ok: boolean | null; title: string; children: ReactNode }) {
  const style = ok === null ? "border-line bg-surface text-fg" : ok ? "border-ok-line bg-ok-bg text-ok-fg" : "border-danger-line bg-danger-bg text-danger-fg";
  const mark = ok === null ? "Unknown" : ok ? "Pass" : "Fail";
  const Icon = ok === null ? InfoIcon : ok ? CheckIcon : CrossIcon;
  return (
    <div className={`flex gap-4 rounded-lg border p-4 sm:p-5 ${style}`}>
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-current/30">
        <Icon size={18} />
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-base font-bold">
          <span className="sr-only">{mark}: </span>
          {title}
        </p>
        <div className="space-y-1 text-sm leading-relaxed break-words">{children}</div>
      </div>
    </div>
  );
}

function useEvidenceBundle(hash: Hex | undefined) {
  return useQuery({
    queryKey: ["evidence", hash],
    enabled: hash !== undefined,
    queryFn: async () => {
      try {
        return (await backend.evidence(hash as Hex)).bundle;
      } catch (error) {
        if (error instanceof BackendError && error.status === 404) return null;
        throw error;
      }
    },
  });
}

function useChainMatches(hash: Hex | undefined) {
  const config = useAppConfig();
  const client = useStakeoutClient();
  return useQuery({
    queryKey: ["chain-matches", config.deployment.stakeoutAddress, hash],
    enabled: hash !== undefined,
    queryFn: async () =>
      findHashOnChain(
        await fetchStakeoutEvents(client, {
          address: config.deployment.stakeoutAddress,
          fromBlock: BigInt(config.deployment.deploymentBlock),
          chunkSize: config.logChunkSize,
        }),
        hash as Hex,
      ),
  });
}

function Results({ hash }: { hash: Hex }) {
  const bundle = useEvidenceBundle(hash);
  const chain = useChainMatches(hash);
  const check = bundle.isSuccess ? checkBundle(hash, bundle.data) : undefined;

  return (
    <div className="space-y-3">
      {chain.isPending && <Loading label="Searching contract events…" />}
      {chain.isError && <ErrorPanel error={decodeError(chain.error, combinedAbi)} />}
      {chain.isSuccess && (
        <Result ok={chain.data.length > 0} title={chain.data.length > 0 ? "Found on chain" : "Not found on chain"}>
          {chain.data.length === 0 && <p>No ReportSubmitted, Confirmed or Linked event carries this hash.</p>}
          {chain.data.map((match) => (
            <p key={`${match.ref.transactionHash}-${match.ref.logIndex}`}>
              {match.event} in block {match.ref.blockNumber.toString()}, tx{" "}
              <ExplorerLink kind="tx" value={match.ref.transactionHash} />
            </p>
          ))}
        </Result>
      )}

      {bundle.isPending && <Loading label="Fetching the evidence bundle from the backend…" />}
      {bundle.isError && (
        <ErrorPanel error={bundle.error instanceof BackendError ? bundle.error.decoded : decodeError(bundle.error, combinedAbi)} />
      )}
      {check?.status === "no-bundle" && (
        <>
          <Result ok={false} title="Recomputed hash cannot be checked">
            <p>The backend has no evidence bundle for this hash.</p>
          </Result>
          <Result ok={null} title="Data source unknown">
            <p>No bundle, so no data source to show.</p>
          </Result>
        </>
      )}
      {check && check.status !== "no-bundle" && (
        <>
          <Result
            ok={check.status === "match"}
            title={check.status === "match" ? "Recomputed hash matches" : "Recomputed hash does NOT match: the stored evidence was altered"}
          >
            <p>
              Requested <Mono>{hash}</Mono>
            </p>
            <p>
              Recomputed <Mono>{check.recomputed}</Mono>
            </p>
          </Result>
          <Result ok={check.dataSource !== null} title={`Data source: ${check.dataSource ?? "missing from the bundle"}`}>
            <p>Taken from the evidence bundle stored by the backend.</p>
          </Result>
        </>
      )}
    </div>
  );
}

export default function VerifyPage() {
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [hash, setHash] = useState<Hex | undefined>(undefined);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const candidate = input.trim();
    if (!isBytes32(candidate)) {
      setInputError("Enter 0x followed by 64 hex characters.");
      setHash(undefined);
      return;
    }
    setInputError(null);
    setHash(candidate);
  };

  return (
    <>
      <PageHeader
        title="Verify evidence"
        description="Anyone can check that evidence was not changed after it was recorded. This page fetches the stored bundle, hashes it again in your browser, and compares it with the hash on chain."
      />
      <form className="rounded-lg border border-line bg-surface p-5 sm:p-6" onSubmit={onSubmit} noValidate>
        <label className="mb-1.5 block text-sm font-semibold text-fg" htmlFor="hash">
          Evidence or complaint hash
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="hash"
            placeholder="0x followed by 64 hex characters"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={inputError !== null}
            aria-describedby={inputError ? "hash-error" : undefined}
            className={`${inputClass} font-mono`}
          />
          <button type="submit" className={buttonClass("primary")}>
            Verify
          </button>
        </div>
        {inputError && (
          <p id="hash-error" className="mt-2 text-sm text-danger-fg">
            {inputError}
          </p>
        )}
      </form>
      <div aria-live="polite">
        {hash === undefined && !inputError && <Empty label="Enter a hash to check it against the chain and the backend." />}
        {hash !== undefined && <Results key={hash} hash={hash} />}
      </div>
    </>
  );
}
