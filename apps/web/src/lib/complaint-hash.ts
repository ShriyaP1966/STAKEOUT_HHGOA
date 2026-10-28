import { hashBundle } from "@shared/hash/index";

export type ComplaintHashCheck = { matches: boolean; expected: string; recomputed: string };

export function checkComplaintHash(response: { complaint: object; dataSource: string; complaintHash: string }): ComplaintHashCheck {
  const recomputed = hashBundle({ ...response.complaint, dataSource: response.dataSource });
  return {
    matches: recomputed.toLowerCase() === response.complaintHash.toLowerCase(),
    expected: response.complaintHash,
    recomputed,
  };
}
