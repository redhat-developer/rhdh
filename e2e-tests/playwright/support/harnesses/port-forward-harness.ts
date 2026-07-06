import { bindPortForwardRestarter } from "../../utils/port-forward";
import {
  PortForwardSession,
  type PortForwardCommand,
  type PortForwardOptions,
} from "../../utils/port-forward";

export type { PortForwardCommand, PortForwardOptions };

/** Lifecycle wrapper for kubectl/oc port-forward sessions used in E2E specs. */
export class PortForwardHarness {
  private session: PortForwardSession | null = null;

  constructor(
    private readonly command: PortForwardCommand,
    private readonly options: PortForwardOptions,
  ) {}

  async start(): Promise<void> {
    this.session ??= new PortForwardSession(this.command, this.options);
    await this.session.start();
  }

  async restart(): Promise<void> {
    if (this.session === null) {
      await this.start();
      return;
    }
    await this.session.restart();
  }

  enableAutoRestartOnDbConnect(): void {
    bindPortForwardRestarter(() => this.restart());
  }

  disableAutoRestartOnDbConnect(): void {
    bindPortForwardRestarter(null);
  }

  async stop(): Promise<void> {
    this.disableAutoRestartOnDbConnect();
    await this.session?.stop();
    this.session = null;
  }
}
