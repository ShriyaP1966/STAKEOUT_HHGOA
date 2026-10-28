import { artifacts } from "hardhat";
import { writeAbis } from "./lib/abi";

writeAbis(artifacts)
  .then((files) => console.log(`Wrote ${files.join(", ")}`))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
