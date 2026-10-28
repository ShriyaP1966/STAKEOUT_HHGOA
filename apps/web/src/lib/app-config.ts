import type { Deployment } from "./deployment";
import type { PublicEnv } from "./env";

export type AppConfig = Omit<PublicEnv, "deployment"> & {
  deploymentName: PublicEnv["deployment"];
  deploymentFile: string;
  deployment: Deployment;
};
