export class RunHub {
  private readonly controllers = new Map<string, AbortController>();

  create(runId: string): AbortController {
    const existing = this.controllers.get(runId);
    existing?.abort();
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    return controller;
  }

  abort(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }

  forget(runId: string): void {
    this.controllers.delete(runId);
  }
}
