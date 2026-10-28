import { z } from "zod";

const DEPLOYMENT_NAMES = ["target", "localhost"] as const;
const DATA_SOURCES = ["synthetic", "testnet"] as const;

export type DeploymentName = (typeof DEPLOYMENT_NAMES)[number];
type DataSource = (typeof DATA_SOURCES)[number];

export type PublicEnv = {
  rpcUrl: string;
  logChunkSize: number;
  explorerUrl: string | undefined;
  deployment: DeploymentName;
  dataSource: DataSource;
  backendUrl: string;
  voiceLang: string;
};

export type RawPublicEnv = Record<
  | "NEXT_PUBLIC_RPC_URL"
  | "NEXT_PUBLIC_LOG_CHUNK_SIZE"
  | "NEXT_PUBLIC_EXPLORER_URL"
  | "NEXT_PUBLIC_DEPLOYMENT"
  | "NEXT_PUBLIC_DATA_SOURCE"
  | "NEXT_PUBLIC_BACKEND_URL"
  | "NEXT_PUBLIC_VOICE_LANG",
  string | undefined
>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; problems: string[] };

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const text = z
  .string({ error: (issue) => (issue.input === undefined ? "is missing" : "must be text") })
  .trim()
  .min(1, { error: "is missing", abort: true });

const httpUrl = text.refine(isHttpUrl, "must be an http or https URL");

function isLanguageTag(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

const oneOf = <T extends readonly [string, ...string[]]>(values: T) =>
  text.pipe(z.enum(values, { error: `must be one of: ${values.join(", ")}` }));

const schema = z.object({
  NEXT_PUBLIC_RPC_URL: httpUrl,
  NEXT_PUBLIC_LOG_CHUNK_SIZE: text
    .regex(/^[0-9]+$/, "must be a whole number")
    .transform(Number)
    .refine((value) => Number.isSafeInteger(value) && value >= 1, "must be at least 1"),
  NEXT_PUBLIC_EXPLORER_URL: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional()
    .refine((value) => value === undefined || isHttpUrl(value), "must be an http or https URL"),
  NEXT_PUBLIC_DEPLOYMENT: oneOf(DEPLOYMENT_NAMES),
  NEXT_PUBLIC_DATA_SOURCE: oneOf(DATA_SOURCES),
  NEXT_PUBLIC_BACKEND_URL: httpUrl,
  NEXT_PUBLIC_VOICE_LANG: text.refine(isLanguageTag, "must be a BCP-47 language tag"),
});

export function parsePublicEnv(raw: RawPublicEnv): ParseResult<PublicEnv> {
  const result = schema.safeParse(raw);
  const problems = result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);

  const explorerMissing = (raw.NEXT_PUBLIC_EXPLORER_URL ?? "").trim() === "";
  if (raw.NEXT_PUBLIC_DEPLOYMENT?.trim() === "target" && explorerMissing) {
    problems.push("NEXT_PUBLIC_EXPLORER_URL: is missing (required when NEXT_PUBLIC_DEPLOYMENT is target)");
  }

  if (!result.success || problems.length > 0) return { ok: false, problems };
  const env = result.data;
  return {
    ok: true,
    value: {
      rpcUrl: env.NEXT_PUBLIC_RPC_URL,
      logChunkSize: env.NEXT_PUBLIC_LOG_CHUNK_SIZE,
      explorerUrl: env.NEXT_PUBLIC_EXPLORER_URL?.replace(/\/+$/, ""),
      deployment: env.NEXT_PUBLIC_DEPLOYMENT,
      dataSource: env.NEXT_PUBLIC_DATA_SOURCE,
      backendUrl: env.NEXT_PUBLIC_BACKEND_URL.replace(/\/+$/, ""),
      voiceLang: env.NEXT_PUBLIC_VOICE_LANG,
    },
  };
}
