import { Status } from "@shared/enums";

export type WarningLevel = "none" | "note" | "soft" | "strong";

export type Warning = {
  level: WarningLevel;
  label: string;
  message: string;
  showCountdown: boolean;
  showCluster: boolean;
};

const WARNINGS: Record<Status, Warning> = {
  [Status.None]: {
    level: "none",
    label: "No record",
    message: "This address has no reports, flags, or cluster entries.",
    showCountdown: false,
    showCluster: false,
  },
  [Status.Reported]: {
    level: "note",
    label: "Reported",
    message: "Someone reported this address. Reports are free and unverified.",
    showCountdown: false,
    showCluster: false,
  },
  [Status.Flagged]: {
    level: "soft",
    label: "Flagged",
    message: "A verified reporter staked on this address. The flag lapses unless it is confirmed or challenged.",
    showCountdown: true,
    showCluster: false,
  },
  [Status.Confirmed]: {
    level: "strong",
    label: "Confirmed scam cluster",
    message: "This address belongs to a confirmed scam cluster. Do not send funds.",
    showCountdown: false,
    showCluster: true,
  },
  [Status.Linked]: {
    level: "strong",
    label: "Linked to a scam cluster",
    message: "This address moves funds like a member of a confirmed scam cluster. Do not send funds.",
    showCountdown: false,
    showCluster: true,
  },
};

export function statusName(value: number): string {
  const name = Status[value];
  if (name === undefined) throw new Error(`Unknown status value ${value}.`);
  return name;
}

export function warningFor(status: number): Warning {
  if (!Object.hasOwn(WARNINGS, status)) throw new Error(`Unknown status value ${status}.`);
  return WARNINGS[status as Status];
}
