import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";
import type { QuickJSContext, QuickJSHandle, QuickJSRuntime } from "quickjs-emscripten";

// ZEP Script: lets a map creator attach custom behavior to a "script"-type
// map object (server/src/map.ts's MapObject.code) without touching this
// project's own source. The code is player-authored and untrusted, so it
// runs inside QuickJS compiled to WebAssembly (quickjs-emscripten) — a real
// memory-isolated sandbox, not Node's own `vm` module (which Node's own docs
// say is not a security boundary and can be escaped). WASM also means no
// native compile step, unlike an alternative like isolated-vm — one less
// thing to break across platforms (see the Dockerfile alpine->slim switch
// mediasoup needed for the opposite reason).
//
// The sandbox exposes nothing but a small `$` API object (onEnter/onLeave/
// onInterval/say/broadcast/teleport/log below) — no `require`, no `process`,
// no network, no filesystem, because none of those are QuickJS builtins to
// begin with and this module never adds them. Two more guards make a script
// merely slow/wasteful instead of able to hang or crash the server:
// - an interrupt handler aborts any single call after SCRIPT_TIMEOUT_MS
//   (verified against a real `while (true) {}` before wiring this in)
// - a memory limit aborts a script that tries to allocate its way to OOM
//
// State: a script's top-level `let`/`var` bindings persist for as long as
// this sandbox is alive (one QuickJS context per script object, created
// once at server startup and reused for every onEnter/onLeave/onInterval
// call) — a script can just close over a counter the normal way, no special
// getState/setState API needed.
const SCRIPT_TIMEOUT_MS = 200;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const MAX_STACK_SIZE_BYTES = 1024 * 1024;
const MIN_INTERVAL_MS = 250;
const MAX_INTERVALS_PER_SCRIPT = 4;
export const MAX_SCRIPT_CODE_LENGTH = 20000;

export interface ScriptPlayerInfo {
  id: string;
  nickname: string;
  x: number;
  y: number;
}

export interface ScriptHostCallbacks {
  say: (playerId: string, text: string) => void;
  broadcast: (text: string) => void;
  teleport: (playerId: string, x: number, y: number) => void;
}

function playerInfoToHandle(context: QuickJSContext, player: ScriptPlayerInfo): QuickJSHandle {
  const handle = context.newObject();
  const id = context.newString(player.id);
  const nickname = context.newString(player.nickname);
  const x = context.newNumber(player.x);
  const y = context.newNumber(player.y);
  context.setProp(handle, "id", id);
  context.setProp(handle, "nickname", nickname);
  context.setProp(handle, "x", x);
  context.setProp(handle, "y", y);
  id.dispose();
  nickname.dispose();
  x.dispose();
  y.dispose();
  return handle;
}

/** One sandboxed VM per script object, alive for the server process's
 * lifetime. Registration (top-level code) runs once at construction; after
 * that, only the handlers it registered via $.onEnter/$.onLeave/$.onInterval
 * are ever called. */
export class ScriptSandbox {
  private runtime: QuickJSRuntime;
  private context: QuickJSContext;
  private onEnterHandles: QuickJSHandle[] = [];
  private onLeaveHandles: QuickJSHandle[] = [];
  private intervalTimers: NodeJS.Timeout[] = [];
  private intervalHandlerHandles: QuickJSHandle[] = [];
  private disposed = false;
  /** Set if the script failed to even register (syntax error, threw at top
   * level) — the object is then inert but the server keeps running. */
  loadError: string | null = null;

  private constructor(
    private readonly objectId: string,
    runtime: QuickJSRuntime,
    context: QuickJSContext
  ) {
    this.runtime = runtime;
    this.context = context;
  }

  static async create(objectId: string, code: string, callbacks: ScriptHostCallbacks): Promise<ScriptSandbox> {
    const QuickJS = await getQuickJS();
    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
    runtime.setMaxStackSize(MAX_STACK_SIZE_BYTES);
    const context = runtime.newContext();

    const sandbox = new ScriptSandbox(objectId, runtime, context);
    sandbox.loadError = sandbox.registerApiAndRun(code, callbacks);
    return sandbox;
  }

