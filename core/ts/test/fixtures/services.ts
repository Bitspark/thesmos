import type { Value } from "@bitspark/logos-contract";
import { encodeInt, encodeText } from "@bitspark/ontos-data";
import { atom, createSpacesVerifier, fact, path, type AuthenticateSpaceFacts, type Decision } from "../../src/index.js";

/** The caller is identified by the hosting service before these methods are called. */
export class DocumentService {
  private readonly verifier;
  readonly documents = new Map<string, string>([["doc7", "Draft"]]);
  constructor(root: Value, authenticate: AuthenticateSpaceFacts) { this.verifier = createSpacesVerifier({ root, authenticate }); }

  rename(actor: string, id: string, title: string, proof: Uint8Array): Decision {
    const decision = this.verifier.verify({
      query: { actor: atom(actor), space: path("team", "docs"), statement: fact("title", atom(id), encodeText(title)) }, proof,
    });
    if (decision.permitted) this.documents.set(id, title);
    return decision;
  }
}

export class DeviceService {
  private readonly verifier;
  readonly temperatures = new Map<string, number>([["device7", 18]]);
  constructor(root: Value, authenticate: AuthenticateSpaceFacts) { this.verifier = createSpacesVerifier({ root, authenticate }); }

  setTemperature(actor: string, id: string, value: number, proof: Uint8Array): Decision {
    const decision = this.verifier.verify({
      query: { actor: atom(actor), space: path("lab", "bench"), statement: fact("temperature", atom(id), encodeInt(BigInt(value))) }, proof,
    });
    if (decision.permitted) this.temperatures.set(id, value);
    return decision;
  }
}

export class ReleaseService {
  private readonly verifier;
  readonly releases = new Map<string, string>();
  constructor(root: Value, authenticate: AuthenticateSpaceFacts) { this.verifier = createSpacesVerifier({ root, authenticate }); }

  deploy(actor: string, project: string, release: string, proof: Uint8Array): Decision {
    const decision = this.verifier.verify({
      query: { actor: atom(actor), space: path("project"), statement: fact("deployed", atom(project), atom(release)) }, proof,
    });
    if (decision.permitted) this.releases.set(project, release);
    return decision;
  }
}
