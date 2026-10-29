"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { Address } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { VoiceInput } from "@shared/ui/VoiceInput";
import { useAppConfig } from "@/components/AppConfigContext";
import { buttonClass, ErrorPanel, ExplorerLink, Field, inputClass, Loading, Mono, Notice, PageHeader, Section } from "@/components/ui";
import { combinedAbi } from "@/lib/abi";
import { findAddresses } from "@/lib/address-pick";
import { backend, BackendError, candidatesOf } from "@/lib/backend";
import { checkComplaintHash } from "@/lib/complaint-hash";
import { decodeError, type DecodedError } from "@/lib/errors";
import { useStakeoutClient } from "@/lib/hooks";
import { submitReport } from "@/lib/report";

function describe(error: unknown): DecodedError {
  return error instanceof BackendError ? error.decoded : decodeError(error, combinedAbi);
}

export default function ReportPage() {
  const config = useAppConfig();
  const client = useStakeoutClient();
  const { address, isConnected, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<Address | undefined>(undefined);
  const [needsChoice, setNeedsChoice] = useState(false);

  const extract = useMutation({
    mutationFn: (input: { text: string; targetAddress?: Address }) => backend.extract(input.text, input.targetAddress),
  });
  const localCandidates = findAddresses(text);
  const serverCandidates = candidatesOf(extract.error);
  const choices = localCandidates.length > 1 ? localCandidates : serverCandidates.length > 1 ? serverCandidates : [];
  const selected = chosen !== undefined && choices.includes(chosen) ? chosen : undefined;
  const hashCheck = extract.data ? checkComplaintHash(extract.data) : undefined;

  const send = useMutation({
    mutationFn: async () => {
      if (!extract.data || !hashCheck?.matches) throw new Error("The complaint hash has not been confirmed.");
      if (!address) throw new Error("Connect a wallet first.");
      return submitReport(client, (request) => writeContractAsync(request as Parameters<typeof writeContractAsync>[0]), {
        account: address,
        stakeout: config.deployment.stakeoutAddress,
        target: extract.data.complaint.targetAddress,
        evidenceHash: extract.data.complaintHash,
      });
    },
  });

  const onChain = chainId === config.deployment.chainId;
  const sendBlocked = !isConnected
    ? "Connect a wallet to submit the report on-chain."
    : !onChain
      ? `Switch your wallet to chain ${config.deployment.chainId} to submit.`
      : undefined;

  return (
    <>
      <PageHeader
        title="Report a scam"
        description="Reporting is free. Only the scam address and a hash of your complaint go on chain. The complaint text stays with the backend."
      />
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Progress">
        <li className={`rounded-sm border px-3 py-1.5 font-semibold ${extract.data ? "border-line bg-surface text-fg-muted" : "border-fg bg-brand text-brand-fg"}`}>1. Describe</li>
        <li className={`rounded-sm border px-3 py-1.5 font-semibold ${extract.data && !send.isSuccess ? "border-fg bg-brand text-brand-fg" : "border-line bg-surface text-fg-muted"}`}>2. Check details</li>
        <li className={`rounded-sm border px-3 py-1.5 font-semibold ${send.isSuccess ? "border-fg bg-brand text-brand-fg" : "border-line bg-surface text-fg-muted"}`}>3. Submit on chain</li>
      </ol>
      <Section title="What happened?" description="Include the address you sent funds to, the amount, and roughly when it happened.">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            send.reset();
            if (choices.length > 1 && selected === undefined) {
              setNeedsChoice(true);
              return;
            }
            setNeedsChoice(false);
            extract.mutate({ text, targetAddress: choices.length > 1 ? selected : undefined });
          }}
        >
          <label htmlFor="complaint" className="block text-sm font-semibold text-fg">
            Your complaint
          </label>
          <textarea
            id="complaint"
            rows={6}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className={`${inputClass} leading-relaxed`}
          />
          <div className="text-sm text-fg-muted [&>div]:flex [&>div]:flex-wrap [&>div]:items-center [&>div]:gap-3 [&_p]:basis-full [&_button]:inline-flex [&_button]:min-h-11 [&_button]:items-center [&_button]:rounded-md [&_button]:border [&_button]:border-line-strong [&_button]:bg-surface [&_button]:px-4 [&_button]:font-semibold [&_button]:text-fg [&_button]:transition-colors [&_button:hover]:bg-sunken [&_p]:mt-2 [&_p]:text-danger-fg">
            <VoiceInput lang={config.voiceLang} onText={(spoken) => setText(spoken)} />
          </div>
          {choices.length > 1 && (
            <fieldset className="space-y-2 rounded-md border border-warn-line bg-warn-bg p-4 text-warn-fg">
              <legend className="px-1 text-sm font-semibold">
                Your text has {choices.length} wallet addresses. Which one received the money?
              </legend>
              {choices.map((candidate) => (
                <label key={candidate} className="flex min-h-11 items-center gap-3 rounded-md border border-line bg-surface px-3 text-sm text-fg">
                  <input
                    className="h-4 w-4 accent-[var(--fg)]"
                    type="radio"
                    name="target"
                    value={candidate}
                    checked={selected === candidate}
                    onChange={() => {
                      setChosen(candidate);
                      setNeedsChoice(false);
                    }}
                  />
                  <span className="font-mono text-[13px] break-all">{candidate}</span>
                </label>
              ))}
              {needsChoice && <p className="text-sm font-semibold text-danger-fg">Choose the receiving address before extracting.</p>}
            </fieldset>
          )}
          <button
            type="submit"
            disabled={text.trim() === "" || extract.isPending}
            className={buttonClass("primary")}
          >
            {extract.isPending ? "Extracting…" : "Extract details"}
          </button>
          <p className="text-sm text-fg-muted">An AI model reads your words and pulls out the address, amount and time. Addresses are checked by code, never by the AI.</p>
        </form>
        <div className="mt-4" aria-live="polite">
          {extract.isError && <ErrorPanel error={describe(extract.error)} />}
        </div>
      </Section>

      {extract.isPending && (
        <Section title="Structured complaint">
          <Loading label="The backend is reading your complaint…" />
        </Section>
      )}

      {extract.data && hashCheck && (
        <Section title="Check the details" description="Make sure these match what happened before you submit.">
          <dl>
            <Field label="Target address">
              <ExplorerLink kind="address" value={extract.data.complaint.targetAddress} />
            </Field>
            <Field label="Amount">
              {extract.data.complaint.amount} {extract.data.complaint.currency}
            </Field>
            <Field label="Occurred at">{extract.data.complaint.occurredAt}</Field>
            <Field label="Narrative">{extract.data.complaint.narrative}</Field>
            <Field label="Data source">{extract.data.dataSource}</Field>
            <Field label="Complaint hash">
              <Mono>{extract.data.complaintHash}</Mono>
            </Field>
          </dl>
          <div className="mt-4">
            {hashCheck.matches ? (
              <Notice tone="ok" title="Hash matches the backend">
                This app recomputed the complaint hash and got the same value the backend stored.
              </Notice>
            ) : (
              <ErrorPanel
                error={{
                  title: "Complaint hash mismatch",
                  detail: `The backend sent ${hashCheck.expected}, but this app computed ${hashCheck.recomputed}. Nothing will be sent on-chain.`,
                }}
              />
            )}
          </div>
          {hashCheck.matches && (
            <div className="mt-5 space-y-3 border-t border-line pt-5" aria-live="polite">
              <p className="text-sm text-fg-muted">
                Free, with no stake. You only pay network gas. Only the address and the complaint hash go on chain.
              </p>
              <button
                type="button"
                disabled={sendBlocked !== undefined || send.isPending || send.isSuccess}
                onClick={() => send.mutate()}
                className={buttonClass("accent")}
              >
                {send.isPending ? "Submitting…" : send.isSuccess ? "Report submitted" : "Submit report on-chain"}
              </button>
              {sendBlocked && <p className="text-sm text-fg-muted">{sendBlocked}</p>}
              {send.isError && <ErrorPanel error={describe(send.error)} />}
              {send.isSuccess && (
                <Notice tone="ok" title="Report submitted">
                  Transaction <ExplorerLink kind="tx" value={send.data} />
                </Notice>
              )}
            </div>
          )}
        </Section>
      )}
    </>
  );
}