  private withDeadline<T>(fn: () => T): T {
    this.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + SCRIPT_TIMEOUT_MS));
    try {
      return fn();
    } finally {
      this.runtime.setInterruptHandler(() => false);
    }
  }

  private registerApiAndRun(code: string, callbacks: ScriptHostCallbacks): string | null {
    const context = this.context;
    const dollar = context.newObject();

    const onEnterFn = context.newFunction("onEnter", (fnHandle) => {
      this.onEnterHandles.push(fnHandle.dup());
    });
    const onLeaveFn = context.newFunction("onLeave", (fnHandle) => {
      this.onLeaveHandles.push(fnHandle.dup());
    });
    const onIntervalFn = context.newFunction("onInterval", (msHandle, fnHandle) => {
      if (this.intervalTimers.length >= MAX_INTERVALS_PER_SCRIPT) {
        return context.newError(`script object "${this.objectId}": too many onInterval timers (max ${MAX_INTERVALS_PER_SCRIPT})`);
      }
      const ms = Math.max(MIN_INTERVAL_MS, context.getNumber(msHandle));
      const longLivedFn = fnHandle.dup();
      this.intervalHandlerHandles.push(longLivedFn);
      const timer = setInterval(() => {
        this.callHandleSafely(longLivedFn, []);
      }, ms);
      this.intervalTimers.push(timer);
      return undefined;
    });
    const sayFn = context.newFunction("say", (playerIdHandle, textHandle) => {
      callbacks.say(context.getString(playerIdHandle), context.getString(textHandle));
    });
    const broadcastFn = context.newFunction("broadcast", (textHandle) => {
      callbacks.broadcast(context.getString(textHandle));
    });
    const teleportFn = context.newFunction("teleport", (playerIdHandle, xHandle, yHandle) => {
      callbacks.teleport(context.getString(playerIdHandle), context.getNumber(xHandle), context.getNumber(yHandle));
    });
    const logFn = context.newFunction("log", (...args) => {
      const values = args.map((a) => context.dump(a));
      console.log(`[zep-script:${this.objectId}]`, ...values);
    });

    for (const [key, fn] of [
      ["onEnter", onEnterFn],
      ["onLeave", onLeaveFn],
      ["onInterval", onIntervalFn],
      ["say", sayFn],
      ["broadcast", broadcastFn],
      ["teleport", teleportFn],
      ["log", logFn],
    ] as const) {
      context.setProp(dollar, key, fn);
      fn.dispose();
    }
    context.setProp(context.global, "$", dollar);
    dollar.dispose();

    return this.withDeadline(() => {
      const result = context.evalCode(code);
      if (result.error) {
        const dumped = context.dump(result.error);
        result.error.dispose();
        return `${dumped?.name ?? "Error"}: ${dumped?.message ?? String(dumped)}`;
      }
      result.value.dispose();
      return null;
    });
  }

  private callHandleSafely(fnHandle: QuickJSHandle, argHandles: QuickJSHandle[]) {
    try {
      this.withDeadline(() => {
        const result = this.context.callFunction(fnHandle, this.context.undefined, ...argHandles);
        if (result.error) {
          const dumped = this.context.dump(result.error);
          result.error.dispose();
          console.warn(`[zep-script:${this.objectId}] handler error:`, dumped);
        } else {
          result.value.dispose();
        }
      });
    } catch (err) {
      console.warn(`[zep-script:${this.objectId}] handler threw outside the VM:`, err);
    } finally {
      for (const arg of argHandles) arg.dispose();
    }
  }

  triggerEnter(player: ScriptPlayerInfo) {
    for (const handle of this.onEnterHandles) {
      this.callHandleSafely(handle, [playerInfoToHandle(this.context, player)]);
    }
  }

  triggerLeave(player: ScriptPlayerInfo) {
    for (const handle of this.onLeaveHandles) {
      this.callHandleSafely(handle, [playerInfoToHandle(this.context, player)]);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.intervalTimers) clearInterval(timer);
    for (const handle of [...this.onEnterHandles, ...this.onLeaveHandles, ...this.intervalHandlerHandles]) {
      handle.dispose();
    }
    this.context.dispose();
    this.runtime.dispose();
  }
}
