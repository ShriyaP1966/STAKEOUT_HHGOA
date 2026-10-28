"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { Address } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { VoiceInput } from "@shared/ui/VoiceInput";
import { useAppConfig } from "@/components/AppConfigContext";
import { ErrorPanel, ExplorerLink, Field, Loading, Mono, Section } from "@/components/ui";
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
      <Section title="Report a scam">
        <form
          className="space-y-3"
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
          <label htmlFor="complaint" className="block text-sm font-medium text-slate-700">
            Describe what happened, including the address you sent funds to
          </label>
          <textarea
            id="complaint"
            rows={6}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <VoiceInput lang={config.voiceLang} onText={(spoken) => setText(spoken)} />
          {choices.length > 1 && (
            <fieldset className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
              <legend className="px-1 text-sm font-medium text-amber-900">
                Your text has {choices.length} wallet addresses. Which one received the money?
              </legend>
              {choices.map((candidate) => (
                <label key={candidate} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="target"
                    value={candidate}
                    checked={selected === candidate}
                    onChange={() => {
                      setChosen(candidate);
                      setNeedsChoice(false);
                    }}
                  />
                  <span className="font-mono text-xs break-all">{candidate}</span>
                </label>
              ))}
              {needsChoice && <p className="text-sm text-red-700">Choose the receiving address before extracting.</p>}
            </fieldset>
          )}
          <button
            type="submit"
            disabled={text.trim() === "" || extract.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {extract.isPending ? "Extracting…" : "Extract complaint"}
          </button>
        </form>
        <div className="mt-4">
          {extract.isError && <ErrorPanel error={describe(extract.error)} />}
        </div>
      </Section>

      {extract.isPending && (
        <Section title="Structured complaint">
          <Loading label="The backend is extracting the complaint…" />
        </Section>
      )}

      {extract.data && hashCheck && (
        <Section title="Structured complaint">
          <dl className="space-y-2">
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
              <p role="status" className="text-sm text-emerald-800">
                Recomputed hash matches the backend&apos;s complaint hash.
              </p>
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
            <div className="mt-4 space-y-2">
              <p className="text-sm text-slate-600">
                Only the address and the complaint hash go on-chain. The complaint text stays in the backend.
              </p>
              <button
                type="button"
                disabled={sendBlocked !== undefined || send.isPending || send.isSuccess}
                onClick={() => send.mutate()}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {send.isPending ? "Submitting…" : "Submit report on-chain"}
              </button>
              {sendBlocked && <p className="text-sm text-slate-600">{sendBlocked}</p>}
              {send.isError && <ErrorPanel error={describe(send.error)} />}
              {send.isSuccess && (
                <p role="status" className="text-sm text-emerald-800">
                  Report submitted. Transaction <ExplorerLink kind="tx" value={send.data} />
                </p>
              )}
            </div>
          )}
        </Section>
      )}
    </>
  );
}
