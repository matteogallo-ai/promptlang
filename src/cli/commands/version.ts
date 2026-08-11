import packageJson from "../../../package.json";

export function runVersion(): number {
  const repo =
    typeof packageJson.repository === "object"
      ? packageJson.repository.url
      : packageJson.repository;
  console.log(`promptlang ${packageJson.version}`);
  console.log(`repository: ${repo}`);
  console.log(`license:    ${packageJson.license}`);
  return 0;
}
