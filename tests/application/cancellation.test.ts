import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { abortable } from "../../src/application/cancellation.ts";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("settled work removes only its own abort listener and keeps the original result", async () => {
  for (const fails of [false, true]) {
    const controller = new AbortController();
    const otherListener = () => {};
    controller.signal.addEventListener("abort", otherListener);
    const work = deferred<object>();
    const result = abortable(work.promise, controller.signal);
    assert.equal(getEventListeners(controller.signal, "abort").length, 2);

    const value = { result: "provider result" };
    const error = new Error("provider failure");
    if (fails) {
      const rejected = assert.rejects(result, reason => reason === error);
      work.reject(error);
      await rejected;
    } else {
      work.resolve(value);
      assert.equal(await result, value);
    }
    assert.deepEqual(getEventListeners(controller.signal, "abort"), [otherListener]);
    controller.signal.removeEventListener("abort", otherListener);
    controller.abort(new Error("too late"));
    if (fails) await assert.rejects(result, reason => reason === error);
    else assert.equal(await result, value);
  }
});

test("pre-aborted signals preserve explicit reasons without registering listeners", async () => {
  for (const reason of [new Error("cancelled by caller"), "navigation", false, 0, ""]) {
    const controller = new AbortController();
    controller.abort(reason);
    const result = abortable(Promise.resolve("already completed"), controller.signal);
    await assert.rejects(result, error => error === reason);
    assert.deepEqual(getEventListeners(controller.signal, "abort"), []);
  }
});

test("default abort uses the native reason, while an explicit null reason uses the fallback", async () => {
  const defaultController = new AbortController();
  defaultController.abort();
  await assert.rejects(abortable(Promise.resolve("ignored"), defaultController.signal), error => {
    assert.equal(error, defaultController.signal.reason);
    assert.equal((error as Error).name, "AbortError");
    return true;
  });

  for (const preAborted of [false, true]) {
    const controller = new AbortController();
    const work = deferred<string>();
    if (preAborted) controller.abort(null);
    const result = abortable(work.promise, controller.signal);
    const rejected = assert.rejects(result, { name: "Error", message: "Cancelled" });
    if (!preAborted) controller.abort(null);
    await rejected;
    assert.deepEqual(getEventListeners(controller.signal, "abort"), []);
    work.resolve("late result");
    await work.promise;
  }
});

test("cancellation observes late work settlement and never replaces the abort reason", async () => {
  for (const preAborted of [false, true]) for (const lateFailure of [false, true]) {
    const controller = new AbortController();
    const reason = new Error("stop waiting");
    const work = deferred<string>();
    if (preAborted) controller.abort(reason);
    const result = abortable(work.promise, controller.signal);
    const rejected = assert.rejects(result, error => error === reason);
    if (!preAborted) controller.abort(reason);
    await rejected;
    assert.deepEqual(getEventListeners(controller.signal, "abort"), []);

    if (lateFailure) work.reject(new Error("late provider failure"));
    else work.resolve("late provider success");
    // A full turn also lets node:test detect an unobserved late rejection.
    await new Promise<void>(resolve => setImmediate(resolve));
    await assert.rejects(result, error => error === reason);
    assert.deepEqual(getEventListeners(controller.signal, "abort"), []);
  }
});
