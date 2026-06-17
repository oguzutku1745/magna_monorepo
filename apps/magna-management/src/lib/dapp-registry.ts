import localDeployment from "../../../../deployments/local.json";

export type RegisteredDapp = {
  clientId: string;
  origin: string;
  consumerGatewayAddress: string;
};

type LocalDeployment = {
  l2?: {
    consumerAddress?: string;
    referenceDappConsumerAddress?: string;
  };
};

const localConsumerGateway =
  (localDeployment as LocalDeployment).l2?.referenceDappConsumerAddress ??
  (localDeployment as LocalDeployment).l2?.consumerAddress ??
  "";

const REGISTRY: RegisteredDapp[] = [
  {
    clientId: "dapp_reference",
    origin: import.meta.env.VITE_REFERENCE_DAPP_ORIGIN ?? "http://localhost:5175",
    consumerGatewayAddress: import.meta.env.VITE_REFERENCE_DAPP_GATEWAY ?? localConsumerGateway,
  },
];

export function resolveRegisteredDapp(clientId: string, origin: string): RegisteredDapp {
  const entry = REGISTRY.find(dapp => dapp.clientId === clientId);
  if (!entry) throw new Error(`unknown clientId: ${clientId}`);
  if (entry.origin !== origin) {
    throw new Error(`origin ${origin} is not registered for ${clientId}`);
  }
  if (!entry.consumerGatewayAddress) throw new Error(`no gateway configured for ${clientId}`);
  return entry;
}
