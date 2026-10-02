import "server-only";
import { stripeConfiguration } from "./config";
import { stripeProvider, stripeSdk } from "./adapter";
export function configuredStripe() {
  const config = stripeConfiguration(process.env);
  const sdk = stripeSdk(config.secretKey, config.mode);
  return {
    config,
    sdk,
    provider: stripeProvider(sdk, config.accountId, config.mode),
  };
}
export function stripeReady() {
  try {
    stripeConfiguration(process.env);
    return true;
  } catch {
    return false;
  }
}

export function stripeMode() {
  try {
    return stripeConfiguration(process.env).mode;
  } catch {
    return null;
  }
}
